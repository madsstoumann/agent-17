/**
 * The site crawl: same-host pages by following links (breadth first, robots.txt respected),
 * then a sample of sitemap URLs the links never reached. When --pages runs out, the budget is
 * shared across language sections (/en/, /es-ES/, …) so one locale cannot use it all up, and
 * internal link targets that were found but not fetched get a status check of their own
 * (checkInternal), so a broken footer link in any crawled section is reported. Redirects are not followed by fetch:
 * a 3xx is recorded as its own page with its `location`, and the target joins the queue, so
 * redirect chains and links that point at redirects can be read off the page list.
 *
 * Zero dependencies. Node >= 22.
 */
import { extractLinks, extractMeta, stripTags, tokenize } from './html.mjs';
import { richOf } from './rich.mjs';
import { pageSignals } from './content.mjs';
import { hostOf, pLimit } from './http.mjs';
import { isAllowed } from './robotsmatch.mjs';

const SKIP_PATH = /^\/cdn-cgi\//;
const SKIP_EXT = /\.(pdf|zip|gz|tar|rar|7z|dmg|exe|msi|jpe?g|png|gif|webp|avif|svg|ico|mp4|mp3|webm|ogg|wav|woff2?|ttf|otf|css|js|mjs|json|xml|txt|csv|xlsx?|docx?|pptx?)(\?|$)/i;

/** A locale path segment: en, da, es-ES, en-gb, zh-Hans, pt_BR. */
const LOCALE_SEG = /^[a-z]{2}(?:[-_](?:[a-z]{2}|[a-z]{4}))?$/i;

/** The language section a URL belongs to: its locale prefix lower-cased, or '' when it has none. */
export function localeOf(u) {
  try {
    const seg = new URL(u).pathname.split('/').filter(Boolean)[0] || '';
    return LOCALE_SEG.test(seg) ? seg.toLowerCase().replace('_', '-') : '';
  } catch { return ''; }
}

export function normalise(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.toString();
  } catch { return null; }
}

const directives = (v) => String(v || '').toLowerCase().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

/** Visible words in the body: scripts, styles, SVG, noscript and templates removed. */
export function wordCount(html) {
  const body = String(html || '').replace(/^[\s\S]*?<body[^>]*>/i, '');
  const text = stripTags(body.replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' '));
  return text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

/** One fetched URL as a flat record. `html` is null for non-HTML and for redirects. */
export function pageRecord(url, res, html) {
  const headers = res.headers || {};
  const rec = {
    url,
    status: res.status,
    error: res.error || null,
    location: null,
    contentType: String(headers['content-type'] || '').split(';')[0].trim(),
    xRobots: headers['x-robots-tag'] || null,
    ms: res.ms ?? null,
  };
  if (res.status >= 300 && res.status < 400 && headers.location) {
    try { rec.location = new URL(headers.location, url).toString(); } catch { rec.location = null; }
  }
  if (!html) return rec;
  const meta = extractMeta(html, url);
  const imgs = tokenize(html).filter((t) => t.tag === 'img');
  const noindex = [...directives(rec.xRobots), ...directives(meta.robots), ...directives(meta.googlebot)].some((d) => d === 'noindex' || d === 'none');
  Object.assign(rec, {
    title: meta.title,
    description: meta.description,
    metaRobots: meta.robots,
    noindex,
    canonical: meta.canonical,
    canonicalRaw: rawCanonical(html),
    lang: meta.lang,
    h1Count: meta.h1Count,
    h1: meta.h1s[0] || null,
    hreflang: meta.hreflang,
    og: meta.og,
    twitter: meta.twitter,
    jsonLd: meta.jsonLd.map((j) => ({ types: j.types, error: j.error })),
    ...richOf(meta.jsonLd),
    words: wordCount(html),
    sig: pageSignals(html, meta.jsonLd),
    imgNoAlt: imgs.filter((t) => !('alt' in t.attrs)).length,
    bytes: Buffer.byteLength(html),
  });
  return rec;
}

/** The canonical href as written, to tell a relative one from an absolute one. */
function rawCanonical(html) {
  const t = tokenize(html).find((x) => x.tag === 'link' && /(^|\s)canonical(\s|$)/i.test(x.attrs.rel || '') && x.attrs.href != null);
  return t ? t.attrs.href.trim() : null;
}

/**
 * crawlSite(http, { startUrl, sitemapUrls, robots, maxPages, sitemapSample, ignoreRobots, log })
 *   -> { pages, inlinks: Map<url, Set<from>>, external: Map<url, Set<from>>, blocked: Map<url, Set<from>>, truncated,
 *        sitemapMissing, sitemapSampled, locales: { <locale or ''>: pages fetched } }
 * `hosts` are the hosts that count as this site (the start host and its www/apex sibling).
 */
export async function crawlSite(http, { startUrl, hosts, sitemapUrls = [], robots = null, maxPages = 150, sitemapSample = 50, ignoreRobots = false, concurrency = 6, log = () => {} } = {}) {
  const own = new Set(hosts && hosts.length ? hosts : [hostOf(startUrl)]);
  const pages = new Map();
  const inlinks = new Map();
  const external = new Map();
  const blocked = new Map();
  const seen = new Set();
  const queue = [];
  const limit = pLimit(concurrency);
  let truncated = false;
  let linkBudget = maxPages;
  let followLinks = true;

  const record = (map, link, from) => {
    if (!map.has(link)) map.set(link, new Set());
    map.get(link).add(from);
  };
  const crawlable = (u) => {
    const p = new URL(u).pathname;
    return !SKIP_EXT.test(p) && !SKIP_PATH.test(p);
  };
  // Links wait in `pending` until a wave picks them; each wave takes the sections with the fewest
  // pages so far first, so /es-ES/ gets its share even when /en/ was found first.
  const pending = [];
  const perLocale = new Map();
  const WAVE = Math.max(concurrency * 4, 24);
  const allowed = (n) => n && !seen.has(n) && own.has(hostOf(n)) && crawlable(n)
    && (ignoreRobots || !robots || isAllowed(robots, new URL(n).pathname + new URL(n).search));
  const take = (n) => { seen.add(n); queue.push(n); const l = localeOf(n); perLocale.set(l, (perLocale.get(l) || 0) + 1); };
  const enqueue = (u, { budget = true } = {}) => {
    const n = normalise(u);
    // A redirect target already waiting in `pending` is fetched now: it is part of a chain.
    if (!budget && n && pending.includes(n)) { pending.splice(pending.indexOf(n), 1); take(n); return; }
    if (!allowed(n)) return;
    if (!budget) { take(n); return; }
    seen.add(n);
    pending.push(n);
  };
  const fillWave = () => {
    // At most half of what is left per wave, so sections found late still get pages.
    let room = Math.min(WAVE, Math.ceil(linkBudget / 2));
    while (room > 0 && pending.length) {
      let best = 0; let bestCount = Infinity;
      for (let i = 0; i < pending.length; i++) {
        const c = perLocale.get(localeOf(pending[i])) || 0;
        if (c < bestCount) { best = i; bestCount = c; if (c === 0) break; }
      }
      const [n] = pending.splice(best, 1);
      take(n);
      linkBudget--; room--;
    }
    if (pending.length && linkBudget <= 0) truncated = true;
  };

  async function visit(url) {
    const res = await http.get(url, { redirect: 'manual', maxBytes: 2 * 1024 * 1024 });
    const isHtml = res.status >= 200 && res.status < 300 && /text\/html|application\/xhtml/i.test(res.contentType || '');
    const html = isHtml && res.body ? res.body : null;
    const rec = pageRecord(url, res, html);
    pages.set(url, rec);
    // A redirect's target is part of the chain, whatever the budget.
    if (rec.location) {
      const target = normalise(rec.location);
      if (target && own.has(hostOf(target))) { record(inlinks, target, url); enqueue(target, { budget: false }); }
    }
    if (!html) return;
    rec.outlinks = 0;
    for (const l of extractLinks(html, url)) {
      const link = normalise(l.href);
      if (!link) continue;
      if (!own.has(hostOf(link))) { record(external, link, url); continue; }
      if (!crawlable(link)) continue;
      rec.outlinks++;
      if (!ignoreRobots && robots && !isAllowed(robots, new URL(link).pathname + new URL(link).search)) { record(blocked, link, url); continue; }
      record(inlinks, link, url);
      if (followLinks) enqueue(link);
    }
  }

  async function drain() {
    if (followLinks) fillWave();
    while (queue.length) {
      const wave = queue.splice(0, queue.length);
      log(`crawl: ${pages.size} fetched, ${wave.length} queued`);
      await Promise.all(wave.map((u) => limit(() => visit(u))));
      if (followLinks) fillWave();
    }
  }

  enqueue(startUrl, { budget: false });
  await drain();
  // Links left over when the budget ran out were never fetched: the sitemap sample may still take them.
  for (const n of pending.splice(0)) seen.delete(n);

  // Sitemap URLs the links never reached: a deterministic sample, spread over the file.
  const missing = sitemapUrls.map(normalise).filter((u) => u && !seen.has(u) && own.has(hostOf(u)));
  const sample = sampleSpread(missing, sitemapSample);
  for (const u of sample) { seen.add(u); queue.push(u); }
  if (sample.length) {
    log(`sitemap: fetching ${sample.length} of ${missing.length} URLs the crawl did not reach`);
    followLinks = false; // follow their redirects, not their links
    await drain();
  }
  return { pages: [...pages.values()], inlinks, external, blocked, truncated, sitemapMissing: missing.length, sitemapSampled: sample.length, locales: Object.fromEntries(perLocale) };
}

/**
 * A deterministic sample of `n` URLs, spread over each language section's part of the list and
 * shared round robin between sections, so a sitemap that lists /en/ first still yields /es-ES/ pages.
 */
export function sampleSpread(urls, n) {
  const groups = new Map();
  for (const u of urls) { const l = localeOf(u); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(u); }
  const lists = [...groups.values()];
  const share = new Map();
  let left = Math.min(n, urls.length);
  // Even shares, small sections first so their leftovers go to the big ones.
  const order = [...lists].sort((a, b) => a.length - b.length);
  order.forEach((l, i) => { const k = Math.min(l.length, Math.floor(left / (order.length - i))); share.set(l, k); left -= k; });
  const out = [];
  for (const l of lists) {
    const k = share.get(l);
    const step = l.length > k ? l.length / k : 1;
    for (let i = 0, taken = 0; i < l.length && taken < k; i += step, taken++) out.push(l[Math.floor(i)]);
  }
  return out;
}

/**
 * checkInternal(http, crawl, { max, concurrency }) -> { checked: [{ url, status, error }], unchecked }
 * Internal link targets the crawl recorded but never fetched (the --pages budget ran out), checked
 * for a status, spread over language sections the same way the crawl is. Redirects are followed,
 * so a link to a redirect that ends in a 404 counts as broken.
 */
export async function checkInternal(http, { pages, inlinks }, { max = 300, concurrency = 6, timeout = 10000 } = {}) {
  const fetched = new Set(pages.map((p) => p.url));
  const todo = [...inlinks.keys()].filter((u) => !fetched.has(u));
  // Round robin over sections: the first unchecked link of each locale, then the second, …
  const bySection = new Map();
  for (const u of todo) { const l = localeOf(u); if (!bySection.has(l)) bySection.set(l, []); bySection.get(l).push(u); }
  const lists = [...bySection.values()];
  const picked = [];
  for (let i = 0; picked.length < Math.min(max, todo.length); i++) for (const l of lists) if (l[i] && picked.length < max) picked.push(l[i]);
  const lim = pLimit(concurrency);
  const checked = await Promise.all(picked.map((url) => lim(async () => {
    let r = await http.head(url, { redirect: 'follow', timeout });
    if (r.status === 0 || r.status === 405 || r.status === 501) r = await http.get(url, { redirect: 'follow', timeout, maxBytes: 0 });
    return { url, status: r.status, error: r.error || null };
  })));
  return { checked, unchecked: todo.length - picked.length };
}

/**
 * checkLinks(http, urls, { concurrency, timeout }) -> [{ url, status, ok, blocked, error }]
 * HEAD first, GET when HEAD is refused. A 400/401/403/405/429/999 is a bot wall, not a dead link.
 */
export async function checkExternal(http, urls, { concurrency = 6, timeout = 10000 } = {}) {
  const limit = pLimit(concurrency);
  return Promise.all(urls.map((url) => limit(async () => {
    let res = await http.head(url, { timeout, redirect: 'follow' });
    if (res.status === 0 || [403, 405, 500, 501].includes(res.status)) res = await http.get(url, { timeout, redirect: 'follow', maxBytes: 0 });
    const blocked = [400, 401, 403, 405, 429, 999].includes(res.status);
    return { url, status: res.status, ok: (res.status >= 200 && res.status < 400) || blocked, blocked, error: res.error || null };
  })));
}
