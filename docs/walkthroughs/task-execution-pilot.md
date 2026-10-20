# MVP 5 — Ejecutor piloto de una tarea

## Alcance

Primera iteración de ejecución. `task run` mantiene `dry-run` por defecto; el opt-in `--execute` lanza **una sola sesión** de `codex exec`, sin shell y con sandbox `workspace-write`, aprobación `never` para impedir elevaciones de permisos no interactivas.

## Protocolo

1. Validar backlog y construir `Task Context Packet` del MVP 4.
2. Resolver un `model_id` explícito desde `--models`, nunca inferir nombres ni disponibilidad.
3. Construir un prompt limitado al contrato y los archivos declarados.
4. Si falta `--execute`, mostrar preflight sin exponer el prompt ni leer credenciales.
5. Con `--execute`, exigir `--max-total-tokens` y `--timeout-seconds`, rama de feature limpia, sin cambios no rastreados.
6. Ejecutar **una tarea** y observar eventos JSONL de Codex. Contabilizar tokens reportados en `turn.completed` y detener después de superar el presupuesto; timeout y límite de stdout para controlar recursos.
7. Exigir revisión humana del diff, de TDD/QA y de los cambios antes de aceptar o fusionar. Ni `git commit`, ni `git push` ni `git merge` automáticos.

## Lo que NO garantiza

- **El presupuesto de tokens es soft**: puede excederse en un turno antes de recibir telemetría. No hay tope duro ni cota financiera.
- El timeout y la señal `SIGTERM` son mejores esfuerzos, no un aislamiento del grupo entero de procesos. El sandbox real depende de Codex CLI y sistema operativo.
- No verifica que una sesión Codex siga RED/GREEN ni que los cambios correspondan únicamente a `context_files`; `workspace-write` se aplica al workspace, no a esa lista. Codex puede leer más archivos y AGENTS.md por su propia cuenta: el packet limita el contexto inicial, no toda la exploración futura.
- No hay revisión automática independiente, ni contador de coste API, ni tracking persistente, ni aprobación de riesgo crítico.
- El ejecutor no debe usarse todavía con repositorios sensibles sin revisión manual de los archivos seleccionados.

## Pruebas y cierre

`npm test` y GitHub Actions en Node 18/22. Tests del runner usan proceso y eventos simulados, sin invocar Codex real. Comprobar rechazo de `main`, worktree sucio, ausencia de modelo y telemetría faltante. Revisión humana antes de cualquier merge.
