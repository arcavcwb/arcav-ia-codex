import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const cli=path.resolve('bin/cli.js');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const task={id:'TASK-001',story_id:'US-001',title:'Demo',description:'Worktree',acceptance_criteria:['DoD'],
  dependencies:[],status:'ready',story_points:1,risk:'low',complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:0},test_plan:['npm test']};
function fixture(callback) {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-worktree-cli-')),root=path.join(base,'repo');
 fs.mkdirSync(root); git(root,'init','-b','main');
 git(root,'config','user.name','Test');git(root,'config','user.email','test@example.invalid');
 fs.writeFileSync(path.join(root,'README.md'),'source');
 git(root,'add','.');git(root,'commit','-m','base');
 const file=path.join(base,'tasks.json');
 fs.writeFileSync(file,JSON.stringify({schema_version:1,epics:[{id:'EP-001',title:'E'}],
 stories:[{id:'US-001',epic_id:'EP-001',title:'S',acceptance_criteria:['DoD']}],tasks:[task]}));
 const run=(...args)=>spawnSync(process.execPath,[cli,'worktree',...args],{cwd:root,encoding:'utf8'});
 try {callback({root,file,run});} finally {fs.rmSync(base,{recursive:true,force:true});}
}
test('CLI: plan, creación explícita, status y remoción segura',()=>fixture(({root,file,run})=>{
 let result=run('create','TASK-001','--file',file,'--json');
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).execution,'dry-run');
 assert.equal(fs.existsSync(root+'.worktrees'),false);
 result=run('create','TASK-001','--file',file,'--execute','--json');
 assert.equal(result.status,0,result.stderr);
 const created=JSON.parse(result.stdout);
 assert.equal(created.exists,true);
 result=run('status','TASK-001','--json');
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).clean,true);
 result=run('remove','TASK-001','--json');
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).execution,'dry-run');
 assert.equal(fs.existsSync(created.target),true);
 result=run('remove','TASK-001','--execute','--json');
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.existsSync(created.target),false);
 assert.equal(git(root,'branch','--list','feat/TASK-001').includes('feat/TASK-001'),true);
}));
test('CLI: rechaza backlog draft, critical y opciones no permitidas',()=>fixture(({file,run})=>{
 let result=run('create','TASK-001','--file',file,'--execute','--json');
 assert.equal(result.status,0,result.stderr);
 assert.equal(run('status','TASK-001','--execute').status,1);
 assert.equal(run('remove','TASK-001','--file',file).status,1);
 assert.equal(run('create','TASK-001','--file',file).status,1);
 result=run('remove','TASK-001','--execute');
 assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 data.tasks[0].status='draft';fs.writeFileSync(file,JSON.stringify(data));
 assert.equal(run('create','TASK-002','--file',file).status,1);
 assert.equal(run('create','TASK-001','--file',file).status,1);
 data.tasks[0].status='ready';data.tasks[0].risk='critical';
 fs.writeFileSync(file,JSON.stringify(data));
 assert.equal(run('create','TASK-001','--file',file).status,1);
}));
