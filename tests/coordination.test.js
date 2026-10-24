import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createTaskWorktree} from '../src/worktree/manager.js';
import {previewContractPublish,publishContract,approveContract,showContract,
  listContracts,openRequest,answerRequest,inbox} from '../src/coordination/manager.js';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const contract=()=>({schema_version:1,id:'CustomerSearchAPI',version:1,producer_task_id:'TASK-001',
  consumer_task_ids:['TASK-002'],kind:'api',
  summary:'Buscar clientes por nombre con respuesta consistente',
  definition:{method:'GET',path:'/clientes',query:{search:'string'},response:{clientes:'array'}}});
const task=(id)=>({id,story_id:'US-001',title:'Tarea '+id,description:'Probar la coordinación',
  status:'draft',risk:'low',story_points:1,acceptance_criteria:['Entrega correcta'],
  test_plan:['npm test'],dependencies:[],
  complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:0}});
const backlog=()=>({schema_version:1,epics:[{id:'EP-001',title:'Servicio'}],
  stories:[{id:'US-001',epic_id:'EP-001',title:'Clientes',acceptance_criteria:['Entrega correcta']}],
  tasks:[task('TASK-001'),task('TASK-002'),task('TASK-003')]});
function fixture(fn) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-coord-'));
  const root=path.join(tmp,'repo');fs.mkdirSync(root);
  git(root,'init','-b','main');
  git(root,'config','user.name','QA');git(root,'config','user.email','qa@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'hello\n');
  git(root,'add','README.md');git(root,'commit','-m','base');
  const wt=createTaskWorktree(root,'TASK-001').target;
  const file='docs/contracts/customer-search.json';
  fs.mkdirSync(path.join(wt,'docs','contracts'),{recursive:true});
  fs.writeFileSync(path.join(wt,file),JSON.stringify(contract(),null,2)+'\n');
  git(wt,'add',file);git(wt,'commit','-m','contract');
  const input={taskId:'TASK-001',contractPath:file};
  const registry=path.join(root,'.git','arcav-coordination');
  const ctx={tmp,root,wt,file,input,backlog:backlog(),registry};
  try {
    const result=fn(ctx);
    if(result && typeof result.then==='function')return result.finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
    fs.rmSync(tmp,{recursive:true,force:true});return result;
  }catch(err){fs.rmSync(tmp,{recursive:true,force:true});throw err;}
}
test('publish dry-run puro, Git provenance y metadata íntegra',()=>fixture(({root,input,registry,backlog})=>{
  const plan=previewContractPublish(root,backlog,input);
  assert.equal(plan.execution,'dry-run');assert.equal(plan.version,1);
  assert.equal(fs.existsSync(registry),false);
  const result=publishContract(root,backlog,input);
  assert.equal(result.status,'proposed');
  const list=listContracts(root);
  assert.equal(list.length,1);
  assert.equal(list[0].kind,'api');
  const shown=showContract(root,'CustomerSearchAPI',1);
  assert.equal(shown.definition.definition.method,'GET');
  assert.equal(shown.metadata.status,'proposed');
  assert.equal(git(root,'status','--porcelain'),'');
}));
test('aprobación explícita, sin mutar definición versionada',()=>fixture(({root,input,backlog})=>{
  publishContract(root,backlog,input);
  assert.equal(approveContract(root,'CustomerSearchAPI',1).execution,'dry-run');
  assert.equal(showContract(root,'CustomerSearchAPI').metadata.status,'proposed');
  assert.equal(approveContract(root,'CustomerSearchAPI',1,{execute:true}).status,'approved');
  assert.equal(showContract(root,'CustomerSearchAPI').metadata.status,'approved');
  assert.throws(()=>approveContract(root,'CustomerSearchAPI',1,{execute:true}),/ya aprobado/);
}));
test('pregunta de consumidor, respuesta única, inbox de ambas tareas',()=>fixture(({root,input,backlog})=>{
  publishContract(root,backlog,input);
  const q={from:'TASK-002',to:'TASK-001',contractId:'CustomerSearchAPI',
    version:1,question:'¿Qué devolverá la búsqueda sin coincidencias?'};
  assert.equal(openRequest(root,backlog,q).execution,'dry-run');
  assert.deepEqual(inbox(root,'TASK-001').requests,[]);
  const open=openRequest(root,backlog,{...q,execute:true});
  assert.equal(open.id,'REQ-000001');
  assert.throws(()=>answerRequest(root,open.id,{from:'TASK-002',answer:'No autorizado',execute:true}),/sólo el productor/);
  assert.equal(answerRequest(root,open.id,{from:'TASK-001',answer:'HTTP 200, clientes=[]',execute:true}).status,'answered');
  assert.equal(inbox(root,'TASK-002').requests[0].answer,'HTTP 200, clientes=[]');
  assert.deepEqual(inbox(root,'TASK-002').events.map(e=>e.type),['request.opened','request.answered']);
  assert.throws(()=>answerRequest(root,open.id,{from:'TASK-001',answer:'Otra respuesta',execute:true}),/ya respondida/);
}));
test('versionado secuencial, nunca overwrite',()=>fixture(({root,wt,file,input,backlog})=>{
  publishContract(root,backlog,input);
  assert.throws(()=>previewContractPublish(root,backlog,input),/versión esperada 2/);
  const next={...contract(),version:3};
  fs.writeFileSync(path.join(wt,file),JSON.stringify(next)+'\n');
  git(wt,'add',file);git(wt,'commit','-m','skip version');
  assert.throws(()=>publishContract(root,backlog,input),/versión esperada 2/);
  next.version=2;fs.writeFileSync(path.join(wt,file),JSON.stringify(next)+'\n');
  git(wt,'add',file);git(wt,'commit','-m','version 2');
  publishContract(root,backlog,input);
  assert.equal(listContracts(root).length,2);
  assert.equal(showContract(root,'CustomerSearchAPI',1).definition.version,1);
  assert.equal(showContract(root,'CustomerSearchAPI',2).definition.version,2);
}));
test('rechaza rutas y worktrees sucios o con productor distinto',()=>fixture(({root,wt,file,input,backlog})=>{
  fs.writeFileSync(path.join(wt,'untracked.txt'),'dirty');
  assert.throws(()=>previewContractPublish(root,backlog,input),/sucio/);
  fs.rmSync(path.join(wt,'untracked.txt'));
  assert.throws(()=>previewContractPublish(root,backlog,{...input,contractPath:'../.env'}),/docs\/contracts/);
  const invalid={...contract(),producer_task_id:'TASK-003'};
  fs.writeFileSync(path.join(wt,file),JSON.stringify(invalid)+'\n');
  git(wt,'add',file);git(wt,'commit','-m','invalid producer');
  assert.throws(()=>publishContract(root,backlog,input),/productor distinto/);
}));
test('consumidor no declarado jamás abre solicitud',()=>fixture(({root,input,backlog})=>{
  publishContract(root,backlog,input);
  const q={from:'TASK-003',to:'TASK-001',contractId:'CustomerSearchAPI',
    version:1,question:'Necesito la API'};
  assert.throws(()=>openRequest(root,backlog,{...q,execute:true}),/fuera de la relación/);
  assert.throws(()=>openRequest(root,backlog,{...q,from:'TASK-002',to:'TASK-003',execute:true}),/fuera de la relación/);
  assert.equal(inbox(root,'TASK-001').requests.length,0);
}));
test('registro corrupto y lock existente bloquean cambios',()=>fixture(({root,input,backlog,registry})=>{
  fs.mkdirSync(registry);
  const f=path.join(registry,'registry.json'),lock=path.join(registry,'registry.lock');
  fs.writeFileSync(f,'{"schema_version":19}');
  assert.throws(()=>publishContract(root,backlog,input),/registro corrupto/);
  assert.equal(fs.readFileSync(f,'utf8'),'{"schema_version":19}');
  fs.writeFileSync(f,JSON.stringify({schema_version:1,contracts:[],requests:[],events:[]}));
  fs.writeFileSync(lock,'stale');
  assert.throws(()=>publishContract(root,backlog,input),/registro bloqueado/);
  assert.equal(fs.readFileSync(lock,'utf8'),'stale');
}));
