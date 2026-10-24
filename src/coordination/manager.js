import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {validateBacklog} from '../backlog/validate.js';
import {inspectTaskWorktree} from '../worktree/manager.js';

const TASK=/^TASK-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const CONTRACT=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PATH=/^docs\/contracts\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/;
const MAX_FILE=24*1024,MAX_STATE=4*1024*1024;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
const git=(cwd,...args)=>execFileSync('git',args,{
  cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024,
}).trimEnd();
const nonEmpty=(s,min,max,name)=>{
  if(typeof s!=='string'||s.trim().length<min||s.length>max||s.includes('\0')) {
    throw new Error('coord: '+name+' inválido o fuera de longitud.');
  }
  return s.trim();
};
function assertID(value,regex,name) {
  if(typeof value!=='string'||!regex.test(value))throw new Error('coord: '+name+' inválido.');
}
function validateDefinition(value) {
  if(!object(value)||value.schema_version!==1||!CONTRACT.test(value.id??'')||
    !Number.isSafeInteger(value.version)||value.version<1||value.version>100000||
    !TASK.test(value.producer_task_id??'')||
    !['api','type','event','data'].includes(value.kind)||
    !Array.isArray(value.consumer_task_ids)||value.consumer_task_ids.length===0||
    value.consumer_task_ids.length>32||
    value.consumer_task_ids.some(id=>!TASK.test(id)||id===value.producer_task_id)||
    new Set(value.consumer_task_ids).size!==value.consumer_task_ids.length||
    !object(value.definition)) {
    throw new Error('coord: contrato v1 inválido (ID, versión, tareas, tipo o definición).');
  }
  const keys=['schema_version','id','version','producer_task_id','consumer_task_ids','kind','summary','definition'];
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('coord: contrato contiene campos desconocidos.');
  nonEmpty(value.summary,10,1000,'summary');
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_FILE)throw new Error('coord: contrato demasiado grande.');
  return value;
}
function validateTasks(backlog,ids) {
  const result=validateBacklog(backlog);
  if(!result.valid)throw new Error('coord: backlog inválido: '+result.errors.join('; '));
  const tasks=new Set(backlog.tasks.map(t=>t.id));
  for(const id of ids)if(!tasks.has(id))throw new Error('coord: tarea no existe en backlog: '+id);
}
function paths(repoRoot) {
  const root=fs.realpathSync(repoRoot);
  if(fs.realpathSync(git(root,'rev-parse','--show-toplevel'))!==root) {
    throw new Error('coord: --repo debe ser la raíz de un checkout Git.');
  }
  if(git(root,'symbolic-ref','--quiet','--short','HEAD')!=='main') {
    throw new Error('coord: usar checkout principal en main.');
  }
  const common=fs.realpathSync(path.resolve(root,git(root,'rev-parse','--git-common-dir')));
  const dir=path.join(common,'arcav-coordination');
  return {root,dir,file:path.join(dir,'registry.json'),lock:path.join(dir,'registry.lock')};
}
function directory(dir,create=false) {
  let st;
  try{st=fs.lstatSync(dir);}
  catch(err){
    if(err.code!=='ENOENT')throw err;
    if(!create)return false;
    try{fs.mkdirSync(dir,{mode:0o700});}
    catch(e){if(e.code!=='EEXIST')throw e;}
    st=fs.lstatSync(dir);
  }
  if(st.isSymbolicLink()||!st.isDirectory())throw new Error('coord: directorio inseguro.');
  return true;
}
const empty=()=>({schema_version:1,contracts:[],requests:[],events:[]});
function readState(p) {
  if(!directory(p.dir))return empty();
  let st;
  try{st=fs.lstatSync(p.file);}
  catch(e){if(e.code==='ENOENT')return empty();throw e;}
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_STATE)throw new Error('coord: registro inseguro o demasiado grande.');
  const state=JSON.parse(fs.readFileSync(p.file,'utf8'));
  if(!object(state)||state.schema_version!==1||
    !Array.isArray(state.contracts)||!Array.isArray(state.requests)||!Array.isArray(state.events)||
    state.contracts.length>4000||state.requests.length>4000||state.events.length>12000) {
    throw new Error('coord: registro corrupto; se bloquean mutaciones.');
  }
  const contractKeys=new Set(),requestIds=new Set();
  for(const c of state.contracts){
    if(!object(c)||!CONTRACT.test(c.id??'')||!Number.isSafeInteger(c.version)||c.version<1||
      !['proposed','approved'].includes(c.status)||!TASK.test(c.producer_task_id??'')||
      !Array.isArray(c.consumer_task_ids)||!CONTRACT.test(c.kind??'')||
      !/^[a-f0-9]{40}$/.test(c.commit_sha??'')||!/^[a-f0-9]{64}$/.test(c.content_sha256??'')||
      !PATH.test(c.path??''))throw new Error('coord: entrada de contrato corrupta.');
    const key=c.id+':'+c.version;
    if(contractKeys.has(key))throw new Error('coord: versión de contrato duplicada.');
    contractKeys.add(key);
  }
  for(const req of state.requests){
    if(!object(req)||!/^REQ-[0-9]{6}$/.test(req.id??'')||
      requestIds.has(req.id)||!['pending','answered'].includes(req.status)||
      !TASK.test(req.from_task_id??'')||!TASK.test(req.to_task_id??'')||
      !CONTRACT.test(req.contract_id??''))throw new Error('coord: solicitud corrupta.');
    requestIds.add(req.id);
  }
  return state;
}
function persist(p,state) {
  const tmp=path.join(p.dir,'registry-tmp-'+process.pid+'-'+randomBytes(8).toString('hex'));
  try{
    fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
    fs.renameSync(tmp,p.file);
  }finally{
    try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
}
function update(p,action) {
  directory(p.dir,true);
  let fd;
  try{fd=fs.openSync(p.lock,'wx',0o600);}
  catch(e){
    if(e.code==='EEXIST')throw new Error('coord: registro bloqueado; inspección manual del lock.');
    throw e;
  }
  try{
    const state=readState(p);
    const result=action(state);
    persist(p,state);
    return result;
  }finally{
    fs.closeSync(fd);fs.unlinkSync(p.lock);
  }
}
function event(state,type,detail) {
  state.events.push({seq:state.events.length+1,type,...detail,at:new Date().toISOString()});
}
function findContract(state,id,version) {
  assertID(id,CONTRACT,'contract_id');
  const matches=state.contracts.filter(c=>c.id===id);
  const record=version===undefined
    ?matches.sort((a,b)=>b.version-a.version)[0]
    :matches.find(c=>c.version===version);
  if(!record)throw new Error('coord: contrato o versión inexistente.');
  return record;
}
function contractSource(root,taskId,contractPath) {
  assertID(taskId,TASK,'task_id');
  if(typeof contractPath!=='string'||!PATH.test(contractPath)) {
    throw new Error('coord: contrato debe estar en docs/contracts/*.json sin rutas especiales.');
  }
  const wt=inspectTaskWorktree(root,taskId);
  if(!wt.exists||!wt.clean)throw new Error('coord: worktree del productor ausente o sucio.');
  const commit=wt.head_sha;
  const source=git(root,'show',commit+':'+contractPath);
  if(Buffer.byteLength(source,'utf8')>MAX_FILE)throw new Error('coord: contrato excede límite de tamaño.');
  const definition=validateDefinition(JSON.parse(source));
  if(definition.producer_task_id!==taskId)throw new Error('coord: productor distinto al worktree.');
  return {definition,source,commit_sha:commit,content_sha256:sha256(source),path:contractPath};
}
export function previewContractPublish(repoRoot,backlog,{taskId,contractPath}) {
  const p=paths(repoRoot);
  const data=contractSource(p.root,taskId,contractPath);
  const c=data.definition;
  validateTasks(backlog,[c.producer_task_id,...c.consumer_task_ids]);
  const state=readState(p),versions=state.contracts.filter(x=>x.id===c.id);
  const expected=versions.length?Math.max(...versions.map(x=>x.version))+1:1;
  if(c.version!==expected)throw new Error('coord: versión esperada '+expected+' para '+c.id+'.');
  return {operation:'publish',execution:'dry-run',contract_id:c.id,version:c.version,
    producer_task_id:taskId,consumer_task_ids:[...c.consumer_task_ids],
    commit_sha:data.commit_sha,path:data.path,content_sha256:data.content_sha256,
    status:'proposed',requires_execute:true};
}
export function publishContract(repoRoot,backlog,input) {
  const p=paths(repoRoot);
  const proposed=previewContractPublish(repoRoot,backlog,input);
  const data=contractSource(p.root,input.taskId,input.contractPath);
  if(data.commit_sha!==proposed.commit_sha||data.content_sha256!==proposed.content_sha256) {
    throw new Error('coord: contrato cambió durante la preparación.');
  }
  return update(p,state=>{
    const all=state.contracts.filter(c=>c.id===proposed.contract_id);
    const expected=all.length?Math.max(...all.map(c=>c.version))+1:1;
    if(proposed.version!==expected)throw new Error('coord: versión concurrente; repetir preflight.');
    state.contracts.push({id:proposed.contract_id,version:proposed.version,
      producer_task_id:proposed.producer_task_id,consumer_task_ids:proposed.consumer_task_ids,
      kind:data.definition.kind,summary:data.definition.summary,
      commit_sha:proposed.commit_sha,path:proposed.path,content_sha256:proposed.content_sha256,
      status:'proposed',published_at:new Date().toISOString()});
    event(state,'contract.published',{contract_id:proposed.contract_id,version:proposed.version,
      task_id:proposed.producer_task_id});
    return {...proposed,execution:'executed'};
  });
}
export function approveContract(repoRoot,id,version,{execute=false}={}) {
  const p=paths(repoRoot);
  const action=state=>{
    const contract=findContract(state,id,version);
    if(contract.status==='approved')throw new Error('coord: contrato ya aprobado.');
    if(execute){
      contract.status='approved';contract.approved_at=new Date().toISOString();
      event(state,'contract.approved',{contract_id:id,version,task_id:contract.producer_task_id});
    }
    return {contract_id:id,version,status:execute?'approved':contract.status,
      execution:execute?'executed':'dry-run',operator_attestation:true};
  };
  return execute?update(p,action):action(readState(p));
}
export function showContract(repoRoot,id,version) {
  const p=paths(repoRoot),metadata=findContract(readState(p),id,version);
  const content=git(p.root,'show',metadata.commit_sha+':'+metadata.path);
  if(sha256(content)!==metadata.content_sha256)throw new Error('coord: contenido del contrato no coincide con la huella.');
  const definition=validateDefinition(JSON.parse(content));
  if(definition.id!==metadata.id||definition.version!==metadata.version) {
    throw new Error('coord: identidad del contrato no coincide.');
  }
  return {metadata:{...metadata},definition};
}
export function listContracts(repoRoot) {
  const p=paths(repoRoot);
  return readState(p).contracts.map(({id,version,status,kind,producer_task_id,consumer_task_ids,commit_sha})=>
    ({id,version,status,kind,producer_task_id,consumer_task_ids,commit_sha}));
}
export function openRequest(repoRoot,backlog,{from,to,contractId,version,question,execute=false}) {
  const p=paths(repoRoot);
  assertID(from,TASK,'from');assertID(to,TASK,'to');
  const text=nonEmpty(question,5,1000,'question');
  validateTasks(backlog,[from,to]);
  const action=state=>{
    const contract=findContract(state,contractId,version);
    if(contract.producer_task_id!==to||!contract.consumer_task_ids.includes(from)) {
      throw new Error('coord: solicitud fuera de la relación productor/consumidor.');
    }
    const id='REQ-'+String(state.requests.length+1).padStart(6,'0');
    const request={id,from_task_id:from,to_task_id:to,
      contract_id:contract.id,contract_version:contract.version,
      question:text,status:'pending'};
    if(execute){
      request.opened_at=new Date().toISOString();
      state.requests.push(request);
      event(state,'request.opened',{request_id:id,contract_id:contract.id,task_id:from});
    }
    return {execution:execute?'executed':'dry-run',...request};
  };
  return execute?update(p,action):action(readState(p));
}
export function answerRequest(repoRoot,id,{from,answer,execute=false}) {
  const p=paths(repoRoot);
  if(typeof id!=='string'||!/^REQ-[0-9]{6}$/.test(id))throw new Error('coord: request_id inválido.');
  assertID(from,TASK,'from');
  const text=nonEmpty(answer,2,1000,'answer');
  const action=state=>{
    const req=state.requests.find(r=>r.id===id);
    if(!req||req.status!=='pending')throw new Error('coord: solicitud inexistente o ya respondida.');
    if(req.to_task_id!==from)throw new Error('coord: sólo el productor indicado puede responder.');
    if(execute){
      req.answer=text;req.status='answered';req.answered_at=new Date().toISOString();
      event(state,'request.answered',{request_id:id,contract_id:req.contract_id,task_id:from});
    }
    return {execution:execute?'executed':'dry-run',request_id:id,from_task_id:from,
      status:execute?'answered':'pending'};
  };
  return execute?update(p,action):action(readState(p));
}
export function inbox(repoRoot,taskId) {
  assertID(taskId,TASK,'task_id');
  const state=readState(paths(repoRoot));
  return {task_id:taskId,
    requests:state.requests.filter(r=>r.from_task_id===taskId||r.to_task_id===taskId),
    events:state.events.filter(e=>e.task_id===taskId||
      state.requests.some(r=>r.id===e.request_id&&(r.from_task_id===taskId||r.to_task_id===taskId)))};
}
