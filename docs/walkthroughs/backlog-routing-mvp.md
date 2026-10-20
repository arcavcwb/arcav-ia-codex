# Walkthrough — Backlog validation & routing (dry-run)

> Branch propuesta: `feat/backlog-routing-mvp` · Base observada en GitHub: `main` al 2026-10-19. Este paquete es un **parche local**; no indica despliegue ni merge.

## Alcance del corte

- Contrato JSON V1 (`schema_version`, `epics`, `stories`, `tasks`).
- Validación de referencias, IDs globalmente únicos, criterios, dimensiones, riesgos, estados, story points, dependencias, ciclos y READY bloqueado.
- Score determinista 0–10 con perfiles lógicos Luna/Sol/Astra y esfuerzo de razonamiento sugerido; riesgo alto/crítico endurece revisión.
- CLI offline `backlog validate` y `route TASK-ID --json`; archivos de perfiles opcionales sin IDs supuestos.
- Cero dependencias nuevas; no llama APIs, no llama Codex, no modifica el checkout durante el routing.

## TDD / evidencia

1. Escribir tests de contrato, DAG, enrutamiento y CLI con `node:test`.
2. RED: `ERR_MODULE_NOT_FOUND` al importar `src/backlog/validate.js` antes de crear implementación; tests CLI también fallan con comando desconocido.
3. GREEN: pruebas superadas después de escribir los tres módulos nuevos y conectar `src/index.js`.
4. Validar sintaxis, ejecutar `npm test`, `--help` y ejemplo JSON antes del PR.

## Criterios de cierre

- `npm test` verde.
- `route` genera un JSON estructurado que explica score, nivel, implementador, revisor, aprobación humana y que es `dry-run`.
- Nunca selecciona por sí mismo un ID de modelo externo: `model_id` es `null` salvo perfil explícito.
- Tareas `ready` sólo con dependencias en estado `done`.

## Fuera de alcance / riesgos

- Descomposición automática de PRD, cálculo de costo monetario, ejecución de agentes, context packets, review realmente aislado, automatización Scrum y calidad de CI no están implementados.
- Los alias Luna/Sol/Astra son **niveles de política**, no una garantía de compatibilidad de IDs con la cuenta Codex. Validación real se incorpora en fase de ejecución.
- La validación prueba integridad formal del backlog; no garantiza completitud semántica de requisitos ni calidad final del código.
- Github connector previamente devolvió `403 Resource not accessible by integration` al intentar crear la rama. Este trabajo debe aplicarse en una rama feature con permisos de escritura.
