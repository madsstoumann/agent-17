// One look at the page, the way a visitor's browser would get it: where it redirects, what it
// calls itself, whether it asks for a password or a card number and where those forms send it,
// what it loads from the real brand's servers, how it wants to be paid and who it says it is.
// Read-only: GETs only, no form is ever submitted.
import crypto from 'node:crypto';
import { registrableOf } from './target.mjs';

export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_BYTES = 3_000_000;

/** fetchChain(url) -> { ok, chain: [{ url, status }], final, status, html, headers, error } */
export async function fetchChain(url, { fetch: f = globalThis.fetch, ua = BROWSER_UA, max = 10, timeout = 20000 } = {}) {
  const chain = [];
  let current = url;
  try {
    for (let i = 0; i <= max; i++) {
      const res = await f(current, { redirect: 'manual', headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'da,en;q=0.8' }, signal: AbortSignal.timeout(timeout) });
      chain.push({ url: current, status: res.status });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).href; continue; }
      const type = res.headers.get('content-type') || '';
      let html = '';
      if (/html|xml|text\/plain/i.test(type) || !type) {
        const buf = Buffer.from(await res.arrayBuffer());
        html = buf.subarray(0, MAX_BYTES).toString('utf8');
      }
      const meta = metaRefresh(html);
      if (meta && i < max && chain.length < max) { current = new URL(meta, current).href; continue; }
      return { ok: true, chain, final: current, status: res.status, html, contentType: type, server: res.headers.get('server') };
    }
    return { ok: false, chain, final: current, error: 'too many redirects' };
  } catch (e) {
    return { ok: false, chain, final: current, error: e.cause?.code || e.message };
  }
}

function metaRefresh(html) {
  const m = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i.exec(html.slice(0, 20000));
  return m ? m[1] : null;
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const textOf = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const FREE_MAIL = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.dk', 'outlook.com', 'outlook.dk', 'live.com', 'live.dk', 'yahoo.com', 'yahoo.dk', 'icloud.com', 'proton.me', 'protonmail.com', 'mail.ru', 'yandex.ru', 'qq.com', '163.com', 'gmx.com', 'gmx.de', 'aol.com'];
const EXFIL = [/api\.telegram\.org\/bot/i, /discord(?:app)?\.com\/api\/webhooks/i, /formspree\.io/i, /getform\.io/i, /formsubmit\.co/i, /submit-form\.com/i, /webhook\.site/i, /pipedream\.net/i, /script\.google\.com\/macros/i, /emailjs\.com/i, /ipapi\.co|ip-api\.com|ipinfo\.io\/json|api\.ipify\.org/i];

/**
 * analyzePage(html, finalUrl) -> facts about the page (no judgement; verdict.mjs judges).
 */
export function analyzePage(html, finalUrl) {
  const host = new URL(finalUrl).hostname.toLowerCase();
  const site = registrableOf(host);
  const head = html.slice(0, 200000);
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (key) => { const t = metas.find((m) => (attr(m, 'property') || attr(m, 'name') || '').toLowerCase() === key); return t ? decode(attr(t, 'content') || '') : null; };
  const h1 = decode((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const text = textOf(html);
  const lower = text.toLowerCase();

  // Forms and fields
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].map((m) => {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const action = attr(tag, 'action');
    let target = null;
    try { target = action && !/^javascript:/i.test(action) ? new URL(decode(action), finalUrl).href : null; } catch { /* bad action */ }
    const inputs = [...m[1].matchAll(/<input\b[^>]*>/gi)].map((i) => i[0]);
    return { action: target, inputs };
  });
  const allInputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((i) => i[0]);
  const fieldText = (i) => `${attr(i, 'type') || ''} ${attr(i, 'name') || ''} ${attr(i, 'id') || ''} ${attr(i, 'autocomplete') || ''} ${attr(i, 'placeholder') || ''}`.toLowerCase();
  const password = allInputs.some((i) => (attr(i, 'type') || '').toLowerCase() === 'password');
  const card = allInputs.some((i) => /cc-number|cardnumber|card[-_ ]?number|kortnummer|\bcvv\b|\bcvc\b|cc-csc|security code|expiry|cc-exp/.test(fieldText(i)));
  const cpr = allInputs.some((i) => /\bcpr\b|personnummer|social security|\bssn\b/.test(fieldText(i)));
  const otp = allInputs.some((i) => /one-time-code|\botp\b|sms[-_ ]?code|engangskode|verification code/.test(fieldText(i)));
  const offsiteForms = forms.filter((fm) => fm.action && /^https?:/i.test(fm.action) && registrableOf(new URL(fm.action).hostname) !== site).map((fm) => fm.action);
  const exfil = EXFIL.filter((re) => re.test(html)).map((re) => re.source.replace(/\\/g, '').split('|')[0]);

  // Resources the page loads, by registrable domain (a cloned page often still loads the original's images and scripts)
  const resourceHosts = {};
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) {
    try { const d = registrableOf(new URL(decode(m[1])).hostname); if (d !== site) resourceHosts[d] = (resourceHosts[d] || 0) + 1; } catch { /* ignore */ }
  }

  // Favicon
  const iconTag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((l) => /\bicon\b/i.test(attr(l, 'rel') || ''));
  let favicon = null;
  try { favicon = new URL(decode(iconTag ? attr(iconTag, 'href') : '/favicon.ico'), finalUrl).href; } catch { /* ignore */ }

  // Who they say they are, how they want to be paid
  const emails = [...new Set((html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/sentry|wixpress|example\.com/.test(e)))].slice(0, 10);
  const freeMail = emails.filter((e) => FREE_MAIL.includes(e.split('@')[1]));
  const cvr = [...new Set([...text.matchAll(/\b(?:CVR|VAT|Moms|SE)[\s.:-]*(?:nr\.?|nummer|no\.?|number)?[\s.:-]*(?:DK)?[\s-]?(\d{2}\s?\d{2}\s?\d{2}\s?\d{2})\b/gi)].map((m) => m[1].replace(/\s/g, '')))].slice(0, 3);
  const phones = (text.match(/(?:\+\d{2}[\s-]?)?(?:\d{2}[\s-]?){4}\b/g) || []).length;
  const pay = {
    crypto: /(pay(?:ment)? (?:with|in|by) (?:bitcoin|btc|crypto|usdt|ethereum)|betal(?:ing)? (?:med|i) (?:bitcoin|krypto)|send (?:the )?(?:btc|usdt|eth|bitcoin) to|(?:btc|usdt|eth|bitcoin|wallet) address)/i.test(lower),
    bankTransferOnly: /\b(bank transfer only|only bank transfer|kun bankoverførsel|kun overførsel|western union|moneygram|gift ?cards? only)\b/i.test(lower),
    cards: /\b(visa|mastercard|dankort|mobilepay|apple pay|google pay|klarna|paypal)\b/i.test(lower),
  };
  const shop = /add to (cart|bag|basket)|læg i (kurv|indkøbskurv)|tilføj til kurv|shopping (cart|bag)|in den warenkorb|lägg i varukorg/i.test(lower) || /woocommerce|cdn\.shopify\.com|mage\/cookies|prestashop/i.test(html.slice(0, 80000));
  const discount = (lower.match(/-\s?(?:[5-9]\d)\s?%|\b(?:[7-9]\d)\s?% (?:off|rabat)/g) || []).length;
  const urgency = /(account (?:has been |will be )?(?:suspended|locked|limited|disabled)|verify your (?:account|identity)|unusual (?:sign-in|activity)|bekræft din identitet|din konto er (?:spærret|låst)|pakke(?:n)? (?:kunne ikke|afventer)|toldgebyr|customs fee|unpaid (?:toll|fee))/i.exec(lower)?.[0] || null;
  const trustpilotBadge = /trustpilot/i.test(html);
  const trustpilotLink = (html.match(/trustpilot\.com\/review\/([a-z0-9.-]+)/i) || [])[1]?.toLowerCase() || null;
  const robots = (meta('robots') || '').toLowerCase();
  const generator = meta('generator');
  const copyright = (text.match(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i) || [])[1] || null;
  const policyLinks = { terms: /(terms|handelsbetingelser|vilkår|conditions)/i.test(lower), privacy: /(privacy|privatliv|persondata|cookie policy)/i.test(lower), returns: /(return|refund|returnering|fortrydelsesret|ombytning)/i.test(lower), contact: /(contact|kontakt)/i.test(lower) };

  return {
    title, siteName: meta('og:site_name'), description: (meta('description') || meta('og:description') || '').slice(0, 200), h1,
    words: text.split(' ').length,
    password, card, cpr, otp, forms: forms.length, offsiteForms: [...new Set(offsiteForms)].slice(0, 5), exfil,
    resourceHosts, favicon,
    emails, freeMail, cvr, phones, pay, shop, discount, urgency,
    trustpilotBadge, trustpilotLink, noindex: /noindex/.test(robots), generator, copyright, policyLinks,
  };
}

/** sha256 of the favicon, or null. Used to see whether a page wears the brand's own icon. */
export async function faviconHash(url, { fetch: f = globalThis.fetch } = {}) {
  if (!url) return null;
  try {
    const res = await f(url, { headers: { 'user-agent': BROWSER_UA }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 50 || /^\s*</.test(buf.subarray(0, 20).toString())) return null;
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch { return null; }
}

/** The brand's own favicon hash, from its home page. */
export async function brandFaviconHash(domain, deps = {}) {
  const page = await fetchChain(`https://${domain}/`, { ...deps, max: 5, timeout: 12000 });
  if (!page.ok || !page.html) return faviconHash(`https://${domain}/favicon.ico`, deps);
  return faviconHash(analyzePage(page.html, page.final).favicon, deps);
}

/**
 * cloaking(url, first) -> { differs, note } — fetch again as a plain script; phishing kits often
 * show crawlers and scanners an empty page or a redirect to the real brand.
 */
export async function cloaking(url, first, { fetch: f = globalThis.fetch } = {}) {
  const second = await fetchChain(url, { fetch: f, ua: 'curl/8.5.0', max: 5, timeout: 12000 });
  if (!first.ok || !second.ok) return { differs: false };
  const a = registrableOf(new URL(first.final).hostname); const b = registrableOf(new URL(second.final).hostname);
  if (a !== b) return { differs: true, note: `a browser ends on ${a}, a script on ${b}` };
  const la = first.html.length; const lb = second.html.length;
  if ((first.status < 400) !== (second.status < 400)) return { differs: true, note: `a browser gets HTTP ${first.status}, a script HTTP ${second.status}` };
  if (la > 3000 && lb < la * 0.2) return { differs: true, note: `a browser gets ${la} bytes, a script ${lb}` };
  return { differs: false };
}
