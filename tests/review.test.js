import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { prepareIndependentReview } from '../src/execution/review.js';

const oneTask = () => ({
  id:'TASK-001',story_id:'US-001',title:'Implementar función',description:'Validar número',
  acceptance_criteria:['Un número inválido genera error'],test_plan:['npm test'],
  status:'ready',risk:'low',dependencies:[],story_points:1,
  complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:1},
});
const backlog = () => ({schema_version:1,epics:[{id:'EP-001',title:'Calidad'}],stories:[{id:'US-001',epic_id:'EP-001',title:'Pruebas',acceptance_criteria:['Se valida entrada']}],tasks:[oneTask()]});
const git = (dir,...args) => execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
function fixture(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-review-'));
  try {
    git(dir,'init','-b','main');git(dir,'config','user.name','Test');git(dir,'config','user.email','test@example.com');
    fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({private:true,scripts:{test:'node smoke.cjs'}}));
    fs.writeFileSync(path.join(dir,'smoke.cjs'),"process.exit(0);\n");
    fs.writeFileSync(path.join(dir,'source.js'),'export const number = 1;\n');
    fs.writeFileSync(path.join(dir,'backlog.json'),JSON.stringify(backlog()));
    git(dir,'add','.');git(dir,'commit','-m','baseline');git(dir,'switch','-c','feat/review');
    fs.writeFileSync(path.join(dir,'source.js'),'export const number = 2;\n');
    return fn(dir);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('handoff sin opt-in no ejecuta npm y no afirma revisión completada',()=>fixture(dir=>{
  const p=prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir});
  assert.equal(p.status,'blocked_awaiting_qa');
  assert.equal(p.qa.tests.executed,false);
  assert.equal(p.diff.included,false);
  assert.equal(p.review_contract.independent_review_completed,false);
  assert.equal(p.review_contract.merge_approved,false);
}));

test('tests explícitos generan handoff sin historial de implementador',()=>fixture(dir=>{
  const p=prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,runTests:true,models:{luna:'small',sol:'medium',astra:'large'}});
  assert.equal(p.status,'ready_for_independent_review');
  assert.equal(p.qa.checks.tests_passed,true);
  assert.ok(['luna','sol','astra'].includes(p.reviewer.tier));
  assert.equal(p.review_contract.implementer_conversation_included,false);
  assert.equal(p.review_contract.tdd_red_proven,false);
  assert.equal(p.review_contract.merge_approved,false);
  assert.deepEqual(p.qa.changed_files,['source.js']);
  assert.equal(p.diff.content,undefined);
}));

test('difusión de diff es opcional, limitada y coincide SHA del QA',()=>fixture(dir=>{
  const p=prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,runTests:true,includeDiff:true});
  assert.equal(p.diff.included,true);
  assert.match(p.diff.content,/number = 2/);
  assert.equal(p.diff.sha256,p.qa.diff_sha256);
  assert.ok(p.diff.bytes>0);
  assert.throws(()=>prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,runTests:true,includeDiff:true,maxReviewBytes:16}),/maxReviewBytes/);
}));

test('no publica diff cuando falla QA',()=>fixture(dir=>{
  fs.writeFileSync(path.join(dir,'smoke.cjs'),"process.exit(2);\n");
  const p=prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,runTests:true,includeDiff:true});
  assert.equal(p.status,'blocked_awaiting_qa');
  assert.equal(p.diff.included,false);
}));

test('untracked y whitespace mantienen revisión bloqueada',()=>fixture(dir=>{
  fs.writeFileSync(path.join(dir,'untracked.js'),'let x = 1;');
  let p=prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,runTests:true,includeDiff:true});
  assert.equal(p.status,'blocked_awaiting_qa');
  assert.equal(p.diff.included,false);
  fs.unlinkSync(path.join(dir,'untracked.js'));
  fs.writeFileSync(path.join(dir,'source.js'),'export const number = 2;  \n');
  p=prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,runTests:true});
  assert.equal(p.qa.checks.whitespace_clean,false);
  assert.equal(p.status,'blocked_awaiting_qa');
}));

test('sin diff, riesgo crítico y rama main no generan handoff aprobado',()=>fixture(dir=>{
  fs.writeFileSync(path.join(dir,'source.js'),'export const number = 1;\n');
  const noDiff=prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,runTests:true});
  assert.equal(noDiff.status,'blocked_awaiting_qa');
  fs.writeFileSync(path.join(dir,'source.js'),'export const number = 2;\n');
  const critical=backlog();critical.tasks[0].risk='critical';
  assert.throws(()=>prepareIndependentReview(critical,'TASK-001',{repoRoot:dir}),/crítico/);
  git(dir,'switch','main');
  assert.throws(()=>prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir}),/rama de feature/);
}));

test('nunca ejecuta Codex y rechaza parámetros inválidos',()=>fixture(dir=>{
  assert.throws(()=>prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,includeDiff:'yes'}),/boolean/);
  assert.throws(()=>prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,maxReviewBytes:200000}),/maxReviewBytes/);
  assert.throws(()=>prepareIndependentReview(backlog(),'TASK-001',{repoRoot:dir,timeoutSeconds:0}),/timeoutSeconds/);
}));

test('CLI task review es dry-run por defecto, y ejecuta QA con opt-in',()=>fixture(dir=>{
  const mod = new URL('../src/backlog/command.js', import.meta.url).href;
  const expr = `import {runPlanningCommand} from ${JSON.stringify(mod)};process.exit(await runPlanningCommand(process.argv.slice(1)));`;
  const file=path.join(dir,'backlog.json');
  const invoke=(...flags)=>spawnSync(process.execPath,['--input-type=module','-e',expr,'task','review','TASK-001','--file',file,'--repo',dir,'--json',...flags],{cwd:dir,encoding:'utf8'});
  let res=invoke();assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).status,'blocked_awaiting_qa');
  res=invoke('--run-tests','--include-diff');assert.equal(res.status,0,res.stderr);
  assert.equal(JSON.parse(res.stdout).diff.included,true);
  res=invoke('--max-review-bytes','7000');assert.equal(res.status,1);
  assert.match(res.stderr,/exige --include-diff/);
  res=invoke('--execute');assert.equal(res.status,1);
}));
