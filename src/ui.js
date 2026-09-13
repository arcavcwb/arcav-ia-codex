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

export function showBanner() {
  console.log(`
${colors.cyan}${colors.bold}╔═══════════════════════════════════════════════════════════════╗
║                    @arcav-ia/codex                            ║
║              Personal Codex Development Toolkit                ║
║           5 Codex Agents • 8 Skills • Git-First                ║
╚═══════════════════════════════════════════════════════════════╝${colors.reset}
`);
}
