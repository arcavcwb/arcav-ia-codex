import { validateBacklog } from './validate.js';

/**
 * Convert a deliberately constrained PRD Markdown dialect into reviewable tasks.
 * No model calls, invented domain requirements, or execution-ready status.
 */
export function planBacklogFromPRD(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('PRD: se requiere texto Markdown no vacío.');
  if (markdown.length > 1_000_000) throw new Error('PRD: tamaño máximo 1 MB.');

  const backlog = { schema_version: 1, epics: [], stories: [], tasks: [] };
  const warnings = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let epic = null;
  let story = null;
  let inCriteria = false;
  let inCodeBlock = false;
  const contexts = new Map();

  function issue(line, message) { throw new Error(`PRD línea ${line}: ${message}`); }
  function titleId(prefix, n) { return `${prefix}-${String(n).padStart(3, '0')}`; }
  function finishStory(line) {
    if (story && !story.acceptance_criteria.length) {
      issue(line, `historia "${story.title}" sin criterios de aceptación verificables.`);
    }
  }
  function addCriterion(value, line) {
    const criterion = value.replace(/\s+/g, ' ').trim();
    if (!criterion || /^(?:TODO|TBD|PENDIENTE|POR DEFINIR|\?+)\.?$/i.test(criterion)) {
      warnings.push(`Línea ${line}: criterio vacío o marcador pendiente ignorado.`);
      return;
    }
    const normalized = criterion.toLocaleLowerCase('es');
    if (story.acceptance_criteria.some(v => v.toLocaleLowerCase('es') === normalized)) {
      warnings.push(`Línea ${line}: criterio duplicado ignorado en ${story.id}.`);
      return;
    }
    story.acceptance_criteria.push(criterion);
  }

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;
    if (/^```|^~~~/.test(line)) {
      inCodeBlock = !inCodeBlock;
      warnings.push(`Línea ${lineNumber}: bloque de código excluido del análisis.`);
      continue;
    }
    if (inCodeBlock) continue;
    const epicHeader = line.match(/^##\s+(?:Épica|Epica|Epic)\s*:\s*(.*)$/i);
    if (epicHeader) {
      finishStory(lineNumber);
      if (!epicHeader[1].trim()) issue(lineNumber, 'épica sin título.');
      epic = {id:titleId('EP',backlog.epics.length + 1),title:epicHeader[1].trim()};
      backlog.epics.push(epic);
      story = null;
      inCriteria = false;
      continue;
    }
    const storyHeader = line.match(/^###\s+(?:Historia|História|Story)\s*:\s*(.*)$/i);
    if (storyHeader) {
      if (!epic) issue(lineNumber,'historia sin épica.');
      finishStory(lineNumber);
      if (!storyHeader[1].trim()) issue(lineNumber, 'historia sin título.');
      story={id:titleId('US',backlog.stories.length + 1),epic_id:epic.id,title:storyHeader[1].trim(),acceptance_criteria:[]};
      backlog.stories.push(story);
      contexts.set(story.id,[]);
      inCriteria = false;
      continue;
    }
    if (/^####\s+(?:Criterios\s+de\s+aceptaci[oó]n|Critérios\s+de\s+aceita[cç][aã]o)\s*$/i.test(line)) {
      if (!story) issue(lineNumber, 'criterios de aceptación fuera de una historia.');
      inCriteria=true;
      continue;
    }
    if (/^#{2,}/.test(line)) {
      if (/^#{5,}\s/.test(line)) issue(lineNumber,'encabezado no soportado: usa épicas, historias y criterios.');
      if (story && /^####\s/.test(line)) issue(lineNumber,'encabezado no soportado dentro de historia.');
      if (story && /^###\s/.test(line)) issue(lineNumber,'encabezado no soportado: usa "### Historia: ...".');
      if (/^##\s/.test(line)) { // global section: must be made explicit later
        finishStory(lineNumber);
        story=null;epic=null;inCriteria=false;
        warnings.push(`Línea ${lineNumber}: sección sin mapear: ${line.replace(/^##\s+/,'')}.`);
        continue;
      }
      warnings.push(`Línea ${lineNumber}: encabezado no asignado: ${line}.`);
      continue;
    }
    if (/^#\s/.test(line)) continue;

    const criterion = line.match(/^(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)(.*)$/);
    if (criterion) {
      if (story) addCriterion(criterion[1],lineNumber);
      else if (epic) issue(lineNumber,'criterio fuera de una historia.');
      else warnings.push(`Línea ${lineNumber}: elemento sin mapear fuera de las historias: ${line}.`);
      continue;
    }
    if (story) {
      if (inCriteria) warnings.push(`Línea ${lineNumber}: texto fuera de lista de criterios; revisar: ${line}.`);
      else contexts.get(story.id).push(line);
    } else if (epic) {
      warnings.push(`Línea ${lineNumber}: texto de épica no convertido: ${line}.`);
    } else {
      warnings.push(`Línea ${lineNumber}: contenido global no convertido: ${line}.`);
    }
  }
  finishStory(lines.length);
  if (!backlog.epics.length) throw new Error('PRD: No se encontraron épicas. Usa "## Épica: Título".');
  if (!backlog.stories.length) throw new Error('PRD: no se encontraron historias. Usa "### Historia: Título".');
  for (const epicItem of backlog.epics) {
    if (!backlog.stories.some(s=>s.epic_id===epicItem.id)) {
      throw new Error(`PRD: épica "${epicItem.title}" sin historias.`);
    }
  }

  for (const storyItem of backlog.stories) {
    const context=contexts.get(storyItem.id).join(' ');
    for (const criterion of storyItem.acceptance_criteria) {
      const testId=titleId('TASK',backlog.tasks.length+1);
      const testTask={
        id:testId,story_id:storyItem.id,title:`Prueba: ${criterion}`,
        description:`Diseñar una prueba de aceptación reproducible para: ${criterion}.${context ? ` Contexto: ${context}` : ''}`,
        acceptance_criteria:[`Existe evidencia de prueba para: ${criterion}`],
        dependencies:[],status:'draft',story_points:1,risk:'medium',
        complexity:{scope:1,ambiguity:2,integration:0,impact:1,verification:1},
        test_plan:[`Definir pasos y resultado esperado del criterio: ${criterion}`],
      };
      backlog.tasks.push(testTask);
      backlog.tasks.push({
        id:titleId('TASK',backlog.tasks.length+1),story_id:storyItem.id,
        title:`Implementar: ${criterion}`,
        description:`Implementar el comportamiento mínimo que satisface: ${criterion}.${context ? ` Contexto: ${context}` : ''}`,
        acceptance_criteria:[criterion],
        dependencies:[testId],status:'draft',story_points:2,risk:'medium',
        complexity:{scope:1,ambiguity:2,integration:0,impact:1,verification:1},
        test_plan:[`Ejecutar la prueba de aceptación definida en ${testId}; verificar GREEN y regresiones.`],
      });
    }
  }
  const report=validateBacklog(backlog);
  if (!report.valid) throw new Error(`Error interno: backlog generado inválido:\n- ${report.errors.join('\n- ')}`);
  return {
    backlog,warnings,
    stats:{epics:backlog.epics.length,stories:backlog.stories.length,
      criteria:backlog.stories.reduce((n,s)=>n+s.acceptance_criteria.length,0),tasks:backlog.tasks.length},
  };
}
