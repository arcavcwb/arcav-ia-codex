# Task - Endurecer CLI de Codex y pipeline

Rama: `fix/codex-cli-pipeline-hardening`. Origen: análisis del repositorio (22-oct-2026).

## Alta

- [x] `task run --execute`: `argv` que Codex acepta y aplica (`-c approval_policy="never"` justo después de `exec`), con test del `argv` completo.
- [x] Plantillas `.codex`: quitar modelos fijados (retirados o no listados) y `sandbox_mode` en agentes (no aplica en archivos de agente).

## Media

- [x] Un solo modelo de TDD: una tarea RED → GREEN → REFACTOR por criterio en `backlog plan`.
- [x] Revisor: `--output-schema` y `--output-last-message`; tolerar mensajes previos (cuenta el último) y un único bloque de código markdown.
- [x] `--base <ref>` en `task verify`, `task review` y `task review-run`.
- [x] Parser de PRD: `Acceptance criteria`, viñetas de contexto y sub-viñetas.
- [x] `task run` guarda el mensaje final del implementador en un archivo temporal.

## Baja

- [x] Detección de diff binario anclada a las cabeceras.
- [x] Hash del diff sobre bytes y rechazo explícito de texto no UTF-8.
- [x] Orden natural de IDs en el sprint.
- [x] Mensajes de error exactos y `--help` completo.

## Revisión adversarial

- [x] Informe del implementador escrito por el CLI (`O_EXCL`, `0600`), sin `--output-last-message`.
- [x] Stream de Codex: 8 MiB por línea y 256 MiB en total; revisor hasta 128 KiB y solo `turn.failed` invalida.
- [x] QA: check `worktree_unchanged_by_tests` y `note` en el handoff.
- [x] CLI: rangos antes de leer archivos, `task run` exige `--models`, `backlog plan --out --json`, `Base:` en `review-run` y tuberías completas.
- [x] PRD: `#` posteriores, texto tras viñetas, cercas CommonMark, comentarios HTML, separadores y marcadores PT-BR.
- [x] Test de contrato: valores de `-c` con `features list`.
- [x] Revisión final: límite de 8 MiB, nota del worktree con archivos, `EPIPE` en tuberías, `#` en código indentado, sub-viñeta `-` vacía y rangos en `src/limits.js`.

## Higiene

- [x] `init` añade el binario de `impeccable` al `.gitignore` del proyecto.
- [x] Borrar `.agents/agents/` (agentes del toolkit anterior).
- [x] Descripción, banner y versión 1.2.0.
- [x] Helper compartido para procesos `codex exec` y tabla declarativa de flags.
- [x] Test de contrato opcional contra `codex exec --help`.
- [x] README y walkthrough.
- [x] `npm test` en verde y ejemplos del README verificados.
- [x] Commit, push y Pull Request contra `main`.
- [x] Protección de `main` en GitHub: checks `tests (18)` y `tests (22)` obligatorios, también para administradores; sin force push ni borrado.
