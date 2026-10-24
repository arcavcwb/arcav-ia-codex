import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const TASK_ID = /^TASK-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const execGit = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:1024*1024,
}).trim();

function entry(p) {
  try { return fs.lstatSync(p); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function identity(repoRoot, taskId) {
  if (!TASK_ID.test(taskId ?? '')) throw new Error('worktree: ID inválido; use TASK-001.');
  const root = fs.realpathSync(repoRoot);
  if (!fs.statSync(root).isDirectory() ||
      fs.realpathSync(execGit(root,'rev-parse','--show-toplevel')) !== root) {
    throw new Error('worktree: --repo debe ser la raíz de un repositorio Git.');
  }
  if (execGit(root,'rev-parse','--is-bare-repository') !== 'false') {
    throw new Error('worktree: no admite repositorios bare.');
  }
  const parent = root + '.worktrees';
  const target = path.join(parent, taskId);
  const branch = 'feat/' + taskId;
  const mainSha = execGit(root,'rev-parse','--verify','refs/heads/main^{commit}');
  const parentEntry=entry(parent);
  if (parentEntry && (parentEntry.isSymbolicLink() || !parentEntry.isDirectory())) {
    throw new Error('worktree: directorio contenedor inválido o simbólico.');
  }
  const targetEntry=entry(target);
  if (targetEntry?.isSymbolicLink()) throw new Error('worktree: destino simbólico prohibido.');
  return {root,parent,target,branch,task_id:taskId,base_branch:'main',base_sha:mainSha};
}
function registered(root, target) {
  const rows=execGit(root,'worktree','list','--porcelain').split('\n\n');
  return rows.some(row => row.split('\n').includes('worktree '+target));
}
function existingRef(root, branch) {
  const p=spawnSync('git',['show-ref','--verify','--quiet','refs/heads/'+branch],{
    cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],
  });
  if (p.error || ![0,1].includes(p.status)) throw new Error('worktree: no se pudo comprobar la rama.');
  return p.status === 0;
}
function onMain(root) {
  if (execGit(root,'symbolic-ref','--quiet','--short','HEAD') !== 'main') {
    throw new Error('worktree: creación/eliminación exige el checkout principal en main.');
  }
}
export function planWorktreeCreate(repoRoot, taskId) {
  const spec=identity(repoRoot, taskId);
  onMain(spec.root);
  if (entry(spec.target)) throw new Error('worktree: destino ya existe; use status.');
  if (existingRef(spec.root,spec.branch)) throw new Error('worktree: rama ya existe; no se reutiliza silenciosamente.');
  if (registered(spec.root,spec.target)) throw new Error('worktree: destino ya registrado.');
  return {execution:'dry-run',operation:'create',...spec,requires_execute:true};
}
export function createTaskWorktree(repoRoot, taskId) {
  const plan=planWorktreeCreate(repoRoot,taskId);
  if (!entry(plan.parent)) fs.mkdirSync(plan.parent,{recursive:false});
  // Revalidate the directory after mkdir; no custom paths or branch names are accepted.
  if (entry(plan.parent)?.isSymbolicLink() || entry(plan.target)) {
    throw new Error('worktree: ruta insegura o destino ocupado.');
  }
  execGit(plan.root,'worktree','add','-b',plan.branch,'--',plan.target,'main');
  const actual=inspectTaskWorktree(repoRoot,taskId);
  if (!actual.exists || actual.head_sha !== plan.base_sha) {
    throw new Error('worktree: resultado inesperado; revisar manualmente.');
  }
  return {operation:'create',execution:'executed',...actual};
}
export function inspectTaskWorktree(repoRoot, taskId) {
  const spec=identity(repoRoot,taskId);
  const st=entry(spec.target);
  if (!st) {
    if (registered(spec.root,spec.target)) throw new Error('worktree: registro huérfano; requiere intervención.');
    return {operation:'status',...spec,exists:false};
  }
  if (!st.isDirectory() || !registered(spec.root,spec.target)) {
    throw new Error('worktree: ruta ocupada sin un worktree registrado.');
  }
  const top=fs.realpathSync(execGit(spec.target,'rev-parse','--show-toplevel'));
  if (top !== fs.realpathSync(spec.target)) throw new Error('worktree: raíz inesperada.');
  const branch=execGit(spec.target,'symbolic-ref','--quiet','--short','HEAD');
  if (branch !== spec.branch) throw new Error('worktree: rama distinta de la esperada.');
  const head=execGit(spec.target,'rev-parse','HEAD');
  const changes=execGit(spec.target,'status','--porcelain','--untracked-files=all');
  return {operation:'status',...spec,exists:true,head_sha:head,clean:changes.length===0,
    changed_entries:changes ? changes.split('\n').length : 0};
}
export function planWorktreeRemove(repoRoot,taskId) {
  const info=inspectTaskWorktree(repoRoot,taskId);
  if (!info.exists) throw new Error('worktree: destino inexistente.');
  onMain(info.root);
  if (!info.clean) throw new Error('worktree: tiene cambios o archivos sin registrar; no se elimina.');
  const merged=spawnSync('git',['merge-base','--is-ancestor',info.branch,'main'],{
    cwd:info.root,encoding:'utf8',stdio:['ignore','pipe','pipe'],
  });
  if (merged.error || ![0,1].includes(merged.status)) {
    throw new Error('worktree: no se pudo verificar la integración.');
  }
  if (merged.status !== 0) throw new Error('worktree: commits sin integrar en main; no se elimina.');
  return {operation:'remove',execution:'dry-run',...info,requires_execute:true,branch_preserved:true};
}
export function removeTaskWorktree(repoRoot,taskId) {
  const plan=planWorktreeRemove(repoRoot,taskId);
  // Recheck immediately before Git performs its own clean/unmerged safety checks.
  planWorktreeRemove(repoRoot,taskId);
  execGit(plan.root,'worktree','remove','--',plan.target);
  return {operation:'remove',execution:'executed',task_id:taskId,
    target:plan.target,branch:plan.branch,branch_preserved:true};
}
