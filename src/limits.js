/**
 * Rangos y valores por defecto de los parámetros numéricos que expone el CLI.
 * Es la única fuente: cada módulo los valida y src/backlog/command.js los muestra
 * en --help y los comprueba antes de leer archivos o ejecutar npm test.
 */
export const LIMITS = Object.freeze({
  capacity: Object.freeze({ min: 1, max: 1000 }),
  maxContextBytes: Object.freeze({ min: 4096, max: 128 * 1024, default: 32 * 1024 }),
  maxTotalTokens: Object.freeze({ min: 100, max: 100_000, default: 8000 }),
  timeoutSeconds: Object.freeze({ min: 10, max: 3600, default: 300 }),
  testTimeoutSeconds: Object.freeze({ min: 10, max: 600, default: 120 }),
  maxReviewBytes: Object.freeze({ min: 4096, max: 128 * 1024, default: 64 * 1024 }),
});

/** true si value es un entero seguro dentro de [min, max]. */
export function inRange(value, { min, max }) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
