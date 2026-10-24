import {loadBudgetPolicy,budgetStatus,previewBudgetReservation,
  reserveBudget,previewBudgetSettlement,settleBudget} from './manager.js';

const numeric=(str,name)=>{
  if(typeof str!=='string'||!/^\d+$/.test(str)||!Number.isSafeInteger(Number(str))) {
    throw new Error('budget: --'+name+' requiere entero no negativo.');
  }
  return Number(str);
};
export function runBudgetCommand(args) {
  try {
    const [command,...rest]=args;
    if (!['status','reserve','settle'].includes(command)) {
      throw new Error('Uso: budget status|reserve|settle --policy archivo [--repo .] [opciones] [--json] [--execute].');
    }
    const opts={repo:process.cwd(),json:false,execute:false,estimated:false,kind:'implementation'};
    const seen=new Set();
    for(let i=0;i<rest.length;i++) {
      const option=rest[i];
      if(seen.has(option))throw new Error('budget: opción repetida '+option);
      seen.add(option);
      if(['--json','--execute','--estimated'].includes(option))opts[option.slice(2)]=true;
      else if(['--policy','--repo','--run','--task','--tokens','--kind','--input','--output','--cached','--reasoning'].includes(option)){
        if(!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('budget: '+option+' necesita valor.');
        opts[option.slice(2)]=rest[++i];
      }else throw new Error('budget: opción desconocida '+option);
    }
    const allowed=command==='status'?['repo','policy','json']:
      command==='reserve'?['repo','policy','json','execute','run','task','tokens','kind']:
      ['repo','policy','json','execute','run','estimated','input','output','cached','reasoning'];
    for(const k of Object.keys(opts)) {
      if(!allowed.includes(k) && opts[k] !== false && opts[k]!=='implementation') {
        throw new Error('budget: opción '+k+' no admitida para '+command+'.');
      }
    }
    const policy=loadBudgetPolicy(opts.policy);
    let result;
    if(command==='status') result=budgetStatus(opts.repo,policy);
    else if(command==='reserve') {
      const data={runId:opts.run,taskId:opts.task,tokens:numeric(opts.tokens,'tokens'),kind:opts.kind};
      result=opts.execute?reserveBudget(opts.repo,policy,data):previewBudgetReservation(opts.repo,policy,data);
    } else {
      if (opts.estimated && [opts.input,opts.output,opts.cached,opts.reasoning].some(x=>x!==undefined)) {
        throw new Error('budget: --estimated no se combina con telemetría.');
      }
      if (!opts.estimated && (opts.input===undefined || opts.output===undefined)) {
        throw new Error('budget: --input y --output obligatorios, o --estimated.');
      }
      const usage=opts.estimated?null:{
        input_tokens:numeric(opts.input,'input'),output_tokens:numeric(opts.output,'output'),
        cached_input_tokens:opts.cached===undefined?0:numeric(opts.cached,'cached'),
        reasoning_output_tokens:opts.reasoning===undefined?0:numeric(opts.reasoning,'reasoning'),
      };
      result=opts.execute?settleBudget(opts.repo,{runId:opts.run,usage}):
        {...previewBudgetSettlement(opts.repo,opts.run),source:usage?'reported':'estimated'};
    }
    if(opts.json)console.log(JSON.stringify(result,null,2));
    else console.log('budget '+command+': '+(result.execution??'status')+
      ' | '+(result.remaining_tokens??result.accounted_tokens??result.reserved_tokens)+' tokens');
    return 0;
  }catch(error){console.error(error.message);return 1;}
}
