import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyTaskChanges } from './verify.js';
import { routeTask } from '../routing/router.js';

const MAX_DIFF_BYTES = 128 * 1024;

/**
 * Build a read-only, separately reviewable handoff from fresh local QA evidence.
 * This function never invokes Codex and never claims that a review has occurred.
 * npm test executes project scripts only when runTests is explicitly true.
 */
export function prepareIndependentReview(backlog, taskId, {
  repoRoot = process.cwd(), models = {}, runTests = false,
  timeoutSeconds = 120, includeDiff = false, maxReviewBytes = 65536,
} = {}) {
  if (typeof includeDiff !== 'boolean') throw new Error('includeDiff debe ser boolean.');
  if (!Number.isSafeInteger(maxReviewBytes) || maxReviewBytes < 4096 || maxReviewBytes > MAX_DIFF_BYTES) {
    throw new Error('maxReviewBytes debe estar entre 4096 y 131072 bytes.');
  }
  const qa = verifyTaskChanges(backlog, taskId, { repoRoot, runTests, timeoutSeconds });
  const task = backlog.tasks.find(item => item.id === taskId);
  const route = routeTask(task, models);
  const ready = qa.ready_for_independent_review === true;
  const handoff = {
    schema_version: 1,
    execution: 'review-handoff-only',
    task: {
      id: task.id, title: task.title, description: task.description,
      acceptance_criteria: [...task.acceptance_criteria], test_plan: [...task.test_plan],
      risk: task.risk,
    },
    reviewer: route.reviewer,
    qa: {
      branch: qa.branch, head_sha: qa.head_sha, base_sha: qa.base_sha,
      diff_sha256: qa.diff_sha256, changed_files: [...qa.changed_files],
      untracked_files: [...qa.untracked_files],
      checks: { ...qa.checks }, tests: { ...qa.tests },
    },
    status: ready ? 'ready_for_independent_review' : 'blocked_awaiting_qa',
    review_contract: {
      independent_from_implementer: true,
      implementer_conversation_included: false,
      required_evidence: [
        'Revisar cada criterio de aceptación contra el diff y las pruebas observadas.',
        'Identificar regresiones, errores de lógica y cambios fuera del alcance.',
        'Revisar exposición de secretos y efectos de seguridad en código cambiado.',
        'Registrar observaciones y solicitar correcciones antes de la aprobación humana.',
      ],
      tdd_red_proven: false,
      independent_review_completed: false,
      merge_approved: false,
    },
    diff: { sha256: qa.diff_sha256, included: false },
    warning: 'El código y los archivos pueden incluir secretos; inspeccionar antes de compartir con un tercero. QA no prueba TDD RED-first.',
  };
  if (ready && includeDiff) {
    const root = fs.realpathSync(repoRoot);
    const bytes = execFileSync('git', ['diff', '--no-ext-diff', '--binary', qa.base_sha, '--'], {
      cwd: root, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (bytes.length > maxReviewBytes) throw new Error('Diff excede maxReviewBytes; dividir la tarea antes del handoff.');
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== qa.diff_sha256) throw new Error('El diff cambió durante la preparación; repetir QA.');
    // Git emits a UTF-8 text diff for text files. Do not embed a binary patch.
    const diff = bytes.toString('utf8');
    if (diff.includes('GIT binary patch') || diff.includes('Binary files ')) {
      throw new Error('Diff binario: revisar manualmente sin incluirlo en el handoff.');
    }
    handoff.diff = { sha256: hash, included: true, bytes: bytes.length, content: diff };
  }
  return handoff;
}
