import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  validateBudgetPolicy,budgetPaths,budgetStatus,previewBudgetReservation,
  reserveBudget,previewBudgetSettlement,settleBudget
} from '../src/budget/manager.js';

const policy={schema_version:1,provider:'codex',window_hours:3,token_budget:10000,threshold_pct:60,max_in_flight:2};
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(fn) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-budget-')),root=path.join(tmp,'project');
  fs.mkdirSync(root);git(root,'init','-b','main');
  git(root,'config','user.name','QA');git(root,'config','user.email','qa@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'hello\n');
  git(root,'add','README.md');git(root,'commit','-m','initial');
  try{return fn({root,tmp});}finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
const at=(hours=0)=>new Date(Date.UTC(2026,9,24,hours)).toISOString();
const reserve=(root,runId,tokens=2000,extra={})=>reserveBudget(root,policy,{
  runId,taskId:'TASK-001',tokens,now:()=>at(),...extra
});
test('policy: strict schema, no guessed quotas or unknown providers',()=>{
  assert.deepEqual(validateBudgetPolicy(policy),policy);
  for(const bad of [
    {...policy,provider:'gemini'}, {...policy,window_hours:0}, {...policy,max_in_flight:0},
    {...policy,token_budget:0},{...policy,threshold_pct:101},{...policy,token_budget:500.4},
    {...policy,limit_usd:2}
  ]) assert.throws(()=>validateBudgetPolicy(bad),/budget/);
});
test('status y vista previa son de sólo lectura; límite interno calculado',()=>fixture(({root})=>{
  const paths=budgetPaths(root);
  assert.equal(fs.existsSync(paths.dir),false);
  const s=budgetStatus(root,policy,{now:()=>at()});
  assert.equal(s.cap_tokens,6000);assert.equal(s.remaining_tokens,6000);
  assert.equal(s.official_quota_known,false);assert.equal(s.cost_usd,null);
  const p=previewBudgetReservation(root,policy,{runId:'demo-1',taskId:'TASK-001',tokens:3000,now:()=>at()});
  assert.equal(p.allowed,true);assert.equal(p.execution,'dry-run');
  assert.equal(fs.existsSync(paths.dir),false);
  assert.equal(git(root,'status','--porcelain'),'');
}));
test('reserva atómica, conciliación real sin doble conteo de cache ni reasoning',()=>fixture(({root})=>{
  const r=reserve(root,'run-1',3000);
  assert.equal(r.execution,'executed');assert.equal(r.reserved_tokens,3000);
  assert.equal(previewBudgetSettlement(root,'run-1').reserved_tokens,3000);
  const settled=settleBudget(root,{runId:'run-1',usage:{
    input_tokens:1600,output_tokens:400,cached_input_tokens:1200,reasoning_output_tokens:100
  },now:()=>at()});
  assert.equal(settled.source,'reported');assert.equal(settled.accounted_tokens,2000);
  const s=budgetStatus(root,policy,{now:()=>at()});
  assert.equal(s.used_tokens,2000);assert.equal(s.reserved_tokens,0);
  assert.equal(s.remaining_tokens,4000);
  assert.equal(git(root,'status','--porcelain'),'');
}));
test('reservas simultáneas consumen capacidad compartida y respetan concurrencia',()=>fixture(({root})=>{
  reserve(root,'run-1',3000);
  reserve(root,'run-2',3000);
  const denied=previewBudgetReservation(root,policy,{runId:'run-3',taskId:'TASK-001',tokens:100,now:()=>at()});
  assert.equal(denied.allowed,false);assert.match(denied.reason,/concurrencia/);
  assert.throws(()=>reserve(root,'run-3',100),/denegada/);
  assert.equal(budgetStatus(root,policy,{now:()=>at()}).remaining_tokens,0);
}));
test('bloquea cap por tokens incluso si hay slots disponibles, sin gastar tokens',()=>fixture(({root})=>{
  reserve(root,'run-1',5900);
  const check=previewBudgetReservation(root,policy,{runId:'run-2',taskId:'TASK-001',tokens:200,now:()=>at()});
  assert.equal(check.allowed,false);assert.match(check.reason,/presupuesto/);
  assert.throws(()=>reserve(root,'run-2',200),/denegada/);
}));
test('telemetría ausente ocupa presupuesto estimado, nunca cero',()=>fixture(({root})=>{
  reserve(root,'run-1',3000);
  const s=settleBudget(root,{runId:'run-1',usage:null,now:()=>at()});
  assert.equal(s.source,'estimated');assert.equal(s.accounted_tokens,3000);
  const status=budgetStatus(root,policy,{now:()=>at()});
  assert.equal(status.estimated_runs_in_window,1);assert.equal(status.remaining_tokens,3000);
}));
test('el exceso real sobre reserva se contabiliza sin afirmar cap duro',()=>fixture(({root})=>{
  reserve(root,'run-1',2000);
  const report=settleBudget(root,{runId:'run-1',usage:{input_tokens:4000,output_tokens:2500},now:()=>at()});
  assert.equal(report.over_reservation,true);assert.equal(report.accounted_tokens,6500);
  assert.equal(budgetStatus(root,policy,{now:()=>at()}).remaining_tokens,0);
  assert.throws(()=>reserve(root,'run-2',100),/denegada/);
}));
test('la ventana libera uso liquidado, pero no reservas huérfanas',()=>fixture(({root})=>{
  reserve(root,'run-1',2000);
  settleBudget(root,{runId:'run-1',usage:null,now:()=>at()});
  const after=budgetStatus(root,policy,{now:()=>at(4)});
  assert.equal(after.remaining_tokens,6000);
  reserve(root,'run-orphan',1000,{now:()=>at(4)});
  const muchLater=budgetStatus(root,policy,{now:()=>at(12)});
  assert.equal(muchLater.reserved_tokens,1000);
  assert.equal(muchLater.remaining_tokens,5000);
}));
test('rechaza run_id duplicado y doble liquidación, y telemetría fraudulenta',()=>fixture(({root})=>{
  reserve(root,'run-1',2000);
  assert.throws(()=>reserve(root,'run-1',2000),/ya registrado/);
  assert.throws(()=>settleBudget(root,{runId:'run-1',usage:{input_tokens:20,output_tokens:0,cached_input_tokens:22}}),/incoherente/);
  assert.throws(()=>settleBudget(root,{runId:'run-1',usage:{input_tokens:0,output_tokens:0}}),/sin consumo/);
  assert.throws(()=>settleBudget(root,{runId:'run-1',usage:{input_tokens:9,output_tokens:2,reasoning_output_tokens:3}}),/incoherente/);
  settleBudget(root,{runId:'run-1',usage:null,now:()=>at()});
  assert.throws(()=>settleBudget(root,{runId:'run-1',usage:null}),/ya liquidada/);
  assert.throws(()=>previewBudgetSettlement(root,'run-1'),/ya liquidada/);
}));
test('ledger corrupto o lock retenido: fail closed, no sobrescribir',()=>fixture(({root})=>{
  const paths=budgetPaths(root);
  fs.mkdirSync(paths.dir);
  fs.writeFileSync(paths.file,'{"schema_version":9,"entries":[]}');
  assert.throws(()=>reserve(root,'run-1'),/estructura ledger inválida/);
  assert.match(fs.readFileSync(paths.file,'utf8'),/schema_version":9/);
  fs.writeFileSync(paths.file,JSON.stringify({schema_version:1,entries:[]}));
  fs.writeFileSync(paths.lock,'owner unknown');
  assert.throws(()=>reserve(root,'run-1'),/bloqueado/);
  assert.equal(fs.readFileSync(paths.lock,'utf8'),'owner unknown');
}));
test('dos worktrees Git enlazados comparten exactamente el mismo ledger',()=>fixture(({root,tmp})=>{
  const wt=path.join(tmp,'linked');
  git(root,'worktree','add','-b','feat/task-one',wt,'main');
  assert.equal(budgetPaths(root).file,budgetPaths(wt).file);
  reserve(root,'run-1',4000);
  const p=previewBudgetReservation(wt,policy,{runId:'run-2',taskId:'TASK-002',tokens:2500,now:()=>at()});
  assert.equal(p.allowed,false);assert.equal(p.remaining_tokens,2000);
  const settled=settleBudget(wt,{runId:'run-1',usage:null,now:()=>at()});
  assert.equal(settled.accounted_tokens,4000);
  assert.equal(budgetStatus(root,policy,{now:()=>at()}).active_runs,0);
}));
test('rechaza contenedor simbólico y nunca lo sustituye',()=>fixture(({root,tmp})=>{
  const p=budgetPaths(root);
  const escape=path.join(tmp,'escape');fs.mkdirSync(escape);
  fs.symlinkSync(escape,p.dir,'dir');
  assert.throws(()=>reserve(root,'run-1'),/inseguro/);
  assert.equal(fs.existsSync(path.join(escape,'ledger.json')),false);
}));
