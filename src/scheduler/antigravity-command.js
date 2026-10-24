import fs from 'node:fs';
import path from 'node:path';
import {loadCapabilityPolicy} from '../capabilities/policy.js';
import {loadBudgetPolicy} from '../budget/manager.js';
import {planAntigravityDispatch,executeAntigravityDispatch} from './antigravity.js';

const asInt=(s,name)=>{
  if(typeof s!=='string'||!/^[0-9]+$/.test(s)||!Number.isSafeInteger(Number(s))) {
    throw new Error('antigravity: '+name+' requiere entero.');
  }
  return Number(s);
};
export async function runAntigravityCommand(args){
  try{
    const [op,taskId,...rest]=args;
    if(op!=='dispatch'||!taskId||taskId.startsWith('-')){
      throw new Error('Uso: antigravity dispatch TASK-ID --repo . --file backlog.json --capabilities policy.json --budget budget.json --model SLUG --run-id ID --max-total-tokens N --timeout-seconds N [--json] [--execute]');
    }
    const opts={json:false,execute:false},seen=new Set();
    for(let i=0;i<rest.length;i++){
      const k=rest[i];
      if(seen.has(k))throw new Error('antigravity: opción repetida '+k);
      seen.add(k);
      if(k==='--execute'||k==='--json')opts[k.slice(2)]=true;
      else if(['--repo','--file','--capabilities','--budget','--model','--run-id','--max-total-tokens','--timeout-seconds'].includes(k)){
        if(!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('antigravity: falta valor '+k);
        opts[k.slice(2)]=rest[++i];
      }else throw new Error('antigravity: opción no permitida '+k);
    }
    for(const k of ['repo','file','capabilities','budget','model','run-id','max-total-tokens','timeout-seconds']){
      if(!opts[k])throw new Error('antigravity: falta --'+k);
    }
    const input={repoRoot:opts.repo,taskId,
      backlog:JSON.parse(fs.readFileSync(path.resolve(opts.file),'utf8')),
      capabilities:loadCapabilityPolicy(opts.capabilities),
      budgetPolicy:loadBudgetPolicy(opts.budget),modelSlug:opts.model,runId:opts['run-id'],
      maxTotalTokens:asInt(opts['max-total-tokens'],'max-total-tokens'),
      timeoutSeconds:asInt(opts['timeout-seconds'],'timeout-seconds')};
    const result=opts.execute?await executeAntigravityDispatch(input):planAntigravityDispatch(input);
    if(opts.json)console.log(JSON.stringify(result,null,2));
    else console.log('antigravity '+taskId+': '+(result.status??'DRY-RUN')+
      ' | '+result.model_id+' | '+(result.settlement?.accounted_tokens??result.max_total_tokens)+' tokens');
    return opts.execute&&result.status!=='completed_needs_review'?1:0;
  }catch(e){console.error(e.message);return 1;}
}
