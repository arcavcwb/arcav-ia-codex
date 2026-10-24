# MVP 15 — Política de modelos por capacidad (solo planificación)

## Decisión aprobada

**Frontend y UI/UX → Antigravity Pro con Claude Sonnet.** Ante un fallo de calidad verificable, considerar Claude Opus como escalamiento, no como retry automático. Si Antigravity no está disponible, Codex podrá considerarse como alternativa.

Backend, SDK y arquitectura mantienen Codex como ejecutor preferido. QA guiado por IA utiliza Antigravity con Gemini y los tests deterministas del repositorio siguen siendo obligatorios. La revisión independiente de frontend se propone con Codex. OpenCode permanece como opción alternativa para backend/SDK una vez validado su adaptador.

## CLI — routing consultivo

```bash
node bin/cli.js capability route TASK-002 \
  --file docs/examples/backlog.example.json \
  --role frontend \
  --policy docs/examples/capability-policy.json --json
```

El resultado expone el ejecutor preferido, familia de modelo, escalamiento explícito y revisor propuesto. **No crea worktrees, no escribe archivos, no usa tokens ni cambia la ruta del scheduler**.

## Tres niveles que no deben mezclarse

1. **Rol lógico:** frontend, backend, sdk, architect, qa.
2. **Ejecutor:** Codex CLI, Antigravity, OpenCode.
3. **Modelo:** Claude Sonnet/Opus, Gemini o perfil Codex. Son familias preferidas, **no IDs verificados**.

Un identificador como `claude-sonnet-...` de la API de Anthropic no equivale necesariamente al selector soportado por Antigravity CLI. Por eso los `model_id` salen nulos hasta inspeccionar la CLI autenticada del equipo.

## Qué falta antes de ejecutar un frontend real

- [ ] Validar el piloto Codex TASK-901 en el equipo Linux.
- [ ] Descubrir flags/salida estructurada y modelos realmente ofrecidos por Antigravity instalado.
- [ ] Desarrollar el adapter de Antigravity, telemetría y presupuestos por proveedor.
- [ ] Conectar este selector al scheduler **sin** enviar una tarea de Antigravity al runner Codex.
- [ ] Clasificar fallos (`401` credenciales; `429` cuota; fallos de QA reales).
- [ ] Fallback explícito por intento, nuevo `run_id`, presupuesto y QA de nuevo.
- [ ] Revisión independiente y autorización humana antes de merge.

## Protección

La política no concede permisos a agentes ni cambia credenciales; los datos de una tarea no son instrucciones confiables para el router. Ninguna ruta de ejecución se selecciona sin un modelo e identidad autorizados. Ningún fallback automático ni reintentos en bucle.

**MVP 15 no implementa ejecutores adicionales.** Su alcance es un contrato de política y comandos de consulta segura.
