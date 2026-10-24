import { planBacklogFromPRD } from './prd.js';
import { validateBacklog } from './validate.js';

const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ref = (storyId, index) => `${storyId}:AC-${String(index).padStart(3,'0')}`;

/** Deterministic, opt-in decomposition; never infers business dependencies or READY. */
export function planBacklogFromPRDV2(markdown, {units = null} = {}) {
  const parsed = planBacklogFromPRD(markdown);
  const stories = parsed.backlog.stories;
  const warnings = [...parsed.warnings];
  const byStory = new Map(stories.map(s => [s.id, s]));
  let specs;
  if (units === null) {
    specs = stories.map(s => ({
      key:s.id, story_id:s.id, title:s.title,
      criteria:s.acceptance_criteria.map((_,i) => i+1), depends_on:[],
    }));
    for (const s of stories) {
      if (s.acceptance_criteria.length > 3) {
        warnings.push(`${s.id}: ${s.acceptance_criteria.length} criterios en una unidad; revisar tamaño y dividir con --units.`);
      }
    }
  } else {
    if (!isRecord(units) || units.schema_version !== 1 || !Array.isArray(units.units) || !units.units.length) {
      throw new Error('V2 --units: se requiere {"schema_version":1,"units":[...]} no vacío.');
    }
    specs = units.units;
  }
  const keys = new Set(), seen = new Set();
  for (const [i, u] of specs.entries()) {
    const label = `V2 units[${i}]`;
    if (!isRecord(u) || typeof u.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(u.key)) {
      throw new Error(`${label}.key: identificador único (letras, dígitos, guión y guión bajo).`);
    }
    if (keys.has(u.key)) throw new Error(`${label}.key: duplicado ${u.key}.`);
    keys.add(u.key);
    if (!byStory.has(u.story_id)) throw new Error(`${label}.story_id: historia inexistente ${String(u.story_id)}.`);
    if (typeof u.title !== 'string' || !u.title.trim()) throw new Error(`${label}.title: se requiere título.`);
    if (!Array.isArray(u.criteria) || !u.criteria.length) throw new Error(`${label}.criteria: índices de criterios obligatorios.`);
    const count = byStory.get(u.story_id).acceptance_criteria.length;
    for (const n of u.criteria) {
      if (!Number.isSafeInteger(n) || n < 1 || n > count) {
        throw new Error(`${label}.criteria: índice ${String(n)} fuera de rango para ${u.story_id} (1..${count}).`);
      }
      const id = ref(u.story_id, n);
      if (seen.has(id)) throw new Error(`${label}.criteria: cobertura duplicada de ${id}.`);
      seen.add(id);
    }
    if (!Array.isArray(u.depends_on) || u.depends_on.some(d=>typeof d !== 'string' || !d)) {
      throw new Error(`${label}.depends_on: array obligatorio de claves.`);
    }
    if (new Set(u.depends_on).size !== u.depends_on.length) throw new Error(`${label}.depends_on: dependencias duplicadas.`);
  }
  for (const s of stories) for (let i=1; i<=s.acceptance_criteria.length; i++) {
    if (!seen.has(ref(s.id,i))) throw new Error(`V2 cobertura incompleta: falta ${ref(s.id,i)}.`);
  }
  const ids = new Map(specs.map((u,i)=>[u.key,`TASK-${String(i+1).padStart(3,'0')}`]));
  const tasks = specs.map(u => {
    const story = byStory.get(u.story_id);
    const criteria = u.criteria.map(n=>story.acceptance_criteria[n-1]);
    const dependencies = u.depends_on.map(d=>{
      if (!ids.has(d)) throw new Error(`V2 dependencia inexistente: ${u.key} depende de ${d}.`);
      if (d === u.key) throw new Error(`V2 dependencia circular: ${u.key} depende de sí misma.`);
      return ids.get(d);
    });
    return {
      id:ids.get(u.key),story_id:u.story_id,title:u.title.trim(),
      description:`Implementar la unidad ${u.title.trim()} y demostrar sus ${criteria.length} criterio(s) de aceptación.`,
      requirement_refs:u.criteria.map(n=>ref(u.story_id,n)),
      acceptance_criteria:criteria,dependencies,
      status:'draft',story_points:Math.min(13,Math.max(1,criteria.length*2)),risk:'medium',priority:3,
      complexity:{scope:1,ambiguity:2,integration:1,impact:1,verification:1},
      test_plan:[
        `RED: definir y ejecutar pruebas reproducibles para: ${criteria.join(' | ')}`,
        'GREEN: implementar lo mínimo para pasar las pruebas; ejecutar regresiones.',
        'REFACTOR: simplificar y repetir las pruebas; registrar evidencia de los resultados.',
      ],
    };
  });
  const backlog = {
    schema_version:1,planning:{strategy:'coherent_v2',review_required:true},
    epics:parsed.backlog.epics,stories,tasks,
  };
  const validation = validateBacklog(backlog);
  if (!validation.valid) throw new Error(`V2 backlog inválido:\n- ${validation.errors.join('\n- ')}`);
  const coveredBy = new Map(tasks.flatMap(t=>t.requirement_refs.map(r=>[r,t.id])));
  const coverage = stories.flatMap(s=>s.acceptance_criteria.map((criterion,i)=>({
    requirement_ref:ref(s.id,i+1),criterion,task_id:coveredBy.get(ref(s.id,i+1)) ?? null,
  })));
  return {backlog,warnings,coverage,stats:{
    epics:backlog.epics.length,stories:stories.length,criteria:coverage.length,tasks:tasks.length,
  }};
}
