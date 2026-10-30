#!/usr/bin/env node
// Runs phases 0–3 in order: discover → packages → runtimes → apis. Then Claude assesses change files and runs finalize.mjs.
// Usage: node check.mjs [--root <dir>] [--in-repo | --dir <path>] [--transitive] [--no-enrich] [--offline] [--skip packages,runtimes,apis]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { parseArgs, paths, ensureDirs, strayStateDirs } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs();
const p = paths(args);
const skip = new Set(String(args.skip || '').split(',').filter(Boolean));
const pass = process.argv.slice(2).filter((a, i, all) => a !== '--skip' && all[i - 1] !== '--skip');

// State used to live in the solution (.solution-health/). Copy it to the new place once, so the
// first run there still compares with the last one; the old folder is left for the team to delete.
if (!p.inRepo && existsSync(join(p.legacyDir, 'manifest.json')) && !existsSync(p.manifest)) {
  cpSync(p.legacyDir, p.dir, { recursive: true, filter: (src) => !src.startsWith(join(p.legacyDir, 'run')) });
  console.error(`Copied the manifest and state from ${p.legacyDir} to ${p.dir}. The old folder is no longer used; delete it (or run with --in-repo to keep using it).`);
}
if (p.ignoredDir) console.error(`${p.ignoredDir} is inside an audit run folder, which the next run will not look in. Keeping the state in ${p.dir} instead.`);
// State an earlier run left in an audit run folder (e.g. --dir into an audit-all run): copy the newest once.
if (!p.inRepo && !existsSync(p.manifest)) {
  const stray = [p.ignoredDir, ...strayStateDirs(p.root)].filter((d) => d && existsSync(join(d, 'manifest.json')))[0];
  if (stray) {
    cpSync(stray, p.dir, { recursive: true, filter: (src) => !src.startsWith(join(stray, 'run')) });
    console.error(`Copied the manifest and state from ${stray} to ${p.dir}, where every run will find them.`);
  }
}
ensureDirs(p);
console.error(`State folder: ${p.dir}`);

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
