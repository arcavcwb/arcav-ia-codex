import fs from 'node:fs';
import path from 'node:path';
import {previewContractPublish,publishContract,approveContract,showContract,
  listContracts,openRequest,answerRequest,inbox} from './manager.js';

const number=value=>{
  if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value)||
    !Number.isSafeInteger(Number(value)))throw new Error('coord: --version debe ser entero positivo.');
  return Number(value);
};
function options(args) {
  const result={repo:process.cwd(),json:false,execute:false},seen=new Set();
  for(let i=0;i<args.length;i++){
    const k=args[i];
    if(seen.has(k))throw new Error('coord: opción repetida '+k);
    seen.add(k);
    if(k==='--json'||k==='--execute')result[k.slice(2)]=true;
    else if(['--repo','--file','--task','--path','--version','--from','--to','--contract','--question','--text'].includes(k)){
      if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('coord: '+k+' requiere valor.');
      result[k.slice(2)]=args[++i];
    }else throw new Error('coord: opción desconocida '+k);
  }
  return result;
}
export function runCoordinationCommand(args) {
  try{
    const [group,op,id,...raw]=args,o=options(raw);
    if(!id||id.startsWith('--'))throw new Error('coord: se requiere ID.');
    const readBacklog=()=>JSON.parse(fs.readFileSync(path.resolve(o.file),'utf8'));
    const allowed=(group==='contract'&&op==='publish')?['repo','json','execute','file','path']:
      (group==='contract'&&op==='approve')?['repo','json','execute','version']:
      (group==='contract'&&op==='show')?['repo','json','version','execute']:
      (group==='contract'&&op==='list')?['repo','json','execute']:
      (group==='request'&&op==='open')?['repo','json','execute','file','to','contract','version','question']:
      (group==='request'&&op==='answer')?['repo','json','execute','from','text']:
      ['repo','json','execute'];
    for(const [key,value] of Object.entries(o)) {
      if(!allowed.includes(key) && value!==false)throw new Error('coord: --'+key+' no se permite en '+op);
    }
    let result;
    if(group==='contract'&&op==='publish') {
      if(!o.file||!o.path)throw new Error('coord contract publish exige --file y --path.');
      const data={taskId:id,contractPath:o.path};
      const backlog=readBacklog();
      result=o.execute?publishContract(o.repo,backlog,data):
        previewContractPublish(o.repo,backlog,data);
    }else if(group==='contract'&&op==='approve'){
      if(o.version===undefined)throw new Error('coord contract approve exige --version.');
      result=approveContract(o.repo,id,number(o.version),{execute:o.execute});
    }else if(group==='contract'&&op==='show'){
      if(o.execute)throw new Error('coord contract show es de sólo lectura.');
      result=showContract(o.repo,id,o.version===undefined?undefined:number(o.version));
    }else if(group==='contract'&&op==='list'){
      if(id!=='all'||o.execute)throw new Error('Uso: coord contract list all --repo .');
      result={contracts:listContracts(o.repo)};
    }else if(group==='request'&&op==='open'){
      if(!o.file||!o.to||!o.contract||!o.question)throw new Error('coord request open exige --file --to --contract --question.');
      result=openRequest(o.repo,readBacklog(),{from:id,to:o.to,contractId:o.contract,
        version:o.version===undefined?undefined:number(o.version),question:o.question,execute:o.execute});
    }else if(group==='request'&&op==='answer'){
      if(!o.from||!o.text)throw new Error('coord request answer exige --from y --text.');
      result=answerRequest(o.repo,id,{from:o.from,answer:o.text,execute:o.execute});
    }else if(group==='inbox'&&op==='show'){
      if(o.execute)throw new Error('coord inbox es de sólo lectura.');
      result=inbox(o.repo,id);
    }else throw new Error('Uso: coord contract publish|approve|show|list, request open|answer, inbox show.');
    if(o.json)console.log(JSON.stringify(result,null,2));
    else console.log('coord '+group+' '+op+': '+JSON.stringify(result));
    return 0;
  }catch(error){console.error(error.message);return 1;}
}
