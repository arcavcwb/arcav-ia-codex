import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createTaskWorktree} from '../src/worktree/manager.js';
import {budgetStatus,budgetPaths,reserveBudget} from '../src/budget/manager.js';
import {planScheduledDispatch,executeScheduledDispatch} from '../src/scheduler/dispatch.js';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const policy={schema_version:1,provider:'codex',window_hours:24,
  token_budget:10000,threshold_pct:60,max_in_flight:1};
const models={luna:'codex-test-small',sol:'codex-test-medium',astra:'codex-test-large'};
const mkTask=(overrides={})=>({
  id:'TASK-001',story_id:'US-001',title:'Implementar la validación',
  description:'Rechazar datos inválidos sin modificar otra funcionalidad',
  acceptance_criteria:['Entrada inválida genera error'],dependencies:[],
  status:'ready',story_points:2,risk:'low',priority:2,
  complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:1},
  test_plan:['npm test'],...overrides,
});
const mkBacklog=(tasks=[mkTask()])=>({schema_version:1,
  epics:[{id:'EP-001',title:'Calidad'}],
  stories:[{id:'US-001',epic_id:'EP-001',title:'Validación',
    acceptance_criteria:['Entrada inválida genera error']}],tasks,
});
function fixture(fn,{makeWorktree=true}={}) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-scheduler-'));
  const root=path.join(tmp,'repo');
  fs.mkdirSync(root); git(root,'init','-b','main');
  git(root,'config','user.name','QA');
  git(root,'config','user.email','qa@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'hello\n');
  git(root,'add','README.md'); git(root,'commit','-m','initial');
  const wt=makeWorktree?createTaskWorktree(root,'TASK-001').target:null;
  const input={repoRoot:root,backlog:mkBacklog(),taskId:'TASK-001',models,policy,
    runId:'run-001',maxTotalTokens:3000,timeoutSeconds:60};
  try {
    const result=fn({root,tmp,wt,input});
    if (result && typeof result.then==='function') return result.finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
    fs.rmSync(tmp,{recursive:true,force:true});
    return result;
  } catch(e){fs.rmSync(tmp,{recursive:true,force:true});throw e;}
}
const complete=(tokensIn=1200,tokensOut=400)=>({
  status:'completed_needs_review',telemetry_complete:true,
  usage:{input_tokens:tokensIn,output_tokens:tokensOut,cached_input_tokens:200,total_tokens:tokensIn+tokensOut},
});
test('dry-run planifica en worktree aislado y no crea registro ni invoca modelo',()=>fixture(({root,wt,input})=>{
  const plan=planScheduledDispatch(input);
  assert.equal(plan.execution,'dry-run');
  assert.equal(plan.worktree,wt);
  assert.equal(plan.branch,'feat/TASK-001');
  assert.equal(plan.model_id,models.luna);
  assert.equal(plan.admission.allowed,true);
  assert.equal(plan.token_limit_is_hard,false);
  assert.equal(plan.run_requires_execute,true);
  assert.equal(plan.prompt,undefined);
  assert.equal(fs.existsSync(budgetPaths(root).dir),false);
  assert.equal(git(root,'branch','--show-current'),'main');
}));
test('bloquea worktree ausente, sucio o desactualizado',()=>fixture(({root,wt,input})=>{
  fs.writeFileSync(path.join(wt,'unstaged.txt'),'secret');
  assert.throws(()=>planScheduledDispatch(input),/cambios pendientes/);
  fs.rmSync(path.join(wt,'unstaged.txt'));
  fs.writeFileSync(path.join(root,'extra.txt'),'new\n');
  git(root,'add','extra.txt');git(root,'commit','-m','advance main');
  assert.throws(()=>planScheduledDispatch(input),/no coincide con main/);
}));
test('bloquea worktree inexistente y origen checkout no-main',()=>fixture(({root,input})=>{
  assert.throws(()=>planScheduledDispatch(input),/crea primero el worktree/);
  git(root,'switch','-c','other');
  assert.throws(()=>planScheduledDispatch(input),/principal en main/);
},{makeWorktree:false}));
test('dependencias pendientes, draft y riesgos críticos nunca llegan a Codex',()=>fixture(({input})=>{
  const draft=mkBacklog([mkTask({status:'draft'})]);
  assert.throws(()=>planScheduledDispatch({...input,backlog:draft}),/ready/);
  const critical=mkBacklog([mkTask({risk:'critical'})]);
  assert.throws(()=>planScheduledDispatch({...input,backlog:critical}),/crítico/);
  const dependencies=mkBacklog([mkTask({dependencies:['TASK-002']}),mkTask({id:'TASK-002',status:'draft'})]);
  assert.throws(()=>planScheduledDispatch({...input,backlog:dependencies}),/depend|ready/i);
}));
test('budget gate bloquea despachos antes de invocar al ejecutor',async()=>fixture(async ({root,input})=>{
  reserveBudget(root,policy,{runId:'other',taskId:'TASK-002',tokens:3000});
  assert.throws(()=>planScheduledDispatch(input),/budget: concurrencia máxima/);
  let calls=0;
  await assert.rejects(()=>executeScheduledDispatch(input,{executeTask:async()=>{calls++;return complete();}}),/budget/);
  assert.equal(calls,0);
  assert.equal(budgetStatus(root,policy).active_runs,1);
}));
test('ejecución opt-in reserva antes del spawn, usa worktree y liquida tokens reales',async()=>fixture(async ({root,wt,input})=>{
  let calls=0;
  const result=await executeScheduledDispatch(input,{executeTask:async (plan,{repoRoot})=>{
    calls++;
    assert.equal(repoRoot,wt);
    assert.equal(plan.model_id,models.luna);
    assert.equal(plan.max_total_tokens,3000);
    assert.equal(budgetStatus(root,policy).active_runs,1);
    return complete(2200,1200);
  }});
  assert.equal(calls,1);
  assert.equal(result.status,'completed_needs_review');
  assert.equal(result.settlement.source,'reported');
  assert.equal(result.settlement.accounted_tokens,3400);
  assert.equal(result.settlement.over_reservation,true);
  assert.equal(result.merge_approved,false);
  assert.equal(result.human_review_required,true);
  const status=budgetStatus(root,policy);
  assert.equal(status.active_runs,0);
  assert.equal(status.used_tokens,3400);
  assert.equal(git(root,'status','--porcelain'),'');
}));
test('sin telemetría completa conserva estimación, incluso si runner falla',async()=>fixture(async ({root,input})=>{
  const r=await executeScheduledDispatch(input,{executeTask:async()=>({
    status:'telemetry_missing',usage:null,telemetry_complete:false,
  })});
  assert.equal(r.status,'telemetry_missing');
  assert.equal(r.settlement.source,'estimated');
  assert.equal(r.settlement.accounted_tokens,3000);
  assert.equal(budgetStatus(root,policy).estimated_runs_in_window,1);
}));
test('runner que lanza excepción liquida estimado y no aprueba merge',async()=>fixture(async ({root,input})=>{
  const r=await executeScheduledDispatch(input,{executeTask:async()=>{throw new Error('model unavailable');}});
  assert.equal(r.status,'runner_failed');
  assert.equal(r.settlement.source,'estimated');
  assert.equal(r.merge_approved,false);
  assert.equal(budgetStatus(root,policy).reserved_tokens,0);
}));
test('error de liquidación mantiene reserva fail-closed, sin reintento automático',async()=>fixture(async ({root,input})=>{
  await assert.rejects(()=>executeScheduledDispatch(input,{
    executeTask:async()=>complete(),
    settle:()=>{throw new Error('disk failure');},
  }),/reserva conservada/);
  assert.equal(budgetStatus(root,policy).active_runs,1);
  await assert.rejects(()=>executeScheduledDispatch({...input,runId:'run-002'},{executeTask:async()=>complete()}),/budget/);
}));
test('dos agentes compiten por el mismo presupuesto: no se inicia el segundo',async()=>fixture(async ({root,input})=>{
  let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const a=executeScheduledDispatch(input,{executeTask:async()=>{await barrier;return complete();}});
  assert.equal(budgetStatus(root,policy).active_runs,1);
  let spawned=0;
  await assert.rejects(()=>executeScheduledDispatch({...input,runId:'run-002'},{
    executeTask:async()=>{spawned++;return complete();}
  }),/concurrencia máxima/);
  assert.equal(spawned,0);
  release();
  await a;
  assert.equal(budgetStatus(root,policy).active_runs,0);
}));
