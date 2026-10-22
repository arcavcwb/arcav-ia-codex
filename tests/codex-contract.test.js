import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planTaskExecution, executeTaskPlan } from '../src/execution/runner.js';
import { planIndependentReview, executeIndependentReview } from '../src/execution/reviewer.js';

// Contrato opcional con el Codex CLI instalado: solo se consultan --version, --help y
// "features list", que carga la configuración sin abrir ninguna sesión.
// Nunca se llama a un modelo ni hace falta red ni credenciales.
const CODEX_OPTIONS = { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 };
const version = spawnSync('codex', ['--version'], CODEX_OPTIONS);

function skipReason() {
  if (version.status === 0) return false;
  if (version.error?.code === 'ENOENT') return 'codex no está instalado';
  return 'codex --version no terminó con estado 0';
}
// En CI (CODEX_CONTRACT_REQUIRED=1) no se omite: si Codex falta, el test falla.
const required = process.env.CODEX_CONTRACT_REQUIRED === '1';
const skip = required ? false : skipReason();

function assertCodexAvailable() {
  assert.equal(version.status, 0, `CODEX_CONTRACT_REQUIRED=1 exige Codex instalado: ${skipReason()}.`);
}

const MODEL = 'modelo-de-contrato';
const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const diff = 'diff --git a/src/x.js b/src/x.js\n+const x = 1;\n';
const digest = createHash('sha256').update(diff).digest('hex');

// Entradas falsas mínimas que aceptan los planes reales.
const packet = {
  execution: 'dry-run',
  task: { id: 'TASK-001', risk: 'low' },
  routing: { implementer: { model_id: MODEL } },
  context_files: [],
  quality_gates: [],
  max_context_bytes: 32 * 1024,
};
const handoff = {
  execution: 'review-handoff-only',
  status: 'ready_for_independent_review',
  task: { id: 'TASK-001', risk: 'low' },
  reviewer: { model_id: MODEL },
  review_contract: {
    independent_review_completed: false,
    merge_approved: false,
    implementer_conversation_included: false,
  },
  qa: {
    branch: 'feat/contrato',
    head_sha: HEAD_SHA,
    base_sha: BASE_SHA,
    diff_sha256: digest,
    checks: { tests_passed: true },
    tests: { executed: true, exit_code: 0 },
  },
  diff: { included: true, sha256: digest, content: diff },
};

// Git simulado: rama de feature limpia cuyo diff coincide con el handoff.
function fakeGit(bin, args, { cwd }) {
  const command = args.join(' ');
  if (command === 'rev-parse --show-toplevel') return cwd + '\n';
  if (command === 'branch --show-current') return 'feat/contrato\n';
  if (command === 'status --porcelain') return '';
  if (command === 'rev-parse HEAD') return HEAD_SHA + '\n';
  if (command === 'merge-base HEAD main') return BASE_SHA + '\n';
  if (command === `diff --no-ext-diff --binary ${BASE_SHA} --`) return Buffer.from(diff);
  if (command === 'ls-files --others --exclude-standard') return '';
  throw new Error(`git inesperado: ${command}`);
}

/** argv final con el que se lanzaría codex al ejecutar, capturado sin crear ningún proceso. */
async function capturedArgv(execute, plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcav-contract-'));
  let argv = null;
  try {
    await execute(plan, {
      repoRoot: dir,
      git: fakeGit,
      spawnImpl: (exe, args) => {
        argv = args;
        throw Object.assign(new Error('sin proceso real'), { code: 'CONTRACT' });
      },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(Array.isArray(argv), 'no se capturó el argv de codex');
  return argv;
}

// "exec" separa los flags globales de codex de los propios de codex exec.
function splitFlags(argv) {
  const execIndex = argv.indexOf('exec');
  assert.ok(execIndex >= 0, 'falta el subcomando exec');
  const isFlag = token => /^--?[A-Za-z]/.test(token);
  return {
    global: argv.slice(0, execIndex).filter(isFlag),
    exec: argv.slice(execIndex + 1).filter(isFlag),
  };
}

/** argv del ejecutor y del revisor tal como se lanzan, con lo que se añade al ejecutar. */
async function argvsInUse() {
  return {
    ejecutor: await capturedArgv(executeTaskPlan, planTaskExecution(packet)),
    revisor: await capturedArgv(executeIndependentReview, planIndependentReview(handoff)),
  };
}

/** Flags del ejecutor y del revisor, separados en globales y propios de exec. */
async function flagsInUse() {
  const global = new Set();
  const exec = new Set();
  for (const argv of Object.values(await argvsInUse())) {
    const flags = splitFlags(argv);
    flags.global.forEach(flag => global.add(flag));
    flags.exec.forEach(flag => exec.add(flag));
  }
  return { global: [...global], exec: [...exec] };
}

// Valor que sigue a cada -c (override de configuración, p. ej. approval_policy="never").
function configOverrides(argv) {
  return argv.flatMap((token, index) => (token === '-c' ? [argv[index + 1]] : []));
}

// Solo cuenta la línea donde clap define la opción ("  -m, --model <MODEL>" o "      --json"),
// no una mención dentro de la descripción de otra.
function definesFlag(help, flag) {
  assert.match(flag, /^--?[A-Za-z0-9][A-Za-z0-9-]*$/);
  return new RegExp(`^\\s*(?:-[A-Za-z0-9], )?${flag}(?![\\w-])`, 'm').test(help);
}

function codexHelp(args) {
  const result = spawnSync('codex', args, CODEX_OPTIONS);
  assert.equal(result.status, 0, `codex ${args.join(' ')} terminó con estado ${result.status}`);
  return result.stdout;
}

test('los flags se toman del argv real de ejecución, separados por "exec"', async () => {
  const flags = await flagsInUse();
  // Ningún flag global: approval_policy va como -c dentro de exec.
  assert.deepEqual(flags.global, []);
  assert.ok(flags.exec.includes('-c'));
  // Solo existen al ejecutar el revisor: prueban que no se usa únicamente el argv del dry-run.
  assert.ok(flags.exec.includes('--output-last-message'));
  assert.ok(flags.exec.includes('--output-schema'));
  // Así la comprobación de los valores de -c nunca queda vacía.
  for (const [who, argv] of Object.entries(await argvsInUse())) {
    assert.ok(configOverrides(argv).length > 0, `el argv del ${who} no lleva ningún -c`);
  }
});

test('los flags del ejecutor y del revisor existen en la ayuda del Codex instalado', { skip }, async () => {
  assertCodexAvailable();
  const flags = await flagsInUse();
  const globalHelp = codexHelp(['--help']);
  const execHelp = codexHelp(['exec', '--help']);
  for (const flag of flags.global) {
    assert.ok(definesFlag(globalHelp, flag), `codex --help no define ${flag}`);
  }
  for (const flag of flags.exec) {
    assert.ok(definesFlag(execHelp, flag), `codex exec --help no define ${flag}`);
  }
});

// Más fuerte que buscar en la ayuda: con --help al final, el parser de Codex comprueba la
// posición y la sintaxis de cada flag de exec (y los valores cerrados, como los de --sandbox)
// sin ejecutar nada. No valida los valores ni las claves de -c: los valores se comprueban abajo.
test('el parser del Codex instalado acepta el argv real del ejecutor y del revisor', { skip }, async () => {
  assertCodexAvailable();
  for (const [who, argv] of Object.entries(await argvsInUse())) {
    assert.equal(argv.at(-1), '-', `el argv del ${who} debe leer el prompt por stdin`);
    const result = spawnSync('codex', [...argv.slice(0, -1), '--help'], CODEX_OPTIONS);
    assert.equal(result.status, 0, `codex rechaza el argv del ${who}: ${String(result.stderr).trim()}`);
  }
});

// "codex -c <par> features list" carga la configuración con ese override y sale con error si el
// valor no es válido para su clave. Una clave mal escrita no se detecta: --strict-config no se
// admite en features (ni en mcp ni en login), así que no hay forma offline de comprobarla.
test('el Codex instalado acepta los valores de -c del ejecutor y del revisor', { skip }, async t => {
  assertCodexAvailable();
  // Control negativo: si un valor inválido también sale con 0, la comprobación no prueba nada.
  const control = spawnSync('codex', ['-c', 'approval_policy="__invalido__"', 'features', 'list'], CODEX_OPTIONS);
  if (control.status === 0) {
    t.skip('codex -c approval_policy="__invalido__" features list sale con 0: ya no sirve para validar los valores de -c');
    return;
  }
  for (const [who, argv] of Object.entries(await argvsInUse())) {
    for (const override of configOverrides(argv)) {
      const result = spawnSync('codex', ['-c', override, 'features', 'list'], CODEX_OPTIONS);
      assert.equal(result.status, 0, `codex rechaza -c ${override} del ${who}: ${String(result.stderr).trim()}`);
    }
  }
});
