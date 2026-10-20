import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBacklog } from '../src/backlog/validate.js';
import { routeTask, loadModelProfiles } from '../src/routing/router.js';

const dims = (v=0) => ({ scope:v, ambiguity:v, integration:v, impact:v, verification:v });
const task = (more={}) => ({
  id:'TASK-001',story_id:'US-001',title:'Validar un formulario',
  description:'Verificar campos obligatorios del formulario',
  acceptance_criteria:['Rechaza valores invalidos'],
  dependencies:[], status:'ready',story_points:2,risk:'low',
  complexity:dims(0),test_plan:['node --test tests/forms.test.js'],...more,
});
const backlog = (tasks=[task()]) => ({
  schema_version:1,
  epics:[{id:'EP-001',title:'Acceso'}],
  stories:[{id:'US-001',epic_id:'EP-001',title:'Validar formulario',acceptance_criteria:['Los datos se validan']}],
  tasks,
});

test('acepta backlog versionado y tareas ready con DoR',()=>{
  assert.deepEqual(validateBacklog(backlog()).errors,[]);
});
test('rechaza version desconocida y secciones obligatorias',()=>{
  const data=backlog();data.schema_version=2;data.stories=null;
  const errors=validateBacklog(data).errors.join(' ');
  assert.match(errors,/schema_version/);
  assert.match(errors,/stories/);
});
test('detecta IDs duplicados en todas las colecciones',()=>{
  const data=backlog([task(),task({title:'Otra tarea'})]);
  assert.match(validateBacklog(data).errors.join(' '),/ID duplicado.*TASK-001/);
});
test('señala la historia o épica inexistente',()=>{
  const data=backlog([task({story_id:'US-X'})]);
  data.stories[0].epic_id='EP-X';
  const errors=validateBacklog(data).errors.join(' ');
  assert.match(errors,/US-X/);
  assert.match(errors,/EP-X/);
});
test('rechaza criterios vacíos, plan de prueba ausente y status inválido',()=>{
  const t=task({acceptance_criteria:[],test_plan:[],status:'unknown'});
  const errors=validateBacklog(backlog([t])).errors.join(' ');
  assert.match(errors,/acceptance_criteria/);
  assert.match(errors,/test_plan/);
  assert.match(errors,/status/);
});
test('rechaza dimensiones fuera de 0..2, score incompleto y riesgo inválido',()=>{
  const t=task({complexity:{scope:3,ambiguity:0},risk:'extreme'});
  const errors=validateBacklog(backlog([t])).errors.join(' ');
  assert.match(errors,/scope/);
  assert.match(errors,/integration/);
  assert.match(errors,/risk/);
});
test('detecta dependencias inexistentes y auto dependencia',()=>{
  const errors=validateBacklog(backlog([task({dependencies:['TASK-001','TASK-X']})])).errors.join(' ');
  assert.match(errors,/TASK-X/);
  assert.match(errors,/depender de sí misma/);
});
test('detecta ciclos en la DAG de tareas',()=>{
  const a=task({id:'TASK-001',dependencies:['TASK-002'],status:'draft'});
  const b=task({id:'TASK-002',dependencies:['TASK-001'],status:'draft'});
  assert.match(validateBacklog(backlog([a,b])).errors.join(' '),/ciclo/i);
});
test('bloquea READY con dependencia no completada',()=>{
  const data=backlog([task({id:'TASK-001',status:'draft'}),task({id:'TASK-002',dependencies:['TASK-001']})]);
  assert.match(validateBacklog(data).errors.join(' '),/TASK-002.*TASK-001/);
});
test('permite READY cuando dependencias están DONE',()=>{
  const data=backlog([task({id:'TASK-001',status:'done'}),task({id:'TASK-002',dependencies:['TASK-001']})]);
  assert.deepEqual(validateBacklog(data).errors,[]);
});
test('niveles XS S M L XL clasifican correctamente los bordes',()=>{
  const expected=[[0,'XS','luna'],[2,'XS','luna'],[3,'S','luna'],[4,'S','luna'],[5,'M','sol'],[6,'M','sol'],[7,'L','sol'],[8,'L','sol'],[9,'XL','astra'],[10,'XL','astra']];
  for(const [score,level,tier] of expected){
    const d=dims(0);let remaining=score;
    for(const key of Object.keys(d)){ d[key]=Math.min(remaining,2);remaining-=d[key]; }
    const r=routeTask(task({complexity:d}));
    assert.equal(r.complexity.score,score);
    assert.equal(r.complexity.level,level);
    assert.equal(r.implementer.tier,tier);
  }
});
test('riesgo crítico exige revisión Astra y autorización humana, sin Luna',()=>{
  const r=routeTask(task({risk:'critical'}));
  assert.equal(r.implementer.tier,'sol');
  assert.equal(r.reviewer.tier,'astra');
  assert.equal(r.requires_human_approval,true);
  assert.match(r.justification.join(' '),/crítico/);
});
test('alto riesgo requiere revisor Astra independiente',()=>{
  const r=routeTask(task({risk:'high'}));
  assert.equal(r.implementer.tier,'sol');
  assert.equal(r.reviewer.tier,'astra');
});
test('no atribuye identificadores de modelo sin configuración local',()=>{
  const r=routeTask(task());
  assert.equal(r.implementer.model_id,null);
  assert.equal(r.reviewer.model_id,null);
});
test('selecciona IDs configurados de forma explícita sin fallback silencioso',()=>{
  const models=loadModelProfiles({luna:'luna-test',sol:'sol-test',astra:'astra-test'});
  const r=routeTask(task({risk:'critical'}),models);
  assert.equal(r.implementer.model_id,'sol-test');
  assert.equal(r.reviewer.model_id,'astra-test');
  assert.throws(()=>loadModelProfiles({sol:'x',astra:'x'}),/luna/);
});
