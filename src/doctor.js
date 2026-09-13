import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { colors } from './ui.js';
import { isGitRepo } from './utils.js';

export const CORE_SKILLS = [
  'impeccable',
  'caveman',
  'ponytail',
  'contract-first-api',
  'vite-modernizer',
  'web-vitals-heavy-media',
  'pnpm-monorepo-architect',
  'playwright-e2e-suite',
];

export const CODEX_AGENTS = [
  'architect',
  'frontend',
  'backend',
  'reviewer',
  'qa',
];

function commandExists(command) {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasFile(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function hasDir(dir) {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

export function runDoctor(targetDir = process.cwd()) {
  console.log(`${colors.cyan}${colors.bold}Ejecutando Codex Doctor en:${colors.reset} ${targetDir}\n`);
  let issues = 0;

  if (commandExists('git')) {
    console.log(`  ${colors.green}OK${colors.reset} Git disponible`);
  } else {
    console.log(`  ${colors.red}ERR${colors.reset} Git no encontrado en PATH`);
    issues++;
  }

  if (isGitRepo(targetDir)) {
    console.log(`  ${colors.green}OK${colors.reset} Repositorio Git detectado`);
  } else {
    console.log(`  ${colors.red}ERR${colors.reset} El destino no es un repositorio Git`);
    issues++;
  }

  if (commandExists('gh')) {
    try {
      const user = execSync('gh api user -q .login', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      console.log(`  ${colors.green}OK${colors.reset} GitHub CLI autenticado como ${colors.cyan}@${user}${colors.reset}`);
    } catch {
      console.log(`  ${colors.yellow}WARN${colors.reset} GitHub CLI instalado, autenticacion no comprobable`);
    }
  } else {
    console.log(`  ${colors.yellow}WARN${colors.reset} GitHub CLI no instalado; se omite validacion de PR`);
  }

  if (commandExists('codex')) {
    console.log(`  ${colors.green}OK${colors.reset} Codex CLI disponible`);
  } else {
    console.log(`  ${colors.yellow}WARN${colors.reset} Codex CLI no encontrado en PATH`);
  }

  const requiredFiles = [
    'AGENTS.md',
    '.codex/config.toml',
    'task.md',
  ];

  for (const file of requiredFiles) {
    if (hasFile(path.join(targetDir, file))) {
      console.log(`  ${colors.green}OK${colors.reset} ${file}`);
    } else {
      console.log(`  ${colors.red}ERR${colors.reset} Falta ${file}`);
      issues++;
    }
  }

  for (const agent of CODEX_AGENTS) {
    const file = `.codex/agents/${agent}.toml`;
    if (hasFile(path.join(targetDir, file))) {
      console.log(`  ${colors.green}OK${colors.reset} ${file}`);
    } else {
      console.log(`  ${colors.red}ERR${colors.reset} Falta ${file}`);
      issues++;
    }
  }

  for (const skill of CORE_SKILLS) {
    const file = `.agents/skills/${skill}/SKILL.md`;
    if (hasFile(path.join(targetDir, file))) {
      console.log(`  ${colors.green}OK${colors.reset} ${file}`);
    } else {
      console.log(`  ${colors.red}ERR${colors.reset} Falta ${file}`);
      issues++;
    }
  }

  if (hasDir(path.join(targetDir, 'docs', 'walkthroughs'))) {
    console.log(`  ${colors.green}OK${colors.reset} docs/walkthroughs`);
  } else {
    console.log(`  ${colors.red}ERR${colors.reset} Falta docs/walkthroughs`);
    issues++;
  }

  const pkgPath = path.join(targetDir, 'package.json');
  if (hasFile(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts['check:design']) {
        console.log(`  ${colors.green}OK${colors.reset} package.json incluye check:design`);
      } else {
        console.log(`  ${colors.yellow}WARN${colors.reset} package.json no incluye check:design`);
      }
    } catch {
      console.log(`  ${colors.yellow}WARN${colors.reset} package.json no se pudo parsear`);
    }
  }

  console.log('');
  if (issues === 0) {
    console.log(`${colors.green}${colors.bold}Todo en orden para Codex.${colors.reset}\n`);
    return 0;
  }

  console.log(`${colors.red}${colors.bold}Se detectaron ${issues} problema(s) de estructura Codex.${colors.reset}\n`);
  return 1;
}
