/**
 * Network side: fetch the page (following redirects by hand so every hop's
 * headers and cookies count), then a capped number of its own scripts and
 * stylesheets. Passive: only URLs the page itself references are requested.
 *
 * Zero dependencies. Node >= 20.
 */
import { challengeReason, pageUrls, sameSite, title } from './page.mjs';

export const VERSION = '1.0.1';
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const BASE_HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en,da;q=0.8',
  'x-audit': `tech-stack/${VERSION}`,
};

export function normaliseUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('empty URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error(`not an http(s) URL: ${input}`);
  u.hash = ''; u.username = ''; u.password = '';
  return u.href;
}

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
    if (size >= maxBytes) { await reader.cancel().catch(() => {}); break; }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes).toString('utf8');
}

/** GET with manual redirects. Returns { finalUrl, status, hops: [{ url, status, headers }], cookies, body }. */
export async function get(url, { timeout = 15000, maxBytes = 5_000_000, maxRedirects = 10, accept } = {}) {
  const hops = []; const cookies = [];
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: accept ? { ...BASE_HEADERS, accept } : BASE_HEADERS,
      signal: AbortSignal.timeout(timeout),
    });
    const headers = [...res.headers.entries()];
    for (const c of res.headers.getSetCookie?.() || []) { const n = c.split('=')[0].trim(); if (n) cookies.push(n); }
    hops.push({ url: current, status: res.status, headers });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel().catch(() => {});
      current = new URL(loc, current).href;
      continue;
    }
    const body = await readCapped(res, maxBytes);
    return { finalUrl: current, status: res.status, hops, cookies, body, contentType: res.headers.get('content-type') || '' };
  }
  throw new Error(`more than ${maxRedirects} redirects`);
}

/**
 * Everything the detector needs for one URL, without a browser.
 * Assets: same-site scripts first, then same-site stylesheets, up to maxAssets.
 * Third-party scripts (tag managers, trackers) are not fetched: their URL is the
 * evidence, and their contents mention dozens of libraries the site does not use.
 */
export async function collect(url, { timeout = 15000, maxAssets = 12, assetBytes = 2_000_000, log = () => {} } = {}) {
  const page = await get(url, { timeout });
  const html = /html|xml/i.test(page.contentType) || /^\s*</.test(page.body) ? page.body : '';
  const { scripts, styles, other } = pageUrls(html, page.finalUrl);
  const own = [...scripts, ...styles].filter((u) => sameSite(u, page.finalUrl));
  const picked = own.slice(0, maxAssets);
  const assets = []; const errors = [];
  await Promise.all(picked.map(async (u) => {
    try {
      const r = await get(u, { timeout, maxBytes: assetBytes, accept: '*/*' });
      if (r.status < 400) assets.push({ url: u, body: r.body });
    } catch (e) { errors.push(`asset ${u}: ${e.cause?.code || e.message}`); }
  }));
  log(`  ${page.finalUrl}: ${page.status}, ${scripts.length} scripts, ${styles.length} stylesheets, fetched ${assets.length}/${own.length} same-site assets`);
  return {
    url,
    finalUrl: page.finalUrl,
    status: page.status,
    redirects: page.hops.slice(0, -1).map((h) => ({ url: h.url, status: h.status })),
    title: title(html),
    challenge: challengeReason(page.status, html, page.hops.at(-1).headers),
    // Every hop counts: a redirect from the apex often comes from a different server or CDN than the page.
    headers: page.hops.flatMap((h) => h.headers),
    cookies: page.cookies,
    html,
    urls: [...scripts, ...styles, ...other],
    assets,
    assetStats: { scripts: scripts.length, styles: styles.length, sameSite: own.length, fetched: assets.length },
    errors,
  };
}
