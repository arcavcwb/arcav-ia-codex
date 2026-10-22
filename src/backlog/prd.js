import { validateBacklog } from './validate.js';

const EPIC_HEADER = /^##\s+(?:Épica|Epica|Epic)\s*:\s*(.*)$/i;
const STORY_HEADER = /^###\s+(?:Historia|História|Story)\s*:\s*(.*)$/i;
const CRITERIA_HEADER = /^####\s+(?:Criterios\s+de\s+aceptaci[oó]n|Critérios\s+de\s+aceita[cç][aã]o|Acceptance\s+criteria)\s*$/i;
// Viñeta (-, *, +) con casilla opcional ([ ] / [x]) o elemento numerado (1. / 1)).
// Un marcador sin contenido ("-", "1.") es un elemento vacío, no texto.
const LIST_ITEM = /^(?:[-*+](?:\s+(?:\[[ xX]\]\s*)?|$)|\d+[.)](?:\s+|$))(.*)$/;
// Separador temático (CommonMark): 3 o más '-', '*' o '_' iguales, con espacios opcionales.
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}$/;
// Cerca de apertura (CommonMark): 3 o más comillas invertidas, sin otra comilla
// invertida en el resto de la línea, o 3 o más virgulillas.
const FENCE_OPEN = /^(?:(`{3,})[^`]*|(~{3,}).*)$/;
// Marcadores que no constituyen un criterio verificable (español, inglés y PT-BR).
const PLACEHOLDER = /^(?:TODO|TBD|PENDIENTE|PENDENTE|POR DEFINIR|A DEFINIR|\?+)\.?$/i;

/**
 * Convierte un dialecto Markdown acotado de PRD en un backlog borrador revisable:
 * una tarea TDD (RED → GREEN → REFACTOR) por criterio de aceptación, sin
 * dependencias y en estado draft. No llama a modelos ni inventa requisitos.
 *
 * - Si la historia tiene "#### Criterios de aceptación" (o "Critérios de
 *   aceitação" / "Acceptance criteria"), las viñetas anteriores son contexto.
 *   Sin ese encabezado, todas sus viñetas son criterios, y el texto que sigue
 *   a una viñeta pasa al contexto con aviso.
 * - Una sub-viñeta (indentada con 2+ espacios o tabulador) se fusiona con la
 *   viñeta anterior: "Padre: sub1; sub2". Las vacías o pendientes se avisan.
 * - Un "# …" posterior a la primera épica es una sección sin mapear, como "## …".
 * - Bloques de código y comentarios HTML se excluyen con aviso; uno sin cerrar
 *   es un error. Los separadores temáticos ("---", "* * *") se ignoran.
 * - Los IDs dependen de la posición: regenerar tras editar el PRD renumera.
 */
export function planBacklogFromPRD(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('PRD: se requiere texto Markdown no vacío.');
  if (markdown.length > 1_000_000) throw new Error('PRD: tamaño máximo 1 MB.');

  const backlog = { schema_version: 1, epics: [], stories: [], tasks: [] };
  const notes = [];
  const contexts = new Map();
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let epic = null;
  let story = null;
  let inCriteria = false;
  // Bloque de código abierto ({ marker, line }: cerca de apertura y su línea).
  let fence = null;
  // Comentario HTML abierto ({ line }: línea de apertura).
  let comment = null;
  // Contenido de la historia abierta aún sin clasificar, en orden del documento:
  // { kind: 'text', line, text } o { kind: 'item', line, text, children }.
  let entries = [];
  // Viñeta de primer nivel que puede recibir sub-viñetas.
  let parent = null;

  function warn(line, message) {
    notes.push({ line, message });
  }

  function issue(line, message) {
    throw new Error(`PRD línea ${line}: ${message}`);
  }

  function addListItem(value, line, raw) {
    const text = normalize(value);
    const indent = raw.match(/^[ \t]*/)[0];
    const indented = indent.includes('\t') || indent.length >= 2;
    if (indented && parent) {
      // Una sub-viñeta vacía o pendiente no completa a su padre: se descarta con aviso.
      if (isCriterionText(text)) parent.children.push(text);
      else warn(line, 'criterio vacío o marcador pendiente ignorado.');
      return;
    }
    if (indented) warn(line, 'sub-viñeta sin viñeta padre tratada como de primer nivel.');
    const item = { kind: 'item', line, text, children: [] };
    entries.push(item);
    // Una huérfana no adopta a las siguientes: en una lista indentada son hermanas.
    parent = !indented && isCriterionText(text) ? item : null;
  }

  // El texto siempre es contexto; las viñetas son criterios, salvo las previas
  // al encabezado de criterios, que pasan al contexto con advertencia.
  function flushEntries(itemsAreCriteria) {
    const context = contexts.get(story.id);
    let afterItem = false;
    for (const entry of entries) {
      if (entry.kind === 'text') {
        // Si las viñetas son criterios, el texto que las sigue sale de entre ellos
        // (puede ser la continuación de un criterio): nunca en silencio.
        if (itemsAreCriteria && afterItem) {
          warn(entry.line, 'texto tras una viñeta tratado como contexto; si continúa el criterio, únelo en la misma línea.');
        }
        context.push(entry.text);
        continue;
      }
      afterItem = true;
      const text = mergeItem(entry);
      if (itemsAreCriteria) {
        addCriterion(text, entry.line);
        continue;
      }
      warn(entry.line, 'viñeta antes de los criterios de aceptación tratada como contexto.');
      if (text) context.push(text);
    }
    entries = [];
  }

  function finishStory(line) {
    if (!story) return;
    flushEntries(true);
    if (!story.acceptance_criteria.length) {
      issue(line, `historia "${story.title}" sin criterios de aceptación verificables.`);
    }
  }

  // Sección global: no se convierte; cierra la historia y la épica abiertas y
  // queda como advertencia para revisión manual.
  function closeSection(line, title) {
    finishStory(line);
    story = null;
    epic = null;
    inCriteria = false;
    warn(line, `sección sin mapear: ${title}.`);
  }

  // Los duplicados se comparan sobre el texto final (con sus sub-viñetas ya fusionadas).
  function addCriterion(value, line) {
    const criterion = normalize(value);
    if (!isCriterionText(criterion)) {
      warn(line, 'criterio vacío o marcador pendiente ignorado.');
      return;
    }
    const key = criterion.toLocaleLowerCase('es');
    if (story.acceptance_criteria.some(existing => existing.toLocaleLowerCase('es') === key)) {
      warn(line, `criterio duplicado ignorado en ${story.id}.`);
      return;
    }
    story.acceptance_criteria.push(criterion);
  }

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const line = raw.trim();
    if (!line) continue;
    // Dentro de un bloque de código solo cuenta su cerca de cierre.
    if (fence) {
      if (closesFence(line, fence.marker)) {
        fence = null;
        warn(lineNumber, 'bloque de código excluido del análisis.');
      }
      continue;
    }
    // Dentro de un comentario HTML solo cuenta su cierre.
    if (comment) {
      if (line.includes('-->')) {
        comment = null;
        warn(lineNumber, 'comentario HTML excluido del análisis.');
      }
      continue;
    }
    // Un separador temático ("* * *" parece una viñeta) no es contenido, pero
    // corta la relación con la viñeta padre.
    if (THEMATIC_BREAK.test(line)) {
      parent = null;
      continue;
    }
    const listItem = line.match(LIST_ITEM);
    // Cualquier línea no vacía que no sea de lista corta la relación con la viñeta padre.
    if (!listItem) parent = null;
    const fenceOpen = line.match(FENCE_OPEN);
    if (fenceOpen) {
      fence = { marker: fenceOpen[1] ?? fenceOpen[2], line: lineNumber };
      warn(lineNumber, 'bloque de código excluido del análisis.');
      continue;
    }
    if (line.startsWith('<!--')) {
      // Como en CommonMark, el comentario acaba en la primera línea con "-->",
      // que puede ser la misma de apertura.
      if (!line.includes('-->')) comment = { line: lineNumber };
      warn(lineNumber, 'comentario HTML excluido del análisis.');
      continue;
    }

    const epicHeader = line.match(EPIC_HEADER);
    if (epicHeader) {
      finishStory(lineNumber);
      const title = epicHeader[1].trim();
      if (!title) issue(lineNumber, 'épica sin título.');
      epic = { id: titleId('EP', backlog.epics.length + 1), title };
      backlog.epics.push(epic);
      story = null;
      inCriteria = false;
      continue;
    }
    const storyHeader = line.match(STORY_HEADER);
    if (storyHeader) {
      if (!epic) issue(lineNumber, 'historia sin épica.');
      finishStory(lineNumber);
      const title = storyHeader[1].trim();
      if (!title) issue(lineNumber, 'historia sin título.');
      story = { id: titleId('US', backlog.stories.length + 1), epic_id: epic.id, title, acceptance_criteria: [] };
      backlog.stories.push(story);
      contexts.set(story.id, []);
      inCriteria = false;
      continue;
    }
    if (CRITERIA_HEADER.test(line)) {
      if (!story) issue(lineNumber, 'criterios de aceptación fuera de una historia.');
      // Solo el primer encabezado decide: lo anterior a él es contexto.
      if (!inCriteria) flushEntries(false);
      inCriteria = true;
      continue;
    }
    if (/^#{2,}/.test(line)) {
      if (/^#{5,}\s/.test(line)) issue(lineNumber, 'encabezado no soportado: usa épicas, historias y criterios.');
      if (story && /^####\s/.test(line)) issue(lineNumber, 'encabezado no soportado dentro de historia.');
      if (story && /^###\s/.test(line)) issue(lineNumber, 'encabezado no soportado: usa "### Historia: ...".');
      if (/^##\s/.test(line)) {
        closeSection(lineNumber, line.replace(/^##\s+/, ''));
        continue;
      }
      warn(lineNumber, `encabezado no asignado: ${line}.`);
      continue;
    }
    // Con 4 columnas de indentación es código indentado (CommonMark), no un encabezado:
    // sigue el camino del texto, como en main.
    if (/^#\s/.test(line) && !/^(?: {4}| {0,3}\t)/.test(raw)) {
      // El H1 de título previo a la primera épica se ignora sin aviso; uno posterior
      // es una sección más y no añade sus viñetas a la historia abierta.
      if (backlog.epics.length) closeSection(lineNumber, line.replace(/^#\s+/, ''));
      continue;
    }

    if (listItem) {
      if (story) addListItem(listItem[1], lineNumber, raw);
      else if (epic) issue(lineNumber, 'criterio fuera de una historia.');
      else warn(lineNumber, `elemento sin mapear fuera de las historias: ${line}.`);
      continue;
    }
    if (story) {
      if (inCriteria) warn(lineNumber, `texto fuera de lista de criterios; revisar: ${line}.`);
      else entries.push({ kind: 'text', line: lineNumber, text: line });
    } else if (epic) {
      warn(lineNumber, `texto de épica no convertido: ${line}.`);
    } else {
      warn(lineNumber, `contenido global no convertido: ${line}.`);
    }
  }
  // Un bloque sin cerrar ocultaría el resto del PRD: se rechaza en vez de ignorarlo.
  if (fence) issue(fence.line, 'bloque de código sin cerrar: el resto del PRD no se analizó.');
  if (comment) issue(comment.line, 'comentario HTML sin cerrar: el resto del PRD no se analizó.');
  finishStory(lines.length);
  if (!backlog.epics.length) throw new Error('PRD: No se encontraron épicas. Usa "## Épica: Título".');
  if (!backlog.stories.length) throw new Error('PRD: no se encontraron historias. Usa "### Historia: Título".');
  for (const epicItem of backlog.epics) {
    if (!backlog.stories.some(s => s.epic_id === epicItem.id)) {
      throw new Error(`PRD: épica "${epicItem.title}" sin historias.`);
    }
  }

  for (const storyItem of backlog.stories) {
    const context = contexts.get(storyItem.id).join(' ');
    for (const criterion of storyItem.acceptance_criteria) {
      const id = titleId('TASK', backlog.tasks.length + 1);
      backlog.tasks.push(tddTask(id, storyItem.id, criterion, context));
    }
  }
  const report = validateBacklog(backlog);
  if (!report.valid) throw new Error(`Error interno: backlog generado inválido:\n- ${report.errors.join('\n- ')}`);
  // Algunas advertencias se emiten al cerrar la historia; se devuelven en orden de línea.
  const warnings = notes
    .sort((a, b) => a.line - b.line)
    .map(note => `Línea ${note.line}: ${note.message}`);
  return {
    backlog,
    warnings,
    stats: {
      epics: backlog.epics.length,
      stories: backlog.stories.length,
      criteria: backlog.stories.reduce((total, s) => total + s.acceptance_criteria.length, 0),
      tasks: backlog.tasks.length,
    },
  };
}

function titleId(prefix, n) {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function isCriterionText(text) {
  return text !== '' && !PLACEHOLDER.test(text);
}

// Cerca de cierre (CommonMark): el carácter de la apertura, al menos tantas veces
// como en ella y sin más texto (la línea llega ya sin espacios en los extremos).
function closesFence(line, marker) {
  return line.length >= marker.length && line === marker[0].repeat(line.length);
}

// "El formulario valida" + ["nombre", "email"] → "El formulario valida: nombre; email".
function mergeItem(item) {
  if (!item.children.length) return item.text;
  const head = item.text.endsWith(':') ? item.text : `${item.text}:`;
  return `${head} ${item.children.join('; ')}`;
}

// Una sola tarea por criterio: `task verify` exige la suite en verde antes de la
// revisión, así que la prueba (RED) y la implementación (GREEN) van juntas.
function tddTask(id, storyId, criterion, context) {
  const description = [
    `Escribir primero una prueba de aceptación que falle (RED) para: ${criterion}.`,
    'Implementar el cambio mínimo que la haga pasar (GREEN) y refactorizar con la suite en verde.',
  ];
  if (context) description.push(`Contexto: ${context}`);
  return {
    id,
    story_id: storyId,
    title: `Implementar (TDD): ${criterion}`,
    description: description.join(' '),
    acceptance_criteria: [criterion],
    dependencies: [],
    status: 'draft',
    story_points: 2,
    risk: 'medium',
    // Marcadores provisionales: una persona los calibra antes de pasar a ready.
    complexity: { scope: 1, ambiguity: 2, integration: 0, impact: 1, verification: 1 },
    test_plan: [
      `RED: prueba de aceptación reproducible para "${criterion}" que falla antes del cambio.`,
      'GREEN: la prueba pasa con el cambio mínimo.',
      'REFACTOR: la suite completa sigue en verde (npm test).',
    ],
  };
}
