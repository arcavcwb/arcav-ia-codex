import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createTaskWorktree} from '../src/worktree/manager.js';
const cli=path.resolve('bin/cli.js');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(cb) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-scheduler-cli-')),root=path.join(tmp,'repo');
  fs.mkdirSync(root);git(root,'init','-b','main');git(root,'config','user.name','Test');
  git(root,'config','user.email','test@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'base\n');git(root,'add','README.md');git(root,'commit','-m','base');
  createTaskWorktree(root,'TASK-001');
  const task={id:'TASK-001',story_id:'US-001',title:'Validar',description:'Implementar validación',
    acceptance_criteria:['Error si inválido'],dependencies:[],status:'ready',story_points:1,risk:'low',
    complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:0},test_plan:['npm test']};
  const files={};
  files.file=path.join(tmp,'backlog.json');
  files.models=path.join(tmp,'models.json');
  files.policy=path.join(tmp,'policy.json');
  fs.writeFileSync(files.file,JSON.stringify({schema_version:1,epics:[{id:'EP-001',title:'E'}],
    stories:[{id:'US-001',epic_id:'EP-001',title:'S',acceptance_criteria:['Error si inválido']}],tasks:[task]}));
  fs.writeFileSync(files.models,JSON.stringify({luna:'codex-test',sol:'codex-mid',astra:'codex-high'}));
  fs.writeFileSync(files.policy,JSON.stringify({schema_version:1,provider:'codex',window_hours:24,
    token_budget:10000,threshold_pct:60,max_in_flight:1}));
  const base=['dispatch','TASK-001','--repo',root,'--file',files.file,
    '--models',files.models,'--policy',files.policy,'--run-id','attempt-01',
    '--max-total-tokens','3000','--timeout-seconds','60'];
  const call=(...args)=>spawnSync(process.execPath,[cli,'scheduler',...args],{cwd:root,encoding:'utf8'});
  try {cb({tmp,root,files,base,call});}finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
test('CLI scheduler dry-run no invoca Codex ni escribe ledger',()=>fixture(({root,base,call})=>{
  const r=call(...base,'--json');
  assert.equal(r.status,0,r.stderr);
  const doc=JSON.parse(r.stdout);
  assert.equal(doc.execution,'dry-run');assert.equal(doc.admission.allowed,true);
  assert.equal(doc.model_id,'codex-test');assert.equal(doc.prompt,undefined);
  assert.equal(fs.existsSync(path.join(root,'.git','arcav-budget')),false);
}));
test('CLI scheduler rechaza flags malformados, incompletos y duplicados',()=>fixture(({base,call})=>{
  assert.equal(call(...base.slice(0,-2)).status,1);
  assert.equal(call(...base,'--unexpected').status,1);
  assert.equal(call(...base,'--run-id','again').status,1);
  const invalid=base.map(x=>x==='3000'?'not-a-number':x);
  assert.equal(call(...invalid).status,1);
}));
test('CLI no inicia Codex sin worktree limpio, incluso con --execute',()=>fixture(({root,base,call})=>{
  const wt=path.join(root+'.worktrees','TASK-001');
  fs.writeFileSync(path.join(wt,'dirty.txt'),'untracked');
  const r=call(...base,'--execute','--json');
  assert.equal(r.status,1);
  assert.match(r.stderr,/cambios pendientes/);
  assert.equal(fs.existsSync(path.join(root,'.git','arcav-budget')),false);
}));
