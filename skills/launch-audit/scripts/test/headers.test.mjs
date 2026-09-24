import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCsp, lintCsp, gradeSecurityHeaders, GRADE_TABLE, GRADE_NOTE,
  parseSetCookie, lintCookies, infoLeakHeaders, parseCacheControl, lintAssetCaching,
  parseHsts, corsVerdict, crossOriginPolicies,
} from '../lib/headers.mjs';

const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(fixture(p));

// Real responses, captured with curl (see fixtures/headers and fixtures/csp).
const IOI = json('headers/ioi.json');
const IOI_COOKIES = json('headers/ioi.set-cookie.json');
const IOI_HOST = 'akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app';
const BS = json('headers/browser-style.json');
const CSP_IOI = fixture('csp/ioi.txt');
const CSP_BS = fixture('csp/browser-style.txt');
const CSP_NONCE = fixture('csp/nonce.txt');

const codes = (findings) => findings.map((f) => f.code);
const find = (findings, code) => findings.find((f) => f.code === code);

// ---------------------------------------------------------------- parseCsp

test('parseCsp: the IOI policy is one object with lowercased directives and verbatim sources', () => {
  const policies = parseCsp(CSP_IOI);
  assert.equal(policies.length, 1);
  const [p] = policies;
  for (const t of ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'https://www.google.com']) {
    assert.ok(p['script-src'].includes(t), `script-src has ${t}`);
  }
  assert.deepEqual(p['object-src'], ["'none'"]);
  assert.deepEqual(p['base-uri'], ["'self'"]);
  assert.deepEqual(p['report-to'], ['csp-endpoint']);
  assert.ok(p['frame-ancestors'].includes("'self'"));
  assert.ok(p['report-uri'][0].startsWith('https://'));
});

test('parseCsp: browser.style tolerates a trailing ";" and the file newline', () => {
  assert.deepEqual(parseCsp(CSP_BS), [{ 'upgrade-insecure-requests': [], 'frame-ancestors': ["'self'"] }]);
});

test('parseCsp: several policies split on ",", names lowercase, empty input is []', () => {
  const two = parseCsp("Default-Src 'self'; SCRIPT-SRC 'nonce-abc' 'sha256-AbC+/=', default-src 'none'");
  assert.equal(two.length, 2);
  assert.deepEqual(two[0], { 'default-src': ["'self'"], 'script-src': ["'nonce-abc'", "'sha256-AbC+/='"] });
  assert.deepEqual(two[1], { 'default-src': ["'none'"] });
  assert.deepEqual(parseCsp(''), []);
  assert.deepEqual(parseCsp(null), []);
  assert.deepEqual(parseCsp(undefined), []);
  assert.deepEqual(parseCsp(' ; ; '), []);
});

test('parseCsp: a duplicated directive keeps the first, as browsers do', () => {
  assert.deepEqual(parseCsp("script-src 'self'; script-src *"), [{ 'script-src': ["'self'"] }]);
});

// ---------------------------------------------------------------- lintCsp

test('lintCsp: empty input is one no-csp warning', () => {
  const out = lintCsp([]);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, 'no-csp');
  assert.equal(out[0].severity, 'warn');
  assert.deepEqual(codes(lintCsp('')), ['no-csp']);
});

test('lintCsp: IOI warns on unsafe-inline, unsafe-eval and the www.google.com bypass host', () => {
  const out = lintCsp(parseCsp(CSP_IOI));
  assert.equal(find(out, 'unsafe-inline-script').severity, 'warn');
  assert.equal(find(out, 'unsafe-eval').severity, 'warn');
  const bypass = find(out, 'known-bypass-host');
  assert.equal(bypass.severity, 'warn');
  assert.match(bypass.text, /www\.google\.com/);
  assert.equal(find(out, 'wildcard-script-src'), undefined, 'blob: is not a wildcard');
  assert.equal(find(out, 'no-script-restriction'), undefined);
  assert.equal(find(out, 'missing-object-src'), undefined);
  assert.equal(find(out, 'missing-base-uri'), undefined);
  assert.equal(find(out, 'missing-frame-ancestors'), undefined);
  const reporting = find(out, 'reporting');
  assert.equal(reporting.severity, 'info');
  assert.match(reporting.text, /report-to/);
  assert.match(reporting.text, /report-uri.*deprecated/);
  for (const f of out) {
    assert.ok(['warn', 'info'].includes(f.severity), f.code);
    assert.ok(f.text.length > 20, `${f.code} explains itself`);
  }
});

test('lintCsp: browser.style restricts nothing about scripts', () => {
  const out = lintCsp(parseCsp(CSP_BS));
  assert.equal(find(out, 'no-script-restriction').severity, 'warn');
  assert.match(find(out, 'no-script-restriction').text, /does not restrict scripts/);
  assert.equal(find(out, 'missing-object-src').severity, 'info');
  assert.equal(find(out, 'missing-base-uri').severity, 'info');
  assert.equal(find(out, 'missing-frame-ancestors'), undefined);
  assert.equal(find(out, 'upgrade-insecure-requests').severity, 'info');
  assert.deepEqual(out.filter((f) => f.severity === 'warn').map((f) => f.code), ['no-script-restriction']);
});

test('lintCsp: a strict nonce policy lints with no warnings; the fallbacks are reported as ignored', () => {
  const out = lintCsp(parseCsp(CSP_NONCE));
  assert.deepEqual(out.filter((f) => f.severity === 'warn'), []);
  const inline = find(out, 'unsafe-inline-script');
  assert.equal(inline.severity, 'info');
  assert.match(inline.text, /ignored because a nonce\/hash is present/);
  const wild = find(out, 'wildcard-script-src');
  assert.equal(wild.severity, 'info');
  assert.match(wild.text, /strict-dynamic/);
  assert.equal(find(out, 'missing-object-src'), undefined);
  assert.equal(find(out, 'missing-base-uri'), undefined);
  assert.equal(find(out, 'missing-frame-ancestors'), undefined);
  assert.equal(find(out, 'reporting').severity, 'info');
});

test('lintCsp: default-src is the effective script list when script-src is absent', () => {
  const out = lintCsp(parseCsp("default-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'none'"));
  assert.equal(find(out, 'unsafe-inline-script').severity, 'warn');
  assert.equal(find(out, 'unsafe-eval').severity, 'warn');
  assert.equal(find(out, 'no-script-restriction'), undefined);
  assert.equal(find(out, 'missing-object-src').severity, 'info', "default-src 'self' still allows plugins");
  assert.equal(find(lintCsp(parseCsp("default-src 'none'")), 'missing-object-src'), undefined);
});

test('lintCsp: wildcard and scheme sources in the script list', () => {
  const out = lintCsp(parseCsp("script-src 'self' * https: data:; img-src https:"));
  const w = find(out, 'wildcard-script-src');
  assert.equal(w.severity, 'warn');
  for (const t of ['*', 'https:', 'data:']) assert.ok(w.text.includes(t), t);
  assert.equal(find(lintCsp(parseCsp("script-src 'self'; img-src https: data:")), 'wildcard-script-src'), undefined);
});

test('lintCsp: known bypass hosts, exact, wildcard and scheme-less; a path-pinned host is not flagged', () => {
  assert.equal(find(lintCsp(parseCsp("script-src 'self' https://ajax.googleapis.com")), 'known-bypass-host').severity, 'warn');
  assert.equal(find(lintCsp(parseCsp("script-src 'self' *.google.com")), 'known-bypass-host').severity, 'warn');
  assert.equal(find(lintCsp(parseCsp("script-src 'self' cdn.jsdelivr.net unpkg.com")), 'known-bypass-host').severity, 'warn');
  assert.equal(find(lintCsp(parseCsp("script-src 'self' https://www.google.com/recaptcha/")), 'known-bypass-host'), undefined);
  assert.equal(find(lintCsp(parseCsp("script-src 'self' https://accounts.google.com")), 'known-bypass-host'), undefined);
});

test('lintCsp: reporting and report-only', () => {
  const uri = find(lintCsp(parseCsp("default-src 'self'; report-uri /csp")), 'reporting');
  assert.equal(uri.severity, 'info');
  assert.match(uri.text, /deprecated/);
  assert.equal(find(lintCsp(parseCsp("default-src 'self'")), 'reporting'), undefined);
  const ro = lintCsp(parseCsp("default-src 'self'"), { reportOnly: true });
  assert.equal(find(ro, 'report-only-only').severity, 'warn');
  assert.equal(find(lintCsp(parseCsp("default-src 'self'")), 'report-only-only'), undefined);
});

// ---------------------------------------------------------------- gradeSecurityHeaders

test('gradeSecurityHeaders: IOI is an A (six present, unsafe-inline/eval; frame-ancestors stands in for XFO)', () => {
  const g = gradeSecurityHeaders(IOI);
  assert.equal(g.grade, 'A');
  assert.equal(g.xfoViaCsp, true);
  assert.equal(g.present.length, 6);
  assert.deepEqual(g.missing, []);
  assert.ok(g.warnings.some((w) => /unsafe-inline/.test(w)));
  assert.ok(g.warnings.some((w) => /unsafe-eval/.test(w)));
  assert.ok(g.notes.some((n) => /www\.google\.com/.test(n)), 'bypass host is a note, not a grade warning');
  assert.ok(g.notes.some((n) => /frame-ancestors/.test(n)));
});

test('gradeSecurityHeaders: browser.style is an A+ and its script-free CSP is only a note', () => {
  const g = gradeSecurityHeaders(BS);
  assert.equal(g.grade, 'A+');
  assert.equal(g.xfoViaCsp, false);
  assert.deepEqual(g.warnings, []);
  assert.deepEqual(g.missing, []);
  assert.ok(g.notes.some((n) => /does not restrict scripts/.test(n)));
});

test('gradeSecurityHeaders: browser.style without permissions-policy is a B, {} is an F', () => {
  const { 'permissions-policy': _omit, ...five } = BS;
  const g = gradeSecurityHeaders(five);
  assert.equal(g.grade, 'B');
  assert.deepEqual(g.missing, ['permissions-policy']);
  const f = gradeSecurityHeaders({});
  assert.equal(f.grade, 'F');
  assert.deepEqual(f.present, []);
  assert.equal(f.missing.length, 6);
  assert.equal(f.xfoViaCsp, false);
});

test('gradeSecurityHeaders: empty values, report-only CSP and a non-nosniff value do not count', () => {
  const g = gradeSecurityHeaders({
    'strict-transport-security': '',
    'content-security-policy-report-only': "default-src 'self'",
    'x-content-type-options': 'sniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'permissions-policy': ' ',
  });
  assert.deepEqual(g.present, ['x-frame-options', 'referrer-policy']);
  assert.equal(g.grade, 'E');
  assert.ok(g.notes.some((n) => /report-only/.test(n)));
  assert.ok(g.notes.some((n) => /nosniff/.test(n)));
});

test('gradeSecurityHeaders: short HSTS and unsafe-url referrer are warnings that cost the plus', () => {
  const short = gradeSecurityHeaders({ ...BS, 'strict-transport-security': 'max-age=300' });
  assert.equal(short.grade, 'A');
  assert.ok(short.warnings.some((w) => /max-age/.test(w)));
  const unsafe = gradeSecurityHeaders({ ...BS, 'referrer-policy': 'unsafe-url' });
  assert.equal(unsafe.grade, 'A');
  assert.ok(unsafe.warnings.some((w) => /unsafe-url/.test(w)));
  const fallback = gradeSecurityHeaders({ ...BS, 'referrer-policy': 'unsafe-url, strict-origin-when-cross-origin' });
  assert.equal(fallback.grade, 'A+', 'the last recognised token is the one browsers use');
});

test('GRADE_TABLE covers 0..6 and GRADE_NOTE says the grade is an estimate', () => {
  for (let n = 0; n <= 6; n++) assert.ok(GRADE_TABLE[n], `row ${n}`);
  assert.equal(GRADE_TABLE[6].clean, 'A+');
  assert.equal(GRADE_TABLE[6].warned, 'A');
  assert.equal(GRADE_TABLE[5].clean, 'B');
  assert.equal(GRADE_TABLE[1].clean, 'F');
  assert.match(GRADE_NOTE, /securityheaders\.com/);
});

// ---------------------------------------------------------------- cookies

test('parseSetCookie: the two real IOI cookies', () => {
  const a = parseSetCookie(IOI_COOKIES[0]);
  assert.equal(a.name, 'i18n_redirected');
  assert.equal(a.value, 'en');
  assert.equal(a.secure, false);
  assert.equal(a.httpOnly, false);
  assert.equal(a.sameSite, 'lax');
  assert.equal(a.domain, null);
  assert.equal(a.path, '/');
  assert.match(a.expires, /2027/);
  assert.equal(a.maxAge, null);
  assert.equal(a.session, false);
  assert.equal(a.raw, IOI_COOKIES[0]);
  const b = parseSetCookie(IOI_COOKIES[1]);
  assert.equal(b.name, '__cf_bm');
  assert.equal(b.secure, true);
  assert.equal(b.httpOnly, true);
  assert.equal(b.sameSite, 'none');
  assert.equal(b.domain, 'ondigitalocean.app');
});

test('parseSetCookie: Max-Age, session cookies, dotted Domain, odd SameSite, a value with "="', () => {
  const c = parseSetCookie('sid=a=b; Max-Age=3600; Domain=.Example.COM; SameSite=Weird; HttpOnly');
  assert.equal(c.value, 'a=b');
  assert.equal(c.maxAge, 3600);
  assert.equal(c.session, false);
  assert.equal(c.domain, 'example.com');
  assert.equal(c.sameSite, null);
  assert.equal(c.httpOnly, true);
  const s = parseSetCookie('flag=1');
  assert.equal(s.session, true);
  assert.equal(s.path, null);
  assert.equal(s.expires, null);
  assert.equal(parseSetCookie('bare').name, '');
  assert.equal(parseSetCookie('bare').value, 'bare');
});

test('lintCookies: IOI — i18n_redirected lacks Secure and HttpOnly; __cf_bm is Cloudflare\'s, not the site\'s', () => {
  const out = lintCookies(IOI_COOKIES.map(parseSetCookie), { https: true, host: IOI_HOST });
  const i18n = out.filter((f) => f.name === 'i18n_redirected');
  assert.deepEqual(i18n.map((f) => [f.code, f.severity]), [['no-secure', 'warn'], ['no-httponly', 'info']]);
  const cf = out.filter((f) => f.name === '__cf_bm');
  assert.deepEqual(cf.map((f) => [f.code, f.severity]), [['cdn-cookie', 'info']]);
});

test('lintCookies: sensitive names, SameSite=None without Secure, no SameSite, http, foreign Domain, prefixes', () => {
  const lint = (s, o = { https: true, host: 'www.example.com' }) => lintCookies([s], o);
  assert.equal(find(lint('.AspNetCore.Session=x; Secure; SameSite=Lax'), 'no-httponly').severity, 'warn');
  assert.equal(find(lint('UMB_UCONTEXT=x; Secure; SameSite=Lax'), 'no-httponly').severity, 'warn');
  assert.equal(find(lint('theme=dark; Secure; SameSite=Lax'), 'no-httponly').severity, 'info');
  assert.equal(find(lint('a=1; SameSite=None; HttpOnly'), 'samesite-none-insecure').severity, 'fail');
  assert.equal(find(lint('a=1; Secure; HttpOnly'), 'no-samesite').severity, 'info');
  assert.equal(find(lint('a=1; HttpOnly; SameSite=Lax', { https: false, host: 'example.com' }), 'no-secure'), undefined);
  assert.deepEqual(codes(lint('a=1; Domain=other.com; Secure; HttpOnly; SameSite=Lax')), ['cdn-cookie']);
  assert.deepEqual(codes(lint('a=1; Domain=example.com; Secure; HttpOnly; SameSite=Lax')), [], 'a parent domain is the site\'s own');
  assert.deepEqual(codes(lint('AWSALBCORS=x')), ['cdn-cookie']);
  assert.deepEqual(codes(lint('ARRAffinitySameSite=x')), ['cdn-cookie']);
  assert.deepEqual(codes(lint('incap_ses_123=x')), ['cdn-cookie']);
  assert.deepEqual(codes(lintCookies(['visid_incap_1=x'])), ['cdn-cookie'], 'raw strings are parsed');
  for (const f of lint('a=1; SameSite=None')) assert.ok(f.name && f.code && f.text && ['fail', 'warn', 'info'].includes(f.severity));
});

// ---------------------------------------------------------------- info leaks

test('infoLeakHeaders: IOI leaks x-powered-by, cloudflare without a version is not a leak', () => {
  const out = infoLeakHeaders(IOI);
  assert.deepEqual(out.map((l) => [l.header, l.value]), [['x-powered-by', 'Nuxt']]);
  assert.ok(out[0].text.length > 10);
  assert.deepEqual(infoLeakHeaders(BS), []);
});

test('infoLeakHeaders: server versions and the ASP.NET / generator headers', () => {
  const out = infoLeakHeaders({
    server: 'nginx/1.18.0', 'x-aspnet-version': '4.0.30319', 'x-aspnetmvc-version': '5.2',
    'x-generator': 'Drupal 10', 'x-umbraco-version': '13.0.0', 'x-powered-by': '',
  });
  assert.deepEqual(out.map((l) => l.header), ['server', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator', 'x-umbraco-version']);
  assert.deepEqual(infoLeakHeaders({ server: 'Apache' }), []);
  assert.deepEqual(infoLeakHeaders({ server: 'Microsoft-IIS/10.0' }).map((l) => l.header), ['server']);
  assert.deepEqual(infoLeakHeaders({}), []);
});

// ---------------------------------------------------------------- caching

test('parseCacheControl: the two real values and the common shapes', () => {
  const ioi = parseCacheControl(IOI['cache-control']);
  assert.equal(ioi.sMaxAge, 600);
  assert.equal(ioi.maxAge, null);
  assert.equal(ioi.staleWhileRevalidate, null, 'present without a value');
  assert.equal(ioi.directives['stale-while-revalidate'], true);
  assert.equal(parseCacheControl(BS['cache-control']).maxAge, 1800);
  const asset = parseCacheControl('public, max-age=31536000, immutable, stale-while-revalidate=60');
  assert.deepEqual(asset, {
    directives: { public: true, 'max-age': '31536000', immutable: true, 'stale-while-revalidate': '60' },
    maxAge: 31536000, sMaxAge: null, noStore: false, noCache: false, private: false, public: true, immutable: true, staleWhileRevalidate: 60,
  });
  const none = parseCacheControl('no-store, no-cache="set-cookie", private');
  assert.equal(none.noStore, true);
  assert.equal(none.noCache, true);
  assert.equal(none.private, true);
  const empty = parseCacheControl('');
  assert.deepEqual(empty, { directives: {}, maxAge: null, sMaxAge: null, noStore: false, noCache: false, private: false, public: false, immutable: false, staleWhileRevalidate: null });
  assert.deepEqual(parseCacheControl(undefined), empty);
});

test('lintAssetCaching: hashed, immutable, compressed script is ok', () => {
  const r = lintAssetCaching({
    url: 'https://example.com/_nuxt/entry.3f9a1b2c4d.js',
    headers: { 'cache-control': 'public, max-age=31536000, immutable', 'content-type': 'application/javascript; charset=utf-8', 'content-encoding': 'br' },
  });
  assert.deepEqual(r, { ok: true, maxAge: 31536000, immutable: true, hashed: true, compressed: true, contentType: 'application/javascript', issues: [] });
});

test('lintAssetCaching: short max-age, no cache-control, no-store, s-maxage, query versions', () => {
  const short = lintAssetCaching({ url: 'https://example.com/app.js', headers: { 'cache-control': 'max-age=1800', 'content-type': 'text/javascript', 'content-encoding': 'gzip' } });
  assert.equal(short.ok, false);
  assert.equal(short.hashed, false);
  assert.ok(short.issues.some((i) => /max-age/.test(i)));
  const none = lintAssetCaching({ url: 'https://example.com/app.js', headers: { 'content-type': 'text/javascript', 'content-encoding': 'gzip' } });
  assert.equal(none.ok, false);
  assert.equal(none.maxAge, null);
  assert.ok(none.issues.some((i) => /cache-control/i.test(i)));
  const store = lintAssetCaching({ url: 'https://example.com/a.css?v=12', headers: { 'cache-control': 'no-store', 'content-type': 'text/css', 'content-encoding': 'gzip' } });
  assert.equal(store.ok, false);
  assert.equal(store.hashed, true);
  const shared = lintAssetCaching({ url: 'https://example.com/a.css?h=abc', headers: { 'cache-control': 's-maxage=604800', 'content-type': 'text/css', 'content-encoding': 'zstd' } });
  assert.equal(shared.ok, true);
  assert.equal(shared.hashed, true);
  assert.equal(shared.compressed, true);
});

test('lintAssetCaching: uncompressed text is an issue, an uncompressed image is not', () => {
  const svg = lintAssetCaching({ url: 'https://example.com/logo.svg', headers: { 'cache-control': 'max-age=604800', 'content-type': 'image/svg+xml' } });
  assert.equal(svg.ok, true);
  assert.equal(svg.compressed, false);
  assert.ok(svg.issues.some((i) => /compress/i.test(i)));
  const img = lintAssetCaching({ url: 'https://example.com/hero.webp', headers: { 'cache-control': 'max-age=604800', 'content-type': 'image/webp' } });
  assert.deepEqual(img.issues, []);
  const font = lintAssetCaching({ url: 'https://example.com/fonts/inter.a1b2c3d4e5f6.woff2', headers: { 'cache-control': 'max-age=31536000, immutable', 'content-type': 'font/woff2' } });
  assert.equal(font.hashed, true);
  assert.deepEqual(font.issues, []);
});

// ---------------------------------------------------------------- hsts, cors, cross-origin

test('parseHsts', () => {
  assert.deepEqual(parseHsts(BS['strict-transport-security']), { maxAge: 31536000, includeSubDomains: true, preload: true });
  assert.deepEqual(parseHsts('max-age=300'), { maxAge: 300, includeSubDomains: false, preload: false });
  assert.deepEqual(parseHsts('MAX-AGE=10; IncludeSubDomains'), { maxAge: 10, includeSubDomains: true, preload: false });
  assert.deepEqual(parseHsts('includeSubDomains'), { maxAge: null, includeSubDomains: true, preload: false });
  assert.equal(parseHsts(''), null);
  assert.equal(parseHsts(undefined), null);
});

test('corsVerdict', () => {
  assert.deepEqual(corsVerdict({}), { status: 'pass', text: 'no CORS header' });
  assert.equal(corsVerdict(BS).status, 'info');
  assert.equal(corsVerdict({ 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }).status, 'fail');
  assert.equal(corsVerdict({ 'access-control-allow-origin': 'https://app.example.com' }).status, 'info');
  assert.equal(corsVerdict({ 'access-control-allow-origin': 'null' }).status, 'fail');
  for (const h of [{}, BS, { 'access-control-allow-origin': 'null' }]) assert.ok(corsVerdict(h).text.length > 5);
});

test('crossOriginPolicies', () => {
  assert.deepEqual(crossOriginPolicies({}), { coop: null, coep: null, corp: null });
  assert.deepEqual(crossOriginPolicies({
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-site',
  }), { coop: 'same-origin', coep: 'require-corp', corp: 'same-site' });
});
