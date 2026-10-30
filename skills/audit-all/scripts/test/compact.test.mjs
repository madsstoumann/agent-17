import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactBlocks, compactReport, KEEP } from '../lib/compact.mjs';
import { parseBlocks } from '../lib/markdown.mjs';
import { splitReport } from '../lib/report.mjs';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (blocks) => JSON.stringify(blocks);

test('a long URL list is cut to KEEP items with a "more" line', () => {
  const md = Array.from({ length: 12 }, (_, i) => `- https://shop.dk/p${i}`).join('\n');
  const out = compactBlocks(parseBlocks(md));
  assert.equal(out[0].items.length, KEEP);
  assert.match(text(out[1]), /and 7 more in the full report/);
});

test('a check table keeps every warn and fail and counts the passes', () => {
  const rows = ['| ✅ Pass | A | ok |', '| ⚠️ Warn | B | x |', '| ❌ Fail | C | y |', ...Array.from({ length: 8 }, (_, i) => `| ⚠️ Warn | W${i} | z |`), '| ℹ️ Info | D | i |'];
  const out = compactBlocks(parseBlocks(['| Status | Check | Evidence |', '|---|---|---|', ...rows].join('\n')));
  assert.equal(out[0].rows.length, 10);
  assert.match(text(out[1]), /2 checks passed, skipped or for information only/);
});

test('a measurement table with a long Result column is cut, not filtered', () => {
  const rows = Array.from({ length: 8 }, (_, i) => `| M${i} | Perf 69 · A11y 95 · Best practices 73 ✅ |`);
  const out = compactBlocks(parseBlocks(['| Measure | Result |', '|---|---|', ...rows].join('\n')));
  assert.equal(out[0].rows.length, KEEP);
});

test('compactReport drops reference sections, folds clean sections and detail subsections', () => {
  const md = `# R\n\nResult: x\n\n## Fix list\n\n| Status | Check |\n|---|---|\n| ⚠️ Warn | A |\n\n### A\n\nLong detail.\n\n## Redirects\n\n| Status | Check |\n|---|---|\n| ✅ Pass | B |\n\n## Not covered\n\n- Rankings\n`;
  const r = compactReport(splitReport(md));
  assert.deepEqual(r.sections.map((s) => s.heading), ['Fix list', 'Nothing to fix']);
  assert.ok(!text(r.sections[0].blocks).includes('Long detail'));
  assert.match(text(r.sections[1].blocks), /Redirects: every check passed/);
});

test('every sample report keeps its sections with something to fix', () => {
  for (const skill of ['launch-audit', 'a11y-audit', 'seo-audit', 'eco-audit', 'solution-health']) {
    const full = splitReport(fs.readFileSync(path.join(SKILLS, skill, 'references', 'sample-report.md'), 'utf8'));
    const c = compactReport(full);
    assert.ok(c.sections.length > 0, skill);
    assert.ok(text(c).length < text(full).length, skill);
  }
});
