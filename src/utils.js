import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PACKAGE_ROOT = path.resolve(__dirname, '..');
export const TEMPLATES_DIR = path.join(PACKAGE_ROOT, 'templates');

export function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

export function copyDirMissing(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirMissing(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function writeFileIfMissing(dest, content) {
  if (fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
  return true;
}

export function isGitRepo(targetDir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: targetDir,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function initGitRepo(targetDir) {
  try {
    execSync('git init', { cwd: targetDir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function ensureGitIgnoreEntries(targetDir, entries) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  let currentContent = '';
  if (fs.existsSync(gitignorePath)) {
    currentContent = fs.readFileSync(gitignorePath, 'utf8');
  }

  const lines = currentContent.split(/\r?\n/);
  const toAppend = [];

  for (const entry of entries) {
    if (!lines.includes(entry)) {
      toAppend.push(entry);
    }
  }

  if (toAppend.length > 0) {
    const addition = (currentContent.endsWith('\n') || currentContent === '' ? '' : '\n') + toAppend.join('\n') + '\n';
    fs.appendFileSync(gitignorePath, addition, 'utf8');
  }
}

export function injectDesignCheckScript(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) return false;
    if (!pkg.scripts['check:design']) {
      pkg.scripts['check:design'] = '.agents/skills/impeccable/scripts/impeccable detect';
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
