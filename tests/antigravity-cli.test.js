import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createTaskWorktree} from '../src/worktree/manager.js';
const cli=path.resolve('bin/cli.js');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
test('CLI antigravity dry-run y rechazo flags peligrosos, sin modelo real',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-agy-cli-'));
  try{
    const repo=path.join(tmp,'repo');fs.mkdirSync(repo);
    git(repo,'init','-b','main');git(repo,'config','user.name','QA');git(repo,'config','user.email','qa@example.invalid');
    fs.writeFileSync(path.join(repo,'README.md'),'x\n');git(repo,'add','.');git(repo,'commit','-m','init');
    createTaskWorktree(repo,'TASK-001');
    const backlog=JSON.parse(fs.readFileSync(new URL('../docs/examples/backlog.example.json',import.meta.url),'utf8'));
    backlog.tasks[0].status='ready';
    backlog.tasks[0].dependencies=[];
    backlog.tasks=backlog.tasks.slice(0,1);
    const file=path.join(tmp,'tasks.json');fs.writeFileSync(file,JSON.stringify(backlog));
    const cap=path.resolve('docs/examples/capability-policy.json');
    const budget=path.resolve('docs/examples/budget-policy.antigravity.json');
    const base=['dispatch','TASK-001','--repo',repo,'--file',file,
      '--capabilities',cap,'--budget',budget,'--model','claude-sonnet-local-test',
      '--run-id','agy-cli-001','--max-total-tokens','1200','--timeout-seconds','30'];
    const cmd=(...a)=>spawnSync(process.execPath,[cli,'antigravity',...a],{
      cwd:repo,encoding:'utf8',shell:false});
    let r=cmd(...base,'--json');
    assert.equal(r.status,0,r.stderr);
    const data=JSON.parse(r.stdout);
    assert.equal(data.provider,'antigravity');
    assert.equal(data.execution,'dry-run');
    assert.equal(data.model_checked,false);
    assert.equal(fs.existsSync(path.join(repo,'.git','arcav-budget')),false);
    assert.equal(cmd(...base,'--dangerously-skip-permissions').status,1);
    assert.equal(cmd(...base,'--model','another-model').status,1);
    assert.equal(cmd(...base.slice(0,-2)).status,1);
    assert.equal(fs.existsSync(path.join(repo,'.git','arcav-budget')),false);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
