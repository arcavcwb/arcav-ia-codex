# @arcav-ia/codex

Arcav IA Codex es un CLI personal, zero-dependency, para preparar repositorios con una base operativa nativa de OpenAI Codex y recorrer un pipeline determinista de backlog a revisión.

Instala:

- `AGENTS.md` con reglas cortas de trabajo.
- `.codex/config.toml`, sin modelo fijado (ver [Modelos y sandbox](#modelos-y-sandbox)).
- cinco subagentes Codex.
- ocho skills locales en `.agents/skills`.
- `task.md` si no existe.
- `docs/walkthroughs`.
- entradas utiles de `.gitignore`, incluida `.agents/skills/impeccable/scripts/bin/`: el binario de `impeccable` (~16 MB) se copia para uso offline, pero Git lo ignora.
- `check:design` cuando el proyecto ya tiene `package.json` compatible.

## Uso

```bash
npx github:arcavcwb/arcav-ia-codex init
```

Tambien puedes apuntar a otro directorio:

```bash
npx github:arcavcwb/arcav-ia-codex init ./mi-proyecto
```

`--help` lista todos los comandos de planificación y revisión con sus opciones, el rango de cada opción entera y los valores por defecto. Cada comando valida sus opciones, incluidos esos rangos, antes de leer ningún archivo o ejecutar `npm test`, y los errores nombran la opción exacta (por ejemplo `task run no admite --base.`, `task run requiere --models.` o `--timeout-seconds requiere un entero entre 10 y 3600.`). La salida llega completa también por una tubería (`backlog plan PRD.md | jq`), aunque pase de 64 KiB.

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

- `architect`: arquitectura, investigacion, contratos y planes para tareas no triviales; no edita archivos, entrega el plan al root.
- `frontend`: componentes, responsive, accesibilidad y UI; usa Impeccable cuando aplica.
- `backend`: APIs, persistencia, seguridad, validacion, contratos y reglas de negocio.
- `reviewer`: revision independiente; no edita archivos ni ejecuta comandos que modifiquen el repositorio. Es de solo lectura por instruccion, no por sandbox (ver abajo).
- `qa`: tests, build, reproduccion de bugs, regresiones y Playwright.

## Modelos y sandbox

Las plantillas no fijan modelos: ni `.codex/config.toml` ni `.codex/agents/*.toml` declaran `model`. La sesión usa el modelo de tu configuración o, si no hay ninguno, el que recomienda Codex (*"If you don't specify a model, the ChatGPT desktop app, Codex CLI, or IDE extension uses a recommended model."*). Cada subagente hereda el modelo de la sesión que lo lanza (*"If you don't configure a subagent model or `model_reasoning_effort`, the subagent inherits the parent agent's model and reasoning effort."*). De los ajustes de modelo, los agentes solo conservan `model_reasoning_effort`: `high` en `architect` y `reviewer`, `medium` en `frontend`, `backend` y `qa`.

Para fijar un modelo disponible en tu cuenta:

- en el proyecto, descomenta la línea que trae `.codex/config.toml` (Codex solo carga la configuración del proyecto si confías en él):

  ```toml
  model = "gpt-6.1-sol"
  ```

- en una ejecución concreta, `codex --model <id>` (o `-m`); en el CLI interactivo, `/model`.

`sandbox_mode` en un archivo de agente no aplica: *"Other session settings, including `sandbox_mode`, `approval_policy`, `model_provider`, and `mcp_servers`, don't override the parent configuration when placed in a custom agent file."* Por eso los cinco agentes ya no lo declaran, y el sandbox lo fija la sesión en `.codex/config.toml` (`sandbox_mode = "workspace-write"`, `approval_policy = "on-request"` y `[agents] max_concurrent_threads_per_session = 5`).

En consecuencia, el subagente `reviewer` corre con el sandbox de la sesión padre y es de solo lectura **por instrucción**, igual que `architect`: *"Custom agent instructions can ask an agent to avoid edits, but they don't create a separate read-only sandbox."* La revisión con sandbox `read-only` forzado es `task review-run` (sección *Revisión IA independiente*). Citas de la documentación de [subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents) y de [modelos](https://learn.chatgpt.com/docs/models).

**Proyectos preparados con la versión 1.1.0 o anterior:** `init` nunca sobrescribe archivos existentes, así que la migración es manual. Borra las líneas `model = ...` y `sandbox_mode = ...` de `.codex/agents/*.toml` y la línea `model = "gpt-5.6"` de `.codex/config.toml`: `gpt-5.6` y `gpt-5.6-codex` no figuran como IDs en la página de modelos, y `gpt-5.3-codex-spark` (el de `qa`) se retiró el 14-sep-2026. Si ya versionaste el binario de `impeccable`, añadirlo a `.gitignore` no lo saca del índice: `git rm -r --cached .agents/skills/impeccable/scripts/bin/`.

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

El binario de `impeccable` que copia `init` (`scripts/bin/linux-x64/impeccable`) queda fuera de Git. Si falta, por ejemplo en un clon, el launcher `scripts/impeccable` lo busca en `$IMPECCABLE_BIN`, en `~/.impeccable` y en el `PATH`; como último recurso descarga la versión fijada y la verifica contra su `.sha256` (sin verificación, rechaza la descarga).

## Git-First

La trazabilidad vive en el codigo, `task.md`, commits, Pull Requests y `docs/walkthroughs`. El CLI es idempotente: ejecutar `init` dos veces preserva `task.md` existente y evita duplicados innecesarios.

## Backlog y routing determinista (MVP)

Validar un backlog estructurado sin invocar ningún modelo:

```bash
arcav-codex backlog validate --file backlog/tasks.json
arcav-codex route TASK-002 --file backlog/tasks.json --json
```

Ejemplo del contrato: [`docs/examples/backlog.example.json`](docs/examples/backlog.example.json).
Para probarlo con el código del repositorio:

```bash
node bin/cli.js backlog validate --file docs/examples/backlog.example.json
node bin/cli.js route TASK-002 --file docs/examples/backlog.example.json --json
npm test
```

El score suma cinco dimensiones independientes (`scope`, `ambiguity`, `integration`, `impact`, `verification`) de 0 a 2. Se clasifica en XS (0–2), S (3–4), M (5–6), L (7–8), XL (9–10). La clasificación sugiere el **perfil lógico** Luna, Sol o Astra para implementación y revisión, con salvaguardas por riesgo. El modo `route` es siempre `dry-run` y no ejecuta código AI ni consume tokens.

Por defecto, `model_id` es `null`: los nombres/identificadores concretos de modelos no se presuponen disponibles en tu Codex CLI. Para adjuntar IDs explícitos de tu instalación al informe usa `--models ruta/models.json` con el formato de [`docs/examples/models.example.json`](docs/examples/models.example.json), cuyos valores son marcadores que hay que reemplazar. No hay fallback de modelos automático.

Equivalencia sugerida para `--models`, si tu plan incluye esos modelos (ver la [página de modelos](https://learn.chatgpt.com/docs/models)):

```json
{
  "luna": "gpt-6-luna",
  "sol": "gpt-6.1-sol",
  "astra": "gpt-6-astra"
}
```

**Alcance de este primer MVP:** validador y router offline. La ejecución controlada, sprint planning, contexto mínimo, TDD de código de producto y review automático pertenecen a entregas posteriores. Ver [`docs/walkthroughs/backlog-routing-mvp.md`](docs/walkthroughs/backlog-routing-mvp.md).


## PRD Markdown → backlog borrador (incremento 2)

Convierte un **PRD estructurado** en épicas, historias y tareas pequeñas en formato compatible con el validador. No usa modelos de IA ni inventa detalles de negocio:

```bash
node bin/cli.js backlog plan docs/examples/prd.example.md --out backlog/tasks.json
node bin/cli.js backlog validate --file backlog/tasks.json
node bin/cli.js route TASK-002 --file backlog/tasks.json --json
```

Sin `--out`, `backlog plan PRD.md` imprime el backlog en JSON directamente en stdout, con o sin `--json` (útil para redirigir o inspeccionar). Las advertencias de contenido no interpretado salen siempre en stderr (`WARN Línea N: …`). Con `--out` confirma la escritura (por ejemplo, `Backlog borrador: <ruta> (4 tareas; 0 advertencias).`); con `--out` y `--json` imprime en su lugar un resumen JSON: `{ "file": <ruta absoluta>, "tasks": N, "warnings": ["Línea N: …"], "stats": { "epics", "stories", "criteria", "tasks" } }`. Con `--out` **no sobrescribe archivos** existentes. Para regenerar, elige otro destino o administra el archivo anterior manualmente.

Los IDs (`EP-NNN`, `US-NNN`, `TASK-NNN`) dependen de la posición en el PRD: **regenerar después de editarlo renumera las tareas**. No mezcles un backlog regenerado con el anterior ni con referencias a sus IDs.

### Formato admitido (deliberadamente explícito)

```markdown
# PRD — Aplicación
## Épica: Gestión de clientes
### Historia: Registrar cliente
Contexto opcional para los implementadores.
- Solo usuarios con sesión iniciada
#### Criterios de aceptación
- [ ] El formulario valida:
  - nombre obligatorio
  - email válido
- [ ] El sistema rechaza datos requeridos vacíos
```

El parser también reconoce los encabezados en PT-BR (`História`, `Critérios de aceitação`) y en inglés (`## Epic:`, `### Story:`, `#### Acceptance criteria`), sin distinguir mayúsculas. El encabezado de criterios no lleva `:` final: `#### Acceptance criteria:` se rechaza. Admite listas simples `-`, `*`, `- [ ]` o `1.` y múltiples épicas/historias.

- **Viñetas de contexto:** si la historia tiene encabezado de criterios, las viñetas anteriores son contexto, no criterios, y se avisa (`Línea N: viñeta antes de los criterios de aceptación tratada como contexto.`). Sin ese encabezado, todas las viñetas de la historia son criterios, como antes.
- **Sub-viñetas:** una viñeta indentada con 2 o más espacios o con un tabulador se fusiona con la viñeta anterior. En el ejemplo, el primer criterio queda `El formulario valida: nombre obligatorio; email válido`. Los niveles más profundos se aplanan en el mismo criterio, y una sub-viñeta sin viñeta padre se trata como de primer nivel, con aviso.
- **Texto tras una viñeta:** sin encabezado de criterios, el texto que sigue a una viñeta (por ejemplo, las líneas *Given/When/Then* de un criterio partido) pasa al contexto con aviso (`texto tras una viñeta tratado como contexto; si continúa el criterio, únelo en la misma línea.`). El texto anterior a la primera viñeta es contexto sin aviso. Con encabezado, el texto entre criterios se descarta con aviso (`texto fuera de lista de criterios; revisar: …`).
- **Marcadores pendientes:** `TODO`, `TBD`, `PENDIENTE`, `PENDENTE`, `POR DEFINIR`, `A DEFINIR` y `?`, `??`… (sin distinguir mayúsculas, con punto final opcional) no son criterios y se ignoran con aviso (`criterio vacío o marcador pendiente ignorado.`). Una sub-viñeta vacía o pendiente tampoco se fusiona: su padre queda como criterio por sí solo.
- **Encabezados `#`:** el título anterior a la primera épica se ignora sin aviso. Un `# …` posterior equivale a una sección `## …` sin mapear: cierra la historia y la épica abiertas y avisa (`sección sin mapear: <título>.`), así que sus viñetas ya no se suman a la historia anterior.
- **Bloques de código y comentarios HTML:** se excluyen del análisis con aviso (`bloque de código excluido del análisis.` y `comentario HTML excluido del análisis.`). Las cercas siguen CommonMark: tres o más `` ` `` o `~`, y solo cierra una línea del mismo carácter, igual de larga o más y sin texto (un `` ``` `` dentro de `~~~` es contenido). Un comentario empieza en una línea que comienza por `<!--` y termina en la primera línea que contiene `-->`. Un bloque o comentario sin cerrar es un error (`PRD línea N: bloque de código sin cerrar: el resto del PRD no se analizó.`, con N la línea de apertura) y `backlog plan` sale con 1 sin escribir nada.
- **Separadores** (`---`, `***`, `___`, `* * *`, `- - -`): se ignoran sin aviso y cortan la relación entre una viñeta y sus sub-viñetas.

Genera **una tarea TDD por criterio**, sin dependencias: `Implementar (TDD): <criterio>`, con una descripción RED → GREEN → REFACTOR (más `Contexto: …` si la historia lo tiene) y un `test_plan` de tres pasos: RED, GREEN y REFACTOR con la suite en verde (`npm test`). Prueba e implementación van juntas porque `task verify` exige la suite en verde antes de la revisión: una tarea que solo añadiera una prueba en rojo nunca pasaría ese gate. Todas quedan en estado `draft`, con 2 story points y riesgo `medium`; la complejidad, el riesgo y los story points son **marcadores provisionales**, no estimaciones semánticas confiables. Antes de pasar a `ready`, una persona debe revisar contratos, dependencias transversales, riesgo y plan concreto de TDD/QA.

El parser emite advertencias por contenido global que no mapea a historias y rechaza historias sin criterios verificables. El análisis es por líneas y solo aproxima CommonMark: no reconoce una cerca o un comentario que empiecen en la misma línea que una viñeta (en `` - ```js ``, la cerca de cierre se toma como apertura y el PRD se rechaza por bloque sin cerrar; pon la cerca en su propia línea), ni los encabezados subrayados (setext). **No acepta PRDs arbitrarios para descomposición inteligente:** esa capacidad necesitará un paso de análisis asistido por modelo, con aprobación y cobertura de requisitos. Un PRD en prosa debe estructurarse primero.

Ejemplo de entrada: [`docs/examples/prd.example.md`](docs/examples/prd.example.md). Salida de muestra: [`docs/examples/prd.backlog.generated.json`](docs/examples/prd.backlog.generated.json). Evidencias y límites: [`docs/walkthroughs/prd-to-backlog-mvp.md`](docs/walkthroughs/prd-to-backlog-mvp.md).

## Sprint Planner (dry-run)

Usa un backlog **validado** con tareas `ready` y capacidad expresada en story points:

```bash
node bin/cli.js sprint plan --file docs/examples/sprint.backlog.example.json --capacity 6
node bin/cli.js sprint plan --file docs/examples/sprint.backlog.example.json --capacity 6 --json
```

`priority` es opcional por tarea (entero `1..5`, donde `1` es la prioridad mayor). Si falta, se considera prioridad `3` para no romper los backlogs anteriores. La selección ordena por prioridad y, a igual prioridad, por ID en orden natural (`TASK-9` antes que `TASK-10`), sin depender del locale. Usa un llenado voraz determinista: una tarea que no cabe queda `deferred`, pero se pueden seleccionar tareas posteriores que sí caben.

- Solo se seleccionan tareas `ready` con todas sus dependencias en `done`. Las tareas `draft` o `blocked` se informan como bloqueadas; las terminadas o ya iniciadas quedan fuera.
- Las tareas con `risk: critical` **no se seleccionan**: falta aún un contrato explícito de autorización humana.
- Muestra modelos sugeridos por el router, sin invocar agentes. Los identificadores reales se asignan con `--models docs/examples/models.example.json` si están configurados localmente.
- No modifica estados, archivos, sprints ni presupuestos; **no ejecuta TDD ni QA**. Es una propuesta revisable, no un compromiso automático de sprint.

Siguiente etapa: autorización explícita para tareas críticas, persistencia/versionado del sprint y ejecución controlada con quality gates.

## Task Context Packets (incremento 4 · dry-run)

Prepara el contrato y el contexto **mínimo explícito** de una tarea `ready`, sin ejecutar agentes ni comandos del proyecto:

```bash
node bin/cli.js task prepare TASK-002 \
  --file docs/examples/context.backlog.example.json --repo . --json
# Opcional: --models docs/examples/models.example.json --max-context-bytes 16384
```

Cada tarea puede incluir `context_files` como array opcional de rutas relativas a `--repo`. **El sistema no descubre archivos automáticamente**: solo lee las rutas declaradas (máximo 12). Rechaza `../`, rutas absolutas, archivos ocultos, nombres sensibles, enlaces simbólicos, binarios, archivos fuera del repositorio y el exceso de presupuesto. El límite predeterminado es **32 KiB** de JSON compacto (configurable entre 4 y 128 KiB). En vez de truncar código silenciosamente, falla y solicita reducir el alcance. Las estimaciones son **bytes, no tokens**; requieren telemetría real cuando exista un ejecutor.

El paquete describe los gates **RED → GREEN → REFACTOR → REVIEW → QA** y recomienda perfiles de modelo. No los ejecuta ni certifica su cumplimiento. El revisor futuro debe recibir contrato + diff + evidencia de pruebas, **no el historial completo del implementador**. Las tareas `draft`, las dependencias pendientes y los riesgos `critical` siguen bloqueados. `--json` imprime el contenido de los archivos seleccionados; revisar manualmente esos archivos para evitar secretos incrustados en código fuente antes de compartir los paquetes con modelos o terceros. No existe aún un detector automático de secretos.

Ejemplo: [`docs/examples/context.backlog.example.json`](docs/examples/context.backlog.example.json). Alcance y pruebas: [`docs/walkthroughs/task-context-packets-mvp.md`](docs/walkthroughs/task-context-packets-mvp.md).

## Ejecutor piloto de una tarea (incremento 5 · opt-in)

**Por defecto no ejecuta Codex.** Prepara una única invocación no interactiva con el paquete mínimo de la tarea:

```bash
node bin/cli.js task run TASK-002 --file docs/examples/context.backlog.example.json \
  --repo . --models docs/examples/models.example.json --json
```

El comando de arriba es un **dry-run**: devuelve modelo elegido, bytes de prompt, tiempo y presupuesto orientativo, **sin mostrar el código de los archivos ni lanzar procesos**. Su `argv` es exactamente el que se lanza con `--execute`, y el campo `final_message` explica dónde quedará el mensaje final. `--models` es obligatorio también en el dry-run (`task run requiere --models.`). Los modelos de `models.example.json` son de ejemplo; configura identificadores reales compatibles con tu Codex local antes de ejecutar (ver la equivalencia sugerida en *Backlog y routing*).

**Solo para uso consciente en una rama de feature limpia**, después de verificar la configuración de Codex y los modelos accesibles:

```bash
node bin/cli.js task run TASK-002 --file backlog/tasks.json --repo . \
  --models models.local.json --max-total-tokens 4000 --timeout-seconds 120 --execute
```

Controles: la ejecución requiere `--execute`, presupuesto y timeout explícitos, `model_id` configurado, tarea `ready`, riesgo no crítico, Git con rama distinta de main/master y worktree limpio. Lanza este comando sin shell, con el prompt por stdin (`-`):

```text
codex exec -c 'approval_policy="never"' --model <id> --sandbox workspace-write --json -
```

**Política de aprobación.** Va como override de configuración `-c` justo después de `exec`, con el valor entre comillas TOML (el elemento del `argv` es `approval_policy="never"`). Con Codex 0.163.0, `--ask-for-approval` detrás de `exec` no parsea (`error: unexpected argument '--ask-for-approval' found`). Delante de `exec` el parser lo acepta, pero, según el código fuente de esa versión, `codex exec` no lo usa: fuerza `never` por su cuenta, salvo que la configuración resuelva `approvals_reviewer = "auto_review"`, y entonces reconstruye la configuración con el `approval_policy` de `config.toml` (la plantilla usa `on-request`). El override `-c` se aplica también en esa reconstrucción, de nuevo según el código fuente; no se ha comprobado con una sesión real.

**Informe del implementador.** El resultado no transmite contenido del modelo: solo estado, métricas de tokens recogidas de `turn.completed` y `report_file`. Codex no escribe ningún archivo (no se usa `--output-last-message`): el CLI retiene el último `agent_message` del stream JSONL y, cuando Codex ya terminó, lo escribe en un directorio nuevo `<tmp>/arcav-codex-XXXXXX/` (permisos `0700`) como `<TASK-ID>-mensaje-final.md`, con `O_CREAT | O_EXCL` (`flag: 'wx'`) y permisos `0600`. En modo texto solo imprime `Informe del implementador: <ruta>`; el contenido nunca se imprime. El informe se guarda también cuando el estado no es `completed_needs_review` (por ejemplo, `timeout` o `budget_exceeded`). Si no hubo mensaje, o el último no trae texto, `report_file` es `null` y no se crea nada. Si la escritura falla, `report_file` es `null`, `report_error` lleva el código (por ejemplo `EEXIST` o `ENOENT`) y en modo texto stderr muestra `No se pudo guardar el informe del implementador (<código>).` El archivo queda en disco para la revisión humana y puede contener datos sensibles: bórralo al terminar. No crea commits, pushes ni merges desde nuestro CLI.

Por qué no `--output-last-message`: Codex escribe ese archivo desde su proceso principal, fuera del sandbox, y `workspace-write` deja escribibles `/tmp` y `$TMPDIR`. Un comando de la sesión podía plantar un enlace simbólico en la ruta del informe, que es predecible (el ID de la tarea va en el prompt), y Codex, al seguir el enlace, podía sobrescribir cualquier archivo del usuario con texto controlado por el modelo. Ahora el directorio se crea después de que Codex termine, y `O_EXCL` hace fallar la escritura si la ruta ya existe, también como enlace simbólico o duro: un enlace plantado nunca se sigue.

**Límites del stream**, comunes al ejecutor y al revisor: 8 MiB por línea JSONL (Codex 0.163.0 mete hasta 1 MiB de salida de un comando en una sola línea `item.completed`, y el escapado JSON la multiplica hasta por 6 si son bytes de control), 256 MiB de stdout en total (solo se cuentan: stdout no se guarda) y 1 MB de stderr. Superarlos, o recibir una línea que no sea un objeto JSON, invalida el stream (`invalid_telemetry` en el ejecutor, `invalid_events` en el revisor) y detiene Codex.

**Limitación fundamental:** `--max-total-tokens` **no** es un límite duro ni de facturación. La telemetría de `codex exec --json` se observa al completarse un turno; un turno puede gastar más del presupuesto antes de que podamos detener el proceso. La ejecución final exige **code review manual**; el programa no certifica TDD ni seguridad. Los tests del ejecutor usan simulaciones, **no llaman a modelos reales**. Ver `docs/walkthroughs/task-execution-pilot.md`.

## Quality Gate del diff (incremento 6)

Después de que una tarea haya modificado una **rama de feature**, inspecciona el diff sin ejecutar agentes ni modelos:

```bash
node bin/cli.js task verify TASK-001 --file backlog/tasks.json --repo . --json
# Si la rama principal no es main (por ejemplo master, develop u origin/main):
node bin/cli.js task verify TASK-001 --file backlog/tasks.json --repo . --base master --json
```

Para **autorizar expresamente la ejecución** del script `npm test` del repositorio:

```bash
node bin/cli.js task verify TASK-001 --file backlog/tasks.json --repo . \
  --run-tests --test-timeout-seconds 120 --json
```

Requiere Git, una rama diferente de `main`/`master` y de la base, una referencia base (`--base`, por defecto `main`) que exista y comparta un ancestro común con `HEAD`, una tarea `ready`, `in_progress` o `in_review`, riesgo no crítico y dependencias completadas. Evalúa el diff desde `git merge-base HEAD <base>`, archivos sin registrar, errores de whitespace (`git diff --check`), SHA-256 de los bytes crudos del diff y, bajo `--run-tests`, la salida de `npm test` con timeout. No lee secretos deliberadamente ni imprime el contenido completo del diff o los logs de pruebas. La revisión solo queda **solicitable** si se verificó un cambio real, no hay archivos sin registrar, no hay errores de formato, se ejecutaron pruebas satisfactoriamente y estas no modificaron el worktree.

Con `--run-tests`, QA lee el worktree antes y después de `npm test`. Si los tests crean o borran archivos sin registrar, o cambian archivos rastreados, `checks.worktree_unchanged_by_tests` es `false` y `tests.worktree_changes` lo detalla: `new_untracked_files`, `diff_changed` y, solo si los tests borraron archivos sin registrar que ya existían, `removed_untracked_files`. Sin `--run-tests` el check es `null`. Con `--run-tests`, `changed_files`, `untracked_files`, `diff_sha256` y los demás checks describen el worktree **después** de los tests. En modo texto, `task verify` añade una línea con el motivo y los archivos, por ejemplo `npm test modificó el worktree: creó archivos sin registrar (test-report.xml). Los tests no deben escribir en el repositorio; si generan artefactos, añádelos a .gitignore.`

Fuera de un repositorio Git, `task verify`, `task review`, `task review-run` y `task run --execute` fallan con `No se encontró un repositorio Git en <ruta>.`, con la ruta de `--repo` resuelta.

`--base` existe en `task verify`, `task review` y `task review-run`. En modo texto, `task verify`, `task review` y el dry-run de `task review-run` muestran `Base: <ref> (merge-base <sha>).`; con `--execute`, `task review-run` no muestra esa línea. En JSON van en `base_ref` y `base_sha` de `task verify`, en `qa.base_ref` y `qa.base_sha` de `task review`, en `base_ref` y `base_sha` del plan de `task review-run` y en `base_ref` de su resultado con `--execute`. La referencia solo admite letras, dígitos, `.`, `_`, `/` y `-`, hasta 200 caracteres; debe empezar por letra o número y no puede contener `..` ni `//`, terminar en `/`, `.` o `.lock`, ni tener segmentos que empiecen por `.`. Si no, falla con `--base: referencia Git inválida: <ref>.`; por eso se rechazan nombres de rama que Git sí admite, como `v1+x` o `user@fix` (en ese caso, usa el SHA del commit). Si la base no existe (por ejemplo, un repositorio cuya rama principal es `master`), el error es `No existe la referencia base 'main'. Usa --base <rama> (por ejemplo master u origin/main).`

**Límites:** `npm test` ejecuta scripts definidos por el proyecto y puede tener efectos secundarios; utilízalo solo en repositorios confiables. Pasar estas verificaciones **no certifica** TDD RED-first ni revisión independiente y **nunca autoriza un merge**. No se ejecuta `codex`, ni se hacen `git add`, commits o push. Más información en [`docs/walkthroughs/task-quality-gate-mvp.md`](docs/walkthroughs/task-quality-gate-mvp.md).


## Handoff de revisión independiente (incremento 7 · sin agentes)

Después de modificar una rama de feature, construye un contrato de revisión a partir del diff y los resultados de QA. Por defecto, **no ejecuta pruebas ni incluye contenido de código**:

```bash
node bin/cli.js task review TASK-001 --file backlog/tasks.json --repo . --json
```

Para autorizar `npm test` y, opcionalmente, incluir el diff completo en el JSON (inspeccionar antes por posibles secretos):

```bash
node bin/cli.js task review TASK-001 --file backlog/tasks.json --repo . \
  --run-tests --test-timeout-seconds 120 --include-diff --max-review-bytes 32768 --json
```

Admite `--base <ref>` igual que `task verify`. El handoff incluye la rama, `head_sha`, `base_ref`, `base_sha`, SHA-256 del diff, archivos cambiados, resultado de `git diff --check`, pruebas ejecutadas y perfil sugerido de revisor independiente. Si fallan las comprobaciones o las pruebas no se han ejecutado, se bloquea la inclusión del diff. El límite del diff es **en bytes**, no en tokens. `--include-diff` solo se admite con un diff de texto UTF-8 válido y un QA aprobado; nunca se incluye el historial de conversación del implementador. Un diff con texto no UTF-8 se rechaza (`Diff con texto no UTF-8: revisar manualmente sin incluirlo en el handoff.`), y los binarios se detectan por las cabeceras que escribe git (`GIT binary patch`, `Binary files … differ`), no por menciones en el contenido. QA, el handoff y el revisor calculan el SHA-256 sobre los mismos bytes crudos del diff.

Si `npm test` modificó el worktree (`qa.checks.worktree_unchanged_by_tests: false`), el handoff queda en `blocked_awaiting_qa`, no incluye el diff aunque se pida `--include-diff` y lleva una `note` (también en el modo texto de `task review`) que dice qué cambió y qué hacer, por ejemplo: `npm test modificó el worktree: creó archivos sin registrar (test-report.xml). Los tests no deben escribir en el repositorio; si generan artefactos, añádelos a .gitignore.` Repetir QA no lo arregla, así que en ese caso ya no aparece `El diff cambió durante la preparación; repetir QA.`, que queda para cambios ajenos entre QA y la lectura del diff. `task review-run` falla entonces al planificar con `Review handoff bloqueado: se requiere QA aprobado y diff íntegro.` seguido de esa nota.

**No se invoca Codex ni se certifica una revisión**: `independent_review_completed`, `tdd_red_proven` y `merge_approved` se mantienen en `false`. Los scripts de `npm test` pueden ejecutar código arbitrario y solo deben autorizarse en repositorios confiables. El revisor y el responsable humano deben analizar el código, los criterios y los posibles secretos. El CLI no crea commits ni modifica tareas. Detalles y límites: [`docs/walkthroughs/independent-review-handoff-mvp.md`](docs/walkthroughs/independent-review-handoff-mvp.md).


## Revisión IA independiente (MVP 8 · opt-in)

```bash
# Preflight: ejecuta npm test y devuelve el plan; NO llama a Codex.
node bin/cli.js task review-run TASK-001 --file backlog/tasks.json --repo . \
  --models models.local.json --run-tests --include-diff --json

# Opt-in explícito al revisor (puede consumir tokens):
node bin/cli.js task review-run TASK-001 --file backlog/tasks.json --repo . \
  --models models.local.json --run-tests --include-diff \
  --max-total-tokens 4000 --timeout-seconds 120 --execute --json
```

Prepara una sesión independiente y de solo lectura del revisor, con la base de `--base` (por defecto `main`); ejecuta `npm test` pero **no llama a Codex sin `--execute`**. El plan del preflight muestra `base_ref`, `base_sha` y el `argv`, sin `--output-schema` ni `--output-last-message`, que solo se añaden al ejecutar; en modo texto, su segunda línea es `Base: <ref> (merge-base <sha>).` Con `--execute` lanza, sin shell:

```text
codex exec -c 'approval_policy="never"' --model <id> --sandbox read-only --ephemeral --json \
  --output-schema <tmp>/esquema-revision.json --output-last-message <tmp>/mensaje-final.json -
```

- `--sandbox read-only` lo impone el propio comando: esta es la revisión con sandbox de solo lectura forzado, a diferencia del subagente `reviewer` de `.codex/agents`. La política de aprobación va como `-c approval_policy="never"` por lo explicado en el ejecutor. Aquí sí se usa `--output-last-message`, porque el sandbox `read-only` no puede escribir en el temporal y la sesión no puede preparar esa ruta.
- Con `--output-schema`, Codex valida la respuesta final contra un JSON Schema estricto: `verdict` (`pass` | `needs_changes`), `summary` y `findings` con `severity` (`critical` | `high` | `medium` | `low`), `file`, `line` (entero o `null`) y `message`. Todos los campos son obligatorios y no se admiten propiedades adicionales.
- El archivo de `--output-last-message` es la fuente autoritativa de la respuesta; si falta o está vacío, se usa el último `agent_message` del stream. Se toleran mensajes previos (por ejemplo, un preámbulo en un `agent_message` aparte: solo cuenta el último) y un único bloque de código markdown que envuelva todo el JSON. Cualquier texto antes o después del JSON, dentro de ese último mensaje, da `review_invalid`. Si el archivo existe pero no es un archivo regular (por ejemplo, un enlace simbólico) o supera 128 KiB, el resultado es `review_invalid` sin recurrir al stream; un `agent_message` de más de 128 KiB invalida el stream (`invalid_events`). El esquema y el mensaje van a un directorio temporal privado (`<tmp>/arcav-codex-review-XXXXXX`) que se borra siempre al terminar.
- Solo `turn.failed` invalida el stream (`invalid_events`). Los eventos `error` que Codex emite en los reintentos (`Reconnecting... N/M`) se ignoran; un error definitivo hace que Codex salga con código distinto de 0 y el resultado es `codex_failed`, sin veredicto.
- **No** se usan `--ignore-user-config` ni `--ignore-rules`. El primero no carga `$CODEX_HOME/config.toml` (la autenticación sí se conserva), así que se perderían los proveedores de modelo y los demás ajustes que algunos usuarios definen ahí. El segundo omite las reglas de execpolicy (`.rules`) del usuario y del proyecto, y quitarlas puede relajar restricciones sobre comandos.
- Antes de lanzar Codex comprueba que rama, `HEAD`, `git merge-base HEAD <base_ref>`, hash del diff y archivos sin registrar siguen como en QA (si no, `El estado de Git cambió después de QA: repetir task review.`). Al terminar repite la comprobación y, si algo cambió, descarta el informe (`workspace_changed`).

Un informe `pass` es consultivo y requiere aprobación humana; `merge_approved` es siempre `false`. Revisar riesgos y comandos en [`docs/walkthroughs/independent-review-execution-mvp.md`](docs/walkthroughs/independent-review-execution-mvp.md) y los cambios de la versión 1.2.0 en [`docs/walkthroughs/codex-cli-pipeline-hardening.md`](docs/walkthroughs/codex-cli-pipeline-hardening.md).

### Compatibilidad con el Codex CLI instalado

`npm test` incluye un test de contrato opcional, `tests/codex-contract.test.js`, que usa el `argv` real del ejecutor y del revisor, con los archivos que solo se añaden al ejecutar. Sin Codex comprueba que no hay flags globales antes de `exec` y que cada `argv` lleva al menos un `-c`. Si `codex --version` termina con 0, comprueba además:

- que cada flag está definido en `codex exec --help`;
- que el parser de Codex acepta cada `argv` terminado en `--help`. Eso valida la posición y la sintaxis de los flags de `exec` y los valores cerrados, como los de `--sandbox`, pero no los valores ni las claves de `-c`;
- que cada valor de `-c` es válido para su clave: `codex -c <par> features list` debe salir con 0. Lleva un control negativo, `approval_policy="__invalido__"`: si también sale con 0, ese test se omite con su motivo. Una clave mal escrita (`aproval_policy`) no se detecta, porque `features list` la acepta y `--strict-config` no se admite en `codex features`.

Solo consulta `--version`, `--help` y `features list`: no abre sesiones, no llama a modelos ni necesita red ni credenciales. Sin Codex instalado, los tres tests que lo necesitan se omiten con el motivo `codex no está instalado`, salvo con `CODEX_CONTRACT_REQUIRED=1`, que los hace fallar. El job `codex-contract` de la CI instala `@openai/codex` sin versión fijada y lo ejecuta así, para avisar cuando Codex cambie sus flags.
