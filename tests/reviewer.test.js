import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {planIndependentReview, parseReviewResult, executeIndependentReview} from '../src/execution/reviewer.js';

const diff='diff --git a/src/x.js b/src/x.js\n+const x=2;\n';
const digest=createHash('sha256').update(diff).digest('hex');
const task={id:'TASK-001',title:'Validación',risk:'low',acceptance_criteria:['OK']};
const handoff={execution:'review-handoff-only',status:'ready_for_independent_review',task,
  reviewer:{tier:'sol',model_id:'review-test-model'},
  review_contract:{independent_review_completed:false,merge_approved:false,implementer_conversation_included:false},
  qa:{branch:'feat/example',head_sha:'a'.repeat(40),base_sha:'b'.repeat(40),diff_sha256:digest,
    checks:{diff_present:true,no_untracked_files:true,whitespace_clean:true,tests_passed:true},tests:{executed:true,exit_code:0}},
  diff:{included:true,sha256:digest,content:diff}};
const output={verdict:'needs_changes',summary:'Falta validación de tipos',findings:[{severity:'medium',file:'src/x.js',line:1,message:'Agregar tipo de entrada'}]};
const event=(obj)=>JSON.stringify(obj)+'\n';
// calls, si se pasa, registra cada comando git recibido.
function fakeGit(dir, {changed=false,untracked=false,baseRef='main',calls=null}={}) {
  return (bin,args)=>{
    assert.equal(bin,'git');
    const cmd=args.join(' ');
    calls?.push(cmd);
    if(cmd==='rev-parse --show-toplevel') return dir+'\n';
    if(cmd==='branch --show-current') return 'feat/example\n';
    if(cmd==='rev-parse HEAD') return 'a'.repeat(40)+'\n';
    if(cmd==='merge-base HEAD '+baseRef) return 'b'.repeat(40)+'\n';
    if(cmd==='diff --no-ext-diff --binary '+ 'b'.repeat(40)+' --') return Buffer.from(changed?'DIFFERENT':diff);
    if(cmd==='ls-files --others --exclude-standard') return untracked?'secret.txt\n':'';
    throw new Error('unexpected '+cmd);
  };
}
// beforeClose(args) simula a Codex escribiendo archivos (p. ej. --output-last-message) antes de terminar.
function fakeSpawn(events,{exit=0,onSpawn=()=>{},beforeClose=()=>{}}={}) {
  return (exe,args,opts)=>{
    onSpawn(exe,args,opts);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.killed = true;
    };
    queueMicrotask(()=>{
      for (const item of events) child.stdout.write(event(item));
      child.stdout.end();
      beforeClose(args);
      child.emit('close',exit,null);
    });
    return child;
  };
}
const flagValue = (args, flag) => args[args.indexOf(flag) + 1];
const agentMessage = text => ({type:'item.completed',item:{type:'agent_message',text}});
// Espera a callbacks async antes de borrar el directorio.
async function withDir(callback) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-'));
  try {
    return await callback(d);
  } finally {
    fs.rmSync(d,{recursive:true,force:true});
  }
}

const completed={type:'turn.completed',usage:{input_tokens:20,output_tokens:30,cached_input_tokens:5}};
const message={type:'item.completed',item:{type:'agent_message',text:JSON.stringify(output)}};

test('plan de revisión es de solo lectura, sesión efímera y sin historial del implementador',()=>{
  const p=planIndependentReview(handoff);
  assert.equal(p.execution,'dry-run');assert.equal(p.model_id,'review-test-model');
  assert.ok(p.argv.includes('read-only'));assert.ok(p.argv.includes('--ephemeral'));
  assert.ok(!p.argv.includes('workspace-write'));assert.ok(!p.argv.includes('resume'));
  assert.equal(p.max_total_tokens,8000);assert.equal(p.token_limit_is_hard,false);
  assert.equal(p.prompt.includes('historial del implementador'),false);
  // approval_policy como override -c tras exec: exec ignora el flag global --ask-for-approval.
  assert.deepEqual(p.argv,['exec','-c','approval_policy="never"','--model','review-test-model',
    '--sandbox','read-only','--ephemeral','--json','-']);
});
test('falla cerrado con QA incompleto, diff adulterado, riesgo crítico o modelo desconocido',()=>{
  const values=[
    {...handoff,status:'blocked_awaiting_qa'},
    {...handoff,qa:{...handoff.qa,checks:{...handoff.qa.checks,tests_passed:false}}},
    {...handoff,diff:{...handoff.diff,content:'other'}},
    {...handoff,task:{...task,risk:'critical'}},
    {...handoff,reviewer:{model_id:null}},
    {...handoff,review_contract:{...handoff.review_contract,merge_approved:true}},
  ];
  for(const x of values) assert.throws(()=>planIndependentReview(x));
  assert.throws(()=>planIndependentReview(handoff,{timeoutSeconds:2}));
  assert.throws(()=>planIndependentReview(handoff,{maxTotalTokens:100001}));
});
test('rechaza salidas JSON inválidas, campos inválidos o pass con hallazgo alto',()=>{
  assert.throws(()=>parseReviewResult('NO JSON'));
  assert.throws(()=>parseReviewResult(JSON.stringify({...output,verdict:'maybe'})));
  assert.throws(()=>parseReviewResult(JSON.stringify({...output,findings:[{...output.findings[0],line:-1}]})));
  assert.throws(()=>parseReviewResult(JSON.stringify({...output,verdict:'pass',findings:[{...output.findings[0],severity:'high'}]})));
  assert.equal(parseReviewResult(JSON.stringify(output)).verdict,'needs_changes');
});
test('ejecuta revisión simulada y nunca autoriza merge',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-exec-'));
  try {
    let call;
    const res=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
      spawnImpl:fakeSpawn([message,completed],{onSpawn:(...args)=>call=args})});
    assert.equal(res.status,'completed_needs_human_review');
    assert.equal(res.review_completed,true);assert.equal(res.verdict,'needs_changes');
    assert.equal(res.findings.length,1);assert.equal(res.usage.total_tokens,50);
    assert.equal(res.merge_approved,false);assert.equal(res.human_review_required,true);
    assert.equal(res.base_ref,'main');
    assert.equal(call[0],'codex');assert.equal(call[2].shell,false);
  }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('sin repositorio Git el revisor da un error legible y no el crudo de git rev-parse',async()=>withDir(async d=>{
  const git = () => {
    throw new Error('Command failed: git rev-parse --show-toplevel\nfatal: not a git repository');
  };
  const root = fs.realpathSync(d);
  assert.throws(()=>executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git}),error=>{
    assert.equal(error.message,`No se encontró un repositorio Git en ${root}.`);
    return true;
  });
}));
test('bloquea cambio de diff antes de iniciar o presencia de untracked',async()=>withDir(async d=>{
  assert.throws(()=>executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d,{changed:true})}),/cambió/);
  assert.throws(()=>executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d,{untracked:true})}),/cambió/);
}));
test('salida sin telemetría o revisión inválida no es aprobación',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-failed-'));
  try{
    let r=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),spawnImpl:fakeSpawn([message])});
    assert.equal(r.status,'telemetry_missing');assert.equal(r.merge_approved,false);
    r=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),spawnImpl:fakeSpawn([
      {type:'item.completed',item:{type:'agent_message',text:'not json'}},completed])});
    assert.equal(r.status,'review_invalid');
  }finally {fs.rmSync(d,{recursive:true,force:true})}
});
test('exceso de presupuesto se informa sin alegar un corte duro',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-budget-'));
  try{
    const p=planIndependentReview(handoff,{maxTotalTokens:100});
    const r=await executeIndependentReview(p,{repoRoot:d,git:fakeGit(d),spawnImpl:fakeSpawn([message,
      {type:'turn.completed',usage:{input_tokens:150,output_tokens:30}}])});
    assert.equal(r.status,'budget_exceeded');assert.equal(r.merge_approved,false);
  }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('detecta cambios inesperados durante revisión',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-change-'));
  try{
    let count=0;
    const git=(...args)=>fakeGit(d,{changed:count++>=5})(...args);
    const r=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git,spawnImpl:fakeSpawn([message,completed])});
    assert.equal(r.status,'workspace_changed');assert.equal(r.review_completed,false);
  }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('tolera un preámbulo: el último agent_message es el respaldo de la respuesta',async()=>withDir(async d=>{
  const res = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([agentMessage('Voy a revisar el diff.'),message,completed])});
  assert.equal(res.status,'completed_needs_human_review');
  assert.equal(res.verdict,'needs_changes');
  assert.equal(res.merge_approved,false);
  // Solo cuenta el último mensaje: no se busca JSON entre mensajes anteriores.
  const last = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,agentMessage('Listo.'),completed])});
  assert.equal(last.status,'review_invalid');
}));
test('acepta JSON envuelto en un único bloque de código y nada más permisivo',async()=>withDir(async d=>{
  const json = JSON.stringify(output);
  assert.equal(parseReviewResult('```json\n'+json+'\n```').verdict,'needs_changes');
  assert.equal(parseReviewResult('```\n'+json+'\n```\n').verdict,'needs_changes');
  assert.equal(parseReviewResult('```json\r\n'+JSON.stringify(output,null,2)+'\r\n```').verdict,'needs_changes');
  const rejected = [
    'Resultado:\n```json\n'+json+'\n```',
    '```json\n'+json+'\n```\nListo.',
    '```json\n'+json+'\n```\n```json\n'+json+'\n```',
    '```js\n'+json+'\n```',
    '```json '+json+' ```',
  ];
  for (const text of rejected) assert.throws(()=>parseReviewResult(text),/JSON inválido/);
  // Las demás validaciones siguen aplicando dentro del bloque.
  const contradictory = JSON.stringify({...output,verdict:'pass',findings:[{...output.findings[0],severity:'high'}]});
  assert.throws(()=>parseReviewResult('```json\n'+contradictory+'\n```'),/contradice/);
  const res = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([agentMessage('```json\n'+json+'\n```'),completed])});
  assert.equal(res.status,'completed_needs_human_review');
}));
test('el mensaje de --output-last-message tiene prioridad sobre el stream',async()=>withDir(async d=>{
  const writeFinal = text => args => fs.writeFileSync(flagValue(args,'--output-last-message'),text);
  const fromFile = {verdict:'pass',summary:'Sin problemas relevantes',findings:[]};
  const res = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,completed],{beforeClose:writeFinal(JSON.stringify(fromFile))})});
  assert.equal(res.status,'completed_needs_human_review');
  assert.equal(res.verdict,'pass');
  assert.deepEqual(res.findings,[]);
  // Archivo vacío: se usa el último agent_message del stream.
  const fallback = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,completed],{beforeClose:writeFinal(' \n')})});
  assert.equal(fallback.verdict,'needs_changes');
  // Archivo presente pero inválido: no se recurre al stream.
  const invalid = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,completed],{beforeClose:writeFinal('no es JSON')})});
  assert.equal(invalid.status,'review_invalid');
  assert.equal(invalid.verdict,null);
}));
test('un -o que es un symlink o que supera el límite da review_invalid sin recurrir al stream',{skip:process.platform==='win32'},async()=>withDir(async d=>{
  // Una revisión válida fuera del directorio privado: el enlace no se sigue.
  const outside = path.join(d,'revision-ajena.json');
  fs.writeFileSync(outside,JSON.stringify({verdict:'pass',summary:'Sin problemas relevantes',findings:[]}));
  const linked = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,completed],{beforeClose:args=>fs.symlinkSync(outside,flagValue(args,'--output-last-message'))})});
  assert.equal(linked.status,'review_invalid');
  assert.equal(linked.verdict,null);
  // JSON válido para parseReviewResult, pero con relleno que supera los 128 KiB.
  const oversized = JSON.stringify(output)+' '.repeat(128 * 1024);
  const tooBig = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,completed],{beforeClose:args=>fs.writeFileSync(flagValue(args,'--output-last-message'),oversized)})});
  assert.equal(tooBig.status,'review_invalid');
  assert.equal(tooBig.verdict,null);
}));
test('una revisión válida de unos 70 KB se acepta por el stream y por el archivo de -o',async()=>withDir(async d=>{
  // Cerca del máximo de parseReviewResult: resumen de 2000 caracteres y 30 hallazgos de 2000.
  const findings = Array.from({length:30},(_,i)=>({severity:'low',file:`src/${'modulo-'.repeat(30)}${i}.js`,line:i+1,message:'m'.repeat(2000)}));
  const text = JSON.stringify({verdict:'needs_changes',summary:'s'.repeat(2000),findings});
  const bytes = Buffer.byteLength(text,'utf8');
  assert.ok(bytes > 64 * 1024 && bytes < 128 * 1024, `tamaño inesperado: ${bytes}`);
  const fromStream = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([agentMessage(text),completed])});
  assert.equal(fromStream.status,'completed_needs_human_review');
  assert.equal(fromStream.findings.length,30);
  const fromFile = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,completed],{beforeClose:args=>fs.writeFileSync(flagValue(args,'--output-last-message'),text)})});
  assert.equal(fromFile.status,'completed_needs_human_review');
  assert.equal(fromFile.findings.length,30);
}));
test('escribe un JSON Schema estricto durante la ejecución y borra el directorio temporal',async()=>withDir(async d=>{
  let spawnedArgs;
  let schema;
  const res = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,completed],{
      onSpawn: (exe,args) => {
        spawnedArgs = args;
      },
      beforeClose: args => {
        schema = JSON.parse(fs.readFileSync(flagValue(args,'--output-schema'),'utf8'));
      },
    })});
  assert.equal(res.status,'completed_needs_human_review');
  const schemaFile = flagValue(spawnedArgs,'--output-schema');
  const messageFile = flagValue(spawnedArgs,'--output-last-message');
  assert.deepEqual(spawnedArgs.slice(0,3),['exec','-c','approval_policy="never"']);
  assert.deepEqual(spawnedArgs.slice(-5),['--output-schema',schemaFile,'--output-last-message',messageFile,'-']);
  assert.equal(path.dirname(schemaFile),path.dirname(messageFile));
  assert.ok(path.dirname(schemaFile).startsWith(path.join(os.tmpdir(),'arcav-codex-review-')));
  // Estricto: todas las propiedades requeridas y sin propiedades adicionales en cada objeto.
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());
  const finding = schema.properties.findings.items;
  assert.equal(finding.additionalProperties,false);
  assert.deepEqual([...finding.required].sort(),Object.keys(finding.properties).sort());
  assert.deepEqual(schema.properties.verdict.enum,['pass','needs_changes']);
  assert.deepEqual(finding.properties.severity.enum,['critical','high','medium','low']);
  assert.deepEqual(finding.properties.line.type,['integer','null']);
  assert.equal(fs.existsSync(path.dirname(schemaFile)),false);
}));
test('si spawn lanza de inmediato informa spawn_error y borra el directorio temporal',async()=>withDir(async d=>{
  let spawnedArgs;
  const res = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:(exe,args)=>{
      spawnedArgs = args;
      throw Object.assign(new Error('no existe'),{code:'ENOENT'});
    }});
  assert.deepEqual(res,{task_id:'TASK-001',status:'spawn_error',error_code:'ENOENT',review_completed:false,base_ref:'main'});
  assert.equal(fs.existsSync(path.dirname(flagValue(spawnedArgs,'--output-schema'))),false);
}));
test('turn.failed invalida el stream del revisor',async()=>withDir(async d=>{
  const res = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([message,{type:'turn.failed',error:{message:'fallo'}},completed])});
  assert.equal(res.status,'invalid_events');
  assert.equal(res.verdict,null);
  assert.equal(res.merge_approved,false);
}));
test('un evento error de reintento no invalida la revisión; un error definitivo no da veredicto',async()=>withDir(async d=>{
  // Codex emite "error" mientras reintenta y el turno sigue en marcha.
  const retry = {type:'error',message:'Reconnecting... 1/5 (stream disconnected before completion)'};
  const res = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([{type:'turn.started'},retry,message,completed])});
  assert.equal(res.status,'completed_needs_human_review');
  assert.equal(res.verdict,'needs_changes');
  assert.equal(res.merge_approved,false);
  // Un error definitivo termina con código de salida no cero.
  const fatal = await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
    spawnImpl:fakeSpawn([{type:'turn.started'},{type:'error',message:'fallo'},message],{exit:1})});
  assert.equal(fatal.status,'codex_failed');
  assert.equal(fatal.verdict,null);
}));
test('base_ref: main por defecto, la del handoff si existe y rechazo de referencias inseguras',()=>{
  assert.equal(planIndependentReview(handoff).base_ref,'main');
  const develop = {...handoff,qa:{...handoff.qa,base_ref:'develop'}};
  assert.equal(planIndependentReview(develop).base_ref,'develop');
  for (const base_ref of ['-x','--output=/tmp/x','a..b','']) {
    assert.throws(()=>planIndependentReview({...handoff,qa:{...handoff.qa,base_ref}}),/referencia Git inválida/);
  }
});
test('merge-base usa la base_ref del plan y un plan alterado se rechaza antes de Git',async()=>withDir(async d=>{
  const calls = [];
  const plan = planIndependentReview({...handoff,qa:{...handoff.qa,base_ref:'develop'}});
  const res = await executeIndependentReview(plan,{repoRoot:d,git:fakeGit(d,{baseRef:'develop',calls}),
    spawnImpl:fakeSpawn([message,completed])});
  assert.equal(res.status,'completed_needs_human_review');
  assert.equal(res.base_ref,'develop');
  assert.ok(calls.includes('merge-base HEAD develop'));
  assert.equal(calls.includes('merge-base HEAD main'),false);
  const git = () => {
    throw new Error('Git no debe consultarse');
  };
  assert.throws(()=>executeIndependentReview({...plan,base_ref:'-x'},{repoRoot:d,git}),/referencia Git inválida/);
  assert.throws(()=>executeIndependentReview({...plan,argv:plan.argv.slice(0,-1)},{repoRoot:d,git}),/inseguro o inválido/);
}));


// Regression: numeric CLI flags were mistakenly parsed with a literal \\d regexp.
import { spawnSync } from 'node:child_process';
const commandModule = new URL('../src/backlog/command.js', import.meta.url).href;
test('review-run acepta límites numéricos válidos antes de validar el backlog', () => withDir(dir => {
  const modelsFile = path.join(dir,'models.json');
  const invalidBacklog = path.join(dir,'backlog.json');
  fs.writeFileSync(modelsFile, JSON.stringify({luna:'model-1',sol:'model-2',astra:'model-3'}));
  fs.writeFileSync(invalidBacklog, '{}');
  const code = `import {runPlanningCommand} from ${JSON.stringify(commandModule)}; process.exit(await runPlanningCommand(process.argv.slice(1)));`;
  for (const additionalArgs of [
    ['--max-total-tokens','4000','--timeout-seconds','120'],
    ['--max-total-tokens','4000','--timeout-seconds','120','--test-timeout-seconds','60','--max-review-bytes','32768'],
  ]) {
    const res = spawnSync(process.execPath,['--input-type=module','-e',code,'task','review-run','TASK-001',
      '--file',invalidBacklog,'--repo',dir,'--models',modelsFile,
      '--run-tests','--include-diff','--execute',...additionalArgs],{cwd:dir,encoding:'utf8'});
    assert.equal(res.status,1);
    assert.match(res.stderr,/Backlog inválido/);
    assert.doesNotMatch(res.stderr,/requiere un entero positivo/);
  }
}));

test('el bloqueo del handoff añade la nota cuando npm test modificó el worktree', () => {
  const note = 'npm test modificó el worktree: creó archivos sin registrar (reporte.xml).';
  const blocked = {...handoff, status: 'blocked_awaiting_qa'};
  assert.throws(() => planIndependentReview({...blocked, note}), error =>
    error.message.startsWith('Review handoff bloqueado: se requiere QA aprobado y diff íntegro.') &&
    error.message.endsWith(note));
  assert.throws(() => planIndependentReview(blocked), error =>
    error.message === 'Review handoff bloqueado: se requiere QA aprobado y diff íntegro.');
});
