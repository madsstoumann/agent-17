#!/usr/bin/env node
/**
 * audit-security --deep: checks the coverage ledger and the verdicts you wrote.
 *
 *   node deep-check.mjs <run folder or its deep/ folder> [--save] [--json]
 *
 * Every unit must reach a final status with its evidence; every confirmed record needs the whole
 * boundary, a file:line trace that exists, a severity, a fix and who verified it; needs-validation
 * records get no severity and must name the blocker and the check that settles it; rejected records
 * say what refuted them; no record may hold a secret. Exit 1 lists what to fix.
 *
 * --save (only when the check passes): adds an `fp` to each record, compares with the last saved
 * deep run of this repo, and saves ledger.json and verdicts.json in the target folder as
 * last-deep-ledger.json and last-deep-verdicts.json, so the next deep run starts from them.
 */
import fs from 'node:fs';
import path from 'node:path';

import { validateDeep, recordFp, diffVerdicts } from './lib/deep.mjs';

const log = (m) => process.stderr.write(`${m}\n`);

export function deepDir(arg) {
  const p = path.resolve(arg || '.');
  return fs.existsSync(path.join(p, 'deep', 'ledger.json')) ? path.join(p, 'deep') : p;
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function check(dir, { save = false } = {}) {
  const meta = read(path.join(dir, 'meta.json'));
  const ledger = read(path.join(dir, 'ledger.json'));
  const verdicts = read(path.join(dir, 'verdicts.json'));
  const result = validateDeep({ ledger, verdicts, root: meta.root });
  result.meta = meta;
  if (!save || result.errors.length) return result;
  for (const r of verdicts.records) r.fp = recordFp(r, ledger);
  fs.writeFileSync(path.join(dir, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
  let prev = null;
  try { prev = read(path.join(meta.stateDir, 'last-deep-verdicts.json')); } catch { /* first saved deep run */ }
  result.diff = prev ? diffVerdicts(prev, verdicts) : null;
  fs.mkdirSync(meta.stateDir, { recursive: true });
  fs.writeFileSync(path.join(meta.stateDir, 'last-deep-ledger.json'), JSON.stringify(ledger, null, 2));
  fs.writeFileSync(path.join(meta.stateDir, 'last-deep-verdicts.json'), JSON.stringify(verdicts, null, 2));
  result.saved = meta.stateDir;
  return result;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write('Usage: node deep-check.mjs <run folder> [--save] [--json]\n'); return; }
  const dir = deepDir(args.find((a) => !a.startsWith('--')));
  let r;
  try { r = check(dir, { save: args.includes('--save') }); } catch (e) { log(`deep-check: ${e.message} (expected meta.json, ledger.json and verdicts.json in ${dir})`); process.exit(2); }
  if (args.includes('--json')) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exit(r.errors.length ? 1 : 0); }
  const u = r.counts.units || {};
  const L = [`deep-check ${dir}`];
  if (r.counts.units) L.push(`units: ${Object.entries(u).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}`, `records: ${r.counts.confirmed} confirmed, ${r.counts['needs-validation']} needs-validation, ${r.counts.rejected} rejected`);
  for (const e of r.errors) L.push(`ERROR  ${e}`);
  for (const w of r.warnings) L.push(`note   ${w}`);
  if (r.diff) L.push(`since the last saved deep run: ${r.diff.new.length} new, ${r.diff.open.length} still open, ${r.diff.gone.length} gone${r.diff.gone.length ? ` (${r.diff.gone.map((x) => x.title).slice(0, 5).join('; ')})` : ''}`);
  if (r.saved) L.push(`saved as the baseline for the next deep run: ${r.saved}`);
  L.push(r.errors.length ? `${r.errors.length} problem(s): fix them and run deep-check again` : 'OK');
  process.stdout.write(`${L.join('\n')}\n`);
  process.exit(r.errors.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
