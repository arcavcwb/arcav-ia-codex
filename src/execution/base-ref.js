/** Rama o referencia Git contra la que se calcula el diff de una tarea. */
export const DEFAULT_BASE_REF = 'main';

// Empieza por alfanumérico para que nunca se interprete como opción de git (p. ej. "-x").
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** Devuelve la referencia validada o lanza un error legible. */
export function assertBaseRef(ref = DEFAULT_BASE_REF) {
  const valid = typeof ref === 'string' &&
    SAFE_REF.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.') &&
    !ref.endsWith('.lock') &&
    !ref.split('/').some(segment => segment.startsWith('.'));
  if (!valid) throw new Error(`--base: referencia Git inválida: ${String(ref)}.`);
  return ref;
}
