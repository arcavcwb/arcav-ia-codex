import path from 'node:path';
import fs from 'node:fs';
import { showBanner, colors } from './ui.js';
import { scaffoldProject } from './scaffolder.js';
import { runDoctor } from './doctor.js';
import { PACKAGE_ROOT } from './utils.js';
import { runPlanningCommand } from './backlog/command.js';
import { runWorktreeCommand } from './worktree/command.js';
import { runBudgetCommand } from './budget/command.js';
import { runSchedulerCommand } from './scheduler/command.js';

export async function main() {
  const args = process.argv.slice(2);

  // Leer versión de package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`${pkg.name} v${pkg.version}`);
    process.exit(0);
  }

  if (args.includes('-h') || args.includes('--help')) {
    showBanner();
    console.log(`
${colors.bold}USO:${colors.reset}
  npx @arcav-ia/codex init [directorio]
  npx github:arcavcwb/arcav-ia-codex init [directorio]

${colors.bold}COMANDOS & EJEMPLOS:${colors.reset}
  npx @arcav-ia/codex init             Prepara el proyecto actual para Codex
  npx @arcav-ia/codex init mi-proyecto Prepara ./mi-proyecto para Codex
  npx @arcav-ia/codex --doctor         Ejecuta el diagnostico Codex
  npx @arcav-ia/codex backlog plan PRD.md --out backlog/tasks.json
  npx @arcav-ia/codex backlog validate --file backlog/tasks.json
  npx @arcav-ia/codex route TASK-001 --file backlog/tasks.json --json
  npx @arcav-ia/codex sprint plan --file backlog/tasks.json --capacity 8 --json
  npx @arcav-ia/codex task prepare TASK-001 --file backlog/tasks.json --repo . --json
  npx @arcav-ia/codex task verify TASK-001 --file backlog/tasks.json --repo . --run-tests --json
  npx @arcav-ia/codex task review TASK-001 --file backlog/tasks.json --repo . --run-tests --json
  npx @arcav-ia/codex task run TASK-001 --file backlog/tasks.json --models models.json --json
  npx @arcav-ia/codex worktree create TASK-001 --file backlog/tasks.json --repo . --json
  npx @arcav-ia/codex worktree status TASK-001 --repo . --json
  npx @arcav-ia/codex worktree remove TASK-001 --repo . --json
  npx @arcav-ia/codex budget status --repo . --policy budget-policy.json --json
  npx @arcav-ia/codex scheduler dispatch TASK-001 --file backlog/tasks.json --repo . --models modelos.json --policy presupuesto.json --run-id intento-001 --max-total-tokens 4000 --timeout-seconds 120 --json

${colors.bold}OPCIONES:${colors.reset}
  --doctor, --check-env            Ejecuta únicamente el diagnóstico de salud
  -v, --version                    Muestra la versión instalada
  -h, --help                       Muestra esta ayuda
`);
    process.exit(0);
  }

  if (args[0] === 'scheduler') {
    process.exit(await runSchedulerCommand(args.slice(1)));
  }

  if (args[0] === 'budget') {
    process.exit(runBudgetCommand(args.slice(1)));
  }

  if (args[0] === 'worktree') {
    process.exit(runWorktreeCommand(args.slice(1)));
  }

  if (args[0] === 'backlog' || args[0] === 'route' || args[0] === 'sprint' || args[0] === 'task') {
    process.exit(await runPlanningCommand(args));
  }

  showBanner();

  if (args.includes('--doctor') || args.includes('--check-env')) {
    const code = runDoctor(process.cwd());
    process.exit(code);
  }

  let targetDir = process.cwd();
  const nonFlagArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      nonFlagArgs.push(arg);
    }
  }

  try {
    if (nonFlagArgs[0] && nonFlagArgs[0] !== 'init') {
      throw new Error(`Comando desconocido: ${nonFlagArgs[0]}`);
    }

    if (nonFlagArgs.length > 1) {
      const targetArg = nonFlagArgs[1];
      if (targetArg !== '.') {
        targetDir = path.resolve(process.cwd(), targetArg);
      }
    }

    const code = await scaffoldProject({ targetDir });
    process.exit(code);
  } catch (error) {
    console.error(`\n${colors.red}${colors.bold}Error al preparar Codex:${colors.reset}`, error.message);
    process.exit(1);
  }
}
