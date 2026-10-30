import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perView, rating, gridIntensity, formatMass } from '../lib/co2.mjs';
import { kindOf, isFirstParty, summarisePage, runChecks, MB, KB } from '../lib/checks.mjs';
import { staticAssets, cssAssets } from '../lib/static.mjs';
import { renderMarkdown, findings, resultLine } from '../lib/report.mjs';
import { parseCli, resolveOut } from '../lib/cli.mjs';
import { findChrome } from '../lib/browser.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('perView follows SWDM v4: 0.3 kWh/GB at 494 g/kWh, green removes data-centre operational', () => {
  const r = perView(1e9);
  close(r.kWh, 0.3);
  close(r.grams, 0.3 * 494);
  const g = perView(1e9, { green: true });
  close(r.grams - g.grams, 0.055 * 494);
  const dk = perView(1e9, { deviceGrid: 143.3, networkGrid: 143.3 });
  close(dk.grams, (0.055 * 494) + (0.059 + 0.080) * 143.3 + (0.012 + 0.013 + 0.081) * 494);
  assert.equal(perView(0).grams, 0);
});

test('rating thresholds and grid lookups', () => {
  assert.equal(rating(0.04), 'A+');
  assert.equal(rating(0.0401), 'A');
  assert.equal(rating(0.2), 'C');
  assert.equal(rating(0.36), 'F');
  assert.equal(gridIntensity('DK'), gridIntensity('dnk'));
  assert.ok(gridIntensity('DK') > 0 && gridIntensity('DK') < 494);
  assert.equal(gridIntensity('XX'), null);
  assert.equal(formatMass(2480), '2.5 kg');
});

test('kindOf and isFirstParty', () => {
  assert.equal(kindOf({ type: 'Other', mimeType: 'font/woff2', url: 'https://x/a' }), 'font');
  assert.equal(kindOf({ type: 'Fetch', mimeType: 'video/mp4', url: 'https://x/a.mp4' }), 'media');
  assert.equal(kindOf({ type: 'Script', mimeType: '', url: 'https://x/a.js' }), 'js');
  assert.equal(isFirstParty('https://cdn.example.dk/a.png', 'www.example.dk'), true);
  assert.equal(isFirstParty('https://example.dk/a.png', 'www.example.dk'), true);
  assert.equal(isFirstParty('https://www.googletagmanager.com/gtm.js', 'www.example.dk'), false);
});

test('staticAssets skips lazy images; cssAssets takes the first font url and @imports', () => {
  const a = staticAssets('<link rel=stylesheet href="/s.css"><script src="/a.js"></script><img src="/hero.jpg"><img loading="lazy" src="/low.jpg"><video autoplay src="/bg.mp4" poster="/p.jpg"></video><link rel="preload" as="font" href="/f.woff2">', 'https://x.dk/');
  assert.deepEqual(a.map((x) => `${x.type} ${new URL(x.url).pathname}`), ['Stylesheet /s.css', 'Script /a.js', 'Image /hero.jpg', 'Media /bg.mp4', 'Font /f.woff2']);
  const c = cssAssets('@import url("/more.css"); @font-face { font-family: X; src: url(/f.woff2) format("woff2"), url(/f.woff) format("woff"); } @font-face{src:url(data:font/woff2;base64,AA)}', 'https://x.dk/s.css');
  assert.deepEqual(c.map((x) => new URL(x.url).pathname), ['/more.css', '/f.woff2']);
});

const req = (url, type, transfer, extra = {}) => ({ url, type, status: 200, mimeType: extra.mimeType || '', transfer, size: extra.size ?? transfer * 3, encoding: 'br', cacheControl: 'max-age=31536000', lazy: false, ...extra });
function heavyPage() {
  return {
    ok: true, url: 'https://www.example.dk/', finalUrl: 'https://www.example.dk/', status: 200,
    requests: [
      req('https://www.example.dk/', 'Document', 40 * KB, { mimeType: 'text/html' }),
      req('https://www.example.dk/app.js', 'Script', 700 * KB, { mimeType: 'application/javascript' }),
      req('https://www.example.dk/hero.jpg', 'Image', 900 * KB, { mimeType: 'image/jpeg' }),
      req('https://www.example.dk/below.jpg', 'Image', 300 * KB, { mimeType: 'image/jpeg' }),
      req('https://www.example.dk/bg.mp4', 'Media', 5 * MB, { mimeType: 'video/mp4' }),
      req('https://www.example.dk/f.ttf', 'Font', 200 * KB, { mimeType: 'font/ttf' }),
      req('https://www.example.dk/data.json', 'Fetch', 20 * KB, { mimeType: 'application/json', encoding: null, size: 20 * KB }),
      req('https://www.googletagmanager.com/gtm.js', 'Script', 150 * KB, { mimeType: 'application/javascript', cacheControl: 'max-age=900' }),
      req('https://www.example.dk/late.jpg', 'Image', 400 * KB, { mimeType: 'image/jpeg', lazy: true }),
    ],
    images: [
      { src: 'https://www.example.dk/hero.jpg', nw: 4000, nh: 2000, w: 1200, h: 600, top: 0, loading: null, offscreen: false },
      { src: 'https://www.example.dk/below.jpg', nw: 800, nh: 600, w: 800, h: 600, top: 3000, loading: null, offscreen: true },
    ],
    viewport: { dpr: 1 },
  };
}

test('runChecks flags video, weight, formats, oversized and eager images, TTF fonts, compression', () => {
  const m = heavyPage();
  m.initialBytes = m.requests.filter((r) => !r.lazy).reduce((a, r) => a + r.transfer, 0);
  m.afterScrollBytes = m.initialBytes + 400 * KB;
  const s = summarisePage(m, { siteHost: 'www.example.dk' });
  assert.equal(s.by.media, 5 * MB);
  assert.equal(s.third, 150 * KB);
  const rows = runChecks({ siteHost: 'www.example.dk', pages: [m], summaries: [s], green: { green: false } });
  const st = (id) => rows.find((r) => r.id === id)?.status;
  assert.equal(st('eco.video'), 'fail');
  assert.equal(st('eco.page-weight'), 'fail');
  assert.equal(st('eco.rating'), 'fail');
  assert.equal(st('eco.image-oversized'), 'info');
  assert.equal(rows.find((r) => r.id === 'eco.image-lazy').items[0].url, 'https://www.example.dk/below.jpg');
  assert.equal(st('eco.font-format'), 'warn');
  assert.equal(st('eco.javascript'), 'warn');
  assert.equal(st('eco.compression'), 'warn');
  assert.equal(st('eco.green-hosting'), 'warn');
  assert.match(rows.find((r) => r.id === 'eco.lazy-savings').evidence, /400 kB/);

  const report = { version: '1.0.0', date: '2026-10-30', site: { finalUrl: m.url, host: 'www.example.dk' }, estimate: false, viewport: 'desktop viewport 1366×900', grid: {}, green: { green: false }, views: 50000, median: { bytes: s.bytes, grams: s.grams, rating: s.rating }, pages: [s], failed: [], rows };
  const md = renderMarkdown(report);
  assert.match(md, /^# Eco audit — www\.example\.dk/);
  assert.match(md, /\*\*Result:\*\* \d+ fail, \d+ warn, \d+ pass, \d+ info, \d+ skipped · start page [\d.]+ g CO2e/);
  assert.match(md, /CO2e a year/);
  assert.match(resultLine(report), /rating F/);
  const f = findings(report);
  assert.equal(f.findings[0].severity, 'high');
  assert.equal(f.findings.find((x) => x.check === 'eco.green-hosting').owner, 'human');
});

test('parseCli and resolveOut', () => {
  const p = parseCli(['example.dk', 'https://example.dk/om', '--grid', 'DK', '--views', '120,000']);
  assert.ok(p.ok, p.error);
  assert.equal(p.opts.url, 'https://example.dk/');
  assert.deepEqual(p.opts.extraUrls, ['https://example.dk/om']);
  assert.equal(p.opts.grid.code, 'DK');
  assert.equal(p.opts.views, 120000);
  assert.equal(parseCli(['x.dk', '--grid', 'Mars']).ok, false);
  assert.match(resolveOut({ host: 'x.dk' }, { root: '/r', now: new Date(2026, 9, 30, 9, 27) }), /\/r\/eco-audit\/x\.dk\/runs\/20261030-0927$/);
  assert.match(resolveOut({ host: 'x.dk' }, { state: '/s', now: new Date(2026, 9, 30, 9, 27), exists: (d) => d === '/s/runs/20261030-0927' }), /\/s\/runs\/20261030-0927-2$/);
  assert.equal(resolveOut({ out: '/tmp/x' }), '/tmp/x');
});

test('findChrome honours --chrome and CHROME_PATH', () => {
  assert.equal(findChrome({ chromePath: '/c' }), '/c');
  assert.equal(findChrome({ env: { CHROME_PATH: '/x/chrome' }, exists: (p) => p === '/x/chrome', list: () => [] }), '/x/chrome');
  assert.equal(findChrome({ env: {}, home: '/h', exists: () => false, list: () => [] }), null);
});
