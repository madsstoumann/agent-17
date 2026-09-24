import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import {
  stripJsonGuard, groupW3cMessages, w3cValidate, schemaValidate, observatoryScan, summariseObservatory,
  hstsPreloadStatus, sslLabsAnalyze, securityHeadersApi, parseSecurityHeadersPage, securityHeadersScrape,
  buildScrapeArgs, findChrome, postBody,
} from '../lib/services.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/services/${name}`, import.meta.url), 'utf8');
const w3cFixture = JSON.parse(fixture('w3c.json'));
const scanFixture = JSON.parse(fixture('observatory-scan.json'));
const analyzeFixture = JSON.parse(fixture('observatory-analyze.json'));

/** A fake http: routes[url or prefix] -> partial response or function(url, opts). Records calls. */
function fakeHttp(routes) {
  const calls = [];
  const answer = (method) => async (url, opts = {}) => {
    calls.push({ method, url, opts });
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
    const base = { url, finalUrl: url, status: 200, ok: true, headers: {}, setCookie: [], body: '', bytes: 0, truncated: false, contentType: 'application/json', ms: 1, redirected: false };
    if (!key) return { ...base, status: 0, ok: false, body: null, error: `no route for ${url}` };
    const r = typeof routes[key] === 'function' ? await routes[key](url, opts, method) : routes[key];
    const merged = { ...base, ...r };
    if (r.status != null && !('ok' in r)) merged.ok = r.status >= 200 && r.status < 300;
    return merged;
  };
  return { calls, request: (url, opts = {}) => answer((opts.method || 'GET').toUpperCase())(url, opts), get: answer('GET'), head: answer('HEAD'), post: answer('POST'), limit: (fn) => fn() };
}

// ---------------------------------------------------------------- pure helpers

test('stripJsonGuard removes the )]}\' line with or without its newline', () => {
  assert.equal(stripJsonGuard(")]}'\n{\"a\":1}"), '{"a":1}');
  assert.equal(stripJsonGuard(")]}'{\"a\":1}"), '{"a":1}');
  assert.equal(stripJsonGuard(")]}'\r\n{}"), '{}');
  assert.equal(stripJsonGuard('{"a":1}'), '{"a":1}');
  assert.equal(stripJsonGuard(''), '');
});

test('groupW3cMessages counts by kind and groups identical messages, most frequent first', () => {
  const s = groupW3cMessages(w3cFixture.messages);
  assert.equal(s.errors, 4);
  assert.equal(s.fatal, 1);
  assert.equal(s.warnings, 1);
  assert.equal(s.info, 1);
  assert.equal(s.distinct, 5);
  assert.equal(s.groups.length, 5);
  assert.equal(s.groups[0].count, 2);
  assert.equal(s.groups[0].type, 'error');
  assert.match(s.groups[0].message, /not allowed as child/);
  assert.deepEqual(s.groups[0].sample, { lastLine: 12, firstColumn: 5, extract: '<ul>\n    <div class="item">' });
  const fatal = s.groups.find((g) => g.subType === 'fatal');
  assert.equal(fatal.count, 1);
  const warn = s.groups.find((g) => g.type === 'info' && g.subType === 'warning');
  assert.match(warn.message, /unnecessary/);
  assert.deepEqual(groupW3cMessages([]), { errors: 0, warnings: 0, info: 0, fatal: 0, distinct: 0, groups: [] });
  assert.deepEqual(groupW3cMessages(undefined).groups, []);
});

// ---------------------------------------------------------------- W3C

test('w3cValidate url mode GETs the Nu checker with out=json', async () => {
  const http = fakeHttp({ 'https://validator.w3.org/nu/?doc=': { body: JSON.stringify(w3cFixture) } });
  const r = await w3cValidate(http, { url: 'https://example.com/a b?x=1' });
  assert.equal(http.calls[0].method, 'GET');
  assert.equal(http.calls[0].url, 'https://validator.w3.org/nu/?doc=https%3A%2F%2Fexample.com%2Fa%20b%3Fx%3D1&out=json');
  assert.equal(http.calls[0].opts.timeout, 60000);
  assert.match(http.calls[0].opts.headers['user-agent'], /^launch-audit\//, 'an honest tool UA: the checker 403s a spoofed browser UA');
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.mode, 'url');
  assert.equal(r.messages.length, 6);
  assert.equal(r.summary.errors, 4);
  assert.equal(r.summary.distinct, 5);
});

test('w3cValidate html mode POSTs the markup as text/html', async () => {
  const http = fakeHttp({ 'https://validator.w3.org/nu/?out=json': { body: JSON.stringify({ messages: [] }) } });
  const html = '<!doctype html><html lang="en"><title>x</title>';
  const r = await w3cValidate(http, { html, timeout: 1234 });
  assert.equal(http.calls[0].method, 'POST');
  assert.equal(http.calls[0].url, 'https://validator.w3.org/nu/?out=json');
  assert.equal(http.calls[0].opts.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(http.calls[0].opts.headers['user-agent'], /^launch-audit\//);
  assert.equal(http.calls[0].opts.body, html);
  assert.equal(http.calls[0].opts.timeout, 1234);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'html');
  assert.deepEqual(r.messages, []);
  assert.equal(r.summary.errors, 0);
});

test('w3cValidate: 429, 5xx, non-JSON, network failure and oversize html are ok:false results', async () => {
  const limited = await w3cValidate(fakeHttp({ 'https://validator.w3.org/nu/': { status: 429, body: 'slow down' } }), { url: 'https://example.com/' });
  assert.equal(limited.ok, false);
  assert.equal(limited.status, 429);
  assert.match(limited.error, /429/);
  assert.deepEqual(limited.messages, []);
  assert.equal(limited.summary.errors, 0);
  const down = await w3cValidate(fakeHttp({ 'https://validator.w3.org/nu/': { status: 503, body: '' } }), { url: 'https://example.com/' });
  assert.equal(down.ok, false);
  const notJson = await w3cValidate(fakeHttp({ 'https://validator.w3.org/nu/': { body: '<html>oops</html>', contentType: 'text/html' } }), { url: 'https://example.com/' });
  assert.equal(notJson.ok, false);
  assert.match(notJson.error, /JSON/i);
  const offline = await w3cValidate(fakeHttp({}), { url: 'https://example.com/' });
  assert.equal(offline.ok, false);
  assert.equal(offline.status, 0);
  assert.match(offline.error, /no route/);
  const http = fakeHttp({ 'https://validator.w3.org/nu/': { body: '{"messages":[]}' } });
  const big = await w3cValidate(http, { html: 'x'.repeat(2 * 1024 * 1024 + 1) });
  assert.equal(big.ok, false);
  assert.match(big.error, /2 MB/);
  assert.equal(http.calls.length, 0, 'nothing sent');
  assert.equal((await w3cValidate(http, {})).ok, false, 'neither url nor html');
});

// ---------------------------------------------------------------- schema.org

test('schemaValidate POSTs a form body, strips the guard, drops the html and summarises the nodes', async () => {
  const http = fakeHttp({ 'https://validator.schema.org/validate': { body: fixture('schema.txt'), contentType: 'application/json' } });
  const r = await schemaValidate(http, { url: 'https://example.com/?a=1' });
  assert.equal(http.calls[0].method, 'POST');
  assert.equal(http.calls[0].opts.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(http.calls[0].opts.body, 'url=https%3A%2F%2Fexample.com%2F%3Fa%3D1');
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.mode, 'url');
  assert.equal(r.objects, 2);
  assert.equal(r.errors, 1);
  assert.equal(r.warnings, 0);
  assert.deepEqual(r.types, ['WebSite', 'Product']);
  assert.equal(r.nodes.length, 2);
  assert.deepEqual(r.nodes[0], { types: ['WebSite'], errors: [], warnings: [] });
  assert.deepEqual(r.nodes[1].types, ['Product']);
  assert.equal(r.nodes[1].errors.length, 1);
  assert.equal(r.nodes[1].errors[0].type, 'INVALID_PREDICATE');
  assert.equal(r.nodes[1].errors[0].property, 'madeUpProperty');
  assert.deepEqual(r.nodes[1].errors[0].args, ['madeUpProperty', 'Product']);
  assert.equal('html' in r.raw, false);
  assert.equal(r.raw.numObjects, 2);

  const htmlMode = await schemaValidate(http, { html: '<html>&=?</html>' });
  assert.equal(http.calls[1].opts.body, 'html=%3Chtml%3E%26%3D%3F%3C%2Fhtml%3E');
  assert.equal(htmlMode.mode, 'html');
});

test('schemaValidate splits severe and non-severe property errors, and fails cleanly', async () => {
  const body = ")]}'\n" + JSON.stringify({
    url: 'x', isRendered: true, numObjects: 1, html: '<html></html>', totalNumErrors: 1, totalNumWarnings: 1, errors: [],
    tripleGroups: [{ type: 'Article', numErrors: 1, numWarnings: 1, nodes: [{ types: [{ pred: 'itemtype', value: 'Article' }, { pred: 'itemtype', value: 'NewsArticle' }], errors: [{ errorType: 'MISSING_REQUIRED', args: ['headline'], isSevere: true }], properties: [{ pred: 'foo', value: 'bar', errors: [{ errorType: 'INVALID_PREDICATE', args: ['foo', 'Article'], isSevere: false }] }], numErrors: 1, numWarnings: 1 }] }],
  });
  const r = await schemaValidate(fakeHttp({ 'https://validator.schema.org/validate': { body } }), { url: 'https://example.com/' });
  assert.deepEqual(r.types, ['Article', 'NewsArticle']);
  assert.equal(r.nodes[0].errors.length, 1);
  assert.equal(r.nodes[0].errors[0].type, 'MISSING_REQUIRED');
  assert.equal(r.nodes[0].warnings.length, 1);
  assert.equal(r.nodes[0].warnings[0].property, 'foo');

  const limited = await schemaValidate(fakeHttp({ 'https://validator.schema.org/validate': { status: 429, body: '' } }), { url: 'https://example.com/' });
  assert.equal(limited.ok, false);
  assert.match(limited.error, /429/);
  assert.deepEqual(limited.nodes, []);
  const garbage = await schemaValidate(fakeHttp({ 'https://validator.schema.org/validate': { body: ")]}'\n<html>" } }), { url: 'https://example.com/' });
  assert.equal(garbage.ok, false);
  assert.match(garbage.error, /JSON/i);
  const offline = await schemaValidate(fakeHttp({}), { url: 'https://example.com/' });
  assert.equal(offline.ok, false);
  assert.equal(offline.status, 0);
});

// ---------------------------------------------------------------- Observatory

test('summariseObservatory on the real IOI responses: grade B, score 70, three failed tests', () => {
  const s = summariseObservatory(scanFixture, analyzeFixture);
  assert.equal(s.ok, true);
  assert.equal(s.grade, 'B');
  assert.equal(s.score, 70);
  assert.equal(s.testsPassed, 9);
  assert.equal(s.testsFailed, 3);
  assert.equal(s.testsQuantity, 12);
  assert.equal(s.detailsUrl, 'https://developer.mozilla.org/en-US/observatory/analyze?host=akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app');
  assert.equal(s.scannedAt, '2026-09-24T07:23:16.515Z');
  assert.equal(s.failed.length, 3);
  const csp = s.failed.find((t) => t.name === 'content-security-policy');
  assert.equal(csp.result, 'csp-implemented-with-unsafe-inline');
  assert.equal(csp.modifier, -20);
  assert.equal(csp.expectation, 'csp-implemented-with-no-unsafe');
  assert.equal(csp.recommendation, "Remove unsafe-inline and data: from script-src, overly broad sources from object-src and script-src, and ensure object-src and script-src are set.");
  assert.equal(s.failed[0].name, 'content-security-policy', 'the costliest failure first');
  assert.deepEqual(s.failed.map((t) => t.name).sort(), ['content-security-policy', 'cookies', 'subresource-integrity']);
  assert.ok(s.failed.every((t) => !/<|>/.test(t.recommendation)), 'no tags left in recommendations');
  assert.equal(s.raw.scan, scanFixture);
  assert.equal(s.raw.analyze, analyzeFixture);
});

test('summariseObservatory with the analyze response alone, and with nothing', () => {
  const s = summariseObservatory(null, analyzeFixture);
  assert.equal(s.ok, true);
  assert.equal(s.grade, 'B');
  assert.equal(s.testsFailed, 3);
  assert.equal(s.detailsUrl, null);
  const none = summariseObservatory(null, null);
  assert.equal(none.ok, false);
  assert.equal(none.grade, null);
  assert.deepEqual(none.failed, []);
});

test('observatoryScan POSTs a scan then GETs the analysis; a refused POST falls back to the GET alone', async () => {
  const host = 'akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app';
  const http = fakeHttp({
    [`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${host}`]: { body: JSON.stringify(scanFixture) },
    [`https://observatory-api.mdn.mozilla.net/api/v2/analyze?host=${host}`]: { body: JSON.stringify(analyzeFixture) },
  });
  const r = await observatoryScan(http, host);
  assert.deepEqual(http.calls.map((c) => c.method), ['POST', 'GET']);
  assert.equal(http.calls[0].opts.timeout, 30000);
  assert.equal(r.ok, true);
  assert.equal(r.grade, 'B');
  assert.equal(r.failed.length, 3);
  assert.equal(r.detailsUrl, scanFixture.details_url);

  const limited = fakeHttp({
    'https://observatory-api.mdn.mozilla.net/api/v2/scan': { status: 429, body: '{"error":"rate limited"}' },
    'https://observatory-api.mdn.mozilla.net/api/v2/analyze': { body: JSON.stringify(analyzeFixture) },
  });
  const r2 = await observatoryScan(limited, host);
  assert.equal(r2.ok, true);
  assert.equal(r2.grade, 'B');
  assert.equal(r2.raw.scan, null);
  assert.equal(r2.detailsUrl, `https://developer.mozilla.org/en-US/observatory/analyze?host=${host}`, 'computed when the scan did not say');

  const bad = await observatoryScan(fakeHttp({
    'https://observatory-api.mdn.mozilla.net/api/v2/scan': { body: JSON.stringify({ error: 'invalid-hostname', grade: null }) },
    'https://observatory-api.mdn.mozilla.net/api/v2/analyze': { status: 404, body: '' },
  }), 'nope');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /invalid-hostname|404/);
  const offline = await observatoryScan(fakeHttp({}), host);
  assert.equal(offline.ok, false);
});

// ---------------------------------------------------------------- HSTS preload

test('hstsPreloadStatus reads status and preloadable', async () => {
  const http = fakeHttp({
    'https://hstspreload.org/api/v2/status?domain=browser.style': { body: '{"name":"browser.style","status":"preloaded","bulk":true,"preloadedDomain":"browser.style"}' },
    'https://hstspreload.org/api/v2/preloadable?domain=browser.style': { body: '{"errors":[],"warnings":[{"code":"header.preloadable.max_age.over_a_year","summary":"..."}]}' },
  });
  const r = await hstsPreloadStatus(http, 'browser.style');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'preloaded');
  assert.equal(r.preloadedDomain, 'browser.style');
  assert.equal(r.bulk, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);

  const unknown = await hstsPreloadStatus(fakeHttp({
    'https://hstspreload.org/api/v2/status': { body: '{"name":"example.com","status":"unknown","bulk":false,"preloadedDomain":""}' },
    'https://hstspreload.org/api/v2/preloadable': { body: '{"errors":[{"code":"domain.http.no_redirect","summary":"No redirect from HTTP","message":"..."}],"warnings":[]}' },
  }), 'example.com');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.preloadedDomain, null, 'an empty string is no domain');
  assert.equal(unknown.errors[0].code, 'domain.http.no_redirect');

  const partial = await hstsPreloadStatus(fakeHttp({ 'https://hstspreload.org/api/v2/status': { body: '{"status":"pending","bulk":false,"preloadedDomain":""}' } }), 'example.com');
  assert.equal(partial.ok, true, 'the status is known even when preloadable fails');
  assert.equal(partial.status, 'pending');
  assert.match(partial.error, /preloadable/);
  const offline = await hstsPreloadStatus(fakeHttp({}), 'example.com');
  assert.equal(offline.ok, false);
  assert.equal(offline.status, 'unknown');
});

// ---------------------------------------------------------------- SSL Labs

test('sslLabsAnalyze polls until READY and lists endpoint grades', async () => {
  let n = 0;
  const http = fakeHttp({
    'https://api.ssllabs.com/api/v3/analyze?host=example.com&all=done&fromCache=on&maxAge=24&publish=off': () => {
      n++;
      if (n < 3) return { body: JSON.stringify({ host: 'example.com', status: 'IN_PROGRESS', endpoints: [{ ipAddress: '1.2.3.4', statusMessage: 'In progress' }] }) };
      return { body: JSON.stringify({ host: 'example.com', status: 'READY', endpoints: [{ ipAddress: '1.2.3.4', serverName: 'a.example.com', grade: 'A+', hasWarnings: false }, { ipAddress: '2606:4700::1', grade: 'B', hasWarnings: true }] }) };
    },
  });
  const logs = [];
  const r = await sslLabsAnalyze(http, 'example.com', { poll: 1, log: (m) => logs.push(m) });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'READY');
  assert.equal(n, 3);
  assert.deepEqual(r.grades, [{ ip: '1.2.3.4', grade: 'A+', serverName: 'a.example.com', hasWarnings: false }, { ip: '2606:4700::1', grade: 'B', serverName: null, hasWarnings: true }]);
  assert.equal(r.raw.status, 'READY');
  assert.ok(logs.length >= 2);
});

test('sslLabsAnalyze: ERROR, timeout and transport failure are results', async () => {
  const err = await sslLabsAnalyze(fakeHttp({ 'https://api.ssllabs.com/': { body: '{"status":"ERROR","statusMessage":"Unable to resolve domain name"}' } }), 'nope.invalid', { poll: 1 });
  assert.equal(err.ok, false);
  assert.equal(err.status, 'ERROR');
  assert.match(err.error, /Unable to resolve/);
  const slow = await sslLabsAnalyze(fakeHttp({ 'https://api.ssllabs.com/': { body: '{"status":"IN_PROGRESS","endpoints":[]}' } }), 'example.com', { poll: 1, timeout: 30 });
  assert.equal(slow.ok, false);
  assert.equal(slow.status, 'IN_PROGRESS');
  assert.match(slow.error, /timed out/);
  const offline = await sslLabsAnalyze(fakeHttp({}), 'example.com', { poll: 1, timeout: 30 });
  assert.equal(offline.ok, false);
  assert.deepEqual(offline.grades, []);
  const rejected = await sslLabsAnalyze(fakeHttp({ 'https://api.ssllabs.com/': { status: 400, body: '{"errors":[{"message":"Invalid hostname"}]}' } }), 'bad host', { poll: 1 });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Invalid hostname/);
});

// ---------------------------------------------------------------- securityheaders.com

test('securityHeadersApi sends the key and reads x-grade, else the JSON grade', async () => {
  const http = fakeHttp({ 'https://api.securityheaders.com/?q=https%3A%2F%2Fexample.com%2F&followRedirects=on&hide=on': { headers: { 'x-grade': 'A+' }, body: '{"grade":"A+"}' } });
  const r = await securityHeadersApi(http, 'https://example.com/', 'k3y');
  assert.equal(http.calls[0].opts.headers['x-api-key'], 'k3y');
  assert.equal(r.ok, true);
  assert.equal(r.grade, 'A+');
  assert.deepEqual(r.raw, { grade: 'A+' });
  const viaJson = await securityHeadersApi(fakeHttp({ 'https://api.securityheaders.com/': { body: '{"grade":"B","score":50}' } }), 'https://example.com/', 'k3y');
  assert.equal(viaJson.grade, 'B');
  const noKey = await securityHeadersApi(http, 'https://example.com/', '');
  assert.equal(noKey.ok, false);
  assert.match(noKey.error, /key/i);
  assert.equal(http.calls.length, 1);
  const denied = await securityHeadersApi(fakeHttp({ 'https://api.securityheaders.com/': { status: 401, body: 'Unauthorized' } }), 'https://example.com/', 'bad');
  assert.equal(denied.ok, false);
  assert.match(denied.error, /401/);
  const offline = await securityHeadersApi(fakeHttp({}), 'https://example.com/', 'k');
  assert.equal(offline.ok, false);
});

test('parseSecurityHeadersPage: the Cloudflare challenge, the grade markup and the text fallback', () => {
  assert.deepEqual(parseSecurityHeadersPage(fixture('securityheaders-challenge.html')), { challenge: true });
  assert.deepEqual(parseSecurityHeadersPage(fixture('securityheaders-grade.html')), { grade: 'A' });
  assert.deepEqual(parseSecurityHeadersPage('<div class="score"><div class="score_yellow" data-x="1">\n <span>C+</span></div></div>'), { grade: 'C+' });
  assert.deepEqual(parseSecurityHeadersPage('<div class="score score-big"><div><span>D</span></div></div>'), { grade: 'D' });
  assert.deepEqual(parseSecurityHeadersPage('<p>Grade: B-</p>'), { grade: 'B-' });
  assert.deepEqual(parseSecurityHeadersPage('<html><head><title>x</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/x.js"></script></body></html>'), { challenge: true });
  assert.deepEqual(parseSecurityHeadersPage('<title>Attention Required</title><div id="cf-chl-widget"></div>'), { challenge: true });
  assert.equal(parseSecurityHeadersPage('<html><body>nothing here</body></html>'), null);
  assert.equal(parseSecurityHeadersPage(''), null);
  assert.equal(parseSecurityHeadersPage(null), null);
});

test('buildScrapeArgs builds the headless Chrome invocation', () => {
  const args = buildScrapeArgs('https://example.com/?a=b', { profileDir: '/tmp/launch-audit-x', virtualTimeBudget: 20000 });
  assert.deepEqual(args, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=/tmp/launch-audit-x', '--virtual-time-budget=20000', '--dump-dom',
    'https://securityheaders.com/?q=https%3A%2F%2Fexample.com%2F%3Fa%3Db&followRedirects=on&hide=on',
  ]);
});

test('findChrome: explicit path, CHROME_PATH, the macOS bundle, PATH lookup, nothing', () => {
  assert.equal(findChrome({ chromePath: '/x/chrome' }), '/x/chrome');
  assert.equal(findChrome({ env: { CHROME_PATH: '/y/chrome' }, exists: () => false }), '/y/chrome');
  assert.equal(findChrome({ env: {}, exists: (p) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(findChrome({ env: { PATH: '/opt/bin:/usr/bin' }, exists: (p) => p === '/usr/bin/chromium' }), '/usr/bin/chromium');
  assert.equal(findChrome({ env: { PATH: '/usr/bin' }, exists: () => false }), null);
});

test('securityHeadersScrape never launches anything it cannot find, and cleans its profile', async () => {
  const before = (await readdir(os.tmpdir())).filter((n) => n.startsWith('launch-audit-shs-'));
  const missing = await securityHeadersScrape('https://example.com/', { chromePath: '/nonexistent/chrome-binary' });
  assert.equal(missing.ok, false);
  assert.equal(missing.challenge, false);
  assert.match(missing.error, /ENOENT|nonexistent/);
  const none = await securityHeadersScrape('https://example.com/', { env: { PATH: '' }, exists: () => false });
  assert.deepEqual(none, { ok: false, grade: null, challenge: false, ms: 0, error: 'Chrome not found' });
  const after = (await readdir(os.tmpdir())).filter((n) => n.startsWith('launch-audit-shs-'));
  assert.equal(after.length, before.length, 'the temp profile is removed');
});

// ---------------------------------------------------------------- postBody (the fetch seam for bodies)

test('postBody sends a body through fetch with the audit headers and returns the http.mjs shape', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { url, status: 200, ok: true, redirected: false, headers: new Headers({ 'content-type': 'application/json', 'x-grade': 'A' }), arrayBuffer: async () => new TextEncoder().encode('{"ok":1}').buffer };
  };
  const r = await postBody('https://example.com/api', { headers: { 'content-type': 'text/plain' }, body: 'hello', timeout: 500 }, { fetch: fetchImpl });
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.body, 'hello');
  assert.match(seen[0].init.headers['user-agent'], /Mozilla/);
  assert.match(seen[0].init.headers['x-audit'], /launch-audit/);
  assert.equal(seen[0].init.headers['content-type'], 'text/plain');
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
  assert.equal(r.body, '{"ok":1}');
  assert.equal(r.bytes, 8);
  assert.equal(r.headers['x-grade'], 'A');
  assert.equal(r.contentType, 'application/json');
  const down = await postBody('https://example.com/api', { body: 'x' }, { fetch: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); } });
  assert.equal(down.status, 0);
  assert.equal(down.ok, false);
  assert.match(down.error, /ECONNREFUSED/);
});
