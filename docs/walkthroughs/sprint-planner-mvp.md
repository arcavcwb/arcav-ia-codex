# Sprint Planner — incremento 3

## Alcance

Se agrega `sprint plan --file ruta --capacity N [--models ruta] [--json]`, herramienta determinista y sin escrituras ni ejecución de agentes.

## Contrato de selección

- Validar schema V1 existente y prioridades opcionales 1..5 (defecto 3).
- Seleccionar exclusivamente `ready` cuyas dependencias estén `done`.
- Rechazar tareas críticas sin aprobación explícita (el esquema aún no permite almacenar dicha aprobación).
- Ordenar por prioridad ascendente y luego por ID; seleccionar por llenado voraz de story points, sin exceder la capacidad.
- Distinguir `selected`, `deferred` (no cabe), `blocked` (draft/blocked/crítica) e `ignored` (done/in_progress/in_review).
- Devolver la sugerencia del router `dry-run` para cada seleccionada, sin asumir que los IDs de modelos estén habilitados.
- Nunca mutar el backlog ni escribir resultado a disco.

## Calidad

Las pruebas unitarias cubren orden, desempate, capacidad, saltos por capacidad, dependencias, riesgos críticos, compatibilidad del esquema y pureza. Pruebas de CLI verifican salida de texto y JSON, entradas inválidas y ausencia de sobreescritura.

## Límites

No planifica tareas `draft` generadas directamente por PRD: antes se requiere refinamiento y Definition of Ready. El resultado no es óptimo en bin packing; prioriza reglas simples y deterministas. No provee aprobación humana, persistencia de sprints, ejecución Codex, TDD ni CI.

## Gobernanza

- Trabajo realizado fuera de `main`, en rama `feat/sprint-planner-mvp`.
- Ejecutar `npm test`, `node --check` y prueba CLI antes de PR.
- Someter a revisión independiente mediante pull request **sin merge automático**.
