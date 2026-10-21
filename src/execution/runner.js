import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const VALID_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const MAX_EVENT_BUFFER = 128 * 1024;

/** Plan determinista: ni procesos ni credenciales son usados en esta fase. */
export function planTaskExecution(packet, { maxTotalTokens = 8000, timeoutSeconds = 300 } = {}) {
  if (packet?.execution !== 'dry-run' || !packet.task?.id || packet.task?.risk === 'critical' ||
      packet.routing?.requires_human_approval) throw new Error('Paquete inválido o tarea crítica bloqueada.');
  const model = packet.routing?.implementer?.model_id;
  if (typeof model !== 'string' || !VALID_MODEL.test(model)) {
    throw new Error('Debe configurar un model_id válido para el implementador (--models).');
  }
  if (!Number.isSafeInteger(maxTotalTokens) || maxTotalTokens < 100 || maxTotalTokens > 100_000) {
    throw new Error('maxTotalTokens debe ser entero de 100 a 100000.');
  }
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 3600) {
    throw new Error('timeoutSeconds debe ser entero de 10 a 3600.');
  }
  const prompt = JSON.stringify({
    task: packet.task,
    context_files: packet.context_files,
    quality_gates: packet.quality_gates,
    instruction: 'Implementar solamente esta tarea. No crear commits ni hacer push. Aplicar TDD; reportar evidencia de pruebas y cambios. Solicitar contexto adicional si es imprescindible.'
  });
  if (Buffer.byteLength(prompt, 'utf8') > packet.max_context_bytes) {
    throw new Error('El prompt excede el presupuesto de contexto del paquete.');
  }
  return {
    execution: 'dry-run', task_id: packet.task.id, model_id: model,
    timeout_seconds: timeoutSeconds, max_total_tokens: maxTotalTokens,
    budget_enforcement: 'best-effort: se comprueba al recibir eventos; no limita una llamada en curso',
    prompt_bytes: Buffer.byteLength(prompt, 'utf8'),
    command: 'codex',
    argv: ['exec', '--model', model, '--sandbox', 'workspace-write', '--ask-for-approval', 'never', '--json', '-'],
    prompt,
  };
}

/** Impide ejecutar sobre main o un worktree que ya contiene modificaciones. */
export function assertCleanFeatureBranch(repoRoot, { git = execFileSync } = {}) {
  const root = fs.realpathSync(repoRoot);
  const call = (...argv) => git('git', argv, {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const top = fs.realpathSync(call('rev-parse','--show-toplevel'));
  if (top !== root) throw new Error('Ejecute desde la raíz del repositorio Git.');
  const branch = call('branch','--show-current');
  if (!branch || branch === 'main' || branch === 'master') throw new Error('Se requiere una rama de feature; main/master están prohibidas.');
  if (call('status','--porcelain').length > 0) throw new Error('El worktree debe estar limpio antes de invocar Codex.');
  return {root,branch,commit:call('rev-parse','HEAD')};
}

/** El ejecutor jamás muestra respuestas del modelo ni guarda el prompt en el resultado.
 * Inicia un único Codex no interactivo solo después de autorización CLI --execute.
 */
export function executeTaskPlan(plan, { repoRoot, spawnImpl = spawn, git = execFileSync } = {}) {
  if (plan?.execution !== 'dry-run' || plan.command !== 'codex' || !Array.isArray(plan.argv)) {
    throw new Error('Plan de ejecución inválido.');
  }
  const branch = assertCleanFeatureBranch(repoRoot, {git});
  return new Promise(resolve => {
    let child;
    try {
      child = spawnImpl('codex', plan.argv, {cwd:branch.root,shell:false,stdio:['pipe','pipe','pipe']});
    } catch (error) {
      resolve({task_id:plan.task_id,status:'spawn_error',error_code:error.code ?? 'SPAWN',telemetry_complete:false});
      return;
    }
    const usage = {input_tokens:0,cached_input_tokens:0,output_tokens:0,total_tokens:0};
    let observed = false, overBudget = false, timedOut = false, invalidStream = false;
    let buffer='', streamBytes=0, stderrBytes=0, finished=false, escalationTimer=null;
    const decoder = new StringDecoder('utf8');
    function stop() {
      if (escalationTimer || finished) return;
      try {child.kill('SIGTERM');} catch {}
      escalationTimer=setTimeout(()=>{if(!finished)try {child.kill('SIGKILL');} catch {}}, 2000);
      escalationTimer.unref?.();
    }
    function ingest(line) {
      if (!line.trim()) return;
      let event;
      try {event=JSON.parse(line);} catch {invalidStream=true;stop();return;}
      if (event.type !== 'turn.completed') return;
      const u=event.usage;
      if (!u || !['input_tokens','output_tokens'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)) {
        invalidStream=true;stop();return;
      }
      observed=true;
      usage.input_tokens += u.input_tokens;
      usage.output_tokens += u.output_tokens;
      usage.cached_input_tokens += Number.isSafeInteger(u.cached_input_tokens) ? u.cached_input_tokens : 0;
      usage.total_tokens += u.input_tokens + u.output_tokens;
      if (usage.total_tokens > plan.max_total_tokens) {overBudget=true;stop();}
    }
    child.stdout?.on('data', chunk => {
      const s=decoder.write(chunk);streamBytes+=chunk.length;
      if (streamBytes > 2_000_000) {invalidStream=true;stop();return;}
      buffer+=s;
      let index;
      while ((index=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        if (Buffer.byteLength(line)>MAX_EVENT_BUFFER) {invalidStream=true;stop();return;}
        ingest(line);
      }
      if (Buffer.byteLength(buffer)>MAX_EVENT_BUFFER) {invalidStream=true;stop();}
    });
    child.stderr?.on('data', chunk => {stderrBytes+=chunk.length; if(stderrBytes>1_000_000){invalidStream=true;stop();}});
    const timer=setTimeout(()=>{timedOut=true;stop();}, plan.timeout_seconds*1000);
    timer.unref?.();
    const finish = (code, signal, errorCode=null) => {
      if(finished)return;finished=true;clearTimeout(timer);if(escalationTimer)clearTimeout(escalationTimer);
      buffer+=decoder.end();
      if(buffer.trim() && !invalidStream) ingest(buffer);
      const status=errorCode ? 'spawn_error' : timedOut?'timeout':invalidStream?'invalid_telemetry':overBudget?'budget_exceeded':code!==0?'codex_failed':!observed?'telemetry_missing':'completed_needs_review';
      resolve({task_id:plan.task_id,status,model_id:plan.model_id,exit_code:code,signal,
        branch:branch.branch,usage:observed?usage:null,telemetry_complete:observed&&!invalidStream,
        max_total_tokens:plan.max_total_tokens,token_limit_is_hard:false,
        review_required:true, ...(errorCode?{error_code:errorCode}:{})});
    };
    child.on('error', err=>finish(null,null,err.code ?? 'SPAWN'));
    child.on('close',(code,signal)=>finish(code,signal));
    child.stdin?.on('error',()=>{});
    child.stdin?.end(plan.prompt);
  });
}
