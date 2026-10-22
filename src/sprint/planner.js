import { validateBacklog } from '../backlog/validate.js';
import { routeTask } from '../routing/router.js';
import { LIMITS, inRange } from '../limits.js';

/**
 * Selecciona de forma determinista las tareas listas para un sprint, sin cambiar
 * estados ni invocar agentes. Tareas menores pueden ocupar la capacidad que dejan
 * libre las de mayor prioridad que no caben.
 *
 * Orden: prioridad (1 es la máxima; si falta, 3 por compatibilidad) y, a igual
 * prioridad, orden natural del ID (TASK-9 antes que TASK-10).
 * Las tareas de riesgo crítico siguen bloqueadas hasta que un contrato futuro
 * represente la aprobación explícita; este MVP no tiene un campo fiable para ello.
 */
export function planSprint(backlog, { capacity, models = {} } = {}) {
  if (!inRange(capacity, LIMITS.capacity)) {
    const { min, max } = LIMITS.capacity;
    throw new Error(`capacity: se requiere un entero entre ${min} y ${max} story points.`);
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

  candidates.sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || compareIds(a.id, b.id));
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

// Orden natural determinista, sin ICU ni locale: compara trozos de dígitos y de
// no dígitos; los numéricos por valor, sin convertirlos a Number (sin pérdida de precisión).
function compareIds(a, b) {
  const left = a.match(/\d+|\D+/g) ?? [];
  const right = b.match(/\d+|\D+/g) ?? [];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const order = compareChunks(left[i], right[i]);
    if (order !== 0) return order;
  }
  // Prefijo común: primero el más corto; "TASK-007" y "TASK-7" se desempatan por texto.
  return left.length - right.length || compareCodeUnits(a, b);
}

function compareChunks(a, b) {
  if (!/^\d/.test(a) || !/^\d/.test(b)) return compareCodeUnits(a, b);
  const left = a.replace(/^0+/, '');
  const right = b.replace(/^0+/, '');
  // Sin ceros a la izquierda, más dígitos implica un número mayor.
  return left.length - right.length || compareCodeUnits(left, right);
}

function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
