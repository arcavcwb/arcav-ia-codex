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
