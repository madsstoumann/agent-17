/**
 * Consent banners, in one place for every skill that reads page text: audit-seo and plan-geo
 * (rendered text, served HTML), audit-privacy (policy text) and audit-a11y (overlays in the
 * keyboard walk). Identical copies, checked by audit-seo/scripts/test/consent.test.mjs. A banner
 * tool missing here is added here once, and every skill leaves it out of the page.
 */

// Banner tools by the ids and classes they mount: [selector kind, name, match].
// `prefix` matches the start of the attribute, `has` anywhere in it.
const TOOLS = [
  ['id', 'onetrust', 'prefix'], ['id', 'cookiebot', 'has'], ['id', 'usercentrics', 'has'], ['id', 'didomi', 'has'],
  ['id', 'cookie-consent', 'has'], ['id', 'cookieconsent', 'has'], ['class', 'cookie-consent', 'has'], ['class', 'cookieconsent', 'has'],
  ['id', 'cookie-banner', 'has'], ['class', 'cookie-banner', 'has'], ['id', 'cookie-information', 'has'], ['id', 'coi-', 'prefix'],
  ['id', 'coiOverlay', 'prefix'], ['class', 'coi-banner', 'has'], ['class', 'coi-consent', 'has'], ['id', 'cookiefirst', 'has'],
  ['id', 'cky-', 'prefix'], ['class', 'cky-consent', 'has'], ['id', 'cmplz', 'has'], ['class', 'cmplz-cookiebanner', 'has'],
  ['id', 'BorlabsCookie', 'prefix'], ['class', 'osano-cm', 'has'], ['id', 'truste', 'has'], ['id', 'sp_message_container', 'prefix'],
  ['id', 'qc-cmp2', 'prefix'], ['id', 'cookiescript', 'has'], ['id', 'axeptio', 'prefix'], ['id', 'tarteaucitron', 'prefix'],
];

/** A CSS selector for every banner tool, plus dialogs labelled cookie or consent. For querySelectorAll in the page. */
export const CONSENT_SELECTOR = [
  ...TOOLS.map(([attr, name, how]) => `[${attr}${how === 'prefix' ? '^' : '*'}="${name}" i]`),
  '[aria-label*="cookie" i][role="dialog"]', '[aria-label*="consent" i][role="dialog"]',
].join(',');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Names served HTML is also checked for: tools that write these without a hyphen or mid-value.
const LOOSE = ['onetrust', 'cookiebanner'];
const NAMES = TOOLS.filter(([, name]) => name !== 'truste').map(([, name, how]) => ({ name, prefix: how === 'prefix' && !LOOSE.includes(name) }))
  .concat(LOOSE.map((name) => ({ name, prefix: false })));

/**
 * The same tools as a pattern over an id or class value, for served HTML read as a string (no DOM):
 * CONSENT_NAME.test('onetrust-banner-sdk') is true. `truste` is left out here: as a substring of a
 * class it also matches "trustees".
 */
export const CONSENT_NAME = new RegExp(NAMES.map(({ name, prefix }) => (prefix ? `(?:^|\\s)${esc(name)}` : esc(name))).join('|'), 'i');

/**
 * Words that mark an element as consent UI when no tool is known (an overlay's id, class or label):
 * broader than the tools, for recognising a banner rather than removing text.
 */
export const CONSENT_HINT = /cookie|consent|coi|cmp|onetrust|cookiebot|usercentrics|didomi|gdpr|samtykke/i;

// An opening tag whose id or class names a banner tool, then its content up to the first close of that tag.
const CONTAINER = new RegExp(
  `<(div|section|aside|dialog|form)\\b[^>]*\\b(?:id|class)\\s*=\\s*["'](?:${NAMES.map(({ name, prefix }) => (prefix ? `(?:[^"']*\\s)?${esc(name)}` : `[^"']*${esc(name)}`)).join('|')})[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
  'gi',
);

/** Served HTML without the consent banners' containers (div, section, aside, dialog, form). */
export function dropConsentHtml(html) {
  return String(html || '').replace(CONTAINER, ' ');
}
