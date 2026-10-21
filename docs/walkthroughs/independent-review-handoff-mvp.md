# MVP 7 — Handoff para revisión independiente

## Objetivo

Preparar un paquete reproducible para un **revisor distinto del implementador** basado en criterios de aceptación y evidencia de QA, sin invocar agentes, sin aprobar automáticamente un merge y sin compartir el historial de la sesión que implementó el cambio.

## CLI y controles

```bash
node bin/cli.js task review TASK-001 --file backlog/tasks.json --repo . --json
node bin/cli.js task review TASK-001 --file backlog/tasks.json --repo . \
  --run-tests --test-timeout-seconds 120 --include-diff --max-review-bytes 32768 --json
```

1. `task review` usa `verifyTaskChanges` del MVP 6 y valida el backlog, el estado (`ready`, `in_progress`, `in_review`), las dependencias y el riesgo no crítico. No puede ejecutarse sobre `main` o `master` ni sin un `main` local para calcular el ancestro común.
2. Calcula la evidencia del diff para **todos los cambios rastreados** desde el ancestro común con `main`, incluyendo cambios no confirmados, y detecta archivos sin seguimiento. Es evidencia de rama, **no atribución verificable por tarea**: si una rama contiene cambios ajenos, también entrarán en el diff.
3. Requiere `--run-tests` para ejecutar `npm test` (operación con efectos secundarios bajo control del proyecto) y marcar QA como suficiente para solicitar revisión. El timeout es configurable entre 10 y 600 segundos.
4. Solo incluye el contenido completo del diff con `--include-diff`, cuando `ready_for_independent_review` es verdadero. Los bytes del diff deben estar dentro del límite de 4 a 128 KiB y su SHA-256 debe coincidir con la evidencia previa; el diff binario queda rechazado. **Ningún contenido de código se envía a un agente automáticamente.**
5. Emite un contrato de revisión con perfil sugerido (`routeTask`), criterios y pruebas, observaciones a solicitar y banderas explícitas: `tdd_red_proven: false`, `independent_review_completed: false`, `merge_approved: false`. No cambia estados, archivos, commits, PRs ni credenciales.

## Modelo de amenazas y límites

- Los archivos y el diff pueden contener credenciales incluso cuando pasan `git diff --check`: revisar **antes de copiar o compartir** el handoff. No hay escáner automático de secretos.
- Si el código cambia durante la verificación, el hash de QA se revalida justo antes de insertar el diff, pero no existe bloqueo atómico de todo el worktree.
- Una prueba aprobada no demuestra TDD RED-first. Un handoff listo no demuestra revisión independiente ni garantiza ausencia de defectos.
- El revisor es **sugerido**, no invocado: separación de contexto y ejecución real del revisor quedan para un incremento posterior.
- Los tests y otros comandos de la rama son código no confiable si el repositorio lo es. El script `npm test` puede modificar archivos.

## Verificaciones recomendadas

`npm test` (Node 18/22 en GitHub Actions) y `node --check` en módulos modificados. Los tests cubren CLI, seguridad de flags, diff opcional y limitado, hash, bloqueos por QA, rama protegida, riesgo crítico y aislamiento lógico. **Merge solo tras revisión humana del PR y CI verde.**
