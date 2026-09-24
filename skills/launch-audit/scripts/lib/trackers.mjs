/**
 * Known third-party trackers and consent-management platforms. Static lists;
 * a hit means "this vendor was contacted during the audit's page load, with no
 * consent given", which is what Webbkoll and Blacklight show a regulator.
 */
export const TRACKERS = [
  { match: /(^|\.)googletagmanager\.com$/, vendor: 'Google Tag Manager', category: 'tag-manager' },
  { match: /(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$/, vendor: 'Google Analytics', category: 'analytics' },
  { match: /(^|\.)doubleclick\.net$|(^|\.)googlesyndication\.com$|(^|\.)googleadservices\.com$/, vendor: 'Google Ads / DoubleClick', category: 'ads' },
  { match: /(^|\.)facebook\.net$|(^|\.)facebook\.com$/, vendor: 'Meta Pixel', category: 'ads' },
  { match: /(^|\.)hotjar\.com$|(^|\.)hotjar\.io$/, vendor: 'Hotjar', category: 'session-replay' },
  { match: /(^|\.)clarity\.ms$/, vendor: 'Microsoft Clarity', category: 'session-replay' },
  { match: /(^|\.)fullstory\.com$/, vendor: 'FullStory', category: 'session-replay' },
  { match: /(^|\.)licdn\.com$|(^|\.)ads\.linkedin\.com$/, vendor: 'LinkedIn Insight', category: 'ads' },
  { match: /(^|\.)tiktok\.com$/, vendor: 'TikTok Pixel', category: 'ads' },
  { match: /(^|\.)bing\.com$/, vendor: 'Microsoft Ads (UET)', category: 'ads' },
  { match: /(^|\.)ads-twitter\.com$|(^|\.)t\.co$/, vendor: 'X / Twitter Ads', category: 'ads' },
  { match: /(^|\.)segment\.com$|(^|\.)segment\.io$/, vendor: 'Segment', category: 'analytics' },
  { match: /(^|\.)hs-scripts\.com$|(^|\.)hubspot\.com$|(^|\.)hsforms\.net$/, vendor: 'HubSpot', category: 'marketing' },
  { match: /(^|\.)mixpanel\.com$/, vendor: 'Mixpanel', category: 'analytics' },
  { match: /(^|\.)amplitude\.com$/, vendor: 'Amplitude', category: 'analytics' },
  { match: /(^|\.)matomo\.cloud$|(^|\.)piwik\.pro$/, vendor: 'Matomo', category: 'analytics' },
  { match: /(^|\.)plausible\.io$/, vendor: 'Plausible', category: 'analytics-privacy' },
  { match: /(^|\.)siteimproveanalytics\.com$/, vendor: 'Siteimprove', category: 'analytics' },
  { match: /(^|\.)sentry\.io$/, vendor: 'Sentry', category: 'error-tracking' },
  { match: /(^|\.)youtube\.com$|(^|\.)ytimg\.com$/, vendor: 'YouTube embed', category: 'embed' },
  { match: /(^|\.)vimeo\.com$/, vendor: 'Vimeo embed', category: 'embed' },
  { match: /(^|\.)google\.com$/, vendor: 'Google (maps/recaptcha/fonts)', category: 'embed' },
  { match: /(^|\.)gstatic\.com$/, vendor: 'Google static (fonts/recaptcha)', category: 'embed' },
  { match: /(^|\.)fonts\.googleapis\.com$/, vendor: 'Google Fonts', category: 'fonts' },
];

/** Categories that are only ever loaded lawfully after consent. */
export const CONSENT_CATEGORIES = new Set(['analytics', 'ads', 'session-replay', 'marketing', 'tag-manager']);

export const CMP_PATTERNS = [
  { name: 'Cookiebot', re: /cookiebot\.com|consent\.cookiebot|CookieConsent\b/i },
  { name: 'OneTrust', re: /onetrust|optanon/i },
  { name: 'Usercentrics', re: /usercentrics/i },
  { name: 'Cookie Information', re: /cookieinformation\.com|CookieInformation/i },
  { name: 'Klaro', re: /klaro/i },
  { name: 'Didomi', re: /didomi/i },
  { name: 'CookieYes', re: /cookieyes/i },
  { name: 'Osano', re: /osano\.com/i },
  { name: 'TrustArc', re: /trustarc|truste\.com/i },
  { name: 'Quantcast Choice', re: /quantcast\.mgr\.consensu|InMobi choice/i },
  { name: 'Complianz', re: /complianz/i },
  { name: 'CookieFirst', re: /cookiefirst/i },
];

/** host -> { vendor, category } | null */
export function classifyHost(host) {
  const h = String(host || '').toLowerCase();
  for (const t of TRACKERS) if (t.match.test(h)) return { vendor: t.vendor, category: t.category };
  return null;
}

/** Which consent tool is on the page, from the HTML and the hosts contacted. */
export function detectCmp(html, hosts = []) {
  const hay = `${html || ''}\n${hosts.join('\n')}`;
  for (const c of CMP_PATTERNS) if (c.re.test(hay)) return c.name;
  return null;
}
