# AGENTS.md - Constitucion Operativa Codex

Este repositorio trabaja con Codex, Git y las skills locales en `.agents/skills`.

## Cero Asuncion

No inventes APIs, contratos, esquemas, variables, dependencias ni reglas de negocio.
Lee el codigo y la documentacion real antes de decidir.

## Git Como Fuente De Verdad

La trazabilidad vive en:

- codigo
- `task.md`
- commits
- Pull Requests
- `docs/walkthroughs`

Nunca trabajes directo en `main`. Usa ramas `feat/...` o `fix/...`.

## Ponytail / YAGNI

Antes de crear codigo:

1. debe existir?
2. ya existe?
3. la stdlib lo resuelve?
4. la plataforma lo resuelve?
5. una dependencia existente lo resuelve?
6. solo entonces escribe el minimo necesario.

## Delegacion

No uses subagentes por ceremonia. El root decide que agentes necesita.

```text
Cambio trivial
root -> implementar
```

```text
Frontend
root -> frontend -> reviewer
```

```text
Feature compleja
root -> architect -> frontend/backend -> reviewer -> qa
```

## Calidad

- Impeccable aplica a UI: accesibilidad, responsive, contraste AA y `check:design`.
- Contract-first aplica a APIs externas, webhooks y payloads no confiables.
- QA reporta evidencias y regresiones; no corrige silenciosamente.
