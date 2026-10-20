import test from 'node:test';
import assert from 'node:assert/strict';
import { planBacklogFromPRD } from '../src/backlog/prd.js';
import { validateBacklog } from '../src/backlog/validate.js';

const simple = `# PRD — Lavandería\n\n## Épica: Órdenes de servicio\n### Historia: Registrar una orden\nComo atendente quiero registrar las prendas.\n#### Criterios de aceptación\n- [ ] El cliente queda asociado a la orden\n- [ ] Cada prenda tiene cantidad y precio\n`;

test('convierte PRD explícito en épica, historia y dos tareas TDD por criterio', () => {
  const { backlog, warnings, stats } = planBacklogFromPRD(simple);
  assert.equal(warnings.length, 0);
  assert.equal(backlog.schema_version, 1);
  assert.equal(backlog.epics.length, 1);
  assert.equal(backlog.stories.length, 1);
  assert.equal(backlog.tasks.length, 4);
  assert.deepEqual(stats, {epics:1,stories:1,criteria:2,tasks:4});
  assert.deepEqual(backlog.tasks.map(t => t.id), ['TASK-001','TASK-002','TASK-003','TASK-004']);
  assert.deepEqual(backlog.tasks.map(t => t.dependencies), [[],['TASK-001'],[],['TASK-003']]);
  assert.ok(backlog.tasks.every(t => t.status === 'draft'));
  assert.deepEqual(validateBacklog(backlog).errors, []);
  assert.equal(backlog.stories[0].acceptance_criteria[0], 'El cliente queda asociado a la orden');
  assert.match(backlog.tasks[0].description, /prueba/i);
  assert.match(backlog.tasks[1].description, /implementar/i);
});

test('IDs son secuenciales, sin cruces entre épicas/historias', () => {
  const source = `${simple}\n### Historia: Cobrar orden\n- Cobro registrado correctamente\n## Épica: Clientes\n### Historia: Registrar cliente\n- Los datos se guardan\n`;
  const { backlog } = planBacklogFromPRD(source);
  assert.deepEqual(backlog.epics.map(e=>e.id),['EP-001','EP-002']);
  assert.deepEqual(backlog.stories.map(s=>s.id),['US-001','US-002','US-003']);
  assert.equal(backlog.tasks.length,8);
  assert.equal(backlog.tasks[6].story_id,'US-003');
  assert.deepEqual(validateBacklog(backlog).errors,[]);
});

test('acepta CRLF, numeración y criterios marcados, conserva Unicode', () => {
  const prd='# PRD\r\n## Épica: Atención\r\n### Historia: Órdenes\r\n1. La descripción queda guardada\r\n2. El importe se calcula\r\n';
  const {backlog}=planBacklogFromPRD(prd);
  assert.equal(backlog.tasks.length,4);
  assert.equal(backlog.stories[0].acceptance_criteria[0],'La descripción queda guardada');
});

test('no inventa tareas sin criterios; reporta error con ubicación',()=>{
  assert.throws(()=>planBacklogFromPRD('## Épica: Clientes\n### Historia: Alta\n'),/sin criterios de aceptación/i);
});

test('rechaza requisitos sin épica/historia y estructuras desconocidas',()=>{
  assert.throws(()=>planBacklogFromPRD('### Historia: Sola\n- Dado de alta'),/sin épica/i);
  assert.throws(()=>planBacklogFromPRD('## Épica: Clientes\n- Faltan datos\n### Historia: Alta\n- Se guarda'),/fuera de una historia/i);
  assert.throws(()=>planBacklogFromPRD('Un texto sin estructura'),/No se encontraron épicas/i);
});

test('deduplica criterio sólo dentro de su historia y avisa, no inventa duplicados',()=>{
  const {backlog,warnings}=planBacklogFromPRD('## Épica: Clientes\n### Historia: Alta\n- Guardar CLIENTE\n- guardar cliente  \n');
  assert.equal(backlog.tasks.length,2);
  assert.match(warnings.join(' '),/duplicado/i);
});

test('rechaza encabezados de nivel no soportado que podrían esconder requisitos',()=>{
  assert.throws(()=>planBacklogFromPRD('## Épica: A\n### Historia: B\n##### Requisito\n- Datos'),/encabezado no soportado/i);
});

test('advierte contenido global que no es convertido y nunca marca tareas ready',()=>{
  const src='# Sistema\n## Reglas globales\nDebe cumplir auditoría\n## Épica: Auditoría\n### Historia: Guardar\n- Se registra acceso\n';
  const {warnings,backlog}=planBacklogFromPRD(src);
  assert.ok(warnings.some(w=>w.includes('Reglas globales')));
  assert.ok(warnings.some(w=>w.includes('Debe cumplir auditoría')));
  assert.ok(backlog.tasks.every(t=>t.status==='draft'));
});

test('rechaza criterios ambiguos vacíos o placeholders',()=>{
  assert.throws(()=>planBacklogFromPRD('## Épica: A\n### Historia: B\n- [ ] TBD\n'),/sin criterios/i);
});

test('salida es determinista y no muta el texto fuente',()=>{
  const a=planBacklogFromPRD(simple);
  const b=planBacklogFromPRD(simple);
  assert.deepEqual(a,b);
});


test('admite títulos de PRD escritos en portugués BR',()=>{
  const {backlog}=planBacklogFromPRD('## Épica: Serviços\n### História: Nova ordem\n#### Critérios de aceitação\n- [ ] A peça fica registrada\n');
  assert.equal(backlog.tasks.length,2);
  assert.deepEqual(validateBacklog(backlog).errors,[]);
});
