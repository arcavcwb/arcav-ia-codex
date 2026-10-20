import fs from 'node:fs';
import path from 'node:path';
import { validateBacklog } from './validate.js';
import { planBacklogFromPRD } from './prd.js';
import { loadModelProfiles, routeTask } from '../routing/router.js';

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer JSON en ${file}: ${error.message}`);
  }
}
function parseFlags(args) {
  const options = {file:'backlog/tasks.json',models:null,out:null,json:false}, positionals=[];
  for (let i=0; i<args.length; i++) {
    const arg=args[i];
    if (arg === '--json') {options.json=true;continue;}
    if (arg === '--file' || arg === '--models' || arg === '--out') {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${arg} requiere una ruta.`);
      options[arg.slice(2)] = args[++i];continue;
    }
    if (arg.startsWith('-')) throw new Error(`Opción no reconocida: ${arg}`);
    positionals.push(arg);
  }
  return {options,positionals};
}

/** Entrada aislada: ni Codex, ni git, ni escrituras. */
export function runPlanningCommand(args) {
  try {
    const {options,positionals} = parseFlags(args);
    const [command,subcommand,taskId,...extra] = positionals;
    if (extra.length) throw new Error('Demasiados argumentos.');
    if (command === 'backlog' && subcommand === 'plan' && taskId) {
      if (options.models || options.file !== 'backlog/tasks.json') {
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
      if (options.models || options.json) throw new Error('backlog validate sólo admite --file.');
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
      if (options.out) throw new Error('route no admite --out.');
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
    throw new Error('Comando esperado: backlog plan PRD.md [--out ruta] [--json], backlog validate [--file ruta] o route TASK-ID [--file ruta] [--models ruta] [--json].');
  } catch(error) {
    console.error(error.message);
    return 1;
  }
}
