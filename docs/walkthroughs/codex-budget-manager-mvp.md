# MVP 11 — Budget Manager para Codex

## Propósito

Un **presupuesto interno de admisión** por proveedor Codex, compartido entre worktrees vinculados a un mismo repositorio, sin invocar modelos ni facturar. Los tokens reportados por Codex son telemetría técnica; la cuota real de una suscripción y el coste USD **no se conocen** a partir de estos eventos.

Este MVP conserva Node 18/22 y cero dependencias: utiliza `ledger.json` con un **lock exclusivo de sistema de archivos** y escritura por renombrado atómico en el directorio Git compartido, obtenido por `git rev-parse --git-common-dir`. No afirma utilizar SQLite. La migración a SQLite debe realizarse a través de un adapter probado, sin romper los contratos públicos. No introducir `node:sqlite` experimental en Node 18.

## Configurar política

Ejemplo: [`docs/examples/budget-policy.codex.json`](../examples/budget-policy.codex.json). Es solo un ejemplo de presupuestos **internos**, NO una cuota oficial de Codex.

- `window_hours`: ventana propia de ARCAV (1..168 horas).
- `token_budget`: límite interno de referencia.
- `threshold_pct`: porcentaje máximo para comenzar nuevas reservas.
- `max_in_flight`: máximo de reservas abiertas simultáneamente.

Cap de admisión = `floor(token_budget * threshold_pct / 100)`. Se incluyen uso liquidado dentro de la ventana + **todas las reservas pendientes** (incluso las antiguas), para no liberar capacidad por un proceso perdido.

## Reproducción sin IA

```bash
# Solo lectura, sin crear estado
node bin/cli.js budget status --repo . --policy docs/examples/budget-policy.codex.json --json

# Plan sin modificar ningún archivo
node bin/cli.js budget reserve --repo . --policy docs/examples/budget-policy.codex.json \
  --run demo-001 --task TASK-001 --tokens 3000 --json

# Reserva real: requiere --execute, NO llama a Codex
node bin/cli.js budget reserve --repo . --policy docs/examples/budget-policy.codex.json \
  --run demo-001 --task TASK-001 --tokens 3000 --execute --json

# Liquidar telemetría reportada; cached es subconjunto de input
node bin/cli.js budget settle --repo . --policy docs/examples/budget-policy.codex.json \
  --run demo-001 --input 1300 --output 500 --cached 800 --execute --json
```

Si Codex termina sin telemetría, se registra como **estimación**, nunca cero:

```bash
node bin/cli.js budget settle --repo . --policy docs/examples/budget-policy.codex.json \
  --run demo-002 --estimated --execute --json
```

Cada `run_id` es único; el reintento requiere un nuevo ID. No se permiten asentamientos dobles ni liberar reservas sin evidencia. Si cae el proceso sin liquidar, la reserva permanece y bloquea capacidad: inspección/recuperación manual antes de permitir más trabajo.

## Garantías y límites

1. Nunca ejecuta Codex: este módulo expone **admisión + registro**. El scheduler del siguiente incremento lo conectará antes del spawn de implementación y revisión. Las ejecuciones actuales `task run --execute` y `task review-run --execute` **todavía no consultan automáticamente esta política**; no asumir lo contrario.
2. Las consultas solo lectura no crean carpetas ni archivos. Las mutaciones exigen `--execute`.
3. El bloqueo exclusivo es conservador y **fail-closed**: error de lectura, lock retenido o ledger malformado impide nuevas reservas. No se quita un lock automáticamente.
4. Ninguna reserva limita una llamada Codex ya comenzada: el consumo observado puede superar tanto el estimado como el límite interno.
5. `cached_input_tokens` se contabiliza dentro de `input_tokens`; `reasoning_output_tokens` ya está dentro de `output_tokens`. No sumarlos dos veces.
6. La ventana se calcula por `settled_at`, una aproximación conservadora del momento de consumo. Se conserva historial para auditoría; el archivo tiene límite de tamaño.
7. El ledger Git-local no rastrea usos de Codex interactivo ni desde repositorios Git independientes. No refleja límites oficiales de suscripción ni tarifas API.
8. Los archivos de estado viven en el directorio Git común, nunca en el working tree ni en `main`.

## Criterios de cierre

- [ ] Pruebas de repositorio y worktree enlazado, sin fugas a Git.
- [ ] Contención de reserva, concurrencia máxima, ventana móvil, telemetría estimada y exceso sobre reserva.
- [ ] Corrupción y lock persistente bloquean reservas; no hay recuperación automática peligrosa.
- [ ] Node 18 + 22 con GitHub Actions verdes.
- [ ] PR revisado; merge solo por intervención humana.
