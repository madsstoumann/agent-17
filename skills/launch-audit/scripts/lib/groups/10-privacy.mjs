/**
 * 10. Privacy & cookies — what is set and who is contacted on a first visit
 * with no consent given (Lighthouse loads the page like a new visitor; the
 * static scan of the HTML is the fallback).
 */
import { result } from '../registry.mjs';
import { classifyHost, detectCmp, CONSENT_CATEGORIES } from '../trackers.mjs';
import { parseSetCookie } from '../headers.mjs';
import { extractAssets } from '../html.mjs';
import { hostOf } from '../http.mjs';

const ESSENTIAL_COOKIE = /^(__cf_bm|__cfduid|cf_clearance|__cflb|AWSALB|AWSALBCORS|ARRAffinity|ARRAffinitySameSite|incap_ses_.*|visid_incap_.*|nlbi_.*|__Host-|__Secure-|XSRF-TOKEN|csrf.*|.*csrf.*|PHPSESSID|ASP\.NET_SessionId|\.AspNetCore\.Antiforgery.*|\.AspNetCore\.Session|JSESSIONID|i18n_redirected|locale|lang|NEXT_LOCALE|CookieConsent|OptanonConsent|OptanonAlertBoxClosed|cookieyes-consent|euconsent-v2|CookieInformationConsent|klaro)$/i;

export default {
  id: 'privacy',
  title: 'Privacy & cookies',
  phase: 'C',
  budget: 15000,
  async run(ctx) {
    const { lh, page, hostname, finalUrl, production } = ctx;
    const out = [];

    const cookies = (page.setCookie || []).map(parseSetCookie);
    const nonEssential = cookies.filter((c) => !ESSENTIAL_COOKIE.test(c.name) && !(c.domain && !hostname.endsWith(c.domain.replace(/^\./, ''))));
    out.push(nonEssential.length
      ? result('privacy.cookies-first-load', 'warn', 'Cookies before consent', `${nonEssential.map((c) => c.name).join(', ')} set on the first response with no consent given`, { fix: 'Only strictly necessary cookies may be set before consent; move analytics/marketing cookies behind the consent tool.', beforeProduction: true })
      : result('privacy.cookies-first-load', 'pass', 'Cookies before consent', cookies.length ? `only essential/infrastructure cookies on the first response (${cookies.map((c) => c.name).join(', ')})` : 'no cookies on the first response'));

    const m = lh?.mobile || lh?.desktop;
    let hosts;
    let source;
    if (m?.requests?.length) {
      hosts = [...new Set(m.requests.map((r) => r.host).filter(Boolean))];
      source = 'Lighthouse page load';
    } else {
      const a = page.html ? extractAssets(page.html, finalUrl) : { all: [] };
      hosts = [...new Set(a.all.map((x) => hostOf(x.url)).filter(Boolean))];
      source = 'static scan of the HTML (no browser run)';
    }
    const third = hosts.filter((h) => h !== hostname && h !== ctx.host && !h.endsWith(`.${ctx.apexHost}`));
    const classified = third.map((h) => ({ host: h, ...(classifyHost(h) || { vendor: null, category: null }) }));
    const trackers = classified.filter((c) => c.category && CONSENT_CATEGORIES.has(c.category));
    const cmp = detectCmp(page.html || '', hosts);
    out.push(trackers.length
      ? result('privacy.trackers', 'warn', 'Trackers loaded before consent', `${[...new Set(trackers.map((t) => t.vendor))].join(', ')} contacted on first load (${source})${cmp ? `; consent tool present: ${cmp}` : '; no consent tool detected'}`, { fix: 'Load analytics, ads and session-replay only after consent (GTM consent mode / the CMP\'s script blocking); Webbkoll shows what a regulator sees.', beforeProduction: true, link: `https://webbkoll.dataskydd.net/en/check?url=${encodeURIComponent(finalUrl)}`, data: { trackers } })
      : result('privacy.trackers', 'pass', 'Trackers loaded before consent', `no known analytics/ads/session-replay host contacted on first load (${source})`));
    const byVendor = {};
    for (const c of classified) (byVendor[c.vendor || c.host] ||= []).push(c.host);
    out.push(result('privacy.third-party-hosts', 'info', 'Third-party hosts on first load', third.length ? Object.entries(byVendor).slice(0, 15).map(([v, hs]) => `${v}${hs.length > 1 || hs[0] !== v ? ` (${hs.slice(0, 3).join(', ')})` : ''}`).join(' · ') : 'none — every request stayed on the site\'s own host', { data: { hosts: third } }));
    out.push(result('privacy.consent-tool', 'info', 'Consent tool', cmp ? `${cmp} detected` : 'no known consent-management platform detected (Cookiebot, OneTrust, Usercentrics, Cookie Information, Klaro, Didomi, CookieYes…)', { fix: cmp || !trackers.length ? '' : 'A consent tool is required before any non-essential cookie or tracker fires in the EU.' }));
    out.push(result('privacy.manual', 'info', 'Manual privacy checks', 'Run Webbkoll and Blacklight on the production URL after launch; read the cookie policy against what the site actually sets.', { link: `https://themarkup.org/blacklight?url=${encodeURIComponent(finalUrl)}` }));
    return out;
  },
};
