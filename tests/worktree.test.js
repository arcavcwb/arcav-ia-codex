import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {planWorktreeCreate,createTaskWorktree,inspectTaskWorktree,
  planWorktreeRemove,removeTaskWorktree} from '../src/worktree/manager.js';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function repo(run) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-worktree-'));
  const root=path.join(base,'repo');
  fs.mkdirSync(root);
  git(root,'init','-b','main');
  git(root,'config','user.name','Test');
  git(root,'config','user.email','test@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'test\n');
  git(root,'add','README.md');
  git(root,'commit','-m','base');
  try {run(root,base);}
  finally {fs.rmSync(base,{force:true,recursive:true});}
}
test('dry-run no modifica el repositorio ni crea directorios',()=>repo(root=>{
  const p=planWorktreeCreate(root,'TASK-001');
  assert.equal(p.execution,'dry-run');
  assert.equal(p.branch,'feat/TASK-001');
  assert.equal(fs.existsSync(p.parent),false);
  assert.equal(git(root,'branch','--show-current'),'main');
}));
test('crea directorio aislado y status informa rama y SHA correctos',()=>repo(root=>{
  const x=createTaskWorktree(root,'TASK-001');
  assert.equal(x.exists,true);
  assert.equal(x.clean,true);
  assert.equal(x.head_sha,x.base_sha);
  assert.equal(git(x.target,'branch','--show-current'),'feat/TASK-001');
  assert.equal(git(root,'branch','--show-current'),'main');
  assert.equal(inspectTaskWorktree(root,'TASK-001').exists,true);
  assert.throws(()=>planWorktreeCreate(root,'TASK-001'),/ya existe/);
}));
test('no elimina worktree con cambios rastreados ni sin rastrear',()=>repo(root=>{
  const x=createTaskWorktree(root,'TASK-001');
  fs.writeFileSync(path.join(x.target,'nuevo.txt'),'sin seguimiento');
  assert.equal(inspectTaskWorktree(root,'TASK-001').clean,false);
  assert.throws(()=>planWorktreeRemove(root,'TASK-001'),/cambios/);
  assert.equal(fs.existsSync(x.target),true);
  fs.rmSync(path.join(x.target,'nuevo.txt'));
  fs.writeFileSync(path.join(x.target,'README.md'),'cambiado\n');
  assert.throws(()=>planWorktreeRemove(root,'TASK-001'),/cambios/);
}));
test('rechaza quitar rama con commits aún no integrados',()=>repo(root=>{
  const x=createTaskWorktree(root,'TASK-001');
  fs.writeFileSync(path.join(x.target,'feature.txt'),'commit aislado\n');
  git(x.target,'add','feature.txt');
  git(x.target,'commit','-m','feature');
  assert.equal(inspectTaskWorktree(root,'TASK-001').clean,true);
  assert.throws(()=>planWorktreeRemove(root,'TASK-001'),/sin integrar/);
  assert.equal(fs.existsSync(x.target),true);
}));
test('remove explícito solo cuando limpio e integrado; conserva rama',()=>repo(root=>{
  const x=createTaskWorktree(root,'TASK-001');
  const p=planWorktreeRemove(root,'TASK-001');
  assert.equal(p.execution,'dry-run');
  assert.equal(fs.existsSync(x.target),true);
  const removed=removeTaskWorktree(root,'TASK-001');
  assert.equal(removed.branch_preserved,true);
  assert.equal(fs.existsSync(x.target),false);
  assert.equal(inspectTaskWorktree(root,'TASK-001').exists,false);
  assert.equal(git(root,'show-ref','--verify','refs/heads/feat/TASK-001').length>0,true);
  assert.throws(()=>planWorktreeCreate(root,'TASK-001'),/rama ya existe/);
}));
test('rechaza IDs/rutas inválidas, directorio simbólico y checkout fuera de main',()=>repo(root=>{
  assert.throws(()=>planWorktreeCreate(root,'../../etc'),/ID inválido/);
  assert.throws(()=>planWorktreeCreate(root,'TASK--001'),/ID inválido/);
  const parent=root+'.worktrees';
  fs.symlinkSync(root,parent,'dir');
  assert.throws(()=>planWorktreeCreate(root,'TASK-001'),/simbólico/);
  fs.unlinkSync(parent);
  git(root,'switch','-c','feature');
  assert.throws(()=>planWorktreeCreate(root,'TASK-001'),/en main/);
}));
test('no permite usar una ruta existente ni un worktree no registrado',()=>repo(root=>{
  const p=planWorktreeCreate(root,'TASK-001');
  fs.mkdirSync(p.parent);
  fs.mkdirSync(p.target);
  assert.throws(()=>planWorktreeCreate(root,'TASK-001'),/ya existe/);
  assert.throws(()=>inspectTaskWorktree(root,'TASK-001'),/sin un worktree registrado/);
}));
