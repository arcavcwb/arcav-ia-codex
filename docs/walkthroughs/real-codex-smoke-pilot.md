# Piloto real de Codex — Validación extremo a extremo

## Objetivo

Probar en un entorno sintético y desechable:

1. Tarea revisada y marcada ready → Git worktree aislado.
2. Context Packet + modelo Codex explícito.
3. Gate de presupuesto → reserva antes de la ejecución.
4. Telemetría Codex real o estimación conservadora.
5. QA verificable → revisión independiente posterior → aprobación humana.

**Esta guía no certifica que Codex real se haya ejecutado.** La cuenta local, la versión del CLI, los modelos disponibles y cualquier uso de cuota de suscripción solo pueden comprobarse en el equipo autenticado. El PR de esta guía no usa IA.

## Fase 0 — Preparación: no ejecutar IA

En el checkout actualizado de `arcav-ia-codex`:

```bash
git status --short
node --version
npm test
node scripts/pilot-fixture.mjs --json
```

La última instrucción crea un repo Git nuevo y archivos de configuración en un directorio temporal único. **No ejecuta Codex.** Apunta los valores devueltos para `repo_dir`, `config_dir`, `backlog_file`, `models_file` y `policy_file`.

Utiliza rutas absolutas para estas variables (sustituye los ejemplos por las rutas que imprimió el script):

```bash
export PILOT_REPO="/tmp/arcav-codex-pilot-XXXXX/repo"
export PILOT_CONFIG="/tmp/arcav-codex-pilot-XXXXX/config"
```

No ejecutes los comandos con `--execute` usando esos literales `XXXXX`: primero define tus rutas reales.

## Fase 1 — Comprobar Git y crear worktree

Se espera que los tests iniciales **fallen**: la implementación contiene intencionalmente un bug. Esta evidencia RED no es un fallo del CLI ARCAV.

```bash
# Ejecutar tests explícitos en un repositorio de ejemplo confiable.
(cd "$PILOT_REPO" && npm test)

# Validar la tarea fuera del repositorio real de ARCAV.
node bin/cli.js backlog validate --file "$PILOT_CONFIG/backlog.json"

# Vista previa: no crea worktree.
node bin/cli.js worktree create TASK-901 --repo "$PILOT_REPO" \
  --file "$PILOT_CONFIG/backlog.json" --json

# Opt-in: crea solo una rama/directorio Git aislado (sin IA).
node bin/cli.js worktree create TASK-901 --repo "$PILOT_REPO" \
  --file "$PILOT_CONFIG/backlog.json" --execute --json
```

La ruta esperada es `$PILOT_REPO.worktrees/TASK-901`. Nunca ejecuta Codex sobre el repo de ARCAV ni sobre `main`.

## Fase 2 — Verificar credenciales, compatibilidad y presupuesto

```bash
codex --version
codex login status
codex exec --help
```

Comprueba que el CLI está autenticado mediante **tu suscripción ChatGPT**, no mediante una API key que pueda generar facturación independiente. La autenticación con API key usa facturación API, que no equivale a la suscripción. No continúes si no estás seguro del método de autenticación. No guardes ni compartas tokens/cookies/credenciales. Consulta las opciones oficiales del CLI antes de ejecutar.

Abre **fuera del repo** el archivo `$PILOT_CONFIG/models.local.json` y sustituye los tres campos vacíos `luna`, `sol`, `astra` por identificadores reales admitidos por tu instalación de Codex. Para este piloto puedes repetir el mismo modelo disponible en las tres claves. El archivo vacío por defecto obliga a que el preflight falle hasta configurarlo.

Presupuesto del fixture: política interna de **10.000 tokens × 40 % = 4.000 tokens disponibles para admisión**, ventana de 24 horas y una ejecución a la vez. Esto no representa la cuota real ni una garantía de consumo duro.

```bash
node bin/cli.js budget status --repo "$PILOT_REPO" \
  --policy "$PILOT_CONFIG/budget-policy.json" --json

# No utiliza IA, no crea reserva ni worktree adicionales.
node bin/cli.js scheduler dispatch TASK-901 \
  --repo "$PILOT_REPO" \
  --file "$PILOT_CONFIG/backlog.json" \
  --models "$PILOT_CONFIG/models.local.json" \
  --policy "$PILOT_CONFIG/budget-policy.json" \
  --run-id pilot-901-first \
  --max-total-tokens 2500 --timeout-seconds 120 --json
```

La salida debe informar `execution: dry-run`, la ruta del worktree, modelo real seleccionado y `admission.allowed: true`. No debe incluir el prompt. Si falla, **no** añadas `--execute`.

## Fase 3 — Ejecución real (autorización deliberada)

**Solo cuando hayas revisado el preflight, el estado de autenticación y el repositorio temporal**, ejecuta:

```bash
node bin/cli.js scheduler dispatch TASK-901 \
  --repo "$PILOT_REPO" \
  --file "$PILOT_CONFIG/backlog.json" \
  --models "$PILOT_CONFIG/models.local.json" \
  --policy "$PILOT_CONFIG/budget-policy.json" \
  --run-id pilot-901-first \
  --max-total-tokens 2500 --timeout-seconds 120 --execute --json
```

Esto **sí llama a Codex real** en el ordenador que ejecuta el comando. El budget limit es **best-effort** y el consumo puede superar 2.500 tokens. No existe garantía de precio ni de cuota restante. No ejecutar más de una vez el mismo run ID. En caso de bloqueo o telemetría ausente, conservar el ledger; no borrarlo ni liberar la reserva manualmente sin investigar.

## Fase 4 — Verificación y revisión

Solo después de la ejecución, inspecciona:

```bash
node bin/cli.js budget status --repo "$PILOT_REPO" \
  --policy "$PILOT_CONFIG/budget-policy.json" --json

node bin/cli.js worktree status TASK-901 --repo "$PILOT_REPO" --json

# Exige atención: npm test ejecuta código del fixture confiable.
node bin/cli.js task verify TASK-901 \
  --repo "$PILOT_REPO.worktrees/TASK-901" \
  --file "$PILOT_CONFIG/backlog.json" --run-tests --json

git -C "$PILOT_REPO.worktrees/TASK-901" status --short
git -C "$PILOT_REPO.worktrees/TASK-901" diff --check
git -C "$PILOT_REPO.worktrees/TASK-901" diff -- src/customer.js
```

El cambio esperado es exclusivamente `src/customer.js`, con tests pasando. Untracked, cambios fuera de alcance, diff vacío, fallos de pruebas o telemetría inválida requieren revisión.

Puedes preparar un **handoff de revisión de solo lectura** mediante `task review-run` sin `--execute`, con `--run-tests --include-diff`. **No** activar todavía el revisor real con `--execute`: esa ruta histórica aún no pasa por Budget Manager y puede consumir cuota fuera de la política.

No hay merge automático; cualquier integración posterior exige revisión humana. No borres el directorio temporal hasta recopilar resultados y confirmar que el ledger y el worktree no contienen cambios pendientes.

## Riesgos pendientes para la siguiente etapa

- El scheduler gestiona presupuesto de implementación, no el de la revisión independiente.
- `task run --execute` y `task review-run --execute` históricos pueden invocar Codex sin gate de presupuesto. Requieren consolidación o deshabilitación para un modo de uso regulado.
- La prueba RED-first no puede verificarse únicamente por el output de un modelo.
- Validar compatibilidad real de los argumentos Codex CLI y posibles discrepancias entre eventos `turn.completed` y otros formatos.
- No declarar cerrado el piloto hasta observar un evento real del modelo y confirmar QA.

## Criterios de cierre

- [ ] Creación del fixture y worktree a partir de main.
- [ ] Pruebas del fixture en RED antes de ejecutar Codex.
- [ ] Autenticación ChatGPT verificada localmente sin factura API accidental.
- [ ] Preflight seguro y presupuesto disponible.
- [ ] Un despacho real de Codex y consumo/estimación registrados.
- [ ] Diff acotado, pruebas GREEN y QA.
- [ ] Revisión independiente con presupuesto unificado (fase posterior).
- [ ] Revisión humana del resultado final.
