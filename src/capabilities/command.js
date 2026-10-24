import {planCapabilityRoute,loadCapabilityPolicy} from './policy.js';
import fs from 'node:fs';
import path from 'node:path';

export function runCapabilityCommand(args) {
  try {
    const [op,taskId,...rest]=args;
    if(op!=='route'||!taskId||taskId.startsWith('-')) {
      throw new Error('Uso: capability route TASK-ID --file backlog.json --role frontend --policy policy.json [--json]');
    }
    const opts={json:false},seen=new Set();
    for(let i=0;i<rest.length;i++){
      const flag=rest[i];
      if(seen.has(flag))throw new Error('capability: opción duplicada '+flag);
      seen.add(flag);
      if(flag==='--json')opts.json=true;
      else if(['--file','--role','--policy'].includes(flag)){
        if(!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('capability: '+flag+' requiere valor.');
        opts[flag.slice(2)]=rest[++i];
      }else throw new Error('capability: opción desconocida '+flag);
    }
    for(const k of ['file','role','policy'])if(!opts[k])throw new Error('capability: falta --'+k+'.');
    const backlog=JSON.parse(fs.readFileSync(path.resolve(opts.file),'utf8'));
    const policy=loadCapabilityPolicy(opts.policy);
    const result=planCapabilityRoute(backlog,taskId,opts.role,policy);
    if(opts.json)console.log(JSON.stringify(result,null,2));
    else console.log('DRY-RUN '+taskId+': '+result.role+' -> '+result.preferred.executor+
      ' / '+result.preferred.model_family+' (modelo real pendiente de validar).');
    return 0;
  }catch(error){console.error(error.message);return 1;}
}
