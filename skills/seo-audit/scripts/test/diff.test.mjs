import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { diffRows, diffMarkdown } from '../lib/diff.mjs';

test('diffRows sorts changes into fixed, new or worse, and still open', () => {
  const prev = [{ id: 'a', status: 'fail', title: 'A' }, { id: 'b', status: 'pass', title: 'B' }, { id: 'c', status: 'warn', title: 'C' }, { id: 'd', status: 'warn', title: 'D' }, { id: 'gone', status: 'fail', title: 'Gone' }];
  const rows = [{ id: 'a', status: 'pass', title: 'A' }, { id: 'b', status: 'warn', title: 'B' }, { id: 'c', status: 'fail', title: 'C' }, { id: 'd', status: 'warn', title: 'D' }, { id: 'n', status: 'fail', title: 'N' }];
  const d = diffRows(prev, rows);
  assert.deepEqual(d.fixed.map((r) => r.id), ['a', 'gone']);
  assert.deepEqual(d.regressed.map((r) => r.id), ['b', 'c', 'n']);
  assert.deepEqual(d.changed, []);
  assert.match(diffMarkdown(d, { from: '/x/last-report.json' }).join('\n'), /## Since last run[\s\S]*\*\*Fixed\*\*[\s\S]*A: fail → pass/);
});

test('diff.mjs and target-state.mjs match the copies in the other skills', () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const [file, skills] of [['diff.mjs', ['seo-audit', 'eco-audit']], ['target-state.mjs', ['seo-audit', 'eco-audit', 'launch-audit', 'security-audit', 'audit-all', 'a11y-audit']]]) {
    const mine = fs.readFileSync(path.join(here, '..', 'lib', file), 'utf8');
    for (const s of skills) {
      const f = path.join(here, '..', '..', '..', s, 'scripts', 'lib', file);
      if (fs.existsSync(f)) assert.equal(fs.readFileSync(f, 'utf8'), mine, `${s}/scripts/lib/${file}`);
    }
  }
});
