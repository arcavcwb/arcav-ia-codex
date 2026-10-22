import test from 'node:test';
import assert from 'node:assert/strict';
import { planSprint } from '../src/sprint/planner.js';
import { validateBacklog } from '../src/backlog/validate.js';

const complexity = (score = 0) => ({ scope: Math.min(score, 2), ambiguity: 0, integration: 0, impact: 0, verification: 0 });
const task = (id, props = {}) => ({
  id, story_id: 'US-001', title: id, description: `Entregar ${id}`,
  acceptance_criteria: ['Criterio verificable'], dependencies: [], status: 'ready',
  story_points: 2, priority: 3, risk: 'low', complexity: complexity(), test_plan: ['npm test'], ...props,
});
const backlog = tasks => ({
  schema_version: 1, epics: [{ id: 'EP-001', title: 'Planeación' }],
  stories: [{ id: 'US-001', epic_id: 'EP-001', title: 'Sprint', acceptance_criteria: ['Criterio'] }],
  tasks,
});

test('prioriza por prioridad 1..5 y respeta capacidad sin mutar el backlog', () => {
  const source = backlog([task('TASK-003', {priority: 3, story_points: 2}),task('TASK-002', {priority: 1, story_points: 3}),task('TASK-001', {priority: 2, story_points: 1})]);
  const original = JSON.stringify(source);
  const result = planSprint(source, {capacity: 4});
  assert.deepEqual(result.selected.map(t=>t.id), ['TASK-002','TASK-001']);
  assert.equal(result.used_points,4);
  assert.equal(result.remaining_points,0);
  assert.deepEqual(result.deferred.map(t=>t.id), ['TASK-003']);
  assert.equal(JSON.stringify(source),original);
});

test('capacidad limitada permite continuar seleccionando tareas menores', () => {
  const result=planSprint(backlog([task('TASK-001',{priority:1,story_points:8}),task('TASK-002',{priority:2,story_points:2})]),{capacity:3});
  assert.deepEqual(result.selected.map(t=>t.id),['TASK-002']);
  assert.deepEqual(result.deferred.map(t=>t.id),['TASK-001']);
  assert.match(result.deferred[0].reason,/capacidad/);
});

test('solamente planifica ready, informa draft/blocked e ignora done/in_progress/in_review', () => {
  const result=planSprint(backlog([
    task('TASK-001',{status:'draft'}),task('TASK-002',{status:'blocked'}),
    task('TASK-003',{status:'done'}),task('TASK-004',{status:'in_progress'}),
    task('TASK-005',{status:'in_review'}),task('TASK-006')
  ]),{capacity:10});
  assert.deepEqual(result.selected.map(t=>t.id),['TASK-006']);
  assert.deepEqual(result.blocked.map(t=>t.id),['TASK-001','TASK-002']);
  assert.deepEqual(result.ignored.map(t=>t.id),['TASK-003','TASK-004','TASK-005']);
});

test('no selecciona tareas críticas sin aprobación humana', () => {
  const result=planSprint(backlog([task('TASK-001',{risk:'critical',priority:1}),task('TASK-002',{risk:'high',priority:2})]),{capacity:4});
  assert.deepEqual(result.selected.map(t=>t.id),['TASK-002']);
  assert.deepEqual(result.blocked.map(t=>t.id),['TASK-001']);
  assert.match(result.blocked[0].reason,/aprobación humana/i);
  assert.equal(result.selected[0].routing.reviewer.tier,'astra');
});

test('dependencias completadas permiten planificación; las pendientes quedan bloqueadas', () => {
  const result=planSprint(backlog([
    task('TASK-001',{status:'done'}),
    task('TASK-002',{dependencies:['TASK-001']}),
    task('TASK-003',{status:'draft',dependencies:['TASK-002']})
  ]),{capacity:8});
  assert.deepEqual(result.selected.map(t=>t.id),['TASK-002']);
  assert.match(result.blocked.find(t=>t.id==='TASK-003').reason,/TASK-002/);
});

test('no acepta backlogs inválidos, incluyendo READY con dependencias pendientes', () => {
  assert.throws(()=>planSprint(backlog([task('TASK-001',{status:'draft'}),task('TASK-002',{dependencies:['TASK-001']})]),{capacity:4}),/Backlog inválido/);
  assert.throws(()=>planSprint({}, {capacity:3}),/Backlog inválido/);
});

test('acepta prioridad opcional y rechaza prioridades fuera de 1..5', () => {
  assert.equal(validateBacklog(backlog([task('TASK-001',{priority:undefined})])).valid,true);
  assert.match(validateBacklog(backlog([task('TASK-001',{priority:0})])).errors.join(' '),/priority/);
  assert.match(validateBacklog(backlog([task('TASK-001',{priority:6})])).errors.join(' '),/priority/);
  assert.match(validateBacklog(backlog([task('TASK-001',{priority:2.5})])).errors.join(' '),/priority/);
});

test('desempata por ID de forma reproducible y asigna prioridad 3 por defecto', () => {
  const result=planSprint(backlog([task('TASK-002',{priority:undefined}),task('TASK-001',{priority:undefined})]),{capacity:5});
  assert.deepEqual(result.selected.map(t=>t.id),['TASK-001','TASK-002']);
  assert.equal(result.selected[0].priority,3);
});

test('a igual prioridad desempata por orden natural del ID (TASK-9 antes que TASK-10)', () => {
  const ids = ['TASK-10', 'TASK-9', 'TASK-100', 'TASK-1'];
  const result = planSprint(backlog(ids.map(id => task(id))), { capacity: 20 });
  assert.deepEqual(result.selected.map(t => t.id), ['TASK-1', 'TASK-9', 'TASK-10', 'TASK-100']);
});

test('la prioridad manda sobre el orden natural del ID', () => {
  const result = planSprint(backlog([task('TASK-9', { priority: 2 }), task('TASK-10', { priority: 1 })]), { capacity: 10 });
  assert.deepEqual(result.selected.map(t => t.id), ['TASK-10', 'TASK-9']);
});

test('el orden natural no depende del orden de entrada ni pierde precisión con números grandes', () => {
  // 9007199254740992 y 9007199254740993 son el mismo valor como Number.
  assert.equal(Number('9007199254740993'), Number('9007199254740992'));
  const ids = ['TASK-9007199254740993', 'TASK-10-B', 'TASK-7', 'TASK-9007199254740992', 'TASK-007', 'TASK-10-A'];
  const expected = ['TASK-007', 'TASK-7', 'TASK-10-A', 'TASK-10-B', 'TASK-9007199254740992', 'TASK-9007199254740993'];
  for (const order of [ids, [...ids].reverse()]) {
    const result = planSprint(backlog(order.map(id => task(id))), { capacity: 100 });
    assert.deepEqual(result.selected.map(t => t.id), expected);
  }
  // Aquí el sufijo contradice al número: un comparador basado en Number() empataría
  // 992 y 993 y desempataría por "-A" < "-B", con 993-A primero.
  const pair = ['TASK-9007199254740993-A', 'TASK-9007199254740992-B'];
  for (const order of [pair, [...pair].reverse()]) {
    const result = planSprint(backlog(order.map(id => task(id))), { capacity: 100 });
    assert.deepEqual(result.selected.map(t => t.id), ['TASK-9007199254740992-B', 'TASK-9007199254740993-A']);
  }
});

test('valida capacidad sin coerciones ni límites absurdos', () => {
  for (const capacity of [0,-1,1.5,NaN,'3',Infinity,1001,undefined]) {
    assert.throws(()=>planSprint(backlog([]),{capacity}),/capacity/);
  }
  assert.equal(planSprint(backlog([]),{capacity:1}).used_points,0);
});

test('con modelos configurados incluye route dry-run y no ejecuta ni escribe', () => {
  const result=planSprint(backlog([task('TASK-001',{risk:'medium'})]),{capacity:3,models:{luna:'small',sol:'medium',astra:'large'}});
  assert.equal(result.selected[0].routing.execution,'dry-run');
  assert.equal(result.selected[0].routing.implementer.model_id,'small');
  assert.equal(result.selected[0].routing.reviewer.model_id,'medium');
  assert.equal(result.capacity,3);
});
