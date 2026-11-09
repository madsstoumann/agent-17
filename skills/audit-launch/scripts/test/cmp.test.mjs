import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectCmp, scriptHosts } from '../lib/cmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(HERE, 'fixtures', 'cmp', name), 'utf8');

test('detectCmp names Cookiebot, Cookie Information and OneTrust from their snippets', () => {
  assert.equal(detectCmp({ html: fixture('cookiebot.html') }), 'Cookiebot');
  // Cookie Information's snippet is <script id="CookieConsent">: not Cookiebot.
  assert.equal(detectCmp({ html: fixture('cookie-information.html') }), 'Cookie Information');
  assert.equal(detectCmp({ html: fixture('cookie-information-nextjs.html') }), 'Cookie Information');
  // A page that mentions other tools in its text is still named by the script it loads.
  assert.equal(detectCmp({ html: fixture('onetrust.html') }), 'OneTrust');
});

test('detectCmp: a requested host beats markup, and bare "CookieConsent" names nobody', () => {
  assert.equal(detectCmp({ html: '<script id="CookieConsent"></script>' }), null);
  assert.equal(detectCmp({ html: '<script id="CookieConsent"></script>', urls: ['https://policy.app.cookieinformation.com/uc.js'] }), 'Cookie Information');
  assert.equal(detectCmp({ html: '', urls: ['cdn.cookielaw.org', 'optanon.blob.core.windows.net'] }), 'OneTrust');
  assert.equal(detectCmp({ html: fixture('cookiebot.html'), urls: ['consentcdn.cookiebot.com'] }), 'Cookiebot');
  assert.equal(detectCmp({ html: '<p>hello</p>', urls: ['x.com'] }), null);
  assert.equal(detectCmp(), null);
});

test('detectCmp reads window globals by vendor name', () => {
  assert.equal(detectCmp({ globals: ['UC_UI'] }), 'Usercentrics');
  assert.equal(detectCmp({ globals: ['CookieConsent', 'CookieInformation'] }), 'Cookie Information');
  assert.equal(detectCmp({ globals: ['CookieConsent'] }), null);
});

test('scriptHosts reads src/href hosts, also JSON-escaped', () => {
  assert.deepEqual(scriptHosts(fixture('cookie-information-nextjs.html')), ['policy.app.cookieinformation.com']);
  assert.ok(scriptHosts(fixture('cookie-information.html')).includes('policy.app.cookieinformation.com'));
});

test('cmp.mjs is identical to audit-privacy\'s copy', () => {
  const mine = fs.readFileSync(path.join(HERE, '..', 'lib', 'cmp.mjs'), 'utf8');
  const theirs = fs.readFileSync(path.join(HERE, '..', '..', '..', 'audit-privacy', 'scripts', 'lib', 'cmp.mjs'), 'utf8');
  assert.equal(mine, theirs);
});
