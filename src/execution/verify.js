import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateBacklog } from '../backlog/validate.js';
import { DEFAULT_BASE_REF, assertBaseRef } from './base-ref.js';
import { LIMITS, inRange } from '../limits.js';

const MAX_DIFF_BYTES = 8 * 1024 * 1024;
const MAX_TEST_OUTPUT = 2 * 1024 * 1024;
const ALLOWED_STATES = new Set(['ready', 'in_progress', 'in_review']);

// Devuelve stdout de git; con encoding 'buffer' entrega los bytes crudos.
function outputGit(root, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: MAX_DIFF_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Ejecuta git sin lanzar por código de salida: el llamador interpreta status.
function probeGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return result;
}

// Estado del worktree frente a la base: archivos cambiados y sin registrar, hash del diff y whitespace.
function readWorktree(root, baseline) {
  // El ancestro común con la base cubre cambios confirmados, staged y unstaged de archivos rastreados.
  const changed = outputGit(root, ['diff', '--no-ext-diff', '--name-only', '-z', baseline, '--'])
    .split('\0').filter(Boolean);
  const untracked = outputGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean);
  // Bytes crudos: el hash debe coincidir con el de review.js y el revisor aunque el texto no sea UTF-8.
  const diff = outputGit(root, ['diff', '--no-ext-diff', '--binary', baseline, '--'], 'buffer');
  const whitespace = spawnSync('git', ['diff', '--no-ext-diff', '--check', baseline, '--'], {
    cwd: root, encoding: 'utf8', maxBuffer: MAX_TEST_OUTPUT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (whitespace.error) throw whitespace.error;
  if (whitespace.signal) throw new Error(`git diff --check terminó por señal ${whitespace.signal}.`);
  if (![0, 1, 2].includes(whitespace.status)) {
    throw new Error(`git diff --check falló con código ${whitespace.status}.`);
  }
  return {
    changed,
    untracked,
    diffSha256: createHash('sha256').update(diff).digest('hex'),
    whitespaceClean: whitespace.status === 0,
  };
}

// Lo que npm test cambió en el worktree; null si los archivos sin registrar y el diff siguen iguales.
function compareWorktrees(before, after) {
  const previous = new Set(before.untracked);
  const current = new Set(after.untracked);
  const created = after.untracked.filter(file => !previous.has(file));
  const removed = before.untracked.filter(file => !current.has(file));
  const diffChanged = after.diffSha256 !== before.diffSha256;
  if (created.length === 0 && removed.length === 0 && !diffChanged) return null;
  const changes = { new_untracked_files: created, diff_changed: diffChanged };
  // Solo aparece si los tests borraron archivos sin registrar que ya existían.
  if (removed.length > 0) changes.removed_untracked_files = removed;
  return changes;
}

/**
 * Verifica el diff real de la rama contra baseRef (por defecto main) y, solo con
 * opt-in, ejecuta su suite npm test.
 * Con npm test, archivos, diff y checks describen el worktree después de los tests.
 * Sin llamadas a agentes, commits, push, cambios de estado ni aprobación de merge.
 */
export function verifyTaskChanges(backlog, taskId, {
  repoRoot = process.cwd(), runTests = false, timeoutSeconds = LIMITS.testTimeoutSeconds.default,
  spawnTest = spawnSync, baseRef = DEFAULT_BASE_REF,
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
  if (!inRange(timeoutSeconds, LIMITS.testTimeoutSeconds)) {
    const { min, max } = LIMITS.testTimeoutSeconds;
    throw new Error(`timeoutSeconds debe ser un entero entre ${min} y ${max}.`);
  }
  assertBaseRef(baseRef);

  const root = fs.realpathSync(repoRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('repoRoot debe ser un directorio.');
  const git = (...args) => outputGit(root, args).trim();
  // Fuera de un repositorio rev-parse sale con error: se explica en vez de mostrar el error crudo de git.
  const toplevel = probeGit(root, ['rev-parse', '--show-toplevel']);
  if (toplevel.status !== 0) throw new Error(`No se encontró un repositorio Git en ${root}.`);
  const top = fs.realpathSync(toplevel.stdout.trim());
  if (top !== root) throw new Error('Utilice la raíz del repositorio Git.');
  const branch = git('branch', '--show-current');
  if (!branch || branch === 'main' || branch === 'master') {
    throw new Error('La verificación requiere una rama de feature, nunca main/master ni detached HEAD.');
  }
  if (branch === baseRef) {
    throw new Error(`La rama actual '${branch}' es la misma que la base del diff.`);
  }
  const head = git('rev-parse', 'HEAD');
  // Sin esta comprobación merge-base falla con un error crudo (p. ej. repos con rama master).
  const baseCommit = probeGit(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
  if (baseCommit.status !== 0) {
    throw new Error(`No existe la referencia base '${baseRef}'. Usa --base <rama> (por ejemplo master u origin/main).`);
  }
  // Historias sin ancestro común: merge-base sale con código 1 y sin salida.
  const mergeBase = probeGit(root, ['merge-base', 'HEAD', baseRef]);
  const baseline = mergeBase.stdout.trim();
  if (mergeBase.status !== 0 || !/^[0-9a-f]{40}$/.test(baseline)) {
    throw new Error(`No se pudo determinar la base del diff respecto a '${baseRef}'.`);
  }

  // Se lee antes de los tests para fallar pronto y para detectar lo que npm test cambie.
  const initial = readWorktree(root, baseline);
  let worktree = initial;

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
    // npm test puede crear o modificar archivos: el informe describe el estado posterior.
    worktree = readWorktree(root, baseline);
    const changes = compareWorktrees(initial, worktree);
    if (changes) tests.worktree_changes = changes;
  }

  const checks = {
    diff_present: worktree.changed.length > 0,
    no_untracked_files: worktree.untracked.length === 0,
    whitespace_clean: worktree.whitespaceClean,
    tests_passed: tests.executed ? tests.exit_code === 0 && !tests.timed_out : null,
    // Si los tests escriben en el repositorio, la evidencia no describe el worktree que se revisará.
    worktree_unchanged_by_tests: tests.executed ? tests.worktree_changes === undefined : null,
  };
  const readyForReview = Object.values(checks).every(v => v === true);
  return {
    schema_version: 1, task_id: taskId,
    branch, head_sha: head, base_ref: baseRef, base_sha: baseline,
    changed_files: worktree.changed, untracked_files: worktree.untracked,
    diff_sha256: worktree.diffSha256,
    checks, tests,
    ready_for_independent_review: readyForReview,
    tdd_red_proven: false,
    independent_review_completed: false,
    merge_approved: false,
    note: 'Test suite passing and a clean diff are QA evidence, not proof of RED-first TDD or independent code review.',
  };
}
