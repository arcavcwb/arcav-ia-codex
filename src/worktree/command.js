import fs from 'node:fs';
import path from 'node:path';
import { validateBacklog } from '../backlog/validate.js';
import { planWorktreeCreate, createTaskWorktree, inspectTaskWorktree,
  planWorktreeRemove, removeTaskWorktree } from './manager.js';

export function runWorktreeCommand(args) {
  try {
    const [command,taskId,...rest]=args;
    if (!['create','status','remove'].includes(command) || !taskId || taskId.startsWith('-')) {
      throw new Error('Uso: worktree create|status|remove TASK-ID [--repo directorio] [--file backlog.json] [--json] [--execute].');
    }
    const flags={repo:process.cwd(),file:null,json:false,execute:false};
    const visited=new Set();
    for(let i=0;i<rest.length;i++) {
      const flag=rest[i];
      if (visited.has(flag)) throw new Error('worktree: opción repetida '+flag);
      visited.add(flag);
      if (flag==='--json') flags.json=true;
      else if (flag==='--execute') flags.execute=true;
      else if (flag==='--repo' || flag==='--file') {
        if (!rest[i+1] || rest[i+1].startsWith('--')) throw new Error(flag+' requiere una ruta.');
        flags[flag.slice(2)]=rest[++i];
      } else throw new Error('worktree: opción desconocida '+flag);
    }
    if (command==='create') {
      if (!flags.file) throw new Error('worktree create exige --file y una tarea ready.');
      const backlog=JSON.parse(fs.readFileSync(path.resolve(flags.file),'utf8'));
      const checked=validateBacklog(backlog);
      if(!checked.valid) throw new Error('Backlog inválido: '+checked.errors.join('; '));
      const task=backlog.tasks.find(t=>t.id===taskId);
      if(!task || task.status !== 'ready' || task.risk==='critical') {
        throw new Error('worktree create: la tarea debe existir, estar ready y no ser crítica.');
      }
    } else {
      if (flags.file) throw new Error('worktree status/remove no admiten --file.');
    }
    if (command==='status' && flags.execute) throw new Error('worktree status no admite --execute.');
    let result;
    if(command==='create') result=flags.execute
      ? createTaskWorktree(flags.repo,taskId) : planWorktreeCreate(flags.repo,taskId);
    else if(command==='status') result=inspectTaskWorktree(flags.repo,taskId);
    else result=flags.execute
      ? removeTaskWorktree(flags.repo,taskId) : planWorktreeRemove(flags.repo,taskId);
    if (flags.json) console.log(JSON.stringify(result,null,2));
    else console.log(command+' '+taskId+': '+(result.execution??(result.exists?'presente':'ausente'))+
      ' | '+(result.target??'')+(result.requires_execute?' (usar --execute para confirmar)':''));
    return 0;
  } catch(error) { console.error(error.message); return 1; }
}
