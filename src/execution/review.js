import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyTaskChanges } from './verify.js';
import { DEFAULT_BASE_REF } from './base-ref.js';
import { routeTask } from '../routing/router.js';
import { LIMITS, inRange } from '../limits.js';

// Cabeceras que git escribe para archivos binarios. Las líneas de contenido de un diff
// empiezan siempre por ' ', '+' o '-', así que el ancla ^ no confunde texto con binario.
const BINARY_DIFF_HEADERS = [/^GIT binary patch$/m, /^Binary files .* differ$/m];

// UTF-8 estricto: un byte inválido lanza en vez de convertirse en U+FFFD,
// así el texto incluido vuelve a codificarse en los mismos bytes del hash.
function decodeStrictUtf8(bytes) {
  // Se crea fuera del try para no confundir un fallo del entorno con texto inválido.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error('Diff con texto no UTF-8: revisar manualmente sin incluirlo en el handoff.');
  }
}

// Repetir QA no arregla un npm test que escribe en el repositorio: se dice qué cambió y qué hacer.
// Nombra hasta 5 rutas; el resto solo se cuenta.
function fileList(files) {
  const shown = files.slice(0, 5).join(', ');
  return files.length > 5 ? `${shown} y ${files.length - 5} más` : shown;
}

/**
 * Explica qué cambió npm test en el worktree, con los archivos afectados en el propio
 * texto: repetir el comando no lo reproduce, porque el artefacto ya existe.
 */
export function worktreeNote(changes) {
  const effects = [];
  if (changes.new_untracked_files.length > 0) {
    effects.push(`creó archivos sin registrar (${fileList(changes.new_untracked_files)})`);
  }
  if (changes.removed_untracked_files?.length > 0) {
    effects.push(`borró archivos sin registrar (${fileList(changes.removed_untracked_files)})`);
  }
  if (changes.diff_changed) effects.push('cambió archivos rastreados');
  return `npm test modificó el worktree: ${effects.join('; ')}. ` +
    'Los tests no deben escribir en el repositorio; si generan artefactos, añádelos a .gitignore.';
}

/**
 * Build a read-only, separately reviewable handoff from fresh local QA evidence.
 * This function never invokes Codex and never claims that a review has occurred.
 * npm test executes project scripts only when runTests is explicitly true.
 */
export function prepareIndependentReview(backlog, taskId, {
  repoRoot = process.cwd(), models = {}, runTests = false,
  timeoutSeconds = LIMITS.testTimeoutSeconds.default, includeDiff = false,
  maxReviewBytes = LIMITS.maxReviewBytes.default,
  baseRef = DEFAULT_BASE_REF,
} = {}) {
  if (typeof includeDiff !== 'boolean') throw new Error('includeDiff debe ser boolean.');
  if (!inRange(maxReviewBytes, LIMITS.maxReviewBytes)) {
    const { min, max } = LIMITS.maxReviewBytes;
    throw new Error(`maxReviewBytes debe estar entre ${min} y ${max} bytes.`);
  }
  const qa = verifyTaskChanges(backlog, taskId, { repoRoot, runTests, timeoutSeconds, baseRef });
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
      branch: qa.branch, head_sha: qa.head_sha, base_ref: qa.base_ref, base_sha: qa.base_sha,
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
  if (qa.checks.worktree_unchanged_by_tests === false) {
    handoff.note = worktreeNote(qa.tests.worktree_changes);
  }
  if (ready && includeDiff) {
    const root = fs.realpathSync(repoRoot);
    const bytes = execFileSync('git', ['diff', '--no-ext-diff', '--binary', qa.base_sha, '--'], {
      cwd: root, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (bytes.length > maxReviewBytes) throw new Error('Diff excede maxReviewBytes; dividir la tarea antes del handoff.');
    // QA y este diff se hashean sobre los mismos bytes crudos.
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== qa.diff_sha256) throw new Error('El diff cambió durante la preparación; repetir QA.');
    const diff = decodeStrictUtf8(bytes);
    // No se incrusta un parche binario en el handoff.
    if (BINARY_DIFF_HEADERS.some(header => header.test(diff))) {
      throw new Error('Diff binario: revisar manualmente sin incluirlo en el handoff.');
    }
    handoff.diff = { sha256: hash, included: true, bytes: bytes.length, content: diff };
  }
  return handoff;
}
