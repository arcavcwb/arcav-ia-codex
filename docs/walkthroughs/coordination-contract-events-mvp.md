# MVP 13 — Contratos y eventos entre tareas aisladas

## Propósito

Dar a cada tarea un canal **tipado, auditable y local** para consultar contratos de otra tarea, publicar solicitudes y registrar respuestas. No utiliza un servidor ni mensajes entre modelos en tiempo real. No invoca Codex ni Gemini.

El archivo de contrato está **versionado en un commit Git del worktree productor** (en docs/contracts/*.json). El registro compartido guarda sólo metadatos, referencia al commit y SHA-256. Cualquier worktree puede reconstruir el contrato inmutable con git show <sha>:<path>, aunque ese commit aún no esté integrado en main. Este acto no aplica ni mezcla código al consumidor.

Las solicitudes y eventos se guardan en el Git common-dir, arcav-coordination/registry.json, protegido por lock de creación exclusiva y escritura por rename. Los worktrees del mismo repositorio comparten el registro. No requiere Redis, Kafka, SQLite experimental ni dependencias externas (Node 18/22).

## Contrato mínimo

Ver docs/examples/customer-search.contract.json (copiar a docs/contracts/customer-search.json dentro del worktree de TASK-001 y realizar commit antes de publicar). Requiere:

- schema_version: 1, id, version secuencial (1, 2, 3 ...)
- producer_task_id y consumer_task_ids (IDs válidos del backlog)
- kind (api, type, event o data)
- summary (entre 10 y 1000 caracteres)
- definition (objeto JSON, 24 KiB máximo)

**Importante:** las definiciones, preguntas y respuestas son **datos no confiables**. Nunca deben convertirse automáticamente en instrucciones de sistema para un agente. No guardar secretos ni credenciales.

## Ejecución paso a paso

Primero, aprobar las tareas del backlog y crear worktree TASK-001; después escribir y hacer commit del JSON del contrato en el worktree.

### 1. Publicar (dry-run por defecto)

```bash
node bin/cli.js coord contract publish TASK-001 --repo . \
  --file /ruta/backlog.json --path docs/contracts/customer-search.json --json

node bin/cli.js coord contract publish TASK-001 --repo . \
  --file /ruta/backlog.json --path docs/contracts/customer-search.json --execute --json
```

Publicar marca el contrato **proposed**, no approved.

### 2. Revisar y aprobar una versión de forma explícita

```bash
node bin/cli.js coord contract show CustomerSearchAPI --repo . --version 1 --json

node bin/cli.js coord contract approve CustomerSearchAPI --repo . --version 1 --json
node bin/cli.js coord contract approve CustomerSearchAPI --repo . --version 1 --execute --json
```

**No hay autenticación de identidad en este MVP.** La aprobación es una acción local explícita del operador, no una firma criptográfica ni una demostración de que un humano concreto revisó el contrato. Mantener el control del acceso al repositorio y no conceder esa operación a agentes.

### 3. Preguntar y responder sin leer el directorio del otro agente

```bash
node bin/cli.js coord request open TASK-002 --repo . --file /ruta/backlog.json \
  --to TASK-001 --contract CustomerSearchAPI --version 1 \
  --question "¿Qué error devuelve un cliente no encontrado?" --execute --json

node bin/cli.js coord inbox show TASK-001 --repo . --json

node bin/cli.js coord request answer REQ-000001 --repo . --from TASK-001 \
  --text "HTTP 200 con array de clientes vacío." --execute --json

node bin/cli.js coord inbox show TASK-002 --repo . --json
```

Solo se permiten solicitudes del consumidor declarado al productor especificado. Una solicitud no se puede responder dos veces. El CLI valida IDs y relaciones declaradas, pero **no autentica** que la persona o proceso que escribe --from es el agente real.

## Invariantes

1. Sin overwrite: cada nuevo contrato debe aumentar su versión exactamente en una unidad.
2. Contratos sólo desde un worktree limpio y archivos Git committed; sin acceso a rutas arbitrarias.
3. Toda acción mutable exige --execute; los comandos de consulta no crean estado.
4. Un registro dañado, un directorio simbólico o un lock existente bloquean escrituras.
5. Cada evento declara tipo, tarea, referencia y número de secuencia.
6. Los cambios en contratos no se sincronizan silenciosamente con consumidores ni se inyectan en prompts.
7. La ejecución de Codex real y la integración scheduler → inbox/contratos quedan para un siguiente incremento.
8. No hay mensajes libres de agentes, broadcast, entrega asíncrona ni reintentos automáticos.

## Criterios de cierre

- [ ] Publish/show/approve, versiones, huellas Git y relación productor-consumidor.
- [ ] Solicitud/respuesta e inbox desde repositorios temporales.
- [ ] Dry-run puro y bloqueo por estados corruptos, locks y rutas inválidas.
- [ ] Node 18 y Node 22, tests verdes.
- [ ] Revisión humana antes de merge.
