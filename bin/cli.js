#!/usr/bin/env node

import { main } from '../src/index.js';

main().catch((err) => {
  console.error('Error no controlado en @arcav-ia/codex:', err);
  process.exit(1);
});
