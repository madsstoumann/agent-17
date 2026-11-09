import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBlocks, renderBlocks, inline, plain } from '../lib/markdown.mjs';
import { discoverReports, headline, kindOf, parseSummary, parseAction, statusClass, splitReport, clipSentences, combinedHtml, siteMismatches } from '../lib/report.mjs';
import { findChrome, buildPrintArgs, pdfDestPages } from '../lib/pdf.mjs';
import { parseArgs, reportsRoot, safeName, combine, VERSION } from '../combine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(HERE, '..', '..', '..');
const sample = (skill) => fs.readFileSync(path.join(SKILLS, skill, 'references', 'sample-report.md'), 'utf8');

const SECURITY = `# Security audit: shop-web

2026-10-30 · code mode · audit-security 1.1.0

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

test('headline: audit-launch, audit-solution-health and audit-security figures', () => {
  const la = headline({ kind: 'audit-launch', target: null, md: sample('audit-launch') });
  assert.deepEqual(la.counts, { pass: 48, warn: 17, fail: 1, info: 53, skipped: 1 });
  assert.match(la.target, /ondigitalocean\.app/);
  const sh = headline({ kind: 'audit-solution-health', target: 'shop-web', md: sample('audit-solution-health') });
  assert.equal(sh.counts.red, 14);
  assert.equal(sh.counts.amber, 3);
  assert.match(sh.what, /^Action needed: left-pad@1\.3\.0/);
  const sa = headline({ kind: 'audit-security', target: null, md: SECURITY });
  assert.deepEqual(sa.counts, { blockers: 1, findings: 2 });
  assert.equal(sa.target, 'shop-web');
});

test('headline: audit-seo and audit-eco figures', () => {
  const seo = headline({ kind: 'audit-seo', target: null, md: sample('audit-seo') });
  assert.equal(typeof seo.counts.fail, 'number');
  assert.equal(typeof seo.counts.warn, 'number');
  assert.match(seo.what, /^\d+ pages crawled\. GEO readiness \d+\/100\.$/);
  assert.equal(typeof seo.geo, 'number');
  const eco = headline({ kind: 'audit-eco', target: null, md: sample('audit-eco') });
  assert.equal(typeof eco.counts.warn, 'number');
  assert.match(eco.result, /^[\d.]+ g CO2e per view \(A\+\) · \d+ fail/);
  assert.match(eco.what, /^Start page [\d.]+ g CO2e per view, rating A\+\.$/);
});

test('headline: audit-privacy and audit-infra use the Result line', () => {
  for (const kind of ['audit-privacy', 'audit-infra']) {
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

test('combine: run folder -> report.md and report.html (no PDF), audit-solution-health copied from --repo', async () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-all-test-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-web-'));
  try {
    fs.mkdirSync(path.join(run, 'audit-launch'));
    fs.writeFileSync(path.join(run, 'audit-launch', 'report.md'), sample('audit-launch'));
    fs.mkdirSync(path.join(run, 'audit-security-shop-web'));
    fs.writeFileSync(path.join(run, 'audit-security-shop-web', 'report.md'), SECURITY);
    fs.mkdirSync(path.join(repo, '.audit-solution-health'));
    fs.writeFileSync(path.join(repo, '.audit-solution-health', 'report.md'), sample('audit-solution-health'));
    fs.writeFileSync(path.join(repo, '.audit-solution-health', 'tasks.json'), '{"tasks":[]}');
    fs.writeFileSync(path.join(run, 'summary.md'), SUMMARY);
    const logs = [];
    const out = await combine({ dir: run, style: 'sans', repos: [repo], pdf: false }, { now: new Date('2026-10-30T09:00:00Z'), log: (m) => logs.push(m) });
    assert.deepEqual(out.reports, ['audit-launch', 'audit-security-shop-web', `audit-solution-health-${path.basename(repo)}`]);
    assert.ok(fs.existsSync(path.join(run, `audit-solution-health-${path.basename(repo)}`, 'tasks.json')), 'audit-solution-health draft tasks copied too');
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

test('solutionHealthReport: the report folder first, then an in-repo .audit-solution-health', async () => {
  const { solutionHealthReport } = await import('../combine.mjs');
  const files = new Set(['/r/audit-solution-health/shop-web/report.md', '/code/api/.audit-solution-health/report.md']);
  const opts = { reports: '/r', readFile: () => null, exists: (f) => files.has(f) };
  assert.equal(solutionHealthReport('/code/shop-web', opts), '/r/audit-solution-health/shop-web/report.md');
  assert.equal(solutionHealthReport('/code/api', opts), '/code/api/.audit-solution-health/report.md');
  assert.equal(solutionHealthReport('/code/none', opts), null);
  const clash = solutionHealthReport('/other/shop-web', { reports: '/r', readFile: () => '/code/shop-web\n', exists: (f) => /shop-web-[0-9a-f]{8}\/report\.md$/.test(f) });
  assert.match(clash, /^\/r\/audit-solution-health\/shop-web-[0-9a-f]{8}\/report\.md$/);
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
    fs.mkdirSync(path.join(b.dir, 'audit-launch'));
    fs.writeFileSync(path.join(b.dir, 'audit-launch', 'report.md'), '# Launch audit — shop.example.dk\n\n## Scoreboard\n\nok\n');
    fs.writeFileSync(path.join(b.dir, 'summary.md'), '---\ntitle: Fine\n---\n\n## Verdict\n\nShip it.\n');
    const out = await combine({ dir: b.dir, style: 'serif', repos: [], pdf: false }, { log: () => {} });
    const md = fs.readFileSync(out.md, 'utf8');
    assert.match(md, /## Notes\n\n### Decisions\n\nCSP inline scripts accepted/);
  } finally {
    fs.rmSync(reports, { recursive: true, force: true });
  }
});

test('headline: audit-a11y figures and verdict', () => {
  const h = headline({ kind: 'audit-a11y', target: null, md: sample('audit-a11y') });
  assert.deepEqual(h.counts, { criteria: 7, issues: 7, review: 2, pages: 1 });
  assert.deepEqual(h.figures, [[7, 'criteria failed'], [7, 'issues']]);
  assert.match(h.what, /keyboard user can get stuck/);
  assert.equal(h.target, 'shop.example.dk');
});

test('discoverReports: audit-a11y sits after audit-launch', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-a11y-'));
  try {
    for (const [dir, md] of [['audit-security', SECURITY], ['audit-a11y', sample('audit-a11y')], ['audit-launch', sample('audit-launch')]]) {
      fs.mkdirSync(path.join(run, dir));
      fs.writeFileSync(path.join(run, dir, 'report.md'), md);
    }
    assert.deepEqual(discoverReports(run).map((r) => r.kind), ['audit-launch', 'audit-a11y', 'audit-security']);
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
  const security = { kind: 'audit-security', target: 'web', folder: 'audit-security-web', md: SECURITY.replace('1 blocker: a live Stripe key in git history.', `Not ready. ${'Very long verdict text. '.repeat(20)}`) };
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
  const infra = { kind: 'audit-infra', target: null, folder: 'audit-infra', md: '# Infrastructure audit — example-live.euwest01.umbraco.io\n\n**Result:** 3 pass · 2 warn · 0 fail\n' };
  const launch = { kind: 'audit-launch', target: null, folder: 'audit-launch', md: '# Launch audit — www.example.org\n\n**Result:** 3 pass · 0 warn · 0 fail\n' };
  const security = { kind: 'audit-security', target: 'helm', folder: 'audit-security-helm', md: SECURITY };
  const reports = [launch, infra, security];
  const heads = reports.map(headline);
  assert.deepEqual(siteMismatches(reports, heads, 'example.org').map((m) => [m.kind, m.target]), [['audit-infra', 'example-live.euwest01.umbraco.io']]);
  assert.deepEqual(siteMismatches(reports, heads, 'Helm'), [], 'a subject that is not a host name is not compared');
  const html = combinedHtml({ summary: parseSummary(SUMMARY.replace('shop.example.dk', 'example.org')), reports, heads, date: new Date(), version: VERSION, css: '', style: 'sans' });
  assert.match(html, /class="mismatch">.*Infrastructure audit checked example-live\.euwest01\.umbraco\.io, not example\.org/);
});

test('Built with: check-tech-stack results on the cover and under the title', async () => {
  const { readStack, builtWith } = await import('../lib/stack.mjs');
  const { combinedMarkdown } = await import('../lib/report.mjs');
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-stack-'));
  fs.mkdirSync(path.join(run, 'check-tech-stack'));
  const t = (name, category, version = null, confidence = 'detected') => ({ name, category, version, confidence });
  fs.writeFileSync(path.join(run, 'check-tech-stack', 'results.json'), JSON.stringify({ results: [
    { url: 'https://shop.example.dk/', finalUrl: 'https://shop.example.dk/', technologies: [t('jQuery', 'js-library', '3.7.1'), t('Cloudflare', 'cdn'), t('Umbraco', 'cms', '13.2'), t('Next.js', 'meta-framework', '15.0.0'), t('Hotjar', 'analytics', null, 'possible')] },
    { url: 'https://blocked.example/', challenge: 'Cloudflare challenge', technologies: [t('Cloudflare', 'cdn')] },
  ] }));
  assert.deepEqual(builtWith({ technologies: [t('A', 'cdn'), t('B', 'cms')] }), ['B', 'A']);
  const stack = readStack(run);
  assert.deepEqual(stack, [{ host: 'shop.example.dk', items: ['Umbraco 13.2', 'Next.js 15.0.0', 'Cloudflare'] }]);
  const security = { kind: 'audit-security', folder: 'audit-security', target: null, md: '# Security audit\n\nResult: ok\n' };
  const args = { summary: parseSummary('---\nsubject: shop.example.dk\n---\n'), reports: [security], heads: [headline(security)], date: new Date('2026-11-01'), version: 'x', css: '', style: 'serif', stack };
  assert.match(combinedHtml(args), /<p class="stack"><span class="label">Built with<\/span><span class="line">Umbraco 13\.2 · Next\.js 15\.0\.0 · Cloudflare<\/span><\/p>/);
  assert.match(combinedMarkdown(args), /\nBuilt with: Umbraco 13\.2 · Next\.js 15\.0\.0 · Cloudflare\n/);
  assert.doesNotMatch(combinedHtml({ ...args, stack: [] }), /class="stack"/);
});

test('<details>/<summary> from the sub-audits render as an open block, not as escaped text (example.dk, example.com)', () => {
  const md = ['## Cookies', '', '<details>', '<summary>Cookies before any choice (13)</summary>', '', '| Name | Domain |', '|---|---|', '| _ga | .example.dk |', '', '</details>', '',
    '<details><summary>2 packages with updates available</summary>', '', '- npm a: 1.0 → 2.0', '', '</details>', '', 'After.'].join('\n');
  const blocks = parseBlocks(md);
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'details', 'details', 'para']);
  assert.equal(blocks[1].summary, 'Cookies before any choice (13)');
  assert.equal(blocks[1].blocks[0].type, 'table');
  const html = renderBlocks(blocks);
  assert.match(html, /<details open><summary>Cookies before any choice \(13\)<\/summary>/);
  assert.match(html, /<td>_ga<\/td>/);
  assert.match(html, /<details open><summary>2 packages with updates available<\/summary>\n<ul>/);
  assert.doesNotMatch(html, /&lt;details|&lt;summary/);
  // Other raw HTML is still escaped.
  assert.match(renderBlocks(parseBlocks('<script>x</script>')), /&lt;script&gt;/);
});

test('kindOf: audit-seo run with --geo is titled GEO audit', () => {
  const md = sample('audit-seo');
  assert.equal(kindOf({ kind: 'audit-seo', md }).title, 'SEO / GEO audit');
  assert.equal(kindOf({ kind: 'audit-seo', md: md.replace(/^# SEO audit/, '# GEO audit') }).title, 'GEO audit');
  assert.equal(kindOf({ kind: 'audit-eco', md: '# GEO audit — x' }).title, 'Sustainability audit');
});

const SECURITY_SITE = `# Security audit (site) — www.example.com

**Site:** https://www.example.com/  ·  **Environment:** production  ·  **Date:** 2026-11-09 15:08 UTC  ·  **Tool:** audit-security 2.2.0 (site mode)

**Result:** 14 pass · 4 warn · 1 fail · 3 info · 4 skipped

## Fix first

- ❌ **Content-Security-Policy** — missing → Add one.

## Security headers

| | Check | Evidence | Fix |
|---|---|---|---|
| ❌ | Content-Security-Policy | missing | Add one. |
| ✅ | HSTS | max-age=63072000 |  |
`;

test('audit-security on a URL: its own title, standfirst and at-a-glance row beside the code scan', () => {
  const code = { kind: 'audit-security', target: 'shop-web', folder: 'audit-security-shop-web', md: SECURITY };
  const site = { kind: 'audit-security', target: 'www.example.com', folder: 'audit-security-www.example.com', md: SECURITY_SITE };
  assert.equal(kindOf(code).title, 'Security audit');
  assert.match(kindOf(code).standfirst, /^The repository/);
  assert.equal(kindOf(site).title, 'Security audit (site)');
  assert.doesNotMatch(kindOf(site).standfirst, /repository|git history/);
  assert.match(kindOf(site).standfirst, /frame-ancestors/);
  const h = headline(site);
  assert.deepEqual(h.counts, { pass: 14, warn: 4, fail: 1, info: 3, skipped: 4 });
  assert.deepEqual(h.figures, [[1, 'fail'], [4, 'warn']]);
  assert.equal(h.what, '14 checks passed on https://www.example.com/.');
  assert.equal(headline({ ...site, md: SECURITY_SITE.replace('\n\n**Result:**', '\n\n**Verdict:** Fix the CSP before launch.\n\n**Result:**') }).what, 'Fix the CSP before launch.');
  const reports = [code, site];
  const args = { summary: parseSummary(SUMMARY), date: new Date('2026-11-09T09:00:00Z'), version: VERSION, css: '', style: 'serif' };
  const html = combinedHtml({ ...args, reports, heads: reports.map(headline) });
  assert.match(html, /<table class="glance">[\s\S]*<td>Security audit<span class="sub mono">shop-web<\/span>[\s\S]*<td>Security audit \(site\)<span class="sub mono">www.example.com<\/span><\/td><td>14 pass · 4 warn · 1 fail · 3 info · 4 skipped<\/td>/);
  assert.match(html, /<div class="label">Security audit \(site\) · <span class="mono">www.example.com<\/span><\/div><div class="n">1 <small>fail<\/small> 4 <small>warn<\/small><\/div>/, 'its own tile on the cover');
  assert.match(html, /<h2>Security audit \(site\) <span class="target mono">www.example.com<\/span><\/h2><p class="standfirst">The live site checked from outside/);
  // A site security scan of another domain is flagged like the other site audits.
  assert.equal(siteMismatches([site], [headline(site)], 'example.dk').length, 1);
  assert.equal(siteMismatches([code], [headline(code)], 'example.dk').length, 0);
});
