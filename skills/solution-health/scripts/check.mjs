#!/usr/bin/env node
// Runs phases 0–3 in order: discover → packages → runtimes → apis. Then Claude assesses change files and runs finalize.mjs.
// Usage: node check.mjs [--root <dir>] [--transitive] [--no-enrich] [--offline] [--skip packages,runtimes,apis]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { parseArgs, paths } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs();
const p = paths(args);
const skip = new Set(String(args.skip || '').split(',').filter(Boolean));
const pass = process.argv.slice(2).filter((a, i, all) => a !== '--skip' && all[i - 1] !== '--skip');

// Fresh run folder each time (cache survives: it lives in run/cache and is reused within its TTL).
for (const d of ['changes', 'pending-snapshots']) rmSync(join(p.runDir, d), { recursive: true, force: true });
rmSync(join(p.runDir, 'assessments.json'), { force: true });

for (const step of ['discover', 'packages', 'runtimes', 'apis']) {
  if (skip.has(step)) continue;
  console.error(`\n=== ${step} ===`);
  const r = spawnSync(process.execPath, [join(here, `${step}.mjs`), ...pass], { stdio: 'inherit' });
  if (r.status !== 0 && step === 'discover') process.exit(r.status ?? 1);
  if (r.status !== 0) console.error(`(${step} exited with ${r.status} — continuing)`);
}
console.error('\nNext: read any change files listed above, write run/assessments.json, then run finalize.mjs.');
