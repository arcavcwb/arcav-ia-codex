import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareTaskPacket } from '../src/execution/packet.js';
import { validateBacklog } from '../src/backlog/validate.js';

const task = (properties = {}) => ({
  id:'TASK-001', story_id:'US-001', title:'Escribir verificación', description:'Cubre caso concreto',
  acceptance_criteria:['Hay prueba que falla antes de implementar'],test_plan:['node --test'],
  status:'ready',risk:'low',dependencies:[],story_points:2,
  complexity:{scope:1,ambiguity:0,integration:0,impact:0,verification:1},
  ...properties,
});
const backlog=(tasks=[task()])=>({schema_version:1,epics:[{id:'EP-001',title:'TDD'}],stories:[{id:'US-001',title:'Test',epic_id:'EP-001',acceptance_criteria:['Red/green']}],tasks});
function inTemp(callback){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-packet-'));try{return callback(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}

test('prepara contrato mínimo con gates TDD y routing, sin mutar backlog',()=>inTemp(dir=>{
  fs.mkdirSync(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'src','math.js'),'export const add=(a,b)=>a+b;\n');
  const original=backlog([task({context_files:['src/math.js']})]);const copy=JSON.stringify(original);
  const p=prepareTaskPacket(original,'TASK-001',{repoRoot:dir,models:{luna:'mini',sol:'mid',astra:'big'}});
  assert.equal(p.execution,'dry-run');assert.equal(p.routing.implementer.model_id,'mini');
  assert.deepEqual(p.quality_gates.map(x=>x.phase),['RED','GREEN','REFACTOR','REVIEW','QA']);
  assert.equal(p.context_files[0].path,'src/math.js');
  assert.match(p.context_files[0].content,/add=/);
  assert.equal(p.packet_bytes,Buffer.byteLength(JSON.stringify(p),'utf8'));
  assert.equal(JSON.stringify(original),copy);
}));
test('sin context_files entrega contrato y no descubre archivos',()=>inTemp(dir=>{
  fs.writeFileSync(path.join(dir,'.env'),'PASSWORD=SECRET');
  const p=prepareTaskPacket(backlog(),'TASK-001',{repoRoot:dir});
  assert.deepEqual(p.context_files,[]);
  assert.equal(p.routing.implementer.model_id,null);
  assert.ok(p.packet_bytes<32768);
}));
test('exige tarea lista y rechaza siempre riesgo crítico',()=>inTemp(dir=>{
  assert.throws(()=>prepareTaskPacket(backlog([task({status:'draft'})]),'TASK-001',{repoRoot:dir}),/ready/);
  assert.throws(()=>prepareTaskPacket(backlog([task({risk:'critical'})]),'TASK-001',{repoRoot:dir}),/riesgo crítico/i);
  assert.throws(()=>prepareTaskPacket(backlog(),'TASK-X',{repoRoot:dir}),/inexistente/);
}));
test('rechaza dependencias pendientes incluso si están marcadas ready',()=>inTemp(dir=>{
  assert.throws(()=>prepareTaskPacket(backlog([task({status:'draft'}),task({id:'TASK-002',dependencies:['TASK-001']})]),'TASK-002',{repoRoot:dir}),/Backlog inválido/);
}));
test('bloquea traversal, rutas absolutas, archivos ocultos y nombres sensibles',()=>inTemp(dir=>{
  for(const forbidden of ['../secret.txt','/etc/passwd','src/../secret.txt','.env','.aws/credentials','src/.env.local','secrets/x.txt','src/x.pem','src\\x.js','./src/x.js']){
    assert.throws(()=>prepareTaskPacket(backlog([task({context_files:[forbidden]})]),'TASK-001',{repoRoot:dir}),/ruta|oculta|sensible/i,forbidden);
  }
}));
test('bloquea symlinks aunque apunten dentro del repo',()=>inTemp(dir=>{
  fs.mkdirSync(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'src','good.js'),'ok');
  fs.symlinkSync(path.join(dir,'src','good.js'),path.join(dir,'src','link.js'));
  assert.throws(()=>prepareTaskPacket(backlog([task({context_files:['src/link.js']})]),'TASK-001',{repoRoot:dir}),/simbólicos/);
}));
test('detecta archivos binarios y UTF-8 incorrecto',()=>inTemp(dir=>{
  fs.writeFileSync(path.join(dir,'binary.js'),Buffer.from([0,1,2]));
  fs.writeFileSync(path.join(dir,'invalid.js'),Buffer.from([0xff]));
  assert.throws(()=>prepareTaskPacket(backlog([task({context_files:['binary.js']})]),'TASK-001',{repoRoot:dir}),/binario/);
  assert.throws(()=>prepareTaskPacket(backlog([task({context_files:['invalid.js']})]),'TASK-001',{repoRoot:dir}),/UTF-8/);
}));
test('aplica presupuesto a bytes del paquete completo y falla sin truncar',()=>inTemp(dir=>{
  fs.writeFileSync(path.join(dir,'large.js'),'a'.repeat(6000));
  assert.throws(()=>prepareTaskPacket(backlog([task({context_files:['large.js']})]),'TASK-001',{repoRoot:dir,maxContextBytes:4096}),/Presupuesto/);
  assert.throws(()=>prepareTaskPacket(backlog(),'TASK-001',{repoRoot:dir,maxContextBytes:10}),/maxContextBytes/);
  assert.throws(()=>prepareTaskPacket(backlog(),'TASK-001',{repoRoot:dir,maxContextBytes:131073}),/maxContextBytes/);
}));
test('validador limita context_files opcional por cardinalidad y duplicados',()=>{
  assert.equal(validateBacklog(backlog([task({context_files:['src/a.js']})])).valid,true);
  assert.match(validateBacklog(backlog([task({context_files:['src/a.js','src/a.js']})])).errors.join(' '),/context_files/);
  assert.match(validateBacklog(backlog([task({context_files:Array.from({length:13},(_,i)=>`f${i}.js`)})])).errors.join(' '),/context_files/);
});
test('packet rechaza directorios y preserva archivo fuente',()=>inTemp(dir=>{
  fs.mkdirSync(path.join(dir,'src'));
  assert.throws(()=>prepareTaskPacket(backlog([task({context_files:['src']})]),'TASK-001',{repoRoot:dir}),/regular/);
  const original=JSON.stringify(backlog());const p=prepareTaskPacket(backlog(),'TASK-001',{repoRoot:dir});
  assert.equal(p.execution,'dry-run');assert.equal(original,JSON.stringify(backlog()));
}));
