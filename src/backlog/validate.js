/** Backlog V1: contrato mínimo, determinista y sin dependencias. */
export const DIMENSIONS = Object.freeze(['scope', 'ambiguity', 'integration', 'impact', 'verification']);
export const STATUSES = Object.freeze(['draft', 'ready', 'in_progress', 'in_review', 'done', 'blocked']);
export const RISKS = Object.freeze(['low', 'medium', 'high', 'critical']);

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const filled = (value) => typeof value === 'string' && value.trim().length > 0;
const idOk = (value) => filled(value) && /^[A-Z][A-Z0-9-]*$/.test(value);

/** Devuelve todos los errores conocidos, sin modificar el documento original. */
export function validateBacklog(backlog) {
  const errors = [];
  if (!record(backlog)) return { valid: false, errors: ['El backlog debe ser un objeto JSON.'] };
  if (backlog.schema_version !== 1) errors.push('schema_version: se requiere el número 1.');

  for (const section of ['epics', 'stories', 'tasks']) {
    if (!Array.isArray(backlog[section])) errors.push(`${section}: debe ser un array.`);
  }
  const epics = Array.isArray(backlog.epics) ? backlog.epics : [];
  const stories = Array.isArray(backlog.stories) ? backlog.stories : [];
  const tasks = Array.isArray(backlog.tasks) ? backlog.tasks : [];
  const ids = new Set();

  function validateIdentity(item, label) {
    if (!record(item)) { errors.push(`${label}: debe ser un objeto.`); return false; }
    if (!idOk(item.id)) errors.push(`${label}.id: se requiere ID mayúsculo con letras, dígitos y guiones.`);
    if (filled(item.id)) {
      if (ids.has(item.id)) errors.push(`${label}.id: ID duplicado ${item.id}.`);
      ids.add(item.id);
    }
    if (!filled(item.title)) errors.push(`${label}.title: se requiere un título no vacío.`);
    return true;
  }
  function validateStrings(item, key, label, { min = 0 } = {}) {
    const values = item[key];
    if (!Array.isArray(values) || values.length < min || values.some(v => !filled(v))) {
      errors.push(`${label}.${key}: se requiere un array de textos no vacíos${min ? ` con al menos ${min} elemento(s)` : ''}.`);
      return false;
    }
    return true;
  }

  for (let i = 0; i < epics.length; i++) {
    validateIdentity(epics[i], `epics[${i}]`);
  }
  const epicIds = new Set(epics.filter(record).map(e => e.id));
  for (let i = 0; i < stories.length; i++) {
    const label = `stories[${i}]`, item = stories[i];
    if (!validateIdentity(item, label)) continue;
    if (!epicIds.has(item.epic_id)) errors.push(`${label}.epic_id: épica ${String(item.epic_id)} no existe.`);
    validateStrings(item, 'acceptance_criteria', label, { min: 1 });
  }
  const storyIds = new Set(stories.filter(record).map(s => s.id));
  const taskIds = new Set(tasks.filter(record).map(t => t.id));

  for (let i = 0; i < tasks.length; i++) {
    const label = `tasks[${i}]`, item = tasks[i];
    if (!validateIdentity(item, label)) continue;
    if (!storyIds.has(item.story_id)) errors.push(`${label}.story_id: historia ${String(item.story_id)} no existe.`);
    if (!filled(item.description)) errors.push(`${label}.description: se requiere un resultado acotado.`);
    if (!STATUSES.includes(item.status)) errors.push(`${label}.status: debe ser ${STATUSES.join('|')}.`);
    if (!RISKS.includes(item.risk)) errors.push(`${label}.risk: debe ser ${RISKS.join('|')}.`);
    if (!Number.isInteger(item.story_points) || item.story_points < 1 || item.story_points > 13) {
      errors.push(`${label}.story_points: se requiere un entero de 1 a 13.`);
    }
    validateStrings(item, 'acceptance_criteria', label, { min: 1 });
    validateStrings(item, 'test_plan', label, { min: 1 });
    if (!record(item.complexity)) {
      errors.push(`${label}.complexity: se requiere un objeto con cinco dimensiones.`);
    } else {
      for (const key of DIMENSIONS) {
        if (!Number.isInteger(item.complexity[key]) || item.complexity[key] < 0 || item.complexity[key] > 2) {
          errors.push(`${label}.complexity.${key}: se requiere entero 0, 1 o 2.`);
        }
      }
      for (const key of Object.keys(item.complexity)) {
        if (!DIMENSIONS.includes(key)) errors.push(`${label}.complexity.${key}: dimensión desconocida.`);
      }
    }
    if (!validateStrings(item, 'dependencies', label)) continue;
    for (const dependency of item.dependencies) {
      if (dependency === item.id) errors.push(`${label}.dependencies: una tarea no puede depender de sí misma.`);
      else if (!taskIds.has(dependency)) errors.push(`${label}.dependencies: tarea ${dependency} no existe.`);
    }
  }

  // Las tareas READY no pueden declararse ejecutables si una dependencia sigue pendiente.
  const byId = new Map(tasks.filter(record).filter(t => filled(t.id)).map(t => [t.id, t]));
  for (const item of tasks.filter(record)) {
    if (item.status !== 'ready' || !Array.isArray(item.dependencies)) continue;
    for (const dep of item.dependencies) {
      const state = byId.get(dep)?.status;
      if (state && state !== 'done') {
        errors.push(`TASK ${item.id} está ready pero depende de ${dep} (estado: ${state}).`);
      }
    }
  }
  // Ciclos: DFS tricolor sobre los identificadores existentes, incluso en borradores.
  const visited = new Set(), active = new Set();
  let cycleReported = false;
  function visit(id) {
    if (active.has(id)) {
      if (!cycleReported) errors.push(`dependencies: se detectó un ciclo que incluye ${id}.`);
      cycleReported = true;
      return;
    }
    if (visited.has(id)) return;
    visited.add(id); active.add(id);
    const item = byId.get(id);
    if (Array.isArray(item?.dependencies)) {
      for (const dep of item.dependencies) if (byId.has(dep)) visit(dep);
    }
    active.delete(id);
  }
  for (const id of byId.keys()) visit(id);
  return {valid: errors.length === 0, errors};
}
