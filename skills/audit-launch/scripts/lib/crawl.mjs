/**
 * Bounded same-host crawl (start URL + sitemap sample, BFS, --max-pages) that
 * records per-page SEO basics, and a link checker for what the crawl found.
 */
import { extractLinks, extractMeta, findMixedContent, tokenize } from './html.mjs';
import { hostOf, pLimit } from './http.mjs';

/** Cloudflare's own endpoints (email obfuscation, challenge) are not site links. */
const SKIP_PATH = /^\/cdn-cgi\//;
const SKIP_EXT = /\.(pdf|zip|gz|tar|rar|7z|dmg|exe|msi|jpe?g|png|gif|webp|avif|svg|ico|mp4|mp3|webm|ogg|wav|woff2?|ttf|otf|css|js|mjs|json|xml|txt|csv|xlsx?|docx?|pptx?)(\?|$)/i;

/** One crawled page. */
export function pageRecordFromHtml(url, status, headers, html) {
  const contentType = String(headers?.['content-type'] || '');
  const meta = html ? extractMeta(html, url) : null;
  const imgs = html ? tokenize(html).filter((t) => t.tag === 'img') : [];
  const mixed = html ? findMixedContent(html, url) : [];
  return {
    url,
    status,
    contentType: contentType.split(';')[0].trim(),
    title: meta?.title || null,
    description: meta?.description || null,
    canonical: meta?.canonical || null,
    robots: meta?.robots || null,
    lang: meta?.lang || null,
    h1Count: meta?.h1Count ?? 0,
    imgCount: imgs.length,
    imgNoAlt: imgs.filter((t) => !('alt' in t.attrs)).length,
    imgEmptyAlt: imgs.filter((t) => 'alt' in t.attrs && t.attrs.alt.trim() === '').length,
    mixedContent: mixed.length,
    mixedContentSamples: mixed.slice(0, 3).map((m) => m.url),
    jsonLdTypes: (meta?.jsonLd || []).flatMap((j) => j.types || []),
    hreflangCount: meta?.hreflang?.length || 0,
    bytes: html ? Buffer.byteLength(html) : 0,
  };
}

/** Absolute, fragment-free, deduped hrefs worth following or checking. */
export function extractCrawlLinks(html, baseUrl) {
  return extractLinks(html, baseUrl).map((l) => l.href);
}

function normalise(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.toString();
  } catch { return null; }
}

/**
 * crawlSite(http, { startUrl, seeds, maxPages, concurrency, maxBytes, log })
 *   -> { pages: PageRecord[], internalLinks: Map<url, Set<fromUrl>>, externalLinks: Map<url, Set<fromUrl>>, truncated, fetched }
 * Only same-host HTML pages are fetched; every link seen is recorded with where it was seen.
 */
export async function crawlSite(http, { startUrl, seeds = [], maxPages = 100, concurrency = 6, maxBytes = 1.5 * 1024 * 1024, log = () => {} } = {}) {
  const host = hostOf(startUrl);
  const queue = [];
  const seen = new Set();
  const pages = [];
  const internalLinks = new Map();
  const externalLinks = new Map();
  const limit = pLimit(concurrency);
  let truncated = false;

  const enqueue = (u) => {
    const n = normalise(u);
    if (!n || seen.has(n)) return;
    if (hostOf(n) !== host) return;
    if (SKIP_EXT.test(new URL(n).pathname) || SKIP_PATH.test(new URL(n).pathname)) return;
    if (seen.size >= maxPages) { truncated = true; return; }
    seen.add(n);
    queue.push(n);
  };
  enqueue(startUrl);
  for (const s of seeds) enqueue(s);

  const record = (map, link, from) => {
    if (!map.has(link)) map.set(link, new Set());
    map.get(link).add(from);
  };

  async function visit(url) {
    const res = await http.get(url, { maxBytes, redirect: 'follow' });
    const isHtml = /text\/html|application\/xhtml/i.test(res.contentType);
    const html = isHtml && res.body ? res.body : null;
    const rec = pageRecordFromHtml(url, res.status, res.headers, html);
    if (res.finalUrl && res.finalUrl !== url) rec.finalUrl = res.finalUrl;
    if (res.error) rec.error = res.error;
    rec.ms = res.ms;
    pages.push(rec);
    if (!html) return;
    for (const link of extractCrawlLinks(html, res.finalUrl || url)) {
      if (hostOf(link) === host) { if (SKIP_PATH.test(new URL(link).pathname)) continue; record(internalLinks, link, url); enqueue(link); }
      else record(externalLinks, link, url);
    }
  }

  // BFS in waves so newly found links join the queue while the pool is busy.
  while (queue.length) {
    const wave = queue.splice(0, queue.length);
    log(`crawl: ${pages.length} fetched, ${wave.length} queued`);
    await Promise.all(wave.map((u) => limit(() => visit(u))));
  }
  return { pages, internalLinks, externalLinks, truncated, fetched: pages.length };
}

/**
 * checkLinks(http, urls, { concurrency, timeout, max, external })
 *   -> [{ url, status, ok, blocked, error, method }]
 * HEAD first, GET (body discarded) when HEAD is refused. For external links a
 * 403/429/999 is "blocked, verify by hand" rather than broken.
 */
export async function checkLinks(http, urls, { concurrency = 6, timeout = 10000, max = 200, external = false } = {}) {
  const limit = pLimit(concurrency);
  const list = urls.slice(0, max);
  return Promise.all(list.map((url) => limit(async () => {
    let res = await http.head(url, { timeout, redirect: 'follow' });
    let method = 'HEAD';
    if (res.status === 0 || [403, 405, 500, 501].includes(res.status)) {
      res = await http.get(url, { timeout, redirect: 'follow', maxBytes: 0 });
      method = 'GET';
    }
    // A 400/401/403/405/429/999 on a plain GET is a bot wall (Facebook, LinkedIn, X…), not a dead link.
    const blocked = external && [400, 401, 403, 405, 429, 999].includes(res.status);
    const ok = (res.status >= 200 && res.status < 400) || blocked;
    return { url, status: res.status, ok, blocked, error: res.error || null, method, finalUrl: res.finalUrl };
  })));
}

/**
 * recheckPages(http, pages, { max }) -> { transient: url[], persistent: [{ url, status }] }
 * Pages that answered 5xx or nothing during the parallel crawl are fetched again one at a
 * time; those that now answer 2xx/3xx were a capacity problem, not a broken page.
 */
export async function recheckPages(http, pages, { max = 20, timeout = 20000 } = {}) {
  const bad = pages.filter((p) => p.status === 0 || p.status >= 500).slice(0, max);
  const transient = []; const persistent = [];
  for (const p of bad) {
    const r = await http.get(p.url, { redirect: 'follow', maxBytes: 0, timeout, retry: 0 });
    if (r.status >= 200 && r.status < 400) { transient.push(p.url); p.status = r.status; p.transient = true; }
    else persistent.push({ url: p.url, status: r.status || r.error });
  }
  return { transient, persistent };
}
