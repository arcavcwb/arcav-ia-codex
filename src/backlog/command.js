import fs from 'node:fs';
import path from 'node:path';
import { validateBacklog } from './validate.js';
import { planBacklogFromPRD } from './prd.js';
import { loadModelProfiles, routeTask } from '../routing/router.js';
import { planSprint } from '../sprint/planner.js';
import { prepareTaskPacket } from '../execution/packet.js';
import { planTaskExecution, executeTaskPlan } from '../execution/runner.js';
import { verifyTaskChanges } from '../execution/verify.js';
import { prepareIndependentReview } from '../execution/review.js';

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer JSON en ${file}: ${error.message}`);
  }
}
function parseFlags(args) {
  const options = {file:'backlog/tasks.json',models:null,out:null,json:false,capacity:null,repo:null,'max-context-bytes':null,'max-total-tokens':null,'timeout-seconds':null,execute:false,'run-tests':false,'test-timeout-seconds':null,'include-diff':false,'max-review-bytes':null}, positionals=[];
  for (let i=0; i<args.length; i++) {
    const arg=args[i];
    if (arg === '--json') {options.json=true;continue;}
    if (arg === '--execute') {options.execute=true;continue;}
    if (arg === '--run-tests') {options['run-tests']=true;continue;}
    if (arg === '--include-diff') {options['include-diff']=true;continue;}
    if (arg === '--file' || arg === '--models' || arg === '--out' || arg === '--capacity' || arg === '--repo' || arg === '--max-context-bytes' || arg === '--max-total-tokens' || arg === '--timeout-seconds' || arg === '--test-timeout-seconds' || arg === '--max-review-bytes') {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${arg} requiere una ruta.`);
      options[arg.slice(2)] = args[++i];continue;
    }
    if (arg.startsWith('-')) throw new Error(`Opción no reconocida: ${arg}`);
    positionals.push(arg);
  }
  return {options,positionals};
}

/** Entrada aislada: ni Codex, ni git, ni escrituras. */
export async function runPlanningCommand(args) {
  try {
    const {options,positionals} = parseFlags(args);
    const [command,subcommand,taskId,...extra] = positionals;
    if (extra.length) throw new Error('Demasiados argumentos.');
    if ((options['include-diff'] || options['max-review-bytes'] !== null) &&
        !(command === 'task' && subcommand === 'review' && taskId)) {
      throw new Error('--include-diff y --max-review-bytes sólo corresponden a task review.');
    }
    if (command === 'task' && subcommand === 'review' && taskId) {
      if (options.out || options.capacity !== null || options.execute ||
          options['max-context-bytes'] !== null || options['max-total-tokens'] !== null ||
          options['timeout-seconds'] !== null) {
        throw new Error('task review no permite ejecución de modelos ni opciones de task run.');
      }
      if (options['test-timeout-seconds'] !== null && !options['run-tests']) {
        throw new Error('--test-timeout-seconds exige --run-tests.');
      }
      if (options['max-review-bytes'] !== null && !options['include-diff']) {
        throw new Error('--max-review-bytes exige --include-diff.');
      }
      const numeric = (key, defaultValue) => {
        const raw = options[key];
        if (raw === null) return defaultValue;
        if (!/^\d+$/.test(raw)) throw new Error(`--${key} requiere un entero positivo.`);
        return Number(raw);
      };
      const models = options.models ? loadModelProfiles(readJSON(options.models)) : {};
      const result = prepareIndependentReview(readJSON(options.file), taskId, {
        repoRoot: options.repo ?? process.cwd(), models,
        runTests: options['run-tests'],
        timeoutSeconds: numeric('test-timeout-seconds',120),
        includeDiff: options['include-diff'],
        maxReviewBytes: numeric('max-review-bytes',65536),
      });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${taskId}: ${result.status}; ${result.qa.changed_files.length} archivos; QA ${result.qa.checks.tests_passed === true ? 'PASS' : 'NO CONFIRMADO'}.`);
        console.log(`Revisor sugerido: ${result.reviewer.tier}; diff ${result.diff.sha256}.`);
        console.log('Revisión independiente y aprobación humana todavía pendientes.');
      }
      return options['run-tests'] && result.status !== 'ready_for_independent_review' ? 1 : 0;
    }
    if (command === 'task' && subcommand === 'verify' && taskId) {
      if (options.out || options.models || options.capacity !== null || options.execute ||
          options['max-context-bytes'] !== null || options['max-total-tokens'] !== null ||
          options['timeout-seconds'] !== null) {
        throw new Error('task verify sólo admite --file, --repo, --json, --run-tests y --test-timeout-seconds.');
      }
      if (options['test-timeout-seconds'] !== null && !options['run-tests']) {
        throw new Error('--test-timeout-seconds exige --run-tests.');
      }
      const raw = options['test-timeout-seconds'];
      if (raw !== null && !/^\d+$/.test(raw)) throw new Error('--test-timeout-seconds requiere un entero.');
      const result = verifyTaskChanges(readJSON(options.file), taskId, {
        repoRoot: options.repo ?? process.cwd(), runTests: options['run-tests'],
        timeoutSeconds: raw === null ? 120 : Number(raw),
      });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${taskId}: ${result.changed_files.length} archivos modificados, ${result.untracked_files.length} sin registrar.`);
        console.log(`Diff: ${result.diff_sha256}; whitespace: ${result.checks.whitespace_clean ? 'OK' : 'ERROR'}.`);
        console.log(`Tests: ${result.tests.executed ? (result.checks.tests_passed ? 'PASS' : 'FAIL') : 'NO EJECUTADOS'}.`);
        console.log(`Revisión independiente: ${result.ready_for_independent_review ? 'LISTO PARA SOLICITAR' : 'BLOQUEADO'}. TDD RED no verificado.`);
      }
      return options['run-tests'] && !result.ready_for_independent_review ? 1 : 0;
    }
    if (command === 'task' && subcommand === 'run' && taskId) {
      if (options['run-tests'] || options['test-timeout-seconds'] !== null || options.out || options.capacity !== null) throw new Error('task run no admite --out ni --capacity.');
      const numberOption = (key, defaultValue) => {
        const raw = options[key];
        if (raw === null) return defaultValue;
        if (!/^\d+$/.test(raw)) throw new Error(`--${key} requiere un entero positivo.`);
        return Number(raw);
      };
      if (options.execute && (!options.models || options['max-total-tokens'] === null || options['timeout-seconds'] === null)) {
        throw new Error('--execute requiere --models, --max-total-tokens y --timeout-seconds explícitos.');
      }
      const models = options.models ? loadModelProfiles(readJSON(options.models)) : {};
      const repoRoot = options.repo ?? process.cwd();
      const packet = prepareTaskPacket(readJSON(options.file), taskId, {
        repoRoot, models, maxContextBytes:numberOption('max-context-bytes',undefined),
      });
      const plan = planTaskExecution(packet, {
        maxTotalTokens:numberOption('max-total-tokens',8000), timeoutSeconds:numberOption('timeout-seconds',300),
      });
      if (!options.execute) {
        const {prompt, ...publicPlan} = plan;
        const output={...publicPlan,execute_requires_explicit_flag:'--execute',warning:'El máximo de tokens no es un límite duro de gasto.'};
        if(options.json) console.log(JSON.stringify(output,null,2));
        else console.log(`DRY-RUN ${taskId}: ${output.model_id}, presupuesto orientativo ${output.max_total_tokens} tokens, máximo ${output.timeout_seconds}s. Usar --execute para autorizar Codex.`);
        return 0;
      }
      const result = await executeTaskPlan(plan,{repoRoot});
      if(options.json) console.log(JSON.stringify(result,null,2));
      else console.log(`${taskId}: ${result.status}, ${result.usage?.total_tokens ?? 'uso desconocido'} tokens observados. Revisión humana obligatoria.`);
      return result.status === 'completed_needs_review' ? 0 : 1;
    }
    if (command === 'task' && subcommand === 'prepare' && taskId) {
      if (options['run-tests'] || options['test-timeout-seconds'] !== null || options.out || options.capacity !== null || options.execute || options['max-total-tokens'] !== null || options['timeout-seconds'] !== null) throw new Error('task prepare no admite --out ni --capacity.');
      const max = options['max-context-bytes'];
      if (max !== null && !/^\d+$/.test(max)) throw new Error('--max-context-bytes requiere un entero.');
      const models = options.models ? loadModelProfiles(readJSON(options.models)) : {};
      const packet = prepareTaskPacket(readJSON(options.file), taskId, {
        repoRoot: options.repo ?? process.cwd(), models,
        maxContextBytes: max === null ? undefined : Number(max),
      });
      if (options.json) console.log(JSON.stringify(packet, null, 2));
      else {
        console.log(`${packet.task.id}: paquete preparado (DRY-RUN), ${packet.packet_bytes}/${packet.max_context_bytes} bytes.`);
        console.log(`Implementación: ${packet.routing.implementer.tier}; revisión: ${packet.routing.reviewer.tier}.`);
        console.log(`Archivos incluidos: ${packet.context_files.map(f => f.path).join(', ') || 'ninguno'}.`);
        console.log('Sin ejecución de modelos; usa --json para inspeccionar el contexto y quality gates.');
      }
      return 0;
    }
    if (command === 'sprint' && subcommand === 'plan' && !taskId) {
      if (options['run-tests'] || options['test-timeout-seconds'] !== null || options.execute || options['max-total-tokens'] !== null || options['timeout-seconds'] !== null || options.repo !== null || options['max-context-bytes'] !== null) throw new Error('sprint plan no admite --repo ni --max-context-bytes.');
      if (options.out) throw new Error('sprint plan no admite --out (salida de sólo lectura).');
      if (options.capacity === null || !/^\d+$/.test(options.capacity)) {
        throw new Error('sprint plan requiere --capacity con un entero positivo.');
      }
      const models = options.models ? loadModelProfiles(readJSON(options.models)) : {};
      const plan = planSprint(readJSON(options.file), {capacity:Number(options.capacity),models});
      if (options.json) console.log(JSON.stringify(plan,null,2));
      else {
        console.log(`Sprint (DRY-RUN): ${plan.used_points}/${plan.capacity} SP, ${plan.selected.length} tareas seleccionadas.`);
        for (const t of plan.selected) console.log(`+ ${t.id} P${t.priority} ${t.story_points}SP → ${t.routing.implementer.tier} / revisión ${t.routing.reviewer.tier}`);
        for (const t of plan.deferred) console.log(`DEFERRED ${t.id}: ${t.reason}`);
        for (const t of plan.blocked) console.log(`BLOCKED ${t.id}: ${t.reason}`);
      }
      return 0;
    }
    if (command === 'backlog' && subcommand === 'plan' && taskId) {
      if (options['run-tests'] || options['test-timeout-seconds'] !== null || options.execute || options['max-total-tokens'] !== null || options['timeout-seconds'] !== null || options.models || options.capacity !== null || options.repo !== null || options['max-context-bytes'] !== null || options.file !== 'backlog/tasks.json') {
        throw new Error('backlog plan sólo admite --out y --json.');
      }
      const markdown = fs.readFileSync(path.resolve(taskId), 'utf8');
      const result = planBacklogFromPRD(markdown);
      for (const warning of result.warnings) console.error(`WARN ${warning}`);
      const output = JSON.stringify(result.backlog,null,2)+'\n';
      if (options.out) {
        const target = path.resolve(options.out);
        fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,output,{encoding:'utf8',flag:'wx'});
        console.log(`Backlog borrador: ${target} (${result.stats.tasks} tareas; ${result.warnings.length} advertencias).`);
      } else {
        process.stdout.write(output);
      }
      return 0;
    }
    if (command === 'backlog' && subcommand === 'validate' && !taskId) {
      if(options.out) throw new Error('backlog validate no admite --out.');
      if (options['run-tests'] || options['test-timeout-seconds'] !== null || options.execute || options['max-total-tokens'] !== null || options['timeout-seconds'] !== null || options.models || options.json || options.capacity !== null || options.repo !== null || options['max-context-bytes'] !== null) throw new Error('backlog validate sólo admite --file.');
      const result = validateBacklog(readJSON(options.file));
      if (!result.valid) {
        console.error(`Backlog inválido: ${result.errors.length} error(es):`);
        for(const error of result.errors) console.error(`- ${error}`);
        return 1;
      }
      console.log(`Backlog válido: ${options.file}`);
      return 0;
    }
    if (command === 'route' && subcommand && !taskId) {
      if (options['run-tests'] || options['test-timeout-seconds'] !== null || options.execute || options['max-total-tokens'] !== null || options['timeout-seconds'] !== null || options.out || options.capacity !== null || options.repo !== null || options['max-context-bytes'] !== null) throw new Error('route no admite --out, --capacity, --repo ni --max-context-bytes.');
      const backlog = readJSON(options.file);
      const report = validateBacklog(backlog);
      if (!report.valid) throw new Error(`Backlog inválido:\n- ${report.errors.join('\n- ')}`);
      const task = backlog.tasks.find(t=>t.id===subcommand);
      if (!task) throw new Error(`Tarea no encontrada: ${subcommand}`);
      const models = options.models ? loadModelProfiles(readJSON(options.models)) : {};
      const route = routeTask(task, models);
      if(options.json) console.log(JSON.stringify(route,null,2));
      else {
        console.log(`${route.task_id}: complejidad ${route.complexity.level} (${route.complexity.score}/10), riesgo ${route.risk}`);
        console.log(`Implementador: ${route.implementer.tier} / ${route.implementer.reasoning_effort} [${route.implementer.model_id ?? 'ID no configurado'}]`);
        console.log(`Revisor: ${route.reviewer.tier} / ${route.reviewer.reasoning_effort} [${route.reviewer.model_id ?? 'ID no configurado'}]`);
        if (route.requires_human_approval) console.log('Requiere aprobación humana.');
        for (const explanation of route.justification) console.log(`- ${explanation}`);
        console.log('DRY-RUN: no se ha invocado ningún modelo.');
      }
      return 0;
    }
    throw new Error('Comando esperado: backlog plan PRD.md [--out ruta] [--json], backlog validate [--file ruta], route TASK-ID [--file ruta] [--models ruta] [--json] o sprint plan --capacity N [--file ruta] [--models ruta] [--json], task prepare TASK-ID [--file ruta] [--repo directorio] [--max-context-bytes N] [--models ruta] [--json] o task run TASK-ID --models ruta [--max-total-tokens N] [--timeout-seconds N] [--execute] o task verify TASK-ID [--file ruta] [--repo directorio] [--run-tests] [--test-timeout-seconds N] [--json] o task review TASK-ID [--file ruta] [--repo directorio] [--models ruta] [--run-tests] [--include-diff] [--max-review-bytes N] [--json].');
  } catch(error) {
    console.error(error.message);
    return 1;
  }
}
