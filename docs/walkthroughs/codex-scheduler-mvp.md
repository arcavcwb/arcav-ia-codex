# MVP 12 — Codex Scheduler (despacho controlado)

## Alcance entregado

Conecta **tarea ready + dependencias resueltas + worktree limpio + reserva compartida** con un solo proceso Codex, iniciado únicamente con `--execute`.

**Este MVP no es un scheduler autónomo**: no ejecuta tareas en background, no crea worktrees, no lanza varios procesos, no hace retries ni merges. Tampoco conecta todavía la revisión independiente al Budget Manager.

## Flujo seguro

1. Requiere checkout principal en `main`, un worktree `feat/TASK-ID` registrado, limpio y en el mismo commit que `main`.
2. Valida todo el backlog, `ready`, riesgo no crítico y dependencias en `done` mediante `prepareTaskPacket`.
3. Prepara el contexto seguro y plan Codex con `--models` explícito.
4. Consulta la disponibilidad del presupuesto compartido.
5. Solo si existe `--execute`, reserva tokens mediante lock exclusivo y operación atómica.
6. Ejecuta Codex `workspace-write` **dentro del worktree**; nunca en `main`.
7. Tras terminar, registra uso informado por eventos del CLI, o imputa la reserva como estimación si la telemetría es incompleta.
8. Informa `completed_needs_review` u otro estado; **no aprueba merge**.

## Preparación manual

Debes crear una tarea `ready` en un backlog válido con dependencias terminadas; si el backlog V2 está en `draft`, revisarlo y promoverlo a `ready` antes de usar el scheduler. El comando `worktree create` ya existente realiza la preparación aislada:

```bash
node bin/cli.js worktree create TASK-001 --repo . --file /ruta/backlog.json --execute
```

Crea archivos JSON de modelos y política fuera del repositorio que revisa Codex cuando corresponda. Verifica tus IDs de modelo reales antes de ejecutar; no uses los ejemplos como si fueran IDs válidos de producción.

### 1. Dry-run sin invocar IA

```bash
node bin/cli.js scheduler dispatch TASK-001 \
  --repo . \
  --file /ruta/backlog.json \
  --models /ruta/modelos-local.json \
  --policy docs/examples/budget-policy.codex.json \
  --run-id intento-001 \
  --max-total-tokens 4000 \
  --timeout-seconds 120 \
  --json
```

El resultado no contiene el prompt. El `run_id` es único por intento, incluyendo retries.

### 2. Ejecución real autorizada

El mismo comando con `--execute` al final inicia **una sesión Codex**. Esto consume la cuota disponible en la cuenta local, sujeto a las reglas del proveedor. El tope interno de tokens **no es duro**.

## Fallos conservadores

- Sin telemetría completa: contabiliza la reserva total como estimación.
- Codex falla al arrancar: contabiliza estimación; los intentos nuevos requieren `run_id` distinto.
- Error al reservar: Codex **no se inicia**.
- Error al liquidar: el registro permanece reservado, bloqueando capacidad hasta inspección manual.
- Caída del proceso padre: la reserva persiste y también bloquea capacidad.
- Si `git status` detecta cambios, el scheduler bloquea nuevas ejecuciones hasta que se resuelva manualmente el estado.
- Si `main` avanzó o el worktree contiene commits propios, este MVP exige sincronización manual antes de otro despacho.

## Límite explícito de cobertura

Los comandos **anteriores** `task run --execute` y `task review-run --execute` siguen existiendo sin consultar este scheduler ni el registro presupuestario. No utilizarlos para flujos donde se exija control de presupuesto; una futura migración debe desactivar esos caminos paralelos o integrarlos con el mismo gate. El revisor independiente presupuestado y los reintentos automatizados quedan pendientes.

## Criterios de cierre

- [ ] Tests de preflight y dependencias, bloqueo por presupuesto y worktree sucio.
- [ ] Test con ejecutor Codex simulado: verifica directorio del spawn, liquidación real y ausencia de merge.
- [ ] Tests de error y telemetría ausente, consumo estimado y contención de presupuesto.
- [ ] CI GitHub Actions Node 18 y Node 22.
- [ ] Revisión de PR; merge exclusivamente humano.
