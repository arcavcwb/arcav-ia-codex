# MVP 6 — Verificación local de cambios por tarea

> **Desactualizado en parte (v1.2.0, 22-oct-2026):** en v1.2.0 la base del diff es configurable con `--base <ref>` (por defecto `main`), el SHA-256 se calcula sobre los bytes crudos del diff y `ready_for_independent_review` exige además que `npm test` no modifique el worktree (`worktree_unchanged_by_tests`). Detalles en [codex-cli-pipeline-hardening.md](codex-cli-pipeline-hardening.md).

## Objetivo

Transformar una ejecución que solicita revisión humana en un informe de QA reproducible sin consumir tokens de IA. El módulo inspecciona Git y ejecuta el test suite **solo bajo autorización explícita**.

## Contrato

`task verify TASK-ID --file backlog.json --repo DIR [--run-tests] [--test-timeout-seconds 120] [--json]`

- Valida backlog, tarea existente y estado `ready` / `in_progress` / `in_review`; detiene riesgo crítico y dependencias pendientes.
- Exige ser raíz de un Git repo, rama de feature y un ancestro común con `main`.
- Calcula el diff completo de archivos trackeados (incluye HEAD, staged y unstaged) respecto del ancestro común; identifica rutas modificadas, archivos sin registrar y `git diff --check`.
- Registra `diff_sha256`, `branch`, `base_sha`, `head_sha`, número de archivos, resultados y códigos de salida **sin mostrar el diff ni logs completos**.
- Por defecto no ejecuta comandos de proyecto. Con `--run-tests` invoca `npm test` (sin shell de ejecución directa), timeout 10–600 segundos y salida limitada. `npm test` **sí puede invocar comandos del script del proyecto**: úsalo solo en código confiable.
- `ready_for_independent_review` exige diff real, ningún archivo untracked, whitespace limpio y tests ejecutados exitosamente.
- `tdd_red_proven: false`, `independent_review_completed: false`, `merge_approved: false` siempre en este incremento.

## Ejemplos

```bash
node bin/cli.js task verify TASK-001 --file backlog/tasks.json --repo . --json
node bin/cli.js task verify TASK-001 --file backlog/tasks.json --repo . --run-tests --json
npm test
```

## Alcance de seguridad y límites

- Esto no es un sistema de verificación de cobertura, detección de secretos ni seguridad de dependencias.
- Una suite exitosa no demuestra que la implementación cumple los criterios de aceptación ni que se escribió primero la prueba RED.
- Los archivos nuevos deben estar al menos registrados con Git para ser capturados en el diff; untracked bloquea la solicitud de review.
- No valida automáticamente que los archivos modificados correspondan exactamente a la tarea. `context_files` limita lecturas iniciales, **no** es una allowlist de escrituras.
- No hay invocación de Codex, revisión automática independiente, escrituras ni cambios de estado del backlog.

## Definition of Done (MVP 6)

Pruebas para git feature/main, cambios trackeados y untracked, whitespace, opt-in de tests, failures/timeouts, sin diff, validaciones de tarea, y CLI con test real en repositorio temporal. CI obligatorio antes de merge.
