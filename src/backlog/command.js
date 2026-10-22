import fs from 'node:fs';
import path from 'node:path';
import { validateBacklog } from './validate.js';
import { planBacklogFromPRD } from './prd.js';
import { loadModelProfiles, routeTask } from '../routing/router.js';
import { planSprint } from '../sprint/planner.js';
import { prepareTaskPacket } from '../execution/packet.js';
import { planTaskExecution, executeTaskPlan } from '../execution/runner.js';
import { verifyTaskChanges } from '../execution/verify.js';
import { prepareIndependentReview, worktreeNote } from '../execution/review.js';
import { planIndependentReview, executeIndependentReview } from '../execution/reviewer.js';
import { DEFAULT_BASE_REF, assertBaseRef } from '../execution/base-ref.js';
import { LIMITS } from '../limits.js';

// Ancho máximo de las líneas de uso y ancho de la columna de opciones en la ayuda.
const HELP_WIDTH = 80;
const FLAG_COLUMN = 24;

/**
 * Opciones conocidas por los comandos de planificación.
 * type: boolean (sin valor), path (ruta), integer (entero entre min y max) o ref (referencia Git).
 * arg: marcador del valor en la ayuda. default: valor cuando la opción no aparece.
 * min, max y default de los enteros salen de src/limits.js, la misma fuente que validan
 * los módulos: así se rechaza el valor antes de leer archivos o ejecutar npm test.
 */
const FLAGS = {
  file: { type: 'path', arg: 'ruta', default: 'backlog/tasks.json', help: 'Backlog JSON' },
  repo: { type: 'path', arg: 'directorio', help: 'Raíz del proyecto (por defecto, directorio actual)' },
  base: { type: 'ref', arg: 'ref', default: DEFAULT_BASE_REF, help: 'Rama base del diff' },
  models: { type: 'path', arg: 'ruta', help: 'IDs locales de modelo para luna, sol y astra' },
  out: { type: 'path', arg: 'ruta', help: 'Archivo de salida nuevo; nunca sobrescribe' },
  capacity: { type: 'integer', arg: 'N', ...LIMITS.capacity, help: 'Capacidad del sprint en story points' },
  'max-context-bytes': { type: 'integer', arg: 'N', ...LIMITS.maxContextBytes, help: 'Límite del paquete de contexto en bytes' },
  'max-total-tokens': { type: 'integer', arg: 'N', ...LIMITS.maxTotalTokens, help: 'Tope orientativo de tokens' },
  'timeout-seconds': { type: 'integer', arg: 'N', ...LIMITS.timeoutSeconds, help: 'Límite en segundos de Codex' },
  'run-tests': { type: 'boolean', help: 'Ejecuta npm test del proyecto' },
  'test-timeout-seconds': { type: 'integer', arg: 'N', ...LIMITS.testTimeoutSeconds, help: 'Límite en segundos de npm test' },
  'include-diff': { type: 'boolean', help: 'Incluye el diff en el handoff si el QA pasa' },
  'max-review-bytes': { type: 'integer', arg: 'N', ...LIMITS.maxReviewBytes, help: 'Tamaño máximo del diff en bytes' },
  execute: { type: 'boolean', help: 'Invoca Codex de verdad; sin ella es DRY-RUN' },
  json: { type: 'boolean', help: 'Imprime el resultado en JSON' },
};

/**
 * Especificación de cada comando:
 * - args: argumentos posicionales obligatorios tras el nombre.
 * - flags: opciones admitidas, en el orden en que aparecen en la ayuda.
 * - required: opciones obligatorias.
 * - requires: { opción: [opciones que exige cuando aparece] }.
 */
const COMMANDS = [
  {
    name: 'backlog plan',
    args: ['PRD.md'],
    flags: ['out', 'json'],
    summary: 'Convierte un PRD Markdown en un backlog borrador; sin --out lo imprime.',
    run: backlogPlan,
  },
  {
    name: 'backlog validate',
    args: [],
    flags: ['file'],
    summary: 'Valida el esquema y las dependencias del backlog.',
    run: backlogValidate,
  },
  {
    name: 'route',
    args: ['TASK-ID'],
    flags: ['file', 'models', 'json'],
    summary: 'Sugiere implementador y revisor para una tarea.',
    run: route,
  },
  {
    name: 'sprint plan',
    args: [],
    flags: ['capacity', 'file', 'models', 'json'],
    required: ['capacity'],
    summary: 'Selecciona las tareas ready que caben en la capacidad.',
    run: sprintPlan,
  },
  {
    name: 'task prepare',
    args: ['TASK-ID'],
    flags: ['file', 'repo', 'models', 'max-context-bytes', 'json'],
    summary: 'Genera el paquete de contexto de una tarea ready.',
    run: taskPrepare,
  },
  {
    name: 'task run',
    args: ['TASK-ID'],
    flags: ['models', 'file', 'repo', 'max-context-bytes', 'max-total-tokens', 'timeout-seconds', 'execute', 'json'],
    required: ['models'],
    requires: { execute: ['max-total-tokens', 'timeout-seconds'] },
    summary: 'Planifica la implementación con Codex; con --execute la ejecuta.',
    run: taskRun,
  },
  {
    name: 'task verify',
    args: ['TASK-ID'],
    flags: ['file', 'repo', 'base', 'run-tests', 'test-timeout-seconds', 'json'],
    requires: { 'test-timeout-seconds': ['run-tests'] },
    summary: 'Comprueba el diff contra --base y, con --run-tests, npm test.',
    run: taskVerify,
  },
  {
    name: 'task review',
    args: ['TASK-ID'],
    flags: ['file', 'repo', 'base', 'models', 'run-tests', 'test-timeout-seconds', 'include-diff', 'max-review-bytes', 'json'],
    requires: { 'test-timeout-seconds': ['run-tests'], 'max-review-bytes': ['include-diff'] },
    summary: 'Prepara el handoff de revisión independiente sin invocar Codex.',
    run: taskReview,
  },
  {
    name: 'task review-run',
    args: ['TASK-ID'],
    flags: ['models', 'run-tests', 'include-diff', 'file', 'repo', 'base', 'test-timeout-seconds', 'max-review-bytes', 'max-total-tokens', 'timeout-seconds', 'execute', 'json'],
    required: ['models', 'run-tests', 'include-diff'],
    requires: { execute: ['max-total-tokens', 'timeout-seconds'] },
    summary: 'Planifica la revisión de solo lectura; con --execute invoca Codex.',
    run: taskReviewRun,
  },
];

/**
 * Punto de entrada de backlog, route, sprint y task; devuelve el código de salida.
 * Solo --execute invoca Codex; --run-tests ejecuta npm test y backlog plan --out escribe.
 */
export async function runPlanningCommand(argv) {
  try {
    const { spec, args, options } = parseCommandLine(argv);
    return await spec.run({ args, options });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

/** Ayuda de los comandos y opciones, generada desde la especificación (la usa --help). */
export function planningHelp() {
  const commands = COMMANDS.map(spec => `${usageBlock(spec)}\n      ${spec.summary}`);
  const options = Object.keys(FLAGS).map(optionHelp);
  return { commands: commands.join('\n'), options: options.join('\n') };
}

/** Ayuda de una opción; la de un entero añade una segunda línea con su rango y su valor por defecto. */
function optionHelp(name) {
  const flag = FLAGS[name];
  const label = `  ${flagText(name).padEnd(FLAG_COLUMN)}  `;
  if (flag.type !== 'integer') {
    const byDefault = flag.default === undefined ? '' : ` (por defecto ${flag.default})`;
    return `${label}${flag.help}${byDefault}.`;
  }
  const byDefault = flag.default === undefined ? '' : `; por defecto ${flag.default}`;
  // Una sola línea pasaría de HELP_WIDTH columnas.
  const range = `Entero entre ${flag.min} y ${flag.max}${byDefault}.`;
  return `${label}${flag.help}.\n${' '.repeat(label.length)}${range}`;
}

/** Valida la línea de comandos contra la especificación antes de leer ningún archivo. */
function parseCommandLine(argv) {
  const { given, positionals } = tokenize(argv);
  const spec = findCommand(positionals);
  if (!spec) {
    const usages = COMMANDS.map(usageBlock).join('\n');
    throw new Error(`Comando esperado:\n${usages}\nUsa --help para ver cada opción.`);
  }
  const args = positionals.slice(spec.name.split(' ').length);
  if (args.length !== spec.args.length) {
    const problem = args.length > spec.args.length ? 'Demasiados argumentos.' : `Falta el argumento ${spec.args[args.length]}.`;
    throw new Error(`${problem} Uso:\n${usageBlock(spec)}`);
  }
  for (const name of given.keys()) {
    if (!spec.flags.includes(name)) throw new Error(`${spec.name} no admite --${name}.`);
  }
  const missing = (spec.required ?? []).filter(name => !given.has(name));
  if (missing.length) throw new Error(`${spec.name} requiere ${flagList(missing)}.`);
  for (const [trigger, needed] of Object.entries(spec.requires ?? {})) {
    const absent = needed.filter(name => !given.has(name));
    if (given.has(trigger) && absent.length) throw new Error(`--${trigger} exige ${flagList(absent)}.`);
  }
  const options = {};
  for (const name of spec.flags) {
    const flag = FLAGS[name];
    if (given.has(name)) options[name] = parseValue(name, given.get(name));
    else options[name] = flag.type === 'boolean' ? false : flag.default;
  }
  return { spec, args, options };
}

/** Separa las opciones (con su valor en bruto) de los argumentos posicionales. */
function tokenize(argv) {
  const given = new Map();
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (!arg.startsWith('--') || !Object.hasOwn(FLAGS, name)) throw new Error(`Opción no reconocida: ${arg}`);
    if (FLAGS[name].type === 'boolean') {
      given.set(name, true);
      continue;
    }
    // Un valor ausente o que es otra opción larga indica que se olvidó el valor.
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requiere ${FLAGS[name].type === 'path' ? 'una ruta' : 'un valor'}.`);
    }
    given.set(name, value);
    // El valor ya se consumió.
    i++;
  }
  return { given, positionals };
}

function findCommand([first, second]) {
  return COMMANDS.find(spec => spec.name === `${first} ${second}`) ??
    COMMANDS.find(spec => spec.name === first);
}

function parseValue(name, raw) {
  const { type } = FLAGS[name];
  if (type === 'integer') return integerInRange(name, raw);
  if (type === 'ref') return assertBaseRef(raw);
  return raw;
}

/** Único parser numérico del CLI: enteros decimales dentro del rango declarado en FLAGS. */
function integerInRange(name, raw) {
  const { min, max } = FLAGS[name];
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} requiere un entero entre ${min} y ${max}.`);
  }
  return value;
}

function flagText(name) {
  const { arg } = FLAGS[name];
  return arg ? `--${name} ${arg}` : `--${name}`;
}

/** "--a", "--a y --b", "--a, --b y --c", sin depender de los datos ICU de Node. */
function flagList(names) {
  const flags = names.map(name => `--${name}`);
  if (flags.length < 2) return flags.join('');
  return `${flags.slice(0, -1).join(', ')} y ${flags.at(-1)}`;
}

/** Uso de un comando partido en líneas de como máximo HELP_WIDTH columnas. */
function usageBlock(spec) {
  const parts = [...spec.args];
  for (const name of spec.flags) {
    parts.push(spec.required?.includes(name) ? flagText(name) : `[${flagText(name)}]`);
  }
  const lines = [`  ${spec.name}`];
  for (const part of parts) {
    const last = lines.length - 1;
    if (lines[last].length + 1 + part.length > HELP_WIDTH) lines.push(`      ${part}`);
    else lines[last] += ` ${part}`;
  }
  return lines.join('\n');
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer JSON en ${file}: ${error.message}`);
  }
}

function readModels(file) {
  return file ? loadModelProfiles(readJSON(file)) : {};
}

function printJSON(value) {
  console.log(JSON.stringify(value, null, 2));
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function backlogPlan({ args: [prdFile], options }) {
  const markdown = fs.readFileSync(path.resolve(prdFile), 'utf8');
  const result = planBacklogFromPRD(markdown);
  for (const warning of result.warnings) console.error(`WARN ${warning}`);
  const output = JSON.stringify(result.backlog, null, 2) + '\n';
  if (!options.out) {
    // Sin --out la salida ya es el backlog en JSON, con o sin --json.
    process.stdout.write(output);
    return 0;
  }
  const target = path.resolve(options.out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // 'wx' falla si el archivo ya existe: nunca se sobrescribe.
  fs.writeFileSync(target, output, { encoding: 'utf8', flag: 'wx' });
  if (options.json) {
    printJSON({ file: target, tasks: result.backlog.tasks.length, warnings: result.warnings, stats: result.stats });
    return 0;
  }
  const tasks = plural(result.backlog.tasks.length, 'tarea', 'tareas');
  const warnings = plural(result.warnings.length, 'advertencia', 'advertencias');
  console.log(`Backlog borrador: ${target} (${tasks}; ${warnings}).`);
  return 0;
}

function backlogValidate({ options }) {
  const result = validateBacklog(readJSON(options.file));
  if (!result.valid) {
    console.error(`Backlog inválido: ${result.errors.length} error(es):`);
    for (const error of result.errors) console.error(`- ${error}`);
    return 1;
  }
  console.log(`Backlog válido: ${options.file}`);
  return 0;
}

function route({ args: [taskId], options }) {
  const backlog = readJSON(options.file);
  const report = validateBacklog(backlog);
  if (!report.valid) throw new Error(`Backlog inválido:\n- ${report.errors.join('\n- ')}`);
  const task = backlog.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
  const result = routeTask(task, readModels(options.models));
  if (options.json) {
    printJSON(result);
    return 0;
  }
  console.log(`${result.task_id}: complejidad ${result.complexity.level} (${result.complexity.score}/10), riesgo ${result.risk}`);
  console.log(`Implementador: ${result.implementer.tier} / ${result.implementer.reasoning_effort} [${result.implementer.model_id ?? 'ID no configurado'}]`);
  console.log(`Revisor: ${result.reviewer.tier} / ${result.reviewer.reasoning_effort} [${result.reviewer.model_id ?? 'ID no configurado'}]`);
  if (result.requires_human_approval) console.log('Requiere aprobación humana.');
  for (const explanation of result.justification) console.log(`- ${explanation}`);
  console.log('DRY-RUN: no se ha invocado ningún modelo.');
  return 0;
}

function sprintPlan({ options }) {
  const models = readModels(options.models);
  const plan = planSprint(readJSON(options.file), { capacity: options.capacity, models });
  if (options.json) {
    printJSON(plan);
    return 0;
  }
  const selected = plural(plan.selected.length, 'tarea seleccionada', 'tareas seleccionadas');
  console.log(`Sprint (DRY-RUN): ${plan.used_points}/${plan.capacity} SP, ${selected}.`);
  for (const t of plan.selected) {
    console.log(`+ ${t.id} P${t.priority} ${t.story_points}SP → ${t.routing.implementer.tier} / revisión ${t.routing.reviewer.tier}`);
  }
  for (const t of plan.deferred) console.log(`DEFERRED ${t.id}: ${t.reason}`);
  for (const t of plan.blocked) console.log(`BLOCKED ${t.id}: ${t.reason}`);
  return 0;
}

function taskPrepare({ args: [taskId], options }) {
  const models = readModels(options.models);
  const packet = prepareTaskPacket(readJSON(options.file), taskId, {
    repoRoot: options.repo ?? process.cwd(),
    models,
    maxContextBytes: options['max-context-bytes'],
  });
  if (options.json) {
    printJSON(packet);
    return 0;
  }
  console.log(`${packet.task.id}: paquete preparado (DRY-RUN), ${packet.packet_bytes}/${packet.max_context_bytes} bytes.`);
  console.log(`Implementación: ${packet.routing.implementer.tier}; revisión: ${packet.routing.reviewer.tier}.`);
  console.log(`Archivos incluidos: ${packet.context_files.map(f => f.path).join(', ') || 'ninguno'}.`);
  console.log('Sin ejecución de modelos; usa --json para inspeccionar el contexto y quality gates.');
  return 0;
}

async function taskRun({ args: [taskId], options }) {
  const models = readModels(options.models);
  const repoRoot = options.repo ?? process.cwd();
  const packet = prepareTaskPacket(readJSON(options.file), taskId, {
    repoRoot,
    models,
    maxContextBytes: options['max-context-bytes'],
  });
  const plan = planTaskExecution(packet, {
    maxTotalTokens: options['max-total-tokens'],
    timeoutSeconds: options['timeout-seconds'],
  });
  if (!options.execute) {
    const { prompt, ...publicPlan } = plan;
    const output = {
      ...publicPlan,
      execute_requires_explicit_flag: '--execute',
      warning: 'El máximo de tokens no es un límite duro de gasto.',
    };
    if (options.json) printJSON(output);
    else console.log(`DRY-RUN ${taskId}: ${output.model_id}, presupuesto orientativo ${output.max_total_tokens} tokens, máximo ${output.timeout_seconds}s. Usar --execute para autorizar Codex.`);
    return 0;
  }
  const result = await executeTaskPlan(plan, { repoRoot });
  if (options.json) {
    printJSON(result);
  } else {
    console.log(`${taskId}: ${result.status}, ${result.usage?.total_tokens ?? 'uso desconocido'} tokens observados. Revisión humana obligatoria.`);
    // Solo la ruta: el mensaje del modelo nunca se imprime.
    if (result.report_file) console.log(`Informe del implementador: ${result.report_file}`);
    if (result.report_error) console.error(`No se pudo guardar el informe del implementador (${result.report_error}).`);
  }
  return result.status === 'completed_needs_review' ? 0 : 1;
}

function taskVerify({ args: [taskId], options }) {
  const result = verifyTaskChanges(readJSON(options.file), taskId, {
    repoRoot: options.repo ?? process.cwd(),
    runTests: options['run-tests'],
    timeoutSeconds: options['test-timeout-seconds'],
    baseRef: options.base,
  });
  if (options.json) {
    printJSON(result);
  } else {
    const tests = result.tests.executed ? (result.checks.tests_passed ? 'PASS' : 'FAIL') : 'NO EJECUTADOS';
    console.log(`${taskId}: ${result.changed_files.length} archivos modificados, ${result.untracked_files.length} sin registrar.`);
    console.log(`Base: ${result.base_ref} (merge-base ${result.base_sha}).`);
    console.log(`Diff: ${result.diff_sha256}; whitespace: ${result.checks.whitespace_clean ? 'OK' : 'ERROR'}.`);
    console.log(`Tests: ${tests}.`);
    if (result.checks.worktree_unchanged_by_tests === false) {
      console.log(worktreeNote(result.tests.worktree_changes));
    }
    console.log(`Revisión independiente: ${result.ready_for_independent_review ? 'LISTO PARA SOLICITAR' : 'BLOQUEADO'}. TDD RED no verificado.`);
  }
  return options['run-tests'] && !result.ready_for_independent_review ? 1 : 0;
}

function taskReview({ args: [taskId], options }) {
  const models = readModels(options.models);
  const result = prepareIndependentReview(readJSON(options.file), taskId, {
    repoRoot: options.repo ?? process.cwd(),
    models,
    runTests: options['run-tests'],
    timeoutSeconds: options['test-timeout-seconds'],
    includeDiff: options['include-diff'],
    maxReviewBytes: options['max-review-bytes'],
    baseRef: options.base,
  });
  if (options.json) {
    printJSON(result);
  } else {
    console.log(`${taskId}: ${result.status}; ${result.qa.changed_files.length} archivos; QA ${result.qa.checks.tests_passed === true ? 'PASS' : 'NO CONFIRMADO'}.`);
    console.log(`Base: ${result.qa.base_ref} (merge-base ${result.qa.base_sha}).`);
    console.log(`Revisor sugerido: ${result.reviewer.tier}; diff ${result.diff.sha256}.`);
    if (result.note) console.log(result.note);
    console.log('Revisión independiente y aprobación humana todavía pendientes.');
  }
  return options['run-tests'] && result.status !== 'ready_for_independent_review' ? 1 : 0;
}

async function taskReviewRun({ args: [taskId], options }) {
  const repoRoot = options.repo ?? process.cwd();
  const models = readModels(options.models);
  const handoff = prepareIndependentReview(readJSON(options.file), taskId, {
    repoRoot,
    models,
    runTests: true,
    includeDiff: true,
    timeoutSeconds: options['test-timeout-seconds'],
    maxReviewBytes: options['max-review-bytes'],
    baseRef: options.base,
  });
  const plan = planIndependentReview(handoff, {
    maxTotalTokens: options['max-total-tokens'],
    timeoutSeconds: options['timeout-seconds'],
  });
  if (!options.execute) {
    const { prompt, ...publicPlan } = plan;
    if (options.json) {
      printJSON({ ...publicPlan, warning: 'Dry-run, no se invocó Codex. npm test se ejecutó. El límite de tokens no es duro.' });
      return 0;
    }
    console.log(`DRY-RUN revisión de ${taskId}: ${plan.model_id}, ${plan.prompt_bytes} bytes. Usar --execute para invocar Codex.`);
    // Mismo formato que task verify y task review.
    console.log(`Base: ${plan.base_ref} (merge-base ${plan.base_sha}).`);
    return 0;
  }
  const result = await executeIndependentReview(plan, { repoRoot });
  if (options.json) printJSON(result);
  else console.log(`${taskId}: ${result.status}, veredicto ${result.verdict ?? 'no disponible'}; revisión humana obligatoria.`);
  return result.status === 'completed_needs_human_review' ? 0 : 1;
}
