# MVP 9 — Atomización V2

## Objetivo

Planificar unidades de trabajo verificables a partir de PRDs **estructurados** con trazabilidad criterio → tarea y dependencias explícitas. No utiliza modelos, no escribe cambios Git y no ejecuta agentes.

## Ejecución

\`\`\`bash
# V1 sigue intacto: dos tareas mecánicas (prueba + implementación) por criterio
node bin/cli.js backlog plan docs/examples/prd.example.md

# V2: una unidad por historia, con TDD dentro de cada unidad
node bin/cli.js backlog plan-v2 docs/examples/prd.example.md > /tmp/backlog-v2.json
node bin/cli.js backlog validate --file /tmp/backlog-v2.json

# División deliberada de unidades y dependencias
node bin/cli.js backlog plan-v2 docs/examples/prd.example.md \
  --units docs/examples/atomization.units.json --out /tmp/backlog-units.json
node bin/cli.js backlog validate --file /tmp/backlog-units.json

# Informe completo: backlog + coverage + warnings + stats
node bin/cli.js backlog plan-v2 docs/examples/prd.example.md \
  --units docs/examples/atomization.units.json --json
\`\`\`

## Contrato del mapa de unidades

Archivo JSON \`{"schema_version":1,"units":[...]}\`. Cada unidad contiene:
- \`key\`: clave única para sus dependencias (se convierte a \`TASK-xxx\`).
- \`story_id\`: una historia \`US-xxx\` existente en el PRD.
- \`title\`: entregable identificado por el responsable técnico.
- \`criteria\`: índices desde 1 de los criterios de esa historia.
- \`depends_on\`: claves de otras unidades, no IDs generados.

El mapa **debe cubrir todos** los criterios una sola vez. El validador rechaza referencias inválidas, cobertura duplicada, omisiones, dependencias desconocidas y ciclos. Las dependencias entre historias no se infieren; deben declararse explícitamente.

## Contrato de salida

Mantiene \`schema_version:1\`. Solo en V2 añade \`planning: {strategy:"coherent_v2",review_required:true}\` y \`requirement_refs\` por tarea, por ejemplo \`["US-001:AC-002"]\`. La validación exige cobertura y correspondencia textual; \`--json\` aporta el informe de auditoría. \`--out\` nunca sobrescribe.

Todas las tareas quedan en \`draft\`: riesgo, story points, complejidad, prioridad y plan de pruebas son **provisionales**. El plan TDD RED → GREEN → REFACTOR no constituye evidencia de pruebas realizadas. Con más de 3 criterios por historia se advierte que puede ser necesario dividir.

## Límites que requieren revisión humana

1. El parser original solo acepta épicas, historias y listas de criterios explícitas; el texto global no convertido permanece como advertencia.
2. Los refs \`US-xxx:AC-xxx\` son posicionales; cambiar el orden del PRD obliga a regenerar y revisar mapas y referencias.
3. La agrupación por historia no garantiza tamaño óptimo: el técnico define unidades con \`--units\`.
4. Aún no crea worktrees ni gestiona presupuestos. Ambos son incrementos posteriores.
5. Un backlog validado no habilita ejecución sin Definition of Ready.

## Criterios de cierre

- [ ] \`npm test\` verde en Node 18 y 22.
- [ ] Ejemplo por defecto: 3 tareas en lugar de las 8 de V1.
- [ ] Ejemplo con mapa: 4 tareas con DAG y cobertura de 4 criterios.
- [ ] CLI rechaza archivos de salida existentes y conserva V1.
- [ ] PR revisado; no se hace merge automático.
