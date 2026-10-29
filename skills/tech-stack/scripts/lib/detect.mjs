/**
 * Matches signatures against what was collected from one page. Pure: no network.
 *
 * Input (all fields optional except url):
 *   { url, finalUrl, headers: [[name, value], …], cookies: [name, …], html, renderedHtml,
 *     urls: [absolute URL, …], assets: [{ url, body }], globals: { path: value } }
 */
import { SIGNATURES, CATEGORIES } from './signatures.mjs';
import { metaTags } from './page.mjs';

const MAX_EVIDENCE = 4;
// Which evidence to trust for the version when several disagree.
const VERSION_RANK = { global: 6, meta: 5, header: 5, npm: 4, url: 3, asset: 2, html: 1, cookie: 0, implied: -1 };

const asPattern = (p) => (p instanceof RegExp ? { re: p, weak: false } : p);
const clip = (s, n = 120) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const looksLikeVersion = (v) => typeof v === 'string' && /^\d+(?:\.\d+){0,3}(?:[-+][\w.-]+)?$/.test(v);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// /npm/x@1.2.3, unpkg.com/x@1.2.3, esm.sh/x@1.2.3, cdnjs /ajax/libs/x/1.2.3/
function npmPattern(pkg) {
  const n = escapeRe(pkg);
  return new RegExp(`(?:/npm/|unpkg\\.com/|esm\\.sh/|cdn\\.skypack\\.dev/|/ajax/libs/)${n}(?:@|/)(\\d+(?:\\.\\d+){0,2}(?:-[\\w.]+)?)?(?=[/?#]|$)`, 'i');
}
const NPM_RE = new Map();

/** Detects technologies on one page. Returns them sorted by category order, then name. */
export function detect(input) {
  const headers = (input.headers || []).map(([k, v]) => [String(k).toLowerCase(), String(v)]);
  const cookies = [...new Set(input.cookies || [])];
  const html = [input.html, input.renderedHtml].filter(Boolean).join('\n');
  const meta = metaTags(html);
  const urls = [...new Set(input.urls || [])];
  const assets = input.assets || [];
  const globals = input.globals || {};

  const found = new Map();
  const add = (sig, ev) => {
    let t = found.get(sig.name);
    if (!t) { t = { sig, evidence: [] }; found.set(sig.name, t); }
    if (t.evidence.some((e) => e.type === ev.type && e.detail === ev.detail)) return;
    t.evidence.push(ev);
  };
  const capture = (m) => (m && m[1] !== undefined ? m[1] : null);

  let host = '';
  try { host = new URL(input.finalUrl || input.url).hostname; } catch { /* keep empty */ }

  for (const sig of SIGNATURES) {
    if (sig.notHosts && sig.notHosts.test(host)) continue;
    for (const [name, re] of Object.entries(sig.headers || {})) {
      for (const [k, v] of headers) {
        if (k !== name) continue;
        const m = v.match(re);
        if (m) { add(sig, { type: 'header', detail: `${k}: ${clip(v, 80)}`, value: capture(m) }); break; }
      }
    }
    for (const re of sig.cookies || []) {
      const c = cookies.find((n) => re.test(n));
      if (c) add(sig, { type: 'cookie', detail: `cookie ${c}` });
    }
    for (const [name, re] of Object.entries(sig.meta || {})) {
      for (const content of meta[name] || []) {
        const m = content.match(re);
        if (m) { add(sig, { type: 'meta', detail: `<meta name="${name}" content="${clip(content, 60)}">`, value: capture(m) }); break; }
      }
    }
    for (const p of (sig.html || []).map(asPattern)) {
      const m = html.match(p.re);
      if (m) add(sig, { type: 'html', detail: `markup: ${clip(m[0], 80)}`, value: capture(m), weak: p.weak });
    }
    const urlPatterns = (sig.urls || []).map(asPattern);
    if (sig.npm) {
      if (!NPM_RE.has(sig.npm)) NPM_RE.set(sig.npm, npmPattern(sig.npm));
      urlPatterns.push({ re: NPM_RE.get(sig.npm), weak: false, npm: true });
    }
    for (const p of urlPatterns) {
      for (const u of urls) {
        const m = u.match(p.re);
        if (m) { add(sig, { type: p.npm ? 'npm' : 'url', detail: clip(u), value: capture(m), weak: p.weak }); break; }
      }
    }
    for (const p of (sig.assets || []).map(asPattern)) {
      for (const a of assets) {
        const m = a.body && a.body.match(p.re);
        if (m) { add(sig, { type: 'asset', detail: `in ${clip(a.url, 100)}: ${clip(m[0], 50)}`, value: capture(m), weak: p.weak }); break; }
      }
    }
    for (const path of sig.globals || []) {
      if (!(path in globals)) continue;
      const v = globals[path];
      add(sig, { type: 'global', detail: `window.${path}${typeof v === 'string' || typeof v === 'number' ? ` = ${clip(String(v), 40)}` : ''}`, value: typeof v === 'number' ? String(v) : typeof v === 'string' ? v : null });
    }
  }

  // Implied technologies (Next.js → React → …), confident only when the implier is.
  const bySig = new Map(SIGNATURES.map((s) => [s.name, s]));
  const queue = [...found.values()];
  while (queue.length) {
    const t = queue.shift();
    const strong = t.evidence.some((e) => !e.weak);
    for (const name of t.sig.implies || []) {
      const sig = bySig.get(name);
      if (!sig) continue;
      const existed = found.has(name);
      add(sig, { type: 'implied', detail: `implied by ${t.sig.name}`, weak: !strong });
      if (!existed) queue.push(found.get(name));
    }
  }

  const order = Object.keys(CATEGORIES);
  return [...found.values()]
    .map(({ sig, evidence }) => {
      const strong = evidence.filter((e) => !e.weak);
      const values = evidence.filter((e) => e.value !== null && e.value !== undefined);
      let version = null; let ids = [];
      if (sig.ids) ids = [...new Set(values.map((e) => e.value))];
      else {
        const best = values.filter((e) => looksLikeVersion(e.value)).sort((a, b) => VERSION_RANK[b.type] - VERSION_RANK[a.type])[0];
        version = best ? best.value : null;
      }
      // Real evidence first, implied last, capped so the report stays readable.
      const shown = [...evidence].sort((a, b) => (a.type === 'implied') - (b.type === 'implied') || (a.weak === true) - (b.weak === true)).slice(0, MAX_EVIDENCE);
      return {
        name: sig.name,
        category: sig.cat,
        categoryLabel: CATEGORIES[sig.cat],
        version,
        ...(ids.length ? { ids } : {}),
        confidence: strong.length ? 'detected' : 'possible',
        evidence: shown.map((e) => `${e.detail}${e.weak ? ' (weak)' : ''}`),
      };
    })
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));
}

/** Every window path any signature asks about, for the browser pass. */
export const GLOBAL_PATHS = [...new Set(SIGNATURES.flatMap((s) => s.globals || []))];
