# MVP 16 — Antigravity Pro con Claude Sonnet para frontend

## Qué está implementado

El comando antigravity dispatch TASK-ID conecta la política frontend (Antigravity + Claude Sonnet) con el worktree ya existente, la validación de dependencias de ARCAV y un presupuesto interno exclusivo para el proveedor Antigravity. Usa el CLI nativo agy, **no** 9Router ni la API pública de Anthropic.

El comando prepara un plan local sin invocar modelos por defecto. Solo se inicia el CLI con --execute. No se ejecutó Antigravity real con credenciales en GitHub Actions.

## Preparación en Linux

En tu equipo, comprobar la instalación y los modelos realmente disponibles:

```bash
agy --version
agy models
agy agents
```

Si no hay sesión autenticada, abre agy interactivamente y autentica tu cuenta prevista. Asegúrate de que es tu suscripción, no una conexión con API key facturable. El nombre seleccionado para --model debe aparecer literalmente en agy models y contener Claude y Sonnet; un nombre de modelo API no prueba que exista en AGY.

En el directorio del repositorio Git principal, en main:

```bash
node bin/cli.js backlog validate --file /ruta/backlog.json
node bin/cli.js worktree create TASK-001 --repo /ruta/proyecto \
  --file /ruta/backlog.json --execute
```

El worktree tiene que estar limpio, en feat/TASK-001 y en el commit de main, y la tarea debe estar ready, no crítica y sin dependencias pendientes.

## Dry-run: sin modelo, sin gastos

```bash
node bin/cli.js antigravity dispatch TASK-001 \
  --repo /ruta/proyecto \
  --file /ruta/backlog.json \
  --capabilities docs/examples/capability-policy.json \
  --budget docs/examples/budget-policy.antigravity.json \
  --model MODELO_EXACTO_DE_AGY_MODELS \
  --run-id agy-front-001 \
  --max-total-tokens 2200 --timeout-seconds 120 --json
```

Usa una ruta absoluta a capability-policy.json y budget-policy.antigravity.json si estás ejecutando el CLI desde otro directorio. El dry-run no comprueba disponibilidad del binario ni autenticación.

## Autorización de una ejecución real

Añadir --execute al comando de dry-run **en el ordenador local**. Antes del primer spawn el adaptador invoca agy models y exige slug exacto. Después reserva tokens de forma atómica dentro del Git common-dir y envía la tarea por stdin usando la interfaz documentada de AGY:

- --input-format stream-json / --output-format stream-json.
- --model con identificador explícito.
- --sandbox para restricciones de terminal.
- Sin --dangerously-skip-permissions, sin --continue, sin shell y sin fallback automático.
- Lee solo el evento terminal result.usage; ignora step_update.usage para evitar duplicaciones.
- Requiere status SUCCESS más telemetría válida para completed_needs_review; aun así **no prueba QA**.

Las herramientas que solicitan permiso pueden ser denegadas suavemente por AGY en modo headless. Comprueba los permisos en la configuración oficial y **no** saltes las aprobaciones. Las escrituras dentro del workspace pueden estar permitidas por el propio CLI, de modo que el worktree es una barrera operacional, no una allowlist de archivos.

## Presupuesto y aislamiento

- Política de ejemplo: 10.000 tokens, umbral de 40 %, 1 ejecución global simultánea.
- El ledger en Git common-dir distingue consumo Codex y Antigravity sin contar una salida varias veces. El gate global bloquea AGY si Codex ya tiene una reserva activa y viceversa bajo max_in_flight=1.
- El límite de tokens es best-effort. Un único turno AGY puede sobrepasar la reserva antes del evento final.
- Telemetría inválida o ausente: se carga el importe reservado como estimado, nunca cero.
- Cierre abrupto del proceso ARCAV: la reserva queda activa hasta una inspección manual.
- El run_id es globalmente único por intento. No reutilizar un run_id.

Después de ejecutar, verificar mediante task verify con --run-tests y revisar manualmente git diff. ARCAV no aprueba PRs ni hace merges.

## Límites pendientes

- QA autónomo con Antigravity + Gemini y revisión independiente presupuestada: NO implementados aquí.
- Escalamiento Claude Opus, reintentos y OpenCode: NO automáticos.
- Verificación de autenticación: agy models solo valida selección, no prueba identidad de cuenta ni disponibilidad real de cuota.
- No hay garantía de que un agente no lea otros archivos del workspace. No usar repositorios sensibles sin medidas de aislamiento superiores.
- Los comandos legacy task run --execute y task review-run --execute aún requieren migración al presupuesto unificado.
- Ningún modelo real se invoca durante npm test; todos los spawns del adaptador se simulan.

## Criterios de cierre

- [ ] CI Node 18 y 22 verde.
- [ ] Aislamiento, bloqueo por presupuesto y modelo desconocido probados.
- [ ] Stream AGY, conteo de uso final y fallos probados con procesos simulados.
- [ ] PR aprobado y fusionado manualmente.
- [ ] Validación real de agy en Linux pendiente de autorización y telemetría.
