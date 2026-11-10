import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, findArchives, digestSeo, digestGeo, diffDigest, diffDirs, formatDiff, digestArchive } from '../corpus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '../../../skills/plan-geo/scripts/test/fixtures/archive');

test('parseArgs reads commands and repeatable archives', () => {
  const o = parseArgs(['check', '--archive', 'a', '--archive', 'b', '--golden', 'g', '--only', 'x.example,y.example', '--update']);
  assert.equal(o.cmd, 'check');
  assert.deepEqual(o.archive, ['a', 'b']);
  assert.deepEqual(o.only, ['x.example', 'y.example']);
  assert.equal(o.update, true);
});

test('findArchives picks the newest dated archive per host', () => {
  const root = mkdtempSync(join(tmpdir(), 'corpus-root-'));
  for (const d of ['2026-01-01', '2026-02-01', '2026-02-01-0900']) {
    mkdirSync(join(root, 'example.com/pages', d), { recursive: true });
    writeFileSync(join(root, 'example.com/pages', d, 'index.json'), '{}');
  }
  mkdirSync(join(root, 'example.org/pages/2026-03-01'), { recursive: true }); // no index.json
  const found = findArchives(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].host, 'example.com');
  assert.equal(found[0].date, '2026-02-01-0900');
});

test('digestSeo keeps row status and finding counts, sorted', () => {
  const d = digestSeo(
    { version: '9.9.9', stats: { html: 3, indexable: 2 }, geo: { score: { score: 70 } }, rows: [{ id: 'seo.z', status: 'warn' }, { id: 'seo.a', status: 'pass' }] },
    { findings: [{ check: 'seo.z', count: 4 }] },
  );
  assert.deepEqual(Object.keys(d.rows), ['seo.a', 'seo.z']);
  assert.equal(d.rows['seo.z'], 'warn (4)');
  assert.equal(d.geoScore, 70);
});

test('digestGeo records examples and what each page read', () => {
  const d = digestGeo(
    { version: '1', templates: [{ key: 'news', pages: 5, example: { url: 'https://example.com/news/a' } }] },
    [{ url: 'https://example.com/news/a', template: 'news', words: 300, leadDate: '2026-05-03', bylines: [{ name: 'Jane Doe' }], questions: [1, 2], hidden: { words: 40 } }],
  );
  assert.equal(d.templates.news.example, 'https://example.com/news/a');
  const p = d.pages['https://example.com/news/a'];
  assert.equal(p.leadDate, '2026-05-03');
  assert.deepEqual(p.bylines, ['Jane Doe']);
  assert.equal(p.questions, 2);
  assert.equal(p.hiddenWords, 40);
});

test('diffDigest lists only what changed and ignores tool versions', () => {
  const a = { seo: { version: '1', rows: { 'seo.a': 'pass', 'seo.b': 'warn' } }, geo: { pages: { u: { leadDate: '2026-01-01' } } } };
  const b = { seo: { version: '2', rows: { 'seo.a': 'pass', 'seo.b': 'fail', 'seo.c': 'info' } }, geo: { pages: { u: { leadDate: null } } } };
  const c = diffDigest(a, b);
  assert.deepEqual(c.map((x) => x.path.join('/')), ['geo/pages/u/leadDate', 'seo/rows/seo.b', 'seo/rows/seo.c']);
});

test('diffDirs and formatDiff report per site, with added and removed sites', () => {
  const A = mkdtempSync(join(tmpdir(), 'corpus-a-'));
  const B = mkdtempSync(join(tmpdir(), 'corpus-b-'));
  writeFileSync(join(A, 'one.example.json'), JSON.stringify({ seo: { rows: { 'seo.x': 'pass' } } }));
  writeFileSync(join(B, 'one.example.json'), JSON.stringify({ seo: { rows: { 'seo.x': 'warn' } } }));
  writeFileSync(join(A, 'two.example.json'), JSON.stringify({}));
  writeFileSync(join(B, 'three.example.json'), JSON.stringify({}));
  const r = diffDirs(A, B);
  const text = formatDiff(r);
  assert.match(text, /3 sites, 3 changed/);
  assert.match(text, /seo\.x: pass → warn/);
  assert.match(text, /### three\.example\nNew in this run/);
  assert.match(text, /### two\.example\nMissing from this run/);
});

test('digestArchive runs audit-seo and plan-geo on a page archive without the network', () => {
  const root = mkdtempSync(join(tmpdir(), 'corpus-e2e-'));
  const dir = join(root, 'site/pages/2026-01-01');
  cpSync(FIXTURE, dir, { recursive: true });
  const host = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).host || 'site';
  const d = digestArchive({ host, dir, date: '2026-01-01' });
  assert.equal(d.errors, undefined, JSON.stringify(d.errors));
  assert.ok(Object.keys(d.seo.rows).length > 10);
  assert.ok(Object.keys(d.geo.pages).length >= 1);
  // the same archive digests the same way twice
  assert.deepEqual(digestArchive({ host, dir, date: '2026-01-01' }), d);
});
