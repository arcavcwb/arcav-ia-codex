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
function fakeSpawn(events, {exit=0,onSpawn=()=>{}}={}){
  return (exe,args,opts)=>{
    onSpawn({exe,args,opts});
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};
    queueMicrotask(()=>{
      for(const item of events){child.stdout.write(typeof item==='string'?item+'\n':JSON.stringify(item)+'\n');}
      child.stdout.end();child.emit('close',exit,null);
    });
    return child;
  };
}

test('crea plan sin ejecutar modelos y sin filtrar prompt a la consola',()=>withTemp(dir=>{
  const p=planTaskExecution(packet(dir));
  assert.equal(p.execution,'dry-run');assert.equal(p.model_id,'gpt-test-small');
  assert.equal(p.argv.at(-1),'-');assert.ok(p.argv.includes('workspace-write'));
  assert.deepEqual(p.argv.slice(0,3),['--ask-for-approval','never','exec']);
  assert.ok(!p.argv.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(p.max_total_tokens,8000);
  assert.ok(p.prompt_bytes<=32768);
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
  assert.equal(denied.status,1);assert.match(denied.stderr,/Git|repositor|git|rev-parse/i);
}));
