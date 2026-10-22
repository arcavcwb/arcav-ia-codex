import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { runCodexJsonl } from './codex-process.js';
import { LIMITS, inRange } from '../limits.js';

const VALID_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
// Mismo formato de ID que exige src/backlog/validate.js; forma parte del nombre del informe.
const VALID_TASK_ID = /^[A-Z][A-Z0-9-]*$/;
// Nombres propios del ejecutor para los estados comunes de codex-process.js.
const STATUS_NAMES = { invalid_stream: 'invalid_telemetry', completed: 'completed_needs_review' };

/** Plan determinista: ni procesos ni credenciales son usados en esta fase. */
export function planTaskExecution(packet, {
  maxTotalTokens = LIMITS.maxTotalTokens.default,
  timeoutSeconds = LIMITS.timeoutSeconds.default,
} = {}) {
  if (packet?.execution !== 'dry-run' || !packet.task?.id || packet.task?.risk === 'critical' ||
      packet.routing?.requires_human_approval) throw new Error('Paquete inválido o tarea crítica bloqueada.');
  const model = packet.routing?.implementer?.model_id;
  if (typeof model !== 'string' || !VALID_MODEL.test(model)) {
    throw new Error('Debe configurar un model_id válido para el implementador (--models).');
  }
  if (!inRange(maxTotalTokens, LIMITS.maxTotalTokens)) {
    throw new Error(`maxTotalTokens debe ser entero de ${LIMITS.maxTotalTokens.min} a ${LIMITS.maxTotalTokens.max}.`);
  }
  if (!inRange(timeoutSeconds, LIMITS.timeoutSeconds)) {
    throw new Error(`timeoutSeconds debe ser entero de ${LIMITS.timeoutSeconds.min} a ${LIMITS.timeoutSeconds.max}.`);
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
    // approval_policy va como override -c justo después de "exec", con comillas TOML: codex exec
    // (0.163.0) ignora el flag global --ask-for-approval aunque vaya antes del subcomando.
    // Sin --output-last-message: Codex escribiría el mensaje final, fuera del sandbox, en una
    // ruta que los comandos del sandbox workspace-write pueden preparar (p. ej. con un symlink).
    // El argv es el mismo en el dry-run y al ejecutar.
    argv: ['exec', '-c', 'approval_policy="never"', '--model', model, '--sandbox', 'workspace-write', '--json', '-'],
    final_message: 'Al terminar Codex, el CLI guarda su último agent_message en un archivo temporal privado; nunca se imprime.',
    prompt,
  };
}

/** Impide ejecutar sobre main o un worktree que ya contiene modificaciones. */
export function assertCleanFeatureBranch(repoRoot, { git = execFileSync } = {}) {
  const root = fs.realpathSync(repoRoot);
  const call = (...argv) => git('git', argv, {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  let topLevel;
  try {
    topLevel = call('rev-parse','--show-toplevel');
  } catch (error) {
    // Mensaje legible en lugar del error crudo "Command failed: git rev-parse ...".
    throw new Error(`No se encontró un repositorio Git en ${root}.`, { cause: error });
  }
  const top = fs.realpathSync(topLevel);
  if (top !== root) throw new Error('Ejecute desde la raíz del repositorio Git.');
  const branch = call('branch','--show-current');
  if (!branch || branch === 'main' || branch === 'master') throw new Error('Se requiere una rama de feature; main/master están prohibidas.');
  if (call('status','--porcelain').length > 0) throw new Error('El worktree debe estar limpio antes de invocar Codex.');
  return {root,branch,commit:call('rev-parse','HEAD')};
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort: el directorio es privado y está en el temporal del sistema.
  }
}

/**
 * Guarda el mensaje final en un directorio temporal nuevo (0700), creado cuando Codex ya terminó.
 * 'wx' (O_CREAT | O_EXCL) falla si la ruta ya existe, también como enlace simbólico o duro,
 * así que nunca se escribe a través de un enlace plantado. Devuelve la ruta o el código de error.
 */
function saveReport(taskId, message, mkdtemp) {
  if (!message) return { report_file: null };
  let dir = null;
  try {
    dir = mkdtemp(path.join(os.tmpdir(), 'arcav-codex-'));
    const file = path.join(dir, `${taskId}-mensaje-final.md`);
    fs.writeFileSync(file, message, { flag: 'wx', mode: 0o600 });
    return { report_file: file };
  } catch (error) {
    // rmSync no sigue enlaces: borra un enlace plantado, nunca su destino.
    if (dir) removeDir(dir);
    return { report_file: null, report_error: error?.code ?? 'WRITE' };
  }
}

/** Ejecuta Codex y, cuando termina, guarda su último agent_message en un archivo privado. */
async function runImplementer(plan, branch, { spawnImpl, mkdtemp }) {
  let lastMessage = null;
  const run = await runCodexJsonl({
    argv: plan.argv,
    prompt: plan.prompt,
    cwd: branch.root,
    timeoutSeconds: plan.timeout_seconds,
    maxTotalTokens: plan.max_total_tokens,
    spawnImpl,
    onEvent: event => {
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        // Solo cuenta el último mensaje; si no trae texto, no hay mensaje final que guardar.
        lastMessage = typeof event.item.text === 'string' ? event.item.text : null;
      }
      return true;
    },
  });
  if (run.spawn_threw) {
    return {
      task_id: plan.task_id,
      status: 'spawn_error',
      error_code: run.error_code,
      telemetry_complete: false,
      report_file: null,
    };
  }
  // Solo se devuelve la ruta: el contenido del modelo queda en disco para revisión humana.
  const report = saveReport(plan.task_id, lastMessage, mkdtemp);
  return {
    task_id: plan.task_id,
    status: STATUS_NAMES[run.status] ?? run.status,
    model_id: plan.model_id,
    exit_code: run.exit_code,
    signal: run.signal,
    branch: branch.branch,
    usage: run.usage,
    telemetry_complete: run.usage !== null && !run.stream_invalid,
    max_total_tokens: plan.max_total_tokens,
    token_limit_is_hard: false,
    review_required: true,
    ...report,
    ...(run.error_code ? { error_code: run.error_code } : {}),
  };
}

/** El ejecutor jamás muestra respuestas del modelo ni guarda el prompt en el resultado.
 * Inicia un único Codex no interactivo solo después de autorización CLI --execute.
 * report_file es la ruta del último agent_message del implementador, que el CLI escribe cuando
 * Codex termina, o null si no hubo mensaje o falló la escritura (report_error lleva el código).
 * spawnImpl, git y mkdtemp (por defecto fs.mkdtempSync) se inyectan en los tests.
 */
export function executeTaskPlan(plan, { repoRoot, spawnImpl = spawn, git = execFileSync, mkdtemp = fs.mkdtempSync } = {}) {
  if (plan?.execution !== 'dry-run' || plan.command !== 'codex' || !Array.isArray(plan.argv) ||
      plan.argv.at(-1) !== '-' || typeof plan.task_id !== 'string' || !VALID_TASK_ID.test(plan.task_id)) {
    throw new Error('Plan de ejecución inválido.');
  }
  const branch = assertCleanFeatureBranch(repoRoot, {git});
  return runImplementer(plan, branch, { spawnImpl, mkdtemp });
}
