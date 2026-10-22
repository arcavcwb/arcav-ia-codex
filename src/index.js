import path from 'node:path';
import fs from 'node:fs';
import { showBanner, colors } from './ui.js';
import { scaffoldProject } from './scaffolder.js';
import { runDoctor } from './doctor.js';
import { PACKAGE_ROOT } from './utils.js';
import { runPlanningCommand, planningHelp } from './backlog/command.js';

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
    // Comandos y opciones de planificación salen de la misma especificación que los valida.
    const planning = planningHelp();
    console.log(`
${colors.bold}USO:${colors.reset}
  npx @arcav-ia/codex <comando> [opciones]
  npx github:arcavcwb/arcav-ia-codex <comando> [opciones]

${colors.bold}PREPARAR UN PROYECTO:${colors.reset}
  init [directorio]         Prepara para Codex el directorio dado o el actual.
  --doctor, --check-env     Ejecuta únicamente el diagnóstico de salud.
  -v, --version             Muestra la versión instalada.
  -h, --help                Muestra esta ayuda.

${colors.bold}PLANIFICACIÓN Y REVISIÓN${colors.reset} (sin --execute nunca se invoca Codex):
${planning.commands}

${colors.bold}OPCIONES DE PLANIFICACIÓN:${colors.reset}
${planning.options}

${colors.bold}EJEMPLOS:${colors.reset}
  npx @arcav-ia/codex init mi-proyecto
  npx @arcav-ia/codex backlog plan PRD.md --out backlog/tasks.json
  npx @arcav-ia/codex task verify TASK-001 --repo . --base develop --run-tests
  npx @arcav-ia/codex task review-run TASK-001 --models models.local.json \\
      --run-tests --include-diff --execute --max-total-tokens 4000 \\
      --timeout-seconds 120
`);
    process.exit(0);
  }

  if (args[0] === 'backlog' || args[0] === 'route' || args[0] === 'sprint' || args[0] === 'task') {
    // Sin process.exit(): en una tubería stdout es asíncrono y se cortaría en 64 KiB.
    // Node sale con este código cuando termina de escribir la salida pendiente.
    // Si quien lee cierra la tubería antes (p. ej. `| head`), EPIPE no es un fallo del CLI.
    process.stdout.on('error', error => {
      if (error.code !== 'EPIPE') throw error;
    });
    process.exitCode = await runPlanningCommand(args);
    return;
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
