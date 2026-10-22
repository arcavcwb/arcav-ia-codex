import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CODEX_TEMPLATE_DIR = fileURLToPath(new URL('../templates/codex/', import.meta.url));

// init termina ejecutando doctor, que llama a `gh api user` (puede usar red) y a
// `codex --version`; el límite evita que una red colgada bloquee la suite.
const RUN_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 180_000;

const BINARY_IGNORE_ENTRY = '.agents/skills/impeccable/scripts/bin/';
const BINARY_FILE = '.agents/skills/impeccable/scripts/bin/linux-x64/impeccable';

const AGENTS = ['architect', 'backend', 'frontend', 'qa', 'reviewer'];

const SKILLS = [
  'caveman',
  'contract-first-api',
  'impeccable',
  'playwright-e2e-suite',
  'pnpm-monorepo-architect',
  'ponytail',
  'vite-modernizer',
  'web-vitals-heavy-media',
];

function withTempDir(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcav-scaffold-'));
  try {
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Ejecuta el CLI real. Los avisos de gh/codex no cuentan como errores de doctor,
// así que init debe salir con 0 aunque falten esas herramientas.
function runInit(dir) {
  const result = spawnSync(process.execPath, [CLI, 'init', dir], {
    cwd: dir,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
  assert.equal(result.error, undefined, `init no terminó: ${result.error}`);
  assert.equal(result.status, 0, `init salió con ${result.status}\n${result.stdout}\n${result.stderr}`);
}

function isFile(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function isDir(dir) {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// Clave de primer nivel, sin comentar y con algún valor.
function hasTopLevelKey(toml, key) {
  return new RegExp(`^${key}\\s*=\\s*\\S`, 'm').test(toml);
}

test('init dos veces genera la estructura Codex sin duplicar el .gitignore del binario', { timeout: TEST_TIMEOUT_MS }, () => {
  withTempDir((dir) => {
    runInit(dir);
    runInit(dir);

    for (const file of ['AGENTS.md', 'task.md', '.codex/config.toml']) {
      assert.ok(isFile(path.join(dir, file)), `falta ${file}`);
    }
    for (const skill of SKILLS) {
      assert.ok(isFile(path.join(dir, '.agents', 'skills', skill, 'SKILL.md')), `falta la skill ${skill}`);
    }
    assert.ok(isDir(path.join(dir, 'docs', 'walkthroughs')), 'falta docs/walkthroughs');
    assert.equal(read(dir, 'AGENTS.md'), fs.readFileSync(path.join(CODEX_TEMPLATE_DIR, 'AGENTS.md'), 'utf8'));

    // La entrada del binario aparece una sola vez tras dos ejecuciones.
    const gitignoreLines = read(dir, '.gitignore').split(/\r?\n/);
    const binaryEntries = gitignoreLines.filter((line) => line === BINARY_IGNORE_ENTRY);
    assert.equal(binaryEntries.length, 1, '.gitignore debe contener la entrada del binario exactamente una vez');

    // El binario se sigue copiando para uso offline, pero Git lo ignora.
    assert.ok(isFile(path.join(dir, BINARY_FILE)), 'falta el binario de impeccable');
    const checkIgnore = spawnSync('git', ['check-ignore', '--quiet', BINARY_FILE], { cwd: dir });
    assert.equal(checkIgnore.status, 0, 'Git no ignora el binario de impeccable');

    // Agentes: sin modelo fijado ni sandbox_mode (no aplica en archivos de agente).
    const agentsDir = path.join(dir, '.codex', 'agents');
    const agentFiles = fs.readdirSync(agentsDir).filter((file) => file.endsWith('.toml')).sort();
    assert.deepEqual(agentFiles, AGENTS.map((agent) => `${agent}.toml`));
    for (const file of agentFiles) {
      const toml = fs.readFileSync(path.join(agentsDir, file), 'utf8');
      assert.doesNotMatch(toml, /^\s*model\s*=/m, `${file} fija un modelo`);
      assert.doesNotMatch(toml, /^\s*sandbox_mode\s*=/m, `${file} declara sandbox_mode`);
      for (const key of ['name', 'description', 'developer_instructions']) {
        assert.ok(hasTopLevelKey(toml, key), `${file} no define ${key}`);
      }
      assert.match(toml, new RegExp(`^name\\s*=\\s*"${path.basename(file, '.toml')}"`, 'm'), `${file} tiene otro name`);
    }

    // config.toml: el modelo solo aparece como sugerencia comentada.
    const config = read(dir, '.codex/config.toml');
    assert.doesNotMatch(config, /^\s*model\s*=/m, 'config.toml fija un modelo');
    assert.match(config, /^#\s*model\s*=/m, 'config.toml perdió la sugerencia comentada de modelo');
  });
});

test('init conserva AGENTS.md y task.md existentes', { timeout: TEST_TIMEOUT_MS }, () => {
  withTempDir((dir) => {
    const agents = '# Reglas propias del proyecto\n';
    const task = '# Tarea en curso\n\n- [ ] No tocar\n';
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), agents);
    fs.writeFileSync(path.join(dir, 'task.md'), task);

    runInit(dir);

    assert.equal(read(dir, 'AGENTS.md'), agents);
    assert.equal(read(dir, 'task.md'), task);
  });
});
