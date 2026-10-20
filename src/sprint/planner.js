import { validateBacklog } from '../backlog/validate.js';
import { routeTask } from '../routing/router.js';

/**
 * Select a deterministic ready-to-start frontier for a sprint, without changing
 * task statuses or invoking agents. Smaller tasks may fill capacity left by
 * higher-priority tasks that do not fit.
 *
 * Priority 1 is highest; omitted priority means 3 (backwards compatible).
 * Critical-risk tasks remain blocked until approval is represented explicitly
 * in a future contract; this MVP has no approval field to trust.
 */
export function planSprint(backlog, { capacity, models = {} } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) {
    throw new Error('capacity: se requiere un entero entre 1 y 1000 story points.');
  }
  const validation = validateBacklog(backlog);
  if (!validation.valid) throw new Error(`Backlog inválido:\n- ${validation.errors.join('\n- ')}`);

  const byId = new Map(backlog.tasks.map(task => [task.id, task]));
  const candidates = [], blocked = [], ignored = [], selected = [], deferred = [];
  let used = 0;

  for (const task of backlog.tasks) {
    if (['done', 'in_progress', 'in_review'].includes(task.status)) {
      ignored.push({ id: task.id, status: task.status, reason: 'Trabajo terminado o ya iniciado.' });
      continue;
    }
    const unmet = task.dependencies.filter(id => byId.get(id)?.status !== 'done');
    if (task.status !== 'ready') {
      blocked.push({ id: task.id, status: task.status, reason: unmet.length
        ? `Estado ${task.status}; dependencias pendientes: ${unmet.join(', ')}.`
        : `Estado ${task.status}; requiere Definition of Ready.` });
      continue;
    }
    if (unmet.length) {
      // Currently prevented by validateBacklog, retained for a safe future contract.
      blocked.push({ id: task.id, status: task.status, reason: `Dependencias pendientes: ${unmet.join(', ')}.` });
      continue;
    }
    if (task.risk === 'critical') {
      blocked.push({ id: task.id, status: task.status, reason: 'Riesgo crítico: requiere aprobación humana explícita.' });
      continue;
    }
    candidates.push(task);
  }

  candidates.sort((a,b) => (a.priority ?? 3) - (b.priority ?? 3) || a.id.localeCompare(b.id));
  for (const task of candidates) {
    const priority = task.priority ?? 3;
    if (used + task.story_points > capacity) {
      deferred.push({ id:task.id, priority, story_points:task.story_points,
        reason:`No cabe en la capacidad restante (${capacity - used} SP).` });
      continue;
    }
    const routing = routeTask(task, models);
    selected.push({ id:task.id, title:task.title, priority, story_points:task.story_points,
      dependencies:[...task.dependencies], routing });
    used += task.story_points;
  }
  return {
    execution:'dry-run', capacity, used_points:used, remaining_points:capacity-used,
    selected, deferred, blocked, ignored,
    totals:{ selected:selected.length, deferred:deferred.length, blocked:blocked.length, ignored:ignored.length },
  };
}
