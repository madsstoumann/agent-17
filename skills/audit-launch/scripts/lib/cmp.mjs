/**
 * Which consent-management platform (CMP) a page uses. Shared by audit-launch and audit-privacy,
 * which keep identical copies of this file (a test checks).
 *
 * The evidence is weighed strongest first, so a loose word in the markup never beats the vendor
 * the page actually loads:
 *   1. a host the page requested (a browser run's network log),
 *   2. a host in a script or link URL in the HTML (also inside a JSON-escaped Next.js payload),
 *   3. a vendor's own global on window (audit-privacy reads them in the browser),
 *   4. vendor-specific markup in the HTML or the requested URLs.
 * Cookie Information's official snippet is `<script id="CookieConsent" src="https://policy.app.cookieinformation.com/uc.js">`,
 * and Cookiebot sets window.CookieConsent too, so a bare "CookieConsent" names nobody.
 */
export const CMP_SIGNATURES = [
  { name: 'Cookiebot', hosts: /(^|\.)cookiebot\.(com|eu)$/, globals: ['Cookiebot'], re: /consent\.cookiebot\.(com|eu)|consentcdn\.cookiebot|CybotCookiebot|\bCookiebot\b/i },
  { name: 'Usercentrics', hosts: /(^|\.)usercentrics\.(eu|com)$/, globals: ['UC_UI', 'usercentrics'], re: /usercentrics/i },
  { name: 'OneTrust', hosts: /(^|\.)(cookielaw\.org|onetrust\.(com|io)|cookiepro\.com)$|^optanon\.blob\.core\.windows\.net$/, globals: ['OneTrust', 'Optanon', 'OptanonActiveGroups'], re: /onetrust|optanon|cookielaw\.org/i },
  { name: 'Cookie Information', hosts: /(^|\.)cookieinformation\.com$/, globals: ['CookieInformation'], re: /cookieinformation\.com|coi-banner|CookieInformation/i },
  { name: 'Didomi', hosts: /(^|\.)(didomi\.io|privacy-center\.org)$/, globals: ['Didomi'], re: /didomi/i },
  { name: 'Klaro', hosts: /(^|\.)kiprotect\.com$/, globals: ['klaro'], re: /klaro/i },
  { name: 'CookieYes', hosts: /(^|\.)(cookieyes\.com|cdn-cookieyes\.com)$/, globals: ['getCkyConsent'], re: /cookieyes|cky-consent/i },
  { name: 'Complianz', hosts: null, globals: ['cmplz_banner'], re: /complianz|cmplz/i },
  { name: 'Borlabs Cookie', hosts: null, globals: ['BorlabsCookie'], re: /borlabs/i },
  { name: 'CookieFirst', hosts: /(^|\.)cookiefirst\.com$/, globals: ['CookieFirst'], re: /cookiefirst/i },
  { name: 'Osano', hosts: /(^|\.)osano\.com$/, globals: ['Osano'], re: /osano/i },
  { name: 'TrustArc', hosts: /(^|\.)(trustarc|truste)\.com$/, globals: ['truste'], re: /trustarc|truste\.com/i },
  { name: 'Sourcepoint', hosts: /(^|\.)(sourcepoint\.com|sp-prod\.net|privacy-mgmt\.com)$/, globals: ['_sp_'], re: /sourcepoint|sp-prod\.net|privacy-mgmt\.com/i },
  { name: 'Quantcast Choice', hosts: /(^|\.)(quantcast\.mgr\.consensu\.org|cmp\.inmobi\.com)$/, globals: [], re: /quantcast\.mgr\.consensu|quantcast choice|InMobi choice/i },
  { name: 'consentmanager', hosts: /(^|\.)consentmanager\.net$/, globals: [], re: /consentmanager\.net/i },
  { name: 'Axeptio', hosts: /(^|\.)axept\.io$/, globals: [], re: /axeptio/i },
  { name: 'Iubenda', hosts: /(^|\.)iubenda\.com$/, globals: [], re: /iubenda/i },
  { name: 'Termly', hosts: /(^|\.)termly\.io$/, globals: [], re: /termly/i },
];

const hostOf = (s) => {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return null;
  if (!/^[a-z]+:/.test(t)) return t.replace(/[/:].*$/, '') || null; // a bare host
  try { return new URL(t).hostname; } catch { return null; }
};

/** Hosts in the HTML's src and href URLs, also in JSON-escaped payloads (`\"src\":\"https:\/\/…`). */
export function scriptHosts(html) {
  const out = new Set();
  const re = /(?:\bsrc|\bhref|\\?"src\\?"|\\?"href\\?")\s*[=:]\s*\\?["']?(?:https?:)?(?:\\?\/){2}([a-z0-9.-]+\.[a-z]{2,})/gi;
  for (const m of String(html || '').matchAll(re)) out.add(m[1].toLowerCase());
  return [...out];
}

const byHost = (hosts) => {
  for (const c of CMP_SIGNATURES) if (c.hosts && hosts.some((h) => c.hosts.test(h))) return c.name;
  return null;
};

/**
 * detectCmp({ html, urls, globals }) -> the CMP's name, or null.
 * `urls` are requested URLs or bare hosts; `globals` are window property names found on the page.
 */
export function detectCmp({ html = '', urls = [], globals = [] } = {}) {
  const requested = urls.map(hostOf).filter(Boolean);
  return byHost(requested)
    || byHost(scriptHosts(html))
    || CMP_SIGNATURES.find((c) => c.globals.some((g) => globals.includes(g)))?.name
    || CMP_SIGNATURES.find((c) => c.re.test(`${html || ''}\n${urls.join('\n')}`))?.name
    || null;
}
