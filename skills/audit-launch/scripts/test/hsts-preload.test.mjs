import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHstsHeader, headerEligibility, chromiumLookup, preloadLookup, preloadVerdict, CHROMIUM_LIST_URL } from '../lib/hsts-preload.mjs';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GOOD = 'max-age=31536000; includeSubDomains; preload';

test('audit-launch and audit-infra carry the same hsts-preload.mjs', () => {
  const read = (s) => fs.readFileSync(path.join(SKILLS, s, 'scripts', 'lib', 'hsts-preload.mjs'), 'utf8');
  assert.equal(read('audit-infra'), read('audit-launch'), "audit-infra's copy differs from audit-launch's");
});

test('parseHstsHeader and headerEligibility: the three header requirements', () => {
  assert.equal(parseHstsHeader(''), null);
  assert.deepEqual(parseHstsHeader('MAX-AGE="10"; IncludeSubDomains'), { maxAge: 10, includeSubDomains: true, preload: false });
  assert.deepEqual(headerEligibility(GOOD), { eligible: true, issues: [] });
  const weak = headerEligibility('max-age=300');
  assert.equal(weak.issues.length, 3);
  assert.match(weak.issues[0], /max-age 300/);
  assert.match(weak.issues[1], /includeSubDomains/);
  assert.match(weak.issues[2], /preload/);
  assert.match(headerEligibility(undefined).issues[0], /no Strict-Transport-Security/);
  assert.equal(headerEligibility({ maxAge: 63072000, includeSubDomains: true, preload: true }).eligible, true, 'a parsed object works too');
});

const LIST = `// comment
{
  // "entries" is a list
  "entries": [
    { "name": "stoumann.dk", "policy": "bulk-1-year", "mode": "force-https", "include_subdomains": true },
    { "name": "only-apex.dk", "policy": "custom", "mode": "force-https" },
    { "name": "pinned.dk", "policy": "custom", "pins": "x" }
  ]
}`;

test('chromiumLookup: own entry, parents with include_subdomains, and pins-only entries', () => {
  assert.equal(chromiumLookup('stoumann.dk', LIST).preloadedDomain, 'stoumann.dk');
  assert.equal(chromiumLookup('www.stoumann.dk', LIST).preloadedDomain, 'stoumann.dk');
  assert.equal(chromiumLookup('only-apex.dk', LIST).found, true);
  assert.equal(chromiumLookup('www.only-apex.dk', LIST).found, false, 'a parent without include_subdomains does not cover the subdomain');
  assert.equal(chromiumLookup('pinned.dk', LIST).found, false, 'no force-https mode, not preloaded');
  assert.equal(chromiumLookup('example.com', LIST).found, false);
});

/** A fake fetch: routes[url prefix] -> { status, json } | { status, text } | Error. */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const r = routes[key];
    if (r instanceof Error) throw r;
    return { ok: (r.status ?? 200) < 300, status: r.status ?? 200, json: async () => r.json, text: async () => r.text };
  };
  f.calls = calls;
  return f;
}

test('preloadLookup: status for the host, preloadable for the apex', async () => {
  const fetch = fakeFetch({
    'https://hstspreload.org/api/v2/status': { json: { name: 'www.stoumann.dk', status: 'preloaded', bulk: false, preloadedDomain: 'stoumann.dk' } },
    'https://hstspreload.org/api/v2/preloadable': { json: { errors: [], warnings: [] } },
  });
  const r = await preloadLookup('www.stoumann.dk', { apex: 'stoumann.dk', fetch });
  assert.deepEqual([r.ok, r.source, r.status, r.preloadedDomain, r.error], [true, 'hstspreload.org', 'preloaded', 'stoumann.dk', undefined]);
  assert.ok(fetch.calls.includes('https://hstspreload.org/api/v2/status?domain=www.stoumann.dk'));
  assert.ok(fetch.calls.includes('https://hstspreload.org/api/v2/preloadable?domain=stoumann.dk'));
  assert.ok(!fetch.calls.some((u) => u.startsWith('https://chromium')), 'no fallback when hstspreload.org answers');
});

test('preloadLookup: falls back to the Chromium list when hstspreload.org is down', async () => {
  const fetch = fakeFetch({ [CHROMIUM_LIST_URL]: { text: Buffer.from(LIST).toString('base64').replace(/(.{76})/g, '$1\n') } });
  const r = await preloadLookup('www.stoumann.dk', { apex: 'stoumann.dk', fetch });
  assert.deepEqual([r.ok, r.source, r.status, r.preloadedDomain], [true, 'chromium', 'preloaded', 'stoumann.dk']);
  assert.match(r.error, /hstspreload\.org status: ENOTFOUND/);
  const miss = await preloadLookup('example.com', { fetch });
  assert.equal(miss.status, 'unknown');
  const off = await preloadLookup('example.com', { fetch: fakeFetch({}) });
  assert.equal(off.ok, false);
  assert.match(off.error, /Chromium list: ENOTFOUND/);
  const noFallback = await preloadLookup('example.com', { fetch, chromium: false });
  assert.equal(noFallback.ok, false);
});

test('preloadVerdict: pass, warn, info and skip', () => {
  const look = (o) => ({ ok: true, source: 'hstspreload.org', status: 'unknown', preloadedDomain: null, errors: [], warnings: [], ...o });
  const pre = preloadVerdict({ host: 'www.stoumann.dk', header: GOOD, lookup: look({ status: 'preloaded', preloadedDomain: 'stoumann.dk' }) });
  assert.equal(pre.status, 'pass');
  assert.match(pre.text, /^preloaded via stoumann\.dk \(hstspreload\.org\)/);
  assert.equal(pre.fix, '');

  const dropped = preloadVerdict({ host: 'x.dk', header: 'max-age=31536000', lookup: look({ status: 'preloaded', preloadedDomain: 'x.dk' }) });
  assert.equal(dropped.status, 'warn');
  assert.match(dropped.text, /includeSubDomains missing, preload directive missing/);

  assert.equal(preloadVerdict({ host: 'x.dk', header: GOOD, lookup: look({ status: 'pending' }) }).status, 'info');
  assert.equal(preloadVerdict({ host: 'x.dk', header: GOOD, lookup: look({ status: 'pending', errors: [{ summary: 'No redirect from HTTP' }] }) }).status, 'warn');

  const not = preloadVerdict({ host: 'x.dk', header: GOOD, lookup: look({}) });
  assert.deepEqual([not.status, /not on the preload list/.test(not.text), /submit the apex/.test(not.fix)], ['info', true, true]);
  const errs = preloadVerdict({ host: 'x.dk', header: undefined, lookup: look({ errors: [{ summary: 'No HSTS header' }] }) });
  assert.match(errs.text, /hstspreload\.org reports: No HSTS header/);

  assert.match(preloadVerdict({ host: 'x.dk', header: GOOD, lookup: look({ source: 'chromium', status: 'preloaded', preloadedDomain: 'x.dk' }) }).text, /Chromium preload list/);
  const skip = preloadVerdict({ host: 'x.dk', header: GOOD, lookup: { ok: false, error: 'offline' } });
  assert.deepEqual([skip.status, /offline/.test(skip.text)], ['skip', true]);
});
