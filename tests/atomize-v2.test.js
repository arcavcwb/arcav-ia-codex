import test from 'node:test';
import assert from 'node:assert/strict';
import {planBacklogFromPRDV2} from '../src/backlog/atomize-v2.js';
import {validateBacklog} from '../src/backlog/validate.js';

const prd = `## Épica: Servicio
### Historia: Registrar orden
#### Criterios de aceptación
- Cliente asociado
- Prendas y precios registrados
### Historia: Comprobante
- Se emite un recibo
`;
const units={schema_version:1,units:[
  {key:'cliente',story_id:'US-001',title:'Asociar cliente',criteria:[1],depends_on:[]},
  {key:'prendas',story_id:'US-001',title:'Registrar prendas',criteria:[2],depends_on:['cliente']},
  {key:'recibo',story_id:'US-002',title:'Emitir recibo',criteria:[1],depends_on:['prendas']},
]};
test('V2 agrupa por historia; draft, TDD y cobertura completa',()=>{
  const {backlog,coverage,stats,warnings}=planBacklogFromPRDV2(prd);
  assert.deepEqual(stats,{epics:1,stories:2,criteria:3,tasks:2});
  assert.deepEqual(warnings,[]);
  assert.deepEqual(backlog.tasks[0].requirement_refs,['US-001:AC-001','US-001:AC-002']);
  assert.ok(backlog.tasks.every(t=>t.status==='draft'));
  assert.match(backlog.tasks[0].test_plan.join(' '),/RED.*GREEN.*REFACTOR/);
  assert.equal(coverage[2].task_id,'TASK-002');
  assert.deepEqual(validateBacklog(backlog).errors,[]);
});
test('división explícita con DAG y contrato V1 válido',()=>{
  const {backlog,coverage}=planBacklogFromPRDV2(prd,{units});
  assert.deepEqual(backlog.tasks.map(t=>t.dependencies),[[],['TASK-001'],['TASK-002']]);
  assert.equal(coverage[1].task_id,'TASK-002');
  assert.deepEqual(validateBacklog(backlog).errors,[]);
});
test('rechaza criterios omitidos, duplicados, claves y rango',()=>{
  const copy=()=>structuredClone(units);
  let u=copy();u.units.splice(1,1);
  assert.throws(()=>planBacklogFromPRDV2(prd,{units:u}),/cobertura incompleta/);
  u=copy();u.units[1].criteria=[1];
  assert.throws(()=>planBacklogFromPRDV2(prd,{units:u}),/duplicada/);
  u=copy();u.units[1].criteria=[3];
  assert.throws(()=>planBacklogFromPRDV2(prd,{units:u}),/fuera de rango/);
  u=copy();u.units[1].key='cliente';
  assert.throws(()=>planBacklogFromPRDV2(prd,{units:u}),/duplicado/);
});
test('rechaza dependencias inexistentes, autodependencia y ciclos',()=>{
  const copy=()=>structuredClone(units);
  let u=copy();u.units[1].depends_on=['unknown'];
  assert.throws(()=>planBacklogFromPRDV2(prd,{units:u}),/inexistente/);
  u=copy();u.units[1].depends_on=['prendas'];
  assert.throws(()=>planBacklogFromPRDV2(prd,{units:u}),/sí misma/);
  u=copy();u.units[0].depends_on=['recibo'];
  assert.throws(()=>planBacklogFromPRDV2(prd,{units:u}),/ciclo/);
});
test('validador V2 detecta manipulación de la cobertura y texto fuente',()=>{
  const {backlog}=planBacklogFromPRDV2(prd,{units});
  let b=structuredClone(backlog);b.tasks[0].requirement_refs=[];
  assert.match(validateBacklog(b).errors.join(' '),/sin cobertura/);
  b=structuredClone(backlog);b.tasks[1].requirement_refs.push('US-001:AC-001');
  assert.match(validateBacklog(b).errors.join(' '),/duplicada/);
  b=structuredClone(backlog);b.tasks[1].acceptance_criteria[0]='Distinto';
  assert.match(validateBacklog(b).errors.join(' '),/no coincide/);
});
test('es determinista, no muta unidades y advierte historias extensas',()=>{
  const before=structuredClone(units);
  assert.deepEqual(planBacklogFromPRDV2(prd,{units}),planBacklogFromPRDV2(prd,{units}));
  assert.deepEqual(units,before);
  const broad='## Épica: A\n### Historia: B\n- Uno\n- Dos\n- Tres\n- Cuatro';
  assert.match(planBacklogFromPRDV2(broad).warnings.join(' '),/dividir con --units/);
});
