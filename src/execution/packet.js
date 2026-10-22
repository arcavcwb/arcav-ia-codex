import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { validateBacklog } from '../backlog/validate.js';
import { routeTask } from '../routing/router.js';
import { LIMITS, inRange } from '../limits.js';

const MAX_FILES = 12;
const DENIED_SEGMENTS = new Set([
  '.git', '.ssh', '.env', '.npmrc', '.netrc', 'node_modules', 'secrets',
  'credentials', '.aws', '.config', '.gnupg', 'private',
]);
const DENIED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.bin']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

function safeRelativeFile(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || /[\r\n]/.test(name)) {
    throw new Error(`context_files: ruta inválida: ${String(name)}.`);
  }
  if (path.posix.isAbsolute(name) || name.split('/').some(s => s === '' || s === '.' || s === '..')) {
    throw new Error(`context_files: solo rutas relativas directas, sin . ni ..: ${name}.`);
  }
  const segments = name.split('/');
  if (segments.some(s => s.startsWith('.') || DENIED_SEGMENTS.has(s.toLowerCase()) || s.toLowerCase().startsWith('.env')) ||
      DENIED_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    throw new Error(`context_files: ruta sensible u oculta no permitida: ${name}.`);
  }
  return segments;
}

function readScopedFile(root, name, remaining) {
  const segments = safeRelativeFile(name);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink()) throw new Error(`context_files: enlaces simbólicos prohibidos: ${name}.`);
  }
  const real = fs.realpathSync(current);
  const relative = path.relative(root, real);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`context_files: archivo fuera del repositorio: ${name}.`);
  }
  const st = fs.statSync(real);
  if (!st.isFile()) throw new Error(`context_files: no es un archivo regular: ${name}.`);
  if (st.size > remaining) throw new Error(`Presupuesto de contexto excedido al leer ${name}; reduzca archivos o aumente --max-context-bytes.`);
  const bytes = fs.readFileSync(real);
  if (bytes.includes(0)) throw new Error(`context_files: archivo binario no permitido: ${name}.`);
  let content;
  try { content = utf8.decode(bytes); }
  catch { throw new Error(`context_files: UTF-8 inválido: ${name}.`); }
  return { path: name, bytes: bytes.length, content };
}

/** Paquete de handoff de solo lectura: ninguna llamada a Codex, shell, git ni red. */
export function prepareTaskPacket(backlog, taskId, { repoRoot = process.cwd(), models = {}, maxContextBytes = LIMITS.maxContextBytes.default } = {}) {
  if (!inRange(maxContextBytes, LIMITS.maxContextBytes)) {
    const { min, max } = LIMITS.maxContextBytes;
    throw new Error(`maxContextBytes: entero entre ${min} y ${max} bytes.`);
  }
  const validation = validateBacklog(backlog);
  if (!validation.valid) throw new Error(`Backlog inválido:\n- ${validation.errors.join('\n- ')}`);
  const task = backlog.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Tarea inexistente: ${taskId}.`);
  if (task.status !== 'ready') throw new Error(`${taskId}: solo tareas ready pueden preparar un handoff.`);
  if (task.risk === 'critical') throw new Error(`${taskId}: riesgo crítico requiere aprobación humana aún no implementada.`);
  const byId = new Map(backlog.tasks.map(t => [t.id, t]));
  if (task.dependencies.some(id => byId.get(id)?.status !== 'done')) {
    throw new Error(`${taskId}: hay dependencias pendientes.`);
  }
  const files = task.context_files ?? [];
  if (!Array.isArray(files) || files.length > MAX_FILES || files.some(f => typeof f !== 'string')) {
    throw new Error(`context_files: máximo ${MAX_FILES} rutas explícitas.`);
  }
  if (new Set(files).size !== files.length) throw new Error('context_files: rutas duplicadas.');
  const root = fs.realpathSync(repoRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('repoRoot: no es un directorio.');
  const route = routeTask(task, models);
  const packet = {
    schema_version: 1,
    execution: 'dry-run',
    task: {
      id: task.id, title: task.title, description: task.description, story_id: task.story_id,
      acceptance_criteria: [...task.acceptance_criteria], test_plan: [...task.test_plan],
      dependencies: [...task.dependencies], risk: task.risk,
    },
    routing: route,
    quality_gates: [
      { phase: 'RED', evidence: 'Prueba ejecutada y fallando por la conducta requerida antes de modificar producto.' },
      { phase: 'GREEN', evidence: 'Cambio mínimo y prueba objetivo pasando.' },
      { phase: 'REFACTOR', evidence: 'Suite y comprobaciones pertinentes pasan luego de mejorar el código.' },
      { phase: 'REVIEW', evidence: 'Revisión independiente del diff y problemas resueltos; no compartir historial completo.' },
      { phase: 'QA', evidence: 'Evidencia de tests/build/seguridad, aprobación humana y PR antes del merge.' },
    ],
    handoff_policy: {
      implementer: 'Usar exclusivamente el contrato de tarea y los archivos enumerados; pedir ampliación justificada.',
      reviewer: 'Recibir contrato, diff y evidencia RED/GREEN; no reutilizar la conversación del implementador.',
      budget_unit: 'bytes UTF-8 de paquete JSON compacto, no tokens del proveedor',
    },
    context_files: [],
    context_bytes: 0,
    max_context_bytes: maxContextBytes,
  };
  const size = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size(packet) > maxContextBytes) throw new Error('Presupuesto insuficiente para el contrato de tarea.');
  for (const file of files) {
    const remaining = maxContextBytes - size(packet) - 256;
    if (remaining < 1) throw new Error('Presupuesto de contexto agotado.');
    const record = readScopedFile(root, file, remaining);
    packet.context_files.push(record);
    packet.context_bytes += record.bytes;
    if (size(packet) > maxContextBytes) throw new Error(`Presupuesto de contexto excedido por ${file}.`);
  }
  packet.packet_bytes = 0;
  while (packet.packet_bytes !== size(packet)) packet.packet_bytes = size(packet);
  if (packet.packet_bytes > maxContextBytes) throw new Error('Presupuesto final de contexto excedido.');
  return packet;
}
