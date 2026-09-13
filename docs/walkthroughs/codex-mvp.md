# Codex MVP

## Cambios

- Package convertido a `@arcav-ia/codex`.
- CLI simplificado a `init [directorio]`, `--doctor`, `--version` y `--help`.
- Scaffolder adaptado para instalar estructura nativa Codex:
  - `AGENTS.md`
  - `.codex/config.toml`
  - `.codex/agents/{architect,frontend,backend,reviewer,qa}.toml`
  - ocho skills en `.agents/skills`
  - `task.md` solo si no existe
  - `docs/walkthroughs`
  - `.gitignore`
  - `check:design` en proyectos con `package.json` compatible
- Doctor convertido a validacion Codex.
- README reemplazado por documentacion tecnica breve.

## Eliminaciones

- Modos multiple-runtime.
- Plantillas del modo corporativo heredado.
- Agentes fuera del Squad MVP.
- Configuracion MCP heredada.
- Documentacion larga del toolkit anterior.
- Instalador shell heredado.

## Arquitectura Final

El CLI mantiene una implementacion zero-dependency con Node.js nativo:

- `bin/cli.js`: entrada ejecutable.
- `src/index.js`: parseo de argumentos.
- `src/scaffolder.js`: instalacion idempotente.
- `src/doctor.js`: diagnostico del entorno Codex.
- `src/utils.js`: utilidades de filesystem, Git y package.json.
- `templates/codex`: plantillas Codex nativas.
- `templates/core-skills`: skills preservadas.

## Decisiones

- Se dejo un solo binario en `package.json` para que `npx github:arcavcwb/arcav-ia-codex init` ejecute sin ambiguedad.
- `AGENTS.md`, `.codex`, skills y `task.md` se escriben solo cuando faltan para no destruir configuracion local.
- `reviewer` usa `sandbox_mode = "read-only"` porque Codex permite declarar esa clave en archivos de subagente.
- `gh` y Codex CLI ausentes se reportan como warnings cuando no bloquean la estructura generada.
- No se agregaron dependencias.

## Pruebas

- `node --check bin/cli.js`: OK.
- `node --check src/index.js`: OK.
- `node --check src/scaffolder.js`: OK.
- `node --check src/doctor.js`: OK.
- `node --check src/utils.js`: OK.
- `npm test --if-present`: OK; no hay script de test definido.
- Proyecto temporal `/tmp/arcav-codex-test-mqDGX3`:
  - `node bin/cli.js init <tmp>`: OK.
  - segunda ejecucion de `init`: OK.
  - `node bin/cli.js --doctor`: OK.
  - estructura esperada generada.
- Proyecto temporal con `package.json` y `task.md` existente:
  - `task.md` preservado.
  - `check:design` inyectado.
  - `.gitignore` sin duplicados.
- Proyecto temporal con `AGENTS.md` y `.codex/config.toml` existentes:
  - archivos existentes preservados.
  - agentes faltantes completados.
- `npm run doctor`: OK en el propio repositorio.
- `npm run check:design`: OK.
- `npm pack --dry-run`: OK; tarball previsto `arcav-ia-codex-1.1.0.tgz`, 84 archivos.
- Busqueda residual de terminos eliminados: OK.

## Limitaciones Conocidas

- El CLI no instala ni autentica Codex CLI; solo lo detecta.
- Los modelos quedan centralmente visibles en las plantillas TOML para facilitar ajuste futuro.
- `check:design` se inyecta solo si `package.json` ya tiene un objeto `scripts`.
