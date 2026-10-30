// Which pages to audit: a list the user gives, launch-audit's crawl, or the sitemap plus the start
// page's links, sampled so different templates (first path segment, depth) come before more of one.
import fs from 'node:fs';

const SKIP = /\.(pdf|zip|gz|jpe?g|png|gif|webp|avif|svg|ico|mp4|mp3|webm|woff2?|ttf|css|js|mjs|json|xml|txt|csv|xlsx?|docx?|pptx?)(\?|$)/i;

function clean(u, origin) {
  try {
    const x = new URL(u);
    if (origin && x.origin !== origin) return null;
    if (!/^https?:$/.test(x.protocol) || SKIP.test(x.pathname) || /^\/cdn-cgi\//.test(x.pathname)) return null;
    x.hash = '';
    return x.href;
  } catch { return null; }
}

/** <loc> values from a sitemap or sitemap index. */
export const sitemapLocs = (xml) => [...String(xml || '').matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));

/** Template key: first path segment and depth, so /news/a and /news/b count as one template. */
export const templateOf = (u) => {
  const segs = new URL(u).pathname.split('/').filter(Boolean);
  return `${segs[0] || ''}|${Math.min(segs.length, 3)}`;
};

/** Start page first, then one URL per template in the order found, then the rest, up to `n`. */
export function pickPages({ start, candidates = [], n = 10 }) {
  const origin = new URL(start).origin;
  const startClean = clean(start, origin) || start;
  const seen = new Set([startClean, startClean.replace(/\/$/, '')]);
  const pool = [];
  for (const c of candidates) {
    const u = clean(c, origin);
    if (!u || seen.has(u) || seen.has(u.replace(/\/$/, ''))) continue;
    seen.add(u); seen.add(u.replace(/\/$/, ''));
    pool.push(u);
  }
  const out = [startClean];
  const templates = new Set([templateOf(startClean)]);
  for (const u of pool) {
    if (out.length >= n) break;
    const t = templateOf(u);
    if (!templates.has(t)) { templates.add(t); out.push(u); }
  }
  for (const u of pool) {
    if (out.length >= n) break;
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, Math.max(1, n));
}

/** Pages from a launch-audit report.json (its crawl), HTML 200s only. */
export function pagesFromLaunchAudit(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pages = data.pages || data.crawl?.pages || [];
  return pages.filter((p) => (!p.status || p.status === 200) && (!p.contentType || /html/.test(p.contentType))).map((p) => p.url).filter(Boolean);
}

/** One URL per line; # comments and blank lines ignored. */
export const pagesFromFile = (file) => fs.readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);

/** Sitemap URLs (robots.txt Sitemap lines, else /sitemap.xml), one level of sitemap index. Never throws. */
export async function sitemapUrls(start, { headers = {}, fetchImpl = fetch, max = 2000 } = {}) {
  const origin = new URL(start).origin;
  const get = async (u) => {
    try {
      const r = await fetchImpl(u, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      return r.ok ? await r.text() : null;
    } catch { return null; }
  };
  const robots = await get(`${origin}/robots.txt`);
  const listed = robots ? [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const roots = listed.length ? listed.slice(0, 3) : [`${origin}/sitemap.xml`];
  const urls = [];
  for (const root of roots) {
    const xml = await get(root);
    if (!xml) continue;
    const locs = sitemapLocs(xml);
    if (/<sitemapindex/i.test(xml)) {
      for (const child of locs.slice(0, 5)) {
        urls.push(...sitemapLocs(await get(child)));
        if (urls.length >= max) break;
      }
    } else urls.push(...locs);
    if (urls.length >= max) break;
  }
  return urls.slice(0, max);
}
