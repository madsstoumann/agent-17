import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  blockedStatus,
  SEO_NOINDEX_AUDITS, compareVersions, findChrome, checkLocalLighthouse, buildLighthouseArgs,
  runLighthouseLocal, runPsi, summariseLhr, pickPerfPages, cwvRating, scoreVerdict,
} from '../lib/lighthouse.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/lighthouse/${name}`, import.meta.url), 'utf8');
const lhr13 = JSON.parse(fixture('lhr-13.json'));      // real Lighthouse 13.5.0 run on https://browser.style/, trimmed
const psi = JSON.parse(fixture('lhr-psi.json'));       // hand-written older-style PageSpeed Insights body
const urls = fixture('urls.txt').split('\n').filter(Boolean);

// ---------------------------------------------------------------- pure helpers

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('22.19.0', '22.19.0'), 0);
  assert.equal(compareVersions('22.18.0', '22.19.0'), -1);
  assert.equal(compareVersions('25.2.1', '22.19.0'), 1);
  assert.equal(compareVersions('22.19', '22.19.0'), 0, 'a missing segment is 0');
  assert.equal(compareVersions('v22.19.1', '22.19.0'), 1, 'a leading v is ignored');
  assert.equal(compareVersions('22.9.0', '22.19.0'), -1, 'numeric, not lexical');
  assert.equal(compareVersions('23.0.0-nightly', '22.19.0'), 1);
});

test('cwvRating applies the Core Web Vitals thresholds', () => {
  assert.equal(cwvRating('LCP', 2500), 'pass');
  assert.equal(cwvRating('LCP', 2501), 'warn');
  assert.equal(cwvRating('LCP', 4001), 'fail');
  assert.equal(cwvRating('CLS', 0.1), 'pass');
  assert.equal(cwvRating('CLS', 0.2), 'warn');
  assert.equal(cwvRating('CLS', 0.3), 'fail');
  assert.equal(cwvRating('TBT', 200), 'pass');
  assert.equal(cwvRating('TBT', 601), 'fail');
  assert.equal(cwvRating('FCP', 1800), 'pass');
  assert.equal(cwvRating('FCP', 3000), 'warn');
  assert.equal(cwvRating('SI', 3400), 'pass');
  assert.equal(cwvRating('SI', 5801), 'fail');
  assert.equal(cwvRating('INP', 200), 'pass');
  assert.equal(cwvRating('INP', 500), 'warn');
  assert.equal(cwvRating('TTFB', 800), 'pass');
  assert.equal(cwvRating('TTFB', 1801), 'fail');
  assert.equal(cwvRating('lcp', 1000), 'pass', 'metric name is case-insensitive');
  assert.equal(cwvRating('LCP', null), null);
  assert.equal(cwvRating('LCP', NaN), null);
  assert.equal(cwvRating('XYZ', 1), null);
});

test('scoreVerdict maps a 0-100 score to pass/warn/fail', () => {
  assert.equal(scoreVerdict(100), 'pass');
  assert.equal(scoreVerdict(90), 'pass');
  assert.equal(scoreVerdict(89), 'warn');
  assert.equal(scoreVerdict(50), 'warn');
  assert.equal(scoreVerdict(49), 'fail');
  assert.equal(scoreVerdict(0), 'fail');
  assert.equal(scoreVerdict(null), null);
  assert.equal(scoreVerdict(undefined), null);
});

// ---------------------------------------------------------------- local Lighthouse plumbing

test('buildLighthouseArgs produces the exact mobile argv', () => {
  assert.deepEqual(buildLighthouseArgs({ url: 'https://browser.style/', file: '/tmp/out.json', root: false }), [
    'https://browser.style/',
    '--output=json',
    '--output-path=/tmp/out.json',
    '--chrome-flags=--headless=new',
    '--quiet',
    '--disable-full-page-screenshot',
    '--max-wait-for-load=45000',
    '--extra-headers={"X-Audit":"launch-audit/1.0"}',
  ]);
});

test('buildLighthouseArgs merges --header values into --extra-headers', () => {
  const args = buildLighthouseArgs({ url: 'https://a.dk/', file: '/tmp/o.json', headers: { 'x-bypass': 's3cret' } });
  assert.ok(args.includes('--extra-headers={"X-Audit":"launch-audit/1.0","x-bypass":"s3cret"}'));
});

test('buildLighthouseArgs adds --no-sandbox when running as root', () => {
  assert.ok(buildLighthouseArgs({ url: 'https://a.dk/', file: '/tmp/o.json', root: true }).includes('--chrome-flags=--headless=new --no-sandbox'));
});

test('blockedStatus reads a WAF status from the runtime error or the main document', () => {
  assert.equal(blockedStatus({ error: 'runtime error ERRORED_DOCUMENT_REQUEST: Lighthouse was unable to reliably load the page you requested. (Status code: 429)' }), 429);
  assert.equal(blockedStatus({ lhr: { runtimeError: { message: '(Status code: 403)' } } }), 403);
  assert.equal(blockedStatus({ lhr: { audits: { 'network-requests': { details: { items: [{ resourceType: 'Document', statusCode: 503 }] } } } } }), 503);
  assert.equal(blockedStatus({ error: '(Status code: 404)' }), null);
  assert.equal(blockedStatus({ lhr: { audits: { 'network-requests': { details: { items: [{ resourceType: 'Document', statusCode: 200 }] } } } } }), null);
  assert.equal(blockedStatus({}), null);
});

test('buildLighthouseArgs adds the desktop preset and the insecure chrome flag, never --only-categories', () => {
  const args = buildLighthouseArgs({ url: 'https://dev.example.com/', file: '/tmp/d.json', desktop: true, insecure: true, root: false });
  assert.equal(args.at(-1), '--preset=desktop');
  assert.ok(args.includes('--chrome-flags=--headless=new --ignore-certificate-errors'));
  assert.ok(!args.some((a) => a.startsWith('--only-categories')), 'all five categories must run');
  const mobile = buildLighthouseArgs({ url: 'https://dev.example.com/', file: '/tmp/m.json' });
  assert.ok(!mobile.includes('--preset=desktop'));
  assert.ok(!mobile.some((a) => a.includes('--ignore-certificate-errors')));
  assert.throws(() => buildLighthouseArgs({ url: 'https://x/' }), TypeError);
  assert.throws(() => buildLighthouseArgs({ file: '/tmp/x.json' }), TypeError);
});

test('checkLocalLighthouse needs Node 22.19 and a Chrome, and points at PSI_API_KEY', () => {
  const old = checkLocalLighthouse({ nodeVersion: '22.18.0', chromePath: '/opt/chrome' });
  assert.equal(old.ok, false);
  assert.equal(old.nodeOk, false);
  assert.equal(old.chrome, '/opt/chrome');
  assert.match(old.reason, /22\.19/);
  assert.match(old.reason, /PSI_API_KEY/);

  assert.deepEqual(checkLocalLighthouse({ nodeVersion: '25.2.1', chromePath: '/opt/chrome' }), { ok: true, nodeOk: true, chrome: '/opt/chrome', reason: null });
  assert.equal(checkLocalLighthouse({ nodeVersion: '22.19.0', chromePath: '/opt/chrome' }).ok, true, '22.19.0 is the floor');

  const noChrome = checkLocalLighthouse({ nodeVersion: '25.2.1', chromePath: null });
  assert.equal(noChrome.ok, false);
  assert.equal(noChrome.nodeOk, true);
  assert.equal(noChrome.chrome, null);
  assert.match(noChrome.reason, /Chrome/);
  assert.match(noChrome.reason, /CHROME_PATH/);
  assert.match(noChrome.reason, /PSI_API_KEY/);
});

test('findChrome honours CHROME_PATH when it exists and never returns a path that does not', () => {
  assert.equal(findChrome({ env: { CHROME_PATH: process.execPath } }), process.execPath);
  const found = findChrome({ env: { CHROME_PATH: '/nope/chrome', PATH: '/nonexistent', HOME: '/nonexistent' } });
  assert.ok(found === null || (isAbsolute(found) && existsSync(found)), `got ${found}`);
});

test('runLighthouseLocal refuses without url and file, without running anything', async () => {
  const r = await runLighthouseLocal({ url: 'https://example.com/' });
  assert.equal(r.ok, false);
  assert.equal(r.lhr, null);
  assert.equal(r.version, null);
  assert.equal(r.stderrTail, '');
  assert.match(r.error, /url and file/);
  assert.equal((await runLighthouseLocal({})).ok, false);
});

// ---------------------------------------------------------------- summariseLhr: the real Lighthouse 13 report

test('summariseLhr on the real Lighthouse 13 report: scores, agentic fraction, metrics', () => {
  const s = summariseLhr(lhr13);
  assert.equal(s.source, 'local');
  assert.equal(s.strategy, 'mobile');
  assert.equal(s.version, '13.5.0');
  assert.equal(s.finalUrl, 'https://browser.style/');
  assert.equal(s.fetchTime, '2026-09-24T07:27:12.505Z');
  assert.deepEqual(s.scores, { performance: 100, accessibility: 90, bestPractices: 81, seo: 100 });

  // agentic-browsing: 7 refs; only agent-accessibility-tree (binary) and cumulative-layout-shift (numeric) count
  assert.equal(s.agentic.passed, 2);
  assert.equal(s.agentic.total, 2);
  assert.deepEqual(Object.keys(s.agentic.audits).sort(), [
    'agent-accessibility-tree', 'ard-schema', 'cumulative-layout-shift', 'llms-txt',
    'webmcp-form-coverage', 'webmcp-registered-tools', 'webmcp-schema-validity',
  ]);
  assert.deepEqual(s.agentic.audits['agent-accessibility-tree'], { score: 1, mode: 'binary', displayValue: 'All audits passed', title: 'Accessibility tree is well-formed' });
  assert.deepEqual(s.agentic.audits['llms-txt'], { score: null, mode: 'notApplicable', displayValue: null, title: 'llms.txt follows recommendations' });

  // Lighthouse puts a no-break space (U+00A0) between a number and its unit; displayValue is passed through verbatim.
  assert.deepEqual(s.metrics.LCP, { value: 1091.046, display: '1.1\u00a0s' });
  assert.deepEqual(s.metrics.CLS, { value: 0, display: '0' });
  assert.deepEqual(s.metrics.TBT, { value: 64, display: '60\u00a0ms' });
  assert.deepEqual(s.metrics.FCP, { value: 827.046, display: '0.8\u00a0s' });
  assert.equal(Math.round(s.metrics.SI.value), 1636);
  assert.equal(s.metrics.SI.display, '1.6\u00a0s');
  assert.deepEqual(s.metrics.TTFB, { value: 11, display: 'Root document took 10\u00a0ms' });
  assert.deepEqual(s.metrics.INP, { value: null, display: null }, 'a lab run has no interaction-to-next-paint audit');
  assert.equal(s.field, null, 'no field data without a loadingExperience');
});

test('summariseLhr on the real report: LH 13 insight opportunities, third parties, requests, protocols', () => {
  const s = summariseLhr(lhr13);
  // The page is fast: the two scored-below-1 insights carry 0 ms of savings, so the tie breaks on id.
  assert.deepEqual(s.opportunities.map((o) => o.id), ['cache-insight', 'render-blocking-insight']);
  assert.deepEqual(s.opportunities[0], { id: 'cache-insight', title: lhr13.audits['cache-insight'].title, displayValue: 'Est savings of 8\u00a0KiB', savingsMs: 0, score: 0.5 });
  assert.equal(s.opportunities[1].savingsMs, 0);
  assert.equal(s.opportunities[1].score, 0.5);
  assert.deepEqual(s.thirdParties, [], 'third-parties-insight has no items on browser.style');
  assert.equal(s.requests.length, 7);
  assert.deepEqual(s.requests[0], { url: 'https://browser.style/', host: 'browser.style', protocol: 'h2', resourceType: 'Document', statusCode: 200, entity: 'browser.style' });
  assert.equal(s.requests[3].statusCode, 302);
  assert.equal(s.requests[3].resourceType, null);
  assert.ok(s.requests.every((r) => r.host === 'browser.style' && r.entity === 'browser.style'));
  assert.deepEqual(s.protocols, { h1: 0, h2: 7, h3: 0, other: 0 });
});

test('summariseLhr on the real report: failing audits, noindex, warnings', () => {
  const s = summariseLhr(lhr13);
  // best-practices is 81 because of `deprecations`, which the trimmed fixture does not carry:
  // a ref whose audit is missing is skipped, never reported and never thrown on.
  assert.deepEqual(s.failingAudits, {
    accessibility: [{ id: 'color-contrast', title: 'Background and foreground colors do not have a sufficient contrast ratio.', count: 5 }],
    seo: [],
    bestPractices: [],
  });
  assert.equal(s.seoNoindexAffected, false);
  assert.deepEqual(s.runWarnings, []);
});

// ---------------------------------------------------------------- summariseLhr: the older PSI body

test('summariseLhr on the PSI body: scores, no agentic, metrics, field data', () => {
  const s = summariseLhr(psi.lighthouseResult, { source: 'psi', strategy: 'mobile', loadingExperience: psi.loadingExperience });
  assert.equal(s.source, 'psi');
  assert.equal(s.version, '12.2.0');
  assert.equal(s.finalUrl, 'https://example.com/');
  assert.deepEqual(s.scores, { performance: 71, accessibility: 95, bestPractices: 100, seo: 69 });
  assert.equal(s.agentic, null, 'no agentic-browsing category before Lighthouse 13');
  assert.deepEqual(s.metrics.LCP, { value: 3100, display: '3.1 s' });
  assert.deepEqual(s.metrics.CLS, { value: 0.02, display: '0.02' });
  assert.deepEqual(s.metrics.TBT, { value: 450, display: '450 ms' });
  assert.deepEqual(s.metrics.FCP, { value: null, display: null });
  assert.deepEqual(s.metrics.TTFB, { value: null, display: null });
  assert.deepEqual(s.field, {
    LCP: { p75: 2900, category: 'AVERAGE' },
    INP: { p75: 150, category: 'FAST' },
    CLS: { p75: 0.05, category: 'FAST' },
    FCP: { p75: null, category: null },
    TTFB: { p75: null, category: null },
    overall: 'AVERAGE',
  });
  assert.equal(cwvRating('CLS', s.field.CLS.p75), 'pass', 'PSI reports CLS x100; p75 is the real score');
  assert.equal(cwvRating('LCP', s.field.LCP.p75), 'warn');
  assert.equal(summariseLhr(psi.lighthouseResult, { loadingExperience: { id: 'x' } }).field, null, 'no CrUX metrics means no field data');
});

test('summariseLhr on the PSI body: old-style opportunities ordered by savings, third-party-summary, noindex', () => {
  const s = summariseLhr(psi.lighthouseResult, { source: 'psi', loadingExperience: psi.loadingExperience });
  assert.deepEqual(s.opportunities, [
    { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', displayValue: 'Potential savings of 1,200 ms', savingsMs: 1200, score: 0.3 },
    { id: 'uses-text-compression', title: 'Enable text compression', displayValue: 'Potential savings of 600 ms', savingsMs: 600, score: 0.5 },
  ], 'uses-long-cache-ttl scores 1 and is left out');
  assert.deepEqual(s.thirdParties, [{ entity: 'Google Tag Manager', transferBytes: 120000, blockingMs: 310, mainThreadMs: 640 }]);
  assert.deepEqual(s.requests, []);
  assert.deepEqual(s.protocols, { h1: 0, h2: 0, h3: 0, other: 0 });
  assert.deepEqual(s.failingAudits.accessibility, [], 'a category without auditRefs');
  assert.deepEqual(s.failingAudits.seo, [
    { id: 'is-crawlable', title: 'Page is blocked from indexing', count: 1 },
    { id: 'robots-txt', title: 'robots-txt', count: null },
  ]);
  assert.equal(s.seoNoindexAffected, true);
  assert.deepEqual(SEO_NOINDEX_AUDITS, ['is-crawlable', 'robots-txt']);
});

test('summariseLhr ranks LH 13 insights by their largest metric saving, caps at 8, reads entity objects', () => {
  const mk = (id, score, metricSavings, extra = {}) => [id, { id, title: id, score, scoreDisplayMode: 'metricSavings', metricSavings, ...extra }];
  const audits = Object.fromEntries([
    mk('image-delivery-insight', 0.5, { LCP: 1200, FCP: 300 }),
    mk('render-blocking-insight', 0, { FCP: 900, LCP: 900 }),
    mk('cache-insight', 0.5, { FCP: 0, LCP: 0 }, { displayValue: 'Est savings of 8 KiB' }),
    mk('modern-http-insight', 1, { FCP: 0, LCP: 0 }),
    mk('lcp-breakdown-insight', null, { LCP: 0 }, { scoreDisplayMode: 'informative' }),
    mk('cls-culprits-insight', 0.5, { CLS: 0.3 }),
    mk('third-parties-insight', 1, undefined, { details: { type: 'table', items: [
      { entity: { type: 'link', text: 'Cloudflare' }, transferSize: 5000, mainThreadTime: 12 },
      { entity: 'YouTube', transferSize: 300000, mainThreadTime: 420, blockingTime: 90 },
    ] } }),
    mk('network-requests', null, undefined, { scoreDisplayMode: 'informative', details: { items: [
      { url: 'https://a.example/', protocol: 'h3', resourceType: 'Document', statusCode: 200, entity: 'a.example' },
      { url: 'https://a.example/x.js', protocol: 'http/1.1', resourceType: 'Script', statusCode: 200 },
      { url: 'https://a.example/y', protocol: 'h2', statusCode: 404 },
      { url: 'data:image/png;base64,AAAA', protocol: 'data' },
      { url: 'https://a.example/z', protocol: '', statusCode: -1 },
    ] } }),
    ...Array.from({ length: 10 }, (_, i) => mk(`filler-${i}`, 0.2, { TBT: 100 + i })),
  ]);
  const lhr = { lighthouseVersion: '13.5.0', categories: { performance: { score: 0.4, auditRefs: Object.keys(audits).map((id) => ({ id })) } }, audits };
  const s = summariseLhr(lhr);
  assert.equal(s.opportunities.length, 8, 'top 8');
  assert.deepEqual(s.opportunities.slice(0, 2).map((o) => [o.id, o.savingsMs]), [['image-delivery-insight', 1200], ['render-blocking-insight', 900]]);
  assert.deepEqual(s.opportunities.slice(2).map((o) => o.savingsMs), [109, 108, 107, 106, 105, 104]);
  assert.ok(!s.opportunities.some((o) => o.id === 'modern-http-insight'), 'a passed insight is not an opportunity');
  assert.ok(!s.opportunities.some((o) => o.id === 'lcp-breakdown-insight'), 'an unscored insight is not an opportunity');
  assert.deepEqual(s.thirdParties, [
    { entity: 'Cloudflare', transferBytes: 5000, blockingMs: null, mainThreadMs: 12 },
    { entity: 'YouTube', transferBytes: 300000, blockingMs: 90, mainThreadMs: 420 },
  ]);
  assert.equal(s.requests.length, 4, 'a data: URL is not a network request');
  assert.deepEqual(s.requests[2], { url: 'https://a.example/y', host: 'a.example', protocol: 'h2', resourceType: null, statusCode: 404, entity: null });
  assert.equal(s.requests[3].protocol, null);
  assert.deepEqual(s.protocols, { h1: 1, h2: 1, h3: 1, other: 1 });
  assert.deepEqual(s.scores, { performance: 40, accessibility: null, bestPractices: null, seo: null });
});

test('summariseLhr never throws on an empty report, and only on a non-object', () => {
  const s = summariseLhr({});
  assert.deepEqual(s.scores, { performance: null, accessibility: null, bestPractices: null, seo: null });
  assert.equal(s.agentic, null);
  assert.deepEqual(Object.keys(s.metrics), ['LCP', 'CLS', 'TBT', 'FCP', 'SI', 'TTFB', 'INP']);
  assert.ok(Object.values(s.metrics).every((m) => m.value === null && m.display === null));
  assert.equal(s.field, null);
  assert.deepEqual(s.opportunities, []);
  assert.deepEqual(s.thirdParties, []);
  assert.deepEqual(s.requests, []);
  assert.deepEqual(s.protocols, { h1: 0, h2: 0, h3: 0, other: 0 });
  assert.deepEqual(s.failingAudits, { accessibility: [], seo: [], bestPractices: [] });
  assert.equal(s.seoNoindexAffected, false);
  assert.deepEqual(s.runWarnings, []);
  assert.equal(s.version, null);
  assert.equal(s.finalUrl, null);
  assert.equal(s.fetchTime, null);
  assert.deepEqual(summariseLhr({ runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' } }).runWarnings, ['Runtime error NO_FCP: The page did not paint any content.']);
  assert.throws(() => summariseLhr(null), TypeError);
});

// ---------------------------------------------------------------- pickPerfPages

const seg = (u) => new URL(u).pathname.split('/').filter(Boolean);
const bucket = (u) => `${seg(u)[0]}/${seg(u).length}`;

test('pickPerfPages drops the start URL and query URLs, then samples buckets round-robin', () => {
  const input = ['https://example.com/', 'https://example.com/blog/beta?utm=1', 'https://example.com/products/desk?page=2', ...urls];
  const opts = { startUrl: 'https://example.com', n: 5 };
  assert.deepEqual(pickPerfPages(input, opts), [
    'https://example.com/blog/beta',          // blog/2 (6 URLs): shortest, then alphabetical
    'https://example.com/products/desk',      // products/2 (5)
    'https://example.com/products/lamps/led', // products/3 (5): key breaks the size tie
    'https://example.com/blog/2024/one',      // blog/3 (4)
    'https://example.com/docs/faq',           // docs/2 (3)
  ]);
  const thirteen = pickPerfPages(input, { ...opts, n: 13 });
  assert.equal(thirteen.length, 13);
  assert.equal(new Set(thirteen.map(bucket)).size, 13, 'one URL from each (segment, depth) bucket');
  assert.equal(new Set(thirteen.map((u) => seg(u)[0])).size, 5, 'all five first segments');
  const fourteen = pickPerfPages(input, { ...opts, n: 14 });
  assert.equal(fourteen[13], 'https://example.com/blog/zeta', 'the second lap starts with the biggest bucket again');
  const all = pickPerfPages(input, { ...opts, n: 100 });
  assert.equal(all.length, 40);
  assert.ok(!all.includes('https://example.com/'));
  assert.ok(!all.some((u) => u.includes('?')));
  assert.equal(pickPerfPages(input, { startUrl: 'https://example.com' }).length, 5, 'n defaults to 5');
});

test('pickPerfPages is deterministic whatever the input order, and dedupes', () => {
  const opts = { startUrl: 'https://example.com/', n: 9 };
  const a = pickPerfPages(urls, opts);
  const b = pickPerfPages([...urls].reverse(), opts);
  const c = pickPerfPages([...urls, ...urls, 'not a url', 'https://example.com/blog/beta#top'], opts);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(new Set(a).size, 9);
  assert.deepEqual(pickPerfPages([], opts), []);
  assert.deepEqual(pickPerfPages(['https://example.com/', 'https://example.com'], opts), []);
  assert.throws(() => pickPerfPages('https://example.com/', opts), TypeError);
});

// ---------------------------------------------------------------- runPsi (stubbed http)

const response = (over) => ({ url: '', finalUrl: '', status: 200, ok: true, headers: {}, setCookie: [], body: '', bytes: 0, truncated: false, contentType: 'application/json', ms: 1, ...over });
const stub = (over) => { const calls = []; return { calls, get: async (url, opts) => { calls.push({ url, opts }); return response({ url, finalUrl: url, ...over }); } }; };

test('runPsi refuses without a key, builds the exact request, unwraps the body', async () => {
  const http = stub({ body: JSON.stringify(psi) });
  assert.deepEqual(await runPsi(http, { url: 'https://example.com/' }), { ok: false, status: 0, lhr: null, loadingExperience: null, originLoadingExperience: null, error: 'PSI_API_KEY required' });
  assert.equal(http.calls.length, 0, 'no key, no call');

  const r = await runPsi(http, { url: 'https://example.com/', key: 'k', strategy: 'desktop', timeout: 5000 });
  assert.equal(http.calls[0].url, 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fexample.com%2F&strategy=desktop&category=performance&category=accessibility&category=best-practices&category=seo&key=k');
  assert.equal(http.calls[0].opts.maxBytes, 20 * 1024 * 1024);
  assert.equal(http.calls[0].opts.timeout, 5000);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.error, undefined);
  assert.equal(r.lhr.lighthouseVersion, '12.2.0');
  assert.equal(r.loadingExperience.overall_category, 'AVERAGE');
  assert.equal(r.originLoadingExperience.origin_fallback, true);

  const def = stub({ body: JSON.stringify({ lighthouseResult: { lighthouseVersion: '12.2.0' } }) });
  const d = await runPsi(def, { url: 'https://example.com/', key: 'k' });
  assert.match(def.calls[0].url, /&strategy=mobile&/);
  assert.equal(def.calls[0].opts.timeout, 120000);
  assert.equal(d.ok, true);
  assert.equal(d.loadingExperience, null);
  assert.equal(d.originLoadingExperience, null);
});

test('runPsi turns network failure, quota, junk and truncation into ok:false', async () => {
  const down = await runPsi(stub({ status: 0, ok: false, body: null, error: 'ECONNRESET: socket hang up' }), { url: 'https://example.com/', key: 'k' });
  assert.equal(down.ok, false);
  assert.equal(down.status, 0);
  assert.match(down.error, /ECONNRESET/);

  const quota = await runPsi(stub({ status: 429, ok: false, body: JSON.stringify({ error: { code: 429, message: 'Quota exceeded for quota metric Queries', status: 'RESOURCE_EXHAUSTED' } }) }), { url: 'https://example.com/', key: 'k' });
  assert.equal(quota.ok, false);
  assert.equal(quota.status, 429);
  assert.match(quota.error, /429/);
  assert.match(quota.error, /Quota exceeded/);
  assert.equal(quota.lhr, null);

  const junk = await runPsi(stub({ body: '<html>not json' }), { url: 'https://example.com/', key: 'k' });
  assert.equal(junk.ok, false);
  assert.match(junk.error, /JSON/);

  const empty = await runPsi(stub({ body: '{}' }), { url: 'https://example.com/', key: 'k' });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /lighthouseResult/);

  const big = await runPsi(stub({ body: '{', truncated: true }), { url: 'https://example.com/', key: 'k' });
  assert.equal(big.ok, false);
  assert.match(big.error, /20 MB/);

  const noUrl = await runPsi(stub({}), { key: 'k' });
  assert.equal(noUrl.ok, false);
});
