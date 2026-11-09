import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteUrl, envHeaders, launchArgs, frameAncestors, blocklistRows, diffRows, runSite, renderSiteMarkdown, SITE_GROUPS, LAUNCH_SCRIPT } from '../lib/site.mjs';
import { parseArgs, resolveSiteStateDir, resolveSiteBaseline } from '../scan.mjs';
import { parseLevel } from '../lib/levels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(HERE, '..', '..', '..');

test('parseArgs: a URL (or --url) is site mode with its own groups and --header', () => {
  const a = parseArgs(['https://www.example.com', '--only', 'headers,blocklists', '--header', 'X-Bypass: abc']);
  assert.equal(a.mode, 'site');
  assert.deepEqual(a.only, ['headers', 'blocklists']);
  assert.deepEqual(a.headers, { 'X-Bypass': 'abc' });
  assert.equal(parseArgs(['--url', 'http://example.com/']).mode, 'site');
  assert.equal(parseArgs(['.']).mode, 'code');
  assert.equal(parseArgs(['./site']).mode, 'code');
  assert.throws(() => parseArgs(['https://example.com', '--only', 'secrets']), /Unknown group "secrets"\. Groups: headers redirects exposed blocklists/);
  assert.throws(() => parseArgs(['.', '--only', 'headers']), /Unknown group "headers"/);
  assert.throws(() => parseArgs(['ftp://example.com']), /http or https URL/);
  assert.equal(siteUrl('example.com'), null);
});

test('launchArgs: audit-launch runs only its header, redirect and exposed groups, with its own state folder', () => {
  assert.deepEqual(launchArgs({ url: 'https://example.com/', outDir: '/o', stateDir: '/s', headers: ['X-Bypass: 1'], noBaseline: true }), [
    'https://example.com/', '--only', 'redirects,exposed,headers', '--out', '/o', '--state', '/s', '--quiet', '--no-baseline', '--header', 'X-Bypass: 1',
  ]);
  assert.ok(fs.existsSync(LAUNCH_SCRIPT), 'audit-launch sits next to audit-security');
});

test('frameAncestors: CSP frame-ancestors wins, X-Frame-Options alone is a warning, neither fails', () => {
  assert.equal(frameAncestors({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }).status, 'pass');
  assert.equal(frameAncestors({ 'content-security-policy': 'frame-ancestors *' }).status, 'fail');
  assert.equal(frameAncestors({ 'content-security-policy': 'frame-ancestors https:' }).status, 'fail');
  const xfo = frameAncestors({ 'x-frame-options': 'DENY' });
  assert.equal(xfo.status, 'warn');
  assert.match(xfo.evidence, /X-Frame-Options DENY only/);
  assert.match(frameAncestors({ 'x-frame-options': 'DENY', 'content-security-policy-report-only': "frame-ancestors 'none'" }).evidence, /report-only CSP enforces nothing/);
  assert.equal(frameAncestors({ 'x-frame-options': 'ALLOW-FROM https://example.org' }).status, 'fail');
  assert.equal(frameAncestors({}).status, 'fail');
  assert.equal(frameAncestors({}).id, 'headers.frame-ancestors');
});

test('blocklistRows: listed is a blocker, a missing key is a skip, never a pass', () => {
  const rows = blocklistRows({
    openphish: { ok: true, hits: [] },
    safeBrowsing: { ok: false, skipped: 'no GOOGLE_SAFE_BROWSING_KEY' },
    urlhaus: { ok: true, listed: true, urls: 3, online: 1, tags: ['exe'] },
    virusTotal: { ok: false, error: 'HTTP 429' },
  }, 'www.example.com');
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [['blocklists.openphish', 'pass'], ['blocklists.safe-browsing', 'skip'], ['blocklists.urlhaus', 'fail'], ['blocklists.virustotal', 'skip']]);
  assert.equal(rows[2].blocker, true);
  assert.equal(blocklistRows({ openphish: { ok: true, hits: ['https://www.example.com/login.php'] } }, 'www.example.com')[0].status, 'fail');
});

test('diffRows: new, worse and fixed by id and subject', () => {
  const prev = { results: [{ id: 'headers.csp', status: 'fail' }, { id: 'headers.hsts', status: 'pass' }, { id: 'exposed.security-txt', status: 'warn' }] };
  const cur = { results: [{ id: 'headers.csp', status: 'pass' }, { id: 'headers.hsts', status: 'warn' }, { id: 'exposed.security-txt', status: 'fail' }] };
  const d = diffRows(prev, cur);
  assert.deepEqual(d.new.map((r) => r.id), ['headers.hsts']);
  assert.deepEqual(d.worse.map((r) => r.id), ['exposed.security-txt']);
  assert.deepEqual(d.fixed.map((r) => r.id), ['headers.csp']);
});

const LAUNCH = {
  tool: 'audit-launch', version: '2.4.4', input: { env: 'production', production: true }, site: { finalUrl: 'https://www.example.com/' },
  results: [
    { id: 'redirects.http-to-https', group: 'redirects', status: 'pass', title: 'HTTP → HTTPS', evidence: 'http://example.com/ → https://www.example.com/ (301→200, 1 hop)' },
    { id: 'headers.csp', group: 'headers', status: 'fail', title: 'Content-Security-Policy', evidence: 'missing', fix: 'Add one.' },
    { id: 'headers.cookies', group: 'headers', status: 'warn', title: 'Cookies on first response', evidence: '1 cookie(s): sid — sid: no HttpOnly' },
    { id: 'exposed.security-txt', group: 'exposed', status: 'info', title: 'security.txt', evidence: 'no /.well-known/security.txt' },
  ],
};

test('runSite: audit-launch\'s rows, the clickjacking row and the blocklists, in one report', async () => {
  const calls = [];
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-site-'));
  const deps = {
    runLaunch: (o) => { calls.push(o); return { ok: true, report: LAUNCH }; },
    pageHeaders: async () => ({ 'x-frame-options': 'SAMEORIGIN' }),
    checkBlocklists: async () => blocklistRows({ openphish: { ok: true, hits: [] } }, 'www.example.com'),
  };
  const r = await runSite({ root: 'https://example.com', only: null, skip: [], headers: { 'X-Bypass': '1' } }, { version: '2.2.0', outDir: out, stateDir: path.join(out, 'state'), deps });
  assert.equal(calls[0].groups.join(','), 'redirects,exposed,headers');
  assert.deepEqual(calls[0].headers, ['X-Bypass: 1']);
  assert.equal(calls[0].stateDir, path.join(out, 'state', 'audit-launch'));
  assert.deepEqual(r.results.map((x) => x.id), ['redirects.http-to-https', 'headers.csp', 'headers.cookies', 'exposed.security-txt', 'headers.frame-ancestors', 'blocklists.openphish']);
  assert.deepEqual(r.counts, { pass: 2, warn: 2, fail: 1, info: 1, skip: 0 });
  assert.equal(r.mode, 'site');
  assert.equal(r.site.host, 'www.example.com');
  const md = renderSiteMarkdown(r);
  assert.match(md, /^# Security audit \(site\) — www\.example\.com\n/);
  assert.match(md, /\*\*Result:\*\* 2 pass · 2 warn · 1 fail · 1 info · 0 skipped/);
  assert.match(md, /## Fix first\n\n- ❌ \*\*Content-Security-Policy\*\*/);
  for (const h of ['## Security headers', '## HTTPS and redirects', '## Exposed files and admin paths', '## Blocklists', '## Not covered']) assert.ok(md.includes(h), h);
  assert.doesNotMatch(md, /repository and its git history/);
  // --level error keeps the counts and shows only the failures.
  const errors = renderSiteMarkdown(r, { levels: parseLevel('error') });
  assert.match(errors, /\*\*Result:\*\* 2 pass · 2 warn · 1 fail/);
  assert.doesNotMatch(errors, /Cookies on first response/);
});

test('runSite: --only blocklists skips audit-launch; a missing audit-launch is a skip row, not a crash', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-site-'));
  let launched = false;
  const r = await runSite({ root: 'https://www.example.com/', only: ['blocklists'], skip: [] }, { version: '2.2.0', outDir: out, stateDir: out, deps: { runLaunch: () => { launched = true; }, checkBlocklists: async () => [] } });
  assert.equal(launched, false);
  assert.deepEqual(r.input.groups, ['blocklists']);
  const r2 = await runSite({ root: 'https://www.example.com/', only: null, skip: ['blocklists'] }, { version: '2.2.0', outDir: out, stateDir: out, deps: { runLaunch: () => ({ ok: false, error: 'the audit-launch skill is not installed next to audit-security' }), pageHeaders: async () => ({}) } });
  assert.equal(r2.results[0].status, 'skip');
  assert.match(r2.results[0].evidence, /not installed/);
  const off = await runSite({ root: 'https://www.example.com/', only: ['blocklists'], skip: [], offline: true }, { version: '2.2.0', outDir: out, stateDir: out });
  assert.equal(off.results[0].status, 'skip');
  assert.deepEqual(SITE_GROUPS, ['headers', 'redirects', 'exposed', 'blocklists']);
});

test('site target folder is per host; the baseline is the last site scan', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-site-'));
  const dir = resolveSiteStateDir(null, 'https://www.example.com/path', { base });
  assert.equal(dir, path.join(base, 'audit-security', 'www.example.com'));
  assert.equal(resolveSiteBaseline({}, dir), null);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'last-report.json'), '{}');
  assert.equal(resolveSiteBaseline({}, dir), path.join(dir, 'last-report.json'));
  assert.equal(resolveSiteBaseline({ noBaseline: true }, dir), null);
});

test('sources.mjs and target.mjs are identical to is-website-safe\'s copies', () => {
  for (const f of ['sources.mjs', 'target.mjs']) {
    assert.equal(fs.readFileSync(path.join(HERE, '..', 'lib', f), 'utf8'), fs.readFileSync(path.join(SKILLS, 'is-website-safe', 'scripts', 'lib', f), 'utf8'), f);
  }
});

test('envHeaders: AUDIT_HEADERS reach the clickjacking request too', async () => {
  assert.deepEqual(envHeaders({ AUDIT_HEADERS: 'x-audit-bypass: abc\nX-Other: 1\nbroken' }), { 'x-audit-bypass': 'abc', 'X-Other': '1' });
  assert.deepEqual(envHeaders({}), {});
  let sent;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-site-'));
  await runSite({ root: 'https://www.example.com/', only: ['headers'], skip: [], headers: { 'X-Flag': '2' } }, { version: '2.2.1', outDir: out, stateDir: out, deps: { env: { AUDIT_HEADERS: 'x-audit-bypass: abc' }, runLaunch: () => ({ ok: true, report: LAUNCH }), pageHeaders: async (u, o) => { sent = o.headers; return {}; } } });
  assert.deepEqual(sent, { 'x-audit-bypass': 'abc', 'X-Flag': '2' });
});
