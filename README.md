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
