export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

// Ancho interior de la caja del banner, sin los bordes.
const BANNER_WIDTH = 63;

/** Centra el texto dentro de la caja para que el borde derecho quede siempre alineado. */
function bannerLine(text) {
  const free = BANNER_WIDTH - [...text].length;
  const left = Math.floor(free / 2);
  return `║${' '.repeat(left)}${text}${' '.repeat(free - left)}║`;
}

export function showBanner() {
  const border = '═'.repeat(BANNER_WIDTH);
  console.log(`
${colors.cyan}${colors.bold}╔${border}╗
${bannerLine('@arcav-ia/codex')}
${bannerLine('Personal Codex Development Toolkit')}
${bannerLine('Scaffolding Codex • Backlog → Revisión • Git-First')}
╚${border}╝${colors.reset}
`);
}
