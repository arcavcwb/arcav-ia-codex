# MVP 8 — Revisión por agente independiente (opt-in)

## Alcance

`task review-run` conecta el handoff del MVP 7 con una sesión **nueva** de `codex exec` para un revisor de IA, bajo sandbox `read-only`. La sesión no utiliza el historial de conversación del implementador, no crea commits, no cambia el backlog, y **jamás aprueba un merge**.

## Uso

```bash
# Preflight: ejecuta npm test solo porque se incluyó --run-tests; NO llama a Codex.
node bin/cli.js task review-run TASK-001 \
  --file backlog/tasks.json --repo . --models models.local.json \
  --run-tests --include-diff --max-review-bytes 32768 --json

# Opt-in explícito al revisor, con costes de modelo posibles:
node bin/cli.js task review-run TASK-001 \
  --file backlog/tasks.json --repo . --models models.local.json \
  --run-tests --include-diff --max-review-bytes 32768 \
  --max-total-tokens 4000 --timeout-seconds 120 --execute --json
```

El primer comando invoca `npm test` sobre el proyecto, que puede tener efectos secundarios; **no invoca IA**. El segundo invoca Codex y puede consumir tokens, por eso exige `--execute` y límites explícitos.

## Contrato y verificación

1. Valida el backlog, task ID, dependencias, riesgo y QA observada. Exige `npm test` exitoso, diff de texto y hash SHA-256 consistente.
2. Sólo usa `reviewer.model_id` configurado mediante `--models`. Los alias Luna/Sol/Astra son lógicos: los identificadores reales no se adivinan.
3. Prepara el prompt del revisor con **criterios, QA y diff**, no con el historial de la sesión implementadora. La revisión usa `codex exec --sandbox read-only --ask-for-approval never --ignore-user-config --ignore-rules --ephemeral --json -` en sesión nueva.
4. Comprueba la rama, commit base y HEAD, diff y ausencia de archivos nuevos antes de iniciar; después verifica que no cambió el workspace. Si cambia, rechaza el informe.
5. Consume eventos JSONL documentados `item.completed`/`agent_message` y `turn.completed`. Acepta solo respuesta JSON con `verdict: pass|needs_changes`, `summary` y hasta 30 `findings` estructurados (severidad, archivo, línea y explicación).
6. Devuelve hallazgos y telemetría observada. Incluso `verdict: pass` significa **opinión automatizada pendiente de verificación humana**, no autorización para aprobar/fusionar.

## Limitaciones conocidas

- Codex CLI **no se ejecutó con credenciales reales en pruebas**; las pruebas usan procesos simulados. Los modelos y compatibilidad de flags dependen de la versión local instalada.
- El `read-only` sandbox es una restricción operacional, **no** aislamiento absoluto ni detector de secretos. El modelo puede consultar archivos del repositorio más allá del diff, y su respuesta puede repetir contenidos sensibles. Usar sólo en repositorios y entornos confiables.
- El límite de tokens es **soft**: se verifica después de cada `turn.completed`. El gasto puede superar ese valor durante un turno. No es límite de facturación.
- El timeout es best effort. `npm test` ejecuta código del proyecto; se autoriza sólo con `--run-tests`.
- No se certifica TDD RED-first, ni seguridad del código, ni cumplimiento de cada criterio: un revisor humano debe validar el hallazgo y la CI.
- Si el diff incluye cambios de otras tareas, el revisor también los verá. No hay atribución por tarea ni aislamiento de ficheros del repositorio.

## Pruebas de cierre

`npm test`, Node 18/22 en GitHub Actions, revisión del diff y pruebas de integración que comprueben: opt-in, QA bloqueado, hash modificado, telemetría ausente, sobreconsumo, respuesta malformada, sandbox read-only, ausencia de autorización de merge.
