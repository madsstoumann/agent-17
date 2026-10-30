import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBlocks, renderBlocks, inline, plain } from '../lib/markdown.mjs';
import { discoverReports, headline, parseSummary, parseAction, statusClass, splitReport, clipSentences, combinedHtml, siteMismatches } from '../lib/report.mjs';
import { findChrome, buildPrintArgs, pdfDestPages } from '../lib/pdf.mjs';
import { parseArgs, reportsRoot, safeName, combine, VERSION } from '../combine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(HERE, '..', '..', '..');
const sample = (skill) => fs.readFileSync(path.join(SKILLS, skill, 'references', 'sample-report.md'), 'utf8');

const SECURITY = `# Security audit: shop-web

2026-10-30 · code mode · security-audit 1.1.0

**Verdict:** 1 blocker: a live Stripe key in git history.

## Blockers

1. **Live Stripe key** — \`config/payments.js\`
   Fix: roll it.

## Findings

| # | Severity | Finding |
|---|---|---|
| 1 | High | XSS in search |
| 2 | Medium | Open redirect |
`;

const SUMMARY = `---
title: Ready to launch, with two things to fix first
subject: shop.example.dk
---

## Verdict

Rotate the key, then ship.

## Fix first

1. **Rotate the Stripe key** — still in history. [Blocker · Security]
2. **Remove noindex** — header and meta tag. [Fail · Launch]
`;

test('inline: escapes HTML, renders code, links, emphasis and status emoji as marks', () => {
  assert.equal(inline('<meta> & `a<b`'), '&lt;meta&gt; &amp; <code>a&lt;b</code>');
  assert.equal(inline('**bold** and *it* and _it_'), '<strong>bold</strong> and <em>it</em> and <em>it</em>');
  assert.equal(inline('[x](https://a.b/?q=1&r=2)'), '<a href="https://a.b/?q=1&amp;r=2">x</a>');
  assert.equal(inline('[x](javascript:alert(1))').includes('javascript'), false);
  assert.match(inline('LCP 7.5 s ❌ · CLS 0 ✅'), /mk fail.*mk pass/);
  assert.match(inline('⚠️ warn'), /mk warn/);
  assert.equal(inline('⚠️').includes('️'), false);
  assert.match(inline('https://a-very-long-host-name.example.com/path'), /class="brk"/);
  assert.equal(inline('snake_case_name stays'), 'snake_case_name stays');
});

test('parseBlocks: headings, tables, nested and task lists, code fences', () => {
  const md = '# T\n\n| a | b |\n|---|--:|\n| 1 | `x|y` |\n\n- [ ] one\n- [x] two\n  - nested\n\n```\n<raw>\n```\n';
  const b = parseBlocks(md);
  assert.deepEqual(b.map((x) => x.type), ['heading', 'table', 'list', 'code']);
  assert.deepEqual(b[1].rows[0], ['1', '`x|y`']);
  assert.equal(b[2].items[1].task, true);
  assert.equal(b[2].items[1].children[0].type, 'list');
  const html = renderBlocks(b);
  assert.match(html, /<ul class="checklist">/);
  assert.match(html, /&lt;raw&gt;/);
  assert.match(html, /<th class="num">b<\/th>/);
});

test('a header-less column of status marks becomes a flag column', () => {
  const html = renderBlocks(parseBlocks('|  | Check |\n|---|---|\n| ✅ | TLS |\n| ⚠️ | CSP |\n'));
  assert.match(html, /<th class="flag"><\/th>/);
  assert.match(html, /<td class="flag"><span class="mk pass"/);
});

test('plain strips Markdown and emoji', () => {
  assert.equal(plain('### 🔴 **left-pad**@1.3.0 _(package)_'), '### left-pad@1.3.0 (package)');
});

test('headline: launch-audit, solution-health and security-audit figures', () => {
  const la = headline({ kind: 'launch-audit', target: null, md: sample('launch-audit') });
  assert.deepEqual(la.counts, { pass: 47, warn: 17, fail: 1, info: 54, skipped: 1 });
  assert.match(la.target, /ondigitalocean\.app/);
  const sh = headline({ kind: 'solution-health', target: 'shop-web', md: sample('solution-health') });
  assert.equal(sh.counts.red, 14);
  assert.equal(sh.counts.amber, 3);
  assert.match(sh.what, /^Action needed: left-pad@1\.3\.0/);
  const sa = headline({ kind: 'security-audit', target: null, md: SECURITY });
  assert.deepEqual(sa.counts, { blockers: 1, findings: 2 });
  assert.equal(sa.target, 'shop-web');
});

test('headline: seo-audit and eco-audit figures', () => {
  const seo = headline({ kind: 'seo-audit', target: null, md: sample('seo-audit') });
  assert.equal(typeof seo.counts.fail, 'number');
  assert.equal(typeof seo.counts.warn, 'number');
  assert.match(seo.what, /^\d+ pages crawled\.$/);
  const eco = headline({ kind: 'eco-audit', target: null, md: sample('eco-audit') });
  assert.equal(typeof eco.counts.warn, 'number');
  assert.match(eco.result, /^[\d.]+ g CO2e per view \(A\+\) · \d+ fail/);
  assert.match(eco.what, /^Start page [\d.]+ g CO2e per view, rating A\+\.$/);
});

test('headline: privacy-audit and infra-audit use the Result line', () => {
  for (const kind of ['privacy-audit', 'infra-audit']) {
    const md = `# X audit — shop.dk\n\n**Site:** https://shop.dk/  ·  **Date:** 2026-10-30\n\n**Result:** 9 pass · 3 warn · 1 fail · 3 info · 0 skipped\n\n## 1. Section\n`;
    const h = headline({ kind, target: null, md });
    assert.deepEqual(h.counts, { pass: 9, warn: 3, fail: 1, info: 3, skipped: 0 });
    assert.equal(h.target, 'shop.dk');
  }
});

test('parseSummary and parseAction', () => {
  const s = parseSummary(SUMMARY);
  assert.equal(s.meta.subject, 'shop.example.dk');
  assert.deepEqual(s.sections.map((x) => x.heading), ['Verdict', 'Fix first']);
  assert.deepEqual(parseAction('**Rotate the key** — still in history. [Blocker · Security, Launch]'),
    { title: 'Rotate the key', detail: 'still in history.', status: 'Blocker', sources: ['Security', 'Launch'] });
  assert.equal(parseAction('**Only a title**').status, null);
  assert.equal(statusClass('Blocker'), 'fail');
  assert.equal(statusClass('Amber'), 'warn');
  assert.equal(statusClass('Low'), 'info');
});

test('splitReport keeps the intro apart from the H2 sections', () => {
  const r = splitReport('# A\n\nintro\n\n## One\n\nx\n\n## Two\n\ny\n');
  assert.equal(r.title, 'A');
  assert.equal(r.intro.length, 1);
  assert.deepEqual(r.sections.map((s) => s.heading), ['One', 'Two']);
});

test('parseArgs: style, repos, flags', () => {
  const a = parseArgs(['/run', '--style', 'sans', '--repo', 'a', '--repo', 'b', '--no-pdf']);
  assert.deepEqual([a.dir, a.style, a.repos, a.pdf], ['/run', 'sans', ['a', 'b'], false]);
  assert.equal(parseArgs(['x', '--style=serif']).style, 'serif');
  assert.equal(parseArgs(['x', '--style', 'Modern']).style, 'sans');
  assert.equal(parseArgs(['x', '--style=editorial']).style, 'serif');
  assert.throws(() => parseArgs(['--style', 'comic']), /Unknown style/);
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
});

test('reportsRoot: AUDIT_OUT_DIR, then XDG download dir, then ~/Downloads, then ~/audit-reports', () => {
  const home = '/home/me';
  const has = (...dirs) => (p) => dirs.includes(p);
  assert.equal(reportsRoot({ env: { AUDIT_OUT_DIR: '~/reports' }, home, isDir: has() }), '/home/me/reports');
  assert.equal(reportsRoot({ env: {}, home, isDir: has('/home/me/Downloads'), readFile: () => null }), '/home/me/Downloads');
  assert.equal(reportsRoot({ env: {}, home, isDir: has('/home/me/Hentet', '/home/me/Downloads'), readFile: () => 'XDG_DOWNLOAD_DIR="$HOME/Hentet"\n' }), '/home/me/Hentet');
  assert.equal(reportsRoot({ env: {}, home, isDir: has(), readFile: () => null }), '/home/me/audit-reports');
  assert.equal(safeName('https://shop.example.dk/path?q'), 'shop.example.dk');
  assert.equal(safeName('my repo'), 'my-repo');
});

test('findChrome: explicit, CHROME_PATH, macOS app, PATH, Playwright, none', () => {
  const none = { env: { PATH: '/usr/bin' }, home: '/h', exists: () => false, list: () => [] };
  assert.equal(findChrome({ ...none, chromePath: '/x/chrome' }), '/x/chrome');
  assert.equal(findChrome({ ...none, env: { CHROME_PATH: '/c' }, exists: (p) => p === '/c' }), '/c');
  assert.equal(findChrome({ ...none, exists: (p) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(findChrome({ ...none, exists: (p) => p === '/usr/bin/chromium' }), '/usr/bin/chromium');
  const pw = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
  assert.equal(findChrome({ ...none, list: (r) => (r === '/opt/pw-browsers' ? ['chromium-1243', 'ffmpeg-1'] : []), exists: (p) => p === pw }), pw);
  assert.equal(findChrome(none), null);
  const args = buildPrintArgs('/r/report.html', '/r/report.pdf', { root: true });
  assert.ok(args.includes('--no-sandbox'));
  assert.ok(args.includes('--print-to-pdf=/r/report.pdf'));
  assert.equal(args.at(-1), 'file:///r/report.html');
  assert.equal(buildPrintArgs('/a.html', '/a.pdf', { root: false }).includes('--no-sandbox'), false);
});

test('combine: run folder -> report.md and report.html (no PDF), solution-health copied from --repo', async () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-all-test-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-web-'));
  try {
    fs.mkdirSync(path.join(run, 'launch-audit'));
    fs.writeFileSync(path.join(run, 'launch-audit', 'report.md'), sample('launch-audit'));
    fs.mkdirSync(path.join(run, 'security-audit-shop-web'));
    fs.writeFileSync(path.join(run, 'security-audit-shop-web', 'report.md'), SECURITY);
    fs.mkdirSync(path.join(repo, '.solution-health'));
    fs.writeFileSync(path.join(repo, '.solution-health', 'report.md'), sample('solution-health'));
    fs.writeFileSync(path.join(repo, '.solution-health', 'tasks.json'), '{"tasks":[]}');
    fs.writeFileSync(path.join(run, 'summary.md'), SUMMARY);
    const logs = [];
    const out = await combine({ dir: run, style: 'sans', repos: [repo], pdf: false }, { now: new Date('2026-10-30T09:00:00Z'), log: (m) => logs.push(m) });
    assert.deepEqual(out.reports, ['launch-audit', 'security-audit-shop-web', `solution-health-${path.basename(repo)}`]);
    assert.ok(fs.existsSync(path.join(run, `solution-health-${path.basename(repo)}`, 'tasks.json')), 'solution-health draft tasks copied too');
    const md = fs.readFileSync(out.md, 'utf8');
    assert.match(md, /^# Ready to launch, with two things to fix first/);
    assert.match(md, /## At a glance/);
    assert.match(md, /^## Launch audit — /m, 'report H1 demoted to H2');
    assert.match(md, /^### Scoreboard/m);
    const html = fs.readFileSync(out.html, 'utf8');
    assert.match(html, /<body class="style-sans">/);
    assert.match(html, /@font-face \{ font-family: "AA Plex Sans"/);
    assert.equal(html.includes('AA Newsreader"; src'), false, 'only the chosen style is embedded');
    assert.match(html, /<ol class="actions">/);
    assert.match(html, /<span class="st fail">Blocker<\/span>/);
    assert.equal((html.match(/<section class="audit"/g) || []).length, 3);
    assert.match(html, /<section class="toc" id="contents">/, 'more than one report: a contents page');
    assert.match(html, /<a href="#audit-2"><span class="no">2<\/span><span class="t">Security audit/);
    assert.match(html, /@bottom-right \{ font-family: "AA Plex Sans"/, 'page numbers and running header in the chosen typeface');
    assert.equal(out.pdf, null);
  } finally {
    fs.rmSync(run, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('combine: a run folder with no reports is an error', async () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-all-empty-'));
  try {
    await assert.rejects(combine({ dir: run, style: 'serif', repos: [], pdf: false }, { log: () => {} }), /No reports/);
  } finally {
    fs.rmSync(run, { recursive: true, force: true });
  }
});

test('solutionHealthReport: the report folder first, then an in-repo .solution-health', async () => {
  const { solutionHealthReport } = await import('../combine.mjs');
  const files = new Set(['/r/solution-health/shop-web/report.md', '/code/api/.solution-health/report.md']);
  const opts = { reports: '/r', readFile: () => null, exists: (f) => files.has(f) };
  assert.equal(solutionHealthReport('/code/shop-web', opts), '/r/solution-health/shop-web/report.md');
  assert.equal(solutionHealthReport('/code/api', opts), '/code/api/.solution-health/report.md');
  assert.equal(solutionHealthReport('/code/none', opts), null);
  const clash = solutionHealthReport('/other/shop-web', { reports: '/r', readFile: () => '/code/shop-web\n', exists: (f) => /shop-web-[0-9a-f]{8}\/report\.md$/.test(f) });
  assert.match(clash, /^\/r\/solution-health\/shop-web-[0-9a-f]{8}\/report\.md$/);
});

test('newRunFolder: one target folder per subject, runs under runs/, previous run found; notes.md is shown in the report', async () => {
  const { newRunFolder } = await import('../combine.mjs');
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-all-target-'));
  try {
    // An old-layout run folder is the previous run of the first new-layout run.
    const old = path.join(reports, 'audit-all', 'shop.example.dk-20261001-0900');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'summary.md'), '# old');
    const a = newRunFolder('https://shop.example.dk/', { reports, now: new Date(2026, 9, 30, 11, 12) });
    assert.equal(a.target, path.join(reports, 'audit-all', 'shop.example.dk'));
    assert.equal(a.dir, path.join(a.target, 'runs', '20261030-1112'));
    assert.ok(fs.existsSync(path.join(a.dir, '.audit-run')), 'run folders are marked');
    assert.equal(a.previous, old);
    const b = newRunFolder('shop.example.dk', { reports, now: new Date(2026, 9, 30, 11, 12) });
    assert.equal(b.dir, `${a.dir}-2`, 'same minute: a new folder, not the same one');
    assert.equal(b.previous, a.dir);

    fs.writeFileSync(path.join(a.target, 'notes.md'), '# Decisions\n\nCSP inline scripts accepted until the Nuxt 4 upgrade.\n');
    fs.mkdirSync(path.join(b.dir, 'launch-audit'));
    fs.writeFileSync(path.join(b.dir, 'launch-audit', 'report.md'), '# Launch audit — shop.example.dk\n\n## Scoreboard\n\nok\n');
    fs.writeFileSync(path.join(b.dir, 'summary.md'), '---\ntitle: Fine\n---\n\n## Verdict\n\nShip it.\n');
    const out = await combine({ dir: b.dir, style: 'serif', repos: [], pdf: false }, { log: () => {} });
    const md = fs.readFileSync(out.md, 'utf8');
    assert.match(md, /## Notes\n\n### Decisions\n\nCSP inline scripts accepted/);
  } finally {
    fs.rmSync(reports, { recursive: true, force: true });
  }
});

test('headline: a11y-audit figures and verdict', () => {
  const h = headline({ kind: 'a11y-audit', target: null, md: sample('a11y-audit') });
  assert.deepEqual(h.counts, { criteria: 7, issues: 7, review: 2, pages: 1 });
  assert.deepEqual(h.figures, [[7, 'criteria failed'], [7, 'issues']]);
  assert.match(h.what, /keyboard user can get stuck/);
  assert.equal(h.target, 'shop.example.dk');
});

test('discoverReports: a11y-audit sits after launch-audit', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-a11y-'));
  try {
    for (const [dir, md] of [['security-audit', SECURITY], ['a11y-audit', sample('a11y-audit')], ['launch-audit', sample('launch-audit')]]) {
      fs.mkdirSync(path.join(run, dir));
      fs.writeFileSync(path.join(run, dir, 'report.md'), md);
    }
    assert.deepEqual(discoverReports(run).map((r) => r.kind), ['launch-audit', 'a11y-audit', 'security-audit']);
  } finally { fs.rmSync(run, { recursive: true, force: true }); }
});

test('VERSION matches SKILL.md', () => {
  const skill = fs.readFileSync(path.join(HERE, '..', '..', 'SKILL.md'), 'utf8');
  assert.equal(VERSION, skill.match(/^\s+version:\s*"([\d.]+)"/m)[1]);
});

test('clipSentences: whole sentences, else a clause, never mid-word', () => {
  assert.equal(clipSentences('Short.'), 'Short.');
  assert.equal(clipSentences(`One. Two is here. ${'word '.repeat(40)}`, 60), 'One. Two is here.');
  assert.equal(clipSentences('Not ready to launch: two secrets are committed to the repository history, including a live SMTP password in appsettings.Production.json and more text after it.', 110), 'Not ready to launch: two secrets are committed to the repository history…');
  assert.match(clipSentences('a'.repeat(30) + ' ' + 'b'.repeat(200), 100), /^a{30}…$|…$/);
});

test('combinedHtml: one report has no contents page; a long cover is dense and its tiles clipped', () => {
  const security = { kind: 'security-audit', target: 'web', folder: 'security-audit-web', md: SECURITY.replace('1 blocker: a live Stripe key in git history.', `Not ready. ${'Very long verdict text. '.repeat(20)}`) };
  const args = { summary: parseSummary(SUMMARY), date: new Date('2026-10-30T09:00:00Z'), version: VERSION, css: '', style: 'serif' };
  const one = combinedHtml({ ...args, reports: [security], heads: [headline(security)] });
  assert.equal(one.includes('class="toc"'), false);
  const many = Array.from({ length: 7 }, () => security);
  const html = combinedHtml({ ...args, reports: many, heads: many.map(headline), pages: { summary: 3, 'audit-1': 4 } });
  assert.match(html, /<section class="cover dense">/);
  assert.match(html, /href="#summary">.*<span class="pg">3<\/span>/);
  assert.match(html, /href="#audit-1">.*<span class="pg">4<\/span>/);
  assert.equal(html.includes('Very long verdict text. Very long verdict text. Very long verdict text. Very long verdict text. Very long verdict text.'), true, 'the full verdict stays in the report');
  const tile = html.match(/<div class="what">([^<]*)<\/div>/)[1];
  assert.ok(tile.length <= 110 && /\.$/.test(tile), `tile ends on a sentence: ${tile}`);
});

test('pdfDestPages: named destinations mapped to page numbers through the page tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-all-pdf-'));
  try {
    const pdf = ['%PDF-1.4', '1 0 obj\n<</Type /Catalog /Pages 2 0 R /Dests 9 0 R>>\nendobj', '2 0 obj\n<</Type /Pages /Kids [3 0 R 4 0 R] /Count 3>>\nendobj',
      '3 0 obj\n<</Type /Page /Parent 2 0 R>>\nendobj', '4 0 obj\n<</Type /Pages /Kids [5 0 R 6 0 R]>>\nendobj', '5 0 obj\n<</Type /Page>>\nendobj', '6 0 obj\n<</Type /Page>>\nendobj',
      '9 0 obj\n<</summary [5 0 R /XYZ 6 777 0]\n/audit-1 [6 0 R /XYZ 6 777 0]>>\nendobj', '%%EOF'].join('\n');
    fs.writeFileSync(path.join(dir, 'a.pdf'), pdf);
    assert.deepEqual(pdfDestPages(path.join(dir, 'a.pdf')), { summary: 2, 'audit-1': 3 });
    assert.deepEqual(pdfDestPages(path.join(dir, 'missing.pdf')), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('siteMismatches: a site audit run on another domain than the subject is flagged', () => {
  const infra = { kind: 'infra-audit', target: null, folder: 'infra-audit', md: '# Infrastructure audit — helm-live.euwest01.umbraco.io\n\n**Result:** 3 pass · 2 warn · 0 fail\n' };
  const launch = { kind: 'launch-audit', target: null, folder: 'launch-audit', md: '# Launch audit — www.helmsecurity.ai\n\n**Result:** 3 pass · 0 warn · 0 fail\n' };
  const security = { kind: 'security-audit', target: 'helm', folder: 'security-audit-helm', md: SECURITY };
  const reports = [launch, infra, security];
  const heads = reports.map(headline);
  assert.deepEqual(siteMismatches(reports, heads, 'helmsecurity.ai').map((m) => [m.kind, m.target]), [['infra-audit', 'helm-live.euwest01.umbraco.io']]);
  assert.deepEqual(siteMismatches(reports, heads, 'Helm'), [], 'a subject that is not a host name is not compared');
  const html = combinedHtml({ summary: parseSummary(SUMMARY.replace('shop.example.dk', 'helmsecurity.ai')), reports, heads, date: new Date(), version: VERSION, css: '', style: 'sans' });
  assert.match(html, /class="mismatch">.*Infrastructure audit checked helm-live\.euwest01\.umbraco\.io, not helmsecurity\.ai/);
});
