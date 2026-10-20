import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { verifyTaskChanges } from '../src/execution/verify.js';

const item = (changes = {}) => ({
  id: 'TASK-001', story_id: 'US-001', title: 'Ajustar suma',
  description: 'Corregir la función de suma', acceptance_criteria: ['La suma funciona'],
  test_plan: ['npm test'], dependencies: [], status: 'ready',
  risk: 'low', story_points: 1, complexity: {
    scope: 0, ambiguity: 0, integration: 0, impact: 0, verification: 1,
  }, ...changes,
});
const backlog = (task = item()) => ({
  schema_version: 1,
  epics: [{ id: 'EP-001', title: 'Calidad' }],
  stories: [{ id: 'US-001', epic_id: 'EP-001', title: 'Suma', acceptance_criteria: ['Suma correcta'] }],
  tasks: [task],
});
function inRepo(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcav-qa-'));
  function git(...args) {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  try {
    git('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'add.js'), 'export const add = (a, b) => a + b;\n');
    git('add', '.');
    git('-c', 'user.name=Arcav Test', '-c', 'user.email=arcav@example.test', 'commit', '-q', '-m', 'baseline');
    git('switch', '-q', '-c', 'feat/qa');
    return callback({ dir, git, source: path.join(dir, 'src', 'add.js') });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const pass = () => ({ status: 0, stdout: 'tests ok\n', stderr: '', signal: null });

test('inspecciona diff de la rama sin ejecutar npm por defecto', () => inRepo(({ dir, source }) => {
  fs.writeFileSync(source, 'export const add = (a, b) => a + b + 0;\n');
  let called = false;
  const result = verifyTaskChanges(backlog(), 'TASK-001', {
    repoRoot: dir, spawnTest: () => { called = true; throw new Error('no'); },
  });
  assert.equal(called, false);
  assert.equal(result.checks.diff_present, true);
  assert.equal(result.checks.tests_passed, null);
  assert.equal(result.ready_for_independent_review, false);
  assert.equal(result.merge_approved, false);
  assert.equal(result.tdd_red_proven, false);
  assert.deepEqual(result.changed_files, ['src/add.js']);
  assert.match(result.diff_sha256, /^[a-f\d]{64}$/);
}));

test('opt-in ejecuta npm test sin shell y permite solicitar review, no merge', () => inRepo(({ dir, source }) => {
  fs.writeFileSync(source, 'export const add = (a, b) => a + b + 0;\n');
  let command;
  const result = verifyTaskChanges(backlog(), 'TASK-001', {
    repoRoot: dir, runTests: true, spawnTest: (name, args, opts) => { command = {name, args, opts}; return pass(); },
  });
  assert.equal(command.name, 'npm');
  assert.deepEqual(command.args, ['test']);
  assert.equal(command.opts.shell, false);
  assert.equal(command.opts.timeout, 120000);
  assert.equal(result.checks.tests_passed, true);
  assert.equal(result.ready_for_independent_review, true);
  assert.equal(result.merge_approved, false);
  assert.equal(result.independent_review_completed, false);
}));

test('rechaza verificar en main y ante diff vacío', () => inRepo(({ dir, git }) => {
  const noChanges = verifyTaskChanges(backlog(), 'TASK-001', { repoRoot: dir });
  assert.equal(noChanges.checks.diff_present, false);
  assert.equal(noChanges.ready_for_independent_review, false);
  git('switch', '-q', 'main');
  assert.throws(() => verifyTaskChanges(backlog(), 'TASK-001', { repoRoot: dir }), /rama de feature/i);
}));

test('archivos untracked bloquean aunque los tests pasen', () => inRepo(({ dir, source }) => {
  fs.writeFileSync(source, 'export const add=(a,b)=>a+b;\n');
  fs.writeFileSync(path.join(dir, 'src', 'new.js'), 'export const test = true;\n');
  const result = verifyTaskChanges(backlog(), 'TASK-001', { repoRoot: dir, runTests: true, spawnTest: pass });
  assert.equal(result.checks.no_untracked_files, false);
  assert.deepEqual(result.untracked_files, ['src/new.js']);
  assert.equal(result.ready_for_independent_review, false);
}));

test('trailing whitespace bloquea aunque suite pase', () => inRepo(({ dir, source }) => {
  fs.writeFileSync(source, 'export const add = (a, b) => a + b;   \n');
  const result = verifyTaskChanges(backlog(), 'TASK-001', { repoRoot: dir, runTests: true, spawnTest: pass });
  assert.equal(result.checks.whitespace_clean, false);
  assert.equal(result.ready_for_independent_review, false);
}));

test('fallo o timeout de tests bloquea la revisión', () => inRepo(({ dir, source }) => {
  fs.writeFileSync(source, 'export const add = (a, b) => a + b + 1;\n');
  const failed = verifyTaskChanges(backlog(), 'TASK-001', {
    repoRoot: dir, runTests: true,
    spawnTest: () => ({ status: 1, stdout: 'fail', stderr: '', signal: null }),
  });
  assert.equal(failed.checks.tests_passed, false);
  const timeout = verifyTaskChanges(backlog(), 'TASK-001', {
    repoRoot: dir, runTests: true,
    spawnTest: () => ({ status: null, stdout: '', stderr: '', signal: 'SIGTERM', error: {code:'ETIMEDOUT'} }),
  });
  assert.equal(timeout.tests.timed_out, true);
  assert.equal(timeout.ready_for_independent_review, false);
}));

test('rechaza estado no apto, riesgo crítico y parámetros inválidos', () => inRepo(({ dir }) => {
  assert.throws(() => verifyTaskChanges(backlog(item({status:'draft'})), 'TASK-001', { repoRoot: dir }), /estado draft/i);
  assert.throws(() => verifyTaskChanges(backlog(item({risk:'critical'})), 'TASK-001', { repoRoot: dir }), /crítico/i);
  const dependency = item({id:'TASK-000',status:'draft'});
  const blocked = backlog(item({status:'in_review',dependencies:['TASK-000']}));
  blocked.tasks.unshift(dependency);
  assert.throws(() => verifyTaskChanges(blocked, 'TASK-001', {repoRoot:dir}), /dependencias pendientes/i);
  assert.throws(() => verifyTaskChanges(backlog(), 'TASK-X', { repoRoot: dir }), /inexistente/i);
  assert.throws(() => verifyTaskChanges(backlog(), 'TASK-001', { repoRoot: dir, timeoutSeconds: 1 }), /timeoutSeconds/);
  assert.throws(() => verifyTaskChanges(backlog(), 'TASK-001', { repoRoot: dir, runTests: 'true' }), /runTests/);
  assert.throws(() => verifyTaskChanges(backlog(), 'TASK-001', { repoRoot: path.join(dir, 'src') }), /raíz del repositorio/i);
}));

test('CLI task verify inspecciona en dry-run y prueba npm solo con --run-tests', () => inRepo(({ dir, source }) => {
  fs.writeFileSync(source, 'export const add = (a, b) => a + b + 1;\n');
  const backlogFile = path.join(dir, 'tasks.json');
  fs.writeFileSync(backlogFile, JSON.stringify(backlog()));
  const cmd = `import {runPlanningCommand} from ${JSON.stringify(new URL('../src/backlog/command.js', import.meta.url).href)}; process.exit(await runPlanningCommand(process.argv.slice(1)))`;
  const run = (...args) => spawnSync(process.execPath, ['--input-type=module','-e',cmd,...args], {
    cwd: dir, encoding: 'utf8', shell: false,
  });
  const preflight = run('task', 'verify', 'TASK-001', '--file', backlogFile, '--repo', dir, '--json');
  assert.equal(preflight.status, 0, preflight.stderr);
  const data = JSON.parse(preflight.stdout);
  assert.equal(data.tests.executed, false);
  assert.equal(data.ready_for_independent_review, false);
  assert.equal(run('task', 'verify', 'TASK-001', '--file', backlogFile, '--repo', dir, '--test-timeout-seconds', '30').status, 1);
  assert.equal(run('task', 'verify', 'TASK-001', '--file', backlogFile, '--repo', dir, '--models', 'x').status, 1);
  assert.equal(run('route', 'TASK-001', '--file', backlogFile, '--run-tests').status, 1);
}));


test('CLI con --run-tests ejecuta npm test realmente en repositorio temporal', () => inRepo(({ dir, git, source }) => {
  fs.writeFileSync(source, 'export const add = (a, b) => a + b + 1;\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts:{test:'node -e "process.exit(0)"'}}));
  const file=path.join(dir,'tasks.json');fs.writeFileSync(file,JSON.stringify(backlog()));
  git('add', 'package.json', 'tasks.json');
  const script = `import {runPlanningCommand} from ${JSON.stringify(new URL('../src/backlog/command.js', import.meta.url).href)}; process.exit(await runPlanningCommand(process.argv.slice(1)))`;
  const cli=spawnSync(process.execPath,['--input-type=module','-e',script,'task','verify','TASK-001','--repo',dir,'--file',file,'--run-tests','--json'],{cwd:dir,encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
  const report=JSON.parse(cli.stdout);
  assert.equal(report.tests.executed,true);
  assert.equal(report.checks.tests_passed,true);
  assert.equal(report.ready_for_independent_review,true);
  assert.equal(report.merge_approved,false);
}));
