# v1.2.0 — Endurecimiento del CLI de Codex y del pipeline

> Rama `fix/codex-cli-pipeline-hardening` sobre `main` en `2108050` (merge del PR #10), 22-oct-2026. Al redactar este walkthrough los cambios aún no tienen commit; no implica merge ni publicación. Incluye las correcciones de una revisión adversarial del propio cambio (ver *Revisión adversarial*).

## Alcance

Corrige cómo se lanza Codex, quita de las plantillas modelos y claves que Codex no aplica y endurece el pipeline de backlog a revisión. Las tareas están en `task.md`:

- Ejecutor (`task run --execute`): política de aprobación como `-c approval_policy="never"` justo después de `exec`; el CLI guarda el último `agent_message` del implementador en un archivo temporal privado, sin `--output-last-message`.
- Revisor (`task review-run --execute`): `--output-schema` y `--output-last-message`; tolera mensajes previos (solo cuenta el último) y un bloque de código markdown; solo `turn.failed` invalida la sesión.
- Proceso de Codex compartido: límites de 8 MiB por línea JSONL y 256 MiB de stdout.
- QA y handoff: `--base <ref>`, hash del diff sobre bytes, rechazo explícito de texto no UTF-8, detección de binarios anclada a las cabeceras y bloqueo cuando `npm test` modifica el worktree.
- Backlog y sprint: una tarea TDD por criterio, `Acceptance criteria`, viñetas de contexto, sub-viñetas, encabezados `#` posteriores, cercas CommonMark, comentarios HTML, separadores y marcadores PT-BR; orden natural de IDs.
- CLI: tabla declarativa de opciones con rangos, validación completa antes de leer archivos, `--help` completo, `task run` con `--models` obligatorio, `backlog plan --out --json` y salida completa por tuberías.
- Plantillas e higiene: sin modelos fijados ni `sandbox_mode` en los agentes, binario de `impeccable` en el `.gitignore` del proyecto, borrado de `.agents/agents/` y versión 1.2.0.

Sin dependencias nuevas.

## Cambios por área

### Proceso de Codex compartido (`src/execution/codex-process.js`, nuevo)

`runCodexJsonl` lanza `codex` sin shell, envía el prompt por stdin y lee el JSONL con `StringDecoder`. Lo usan el ejecutor y el revisor, que antes duplicaban esta lógica. Mantiene el timeout con `SIGTERM` y `SIGKILL` a los 2 s, la suma de tokens de `turn.completed` y la precedencia de estados (`spawn_error` > `timeout` > stream inválido > `budget_exceeded` > `codex_failed` > `telemetry_missing` > completado).

- Límites: 8 MiB por línea, 256 MiB de stdout y 1 MB de stderr. stdout no se guarda: se cuentan sus bytes y solo se retiene la línea en curso. Codex 0.163.0 mete la salida de cada comando (hasta 1 MiB) en una sola línea `item.completed`, y el escapado JSON la multiplica hasta por 6 si son bytes de control (`\u0000`); con los 128 KiB por línea y 2 MB de stdout de `main`, un comando verboso mataba la sesión.
- Una línea JSON válida que no es un objeto (`null`, número, array o string) invalida el stream. Antes, una línea `null` tumbaba el CLI con `TypeError: Cannot read properties of null (reading 'type')`.
- Tras una línea inválida ya no se interpretan más eventos (fallo cerrado), también en el ejecutor. El estado sigue siendo `invalid_telemetry`, pero `usage` solo refleja lo observado antes de esa línea.
- Solo en el revisor, `turn.failed` invalida el stream (opción `failOnTurnFailed`; estado `invalid_events`). Los eventos `error` ya no lo invalidan: Codex los emite en los reintentos con el turno en marcha, y un error definitivo ya hace que salga con un código distinto de 0 (`codex_failed`). En `main` cualquier `error` invalidaba la revisión.

### Ejecutor: `task run --execute` (`src/execution/runner.js`)

- Comando: `codex exec -c approval_policy="never" --model <id> --sandbox workspace-write --json -` (el elemento del `argv` es `approval_policy="never"`, con las comillas). Es el mismo en el dry-run y al ejecutar. En `main`, `--ask-for-approval never` iba detrás de `exec` y Codex rechazaba el `argv` (ver *Contraste*).
- Informe del implementador: el CLI retiene el último `agent_message` del stream; si ese último no trae texto, no hay informe. Cuando Codex ya terminó, crea `<tmp>/arcav-codex-XXXXXX/` con `fs.mkdtempSync` (`0700`) y escribe `<TASK-ID>-mensaje-final.md` con `flag: 'wx'` (`O_CREAT | O_EXCL`) y modo `0600`. Si la escritura falla, borra el directorio (`rmSync` no sigue enlaces) y devuelve `report_file: null` con `report_error: <código>`, que el modo texto muestra en stderr. Sin mensaje no se crea directorio. El informe se guarda aunque el estado no sea `completed_needs_review`. El CLI nunca imprime su contenido: en modo texto, `Informe del implementador: <ruta>`.
- `executeTaskPlan` rechaza con `Plan de ejecución inválido.` los planes cuyo `argv` no termina en `-` o cuyo `task_id` no tiene formato de ID del backlog, porque ese ID forma parte del nombre del archivo.
- Fuera de un repositorio Git: `No se encontró un repositorio Git en <ruta>.` en lugar del error crudo de `git rev-parse`.

### Revisor: `task review-run --execute` (`src/execution/reviewer.js`)

- Comando: `codex exec -c approval_policy="never" --model <id> --sandbox read-only --ephemeral --json --output-schema <tmp>/esquema-revision.json --output-last-message <tmp>/mensaje-final.json -`. Los dos archivos viven en `<tmp>/arcav-codex-review-XXXXXX`, que se borra en un `finally`. Aquí `--output-last-message` es seguro: el sandbox `read-only` no puede escribir en el temporal.
- JSON Schema estricto: todas las propiedades requeridas, `additionalProperties: false`, `verdict` y `severity` como enumeraciones y `line` de tipo `["integer", "null"]`. Los límites de longitud y de número de hallazgos siguen en `parseReviewResult`.
- Fuente de la respuesta: el archivo de `--output-last-message`; si falta o está vacío, el **último** `agent_message` del stream. Los mensajes previos (por ejemplo, un preámbulo en otro `agent_message`) ya no dan `review_invalid`. Si el archivo existe pero no es un archivo regular o supera 128 KiB, el resultado es `review_invalid` sin recurrir al stream. Un `agent_message` de más de 128 KiB invalida el stream. Ese límite queda por encima de lo que admite `parseReviewResult` (unos 71 KB en ASCII); el de 32 KiB anterior descartaba revisiones válidas.
- `parseReviewResult` acepta además un único bloque de código markdown (con o sin `json`) que envuelva toda la respuesta. Rechaza cualquier texto antes o después del JSON o del bloque, varios bloques y otros lenguajes.
- `plan.base_ref` sale de `handoff.qa.base_ref` (por defecto `main`) y se revalida antes de llamar a Git. La foto de Git usa `git merge-base HEAD <base_ref>` en lugar de `main` fijo. El resultado de `--execute` incluye `base_ref`, también cuando `spawn` falla.
- Fuera de un repositorio Git: el mismo mensaje legible que el ejecutor.

### QA y handoff: `task verify`, `task review` (`verify.js`, `review.js`, `base-ref.js`)

- `--base <ref>` (por defecto `main`; opción de librería `baseRef`) en `task verify`, `task review` y `task review-run`. `assertBaseRef` la valida antes de tocar Git: solo `[A-Za-z0-9._/-]`, hasta 200 caracteres, más las reglas de Git que lista el README.
- Mensajes claros en lugar de errores crudos de Git: `No existe la referencia base '<ref>'. Usa --base <rama> (por ejemplo master u origin/main).`, `La rama actual '<rama>' es la misma que la base del diff.`, `No se pudo determinar la base del diff respecto a '<ref>'.` (sin ancestro común) y `No se encontró un repositorio Git en <ruta>.` Trabajar en `main`/`master` o con `HEAD` separado sigue prohibido.
- `diff_sha256` se calcula sobre los bytes crudos de `git diff --no-ext-diff --binary <base_sha> --`, como en el handoff y el revisor. Para diffs UTF-8 el valor no cambia.
- `--include-diff`: decodificación UTF-8 estricta (`Diff con texto no UTF-8: revisar manualmente sin incluirlo en el handoff.`, en lugar del falso `El diff cambió durante la preparación; repetir QA.`) y binarios detectados solo por las cabeceras `^GIT binary patch$` y `^Binary files .* differ$`.
- `npm test` que modifica el worktree: QA lee el worktree (archivos cambiados y sin registrar, hash del diff y `git diff --check`) antes de `npm test`, para fallar pronto, y otra vez después. El nuevo check `worktree_unchanged_by_tests` (`true`/`false` con `--run-tests`, `null` sin él) es obligatorio para `ready_for_independent_review`. Si es `false`, `tests.worktree_changes` lleva `new_untracked_files`, `diff_changed` y, solo si los tests borraron archivos sin registrar que ya existían, `removed_untracked_files`. Con `--run-tests`, archivos, hash y checks describen el estado posterior a los tests. El handoff queda en `blocked_awaiting_qa`, sin diff, con una `note` que dice qué cambió y qué hacer. En `main`, un `npm test` que dejaba `test-report.xml` daba QA listo y luego `El estado de Git cambió después de QA: repetir task review.`, y uno que tocaba un archivo rastreado hacía fallar siempre `task review --include-diff` con `repetir QA`, que no lo arreglaba.
- Salidas: `base_ref` en `task verify` y `qa.base_ref` en el handoff; el modo texto de `task verify`, `task review` y del dry-run de `task review-run` muestra `Base: <ref> (merge-base <sha>).`

### Backlog y sprint (`src/backlog/prd.js`, `src/sprint/planner.js`)

- `backlog plan` genera una tarea por criterio: `Implementar (TDD): <criterio>`, descripción RED → GREEN → REFACTOR (más `Contexto: …`), `test_plan` de tres pasos, sin dependencias, `draft`, 2 SP, riesgo `medium` y complejidad provisional. El ejemplo pasa de 8 a 4 tareas: `docs/examples/prd.backlog.generated.json` se regeneró y un test comprueba que sigue sincronizado con `prd.example.md`.
- Se admite `#### Acceptance criteria`, sin distinguir mayúsculas. Si la historia tiene encabezado de criterios, las viñetas anteriores pasan a contexto, con aviso; sin él, todas siguen siendo criterios.
- Las sub-viñetas (2 o más espacios, o un tabulador) se fusionan como `Padre: a; b` y los duplicados se detectan sobre el texto final. Una sub-viñeta huérfana queda de primer nivel, con aviso. Una sub-viñeta vacía o pendiente no se fusiona y avisa `criterio vacío o marcador pendiente ignorado.`, como en `main` (la primera versión de este cambio la fusionaba sin aviso). Los avisos salen ordenados por línea.
- Cambios de la revisión adversarial sobre comportamientos que ya tenía `main`:
  - Un `# …` posterior a la primera épica se trata como `## …`: cierra la historia y la épica y avisa `sección sin mapear: <título>.`. Antes, sus viñetas se sumaban sin aviso a la historia anterior. El `#` de título previo a la primera épica se sigue ignorando sin aviso.
  - Sin encabezado de criterios, el texto que sigue a una viñeta pasa al contexto con aviso (`texto tras una viñeta tratado como contexto; si continúa el criterio, únelo en la misma línea.`). Antes pasaba sin aviso y el criterio quedaba truncado.
  - Cercas según CommonMark: solo cierra una línea del mismo carácter, igual de larga o más y sin texto; una apertura con comillas invertidas no admite otra en la misma línea, así que `` ```npm test``` en verde `` es código en línea. Los comentarios HTML (`<!--` … `-->`) se excluyen con aviso. Un bloque o comentario sin cerrar es un error en su línea de apertura (`… sin cerrar: el resto del PRD no se analizó.`); antes el resto del PRD desaparecía con exit 0.
  - Los separadores temáticos (`---`, `***`, `___`, `* * *`, `- - -`) se ignoran sin aviso y cortan la relación con la viñeta padre; antes `* * *` daba el criterio `* *`.
  - `PENDENTE` y `A DEFINIR` se suman a los marcadores pendientes, para los PRD en PT-BR.
- La salida de `docs/examples/prd.example.md` no cambia con esas reglas: es idéntica byte a byte a `prd.backlog.generated.json`.
- `sprint plan`: a igual prioridad, orden natural del ID (`TASK-9` < `TASK-10` < `TASK-100`) con un comparador propio, sin `localeCompare` ni dependencia del locale ni pérdida de precisión con números grandes: un test ordena `TASK-9007199254740992-B` antes que `TASK-9007199254740993-A`, que un comparador con `Number()` ordenaría mal. La salida de `sprint.backlog.example.json` no cambia.

### CLI (`src/backlog/command.js`, `src/index.js`, `src/ui.js`)

- Tablas `FLAGS` (tipo, ayuda, valor por defecto y, en los enteros, `min` y `max`) y `COMMANDS` (argumentos, opciones admitidas y obligatorias, dependencias entre opciones). Un único parser numérico: el CLI valida nombres, valores, rangos y dependencias antes de leer ningún archivo o ejecutar `npm test`. Los módulos conservan su propia validación para cuando se usan como biblioteca. Rangos y valores por defecto salen de `src/limits.js`, la única fuente que usan tanto `FLAGS` (y por tanto `--help`) como cada módulo.
- Errores que nombran la opción: `<comando> no admite --X.`, `--X requiere una ruta.` / `--X requiere un valor.`, `--X requiere un entero entre A y B.` (texto, 0, negativos o fuera de rango), `<comando> requiere --A y --B.` y `--execute exige --A y --B.`, que listan solo lo que falta. Rangos: `--capacity` 1–1000; `--max-context-bytes` y `--max-review-bytes` 4096–131072; `--max-total-tokens` 100–100000; `--timeout-seconds` 10–3600; `--test-timeout-seconds` 10–600.
- `task run` exige `--models` también en el dry-run (`task run requiere --models.`); sin él ya fallaba, pero más tarde y con la ayuda mostrándolo como opcional.
- `--help` se genera con las mismas tablas: 9 comandos con todas sus opciones y, en cada entero, una segunda línea `Entero entre A y B; por defecto D.`. Un test comprueba que ninguna línea pasa de 80 columnas.
- `backlog plan --out --json` imprime un resumen JSON (`file`, `tasks`, `warnings`, `stats`); sin `--out`, `--json` no cambia nada. `--out` usa singular y plural (`1 tarea`, `1 advertencia`).
- Tuberías: los comandos de planificación fijan `process.exitCode` en lugar de llamar a `process.exit()`. En `main`, su salida por una tubería se cortaba en 64 KiB con código 0. Si quien lee cierra la tubería antes (por ejemplo `| head`), el `EPIPE` se ignora y el CLI sale con 0, sin traza.
- En modo texto, `task verify` y `task review` muestran la nota cuando `npm test` modificó el worktree, y el error de `task review-run` la añade.
- El modo texto de `task run --execute` muestra en stderr `No se pudo guardar el informe del implementador (<código>).` cuando hay `report_error`.
- El banner lleva el lema `Scaffolding Codex • Backlog → Revisión • Git-First` y la caja queda alineada a 65 columnas.

### Plantillas e higiene

- `templates/codex/.codex` y la copia del repositorio en `.codex`, idénticas según `diff -r`: sin `model` en `config.toml` ni en los agentes (queda la línea comentada `# model = "gpt-6.1-sol"`) y sin `sandbox_mode` en los agentes. Se conservan `model_reasoning_effort` (`high` en `architect` y `reviewer`, `medium` en el resto), `approval_policy = "on-request"`, `sandbox_mode = "workspace-write"` y `[agents] max_concurrent_threads_per_session = 5`.
- Instrucciones: `reviewer` pasa de `No modifiques codigo.` a `No edites archivos ni ejecutes comandos que modifiquen el repositorio.`, y `architect` pierde la excepción `salvo que el root lo pida explicitamente`: entrega el plan al root, que decide quién implementa.
- `init` añade `.agents/skills/impeccable/scripts/bin/` al `.gitignore` del proyecto, sin duplicarla. El binario se sigue copiando.
- Se borró `.agents/agents/`: diez agentes del toolkit anterior con modelos `claude-*` y `gemini-*`. Solo `task.md` los nombraba, y `package.json` no publica `.agents`.
- `package.json`: versión 1.2.0 y descripción nueva.
- Tests nuevos: `tests/scaffolder.test.js` (`init` real dos veces sobre un directorio temporal) y `tests/codex-contract.test.js` (contrato opcional con el Codex instalado).

## Decisiones

1. **`-c approval_policy="never"` justo después de `exec`.** La referencia del CLI lista `--ask-for-approval, -a` entre las opciones globales de `codex` y no entre las de `codex exec`. Detrás de `exec`, Codex 0.163.0 lo rechaza. Delante, el parser lo acepta, pero según el código fuente de esa versión `exec` no lo hereda: fuerza `Never` en modo headless y, si el revisor de aprobaciones resuelto es `auto_review` (`approvals_reviewer`), reconstruye la configuración sin ese `Never`, con el `approval_policy` de `config.toml` (la plantilla usa `on-request`). Según el mismo código, los overrides `-c` sí llegan a `exec` y se aplican también en esa reconstrucción. El valor va entre comillas porque `-c` lo interpreta como TOML. Se usa `never` porque la referencia de configuración recomienda `on-request` para sesiones interactivas y `never` para las no interactivas.
2. **Una tarea TDD por criterio.** `task verify` solo deja la revisión solicitable con `npm test` en verde, así que una tarea que solo añadía la prueba (con la suite en rojo) nunca podía pasar ese gate, y su dependencia encadenaba dos tareas por criterio. RED, GREEN y REFACTOR van ahora en la misma tarea.
3. **Sin modelos fijados.** Las plantillas fijaban `gpt-5.6` y `gpt-5.6-codex`, que no figuran como IDs en la página de modelos, y `gpt-5.3-codex-spark`, retirado el 14-sep-2026, con el que el subagente `qa` fallaría. Sin `model`, Codex usa el modelo de la configuración del usuario o el recomendado, y los subagentes heredan el de la sesión. La línea comentada sugiere `gpt-6.1-sol`, el modelo que recomienda la página de modelos cuando está disponible para la cuenta.
4. **Sin `sandbox_mode` en los agentes.** Según la documentación de subagentes, `sandbox_mode` y `approval_policy` no sobrescriben la configuración padre desde un archivo de agente, y las instrucciones no crean un sandbox de solo lectura propio. Declararlo daba una garantía falsa, que el walkthrough `codex-mvp.md` llegó a afirmar. El aislamiento de solo lectura real es `task review-run`, que pasa `--sandbox read-only` a `codex exec`.
5. **Sin `--ignore-user-config` ni `--ignore-rules`.** `--ignore-user-config` no carga `$CODEX_HOME/config.toml` (la autenticación sigue usando `CODEX_HOME`), así que se perderían los proveedores de modelo y los ajustes que algunos usuarios definen ahí. `--ignore-rules` no carga los archivos `.rules` de execpolicy del usuario ni del proyecto, y quitarlos puede relajar restricciones sobre comandos. El motivo queda comentado junto al `argv` del revisor.
6. **IDs posicionales.** `planBacklogFromPRD` es una función pura del texto del PRD: no recibe un backlog anterior con el que reconciliar IDs, y asignarlos por posición mantiene la salida determinista (lo comprueba un test). El coste es que regenerar después de editar el PRD renumera las tareas; el README lo advierte.
7. **Binario ignorado, no eliminado.** `init` sigue copiando el binario de `impeccable` (~16 MB, `linux-x64`, versión 0.1.3) para que funcione offline justo después de preparar el proyecto, pero no se versiona en cada proyecto. Si falta, el launcher lo busca en `$IMPECCABLE_BIN`, en `~/.impeccable` y en el `PATH`, y como último recurso lo descarga verificando su `.sha256`; sin verificación, rechaza la descarga.
8. **El informe del implementador lo escribe el CLI, no Codex.** El ejecutor mantiene la regla de no imprimir respuestas del modelo: el archivo permite la revisión humana sin exponer el contenido en stdout ni en el JSON y, como está en el temporal del sistema, no aparece como archivo sin registrar en `task verify`. Con `--output-last-message`, Codex escribía ese archivo desde su proceso principal, fuera del sandbox, en una ruta que los comandos de `workspace-write` podían preparar con un enlace (hallazgo `exec-1`). Se descartó `-c sandbox_workspace_write.exclude_slash_tmp=true`: en la prueba de la revisión, el enlace se creó igual. Se mantiene `os.tmpdir()`; el riesgo residual está en *Limitaciones*.
9. **Hash sobre bytes crudos.** QA calculaba el SHA-256 sobre el texto decodificado y el handoff sobre los bytes: con texto Latin-1 los hashes no coincidían y el handoff respondía `El diff cambió durante la preparación; repetir QA.` Ahora QA, el handoff y el revisor hashean los mismos bytes.
10. **QA bloquea si `npm test` modifica el worktree.** Repetir QA no lo arregla, así que el informe describe el estado posterior a los tests, que es el que se revisaría, y el handoff dice qué cambió y qué hacer en vez de pedir que se repita.
11. **`main` protegida en GitHub.** Desde el 22-oct-2026, `main` exige los checks `tests (18)` y `tests (22)` de GitHub Actions, también a los administradores, y no admite force push ni borrado. El merge del PR #6 borró la CI y el ejecutor sin que nada lo impidiera (el PR #7 los restauró); ahora, sin el workflow esos checks no llegan y el merge queda bloqueado. `codex-contract` no es obligatorio: instala Codex sin versión fijada, y un cambio de flags en Codex bloquearía cualquier merge, también los que no tocan Codex. Su fallo se sigue viendo en el PR.

## Revisión adversarial

Tras la primera versión de este cambio, una revisión adversarial con dos verificadores independientes por hallazgo confirmó 25 (1 de severidad alta, 9 media y 15 baja), dejó 3 en disputa, refutó 3 y marcó 5 como duplicados. Se corrigieron todos los confirmados y los disputados:

| Hallazgo | Severidad | Problema | Corrección |
| --- | --- | --- | --- |
| `exec-1` | alta | El `--output-last-message` del ejecutor estaba en una ruta que el sandbox `workspace-write` podía preparar con un enlace: Codex, fuera del sandbox, escribía a través de él | Sin `-o`: el CLI escribe el informe tras terminar Codex, con `O_EXCL` y `0600`; test con un enlace plantado |
| `contract-1` | media | `--ask-for-approval` delante de `exec` pasa el parser, pero `exec` lo ignora | `-c approval_policy="never"` tras `exec`, en el ejecutor y el revisor |
| `contract-2` | media | Un evento `error` de reintento invalidaba la revisión | Solo `turn.failed` invalida |
| `contract-3` | media | 128 KiB por línea y 2 MB de stdout mataban sesiones con comandos verbosos | 8 MiB por línea (4 MiB en la primera corrección; ver la revisión final) y 256 MiB de stdout, solo contados |
| `cli-1` | media | Salida cortada en 64 KiB por una tubería (preexistente) | `process.exitCode` en vez de `process.exit()` |
| `cli-2` | media | Los rangos se validaban tras leer archivos y, en `review-run`, tras `npm test`, con nombres internos | Rangos en `FLAGS`, validados al parsear y visibles en `--help` |
| `prd-1`, `prd-2`, `prd-3` | media | `#` posterior, texto tras una viñeta y bloque sin cerrar perdían contenido sin aviso (preexistentes) | Sección sin mapear, aviso y error en la línea de apertura |
| `tests-2` | media | Ningún test llevaba `--base` hasta `task review` y `task review-run` | Test con `main → develop → feat/base` |
| `exec-2` | baja | QA leía el worktree antes de `npm test` (preexistente) | Check `worktree_unchanged_by_tests` y `note` en el handoff |
| `cli-3`, `cli-4` | baja | `--models` opcional en la ayuda de `task run`; `backlog plan --json` sin efecto con `--out`; sin el 32768 en `--help` | `--models` obligatorio, resumen JSON y valor por defecto en la ayuda |
| `prd-4` … `prd-8` | baja | Sub-viñetas pendientes fusionadas, cercas sin CommonMark, comentarios HTML y separadores convertidos en criterios, marcadores PT-BR | Avisos, cercas CommonMark, exclusión de comentarios, separadores ignorados y `PENDENTE`/`A DEFINIR` |
| `contract-4` | baja | El test de contrato no validaba valores de opciones globales y sus comentarios lo exageraban | Sin opciones globales; valores de `-c` con `features list` y control negativo |
| `tests-3`, `tests-4`, `tests-5` | baja | Guardas del `-o` del revisor sin test; test de precisión que no la probaba; codex falso sensible a `noexec` | Tests nuevos o ampliados; omisión con motivo si el temporal es `noexec` |
| `docs-3`, `docs-5`, `docs-6` | baja | Cifras desactualizadas, nota de modelos sin respaldo y párrafo de `--base` impreciso | Este walkthrough, la nota de `codex-mvp.md` y el README |
| `exec-4`, `docs-4`, `tests-6` | en disputa | 32 KiB descartaba revisiones válidas; "preámbulos" era ambiguo; las 80 columnas de `--help` no tenían test | 128 KiB, redacción precisa y test de ancho |

Una última revisión, acotada a esas correcciones (4 enfoques y 2 verificadores), confirmó 8 hallazgos de severidad baja, ya corregidos: 4 MiB por línea no cubría 1 MiB de bytes de control escapados (ahora 8 MiB); la nota del worktree remitía a un campo JSON que no siempre se puede ver (ahora nombra los archivos); con `process.exitCode`, cerrar la tubería antes de tiempo mostraba una traza `EPIPE` (ahora se ignora); un `# …` en código indentado cerraba la historia y una sub-viñeta `-` vacía no se reconocía (corregidos en el parser); y la documentación y las cifras de este walkthrough estaban desactualizadas. Refutó 2 y marcó 5 como duplicados.

Refutados en la primera revisión: el `SIGKILL` que solo alcanza al lanzador npm (`exec-3`), `@openai/codex` sin versión fijada en la CI (`security-2`) y `gh api user` en `tests/scaffolder.test.js` (`tests-7`, que sigue como limitación).

## Verificación

Entorno: Linux, Node v22.22.2 y npm 10.9.7; Node v18.18.0 para la segunda pasada (la CI prueba Node 18 y 22). Codex CLI no está instalado en el sistema; para el contraste se instaló `@openai/codex@0.163.0` (`codex-cli 0.163.0`) en un directorio temporal, con `CODEX_HOME` propio y sin `OPENAI_API_KEY` ni `CODEX_API_KEY`. Solo se ejecutaron `--version`, `--help` y `features list`.

### Contraste con el Codex CLI real (0.163.0)

Con `--help` al final, el parser de Codex valida la posición y la sintaxis de los flags de `exec` y los valores cerrados, como los de `--sandbox`, sin abrir ninguna sesión. No valida los valores ni las claves de `-c`: los valores se comprueban con `codex -c <par> features list`, que carga la configuración y sale con 1 si el valor no es válido para su clave.

| Comando | Resultado |
| --- | --- |
| `argv` del ejecutor en `main`: `codex exec --model x --sandbox workspace-write --ask-for-approval never --json --help` | exit 2, `error: unexpected argument '--ask-for-approval' found`: **`task run --execute` no podía arrancar** |
| Opción global (forma del revisor desde el PR #10): `codex --ask-for-approval never exec --model x --sandbox workspace-write --json --help` | exit 0: el parser la acepta, pero `exec` no la usa (ver *Decisiones*) |
| `argv` final del ejecutor: `codex exec -c 'approval_policy="never"' --model x --sandbox workspace-write --json --help` | exit 0 |
| `argv` final del revisor: `codex exec -c 'approval_policy="never"' --model x --sandbox read-only --ephemeral --json --output-schema <f> --output-last-message <f> --help` | exit 0 |
| El del ejecutor con `--sandbox workspace-writeX` | exit 2, `invalid value 'workspace-writeX' for '--sandbox <SANDBOX_MODE>'` |
| `codex -c 'approval_policy="never"' features list` | exit 0 |
| `codex -c 'approval_policy="nunca"' features list` (igual con `"__invalido__"`) | exit 1, `failed to load bootstrap configuration`: ``unknown variant `nunca` ``, con la lista de valores válidos (`untrusted`, `on-failure`, `on-request`, `granular`, `never`) |
| `codex -c 'aproval_policy="never"' features list` | exit 0: una clave mal escrita no se detecta, y `--strict-config` no se admite en `codex features` |
| `codex --help` y `codex exec --help` | `codex` define `-a, --ask-for-approval` (`on-request`, `never`). `codex exec` define `-c, --config`, `-m, --model`, `-s, --sandbox`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--output-schema`, `--json` y `-o, --output-last-message`, y no define `--ask-for-approval` |
| `tests/codex-contract.test.js` con ese Codex y `CODEX_CONTRACT_REQUIRED=1` | 4 pass, con Node 22 y con Node 18 |
| El mismo test sobre copias con el `argv` del ejecutor alterado | `argv` de `main`: fallan 3 (sin `-c`, `codex exec --help no define --ask-for-approval` y rechazo del parser); opción global del PR #10: falla 1 (hay flags globales); `approval_policy="nunca"`: falla 1 (el de los valores de `-c`) |

La CI tiene un job nuevo, `codex-contract`, que instala `@openai/codex` (sin versión fijada, para detectar cuando cambien los flags) y ejecuta el test de contrato con `CODEX_CONTRACT_REQUIRED=1`: ahí, si Codex falta, el test falla en vez de omitirse.

### `npm test`

`npm test` → **182 tests: 179 pass, 0 fail, 3 skipped** (unos 5 s), igual con Node v22.22.2 y v18.18.0. Los omitidos son los tres tests de contrato que necesitan Codex, con el motivo `# SKIP codex no está instalado`: "los flags del ejecutor y del revisor existen en la ayuda del Codex instalado", "el parser del Codex instalado acepta el argv real del ejecutor y del revisor" y "el Codex instalado acepta los valores de -c del ejecutor y del revisor". `git status` no cambió tras ninguna de las dos pasadas.

| Archivo | Tests | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- |
| `backlog.test.js` | 15 | 15 | 0 | 0 |
| `cli.test.js` | 32 | 32 | 0 | 0 |
| `codex-contract.test.js` | 4 | 1 | 0 | 3 |
| `packet.test.js` | 10 | 10 | 0 | 0 |
| `prd.test.js` | 29 | 29 | 0 | 0 |
| `review.test.js` | 15 | 15 | 0 | 0 |
| `reviewer.test.js` | 22 | 22 | 0 | 0 |
| `runner.test.js` | 22 | 22 | 0 | 0 |
| `scaffolder.test.js` | 2 | 2 | 0 | 0 |
| `sprint.test.js` | 13 | 13 | 0 | 0 |
| `verify.test.js` | 18 | 18 | 0 | 0 |

### RED

Los tests de esta rama contra el código de `main` (`2108050`, extraído con `git archive` en un directorio temporal) dan 182 tests: 83 pass, 73 fail, 23 cancelados y 3 skipped (los de contrato, sin Codex). Los cancelados son del ejecutor y del revisor: el código antiguo lanza `TypeError: Cannot read properties of null (reading 'type')` fuera del test ante una línea `null`. `backlog.test.js` y `packet.test.js` pasan en las dos versiones.

### Otras comprobaciones

- `node --check` en `bin/cli.js` y en los 18 módulos de `src/` → OK.
- `diff -r templates/codex/.codex .codex` → sin diferencias.
- `npm pack --dry-run` → `arcav-ia-codex-1.2.0.tgz`, 7,7 MB (18,4 MB descomprimido, de los que 16 MB son el binario de `impeccable` en `templates/`); no incluye `.agents/` ni `tests/`.
- `node bin/cli.js --doctor` (equivalente local de `npx … --doctor`) → `Todo en orden para Codex.`, con `WARN Codex CLI no encontrado en PATH`.
- Una salida de `backlog plan` de 906.545 bytes llega completa por una tubería (`| cat`), idéntica al archivo de `--out`.
- Tras `npm test`, el test de contrato y los ejemplos no quedaron directorios `arcav-*` nuevos en `/tmp`.

### Ejemplos del README

Se ejecutaron todos los ejemplos del README salvo `init` y los que llevan `--execute`. Los que usan `backlog/tasks.json`, que no existe en este repositorio, se ejecutaron con un archivo de `docs/examples/` o con el backlog generado en un directorio temporal.

| Comando | Resultado |
| --- | --- |
| `--version` | `@arcav-ia/codex v1.2.0` |
| `--help` | 9 comandos; `task run` con `--models` obligatorio; cada entero con `Entero entre A y B; por defecto D.`; 80 columnas como máximo |
| `backlog validate --file docs/examples/backlog.example.json` | exit 0, `Backlog válido` |
| `route TASK-002 --file docs/examples/backlog.example.json --json` | exit 0; M (6/10), riesgo `high`: Sol implementa, Astra revisa, `model_id: null` |
| `backlog plan docs/examples/prd.example.md`, con y sin `--json` | exit 0, sin avisos; idéntico byte a byte a `docs/examples/prd.backlog.generated.json` (4 tareas TDD sin dependencias) |
| `backlog plan … --out <tmp>/backlog/tasks.json` | exit 0, `(4 tareas; 0 advertencias)`; al repetirlo, exit 1 con `EEXIST` |
| `backlog plan … --out <tmp>/backlog/tasks2.json --json` | exit 0; `{"file": …, "tasks": 4, "warnings": [], "stats": {"epics": 2, "stories": 3, "criteria": 4, "tasks": 4}}`, y el archivo es igual al anterior |
| `backlog validate` y `route TASK-002` sobre ese backlog | exit 0; `TASK-002` = `Implementar (TDD): Cada prenda registra cantidad y precio`, M (5/10), Sol/Sol |
| Bloque de *Formato admitido* del README | exit 0; aviso de la línea 5 (viñeta de contexto) y criterio `El formulario valida: nombre obligatorio; email válido` |
| `sprint plan … --capacity 6` (texto, `--json` y `--models`) | exit 0; seleccionadas TASK-002, TASK-004 y TASK-006 (6/6 SP), TASK-007 aplazada y TASK-003 y TASK-005 bloqueadas |
| `task prepare TASK-002 --file docs/examples/context.backlog.example.json --repo . --json` | exit 0; el paquete incluye `src/execution/packet.js` y cabe en 32768 bytes |
| Lo mismo con `--models … --max-context-bytes 16384` | exit 0; cabe en 16384 bytes |
| `task run TASK-002 … --models docs/examples/models.example.json --json` | exit 0, dry-run; `argv` = `exec -c approval_policy="never" --model … --sandbox workspace-write --json -` y `final_message`. Sin `--models`, exit 1: `task run requiere --models.` |
| `task verify TASK-002 --file docs/examples/context.backlog.example.json --repo .`, con y sin `--base main` | exit 0; `Base: main (merge-base 2108050…)`; BLOQUEADO por los archivos nuevos de esta rama, aún sin registrar |
| Lo mismo con `--run-tests --test-timeout-seconds 120` | exit 1; `tests_passed: true` y `worktree_unchanged_by_tests: true` (la suite no escribe en el repositorio), pero BLOQUEADO por esos archivos |
| `task review`, sin opciones y con `--run-tests --include-diff --max-review-bytes 32768` | exit 0 y exit 1; `blocked_awaiting_qa`, diff no incluido, `qa.base_ref: main` |
| `task review-run … --run-tests --include-diff --json` | exit 1; `Review handoff bloqueado: se requiere QA aprobado y diff íntegro.`, por el mismo motivo |

Para el camino verde se usaron repositorios Git desechables en un directorio temporal: una rama `feat/demo` con un commit sobre `main` y otra sobre `master`, una cadena `main → develop → feat/base`, un `npm test` trivial (en el primero deja una marca fuera del repositorio para contar sus ejecuciones), dos `npm test` que ensucian el worktree y un `models.local.json` ignorado por Git con la equivalencia sugerida en el README.

- `task verify --run-tests` → exit 0, `LISTO PARA SOLICITAR`, con `worktree_unchanged_by_tests: true`. `task review --run-tests --include-diff --max-review-bytes 32768` → `ready_for_independent_review`, con el diff incluido (147 bytes) y el mismo SHA-256 que QA.
- `task review-run … --json` sin `--execute` → exit 0; plan con `base_ref: "main"`, `base_sha` y `argv` = `exec -c approval_policy="never" --model gpt-6-luna --sandbox read-only --ephemeral --json -`. En modo texto, la segunda línea es `Base: main (merge-base …).`
- `task run … --json` → exit 0; `argv` = `exec -c approval_policy="never" --model gpt-6-luna --sandbox workspace-write --json -`. En total, `npm test` se ejecutó exactamente una vez por cada comando que lo pedía.
- Repositorio con `master`: sin `--base` → `No existe la referencia base 'main'. Usa --base <rama> (por ejemplo master u origin/main).`; con `--base master` → exit 0 y `Base: master (merge-base …)`; con el SHA de la base, también; `--base feat/demo` → `La rama actual 'feat/demo' es la misma que la base del diff.`; `--base -x`, `--base ../a` y `--base v1+x` → `--base: referencia Git inválida: …`; `task run --base main` → `task run no admite --base.`
- Cadena `main → develop → feat/base`: `task review --base develop --run-tests --include-diff --json` → `ready_for_independent_review`, `qa.base_ref: develop` y `changed_files: ["src/a.js"]`; el dry-run en texto de `task review-run --base develop` muestra `Base: develop (merge-base <SHA de develop>).`
- `npm test` que crea `test-report.xml`: `task verify --run-tests` → exit 1, `worktree_unchanged_by_tests: false` y `worktree_changes: {"new_untracked_files": ["test-report.xml"], "diff_changed": false}`; `task review` → `blocked_awaiting_qa` con la `note` `npm test modificó el worktree: creó archivos sin registrar …`; `task review-run` → `Review handoff bloqueado: …`. Con un `npm test` que modifica `src/b.js`: `diff_changed: true`, `changed_files` ya incluye `src/b.js` (estado posterior) y la nota dice `cambió archivos rastreados`. En modo texto, `task verify` y `task review` muestran esa nota, y el error de `task review-run` la añade tras `Review handoff bloqueado: …`.
- Validación antes de leer archivos o ejecutar `npm test`: `task review-run` con `--timeout-seconds 5` o `--max-total-tokens 200000`, y `task verify --run-tests --test-timeout-seconds 700`, fallan con `--X requiere un entero entre A y B.` sin ninguna ejecución de `npm test`; `sprint plan --capacity 5000 --file /nonexistent.json` y `--capacity 0` → `--capacity requiere un entero entre 1 y 1000.`; `task prepare --max-context-bytes abc` → `--max-context-bytes requiere un entero entre 4096 y 131072.`
- Mensajes de requisitos: `task run requiere --models.`, `--execute exige --max-total-tokens y --timeout-seconds.` (rechazado al parsear, sin ejecutar nada), `task review-run requiere --run-tests y --include-diff.`, `sprint plan requiere --capacity.` y `--test-timeout-seconds exige --run-tests.`
- Directorio sin Git: `task verify` → `No se encontró un repositorio Git en <ruta>.`

## Limitaciones

- **Codex no se ejecutó con credenciales reales.** Los `argv` se validaron con el parser del Codex CLI 0.163.0, y el valor de `-c` con `features list`, pero ninguna sesión llegó a un modelo. El efecto de `-c approval_policy="never"` en una sesión real, en particular con `approvals_reviewer = "auto_review"`, y el de `--output-schema` y `--output-last-message` en el revisor se apoyan en el código fuente de 0.163.0, en la documentación oficial y en procesos simulados.
- **El test de contrato se omite sin Codex instalado** (`codex no está instalado`), salvo con `CODEX_CONTRACT_REQUIRED=1`, que es como lo ejecuta el job `codex-contract` de la CI. No detecta una clave de `-c` mal escrita.
- El informe del implementador queda en el temporal del sistema hasta que el usuario lo borra, y puede contener datos sensibles. Riesgo residual: entre `mkdtempSync` y `writeFileSync` queda una ventana de microsegundos. Si un proceso lanzado por la sesión sobrevive a Codex (depende de cómo aísle el sandbox los procesos en segundo plano; no verificado), podría sustituir el directorio recién creado por un enlace a otro directorio escribible por el usuario. `O_EXCL` nunca sobrescribe, pero podría crearse ahí un archivo nuevo `<TASK-ID>-mensaje-final.md` (`0600`, con texto del modelo). Node no ofrece `openat` ni `O_NOFOLLOW` para los componentes intermedios; cerrarlo del todo exigiría un directorio fuera de las raíces escribibles del sandbox (por ejemplo, `~/.cache/arcav-codex`).
- El límite de 128 KiB del revisor cubre el máximo de `parseReviewResult` en ASCII (unos 71 KB), pero una revisión válida con mucho texto multibyte o muchos escapes JSON aún puede superarlo y dar `review_invalid` (falla cerrado).
- No se sabe si los proveedores no OpenAI que configure el usuario aceptan `--output-schema`. El esquema no limita longitudes ni número de hallazgos; de eso se encarga `parseReviewResult`.
- El presupuesto de tokens sigue siendo orientativo, y el paso a `SIGKILL` a los 2 s no tiene test propio (el camino timeout → `SIGTERM` sí).
- La comprobación "rama igual a la base" compara texto: `--base refs/heads/<rama>` o `--base HEAD` no se detectan, y el diff solo tendría cambios sin confirmar. `--base` solo admite `[A-Za-z0-9._/-]`, así que ramas válidas en Git como `v1+x` se rechazan; el SHA del commit sirve de alternativa.
- QA lee la rama y `HEAD` antes de `npm test`: si los tests hacen commit o cambian de rama, `branch` y `head_sha` describen el estado previo (el revisor sigue fallando de forma cerrada). Los procesos que `npm test` deje en segundo plano pueden escribir después de la segunda lectura. Cualquier fallo de `rev-parse --show-toplevel` (repositorio bare, `safe.directory`) se informa como `No se encontró un repositorio Git en <ruta>.`
- PRD: el análisis es por líneas y solo aproxima CommonMark. No modela contenedores: una cerca o un comentario que empiezan tras `- ` no se reconocen, y en `` - ```js `` la cerca de cierre se toma como apertura y el PRD se rechaza; la indentación de las cercas no cuenta; los encabezados setext no se reconocen (su `---` se ignora como separador); un comentario en mitad de una línea queda como texto. Las líneas de continuación bajo una viñeta no se unen al criterio: sin encabezado pasan al contexto con aviso y con encabezado se descartan con aviso. Un `#` que solo agrupa épicas también avisa `sección sin mapear`. El anidamiento profundo se aplana (`A: B:; C`); la indentación es absoluta, así que una lista indentada entera da un aviso por elemento; un encabezado de criterios con `:` final se rechaza; y el `test_plan` asume `npm test`.
- Los proyectos preparados con la versión 1.1.0 o anterior conservan su `.codex` (por ejemplo, `qa` con `gpt-5.3-codex-spark`, ya retirado), porque `init` no sobrescribe. La migración es manual (ver README).
- Este repositorio sigue versionando `.agents/skills/impeccable/scripts/bin/linux-x64/impeccable` (16 MB) y su propio `.gitignore` no lo ignora; queda fuera de este cambio. El paquete npm sigue llevando el binario en `templates/` para que `init` funcione offline.
- `tests/scaffolder.test.js` ejecuta `init` real, que llama al doctor: `gh api user` (red y credenciales de `gh`, si las hay) y `codex --version`.

## Walkthroughs anteriores que este cambio deja desactualizados

Se conservan como registro histórico, con una nota al principio que remite a este documento; en estos puntos prevalece este:

- `task-execution-pilot.md`: el `argv` del ejecutor ponía `--ask-for-approval` después de `exec`, que Codex rechaza; ahora la política va como `-c approval_policy="never"` y el CLI guarda el informe del implementador.
- `codex-mvp.md`: "`reviewer` usa `sandbox_mode = "read-only"`…" (la clave no aplica en archivos de agente) y "Los modelos quedan centralmente visibles en las plantillas TOML" (ya no se fijan).
- `prd-to-backlog-mvp.md`: la regla 2 (una tarea de prueba y otra de implementación con dependencia) y "4 criterios y 8 tareas" (ahora son 4 tareas); además, las reglas nuevas del parser.
- `sprint-planner-mvp.md`: el desempate "luego por ID" es ahora por orden natural.
- `task-quality-gate-mvp.md` e `independent-review-handoff-mvp.md`: el ancestro común se calcula con la base de `--base` (por defecto `main`), no siempre con `main`, y la revisión queda bloqueada si `npm test` modifica el worktree.
- `independent-review-execution-mvp.md`: el punto 3 usa `codex --ask-for-approval never exec …`, que `exec` ignora, y no incluye `--output-schema` ni `--output-last-message`; el punto 5 describe la lectura anterior de la respuesta.

## Fuentes

Documentación oficial de Codex, consultada el 22-oct-2026:

- Referencia del CLI, https://learn.chatgpt.com/docs/cli/reference: opciones globales (`--ask-for-approval, -a` con `on-request | never`) y opciones de `codex exec` (`--json`, `--ephemeral`, `--output-schema`, `--output-last-message`, `--ignore-user-config` e `--ignore-rules`; `-` lee el prompt de stdin).
- Modo no interactivo, https://learn.chatgpt.com/docs/non-interactive-mode.md: `-o`/`--output-last-message`, `--output-schema`, eventos JSONL (`turn.completed`, `turn.failed`, `item.*` y `error`) y sandbox `read-only` por defecto en `codex exec`.
- Modelos, https://learn.chatgpt.com/docs/models.md: `gpt-6.1-sol` (recomendado), `gpt-6-luna` y `gpt-6-astra`; modelo recomendado cuando no se especifica ninguno; retirada de GPT-5.3-Codex-Spark el 14-sep-2026.
- Subagentes, https://learn.chatgpt.com/docs/agent-configuration/subagents.md: campos obligatorios, herencia de modelo y esfuerzo de razonamiento, `sandbox_mode` sin efecto en archivos de agente y ausencia de un sandbox de solo lectura propio.
- Referencia de configuración, https://learn.chatgpt.com/docs/config-file/config-reference: `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `agents.max_concurrent_threads_per_session`, `sandbox_workspace_write` y carga de `.codex/config.toml` solo en proyectos de confianza.

Además:

- Binario `codex-cli 0.163.0` (`@openai/codex@0.163.0` de npm): `codex --help`, `codex exec --help` y `codex -c <par> features list`, ejecutados para esta verificación.
- Código fuente de Codex en la etiqueta `rust-v0.163.0` del repositorio `openai/codex`, revisado en la revisión adversarial y no en esta verificación: `codex-rs/cli/src/main.rs` (la rama de `exec` no le pasa la política de aprobación global), `codex-rs/utils/cli/src/shared_options.rs` y `codex-rs/exec/src/lib.rs` (`Never` por defecto en modo headless y reconstrucción sin él cuando el revisor de aprobaciones es `auto_review`).
