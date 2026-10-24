import fs from 'node:fs';
import path from 'node:path';
import {loadModelProfiles} from '../routing/router.js';
import {loadBudgetPolicy} from '../budget/manager.js';
import {planScheduledDispatch,executeScheduledDispatch} from './dispatch.js';

const number=(raw,name)=>{
  if(typeof raw!=='string'||!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(Number(raw))) {
    throw new Error('scheduler: --'+name+' requiere entero positivo.');
  }
  return Number(raw);
};
export async function runSchedulerCommand(args) {
  try {
    const [command,taskId,...rest]=args;
    if(command!=='dispatch'||!taskId||taskId.startsWith('-')) {
      throw new Error('Uso: scheduler dispatch TASK-ID --file backlog.json --repo DIR --models modelos.json --policy presupuesto.json --run-id ID --max-total-tokens N --timeout-seconds N [--json] [--execute].');
    }
    const options={json:false,execute:false};
    const seen=new Set();
    for(let i=0;i<rest.length;i++){
      const flag=rest[i];
      if(seen.has(flag))throw new Error('scheduler: opción duplicada '+flag);
      seen.add(flag);
      if(flag==='--json'||flag==='--execute')options[flag.slice(2)]=true;
      else if(['--file','--repo','--models','--policy','--run-id','--max-total-tokens','--timeout-seconds'].includes(flag)){
        if(!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('scheduler: '+flag+' necesita valor.');
        options[flag.slice(2)]=rest[++i];
      } else throw new Error('scheduler: opción desconocida '+flag);
    }
    for(const key of ['file','repo','models','policy','run-id','max-total-tokens','timeout-seconds']){
      if(!options[key])throw new Error('scheduler: falta --'+key+'.');
    }
    const backlog=JSON.parse(fs.readFileSync(path.resolve(options.file),'utf8'));
    const models=loadModelProfiles(JSON.parse(fs.readFileSync(path.resolve(options.models),'utf8')));
    const policy=loadBudgetPolicy(options.policy);
    const input={backlog,models,policy,repoRoot:options.repo,taskId,runId:options['run-id'],
      maxTotalTokens:number(options['max-total-tokens'],'max-total-tokens'),
      timeoutSeconds:number(options['timeout-seconds'],'timeout-seconds')};
    const result=options.execute?await executeScheduledDispatch(input):planScheduledDispatch(input);
    if(options.json)console.log(JSON.stringify(result,null,2));
    else console.log('scheduler '+taskId+': '+(result.status??'DRY-RUN')+
      ' | '+result.model_id+' | '+result.max_total_tokens+' tokens orientativos');
    return options.execute && result.status!=='completed_needs_review'?1:0;
  }catch(error){console.error(error.message);return 1;}
}
