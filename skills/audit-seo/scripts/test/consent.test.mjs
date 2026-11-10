import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONSENT_SELECTOR, CONSENT_NAME, CONSENT_HINT, dropConsentHtml } from '../lib/consent.mjs';

const lib = (skill, f) => new URL(`../../../${skill}/scripts/lib/${f}`, import.meta.url);

test('consent.mjs is identical in audit-seo, plan-geo, audit-privacy and audit-a11y', () => {
  const mine = readFileSync(lib('audit-seo', 'consent.mjs'), 'utf8');
  for (const other of ['plan-geo', 'audit-privacy', 'audit-a11y']) assert.equal(readFileSync(lib(other, 'consent.mjs'), 'utf8'), mine, `${other}/scripts/lib/consent.mjs differs`);
});

test('audit-a11y\'s in-page consent pattern equals CONSENT_HINT', () => {
  const probes = readFileSync(lib('audit-a11y', 'probes.mjs'), 'utf8');
  assert.ok(probes.includes(`${CONSENT_HINT}.test(`), 'probes.mjs __a11yConsent must use the same pattern as CONSENT_HINT');
});

test('CONSENT_SELECTOR names every tool once and is valid selector syntax', () => {
  const parts = CONSENT_SELECTOR.split(',');
  assert.equal(new Set(parts).size, parts.length);
  for (const p of parts) assert.match(p, /^\[[a-z-]+[*^]?="[^"]+" i\](\[role="dialog"\])?$/);
});

test('CONSENT_NAME: banner ids and classes, not words that only contain a tool name', () => {
  for (const v of ['onetrust-banner-sdk', 'CybotCookiebotDialog', 'coiOverlay', 'wrap coi-banner__x', 'usercentrics-root', 'cmplz-cookiebanner', 'site-cookiebanner']) assert.equal(CONSENT_NAME.test(v), true, v);
  for (const v of ['trustees', 'coin-list', 'main', 'article-body', 'decoi-x']) assert.equal(CONSENT_NAME.test(v), false, v);
});

test('dropConsentHtml removes banner containers, nested ones too, and keeps the page', () => {
  const html = '<div class="page"><p>Keep me</p><div id="coiOverlay"><p>Banner</p></div><section class="x cookie-banner">Two</section><div class="trustees">Board</div></div><aside id="onetrust-consent-sdk">Three</aside>';
  const out = dropConsentHtml(html);
  assert.match(out, /Keep me/);
  assert.match(out, /Board/);
  assert.doesNotMatch(out, /Banner|Two|Three/);
});
