import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createTaskWorktree} from '../src/worktree/manager.js';
const cli=path.resolve('bin/cli.js');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
test('coord CLI dry-run, publicación, aprobación y mensajes; sin Codex',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-coord-cli-')),root=path.join(tmp,'repo');
  fs.mkdirSync(root);git(root,'init','-b','main');
  git(root,'config','user.name','QA');git(root,'config','user.email','qa@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'base\n');git(root,'add','.');git(root,'commit','-m','base');
  const wt=createTaskWorktree(root,'TASK-001').target;
  const file='docs/contracts/customer-search.json';
  fs.mkdirSync(path.join(wt,'docs','contracts'),{recursive:true});
  fs.writeFileSync(path.join(wt,file),JSON.stringify({schema_version:1,id:'SearchAPI',
    version:1,producer_task_id:'TASK-001',consumer_task_ids:['TASK-002'],
    kind:'api',summary:'Una API de búsqueda de clientes',definition:{method:'GET',path:'/search'}})+'\n');
  git(wt,'add','.');git(wt,'commit','-m','contract');
  const task=id=>({id,story_id:'US-001',title:'test '+id,description:'Test',
    status:'draft',risk:'low',story_points:1,dependencies:[],
    acceptance_criteria:['Válido'],test_plan:['npm test'],
    complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:0}});
  const backlog=path.join(tmp,'backlog.json');
  fs.writeFileSync(backlog,JSON.stringify({schema_version:1,
    epics:[{id:'EP-001',title:'E'}],stories:[{id:'US-001',epic_id:'EP-001',
    title:'US',acceptance_criteria:['Válido']}],tasks:[task('TASK-001'),task('TASK-002')]}));
  const run=(...args)=>spawnSync(process.execPath,[cli,'coord',...args],{cwd:root,encoding:'utf8'});
  try{
    const state=path.join(root,'.git','arcav-coordination');
    let r=run('contract','publish','TASK-001','--repo',root,'--file',backlog,'--path',file,'--json');
    assert.equal(r.status,0,r.stderr);assert.equal(fs.existsSync(state),false);
    r=run('contract','publish','TASK-001','--repo',root,'--file',backlog,'--path',file,'--execute','--from','TASK-002');
    assert.equal(r.status,1);assert.equal(fs.existsSync(state),false);
    r=run('contract','publish','TASK-001','--repo',root,'--file',backlog,'--path',file,'--execute','--json');
    assert.equal(r.status,0,r.stderr);
    r=run('contract','approve','SearchAPI','--repo',root,'--version','1','--execute','--json');
    assert.equal(r.status,0,r.stderr);
    r=run('request','open','TASK-002','--repo',root,'--file',backlog,'--to','TASK-001',
      '--contract','SearchAPI','--question','¿Qué URL se utiliza?','--execute','--json');
    assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).id,'REQ-000001');
    r=run('request','answer','REQ-000001','--repo',root,'--from','TASK-001',
      '--text','GET /search','--execute','--json');
    assert.equal(r.status,0,r.stderr);
    r=run('inbox','show','TASK-002','--repo',root,'--json');
    assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).requests[0].answer,'GET /search');
    assert.equal(git(root,'status','--porcelain'),'');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
