# MVP 10 — Gestor de Git worktrees

## Alcance

- `worktree create TASK-ID --file backlog.json [--repo dir] [--json] [--execute]`
- `worktree status TASK-ID [--repo dir] [--json]`
- `worktree remove TASK-ID [--repo dir] [--json] [--execute]`

Una tarea `ready` del backlog validado y sin riesgo `critical` puede obtener un directorio aislado. La rama `feat/TASK-ID` nace de la rama local `main`. La ruta es fija y adyacente al repositorio: `<repo>.worktrees/TASK-ID`.

## Ejemplo: sin ejecutar modelos

```bash
node bin/cli.js worktree create TASK-001 --repo . --file /ruta/backlog/tasks.json --json
node bin/cli.js worktree create TASK-001 --repo . --file /ruta/backlog/tasks.json --execute
node bin/cli.js worktree status TASK-001 --repo . --json

# Dentro del worktree, cuando la tarea haya sido autorizada:
cd ../<repositorio>.worktrees/TASK-001
npm test
```

## Retiro seguro

```bash
node bin/cli.js worktree remove TASK-001 --repo . --json
node bin/cli.js worktree remove TASK-001 --repo . --execute
```

Para retirar, se exige que el directorio esté limpio y la rama sea antepasado de `main`: ningún commit pendiente de integración. No se usan `--force`, `git reset`, cambios automáticos de rama ni borrado de ramas. La rama local se conserva para auditoría.

## Restricciones

1. Los comandos `create/remove` requieren ejecutarse desde el checkout principal de `main`.
2. Usa la rama local `main` como base: antes de crear, actualiza manualmente `main` cuando corresponda. No hace `fetch`, `pull` ni `push` automático.
3. IDs estrictos `TASK-...`; no acepta rutas o nombres de ramas arbitrarios.
4. Rechaza destinos existentes, directorios simbólicos, repositorios no-root y worktrees huérfanos.
5. Los worktrees **no comparten cambios no integrados**. El agente y el revisor se conectarán en una fase posterior; este MVP solo gestiona su ciclo de vida.
6. Un worktree independiente no aísla bases de datos, puertos ni recursos externos.
7. No cambia estados del backlog, no ejecuta Codex, no autoriza PR ni merge. **No consume tokens**.

## Criterios de cierre

- [ ] `npm test` en Node.js 18 y 22.
- [ ] Crear, inspeccionar y retirar worktree temporal de forma reproducible.
- [ ] Bloquear retiro sucio o con commits no integrados.
- [ ] Confirmar que la rama queda conservada y `main` no se altera.
- [ ] Revisar el PR y habilitar merge humano.
