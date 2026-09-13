import fs from 'node:fs';
import path from 'node:path';
import { colors } from './ui.js';
import {
  TEMPLATES_DIR,
  copyDirMissing,
  isGitRepo,
  initGitRepo,
  ensureGitIgnoreEntries,
  injectDesignCheckScript,
  writeFileIfMissing,
} from './utils.js';
import { runDoctor } from './doctor.js';

const CODEX_TEMPLATE_DIR = path.join(TEMPLATES_DIR, 'codex');
const CORE_SKILLS_DIR = path.join(TEMPLATES_DIR, 'core-skills');

export async function scaffoldProject({ targetDir }) {
  if (!fs.existsSync(CODEX_TEMPLATE_DIR)) {
    throw new Error('Plantillas Codex no encontradas.');
  }

  console.log(`\n${colors.cyan}Configurando Arcav IA Codex en:${colors.reset} ${colors.bold}${targetDir}${colors.reset}\n`);

  fs.mkdirSync(targetDir, { recursive: true });

  if (!isGitRepo(targetDir)) {
    console.log(`  ${colors.cyan}-${colors.reset} Inicializando repositorio Git...`);
    if (!initGitRepo(targetDir)) {
      throw new Error('No se pudo inicializar Git en el proyecto destino.');
    }
  }

  console.log(`  ${colors.cyan}-${colors.reset} Instalando AGENTS.md y configuracion Codex...`);
  writeFileIfMissing(
    path.join(targetDir, 'AGENTS.md'),
    fs.readFileSync(path.join(CODEX_TEMPLATE_DIR, 'AGENTS.md'), 'utf8')
  );
  copyDirMissing(path.join(CODEX_TEMPLATE_DIR, '.codex'), path.join(targetDir, '.codex'));

  writeFileIfMissing(
    path.join(targetDir, 'task.md'),
    fs.readFileSync(path.join(CODEX_TEMPLATE_DIR, 'task-template.md'), 'utf8')
  );

  console.log(`  ${colors.cyan}-${colors.reset} Instalando 8 skills...`);
  copyDirMissing(CORE_SKILLS_DIR, path.join(targetDir, '.agents', 'skills'));

  fs.mkdirSync(path.join(targetDir, 'docs', 'walkthroughs'), { recursive: true });

  ensureGitIgnoreEntries(targetDir, [
    '.env',
    '.env.local',
    '*.log',
    'node_modules/',
    '.turbo/',
    'dist/',
    'coverage/',
    'playwright-report/',
    'test-results/',
  ]);

  if (injectDesignCheckScript(targetDir)) {
    console.log(`  ${colors.green}OK${colors.reset} Script check:design agregado a package.json`);
  }

  console.log(`\n${colors.green}${colors.bold}Arcav IA Codex instalado.${colors.reset}\n`);
  return runDoctor(targetDir);
}
