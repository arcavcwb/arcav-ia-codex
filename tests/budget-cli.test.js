import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';

const cli=path.resolve('bin/cli.js');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const config={schema_version:1,provider:'codex',window_hours:3,token_budget:10000,threshold_pct:60,max_in_flight:1};
function fixture(testBody){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-budget-cli-')),root=path.join(tmp,'repo');
  fs.mkdirSync(root);git(root,'init','-b','main');
  git(root,'config','user.name','QA');git(root,'config','user.email','qa@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'base');
  git(root,'add','README.md');git(root,'commit','-m','base');
  const policy=path.join(tmp,'policy.json');fs.writeFileSync(policy,JSON.stringify(config));
  const run=(...args)=>spawnSync(process.execPath,[cli,'budget',...args],{cwd:root,encoding:'utf8'});
  try{testBody({root,policy,run})}finally{fs.rmSync(tmp,{force:true,recursive:true})}
}
test('CLI dry-run/status no crea ledger; reserve/settle exige --execute',()=>fixture(({root,policy,run})=>{
  let res=run('status','--policy',policy,'--json');
  assert.equal(res.status,0,res.stderr);assert.equal(JSON.parse(res.stdout).remaining_tokens,6000);
  res=run('reserve','--policy',policy,'--run','job-1','--task','TASK-001','--tokens','3000','--json');
  assert.equal(res.status,0,res.stderr);assert.equal(JSON.parse(res.stdout).execution,'dry-run');
  assert.equal(fs.existsSync(path.join(root,'.git','arcav-budget')),false);
  res=run('reserve','--policy',policy,'--run','job-1','--task','TASK-001','--tokens','3000','--execute','--json');
  assert.equal(res.status,0,res.stderr);assert.equal(JSON.parse(res.stdout).reserved_tokens,3000);
  res=run('settle','--policy',policy,'--run','job-1','--input','1200','--output','400','--cached','800','--json');
  assert.equal(res.status,0,res.stderr);assert.equal(JSON.parse(res.stdout).execution,'dry-run');
  res=run('settle','--policy',policy,'--run','job-1','--input','1200','--output','400','--cached','800','--execute','--json');
  assert.equal(res.status,0,res.stderr);assert.equal(JSON.parse(res.stdout).accounted_tokens,1600);
  res=run('status','--policy',policy,'--json');
  assert.equal(JSON.parse(res.stdout).used_tokens,1600);
  assert.equal(git(root,'status','--porcelain').trim(),'');
}));
test('CLI rechaza comandos inválidos, input falso, opciones cruzadas y fallos de presupuesto',()=>fixture(({root,policy,run})=>{
  assert.equal(run('reserve','--run','x','--task','TASK-001','--tokens','500').status,1);
  assert.equal(run('status','--policy',policy,'--execute').status,1);
  assert.equal(run('reserve','--policy',policy,'--run','x','--task','TASK-001','--tokens','nan').status,1);
  assert.equal(run('reserve','--policy',policy,'--run','x','--task','TASK-001','--tokens','100','--file','foo').status,1);
  assert.equal(run('settle','--policy',policy,'--run','x','--estimated','--input','1').status,1);
  const r=run('reserve','--policy',policy,'--run','first','--task','TASK-001','--tokens','6000','--execute');
  assert.equal(r.status,0,r.stderr);
  const denied=run('reserve','--policy',policy,'--run','second','--task','TASK-001','--tokens','100','--execute');
  assert.equal(denied.status,1);assert.match(denied.stderr,/denegada/);
  const settled=run('settle','--policy',policy,'--run','first','--estimated','--execute');
  assert.equal(settled.status,0,settled.stderr);
  const status=run('status','--policy',policy,'--json');
  assert.equal(JSON.parse(status.stdout).estimated_runs_in_window,1);
}));
