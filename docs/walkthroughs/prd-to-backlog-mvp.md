# Incremento 2 — PRD Markdown → Backlog JSON (MVP)

> **Desactualizado en parte (v1.2.0, 22-oct-2026):** en v1.2.0 `backlog plan` genera una sola tarea TDD (RED → GREEN → REFACTOR) por criterio, sin dependencias, en lugar de una tarea de prueba más otra de implementación; además admite `#### Acceptance criteria`, trata como contexto las viñetas previas al encabezado de criterios, fusiona las sub-viñetas, avisa del texto tras una viñeta, excluye bloques de código y comentarios HTML, rechaza los que quedan sin cerrar e ignora los separadores. Detalles en [codex-cli-pipeline-hardening.md](codex-cli-pipeline-hardening.md).

## Alcance entregado

- `src/backlog/prd.js`: parser acotado de Markdown (sin LLM), generador determinista de épicas/historias/tareas.
- `backlog plan PRD.md [--out backlog/tasks.json]`: generación de JSON, salida stdout por defecto; si se usa `--out`, escritura exclusiva (nunca sobrescribir).
- `docs/examples/prd.example.md` y `docs/examples/prd.backlog.generated.json`: caso reproducible con 2 épicas, 3 historias, 4 criterios y 8 tareas.
- `tests/prd.test.js`: estructura, dependencias, validación, duplicados, CRLF, contenido no interpretado, errores y determinismo.
- `tests/cli.test.js`: generación por CLI, validación del JSON, rechazo de sobreescrituras, fallo seguro en PRD inválido.

## Reglas de generación

1. Sólo `## Épica:`, `### Historia:` y criterios en listas son requerimientos convertibles.
2. Cada criterio genera una tarea de **prueba** y una de **implementación** con dependencia test → implementación.
3. Las tareas nacen en estado **draft**, con score, riesgo y puntos **provisionales**. No pasan automáticamente a ready.
4. Un PRD sin criterios o una historia fuera de épica produce error. Texto global no convertido produce advertencias; se necesita revisión para garantizar cobertura.
5. No ejecuta modelos, no realiza escrituras Git, no crea ramas, ni automatiza tests o code review de las tareas que genera.

## Reproducción

```bash
npm test
node bin/cli.js backlog plan docs/examples/prd.example.md --out backlog/tasks.json
node bin/cli.js backlog validate --file backlog/tasks.json
node bin/cli.js route TASK-002 --file backlog/tasks.json --json
```

Para comprobar que no sobrescribe, ejecuta de nuevo el primer comando; el CLI debe devolver un error `EEXIST` y conservar el contenido ya generado.

## Evidencia y límites

- Pruebas locales Node `node:test`: 34 casos aprobados en entorno de trabajo reconstruido con archivos verificados del repositorio (primer MVP + segundo incremento).
- No se ejecutó pipeline CI de GitHub ni review independiente; no se intentó merge.
- No se pudo escribir remotamente al repositorio mediante GitHub (integración 403 reportada anteriormente).
- Este módulo **no descompone un PRD de lenguaje natural arbitrario**. Un requisito no presentado como criterio explícito no debe tratarse como cubierto.

## Siguiente incremento sugerido

- Detector de cobertura PRD → historia → criterios → tareas (informe de elementos globales omitidos).
- Calibración/confirmación de riesgo, complejidad, dependencias entre historias y DoR.
- Sprint planner offline para tareas `ready` según capacidad y bloqueos.
- Orquestación de agentes con límite de contexto y control de tokens solo después de validar los contratos.
