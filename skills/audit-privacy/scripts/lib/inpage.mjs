// Functions that run inside the page (serialised with toString). They must not reference
// anything outside their own body.

/**
 * Find the consent banner's buttons in this frame, open shadow roots included. Keeps element
 * references on window.__privacyAudit so a later call can click one, and returns plain data.
 */
export function findBanner(patterns) {
  const re = Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, new RegExp(v, 'i')]));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  const clickable = all.filter((el) => el.matches('button, a, [role="button"], input[type="button"], input[type="submit"], [onclick]') && visible(el));
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim();
  // The outermost banner-like ancestor (named like a consent box, fixed or sticky, or a dialog).
  const inBanner = (el) => {
    let box = null;
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement || (n.getRootNode && n.getRootNode().host)) {
      if (n.nodeType !== 1) continue;
      const tag = `${n.id || ''} ${typeof n.className === 'string' ? n.className : ''} ${n.getAttribute('aria-label') || ''} ${n.getAttribute('role') || ''}`;
      const s = getComputedStyle(n);
      if (re.container.test(tag) || ((s.position === 'fixed' || s.position === 'sticky') && n.getBoundingClientRect().height < innerHeight * 1.01) || n.tagName === 'DIALOG' || n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true') box = n;
    }
    return box;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { text: label(el).slice(0, 80), w: Math.round(r.width), h: Math.round(r.height), bg: s.backgroundColor, color: s.color, fontWeight: s.fontWeight, fontSize: s.fontSize, border: s.borderStyle !== 'none' ? s.borderColor : null };
  };
  const out = { accept: [], reject: [], selection: [], settings: [], save: [] };
  const refs = { accept: [], reject: [], selection: [], settings: [], save: [] };
  let container = null;
  for (const el of clickable) {
    const t = label(el);
    if (!t || t.length > 60) continue;
    const box = inBanner(el);
    if (!box) continue;
    const kind = re.reject.test(t) ? 'reject' : re.selection.test(t) ? 'selection' : re.accept.test(t) ? 'accept' : re.settings.test(t) ? 'settings' : re.save.test(t) ? 'save' : null;
    if (!kind) continue;
    if (!container || (box.innerText || '').length > (container.innerText || '').length) container = box;
    out[kind].push(describe(el));
    refs[kind].push(el);
  }
  const text = container ? (container.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  const checked = container ? [...container.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"]')].filter((c) => (c.checked || c.getAttribute('aria-checked') === 'true') && !c.disabled && c.getAttribute('aria-disabled') !== 'true').length : 0;
  window.__privacyAudit = refs;
  // The banner's hidden layers usually hold the cookie declaration (names, purposes, lifetimes).
  let declaration = '';
  for (const el of all) {
    const tag = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    if (re.container.test(tag) && el.textContent && el.textContent.length > declaration.length) declaration = el.textContent;
  }
  return { found: Boolean(container) && (out.accept.length + out.reject.length + out.settings.length) > 0, text, checked, declaration: declaration.replace(/\s+/g, ' ').slice(0, 300000), ...out };
}

/** Click the first element of `kind` found by findBanner; true when something was clicked. */
export function clickBanner(kind) {
  const el = window.__privacyAudit && window.__privacyAudit[kind] && window.__privacyAudit[kind][0];
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.click();
  return true;
}

/** CMP JavaScript APIs, used only when no button could be clicked. Returns the API used, or null. */
export function cmpApi(choice) {
  const w = window;
  const accept = choice === 'accept';
  try {
    if (w.Cookiebot && w.Cookiebot.submitCustomConsent) { if (accept) w.Cookiebot.submitCustomConsent(true, true, true); else w.Cookiebot.submitCustomConsent(false, false, false); return 'Cookiebot.submitCustomConsent'; }
    if (w.OneTrust && w.OneTrust.AllowAll) { if (accept) w.OneTrust.AllowAll(); else w.OneTrust.RejectAll(); return accept ? 'OneTrust.AllowAll' : 'OneTrust.RejectAll'; }
    if (w.UC_UI && w.UC_UI.acceptAllConsents) { if (accept) w.UC_UI.acceptAllConsents(); else w.UC_UI.denyAllConsents(); return 'UC_UI'; }
    if (w.CookieInformation && w.CookieInformation.submitAllCategories) { if (accept) w.CookieInformation.submitAllCategories(); else w.CookieInformation.declineAllCategories(); return 'CookieInformation'; }
    if (w.Didomi && w.Didomi.setUserAgreeToAll) { if (accept) w.Didomi.setUserAgreeToAll(); else w.Didomi.setUserDisagreeToAll(); return 'Didomi'; }
    if (w.klaro && w.klaro.getManager) { const m = w.klaro.getManager(); m.changeAll(accept); m.saveAndApplyConsents(); return 'klaro'; }
  } catch (e) { return null; }
  return null;
}

/** What the page says about consent: CMP globals, TCF, Google Consent Mode commands, storage keys, embeds and policy links. */
export function pageFacts(policyPattern, containerPattern) {
  const policyRe = new RegExp(policyPattern, 'i');
  const bannerRe = new RegExp(containerPattern, 'i');
  // Links inside the consent banner point at vendors' policies, not the site's own.
  const inBanner = (el) => { for (let n = el.parentElement; n; n = n.parentElement) if (bannerRe.test(`${n.id || ''} ${typeof n.className === 'string' ? n.className : ''}`)) return true; return false; };
  const consent = [];
  for (const e of (Array.isArray(window.dataLayer) ? window.dataLayer : [])) {
    if (e && typeof e === 'object' && e[0] === 'consent' && (e[1] === 'default' || e[1] === 'update')) consent.push({ command: e[1], state: e[2] || {} });
  }
  const keys = (s) => { try { return Object.keys(s); } catch { return []; } };
  const iframes = [...document.querySelectorAll('iframe')].map((f) => f.src || f.getAttribute('data-src') || '').filter(Boolean).slice(0, 30);
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const t = `${a.innerText || ''} ${a.getAttribute('href') || ''}`.replace(/\s+/g, ' ').trim();
    if (policyRe.test(t) && /^https?:/.test(a.href) && !inBanner(a)) links.push({ text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80), href: a.href });
  }
  const forms = [...document.forms].map((f) => ({ action: f.action || location.href, method: (f.method || 'get').toLowerCase(), personal: Boolean(f.querySelector('input[type="email"], input[name*="mail" i], input[type="tel"], input[name*="phone" i], input[name*="cpr" i]')), prechecked: [...f.querySelectorAll('input[type="checkbox"]')].filter((c) => c.checked && /newsletter|nyhedsbrev|marketing|tilbud|offers|samtykke|consent/i.test(`${c.name} ${c.id} ${(c.closest('label') || c.parentElement || {}).innerText || ''}`)).length })).slice(0, 20);
  return {
    title: document.title,
    lang: document.documentElement.lang || null,
    tcf: typeof window.__tcfapi === 'function',
    gpp: typeof window.__gpp === 'function',
    globals: ['Cookiebot', 'CookieConsent', 'OneTrust', 'Optanon', 'UC_UI', 'CookieInformation', 'Didomi', 'klaro', 'cmplz_banner', 'BorlabsCookie', 'CookieFirst', 'Osano', 'truste', '_sp_', 'getCkyConsent'].filter((g) => typeof window[g] !== 'undefined'),
    gtag: typeof window.gtag === 'function',
    consent,
    localStorage: keys(window.localStorage),
    sessionStorage: keys(window.sessionStorage),
    iframes,
    policyLinks: links.slice(0, 20),
    forms,
    internal: [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => { try { const u = new URL(h); return u.host === location.host && !/\.(pdf|jpe?g|png|zip|docx?)$/i.test(u.pathname) && u.pathname !== location.pathname; } catch { return false; } }).map((h) => h.split('#')[0]))].slice(0, 60),
  };
}

export const PATTERNS = {
  accept: String.raw`^(accept(er|ere|ér)?( alle| all| all cookies| cookies)?|allow( all)?( cookies)?|agree|i agree|ok(ay)?|got it|forstået|tillad( alle)?( cookies)?|godkend( alle)?|ja,? tak|ja til alle|alle akzeptieren|akzeptieren|zustimmen|alle zulassen|tout accepter|accepter tout|j'accepte|aceptar( todo| todas)?|godta( alle)?|acceptera( alla)?|tillåt alla|alles accepteren|accepteren|accept & close|accept and close|yes,? I agree)\b`,
  reject: String.raw`(reject|decline|deny|refuse|disagree|only (necessary|essential|required)|(necessary|essential|required) (cookies )?only|use necessary|continue without|afvis|afslå|kun nødvendige|nødvendige cookies|tillad kun|tillad nødvendige|fortsæt uden|ablehnen|nur notwendige|nur essenzielle|tout refuser|refuser|continuer sans|rechazar|avvis|avvisa|neka|endast nödvändiga|kun nødvendige|weigeren|alleen noodzakelijke)`,
  // "Allow selection" with only the necessary box ticked: a reject in effect, but not labelled as one.
  selection: String.raw`(tillad (udvalgte|valgte)|accepter (udvalgte|valgte)|allow (selection|selected)|accept (selection|selected)|use selected|gem (valg|mine valg|udvalgte)|save (my )?(choices|selection)|auswahl (erlauben|akzeptieren|speichern)|tillåt urval|godta valgte)`,
  settings: String.raw`(settings|preferences|customi[sz]e|manage|more options|details|indstillinger|tilpas|vis detaljer|læs mere om|administrer|einstellungen|anpassen|paramètres|personnaliser|configurar|inställningar|innstillinger|instellingen)`,
  save: String.raw`(save|confirm|gem|bekræft|speichern|bestätigen|enregistrer|guardar|spara|lagre|opslaan)`,
  container: String.raw`(cookie|consent|gdpr|cmp|privacy|samtykke|onetrust|cybot|usercentrics|didomi|klaro|coi-|cky-|cmplz)`,
};

export const POLICY_PATTERN = String.raw`(privacy|privatliv|persondata|personoplysning|databeskyttelse|datenschutz|integritet|personvern|confidentialit|privacidad|cookie)`;
