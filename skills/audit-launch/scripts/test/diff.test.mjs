import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffReports, flattenNumbers } from '../lib/diff.mjs';

const mk = (id, status, subject) => ({ id, status, title: id, evidence: '', ...(subject ? { subject } : {}) });

test('flattenNumbers walks nested objects and keeps only finite numbers', () => {
  assert.deepEqual(flattenNumbers({ a: { b: 1, c: 'x', d: null }, e: 2.5, f: [1] }), { 'a.b': 1, e: 2.5 });
});

test('diffReports finds fixed, regressed, new and removed findings and score deltas', () => {
  const prev = {
    generatedAt: '2026-09-20T10:00:00Z', input: { env: 'staging' },
    scoreboard: { lighthouse: { mobile: { performance: 71, seo: 69 } }, w3c: { errors: 128 } },
    results: [mk('a.one', 'fail'), mk('a.two', 'warn'), mk('a.three', 'pass'), mk('a.four', 'warn'), mk('perf.page', 'warn', 'https://x/p1'), mk('a.gone', 'fail')],
  };
  const cur = {
    generatedAt: '2026-09-24T10:00:00Z', input: { env: 'production' },
    scoreboard: { lighthouse: { mobile: { performance: 80, seo: 69 } }, w3c: { errors: 12 }, extra: 1 },
    results: [mk('a.one', 'pass'), mk('a.two', 'fail'), mk('a.three', 'fail'), mk('a.four', 'warn'), mk('perf.page', 'pass', 'https://x/p1'), mk('a.new', 'warn'), mk('a.newpass', 'pass')],
  };
  const d = diffReports(prev, cur);
  assert.deepEqual(d.fixed.map((x) => x.key), ['a.one', 'perf.page@https://x/p1']);
  assert.deepEqual(d.regressed.map((x) => [x.key, x.from, x.to]), [['a.two', 'warn', 'fail'], ['a.three', 'pass', 'fail']]);
  assert.deepEqual(d.newFindings.map((x) => x.key), ['a.new'], 'only new problems, not new passes');
  assert.deepEqual(d.removed.map((x) => x.key), ['a.gone']);
  assert.deepEqual(d.scores, [
    { key: 'lighthouse.mobile.performance', from: 71, to: 80, delta: 9 },
    { key: 'w3c.errors', from: 128, to: 12, delta: -116 },
  ]);
  assert.deepEqual(d.envChanged, { from: 'staging', to: 'production' });
  assert.equal(d.prevGeneratedAt, '2026-09-20T10:00:00Z');
  assert.equal(d.unchanged, 1, 'a.four');
});

test('diffReports tolerates a missing or malformed baseline', () => {
  const d = diffReports(null, { results: [] });
  assert.equal(d.error, 'baseline has no results');
  const e = diffReports({ results: 'nope' }, { results: [] });
  assert.equal(e.error, 'baseline has no results');
});
