import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createPilotFixture} from '../scripts/pilot-fixture.mjs';
import {createTaskWorktree} from '../src/worktree/manager.js';
import {validateBacklog} from '../src/backlog/validate.js';
import {planScheduledDispatch,executeScheduledDispatch} from '../src/scheduler/dispatch.js';
import {budgetPaths,budgetStatus} from '../src/budget/manager.js';
import {verifyTaskChanges} from '../src/execution/verify.js';

const git=(cwd,...args)=>execFileSync('git',args,{
  cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],
}).trim();
function temp(run) {
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-pilot-test-'));
  try {
    const value=run(d);
    if(value && typeof value.then==='function')return value.finally(()=>fs.rmSync(d,{force:true,recursive:true}));
    fs.rmSync(d,{force:true,recursive:true});return value;
  }catch(error){fs.rmSync(d,{force:true,recursive:true});throw error;}
}
function input(fixture) {
  const backlog=JSON.parse(fs.readFileSync(fixture.backlog_file,'utf8'));
  const policy=JSON.parse(fs.readFileSync(fixture.policy_file,'utf8'));
  return {repoRoot:fixture.repo_dir,backlog,policy,taskId:'TASK-901',
    runId:'pilot-901-first',models:{luna:'test-model',sol:'test-model',astra:'test-model'},
    maxTotalTokens:2500,timeoutSeconds:120};
}
test('genera fixture sintético, Git limpio y sin credentials ni modelo ejecutable por defecto',()=>temp(d=>{
  const f=createPilotFixture({directory:path.join(d,'pilot')});
  const b=JSON.parse(fs.readFileSync(f.backlog_file,'utf8'));
  assert.deepEqual(validateBacklog(b).errors,[]);
  assert.equal(f.codex_executed,false);
  assert.equal(f.authentication_checked,false);
  assert.equal(git(f.repo_dir,'status','--porcelain'),'');
  assert.equal(git(f.repo_dir,'branch','--show-current'),'main');
  const models=JSON.parse(fs.readFileSync(f.models_file,'utf8'));
  assert.deepEqual(models,{luna:'',sol:'',astra:''});
  assert.equal(fs.existsSync(f.repo_dir+'.worktrees'),false);
  assert.equal(fs.existsSync(budgetPaths(f.repo_dir).dir),false);
  assert.ok(!fs.existsSync(path.join(f.repo_dir,'.env')));
  const baselineEnv={...process.env};
  delete baselineEnv.NODE_TEST_CONTEXT; // prevent recursive node:test from skipping the fixture
  const initial=spawnSync(process.execPath,['--test','test/customer.test.js'],{
    cwd:f.repo_dir,encoding:'utf8',shell:false,env:baselineEnv});
  assert.notEqual(initial.status,0,'TDD RED baseline must fail');
  assert.equal(b.tasks[0].status,'ready');
  assert.deepEqual(b.tasks[0].context_files,['src/customer.js','test/customer.test.js','package.json']);
}));
test('crea worktree y planifica ejecución sin Codex ni budget ledger',()=>temp(d=>{
  const f=createPilotFixture({directory:path.join(d,'pilot')});
  const wt=createTaskWorktree(f.repo_dir,'TASK-901');
  assert.equal(wt.exists,true);
  const p=planScheduledDispatch(input(f));
  assert.equal(p.execution,'dry-run');
  assert.equal(p.worktree,wt.target);
  assert.equal(p.max_total_tokens,2500);
  assert.equal(p.admission.allowed,true);
  assert.equal(p.prompt,undefined);
  assert.equal(fs.existsSync(budgetPaths(f.repo_dir).dir),false);
}));
test('simulación SIN Codex real: reserva, cambio acotado y QA GREEN',()=>temp(async d=>{
  const f=createPilotFixture({directory:path.join(d,'pilot')});
  const wt=createTaskWorktree(f.repo_dir,'TASK-901');
  let spawned=0;
  const r=await executeScheduledDispatch(input(f),{
    executeTask:async(_plan,{repoRoot})=>{
      spawned++;
      assert.equal(repoRoot,wt.target);
      assert.equal(budgetStatus(f.repo_dir,input(f).policy).active_runs,1);
      fs.writeFileSync(path.join(wt.target,'src/customer.js'),[
        'export function isValidCustomerName(name) {',
        "  return typeof name === 'string' && name.trim().length >= 2;",
        '}',''
      ].join('\n'));
      return {status:'completed_needs_review',telemetry_complete:true,
        usage:{input_tokens:800,output_tokens:200,cached_input_tokens:150,total_tokens:1000}};
    }
  });
  assert.equal(spawned,1);
  assert.equal(r.status,'completed_needs_review');
  assert.equal(r.settlement.accounted_tokens,1000);
  assert.equal(r.settlement.source,'reported');
  assert.equal(r.merge_approved,false);
  const report=verifyTaskChanges(input(f).backlog,'TASK-901',{
    repoRoot:wt.target,runTests:true,timeoutSeconds:60});
  assert.equal(report.ready_for_independent_review,true);
  assert.deepEqual(report.changed_files,['src/customer.js']);
  assert.equal(report.checks.tests_passed,true);
  assert.equal(report.merge_approved,false);
  assert.equal(git(f.repo_dir,'status','--porcelain'),'');
}));
test('no sobrescribe destino ya existente con datos de otro usuario',()=>temp(d=>{
  const occupied=path.join(d,'existing');fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied,'keep.txt'),'KEEP');
  assert.throws(()=>createPilotFixture({directory:occupied}),/EEXIST/);
  assert.equal(fs.readFileSync(path.join(occupied,'keep.txt'),'utf8'),'KEEP');
}));

test('QA no hereda NODE_TEST_CONTEXT y verifica realmente la suite RED',()=>temp(d=>{
  const f=createPilotFixture({directory:path.join(d,'pilot')});
  const wt=createTaskWorktree(f.repo_dir,'TASK-901');
  const old=process.env.NODE_TEST_CONTEXT;
  try {
    process.env.NODE_TEST_CONTEXT='child-v8';
    const report=verifyTaskChanges(input(f).backlog,'TASK-901',{
      repoRoot:wt.target,runTests:true,timeoutSeconds:60});
    assert.equal(report.tests.executed,true);
    assert.notEqual(report.tests.exit_code,0,'the initial RED fixture must fail');
    assert.equal(report.checks.tests_passed,false);
    assert.equal(report.ready_for_independent_review,false);
  } finally {
    if(old===undefined)delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT=old;
  }
}));
