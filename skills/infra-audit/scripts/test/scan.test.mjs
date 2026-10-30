import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { parseDoh, unquoteTxt, apexOf, parseCaa, parseSoa, parseMx, createResolver } from '../lib/dns.mjs';
import { spfTree, judgeSpf, dmarc, dkimKeyBits, stsCovers } from '../lib/email.mjs';
import { sanCovers, caaAllows, daysLeft } from '../lib/tls.mjs';
import { parseCrtSh, parseRdap, normSerial } from '../lib/services.mjs';
import { detectCdn, domainChecks, emailChecks } from '../lib/checks.mjs';
import fs from 'node:fs';
import os from 'node:os';
import { reportsRoot, prepareRun, finishRun, diffRows, carryOverSections, taskCandidates, result } from '../lib/common.mjs';
import { parseArgs, parseTarget, siblingOf, markIntercepted, renderMarkdown, run } from '../scan.mjs';

/** A resolver over a fixed zone: { 'name TYPE': [data] }, NXDOMAIN for names not in it. */
function fakeResolver(zone) {
  const names = new Set(Object.keys(zone).map((k) => k.split(' ')[0]));
  const query = async (name, type = 'A') => {
    const data = zone[`${name} ${type}`];
    if (data === 'SERVFAIL') return { ok: false, rcode: 'SERVFAIL', nxdomain: false, ad: false, answers: [], error: 'SERVFAIL' };
    return { ok: true, rcode: names.has(name) ? 'NOERROR' : 'NXDOMAIN', nxdomain: !names.has(name), ad: Boolean(zone.AD), answers: (data || []).map((d) => ({ name, type, ttl: 300, data: d })) };
  };
  return { query, records: async (n, t) => (await query(n, t)).answers.map((a) => a.data) };
}

// ---------------------------------------------------------------- DNS parsing

test('parseDoh reads answers, joins TXT chunks and flags NXDOMAIN', () => {
  const r = parseDoh({ Status: 0, AD: true, Answer: [{ name: 'x.dk.', type: 16, TTL: 60, data: '"v=spf1 " "-all"' }, { name: 'x.dk.', type: 1, TTL: 60, data: '1.2.3.4' }] });
  assert.equal(r.ok, true);
  assert.equal(r.ad, true);
  assert.deepEqual(r.answers.map((a) => [a.type, a.data]), [['TXT', 'v=spf1 -all'], ['A', '1.2.3.4']]);
  assert.equal(parseDoh({ Status: 3 }).nxdomain, true);
  assert.equal(parseDoh({ Status: 2 }).ok, false);
  assert.equal(unquoteTxt('plain'), 'plain');
});

test('apexOf handles plain and two-label suffixes', () => {
  assert.equal(apexOf('www.glyptoteket.dk'), 'glyptoteket.dk');
  assert.equal(apexOf('shop.example.co.uk'), 'example.co.uk');
  assert.equal(apexOf('example.com.'), 'example.com');
});

test('record parsers', () => {
  assert.deepEqual(parseCaa('0 issue "letsencrypt.org"'), { flags: 0, tag: 'issue', value: 'letsencrypt.org' });
  assert.deepEqual(parseMx('10 mx1.example.com.'), { priority: 10, exchange: 'mx1.example.com' });
  assert.equal(parseSoa('ns1.x. hostmaster.x. 2024010101 7200 3600 1209600 300').serial, 2024010101);
});

test('createResolver falls back from Cloudflare to Google and caches', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('cloudflare')) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return { ok: true, json: async () => ({ Status: 0, Answer: [{ name: 'a.dk.', type: 1, TTL: 5, data: '9.9.9.9' }] }) };
  };
  const r = createResolver({ fetch });
  assert.deepEqual(await r.records('a.dk', 'A'), ['9.9.9.9']);
  await r.query('a.dk', 'A');
  assert.equal(calls.length, 2);
});

// ---------------------------------------------------------------- email

test('spfTree counts lookups through includes and finds void includes', async () => {
  const r = fakeResolver({
    'x.dk TXT': ['v=spf1 include:_spf.google.com include:gone.example mx -all', 'google-site-verification=abc'],
    '_spf.google.com TXT': ['v=spf1 include:_netblocks.google.com include:_netblocks2.google.com ~all'],
    '_netblocks.google.com TXT': ['v=spf1 ip4:1.2.3.0/24 ~all'],
    '_netblocks2.google.com TXT': ['v=spf1 ip6:2001:db8::/32 ~all'],
  });
  const t = await spfTree('x.dk', r);
  assert.equal(t.terminal, '-all');
  assert.equal(t.lookups, 5); // two includes + mx at the top, two nested includes
  assert.equal(t.voids, 1);
  assert.equal(judgeSpf(t, { hasMx: true }).status, 'warn');
});

test('judgeSpf: over ten lookups and +all fail; none with MX warns', async () => {
  const many = Array.from({ length: 11 }, (_, i) => `include:i${i}.dk`).join(' ');
  const zone = { 'x.dk TXT': [`v=spf1 ${many} -all`] };
  for (let i = 0; i < 11; i++) zone[`i${i}.dk TXT`] = ['v=spf1 ip4:1.1.1.1 -all'];
  assert.equal(judgeSpf(await spfTree('x.dk', fakeResolver(zone)), { hasMx: true }).status, 'fail');
  assert.equal(judgeSpf(await spfTree('x.dk', fakeResolver({ 'x.dk TXT': ['v=spf1 +all'] })), { hasMx: true }).status, 'fail');
  assert.equal(judgeSpf(await spfTree('x.dk', fakeResolver({ 'x.dk TXT': [] })), { hasMx: true }).status, 'warn');
  assert.equal(judgeSpf(await spfTree('x.dk', fakeResolver({ 'x.dk TXT': ['v=spf1 -all', 'v=spf1 ~all'] })), { hasMx: false }).status, 'fail');
});

test('dmarc: policy, external report authorisation', async () => {
  const ok = await dmarc('x.dk', fakeResolver({
    '_dmarc.x.dk TXT': ['v=DMARC1; p=reject; rua=mailto:r@reports.example'],
    'x.dk._report._dmarc.reports.example TXT': ['v=DMARC1'],
  }), { hasMx: true });
  assert.equal(ok.status, 'pass');
  const unauth = await dmarc('x.dk', fakeResolver({ '_dmarc.x.dk TXT': ['v=DMARC1; p=quarantine; rua=mailto:r@reports.example'], 'reports.example A': ['1.1.1.1'] }), { hasMx: true });
  assert.equal(unauth.status, 'warn');
  assert.match(unauth.fix, /_report\._dmarc/);
  assert.equal((await dmarc('x.dk', fakeResolver({ '_dmarc.x.dk TXT': ['v=DMARC1; p=none'] }), { hasMx: true })).status, 'warn');
  assert.equal((await dmarc('x.dk', fakeResolver({}), { hasMx: true })).status, 'fail');
});

test('dkimKeyBits estimates RSA key size from p=', () => {
  const key = (bytes) => `v=DKIM1; k=rsa; p=${Buffer.alloc(bytes, 1).toString('base64')}`;
  assert.equal(dkimKeyBits(key(162)).bits, 1024);
  assert.equal(dkimKeyBits(key(294)).bits, 2048);
  assert.equal(dkimKeyBits('v=DKIM1; p=').revoked, true);
});

test('stsCovers matches one-label wildcards', () => {
  assert.equal(stsCovers(['*.mail.protection.outlook.com'], 'x-dk.mail.protection.outlook.com'), true);
  assert.equal(stsCovers(['mx.example.com'], 'mx2.example.com'), false);
});

// ---------------------------------------------------------------- TLS helpers

test('sanCovers, caaAllows, daysLeft', () => {
  assert.equal(sanCovers(['*.example.dk'], 'www.example.dk'), true);
  assert.equal(sanCovers(['*.example.dk'], 'example.dk'), false);
  assert.equal(caaAllows([{ tag: 'issue', value: 'letsencrypt.org' }], "Let's Encrypt R11").allowed, true);
  assert.equal(caaAllows([{ tag: 'issue', value: 'digicert.com' }], "Let's Encrypt").allowed, false);
  assert.equal(caaAllows([{ tag: 'iodef', value: 'mailto:a@b' }], "Let's Encrypt").allowed, null);
  assert.equal(daysLeft('2026-01-11T00:00:00Z', new Date('2026-01-01T00:00:00Z')), 10);
});

// ---------------------------------------------------------------- services

test('parseCrtSh keeps unexpired names under the domain', () => {
  const rows = [
    { name_value: 'a.x.dk\n*.x.dk', issuer_name: 'C=US, O=Let\'s Encrypt, CN=R11', not_after: '2099-01-01T00:00:00', serial_number: '00ab' },
    { name_value: 'old.x.dk', issuer_name: 'O=Old CA', not_after: '2001-01-01T00:00:00' },
    { name_value: 'other.com', issuer_name: 'O=Let\'s Encrypt', not_after: '2099-01-01T00:00:00' },
  ];
  const r = parseCrtSh(rows, 'x.dk');
  assert.deepEqual(r.names, ['*.x.dk', 'a.x.dk']);
  assert.equal(r.certs, 2);
  assert.ok(r.serials.has(normSerial('AB')));
});

test('parseRdap reads events, registrar and status', () => {
  const r = parseRdap({ events: [{ eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }], status: ['client transfer prohibited'], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Registrar A/S']]] }] });
  assert.equal(r.expires, '2027-01-01T00:00:00Z');
  assert.equal(r.registrar, 'Registrar A/S');
  assert.deepEqual(r.status, ['client transfer prohibited']);
});

test('detectCdn from response headers', () => {
  assert.equal(detectCdn({ 'cf-ray': 'abc' }), 'Cloudflare');
  assert.equal(detectCdn({ server: 'Vercel' }), 'Vercel');
  assert.equal(detectCdn({}), null);
});

// ---------------------------------------------------------------- groups with a fake zone

const ZONE = {
  AD: true,
  'x.dk A': ['1.2.3.4'], 'x.dk NS': ['ns1.dns.dk.'], 'x.dk MX': ['10 mx.x.dk.'], 'x.dk TXT': ['v=spf1 mx ?all'], 'x.dk DS': ['1 13 2 ABC'],
  'mx.x.dk A': ['1.2.3.5'],
  'old.x.dk CNAME': ['gone.azurewebsites.net.'],
};
const noFetch = async () => { throw new Error('offline'); };

test('domainChecks: one name server fails, no CAA warns, DNSSEC passes', async () => {
  const ctx = { resolver: fakeResolver(ZONE), host: 'x.dk', apex: 'x.dk', fetch: noFetch, now: new Date(), shared: {} };
  const rows = await domainChecks(ctx);
  const st = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.equal(st['dns.nameservers'], 'fail');
  assert.equal(st['dns.caa'], 'warn');
  assert.equal(st['dns.dnssec'], 'pass');
  assert.equal(st['domain.registration'], 'skip');
});

test('domainChecks flags a dangling CNAME on the host', async () => {
  const ctx = { resolver: fakeResolver(ZONE), host: 'old.x.dk', apex: 'x.dk', fetch: noFetch, now: new Date(), shared: {} };
  const d = (await domainChecks(ctx)).find((r) => r.id === 'dns.dangling');
  assert.equal(d.status, 'fail');
  assert.equal(d.blocker, true);
});

test('emailChecks: ?all warns, missing DMARC with MX fails', async () => {
  const ctx = { resolver: fakeResolver(ZONE), emailDomain: 'x.dk', fetch: noFetch, dkimSelectors: ['google'], shared: {} };
  const st = Object.fromEntries((await emailChecks(ctx)).map((r) => [r.id, r.status]));
  assert.equal(st['email.mx'], 'pass');
  assert.equal(st['email.spf'], 'fail');
  assert.equal(st['email.dmarc'], 'fail');
  assert.equal(st['email.mta-sts'], 'info');
});

test('run with --only domain,email writes a report with the result line and task candidates', async () => {
  const report = await run({ target: 'https://x.dk/', only: ['domain', 'email'], skip: [] }, { resolver: fakeResolver(ZONE), fetch: noFetch });
  const md = renderMarkdown(report);
  assert.match(md, /^# Infrastructure audit — x\.dk/);
  assert.match(md, /\*\*Result:\*\* \d+ pass · \d+ warn · \d+ fail/);
  const tasks = taskCandidates(report.results, { source: 'infra', ref: 'infra-audit/report.md' });
  assert.ok(tasks.length >= 3);
  assert.ok(tasks.every((t) => t.sources[0] === 'infra' && t.owner === 'human' && ['blocker', 'high', 'medium'].includes(t.severity)));
});

// ---------------------------------------------------------------- CLI and plumbing

test('parseArgs and parseTarget', () => {
  const a = parseArgs(['example.dk', '--dkim-selector', 'k1,k2', '--no-ct', '--header', 'X-Bypass: 1'], { AUDIT_HEADERS: 'X-Other: 2' });
  assert.deepEqual(a.selectors, ['k1', 'k2']);
  assert.equal(a.ct, false);
  assert.deepEqual(a.headers, { 'x-bypass': '1', 'x-other': '2' });
  assert.deepEqual(parseTarget('Example.DK/path'), { host: 'example.dk', url: 'https://example.dk/path' });
  assert.equal(siblingOf('example.dk', 'example.dk'), 'www.example.dk');
  assert.equal(siblingOf('shop.example.dk', 'example.dk'), null);
  assert.throws(() => parseArgs(['--bogus']));
});

test('markIntercepted turns certificate rows into skips', () => {
  const rows = markIntercepted([result('tls.expiry', 'warn', 'Expiry', '29 days'), result('tls.interception', 'warn', 'CT', 'x'), result('dns.caa', 'warn', 'CAA', 'none')]);
  assert.deepEqual(rows.map((r) => r.status), ['skip', 'warn', 'warn']);
});

test('report folder root: AUDIT_OUT_DIR, Downloads, ~/audit-reports', () => {
  const home = '/home/u';
  assert.equal(reportsRoot({ env: { AUDIT_OUT_DIR: '~/r' }, home }), path.resolve('/home/u/r'));
  assert.equal(reportsRoot({ env: {}, home, isDir: (p) => p === '/home/u/Downloads', readFile: () => null }), '/home/u/Downloads');
  assert.equal(reportsRoot({ env: {}, home, isDir: () => false, readFile: () => null }), '/home/u/audit-reports');
});

test('prepareRun: target folder, runs/<stamp>, notes and the last report as baseline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-state-'));
  const now = new Date(2026, 9, 30, 9, 27);
  const first = prepareRun({ skill: 'infra-audit', host: 'x.dk' }, { root, now });
  assert.equal(first.state, path.join(root, 'infra-audit', 'x.dk'));
  assert.equal(first.dir, path.join(first.state, 'runs', '20261030-0927'));
  assert.ok(fs.existsSync(path.join(first.dir, '.audit-run')));
  assert.equal(fs.readFileSync(path.join(first.state, 'target.txt'), 'utf8').trim(), 'x.dk');
  assert.equal(first.baselineFile, null);
  finishRun(first.state, { tool: 'infra-audit', results: [] });
  fs.writeFileSync(path.join(first.state, 'notes.md'), 'CAA is managed by the agency.\n');
  const out = path.join(root, 'audit-all', 'x.dk', 'runs', '1', 'infra-audit');
  const second = prepareRun({ skill: 'infra-audit', host: 'x.dk', out }, { root, now });
  assert.equal(second.dir, out);
  assert.ok(fs.existsSync(path.join(out, '.audit-run')));
  assert.equal(second.baselineFile, path.join(first.state, 'last-report.json'));
  assert.match(second.notes, /agency/);
});

test('diffRows and carryOverSections', () => {
  const prev = [result('dns.caa', 'warn', 'CAA', ''), result('email.spf', 'pass', 'SPF', ''), result('tls.expiry', 'fail', 'Expiry', '')];
  const now = [result('dns.caa', 'pass', 'CAA', ''), result('email.spf', 'fail', 'SPF', '')];
  const d = diffRows(prev, now);
  assert.deepEqual(d.fixed.map((r) => r.id), ['dns.caa', 'tls.expiry']);
  assert.deepEqual(d.regressed.map((r) => r.id), ['email.spf']);
  const md = carryOverSections({ notes: 'Hello', diff: { from: 'last-report.json', date: '2026-10-29T10:00:00Z', ...d } }).join('\n');
  assert.match(md, /## Notes\n\nHello/);
  assert.match(md, /## Since last run/);
  assert.match(md, /SPF: pass → fail/);
});
