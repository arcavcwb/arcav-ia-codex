import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateBacklog } from '../backlog/validate.js';

const MAX_DIFF_BYTES = 8 * 1024 * 1024;
const MAX_TEST_OUTPUT = 2 * 1024 * 1024;
const ALLOWED_STATES = new Set(['ready', 'in_progress', 'in_review']);

function outputGit(root, args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: MAX_DIFF_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Verify the actual branch diff and, only with opt-in, execute its npm test suite.
 * No agent calls, commits, pushes, state mutation, or merge authorization.
 */
export function verifyTaskChanges(backlog, taskId, {
  repoRoot = process.cwd(), runTests = false, timeoutSeconds = 120,
  spawnTest = spawnSync,
} = {}) {
  const report = validateBacklog(backlog);
  if (!report.valid) throw new Error(`Backlog inválido:\n- ${report.errors.join('\n- ')}`);
  const task = backlog.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Tarea inexistente: ${taskId}.`);
  if (!ALLOWED_STATES.has(task.status)) {
    throw new Error(`${taskId}: estado ${task.status}; se requiere ready/in_progress/in_review.`);
  }
  if (task.risk === 'critical') throw new Error(`${taskId}: riesgo crítico sigue bloqueado.`);
  const byId = new Map(backlog.tasks.map(item => [item.id, item]));
  if (task.dependencies.some(id => byId.get(id)?.status !== 'done')) {
    throw new Error(`${taskId}: dependencias pendientes; no se puede validar el cambio.`);
  }
  if (typeof runTests !== 'boolean') throw new Error('runTests debe ser boolean.');
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 600) {
    throw new Error('timeoutSeconds debe ser un entero entre 10 y 600.');
  }

  const root = fs.realpathSync(repoRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('repoRoot debe ser un directorio.');
  const git = (...args) => outputGit(root, args).trim();
  const top = fs.realpathSync(git('rev-parse', '--show-toplevel'));
  if (top !== root) throw new Error('Utilice la raíz del repositorio Git.');
  const branch = git('branch', '--show-current');
  if (!branch || branch === 'main' || branch === 'master') {
    throw new Error('La verificación requiere una rama de feature, nunca main/master ni detached HEAD.');
  }
  const head = git('rev-parse', 'HEAD');
  const baseline = git('merge-base', 'HEAD', 'main');
  if (!/^[0-9a-f]{40}$/.test(baseline)) throw new Error('No se pudo determinar la base del diff.');

  // The local main common ancestor covers committed, staged and unstaged tracked changes.
  const changed = outputGit(root, ['diff', '--no-ext-diff', '--name-only', '-z', baseline, '--'])
    .split('\0').filter(Boolean);
  const untracked = outputGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean);
  const diff = outputGit(root, ['diff', '--no-ext-diff', '--binary', baseline, '--']);
  const whitespace = spawnSync('git', ['diff', '--no-ext-diff', '--check', baseline, '--'], {
    cwd: root, encoding: 'utf8', maxBuffer: MAX_TEST_OUTPUT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (whitespace.error) throw whitespace.error;
  if (whitespace.signal) throw new Error(`git diff --check terminó por señal ${whitespace.signal}.`);
  if (![0, 1, 2].includes(whitespace.status)) {
    throw new Error(`git diff --check falló con código ${whitespace.status}.`);
  }

  const tests = {
    executed: false, command: ['npm', 'test'], exit_code: null,
    timed_out: false, stdout_bytes: 0, stderr_bytes: 0,
  };
  if (runTests) {
    // Intentionally explicit: npm scripts can run arbitrary project code.
    const execution = spawnTest('npm', ['test'], {
      cwd: root, encoding: 'utf8', shell: false, timeout: timeoutSeconds * 1000,
      maxBuffer: MAX_TEST_OUTPUT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    tests.executed = true;
    tests.exit_code = Number.isInteger(execution.status) ? execution.status : null;
    tests.timed_out = execution.error?.code === 'ETIMEDOUT' || Boolean(execution.signal);
    tests.stdout_bytes = Buffer.byteLength(execution.stdout ?? '', 'utf8');
    tests.stderr_bytes = Buffer.byteLength(execution.stderr ?? '', 'utf8');
    if (execution.error) tests.error_code = execution.error.code ?? 'TEST_ERROR';
  }

  const checks = {
    diff_present: changed.length > 0,
    no_untracked_files: untracked.length === 0,
    whitespace_clean: whitespace.status === 0,
    tests_passed: tests.executed ? tests.exit_code === 0 && !tests.timed_out : null,
  };
  const readyForReview = Object.values(checks).every(v => v === true);
  return {
    schema_version: 1, task_id: taskId,
    branch, head_sha: head, base_sha: baseline,
    changed_files: changed, untracked_files: untracked,
    diff_sha256: createHash('sha256').update(diff, 'utf8').digest('hex'),
    checks, tests,
    ready_for_independent_review: readyForReview,
    tdd_red_proven: false,
    independent_review_completed: false,
    merge_approved: false,
    note: 'Test suite passing and a clean diff are QA evidence, not proof of RED-first TDD or independent code review.',
  };
}
