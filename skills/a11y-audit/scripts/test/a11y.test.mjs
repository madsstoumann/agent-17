import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { scFromAxeTags, scFromHtmlcsCode, enClause, criteriaFor, axeTags } from '../lib/wcag.mjs';
import { pickPages, sitemapLocs, templateOf } from '../lib/pages.mjs';
import { analyseWalk } from '../lib/keyboard.mjs';
import { aggregate, toTasks, genericMessage, diffRuns } from '../lib/findings.mjs';
import { resultLine } from '../lib/report.mjs';
import { findChrome } from '../lib/cdp.mjs';
import { loadEngine } from '../lib/engines.mjs';
import { parseCli, parseHeaderLines, reportsRoot, run, stateDir } from '../a11y.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('wcag: axe tags, HTML_CodeSniffer codes and EN 301 549 clauses', () => {
  assert.deepEqual(scFromAxeTags(['cat.color', 'wcag2aa', 'wcag143', 'wcag1410', 'best-practice']), ['1.4.3', '1.4.10']);
  assert.equal(scFromHtmlcsCode('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail'), '1.4.3');
  assert.equal(scFromHtmlcsCode('WCAG2AA.Principle2.Guideline2_4.2_4_11.X'), '2.4.11');
  assert.equal(enClause('1.4.3'), '9.1.4.3');
  assert.equal(enClause('2.5.8'), null, 'new in 2.2: no EN clause yet');
  assert.equal(enClause('1.4.6'), null, 'AAA is not in EN 301 549 clause 9');
  const aa = criteriaFor('AA');
  assert.equal(aa.length, 55, 'WCAG 2.2 has 55 A and AA criteria');
  assert.ok(!aa.some((c) => c.sc === '4.1.1'), '4.1.1 is obsolete in 2.2');
  assert.ok(axeTags('AA').includes('wcag22aa') && !axeTags('AA').includes('wcag2aaa'));
});

test('pages: start page first, one per template, same origin only', () => {
  const picked = pickPages({
    start: 'https://shop.example.dk/',
    candidates: ['https://shop.example.dk/news/a', 'https://shop.example.dk/news/b', 'https://other.dk/x', 'https://shop.example.dk/about', 'https://shop.example.dk/file.pdf', 'https://shop.example.dk/#top', 'https://shop.example.dk/news/c'],
    n: 4,
  });
  assert.deepEqual(picked, ['https://shop.example.dk/', 'https://shop.example.dk/news/a', 'https://shop.example.dk/about', 'https://shop.example.dk/news/b']);
  assert.equal(templateOf('https://x.dk/a/b/c/d'), 'a|3');
  assert.deepEqual(sitemapLocs('<urlset><url><loc>https://x.dk/a?b=1&amp;c=2</loc></url><url><loc><![CDATA[https://x.dk/b]]></loc></url></urlset>'), ['https://x.dk/a?b=1&c=2', 'https://x.dk/b']);
});

const stop = (uid, extra = {}) => ({ uid, path: `#s${uid}`, tag: 'a', name: `s${uid}`, visible: true, indicator: true, x: 0, y: uid * 40, w: 50, h: 20, ...extra });

test('keyboard: trap, modal, hidden focus, missing indicator, overlay and skip link', () => {
  const trap = analyseWalk({ stops: [stop(1), stop(2), stop(3)], expected: 5, ended: 'loop', loop: { from: 1, to: 3 }, escape: 'held' });
  assert.equal(trap.trap.verdict, 'trap');
  assert.equal(trap.trap.size, 2);
  const modal = analyseWalk({ stops: [stop(1, { inDialog: '#d' }), stop(2, { inDialog: '#d' })], ended: 'loop', loop: { from: 0, to: 2 }, escape: 'held' });
  assert.equal(modal.trap.verdict, 'modal-held');
  assert.equal(analyseWalk({ stops: [stop(1), stop(2)], ended: 'loop', loop: { from: 0, to: 2 }, escape: 'released' }).trap.verdict, 'contained');

  const many = Array.from({ length: 8 }, (_, i) => stop(i + 2, { obscuredBy: '#cookie-banner' }));
  const w = analyseWalk({ stops: [stop(1, { inConsent: true, tag: 'button' }), stop(9, { tag: 'a', href: '#main', name: 'Spring til indhold' }), stop(10, { visible: false }), stop(11, { visible: false, customControl: true }), stop(12, { indicator: false }), ...many], ended: 'left-document' });
  assert.equal(w.skipLink.found, true, 'cookie banner stops before the skip link are ignored');
  assert.equal(w.hidden.length, 1);
  assert.equal(w.customControls.length, 1);
  assert.equal(w.noIndicator.length, 1);
  assert.deepEqual(w.overlay, { by: '#cookie-banner', count: 8, consent: true });
  assert.equal(w.obscured.length, 0, 'the overlay is reported once, not per stop');

  const jump = analyseWalk({ stops: [stop(1, { y: 3000 }), stop(2, { y: 100 })], ended: 'left-document' }, { viewportHeight: 900 });
  assert.equal(jump.jumps.length, 1);
});

const PAGE = (url, extra = {}) => ({
  url,
  axe: {
    violations: [
      { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', description: 'd', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast', tags: ['wcag2aa', 'wcag143'], count: 2, nodes: [{ target: '.a', html: '<p class="a">', summary: '2.1:1' }] },
      { id: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks', description: 'd', helpUrl: 'u', tags: ['best-practice'], count: 1, nodes: [] },
    ],
    incomplete: [],
  },
  htmlcs: { errors: [
    { code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', msg: 'contrast', count: 1, nodes: [] },
    { code: 'WCAG2AA.Principle4.Guideline4_1.4_1_1.F77', msg: 'Duplicate id attribute value "x1" found on the web page.', count: 1, nodes: [] },
    { code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H71.NoLegend', msg: 'Fieldset does not contain a legend element.', count: 3, nodes: [] },
  ], warnings: [] },
  ...extra,
});

test('aggregate: one issue per rule across pages, best practice and 4.1.1 apart, criteria status', () => {
  const kb = analyseWalk({ stops: [stop(1), stop(2), stop(3)], ended: 'loop', loop: { from: 1, to: 3 }, escape: 'held' });
  const agg = aggregate([PAGE('https://x.dk/', { keyboard: kb, reflow: { overflow: true, scrollWidth: 400, wide: [{ target: '.w', width: 600, right: 600 }] } }), PAGE('https://x.dk/a'), { url: 'https://x.dk/b', error: 'HTTP 500' }],
    { axeCoverage: ['1.4.3', '1.1.1'], statement: null, startUrl: 'https://x.dk/' });
  const ids = agg.issues.map((i) => i.rule);
  assert.equal(agg.issues[0].severity, 'blocker');
  assert.equal(agg.issues[0].rule, 'keyboard-trap');
  assert.ok(ids.includes('color-contrast'));
  assert.ok(!ids.some((r) => r.includes('1_4_3')), 'HTML_CodeSniffer contrast folded into axe on the same page');
  assert.ok(!ids.some((r) => r.includes('4_1_1')), '4.1.1 goes to best practice');
  const contrast = agg.issues.find((i) => i.rule === 'color-contrast');
  assert.deepEqual([contrast.pages.length, contrast.count, contrast.severity, contrast.en], [2, 4, 'high', ['9.1.4.3']]);
  assert.deepEqual(agg.bestPractice.map((b) => b.rule).sort(), ['WCAG2AA.Principle4.Guideline4_1.4_1_1.F77', 'region']);
  assert.ok(agg.review.some((r) => r.rule === 'accessibility-statement'));
  const status = Object.fromEntries(agg.criteria.map((c) => [c.sc, c.status]));
  assert.deepEqual([status['1.4.3'], status['2.1.2'], status['1.1.1'], status['3.3.8']], ['fail', 'fail', 'pass', 'manual']);
  assert.equal(agg.counts.pagesFailed, 1);
  assert.match(resultLine(agg.counts), /^\d+ criteria failed, \d+ issues \(1 blocker, .*\), \d+ to review, 2 pages$/);
  assert.equal(genericMessage('Duplicate id attribute value "1a2e-44" found.'), 'Duplicate id attribute value "…" found.');
  assert.equal(genericMessage('role is "presentation" but'), 'role is "presentation" but');
});

test('toTasks: drafts audit-all accepts, human-owned without a repo', async () => {
  const { validateTasks } = await import('../../../audit-all/scripts/lib/tasks.mjs').catch(() => ({}));
  const agg = aggregate([PAGE('https://x.dk/')], { startUrl: 'https://x.dk/', statement: { href: 'x' } });
  const human = toTasks(agg.issues, { subject: 'x.dk' });
  assert.ok(human.tasks.every((t) => t.owner === 'human' && t.sources[0] === 'a11y' && !t.repo));
  const agent = toTasks(agg.issues, { subject: 'x.dk', repo: 'web', repoPath: '/code/web' });
  assert.deepEqual(agent.repos, { web: '/code/web' });
  assert.ok(agent.tasks.every((t) => t.owner === 'agent' && t.repo === 'web' && ['haiku', 'sonnet'].includes(t.model)));
  if (validateTasks) {
    assert.deepEqual(validateTasks(human).errors, []);
    assert.deepEqual(validateTasks(agent).errors, []);
  }
});

test('diffRuns: new, fixed, still open and criteria changes', () => {
  const before = aggregate([PAGE('https://x.dk/')], { startUrl: 'https://x.dk/', statement: { href: 'x' } });
  const kb = analyseWalk({ stops: [stop(1, { indicator: false })], ended: 'left-document' });
  const after = aggregate([PAGE('https://x.dk/', { keyboard: kb, axe: { violations: [], incomplete: [] } })], { startUrl: 'https://x.dk/', statement: { href: 'x' } });
  const d = diffRuns({ date: '2026-10-01T00:00:00Z', issues: before.issues, criteria: before.criteria }, after);
  assert.deepEqual(d.fixed.map((i) => i.key), ['axe:color-contrast']);
  assert.deepEqual(d.newIssues.map((i) => i.key), ['kbd:no-indicator', 'htmlcs:1.4.3:G18.Fail'], 'HTML_CodeSniffer contrast shows once axe no longer reports it');
  assert.ok(d.open.some((i) => i.key.startsWith('htmlcs:1.3.1')));
  assert.ok(d.criteria.some((c) => c.sc === '2.4.7' && c.to === 'fail'));
});

test('stateDir: --state, else <reports>/a11y-audit/<host>/', () => {
  assert.equal(stateDir({ url: 'https://shop.example.dk/x', state: null }, { root: '/r' }), path.join('/r', 'a11y-audit', 'shop.example.dk'));
  assert.equal(stateDir({ url: 'https://x.dk/', state: '/tmp/s' }, { root: '/r' }), '/tmp/s');
});

test('cli: defaults, flags and headers', () => {
  const o = parseCli(['shop.example.dk'], {});
  assert.deepEqual([o.url, o.pages, o.keyboard, o.level, o.repo], ['https://shop.example.dk/', 10, 3, 'AA', null]);
  const p = parseCli(['https://x.dk', '--pages', '3', '--level', 'aaa', '--repo', 'web=/tmp/web', '--header', 'X-Bypass: 1'], { AUDIT_HEADERS: 'X-Other: 2' });
  assert.deepEqual([p.pages, p.level, p.repo, p.repoPath, p.headers], [3, 'AAA', 'web', '/tmp/web', { 'X-Bypass': '1', 'X-Other': '2' }]);
  assert.throws(() => parseCli([], {}), /URL is required/);
  assert.throws(() => parseCli(['x.dk', '--level', 'B'], {}), /--level/);
  assert.throws(() => parseHeaderLines(['nope']), /Name: value/);
});

test('reportsRoot: AUDIT_OUT_DIR, then XDG download dir, then ~/Downloads, then ~/audit-reports', () => {
  const home = '/home/me';
  const has = (...dirs) => (p) => dirs.includes(p);
  assert.equal(reportsRoot({ env: { AUDIT_OUT_DIR: '~/reports' }, home, isDir: has() }), '/home/me/reports');
  assert.equal(reportsRoot({ env: {}, home, isDir: has('/home/me/Downloads'), readFile: () => null }), '/home/me/Downloads');
  assert.equal(reportsRoot({ env: {}, home, isDir: has('/home/me/Hentet', '/home/me/Downloads'), readFile: () => 'XDG_DOWNLOAD_DIR="$HOME/Hentet"\n' }), '/home/me/Hentet');
  assert.equal(reportsRoot({ env: {}, home, isDir: has(), readFile: () => null }), '/home/me/audit-reports');
});

// End to end against a local page with a keyboard trap, when a browser and the engines are available.
test('run: finds the trap, missing focus style, contrast, alt and reflow on the fixture', { timeout: 120000 }, async (t) => {
  if (!findChrome()) return t.skip('no browser');
  try { await loadEngine('axe'); await loadEngine('htmlcs'); } catch { return t.skip('engines not cached and no network'); }
  const html = fs.readFileSync(path.join(HERE, 'fixtures', 'bad.html'));
  const server = http.createServer((q, s) => { s.writeHead(q.url === '/' ? 200 : 404, { 'content-type': 'text/html' }); s.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  try {
    const opts = parseCli([`http://127.0.0.1:${server.address().port}/`, '--pages', '1', '--out', out], {});
    process.env.AUDIT_OUT_DIR = out;
    const { agg, dir, state } = await run(opts, { log: () => {} });
    assert.ok(fs.existsSync(path.join(state, 'last-report.json')) && fs.existsSync(path.join(dir, '.audit-run')));
    fs.writeFileSync(path.join(state, 'notes.md'), 'Contrast on the footer is a known brand decision.\n');
    const second = await run(parseCli([opts.url, '--pages', '1', '--keyboard', '0'], {}), { log: () => {} });
    assert.ok(second.dir.startsWith(path.join(state, 'runs')), 'default run folder is <target>/runs/<stamp>');
    assert.equal(second.diff.from, path.join(state, 'last-report.json'));
    assert.ok(second.diff.fixed.some((i) => i.key === 'kbd:trap'), 'no keyboard walk the second time');
    assert.match(fs.readFileSync(path.join(second.dir, 'report.md'), 'utf8'), /## Since last run[\s\S]*## Notes[\s\S]*known brand decision/);
    const rules = agg.issues.map((i) => i.rule);
    for (const r of ['keyboard-trap', 'focus-not-visible', 'color-contrast', 'image-alt', 'html-has-lang', 'reflow-320']) assert.ok(rules.includes(r), `${r} in ${rules.join(', ')}`);
    for (const f of ['report.md', 'report.json', 'tasks.json']) assert.ok(fs.existsSync(path.join(out, f)));
    assert.match(fs.readFileSync(path.join(out, 'report.md'), 'utf8'), /\*\*Result:\*\* \d+ criteria failed/);
  } finally {
    delete process.env.AUDIT_OUT_DIR;
    server.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
});
