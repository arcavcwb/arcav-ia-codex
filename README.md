# @arcav-ia/codex

Arcav IA Codex es un CLI personal, zero-dependency, para preparar repositorios con una base operativa nativa de OpenAI Codex.

Instala:

- `AGENTS.md` con reglas cortas de trabajo.
- `.codex/config.toml`.
- cinco subagentes Codex.
- ocho skills locales en `.agents/skills`.
- `task.md` si no existe.
- `docs/walkthroughs`.
- entradas utiles de `.gitignore`.
- `check:design` cuando el proyecto ya tiene `package.json` compatible.

## Uso

```bash
npx github:arcavcwb/arcav-ia-codex init
```

Tambien puedes apuntar a otro directorio:

```bash
npx github:arcavcwb/arcav-ia-codex init ./mi-proyecto
```

## Doctor

```bash
npx github:arcavcwb/arcav-ia-codex --doctor
```

Valida Git, repositorio Git, `gh` cuando esta disponible, autenticacion de GitHub cuando es comprobable, Codex CLI, `AGENTS.md`, `.codex/config.toml`, los cinco agentes, las ocho skills, `task.md` y `docs/walkthroughs`.

## Estructura Generada

```text
proyecto/
├── AGENTS.md
├── task.md
├── .codex/
│   ├── config.toml
│   └── agents/
│       ├── architect.toml
│       ├── frontend.toml
│       ├── backend.toml
│       ├── reviewer.toml
│       └── qa.toml
├── .agents/
│   └── skills/
│       ├── impeccable/
│       ├── caveman/
│       ├── ponytail/
│       ├── contract-first-api/
│       ├── vite-modernizer/
│       ├── web-vitals-heavy-media/
│       ├── pnpm-monorepo-architect/
│       └── playwright-e2e-suite/
└── docs/
    └── walkthroughs/
```

## Agentes

- `architect`: arquitectura, investigacion, contratos y planes para tareas no triviales.
- `frontend`: componentes, responsive, accesibilidad y UI; usa Impeccable cuando aplica.
- `backend`: APIs, persistencia, seguridad, validacion, contratos y reglas de negocio.
- `reviewer`: revision independiente read-only.
- `qa`: tests, build, reproduccion de bugs, regresiones y Playwright.

## Skills

Las skills quedan disponibles para Codex desde `.agents/skills/<skill>/SKILL.md`.

- `impeccable`
- `caveman`
- `ponytail`
- `contract-first-api`
- `vite-modernizer`
- `web-vitals-heavy-media`
- `pnpm-monorepo-architect`
- `playwright-e2e-suite`

## Git-First

La trazabilidad vive en el codigo, `task.md`, commits, Pull Requests y `docs/walkthroughs`. El CLI es idempotente: ejecutar `init` dos veces preserva `task.md` existente y evita duplicados innecesarios.

## Backlog y routing determinista (MVP)

Validar un backlog estructurado sin invocar ningún modelo:

```bash
arcav-codex backlog validate --file backlog/tasks.json
arcav-codex route TASK-002 --file backlog/tasks.json --json
```

Ejemplo del contrato: [`docs/examples/backlog.example.json`](docs/examples/backlog.example.json).
Para probarlo con el código del repositorio:

```bash
node bin/cli.js backlog validate --file docs/examples/backlog.example.json
node bin/cli.js route TASK-002 --file docs/examples/backlog.example.json --json
npm test
```

El score suma cinco dimensiones independientes (`scope`, `ambiguity`, `integration`, `impact`, `verification`) de 0 a 2. Se clasifica en XS (0–2), S (3–4), M (5–6), L (7–8), XL (9–10). La clasificación sugiere el **perfil lógico** Luna, Sol o Astra para implementación y revisión, con salvaguardas por riesgo. El modo `route` es siempre `dry-run` y no ejecuta código AI ni consume tokens.

Por defecto, `model_id` es `null`: los nombres/identificadores concretos de modelos no se presuponen disponibles en tu Codex CLI. Para adjuntar IDs explícitos de tu instalación al informe usa `--models ruta/models.json` con el formato de [`docs/examples/models.example.json`](docs/examples/models.example.json). No hay fallback de modelos automático.

**Alcance de este primer MVP:** validador y router offline. La ejecución controlada, sprint planning, contexto mínimo, TDD de código de producto y review automático pertenecen a entregas posteriores. Ver [`docs/walkthroughs/backlog-routing-mvp.md`](docs/walkthroughs/backlog-routing-mvp.md).


## PRD Markdown → backlog borrador (incremento 2)

Convierte un **PRD estructurado** en épicas, historias y tareas pequeñas en formato compatible con el validador. No usa modelos de IA ni inventa detalles de negocio:

```bash
node bin/cli.js backlog plan docs/examples/prd.example.md --out backlog/tasks.json
node bin/cli.js backlog validate --file backlog/tasks.json
node bin/cli.js route TASK-002 --file backlog/tasks.json --json
```

Sin `--out`, `backlog plan PRD.md` imprime JSON directamente en stdout (útil para redirigir o inspeccionar); muestra advertencias de contenido no interpretado en stderr. Con `--out` **no sobrescribe archivos** existentes. Para regenerar, elige otro destino o administra el archivo anterior manualmente.

### Formato admitido (deliberadamente explícito)

```markdown
# PRD — Aplicación
## Épica: Gestión de clientes
### Historia: Registrar cliente
Contexto opcional para los implementadores.
#### Criterios de aceptación
- [ ] El cliente queda registrado con sus datos básicos
- [ ] El sistema rechaza datos requeridos vacíos
```

El parser también reconoce encabezados `História` y `Critérios de aceitação` en PT-BR. Admite listas simples `-`, `*`, `- [ ]` o `1.` y múltiples épicas/historias. Genera por criterio **una tarea de prueba y otra de implementación**, con dependencia de implementación hacia prueba. Todas quedan en estado `draft`; la complejidad, riesgo y story points iniciales son **marcadores provisionales**, no estimaciones semánticas confiables. Antes de pasar a `ready`, una persona debe revisar contratos, dependencias transversales, riesgo y plan concreto de TDD/QA.

El parser emite advertencias por contenido global que no mapea a historias y rechaza historias sin criterios verificables. **No acepta PRDs arbitrarios para descomposición inteligente:** esa capacidad necesitará un paso de análisis asistido por modelo, con aprobación y cobertura de requisitos. Un PRD en prosa debe estructurarse primero.

Ejemplo de entrada: [`docs/examples/prd.example.md`](docs/examples/prd.example.md). Salida de muestra: [`docs/examples/prd.backlog.generated.json`](docs/examples/prd.backlog.generated.json). Evidencias y límites: [`docs/walkthroughs/prd-to-backlog-mvp.md`](docs/walkthroughs/prd-to-backlog-mvp.md).

## Sprint Planner (dry-run)

Usa un backlog **validado** con tareas `ready` y capacidad expresada en story points:

```bash
node bin/cli.js sprint plan --file docs/examples/sprint.backlog.example.json --capacity 6
node bin/cli.js sprint plan --file docs/examples/sprint.backlog.example.json --capacity 6 --json
```

`priority` es opcional por tarea (entero `1..5`, donde `1` es la prioridad mayor). Si falta, se considera prioridad `3` para no romper los backlogs anteriores. La selección ordena por prioridad y después por ID, usando un llenado voraz determinista: una tarea que no cabe queda `deferred`, pero se pueden seleccionar tareas posteriores que sí caben.

- Solo se seleccionan tareas `ready` con todas sus dependencias en `done`. Las tareas `draft` o `blocked` se informan como bloqueadas; las terminadas o ya iniciadas quedan fuera.
- Las tareas con `risk: critical` **no se seleccionan**: falta aún un contrato explícito de autorización humana.
- Muestra modelos sugeridos por el router, sin invocar agentes. Los identificadores reales se asignan con `--models docs/examples/models.example.json` si están configurados localmente.
- No modifica estados, archivos, sprints ni presupuestos; **no ejecuta TDD ni QA**. Es una propuesta revisable, no un compromiso automático de sprint.

Siguiente etapa: autorización explícita para tareas críticas, persistencia/versionado del sprint y ejecución controlada con quality gates.

## Task Context Packets (incremento 4 · dry-run)

Prepara el contrato y el contexto **mínimo explícito** de una tarea `ready`, sin ejecutar agentes ni comandos del proyecto:

```bash
node bin/cli.js task prepare TASK-002 \
  --file docs/examples/context.backlog.example.json --repo . --json
# Opcional: --models docs/examples/models.example.json --max-context-bytes 16384
```

Cada tarea puede incluir `context_files` como array opcional de rutas relativas a `--repo`. **El sistema no descubre archivos automáticamente**: solo lee las rutas declaradas (máximo 12). Rechaza `../`, rutas absolutas, archivos ocultos, nombres sensibles, enlaces simbólicos, binarios, archivos fuera del repositorio y el exceso de presupuesto. El límite predeterminado es **32 KiB** de JSON compacto (configurable entre 4 y 128 KiB). En vez de truncar código silenciosamente, falla y solicita reducir el alcance. Las estimaciones son **bytes, no tokens**; requieren telemetría real cuando exista un ejecutor.

El paquete describe los gates **RED → GREEN → REFACTOR → REVIEW → QA** y recomienda perfiles de modelo. No los ejecuta ni certifica su cumplimiento. El revisor futuro debe recibir contrato + diff + evidencia de pruebas, **no el historial completo del implementador**. Las tareas `draft`, las dependencias pendientes y los riesgos `critical` siguen bloqueados. `--json` imprime el contenido de los archivos seleccionados; revisar manualmente esos archivos para evitar secretos incrustados en código fuente antes de compartir los paquetes con modelos o terceros. No existe aún un detector automático de secretos.

Ejemplo: [`docs/examples/context.backlog.example.json`](docs/examples/context.backlog.example.json). Alcance y pruebas: [`docs/walkthroughs/task-context-packets-mvp.md`](docs/walkthroughs/task-context-packets-mvp.md).

## Ejecutor piloto de una tarea (incremento 5 · opt-in)

**Por defecto no ejecuta Codex.** Prepara una única invocación no interactiva con el paquete mínimo de la tarea:

```bash
node bin/cli.js task run TASK-002 --file docs/examples/context.backlog.example.json \
  --repo . --models docs/examples/models.example.json --json
```

El comando de arriba es un **dry-run**: devuelve modelo elegido, bytes de prompt, tiempo y presupuesto orientativo, **sin mostrar el código de los archivos ni lanzar procesos**. Los modelos de `models.example.json` son de ejemplo; configura identificadores reales compatibles con tu Codex local antes de ejecutar.

**Solo para uso consciente en una rama de feature limpia**, después de verificar la configuración de Codex y los modelos accesibles:

```bash
node bin/cli.js task run TASK-002 --file backlog/tasks.json --repo . \
  --models models.local.json --max-total-tokens 4000 --timeout-seconds 120 --execute
```

Controles: la ejecución requiere `--execute`, presupuesto y timeout explícitos, `model_id` configurado, tarea `ready`, riesgo no crítico, Git con rama distinta de main/master y worktree limpio. Inicia `codex exec` con `--sandbox workspace-write --ask-for-approval never --json` sin shell. El resultado no transmite contenido del modelo: solo estado y métricas de tokens recogidas de `turn.completed`. No crea commits, pushes ni merges desde nuestro CLI.

**Limitación fundamental:** `--max-total-tokens` **no** es un límite duro ni de facturación. La telemetría de `codex exec --json` se observa al completarse un turno; un turno puede gastar más del presupuesto antes de que podamos detener el proceso. La ejecución final exige **code review manual**; el programa no certifica TDD ni seguridad. Los tests del ejecutor usan simulaciones, **no llaman a modelos reales**. Ver `docs/walkthroughs/task-execution-pilot.md`.

## Quality Gate del diff (incremento 6)

Después de que una tarea haya modificado una **rama de feature**, inspecciona el diff sin ejecutar agentes ni modelos:

```bash
node bin/cli.js task verify TASK-001 --file backlog/tasks.json --repo . --json
```

Para **autorizar expresamente la ejecución** del script `npm test` del repositorio:

```bash
node bin/cli.js task verify TASK-001 --file backlog/tasks.json --repo . \
  --run-tests --test-timeout-seconds 120 --json
```

Requiere Git, una rama diferente de `main`/`master`, un `main` local que permita calcular el ancestro común, una tarea `ready`, `in_progress` o `in_review`, riesgo no crítico y dependencias completadas. Evalúa el diff desde el ancestro común de `main`, archivos sin registrar, errores de whitespace (`git diff --check`), SHA-256 del diff y, bajo `--run-tests`, la salida de `npm test` con timeout. No lee secretos deliberadamente ni imprime el contenido completo del diff o los logs de pruebas. La revisión solo queda **solicitable** si se verificó un cambio real, no hay archivos sin registrar, no hay errores de formato y se ejecutaron pruebas satisfactoriamente.

**Límites:** `npm test` ejecuta scripts definidos por el proyecto y puede tener efectos secundarios; utilízalo solo en repositorios confiables. Pasar estas verificaciones **no certifica** TDD RED-first ni revisión independiente y **nunca autoriza un merge**. No se ejecuta `codex`, ni se hacen `git add`, commits o push. Más información en [`docs/walkthroughs/task-quality-gate-mvp.md`](docs/walkthroughs/task-quality-gate-mvp.md).
