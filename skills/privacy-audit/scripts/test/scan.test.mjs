import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyHost, classifyCookie, googleConsentState, detectCmp, siteApex } from '../lib/classify.mjs';
import { analyse, thirdParties, trackers, buttonParity } from '../lib/analyse.mjs';
import { findChrome, chromeArgs } from '../lib/cdp.mjs';
import { PATTERNS } from '../lib/inpage.mjs';
import { parseArgs, pickPages, pickPolicies, renderMarkdown } from '../scan.mjs';
import { taskCandidates, countStatuses } from '../lib/common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = (url, type = 'Script') => ({ url, type, phase: 'load', frame: 'top' });
const status = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.status]));
const BUTTON = (text, w = 200, h = 48, bg = 'rgb(200, 50, 50)') => ({ text, w, h, bg, color: '#fff', border: null });

// ---------------------------------------------------------------- classification

test('classifyHost: vendor, category and country', () => {
  assert.deepEqual(classifyHost('www.google-analytics.com'), { vendor: 'Google Analytics', category: 'analytics', country: 'US' });
  assert.equal(classifyHost('static.hotjar.com').category, 'session-replay');
  assert.equal(classifyHost('consent.cookiebot.com').category, 'consent');
  assert.equal(classifyHost('cdn.example.dk'), null);
});

test('classifyCookie: names, generic names only on their own domain, first party', () => {
  assert.equal(classifyCookie({ name: '_ga_ABC123', domain: '.shop.dk' }, 'www.shop.dk').purpose, 'statistics');
  assert.equal(classifyCookie({ name: '_fbp', domain: '.shop.dk' }, 'shop.dk').purpose, 'marketing');
  assert.equal(classifyCookie({ name: 'SID', domain: 'shop.dk' }, 'shop.dk').purpose, 'unclassified');
  assert.equal(classifyCookie({ name: 'SID', domain: '.google.com' }, 'shop.dk').purpose, 'marketing');
  assert.equal(classifyCookie({ name: 'CookieInformationConsent_xZ', domain: 'shop.dk' }, 'shop.dk').purpose, 'necessary');
  assert.equal(classifyCookie({ name: '__cf_bm', domain: '.shop.dk' }, 'shop.dk').purpose, 'necessary');
  assert.equal(classifyCookie({ name: 'whatever', domain: '.doubleclick.net' }, 'shop.dk').purpose, 'marketing');
  assert.equal(classifyCookie({ name: 'x', domain: '.shop.dk' }, 'www.shop.dk').firstParty, true);
});

test('googleConsentState reads gcs from the query and Floodlight paths', () => {
  assert.deepEqual(googleConsentState('https://region1.google-analytics.com/g/collect?v=2&gcs=G100'), { gcs: 'G100', ads: false, analytics: false, denied: true });
  assert.equal(googleConsentState('https://www.google-analytics.com/g/collect?gcs=G111').denied, false);
  assert.equal(googleConsentState('https://ade.googlesyndication.com/ddm/activity/src=1;npa=1;pscdl=denied;gcs=G100').denied, true);
  assert.equal(googleConsentState('https://www.googletagmanager.com/gtag/js?id=G-1'), null);
  assert.equal(googleConsentState('https://shop.dk/collect?gcs=G100'), null);
});

test('detectCmp and siteApex', () => {
  assert.equal(detectCmp('<script src="https://consent.cookiebot.com/uc.js">'), 'Cookiebot');
  assert.equal(detectCmp('https://policy.app.cookieinformation.com/uc.js'), 'Cookie Information');
  assert.equal(detectCmp('nothing'), null);
  assert.equal(siteApex('www.shop.co.uk'), 'shop.co.uk');
});

test('banner patterns: Danish and English accept/reject, reject wins', () => {
  const accept = new RegExp(PATTERNS.accept, 'i');
  const reject = new RegExp(PATTERNS.reject, 'i');
  for (const t of ['ACCEPTER ALLE', 'Tillad alle', 'Accept all cookies', 'OK']) assert.ok(accept.test(t), t);
  for (const t of ['AFVIS ALLE', 'Kun nødvendige', 'Tillad kun nødvendige', 'Reject all', 'Only necessary cookies']) assert.ok(reject.test(t), t);
});

// ---------------------------------------------------------------- analysis

test('thirdParties and trackers: denied-only Google hits are cookieless pings', () => {
  const parties = thirdParties([
    req('https://www.googletagmanager.com/gtag/js?id=G-1'),
    req('https://region1.google-analytics.com/g/collect?v=2&gcs=G100', 'Ping'),
    req('https://connect.facebook.net/en_US/fbevents.js'),
    req('https://www.shop.dk/app.js'),
    req('https://cdn.shop.dk/img.png', 'Image'),
  ], 'www.shop.dk');
  assert.deepEqual(parties.map((p) => p.host).sort(), ['connect.facebook.net', 'region1.google-analytics.com', 'www.googletagmanager.com']);
  const t = Object.fromEntries(trackers(parties).map((x) => [x.host, x.cookielessOnly]));
  assert.equal(t['region1.google-analytics.com'], true);
  assert.equal(t['connect.facebook.net'], false);
});

test('buttonParity: small or unfilled reject is flagged', () => {
  assert.deepEqual(buttonParity(BUTTON('Accept'), BUTTON('Reject')), []);
  assert.equal(buttonParity(BUTTON('Accept'), BUTTON('Reject', 80, 20)).length, 1);
  assert.equal(buttonParity(BUTTON('Accept'), BUTTON('Reject', 200, 48, 'rgba(0, 0, 0, 0)')).length, 1);
});

const BAD = {
  url: 'https://www.shop.dk/', host: 'www.shop.dk',
  first: {
    requests: [req('https://www.googletagmanager.com/gtm.js?id=GTM-1'), req('https://www.google-analytics.com/g/collect?gcs=G111', 'Ping'), req('https://fonts.googleapis.com/css2?family=Inter', 'Stylesheet'), req('https://www.youtube.com/embed/abc', 'Document')],
    cookies: [{ name: '_ga', domain: '.shop.dk' }, { name: 'ASP.NET_SessionId', domain: 'www.shop.dk' }, { name: 'mystery', domain: 'www.shop.dk' }],
    facts: { consent: [], globals: [], localStorage: ['_hjSession'], sessionStorage: [], policyLinks: [], forms: [{ action: 'https://forms.hubspot.com/x', personal: true, prechecked: 1 }] },
    banner: { found: true, text: 'We use cookies', accept: [BUTTON('Accept all')], reject: [], settings: [BUTTON('Settings', 80, 20, 'rgba(0, 0, 0, 0)')], checked: 2 },
    html: '<script src="https://consent.cookiebot.com/uc.js"></script>',
    pages: [],
  },
  reject: { choice: { method: 'second-layer', steps: ['opened "Settings"', 'clicked "Reject"'], prechecked: 0 }, requests: [req('https://connect.facebook.net/en_US/fbevents.js')], cookies: [{ name: '_fbp', domain: '.shop.dk' }] },
  accept: { choice: { method: 'first-layer', steps: ['clicked "Accept all"'] }, requests: [req('https://connect.facebook.net/en_US/fbevents.js')], cookies: [{ name: '_fbp', domain: '.shop.dk' }, { name: '_ga', domain: '.shop.dk' }] },
  policies: [],
};

test('analyse: a site that tracks before consent and ignores reject', () => {
  const rows = analyse(BAD);
  const st = status(rows);
  assert.equal(st['consent.cmp'], 'info');
  assert.equal(st['consent.banner'], 'pass');
  assert.equal(st['consent.reject-first-layer'], 'fail');
  assert.equal(st['consent.prechecked'], 'warn');
  assert.equal(st['consent.google-consent-mode'], 'warn');
  assert.equal(st['before.trackers'], 'fail');
  assert.equal(st['before.cookies'], 'fail');
  assert.equal(st['before.unclassified-cookies'], 'warn');
  assert.equal(st['before.storage'], 'warn');
  assert.equal(st['before.embeds'], 'warn');
  assert.equal(st['before.fonts'], 'warn');
  assert.equal(st['reject.works'], 'fail');
  assert.equal(st['reject.method'], 'info');
  assert.equal(st['transfer.third-countries'], 'warn');
  assert.equal(st['policy.privacy'], 'fail');
  assert.equal(st['policy.forms'], 'warn');
  const tasks = taskCandidates(rows, { source: 'privacy', ref: 'privacy-audit/report.md' });
  assert.ok(tasks.some((t) => t.severity === 'high' && t.check === 'reject.works'));
  assert.ok(tasks.every((t) => t.sources[0] === 'privacy'));
});

test('analyse: a clean site with a fair banner and Consent Mode v2', () => {
  const rows = analyse({
    url: 'https://shop.dk/', host: 'shop.dk',
    first: {
      requests: [req('https://consent.cookiebot.com/uc.js'), req('https://www.googletagmanager.com/gtm.js?id=GTM-1')],
      cookies: [{ name: 'CookieConsent', domain: 'shop.dk' }],
      facts: { consent: [{ command: 'default', state: { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' } }], globals: ['Cookiebot'], localStorage: [], sessionStorage: [], policyLinks: [{ text: 'Privatlivspolitik', href: 'https://shop.dk/privatliv' }], forms: [] },
      banner: { found: true, text: 'Cookies', accept: [BUTTON('Tillad alle')], reject: [BUTTON('Afvis')], settings: [], checked: 0, declaration: '_ga Google Analytics 2 år' },
      html: '', pages: [],
    },
    reject: { choice: { method: 'first-layer', steps: ['clicked "Afvis"'] }, requests: [], cookies: [{ name: 'CookieConsent', domain: 'shop.dk' }] },
    accept: { choice: { method: 'first-layer', steps: ['clicked "Tillad alle"'] }, requests: [req('https://www.google-analytics.com/g/collect?gcs=G111', 'Ping')], cookies: [{ name: '_ga', domain: '.shop.dk' }] },
    policies: [{ url: 'https://shop.dk/privatliv', ok: true, text: 'Vi bruger cookies. '.repeat(20), words: 60, file: 'policy-1.txt' }],
  });
  const st = status(rows);
  assert.equal(st['consent.reject-first-layer'], 'pass');
  assert.equal(st['consent.button-parity'], 'pass');
  assert.equal(st['consent.google-consent-mode'], 'pass');
  assert.equal(st['before.trackers'], 'pass');
  assert.equal(st['before.cookies'], 'pass');
  assert.equal(st['reject.works'], 'pass');
  assert.equal(st['policy.privacy'], 'pass');
  assert.equal(st['policy.cookie-declaration'], 'pass');
  assert.equal(countStatuses(rows).fail, 0);
});

test('analyse: "allow selection" with nothing ticked is a weak reject, not a missing one', () => {
  const data = structuredClone(BAD);
  data.first.banner = { ...data.first.banner, selection: [BUTTON('Tillad udvalgte')], checked: 0 };
  assert.equal(status(analyse(data))['consent.reject-first-layer'], 'warn');
  const sel = new RegExp(PATTERNS.selection, 'i');
  assert.ok(sel.test('TILLAD UDVALGTE') && sel.test('Allow selection') && !sel.test('Tillad alle'));
});

test('analyse: no banner but trackers fails; no banner and nothing is info', () => {
  const none = { found: false, accept: [], reject: [], settings: [] };
  const base = { url: 'https://a.dk/', host: 'a.dk', reject: null, accept: null, policies: [] };
  const withT = analyse({ ...base, first: { requests: [req('https://static.hotjar.com/c/hotjar-1.js')], cookies: [], facts: { policyLinks: [] }, banner: none, pages: [] } });
  assert.equal(status(withT)['consent.banner'], 'fail');
  assert.equal(status(withT)['consent.cmp'], 'fail');
  const clean = analyse({ ...base, first: { requests: [], cookies: [], facts: { policyLinks: [] }, banner: none, pages: [] } });
  assert.equal(status(clean)['consent.banner'], 'info');
});

test('renderMarkdown has the Result line audit-all reads', () => {
  const rows = analyse(BAD);
  const md = renderMarkdown({ target: { url: BAD.url, host: BAD.host }, version: '1.0.0', browser: 'Chrome/1', generatedAt: '2026-10-30T10:00:00Z', counts: countStatuses(rows), results: rows, files: {}, raw: { cookies: { first: [{ name: '_ga', domain: '.shop.dk', expires: '2028-01-01', secure: true, httpOnly: false, sameSite: 'Lax' }] } } });
  assert.match(md, /^# Privacy audit — www\.shop\.dk/);
  assert.match(md, /\*\*Result:\*\* \d+ pass · \d+ warn · \d+ fail · \d+ info · \d+ skipped/);
  assert.match(md, /## Fix first/);
});

// ---------------------------------------------------------------- CLI helpers

test('parseArgs, pickPages, pickPolicies', () => {
  const a = parseArgs(['shop.dk', '--pages', '4', '--only', 'reject', '--header', 'X-Bypass: 1']);
  assert.equal(a.url, 'https://shop.dk/');
  assert.equal(a.pages, 4);
  assert.deepEqual(a.only, ['first', 'reject']);
  assert.deepEqual(a.headers, { 'X-Bypass': '1' });
  const pages = pickPages(['https://shop.dk/a/1', 'https://shop.dk/a/2', 'https://shop.dk/kurv', 'https://shop.dk/b'], 'https://shop.dk/', 3);
  assert.deepEqual(pages, ['https://shop.dk/a/1', 'https://shop.dk/b']);
  const pol = pickPolicies([
    { text: 'Googles privatlivspolitik', href: 'https://business.safety.google/privacy/' },
    { text: 'Persondata', href: 'https://shop.dk/persondata' },
    { text: 'Cookies', href: 'https://shop.dk/persondata/cookies' },
  ], 'www.shop.dk');
  assert.deepEqual(pol.map((p) => p.href), ['https://shop.dk/persondata', 'https://shop.dk/persondata/cookies']);
});

test('findChrome and chromeArgs', () => {
  assert.equal(findChrome({ chromePath: '/x/chrome' }), '/x/chrome');
  assert.equal(findChrome({ env: { PATH: '/bin' }, home: '/h', exists: (p) => p === '/bin/chromium', list: () => [] }), '/bin/chromium');
  assert.equal(findChrome({ env: {}, home: '/h', exists: () => false, list: () => [] }), null);
  const args = chromeArgs({ root: true });
  assert.ok(args.includes('--remote-debugging-pipe') && args.includes('--no-sandbox'));
  assert.ok(!args.some((x) => x.startsWith('--user-data-dir')));
});

test('common.mjs is the same file in infra-audit and privacy-audit', () => {
  const a = fs.readFileSync(path.join(here, '../lib/common.mjs'), 'utf8');
  const other = path.join(here, '../../../infra-audit/scripts/lib/common.mjs');
  if (fs.existsSync(other)) assert.equal(a, fs.readFileSync(other, 'utf8'));
});
