# Incremento 4 — Task Context Packets

## Objetivo

Preparar un contrato reproducible para el ejecutor futuro, con límites de bytes y selección explícita de archivos. Implementación determinista y sin dependencias nuevas.

## Contrato

- `task prepare TASK-ID --file backlog.json --repo . [--models models.json] [--max-context-bytes N] [--json]`.
- Valida schema v1 y exige tarea `ready`, dependencias `done`, riesgo no crítico.
- `context_files?: string[]`: hasta 12 rutas distintas y expresas; sin exploración automática.
- Bloquea rutas fuera del repositorio, ocultas, sensibles, enlaces simbólicos y archivos binarios. El presupuesto cubre el JSON compacto, sin truncamiento silencioso.
- Registra rutas y bytes, sugiere implementador/revisor y pasos verificables RED/GREEN/REFACTOR/REVIEW/QA.
- Output `execution: dry-run`; ningún subprocess, Codex, Git o modificación de backlog.

## Verificación

`npm test`; `node --check` para los módulos afectados; prueba CLI del ejemplo. La suite nueva cubre traversal, enlaces, binarios, presupuesto, bloqueo por riesgo, CLI y no mutación.

## Límites conocidos

No se ejecuta TDD real, no hay sesiones de modelo ni telemetría de tokens. No se inspecciona código arbitrario ni se estiman tokens. La lista explícita de archivos es una selección humana y **no garantiza ausencia de secretos dentro de archivos permitidos**. El aislamiento del revisor y permisos de sandbox serán responsabilidad del ejecutor posterior. Un contexto sin archivos puede ser válido para tareas de documentación o definición de contratos.
