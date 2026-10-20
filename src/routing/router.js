import { DIMENSIONS, RISKS } from '../backlog/validate.js';

const TIER_ORDER = ['luna', 'sol', 'astra'];
const BANDS = [
  { max: 2, level: 'XS', tier: 'luna', effort: 'low' },
  { max: 4, level: 'S', tier: 'luna', effort: 'medium' },
  { max: 6, level: 'M', tier: 'sol', effort: 'medium' },
  { max: 8, level: 'L', tier: 'sol', effort: 'high' },
  { max: 10, level: 'XL', tier: 'astra', effort: 'high' },
];

/** No asume nombres ni disponibilidad de modelos reales en Codex. */
export function loadModelProfiles(profiles) {
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error('models: se requiere un objeto con luna, sol y astra.');
  }
  const output = {};
  for (const tier of TIER_ORDER) {
    if (typeof profiles[tier] !== 'string' || !profiles[tier].trim()) {
      throw new Error(`models.${tier}: falta identificador de modelo local.`);
    }
    output[tier] = profiles[tier].trim();
  }
  for (const tier of Object.keys(profiles)) if (!TIER_ORDER.includes(tier)) {
    throw new Error(`models.${tier}: alias desconocido.`);
  }
  return output;
}

export function routeTask(task, models = {}) {
  if (!task || !task.complexity || !RISKS.includes(task.risk)) {
    throw new Error('Tarea sin complejidad o riesgo válido. Ejecute backlog validate.');
  }
  const scores = DIMENSIONS.map(key => task.complexity[key]);
  if (scores.some(v => !Number.isInteger(v) || v < 0 || v > 2)) {
    throw new Error('Las cinco dimensiones de complejidad deben estar en el rango 0..2.');
  }
  const score = scores.reduce((a, b) => a+b, 0);
  const band = BANDS.find(b => score <= b.max);
  const explanations = [`Puntuación ${score}/10 → ${band.level} (${band.tier}).`];
  let implementerTier = band.tier;
  let implementerEffort = band.effort;
  let reviewerTier = band.tier;
  let reviewerEffort = band.effort;
  const critical = task.risk === 'critical';
  if (task.risk === 'medium' && TIER_ORDER.indexOf(reviewerTier) < 1) {
    reviewerTier = 'sol'; reviewerEffort = 'medium';
    explanations.push('Riesgo medio: revisión con Sol.');
  }
  if (task.risk === 'high' || critical) {
    if (TIER_ORDER.indexOf(implementerTier) < 1) {
      implementerTier = 'sol'; implementerEffort = 'medium';
    }
    reviewerTier = 'astra'; reviewerEffort = 'high';
    explanations.push(critical
      ? 'Riesgo crítico: mínimo Sol en implementación, Astra en revisión y aprobación humana obligatoria.'
      : 'Riesgo alto: mínimo Sol en implementación y Astra en revisión.');
  }
  return {
    task_id: task.id,
    complexity: {score, level:band.level, dimensions: {...task.complexity}},
    risk: task.risk,
    implementer: {tier: implementerTier, model_id: models[implementerTier] ?? null, reasoning_effort: implementerEffort},
    reviewer: {tier: reviewerTier, model_id: models[reviewerTier] ?? null, reasoning_effort: reviewerEffort},
    requires_human_approval: critical,
    justification: explanations,
    execution: 'dry-run',
  };
}
