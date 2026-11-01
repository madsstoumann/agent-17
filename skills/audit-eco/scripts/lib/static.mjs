/**
 * Page weight without a browser: the HTML, then what it references (scripts, stylesheets,
 * eager images, preloads, autoplaying media) and the fonts and @imports in each stylesheet.
 * An estimate: no JavaScript runs, so anything a script loads is missed. Used only when no
 * Chrome is found, or with --no-browser.
 *
 * Zero dependencies. Node >= 22. Never throws.
 */
import { tokenize } from './html.mjs';
import { pLimit } from './http.mjs';

const abs = (href, base) => { try { const u = new URL(String(href).trim(), base); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; } };

/** What a first view loads, read from the HTML: [{ url, type }]. */
export function staticAssets(html, baseUrl) {
  const out = []; const seen = new Set();
  const add = (href, type) => { const u = abs(href, baseUrl); if (u && !seen.has(u)) { seen.add(u); out.push({ url: u, type }); } };
  for (const t of tokenize(html)) {
    const a = t.attrs;
    const rel = String(a.rel || '').toLowerCase().split(/\s+/);
    if (t.tag === 'script' && a.src) add(a.src, 'Script');
    else if (t.tag === 'link' && rel.includes('stylesheet') && a.href) add(a.href, 'Stylesheet');
    else if (t.tag === 'link' && rel.includes('preload') && a.href) add(a.href, { font: 'Font', image: 'Image', script: 'Script', style: 'Stylesheet' }[a.as] || 'Other');
    else if (t.tag === 'img' && a.loading !== 'lazy') add(a.src || String(a.srcset || '').split(',')[0].trim().split(/\s+/)[0], 'Image');
    else if ((t.tag === 'video' || t.tag === 'audio') && 'autoplay' in a && a.src) add(a.src, 'Media');
    else if ((t.tag === 'video') && a.poster) add(a.poster, 'Image');
  }
  return out;
}

/** url(...) fonts and @import stylesheets in a stylesheet. */
export function cssAssets(css, baseUrl) {
  const out = [];
  for (const m of String(css || '').matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/g)) { const u = abs(m[1], baseUrl); if (u) out.push({ url: u, type: 'Stylesheet' }); }
  for (const face of String(css || '').match(/@font-face\s*{[^}]*}/g) || []) {
    // The first format the browser supports is the one it downloads: take the first url().
    const m = face.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
    const u = m && !/^data:/.test(m[1]) ? abs(m[1], baseUrl) : null;
    if (u) out.push({ url: u, type: 'Font' });
  }
  return out;
}

/**
 * measureStatic(http, url) -> the same shape as browser.measure(), with estimate: true.
 * Transfer size is content-length when the server sends it, else an estimate from the decoded size.
 */
export async function measureStatic(http, url, { concurrency = 6 } = {}) {
  const page = await http.get(url, { redirect: 'follow', maxBytes: 8 * 1024 * 1024 });
  if (page.status === 0) return { ok: false, url, error: page.error };
  // fetch hands back the decoded body. With no content-length to go by, a compressed text file is
  // counted at 30% of its decoded size, about what gzip and Brotli achieve on HTML, CSS and JS.
  const wire = (res) => Number(res.headers?.['content-length']) || (res.headers?.['content-encoding'] ? Math.round((res.bytes || 0) * 0.3) : res.bytes || 0);
  const rec = (u, type, res) => ({
    url: u, type, status: res.status, mimeType: String(res.contentType || '').split(';')[0], transfer: wire(res), size: res.bytes || 0,
    encoding: res.headers?.['content-encoding'] || null, cacheControl: res.headers?.['cache-control'] || null, protocol: null, failed: res.status === 0 ? res.error : false, lazy: false,
  });
  const requests = [rec(page.finalUrl || url, 'Document', page)];
  const limit = pLimit(concurrency);
  const seen = new Set([page.finalUrl || url]);
  const fetchAll = async (list) => Promise.all(list.filter((a) => !seen.has(a.url) && seen.add(a.url)).map((a) => limit(async () => {
    const res = await http.get(a.url, { redirect: 'follow', as: a.type === 'Stylesheet' ? 'text' : 'buffer', maxBytes: 30 * 1024 * 1024, timeout: 20000 });
    requests.push(rec(a.url, a.type, res));
    if (a.type === 'Stylesheet' && res.body) await fetchAll(cssAssets(res.body, res.finalUrl || a.url));
  })));
  await fetchAll(staticAssets(page.body || '', page.finalUrl || url));
  const bytes = requests.reduce((n, r) => n + r.transfer, 0);
  return { ok: true, estimate: true, url, finalUrl: page.finalUrl || url, status: page.status, requests, initialBytes: bytes, afterScrollBytes: bytes, images: null, viewport: null };
}
