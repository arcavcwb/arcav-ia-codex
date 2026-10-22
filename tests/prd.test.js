import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planBacklogFromPRD } from '../src/backlog/prd.js';
import { validateBacklog } from '../src/backlog/validate.js';

const simple = `# PRD — Lavandería\n\n## Épica: Órdenes de servicio\n### Historia: Registrar una orden\nComo atendente quiero registrar las prendas.\n#### Criterios de aceptación\n- [ ] El cliente queda asociado a la orden\n- [ ] Cada prenda tiene cantidad y precio\n`;

// Criterios de cada historia, para comparar el resultado de un vistazo.
const criteriaOf = backlog => backlog.stories.map(story => story.acceptance_criteria);
// Texto que sigue a " Contexto: " en la descripción de una tarea (undefined si no hay).
const contextOf = task => task.description.split(' Contexto: ')[1];

test('convierte PRD explícito en épica, historia y una tarea TDD por criterio', () => {
  const { backlog, warnings, stats } = planBacklogFromPRD(simple);
  assert.deepEqual(warnings, []);
  assert.equal(backlog.schema_version, 1);
  assert.equal(backlog.epics.length, 1);
  assert.equal(backlog.stories.length, 1);
  assert.deepEqual(stats, { epics: 1, stories: 1, criteria: 2, tasks: 2 });
  assert.deepEqual(backlog.tasks.map(t => t.id), ['TASK-001', 'TASK-002']);
  assert.deepEqual(backlog.tasks.map(t => t.dependencies), [[], []]);
  assert.ok(backlog.tasks.every(t => t.status === 'draft'));
  assert.deepEqual(validateBacklog(backlog).errors, []);
  assert.equal(backlog.stories[0].acceptance_criteria[0], 'El cliente queda asociado a la orden');
  assert.deepEqual(backlog.tasks[0], {
    id: 'TASK-001',
    story_id: 'US-001',
    title: 'Implementar (TDD): El cliente queda asociado a la orden',
    description: 'Escribir primero una prueba de aceptación que falle (RED) para: El cliente queda asociado a la orden. Implementar el cambio mínimo que la haga pasar (GREEN) y refactorizar con la suite en verde. Contexto: Como atendente quiero registrar las prendas.',
    acceptance_criteria: ['El cliente queda asociado a la orden'],
    dependencies: [],
    status: 'draft',
    story_points: 2,
    risk: 'medium',
    complexity: { scope: 1, ambiguity: 2, integration: 0, impact: 1, verification: 1 },
    test_plan: [
      'RED: prueba de aceptación reproducible para "El cliente queda asociado a la orden" que falla antes del cambio.',
      'GREEN: la prueba pasa con el cambio mínimo.',
      'REFACTOR: la suite completa sigue en verde (npm test).',
    ],
  });
});

test('IDs son secuenciales, sin cruces entre épicas/historias', () => {
  const source = `${simple}\n### Historia: Cobrar orden\n- Cobro registrado correctamente\n## Épica: Clientes\n### Historia: Registrar cliente\n- Los datos se guardan\n`;
  const { backlog } = planBacklogFromPRD(source);
  assert.deepEqual(backlog.epics.map(e => e.id), ['EP-001', 'EP-002']);
  assert.deepEqual(backlog.stories.map(s => s.id), ['US-001', 'US-002', 'US-003']);
  assert.deepEqual(backlog.tasks.map(t => t.id), ['TASK-001', 'TASK-002', 'TASK-003', 'TASK-004']);
  assert.deepEqual(backlog.tasks.map(t => t.story_id), ['US-001', 'US-001', 'US-002', 'US-003']);
  // Sin texto de contexto no se añade "Contexto:".
  assert.equal(contextOf(backlog.tasks[2]), undefined);
  assert.match(backlog.tasks[2].description, /refactorizar con la suite en verde\.$/);
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('acepta CRLF, numeración y criterios marcados, conserva Unicode', () => {
  const prd = '# PRD\r\n## Épica: Atención\r\n### Historia: Órdenes\r\n1. La descripción queda guardada\r\n2. El importe se calcula\r\n- [x] El pago queda registrado\r\n';
  const { backlog } = planBacklogFromPRD(prd);
  assert.equal(backlog.tasks.length, 3);
  assert.deepEqual(criteriaOf(backlog), [['La descripción queda guardada', 'El importe se calcula', 'El pago queda registrado']]);
});

test('no inventa tareas sin criterios; reporta error con ubicación', () => {
  assert.throws(() => planBacklogFromPRD('## Épica: Clientes\n### Historia: Alta\n'), /línea 3: historia "Alta" sin criterios de aceptación/i);
});

test('rechaza requisitos sin épica/historia y estructuras desconocidas', () => {
  assert.throws(() => planBacklogFromPRD('### Historia: Sola\n- Dado de alta'), /sin épica/i);
  assert.throws(() => planBacklogFromPRD('## Épica: Clientes\n- Faltan datos\n### Historia: Alta\n- Se guarda'), /fuera de una historia/i);
  assert.throws(() => planBacklogFromPRD('Un texto sin estructura'), /No se encontraron épicas/i);
});

test('deduplica criterio sólo dentro de su historia y avisa, no inventa duplicados', () => {
  const prd = '## Épica: Clientes\n### Historia: Alta\n- Guardar CLIENTE\n- guardar cliente  \n### Historia: Baja\n- Guardar cliente\n';
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [['Guardar CLIENTE'], ['Guardar cliente']]);
  assert.equal(backlog.tasks.length, 2);
  assert.deepEqual(warnings, ['Línea 4: criterio duplicado ignorado en US-001.']);
});

test('rechaza encabezados de nivel no soportado que podrían esconder requisitos', () => {
  assert.throws(() => planBacklogFromPRD('## Épica: A\n### Historia: B\n##### Requisito\n- Datos'), /encabezado no soportado/i);
});

test('advierte contenido global que no es convertido y nunca marca tareas ready', () => {
  const src = '# Sistema\n## Reglas globales\nDebe cumplir auditoría\n## Épica: Auditoría\n### Historia: Guardar\n- Se registra acceso\n';
  const { warnings, backlog } = planBacklogFromPRD(src);
  assert.ok(warnings.some(w => w.includes('Reglas globales')));
  assert.ok(warnings.some(w => w.includes('Debe cumplir auditoría')));
  assert.ok(backlog.tasks.every(t => t.status === 'draft'));
});

test('un "# …" posterior a la primera épica es una sección sin mapear que cierra la historia', () => {
  const prd = [
    '# PRD — Lavandería',
    '## Épica: Órdenes',
    '### Historia: Registrar orden',
    '#### Criterios de aceptación',
    '- La orden queda guardada',
    '# Fuera de alcance',
    '- Pagos con tarjeta',
    '- Integración con el ERP',
  ];
  const { backlog, warnings } = planBacklogFromPRD(prd.join('\n'));
  // El H1 de título (línea 1) no avisa; el de la línea 6 no suma sus viñetas a la historia.
  assert.deepEqual(criteriaOf(backlog), [['La orden queda guardada']]);
  assert.deepEqual(warnings, [
    'Línea 6: sección sin mapear: Fuera de alcance.',
    'Línea 7: elemento sin mapear fuera de las historias: - Pagos con tarjeta.',
    'Línea 8: elemento sin mapear fuera de las historias: - Integración con el ERP.',
  ]);
  assert.deepEqual(validateBacklog(backlog).errors, []);
  // También cierra la épica: una historia posterior necesita su propia épica.
  const later = [...prd, '### Historia: Cobrar orden', '- El cobro queda registrado'].join('\n');
  assert.throws(() => planBacklogFromPRD(later), /línea 9: historia sin épica/i);
});

test('rechaza criterios ambiguos vacíos o placeholders', () => {
  assert.throws(() => planBacklogFromPRD('## Épica: A\n### Historia: B\n- [ ] TBD\n'), /sin criterios/i);
});

test('salida es determinista y no muta el texto fuente', () => {
  const a = planBacklogFromPRD(simple);
  const b = planBacklogFromPRD(simple);
  assert.deepEqual(a, b);
});

test('admite títulos de PRD escritos en portugués BR', () => {
  const { backlog } = planBacklogFromPRD('## Épica: Serviços\n### História: Nova ordem\n#### Critérios de aceitação\n- [ ] A peça fica registrada\n');
  assert.equal(backlog.tasks.length, 1);
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('en PT-BR, "A definir" y "PENDENTE" son marcadores pendientes, no criterios', () => {
  const pending = '## Épica: Serviços\n### História: Nova ordem\n#### Critérios de aceitação\n- [ ] A definir\n- PENDENTE\n';
  assert.throws(() => planBacklogFromPRD(pending), /historia "Nova ordem" sin criterios de aceptación verificables/i);
  const { backlog, warnings } = planBacklogFromPRD('## Épica: Serviços\n### História: Nova ordem\n- [ ] A peça fica registrada\n- a definir.\n- Pendente\n');
  assert.deepEqual(criteriaOf(backlog), [['A peça fica registrada']]);
  assert.deepEqual(warnings, [
    'Línea 4: criterio vacío o marcador pendiente ignorado.',
    'Línea 5: criterio vacío o marcador pendiente ignorado.',
  ]);
});

test('admite PRD en inglés con "#### Acceptance criteria" sin distinguir mayúsculas', () => {
  const prd = [
    '# PRD — Laundry',
    '## Epic: Orders',
    '### Story: Register an order',
    'As a clerk I want to register garments.',
    '#### Acceptance criteria',
    '- [ ] The customer is linked to the order',
    '### Story: Close an order',
    '#### ACCEPTANCE CRITERIA',
    '- [ ] The total is calculated',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(warnings, []);
  assert.deepEqual(criteriaOf(backlog), [['The customer is linked to the order'], ['The total is calculated']]);
  assert.equal(contextOf(backlog.tasks[0]), 'As a clerk I want to register garments.');
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('con encabezado de criterios, las viñetas anteriores son contexto y se avisa', () => {
  const prd = [
    '## Épica: Órdenes',
    '### Historia: Registrar orden',
    'Como atendente quiero registrar prendas.',
    '- Solo en sucursales activas.',
    'Aplica también a pedidos telefónicos.',
    '* Requiere sesión iniciada.',
    '#### Criterios de aceptación',
    '- [ ] La orden queda guardada',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [['La orden queda guardada']]);
  assert.equal(backlog.tasks.length, 1);
  assert.deepEqual(warnings, [
    'Línea 4: viñeta antes de los criterios de aceptación tratada como contexto.',
    'Línea 6: viñeta antes de los criterios de aceptación tratada como contexto.',
  ]);
  // El contexto conserva el orden del documento.
  const context = 'Como atendente quiero registrar prendas. Solo en sucursales activas. Aplica también a pedidos telefónicos. Requiere sesión iniciada.';
  assert.equal(contextOf(backlog.tasks[0]), context);
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('si solo hay viñetas antes del encabezado, la historia queda sin criterios', () => {
  const prd = '## Épica: A\n### Historia: B\n- Nota de contexto\n#### Criterios de aceptación\n';
  assert.throws(() => planBacklogFromPRD(prd), /historia "B" sin criterios de aceptación/i);
});

test('sin encabezado de criterios, las viñetas siguen siendo criterios (comportamiento heredado)', () => {
  const prd = [
    '## Épica: Órdenes',
    '### Historia: Emitir comprobante',
    'Para órdenes cerradas.',
    '- La orden permite emitir un comprobante',
    '- El comprobante muestra el importe',
    '### Historia: Registrar orden',
    '- Nota previa',
    '#### Criterios de aceptación',
    '- La orden queda guardada',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  // La decisión es por historia: solo la segunda tiene encabezado.
  assert.deepEqual(criteriaOf(backlog), [
    ['La orden permite emitir un comprobante', 'El comprobante muestra el importe'],
    ['La orden queda guardada'],
  ]);
  assert.deepEqual(warnings, ['Línea 7: viñeta antes de los criterios de aceptación tratada como contexto.']);
  assert.equal(contextOf(backlog.tasks[0]), 'Para órdenes cerradas.');
  assert.equal(contextOf(backlog.tasks[2]), 'Nota previa');
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('sin encabezado de criterios, el texto tras una viñeta pasa al contexto con aviso', () => {
  const prd = [
    '## Epic: Auth',
    '### Story: Login',
    'Applies to the web app.',
    '- Given a registered user',
    '  When they submit valid credentials',
    '  Then they see the dashboard within 2 seconds',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [['Given a registered user']]);
  const context = 'Applies to the web app. When they submit valid credentials Then they see the dashboard within 2 seconds';
  assert.equal(contextOf(backlog.tasks[0]), context);
  // El texto previo a la primera viñeta (línea 3) sigue siendo contexto sin aviso.
  const moved = 'texto tras una viñeta tratado como contexto; si continúa el criterio, únelo en la misma línea.';
  assert.deepEqual(warnings, [`Línea 5: ${moved}`, `Línea 6: ${moved}`]);
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('fusiona sub-viñetas con su criterio y deduplica sobre el texto final', () => {
  const prd = [
    '## Épica: Clientes',
    '### Historia: Alta de cliente',
    '#### Criterios de aceptación',
    '- [ ] El formulario valida:',
    '  - [ ] nombre obligatorio',
    '',
    '  - [ ] email válido',
    '1. El alta notifica al cliente',
    '\t- por email',
    '- El formulario valida: nombre obligatorio; email válido',
  ].join('\n');
  const { backlog, warnings, stats } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [[
    'El formulario valida: nombre obligatorio; email válido',
    'El alta notifica al cliente: por email',
  ]]);
  assert.equal(stats.tasks, 2);
  assert.deepEqual(warnings, ['Línea 10: criterio duplicado ignorado en US-001.']);
  assert.equal(backlog.tasks[0].title, 'Implementar (TDD): El formulario valida: nombre obligatorio; email válido');
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('las sub-viñetas también se fusionan sin encabezado y en las viñetas de contexto', () => {
  const prd = [
    '## Épica: Clientes',
    '### Historia: Consultar clientes',
    '- Filtros disponibles:',
    '  - nombre',
    '  - documento',
    '#### Criterios de aceptación',
    '- El atendente puede buscar clientes',
    '### Historia: Exportar clientes',
    '- El archivo incluye',
    '  - nombre',
    '  - teléfono',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [
    ['El atendente puede buscar clientes'],
    ['El archivo incluye: nombre; teléfono'],
  ]);
  assert.equal(contextOf(backlog.tasks[0]), 'Filtros disponibles: nombre; documento');
  assert.deepEqual(warnings, ['Línea 3: viñeta antes de los criterios de aceptación tratada como contexto.']);
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('una sub-viñeta sin viñeta padre se trata como de primer nivel y se avisa', () => {
  const prd = [
    '## Épica: Órdenes',
    '### Historia: Cerrar orden',
    '#### Criterios de aceptación',
    '  - La orden queda cerrada',
    '  - El total queda fijado',
    '- Se registra la fecha',
    'Nota suelta',
    '  - Se avisa al cliente',
    '- TBD',
    '  - Se archiva la orden',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  // Las huérfanas no adoptan a las siguientes; el texto suelto y un marcador
  // pendiente tampoco sirven de viñeta padre.
  assert.deepEqual(criteriaOf(backlog), [[
    'La orden queda cerrada',
    'El total queda fijado',
    'Se registra la fecha',
    'Se avisa al cliente',
    'Se archiva la orden',
  ]]);
  assert.deepEqual(warnings, [
    'Línea 4: sub-viñeta sin viñeta padre tratada como de primer nivel.',
    'Línea 5: sub-viñeta sin viñeta padre tratada como de primer nivel.',
    'Línea 7: texto fuera de lista de criterios; revisar: Nota suelta.',
    'Línea 8: sub-viñeta sin viñeta padre tratada como de primer nivel.',
    'Línea 9: criterio vacío o marcador pendiente ignorado.',
    'Línea 10: sub-viñeta sin viñeta padre tratada como de primer nivel.',
  ]);
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('una sub-viñeta vacía o con marcador pendiente no se fusiona y se avisa', () => {
  const prd = [
    '## Épica: Clientes',
    '### Historia: Alta',
    '#### Criterios de aceptación',
    '- Validaciones:',
    '  - TODO',
    '  - POR DEFINIR',
    '- El formulario valida:',
    '  - [ ]',
    '  - nombre obligatorio',
    '  - ?',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [['Validaciones:', 'El formulario valida: nombre obligatorio']]);
  const ignored = 'criterio vacío o marcador pendiente ignorado.';
  assert.deepEqual(warnings, [`Línea 5: ${ignored}`, `Línea 6: ${ignored}`, `Línea 8: ${ignored}`, `Línea 10: ${ignored}`]);
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('las cercas de código siguen CommonMark: mismo carácter, igual o más largas y sin texto', () => {
  const prd = [
    '## Épica: Documentación',
    '### Historia: Formato',
    '- Criterio real',
    '~~~markdown',
    '```yaml',
    '- run: npm test',
    '```',
    '~~~',
    '````markdown',
    '```bash',
    '- npm test',
    '```',
    '```` texto',
    '`````',
    '- Otro criterio',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  // Las cercas de las líneas 5, 7, 10, 12 y 13 no cierran: son contenido del bloque.
  assert.deepEqual(criteriaOf(backlog), [['Criterio real', 'Otro criterio']]);
  assert.deepEqual(warnings, [
    'Línea 4: bloque de código excluido del análisis.',
    'Línea 8: bloque de código excluido del análisis.',
    'Línea 9: bloque de código excluido del análisis.',
    'Línea 14: bloque de código excluido del análisis.',
  ]);
  // Con otra comilla invertida en la misma línea es código en línea, no una cerca.
  const inline = planBacklogFromPRD('## Épica: A\n### Historia: B\n```npm test``` en verde\n- Criterio');
  assert.deepEqual(criteriaOf(inline.backlog), [['Criterio']]);
  assert.deepEqual(inline.warnings, []);
});

test('un bloque de código sin cerrar es un error en su línea de apertura', () => {
  const withClosing = closing => [
    '## Épica: Órdenes',
    '### Historia: Registrar orden',
    '- La orden queda guardada',
    '```json',
    '{"cliente": 1}',
    closing,
    '## Épica: Pagos',
    '### Historia: Cobrar orden',
    '- El cobro queda registrado',
  ].join('\n');
  // Sin cierre, o con uno más corto, de otro carácter o con texto, el resto quedaría oculto.
  for (const closing of ['', '``', '~~~', '``` json']) {
    assert.throws(() => planBacklogFromPRD(withClosing(closing)), /PRD línea 4: bloque de código sin cerrar: el resto del PRD no se analizó\./);
  }
  const { backlog } = planBacklogFromPRD(withClosing('```'));
  assert.deepEqual(criteriaOf(backlog), [['La orden queda guardada'], ['El cobro queda registrado']]);
});

test('los comentarios HTML, de una línea o de varias, se excluyen del análisis con aviso', () => {
  const prd = [
    '## Épica: Pagos',
    '### Historia: Cobrar',
    '- El cobro queda registrado',
    '<!--',
    '- Reembolsos automáticos (descartado)',
    '-->',
    '<!-- - Pagos en cuotas (descartado) -->',
    '- El recibo se envía por email',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [['El cobro queda registrado', 'El recibo se envía por email']]);
  // Tampoco pasan al contexto.
  assert.equal(contextOf(backlog.tasks[0]), undefined);
  assert.deepEqual(warnings, [
    'Línea 4: comentario HTML excluido del análisis.',
    'Línea 6: comentario HTML excluido del análisis.',
    'Línea 7: comentario HTML excluido del análisis.',
  ]);
  // Sin cierre ocultaría el resto del PRD: es un error en su línea de apertura.
  const unclosed = '## Épica: A\n### Historia: B\n- Criterio\n<!-- borrador\n- Otro criterio';
  assert.throws(() => planBacklogFromPRD(unclosed), /PRD línea 4: comentario HTML sin cerrar: el resto del PRD no se analizó\./);
});

test('un separador temático se ignora y corta la relación con la viñeta padre', () => {
  const prd = [
    '## Épica: A',
    '### Historia: B',
    '- Criterio',
    '',
    '* * *',
    '- Padre:',
    '- - -',
    '  - hija',
    '---',
    '___',
    '***',
  ].join('\n');
  const { backlog, warnings } = planBacklogFromPRD(prd);
  assert.deepEqual(criteriaOf(backlog), [['Criterio', 'Padre:', 'hija']]);
  // Los separadores no avisan ni pasan al contexto; "hija" queda sin viñeta padre.
  assert.deepEqual(warnings, ['Línea 8: sub-viñeta sin viñeta padre tratada como de primer nivel.']);
  assert.equal(contextOf(backlog.tasks[0]), undefined);
});

test('el backlog de ejemplo en docs/examples está sincronizado con su PRD', () => {
  const markdown = fs.readFileSync(new URL('../docs/examples/prd.example.md', import.meta.url), 'utf8');
  const generated = fs.readFileSync(new URL('../docs/examples/prd.backlog.generated.json', import.meta.url), 'utf8');
  const { backlog, warnings } = planBacklogFromPRD(markdown);
  assert.deepEqual(warnings, []);
  assert.equal(`${JSON.stringify(backlog, null, 2)}\n`, generated);
});

test('un "# …" con 4 espacios es código indentado: no cierra la historia', () => {
  const { backlog, warnings } = planBacklogFromPRD('## Épica: E\n### Historia: H\n- Criterio uno\n    # comentario de código\n- Criterio dos\n');
  assert.deepEqual(backlog.stories[0].acceptance_criteria, ['Criterio uno', 'Criterio dos']);
  assert.ok(!warnings.some(w => w.includes('sección sin mapear')), warnings.join('\n'));
  assert.deepEqual(validateBacklog(backlog).errors, []);
});

test('una sub-viñeta vacía sin casilla ("  -") no se fusiona y avisa', () => {
  const { backlog, warnings } = planBacklogFromPRD('## Épica: E\n### Historia: H\n- El formulario valida:\n  -\n  - email válido\n');
  assert.deepEqual(backlog.stories[0].acceptance_criteria, ['El formulario valida: email válido']);
  assert.ok(warnings.includes('Línea 4: criterio vacío o marcador pendiente ignorado.'), warnings.join('\n'));
});
