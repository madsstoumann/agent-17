// Turns what the three browser scenarios saw into check rows. Pure: takes the collected data,
// returns results, so it is tested without a browser.
import { result } from './common.mjs';
import { classifyHost, classifyCookie, needsConsent, siteApex, detectCmp, googleConsentState, CONSENT_CATEGORIES, EEA, ADEQUATE } from './classify.mjs';

export const SECTIONS = [
  { id: 'consent', title: 'Consent banner', prefixes: ['consent'] },
  { id: 'before', title: 'Before any choice', prefixes: ['before'] },
  { id: 'reject', title: 'After "reject"', prefixes: ['reject'] },
  { id: 'accept', title: 'After "accept"', prefixes: ['accept'] },
  { id: 'transfer', title: 'Third parties & transfers', prefixes: ['transfer'] },
  { id: 'policy', title: 'Privacy policy & forms', prefixes: ['policy'] },
];

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
const uniq = (xs) => [...new Set(xs)];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Requests -> one row per third-party host with its classification. */
export function thirdParties(requests, siteHost) {
  const apex = siteApex(siteHost);
  const by = new Map();
  for (const r of requests) {
    const h = hostOf(r.url);
    if (!h || h === apex || h.endsWith(`.${apex}`) || !/^https?:/.test(r.url)) continue;
    if (!by.has(h)) by.set(h, { host: h, ...(classifyHost(h) || { vendor: null, category: null, country: null }), count: 0, urls: [], hits: 0, deniedHits: 0, other: 0 });
    const e = by.get(h);
    e.count++;
    if (e.urls.length < 3) e.urls.push(r.url.slice(0, 200));
    const g = googleConsentState(r.url);
    if (g) { e.hits++; if (g.denied) e.deniedHits++; } else if (r.type !== 'Script') e.other++;
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/**
 * Tracking hosts: categories that need consent. A Google host whose only hits said "storage
 * denied" (Consent Mode pings) and that sent nothing else but scripts is marked cookielessOnly.
 */
export function trackers(parties) {
  return parties.filter((p) => CONSENT_CATEGORIES.has(p.category) && p.category !== 'embed' && p.category !== 'fonts').map((p) => ({
    ...p,
    cookielessOnly: p.hits > 0 && p.deniedHits === p.hits && p.other === 0,
  }));
}

export function consentCookies(cookies, siteHost) {
  return cookies.map((c) => ({ name: c.name, domain: c.domain, ...classifyCookie(c, siteHost) }));
}

const vendorsText = (list) => uniq(list.map((p) => p.vendor || p.host)).join(', ');
const cookiesText = (list) => list.map((c) => `${c.name}${c.vendor ? ` (${c.vendor})` : ''}${c.firstParty ? '' : ` @${c.domain.replace(/^\./, '')}`}`).join(', ');
const LOCAL_TRACKER_KEYS = /^(_hj|amplitude|AMP_|mp_|ajs_|_gcl|_ga|_clck|_clsk|_fbp|_ttp|_pin|__hs|_uet|_rdt|_scid|_lfa|_leadinfo|li_|intercom|optimizely|_vwo|ab\.storage)/i;

/** Contrast-free prominence check: reject much smaller, or flat text next to a filled accept button. */
export function buttonParity(accept, reject) {
  if (!accept || !reject) return null;
  const area = (b) => b.w * b.h;
  const filled = (b) => b.bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(b.bg);
  const issues = [];
  if (area(reject) < 0.6 * area(accept)) issues.push(`the reject button is ${Math.round((area(reject) / area(accept)) * 100)} % of the accept button's size`);
  if (filled(accept) && !filled(reject) && !reject.border) issues.push('accept is a filled button, reject is plain text');
  return issues;
}

/**
 * analyse(data) -> results. data: { url, host, first: { requests, cookies, facts, banner, html, pages: [{ url, requests }] },
 *   reject: { requests, cookies, facts, choice }, accept: { requests, cookies, facts, choice }, policies: [{ url, text, status }] }
 */
export function analyse(d) {
  const out = [];
  const host = d.host;
  const first = d.first;
  const allFirstRequests = [...first.requests, ...(first.pages || []).flatMap((p) => p.requests)];
  const firstParties = thirdParties(allFirstRequests, host);
  const firstCookies = consentCookies(first.cookies, host);
  const acceptParties = d.accept ? thirdParties(d.accept.requests, host) : [];
  const acceptCookies = d.accept ? consentCookies(d.accept.cookies, host) : [];
  const cmp = detectCmp(`${first.html || ''}\n${allFirstRequests.map((r) => r.url).join('\n')}`) || (first.facts?.globals || []).find((g) => /Cookiebot|OneTrust|UC_UI|CookieInformation|Didomi|klaro/.test(g)) || null;
  const b = first.banner || { found: false, accept: [], reject: [], selection: [], settings: [] };

  // -------------------------------------------------------------- consent banner
  const anythingNeedingConsent = trackers([...firstParties, ...acceptParties]).length > 0 || [...firstCookies, ...acceptCookies].some((c) => needsConsent(c.purpose));
  const noTool = !cmp && anythingNeedingConsent && !b.found;
  out.push(result('consent.cmp', noTool ? 'fail' : 'info', 'Consent tool', cmp ? `${cmp}${first.facts?.tcf ? ' (IAB TCF API present)' : ''}` : b.found ? 'no known consent platform; the site has its own banner' : 'no known consent-management platform found', { fix: !noTool ? '' : 'The site sets tracking cookies or loads trackers, so it needs a consent tool that blocks them until the visitor agrees.' }));
  if (b.found) {
    out.push(result('consent.banner', 'pass', 'Banner on first visit', `${b.frame === 'top' ? '' : `in an iframe (${b.frame}); `}"${b.text.slice(0, 160)}${b.text.length > 160 ? '…' : ''}"`, { data: { accept: b.accept, reject: b.reject, settings: b.settings } }));
    const sel = (b.selection || [])[0];
    out.push(b.reject.length
      ? result('consent.reject-first-layer', 'pass', 'Reject on the first layer', `"${b.reject[0].text}" next to "${b.accept[0]?.text || '?'}"`)
      : sel && !b.checked
        ? result('consent.reject-first-layer', 'warn', 'Reject on the first layer', `no button labelled reject; "${sel.text}" with every optional box unticked works as one`, { fix: 'Label it plainly ("Afvis alle" / "Reject all") or add a reject button; regulators look for a refusal that is as clear as "accept".' })
        : result('consent.reject-first-layer', 'fail', 'Reject on the first layer', `first layer offers ${[...b.accept, ...(b.selection || []), ...b.settings].map((x) => `"${x.text}"`).join(', ') || 'no buttons'} but no reject`, { fix: 'Put a "Reject all" (Afvis alle) button on the first layer, as easy to use as "Accept all". The EDPB cookie banner taskforce and the Danish Data Protection Agency treat a missing first-layer reject as invalid consent.' }));
    const parity = buttonParity(b.accept[0], b.reject[0]);
    if (parity) out.push(result('consent.button-parity', parity.length ? 'warn' : 'pass', 'Accept and reject equally prominent', parity.length ? parity.join('; ') : `similar size and style (accept ${b.accept[0].w}×${b.accept[0].h}, reject ${b.reject[0].w}×${b.reject[0].h})`, { fix: parity.length ? 'Give both buttons the same size, weight and colour treatment; a faded reject is a deceptive design pattern (EDPB guidelines 03/2022).' : '' }));
    if (b.checked) out.push(result('consent.prechecked', 'warn', 'Pre-ticked purposes', `${plural(b.checked, 'non-essential option')} switched on before the visitor chose`, { fix: 'Pre-ticked boxes are not consent (CJEU C-673/17 Planet49). Leave every non-necessary category off by default.' }));
  } else {
    out.push(result('consent.banner', anythingNeedingConsent ? 'fail' : 'info', 'Banner on first visit', anythingNeedingConsent ? 'no consent banner found, although the site sets tracking cookies or loads trackers' : 'no consent banner found, and nothing that needs consent was seen', { fix: anythingNeedingConsent ? 'Show a consent banner on the first visit and block non-essential cookies and trackers until the visitor accepts.' : '' }));
  }
  const gm = googleConsentMode(d, [...firstParties, ...acceptParties]);
  if (gm) out.push(gm);

  // -------------------------------------------------------------- before any choice
  const tBefore = trackers(firstParties);
  const real = tBefore.filter((t) => !t.cookielessOnly && t.category !== 'tag-manager');
  const pings = tBefore.filter((t) => t.cookielessOnly);
  const pageNote = (t) => {
    const pages = (first.pages || []).filter((p) => thirdParties(p.requests, host).some((x) => x.host === t.host)).map((p) => new URL(p.url).pathname);
    return pages.length && !thirdParties(first.requests, host).some((x) => x.host === t.host) ? ` on ${pages.join(', ')}` : '';
  };
  out.push(real.length
    ? result('before.trackers', 'fail', 'Trackers before consent', real.map((t) => `${t.vendor} (${t.host}${pageNote(t)})`).join('; '), { fix: 'Block these until the visitor accepts: use the consent tool\'s script blocking or Google Consent Mode with the tags set to wait for consent.', data: { hosts: real.map((t) => t.host) } })
    : result('before.trackers', 'pass', 'Trackers before consent', `no analytics, ads, session-replay or marketing host contacted before a choice (${plural(1 + (first.pages || []).length, 'page')} loaded)`));
  if (pings.length) out.push(result('before.cookieless-pings', 'warn', 'Consent Mode pings before consent', `${pings.map((t) => t.host).join(', ')} received Consent Mode hits with storage denied (gcs=G100) before a choice`, { fix: 'Google Consent Mode "advanced" sends cookieless pings before consent. They still carry the IP address and user agent to Google in the US; several EU regulators consider that processing that needs consent. Use "basic" mode (no tags before consent) to be safe.' }));
  const gtm = tBefore.filter((t) => t.category === 'tag-manager');
  if (gtm.length && !real.length) out.push(result('before.tag-manager', 'info', 'Tag manager before consent', `${gtm.map((t) => t.host).join(', ')} loaded, but no tags fired`, { fix: '' }));
  const cBefore = firstCookies.filter((c) => needsConsent(c.purpose));
  out.push(cBefore.length
    ? result('before.cookies', 'fail', 'Cookies before consent', cookiesText(cBefore), { fix: 'Only strictly necessary cookies may be set before consent (ePrivacy Art. 5(3), Danish cookie order §3). Move these behind the consent tool.', data: { cookies: cBefore } })
    : result('before.cookies', 'pass', 'Cookies before consent', firstCookies.length ? `only necessary or preference cookies: ${cookiesText(firstCookies.filter((c) => c.purpose !== 'unclassified')) || 'none'}` : 'no cookies set'));
  const unknownBefore = firstCookies.filter((c) => c.purpose === 'unclassified');
  if (unknownBefore.length) out.push(result('before.unclassified-cookies', 'warn', 'Unrecognised cookies before consent', cookiesText(unknownBefore), { fix: 'Check each against the cookie declaration: if it is not strictly necessary it must wait for consent.', severity: 'low' }));
  const store = [...(first.facts?.localStorage || []), ...(first.facts?.sessionStorage || [])].filter((k) => LOCAL_TRACKER_KEYS.test(k));
  if (store.length) out.push(result('before.storage', 'warn', 'Tracker storage before consent', `localStorage/sessionStorage keys: ${uniq(store).join(', ')}`, { fix: 'ePrivacy covers browser storage as well as cookies; these trackers must wait for consent too.' }));
  const embeds = firstParties.filter((p) => p.category === 'embed' && p.vendor !== 'YouTube (no-cookie)' && p.vendor !== 'Trustpilot');
  if (embeds.length) out.push(result('before.embeds', 'warn', 'Embeds before consent', embeds.map((p) => `${p.vendor} (${p.host})`).join('; '), { fix: 'Load YouTube, Maps and similar embeds behind a click-to-load placeholder, or use youtube-nocookie.com; they set cookies or send the visitor\'s IP to the US on page load.', severity: 'medium' }));
  const fonts = firstParties.filter((p) => p.category === 'fonts');
  if (fonts.length) out.push(result('before.fonts', 'warn', 'Web fonts from a third party', fonts.map((p) => `${p.vendor} (${p.host})`).join('; '), { fix: 'Self-host the fonts. Loading Google Fonts from Google sends every visitor\'s IP address to Google; LG München (3 O 17493/20, 2022) found that unlawful without consent.' }));

  // -------------------------------------------------------------- after reject
  if (d.reject) {
    const ch = d.reject.choice || {};
    if (!ch.method) {
      out.push(result('reject.works', b.found ? 'fail' : 'skip', 'Reject is honoured', b.found ? `could not reject: ${ch.steps?.join('; ')}` : 'no banner to reject in'));
    } else {
      const rParties = thirdParties(d.reject.requests, host);
      const rT = trackers(rParties).filter((t) => !t.cookielessOnly && t.category !== 'tag-manager');
      const rC = consentCookies(d.reject.cookies, host).filter((c) => needsConsent(c.purpose));
      const bad = [rT.length ? `trackers ${rT.map((t) => `${t.vendor} (${t.host})`).join(', ')}` : '', rC.length ? `cookies ${cookiesText(rC)}` : ''].filter(Boolean);
      out.push(bad.length
        ? result('reject.works', 'fail', 'Reject is honoured', `after rejecting (${ch.steps.join('; ')}) and reloading: ${bad.join('; ')}`, { fix: 'Something ignores the consent state: tags fired outside the consent tool, a hard-coded pixel, or a tag manager trigger that does not check consent. Find each in GTM or the templates.' })
        : result('reject.works', 'pass', 'Reject is honoured', `after rejecting (${ch.steps.join('; ')}) and reloading, no tracker or tracking cookie`));
      if (ch.method === 'api') out.push(result('reject.method', 'warn', 'How reject was reached', ch.steps.join('; '), { fix: 'A visitor cannot do what the script had to do through the API: offer a visible reject button.' }));
      else if (ch.method !== 'first-layer') out.push(result('reject.method', 'info', 'How reject was reached', ch.steps.join('; ')));
      if (ch.prechecked) out.push(result('reject.prechecked', 'warn', 'Second layer pre-ticked', `${plural(ch.prechecked, 'option')} switched on when the settings opened`, { fix: 'Leave non-necessary categories off by default (Planet49).' }));
    }
  }

  // -------------------------------------------------------------- after accept
  if (d.accept) {
    const ch = d.accept.choice || {};
    const aT = trackers(acceptParties);
    const aC = acceptCookies.filter((c) => needsConsent(c.purpose));
    const unknownAfter = acceptCookies.filter((c) => c.purpose === 'unclassified');
    out.push(result('accept.inventory', 'info', 'What accepting turns on', ch.method ? `${aT.length ? vendorsText(aT) : 'no tracker'}; ${plural(aC.length, 'tracking cookie')}${aC.length ? `: ${cookiesText(aC)}` : ''}${unknownAfter.length ? `; unrecognised: ${cookiesText(unknownAfter)}` : ''}` : `could not accept: ${(ch.steps || []).join('; ')}`, { data: { vendors: uniq(aT.map((t) => t.vendor)), cookies: aC.map((c) => c.name) } }));
  }

  // -------------------------------------------------------------- third parties and transfers
  const everyone = new Map();
  for (const [phase, list] of [['before', firstParties], ['accept', acceptParties]]) for (const p of list) { if (!everyone.has(p.host)) everyone.set(p.host, { ...p, phases: [] }); everyone.get(p.host).phases.push(phase); }
  const outside = [...everyone.values()].filter((p) => p.country && !EEA.has(p.country));
  const beforeOutside = outside.filter((p) => p.phases.includes('before') && !['consent', 'cdn', 'tag-manager'].includes(p.category));
  const byCountry = {};
  for (const p of outside) (byCountry[p.country] ||= new Set()).add(p.vendor);
  if (outside.length) {
    out.push(result('transfer.third-countries', beforeOutside.length ? 'warn' : 'info', 'Data to third countries', `${Object.entries(byCountry).map(([c, v]) => `${c}${ADEQUATE.has(c) ? ' (adequacy decision)' : ''}: ${[...v].join(', ')}`).join('; ')}${beforeOutside.length ? `. Before consent: ${vendorsText(beforeOutside)}` : ''}`, { fix: 'Each needs a transfer basis (EU-US Data Privacy Framework certification of the vendor, or SCCs with a transfer impact assessment) and a mention in the privacy policy. Contacting them before consent sends the visitor\'s IP address without one.', link: 'https://www.dataprivacyframework.gov/list' }));
  } else out.push(result('transfer.third-countries', 'pass', 'Data to third countries', 'no known vendor outside the EU/EEA contacted'));
  const unknown = [...everyone.values()].filter((p) => !p.vendor);
  out.push(result('transfer.hosts', 'info', 'Third-party hosts', `${plural(everyone.size, 'host')}: ${[...everyone.values()].slice(0, 25).map((p) => `${p.vendor ? `${p.vendor} ` : ''}${p.host}`).join(', ')}${everyone.size > 25 ? ', …' : ''}${unknown.length ? `. Not recognised: ${unknown.slice(0, 15).map((p) => p.host).join(', ')}` : ''}`, { data: { hosts: [...everyone.values()].map(({ host: h, vendor, category, country, phases, count }) => ({ host: h, vendor, category, country, phases, count })) } }));

  // -------------------------------------------------------------- policy and forms
  const policies = (d.policies || []).filter((p) => p.ok);
  const links = first.facts?.policyLinks || [];
  if (!links.length) out.push(result('policy.privacy', 'fail', 'Privacy policy link', 'no link to a privacy or cookie policy on the start page', { fix: 'Link the privacy policy from every page (usually the footer); GDPR Art. 12–13 requires the information to be easy to reach.' }));
  else if (!policies.length) out.push(result('policy.privacy', 'warn', 'Privacy policy link', `links found (${links.map((l) => l.text || l.href).slice(0, 3).join(', ')}) but none could be loaded: ${(d.policies || []).map((p) => `${p.url} ${p.error || p.status}`).join('; ')}`, { fix: 'Fix the link target.' }));
  else out.push(result('policy.privacy', 'pass', 'Privacy policy link', policies.map((p) => `${p.url} (${plural(p.words, 'word')}${p.file ? `, saved as ${p.file}` : ''})`).join('; ')));
  if (policies.length && d.accept?.choice?.method) {
    const text = [...policies.map((p) => p.text), b.declaration || ''].join('\n').toLowerCase();
    const stem = (n) => n.toLowerCase().replace(/_[a-z0-9]{6,}$/i, '').replace(/[._-]\d+$/, '');
    const seen = uniq(acceptCookies.filter((c) => needsConsent(c.purpose) || c.purpose === 'unclassified').map((c) => c.name));
    const missing = seen.filter((n) => !text.includes(n.toLowerCase()) && !text.includes(stem(n)));
    out.push(missing.length
      ? result('policy.cookie-declaration', 'warn', 'Cookies missing from the declaration', `${plural(missing.length, 'cookie')} seen after accepting but named neither in the policy pages nor in the banner's cookie details: ${missing.slice(0, 25).join(', ')}${missing.length > 25 ? `, and ${missing.length - 25} more (report.json)` : ''}`, { fix: 'List every cookie with purpose, provider and lifetime (the consent tool\'s scanner usually does this); a cookie the visitor was not told about has no valid consent.', severity: 'low', data: { missing } })
      : result('policy.cookie-declaration', 'pass', 'Cookies named in the declaration', seen.length ? `all ${seen.length} cookies seen after accepting are named` : 'no non-necessary cookies to look for'));
  }
  const forms = (first.facts?.forms || []).filter((f) => f.personal);
  const insecure = forms.filter((f) => /^http:/.test(f.action));
  const external = forms.filter((f) => { const h = hostOf(f.action); return h && !h.endsWith(siteApex(host)); });
  const pre = forms.filter((f) => f.prechecked);
  if (insecure.length) out.push(result('policy.forms', 'fail', 'Forms with personal data', `${insecure.map((f) => f.action).join(', ')} submit over http`, { fix: 'Submit personal data over https only (GDPR Art. 32).' }));
  else if (external.length || pre.length) out.push(result('policy.forms', 'warn', 'Forms with personal data', [external.length ? `submit to ${uniq(external.map((f) => hostOf(f.action))).join(', ')}` : '', pre.length ? `${plural(pre.length, 'form')} with a pre-ticked marketing or newsletter box` : ''].filter(Boolean).join('; '), { fix: pre.length ? 'Marketing consent must be an unticked box the visitor ticks.' : 'Name the processor that receives the form in the privacy policy and have a data processing agreement.' }));
  else if (forms.length) out.push(result('policy.forms', 'pass', 'Forms with personal data', `${plural(forms.length, 'form')} on the start page submit over https to the site itself`));
  return out;
}

/** Google Consent Mode v2: defaults set before tags, with the two 2024 parameters. */
function googleConsentMode(d, parties) {
  const google = parties.some((p) => /Google (Analytics|Ads|Tag Manager)/.test(p.vendor || ''));
  if (!google) return null;
  const cmds = d.first.facts?.consent || [];
  const def = cmds.find((c) => c.command === 'default');
  if (!def) return result('consent.google-consent-mode', 'warn', 'Google Consent Mode', 'Google tags are on the site but no consent default was set before them', { fix: 'Set `gtag(\'consent\', \'default\', { ad_storage: \'denied\', analytics_storage: \'denied\', ad_user_data: \'denied\', ad_personalization: \'denied\' })` before GTM loads (most consent tools have a switch for it). Google requires Consent Mode v2 for EEA traffic since March 2024.' });
  const s = def.state || {};
  const missing = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'].filter((k) => !(k in s));
  const granted = Object.entries(s).filter(([k, v]) => v === 'granted' && /storage|ad_/.test(k) && k !== 'security_storage' && k !== 'functionality_storage').map(([k]) => k);
  if (granted.length) return result('consent.google-consent-mode', 'fail', 'Google Consent Mode', `default grants ${granted.join(', ')} before the visitor chose`, { fix: 'Defaults must be denied; only the consent tool\'s update may grant them.' });
  if (missing.length) return result('consent.google-consent-mode', 'warn', 'Google Consent Mode', `default set, but without ${missing.join(', ')}`, { fix: 'Add the missing parameters (Consent Mode v2); without ad_user_data and ad_personalization Google Ads stops building audiences from EEA traffic.' });
  return result('consent.google-consent-mode', 'pass', 'Google Consent Mode', `v2 default: ${Object.entries(s).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}
