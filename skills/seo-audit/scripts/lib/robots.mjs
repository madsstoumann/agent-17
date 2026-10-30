/**
 * robots.txt (RFC 9309) and XML sitemap readers, plus a deterministic sampler
 * that picks URLs for template diversity, and a loader that walks sitemap indexes.
 *
 * Zero dependencies. Node >= 22. The parsers are pure; `loadSitemaps` takes an
 * `http` object (see http.mjs) and never throws.
 *
 * Copied from launch-audit/scripts/lib/robots.mjs (skills install separately); keep the two in step.
 */
import { gunzipSync } from 'node:zlib';
import { sameUrlModuloSlash } from './http.mjs';

// ---------------------------------------------------------------- robots.txt

/**
 * Parses a robots.txt. Consecutive `User-agent` lines share one group and any other line
 * ends that run (as Google's parser does); a rule before any group is ignored; a rule with
 * an empty path is dropped (it matches nothing).
 * `Sitemap:` and `Host:` are global. Keys are case-insensitive, agents lowercased.
 * Repeated groups for one agent are NOT merged here (see `groupFor`), so `groups`
 * mirrors the file.
 * @param {string} text
 * @returns {{
 *   groups: Array<{ agents: string[], allow: string[], disallow: string[], crawlDelay: number|null }>,
 *   sitemaps: string[], host: string|null
 * }}
 */
export function parseRobotsTxt(text) {
  const out = { groups: [], sitemaps: [], host: null };
  let group = null;
  let collectingAgents = false;
  for (const rawLine of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!collectingAgents) { group = { agents: [], allow: [], disallow: [], crawlDelay: null }; out.groups.push(group); }
      collectingAgents = true;
      if (value) group.agents.push(value.toLowerCase());
      continue;
    }
    collectingAgents = false;
    switch (key) {
      case 'allow':
      case 'disallow': if (group && value) group[key].push(value); break;
      case 'crawl-delay': {
        const n = Number.parseFloat(value);
        if (group && Number.isFinite(n)) group.crawlDelay = n;
        break;
      }
      case 'sitemap': if (value) out.sitemaps.push(value); break;
      case 'host': if (value && out.host == null) out.host = value; break;
      default: break; // an unknown key is ignored (RFC 9309 section 2.2.4)
    }
  }
  return out;
}

function combine(groups) {
  const merged = { agents: [...groups[0].agents], allow: [], disallow: [], crawlDelay: null };
  for (const g of groups) {
    merged.allow.push(...g.allow);
    merged.disallow.push(...g.disallow);
    if (merged.crawlDelay == null && g.crawlDelay != null) merged.crawlDelay = g.crawlDelay;
  }
  return merged;
}

/**
 * The group that applies to `agent`: every group naming the agent exactly (case-insensitive,
 * a `/version` suffix ignored) combined into one, else the `*` groups combined, else null.
 * @param {{ groups: Array<{ agents: string[], allow: string[], disallow: string[], crawlDelay: number|null }> }} parsed
 * @param {string} agent
 * @returns {{ agents: string[], allow: string[], disallow: string[], crawlDelay: number|null } | null}
 */
export function groupFor(parsed, agent) {
  const groups = parsed?.groups || [];
  const token = String(agent ?? '').trim().toLowerCase().split('/')[0];
  const names = (g) => g.agents.map((a) => a.split('/')[0]);
  const exact = token ? groups.filter((g) => names(g).includes(token)) : [];
  if (exact.length) return combine(exact);
  const any = groups.filter((g) => g.agents.includes('*'));
  return any.length ? combine(any) : null;
}

/**
 * True when the `*` group disallows exactly `/` and does not allow `/` back.
 * @param {ReturnType<typeof parseRobotsTxt>} parsed
 * @returns {boolean}
 */
export function isDisallowedForAll(parsed) {
  const star = (parsed?.groups || []).filter((g) => g.agents.includes('*'));
  if (!star.length) return false;
  const g = combine(star);
  return g.disallow.includes('/') && !g.allow.includes('/');
}

// ---------------------------------------------------------------- sitemaps

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(s) {
  if (s == null) return null;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  const raw = cdata ? cdata[1] : s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, ref) => {
    if (ref[0] === '#') {
      const code = /^#x/i.test(ref) ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.hasOwn(XML_ENTITIES, ref.toLowerCase()) ? XML_ENTITIES[ref.toLowerCase()] : m;
  }).trim();
}

function xmlAttrs(s) {
  const out = {};
  for (const m of String(s || '').matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = xmlText(m[2] ?? m[3]);
  return out;
}

/** Text of the first child `<p:name>` of a block, with `p` the sitemap namespace prefix ('' when none). */
function child(block, prefix, name) {
  const m = new RegExp(`<${prefix}${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${prefix}${name}\\s*>`, 'i').exec(block);
  return m ? xmlText(m[1]) : null;
}

function blocks(xml, prefix, name) {
  const re = new RegExp(`<${prefix}${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${prefix}${name}\\s*>`, 'gi');
  return Array.from(xml.matchAll(re), (m) => m[1]);
}

const empty = (kind, error) => ({ kind, urls: [], sitemaps: [], count: 0, error });

/**
 * Regex-based sitemap reader: `<urlset>` or `<sitemapindex>`, with CDATA, XML entities,
 * a namespace prefix on the sitemap elements, and `xhtml:link rel="alternate"` alternates.
 * Anything that is not one of the two (HTML, text, empty) is kind `unknown` with an `error`.
 * @param {string} xml
 * @returns {{
 *   kind: 'urlset'|'sitemapindex'|'unknown',
 *   urls: Array<{ loc: string, lastmod: string|null, alternates: Array<{ lang: string, href: string }> }>,
 *   sitemaps: Array<{ loc: string, lastmod: string|null }>,
 *   count: number, error: string|null
 * }}
 */
export function parseSitemap(xml) {
  const src = String(xml ?? '').replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!src.trim()) return empty('unknown', 'empty body');
  const root = /<([A-Za-z_][\w.-]*:)?(urlset|sitemapindex)(?=[\s>])/.exec(src);
  if (!root) {
    const isHtml = /<!doctype\s+html|<html[\s>]/i.test(src);
    return empty('unknown', isHtml ? 'HTML document, not a sitemap' : 'not a sitemap: no <urlset> or <sitemapindex> element');
  }
  const prefix = (root[1] || '').replace(/\./g, '\\.');
  const kind = root[2];
  const out = { kind, urls: [], sitemaps: [], count: 0, error: null };
  if (kind === 'sitemapindex') {
    for (const b of blocks(src, prefix, 'sitemap')) {
      const loc = child(b, prefix, 'loc');
      if (loc) out.sitemaps.push({ loc, lastmod: child(b, prefix, 'lastmod') });
    }
    out.count = out.sitemaps.length;
    return out;
  }
  for (const b of blocks(src, prefix, 'url')) {
    const loc = child(b, prefix, 'loc');
    if (!loc) continue;
    const alternates = [];
    for (const m of b.matchAll(/<(?:[\w.-]+:)?link\b([^>]*?)\/?>/gi)) {
      const a = xmlAttrs(m[1]);
      if (/^alternate$/i.test(a.rel || '') && a.hreflang && a.href) alternates.push({ lang: a.hreflang, href: a.href });
    }
    out.urls.push({ loc, lastmod: child(b, prefix, 'lastmod'), alternates });
  }
  out.count = out.urls.length;
  return out;
}

/**
 * `parseSitemap` over a fetched body: gunzips a Buffer that starts with `1f 8b` or was
 * fetched from a `.gz` URL (a `.gz` body that is already plain XML passes through).
 * A string body is parsed as text. Same shape as `parseSitemap`.
 * @param {Buffer|string} body
 * @param {{ url?: string, contentType?: string }} [meta]
 * @returns {ReturnType<typeof parseSitemap>}
 */
export function parseSitemapBody(body, { url = '', contentType = '' } = {}) {
  if (typeof body === 'string') return parseSitemap(body);
  if (!Buffer.isBuffer(body)) return empty('unknown', 'no body');
  const magic = body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b;
  let buf = body;
  if (magic || /\.gz(?:[?#]|$)/i.test(url)) {
    try { buf = gunzipSync(body); } catch (e) {
      if (magic || !/^\s*<\?xml|^\s*<[a-z]/i.test(body.subarray(0, 64).toString('utf8'))) return empty('unknown', `gunzip failed: ${e.message}`);
    }
  }
  const parsed = parseSitemap(buf.toString('utf8'));
  if (parsed.kind === 'unknown' && /html/i.test(contentType) && !/HTML/.test(parsed.error)) parsed.error = `${parsed.error} (content-type ${contentType})`;
  return parsed;
}

// ---------------------------------------------------------------- sampling

/**
 * Up to `n` URLs chosen for template diversity, deterministically. Drops the start URL
 * (modulo a trailing slash), URLs with a query string, `exclude`d and invalid ones; buckets
 * the rest by (first path segment, number of path segments); orders buckets by size desc
 * then key asc; round-robins over them, taking the shortest URL first (then alphabetical).
 * @param {string[]} urls
 * @param {{ startUrl: string, n: number, exclude?: string[] }} opts
 * @returns {string[]}
 */
export function sampleSitemapUrls(urls, { startUrl, n, exclude = [] }) {
  if (!(n > 0)) return [];
  const buckets = new Map();
  const seen = new Set();
  for (const raw of urls || []) {
    let u;
    try { u = new URL(String(raw)); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (u.search || seen.has(u.href)) continue;
    if (sameUrlModuloSlash(u.href, startUrl) || exclude.some((x) => x === u.href || sameUrlModuloSlash(u.href, x))) continue;
    seen.add(u.href);
    const segments = u.pathname.split('/').filter(Boolean);
    const key = `${segments[0] || ''}/${segments.length}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(u.href);
  }
  const ordered = [...buckets.entries()]
    .sort(([ka, a], [kb, b]) => b.length - a.length || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, list]) => list.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)));
  const picked = [];
  for (let round = 0; picked.length < n; round++) {
    let any = false;
    for (const list of ordered) {
      if (round >= list.length) continue;
      any = true;
      picked.push(list[round]);
      if (picked.length >= n) break;
    }
    if (!any) break;
  }
  return picked;
}

// ---------------------------------------------------------------- loading

/**
 * Fetches sitemaps and walks indexes. Each fetch is `http.get(url, { as: 'buffer', maxBytes })`.
 * `sources` has one row per sitemap, an index's children in the index's order: a child beyond
 * `maxChildren` (counted across the whole walk), or anything left unfetched once `maxUrls` is
 * reached (`truncated: true`), is `kind: 'skipped'` with `status: null`. A fetch failure or a
 * body that is not a sitemap is a row with an `error`. Never throws.
 * @param {{ get: (url: string, opts: object) => Promise<object> }} http
 * @param {string[]} sitemapUrls
 * @param {{ maxChildren?: number, maxUrls?: number, maxBytes?: number, log?: (msg: string) => void }} [opts]
 * @returns {Promise<{
 *   urls: string[],
 *   sources: Array<{ url: string, status: number|null, kind: 'urlset'|'sitemapindex'|'unknown'|'skipped', count: number, error: string|null }>,
 *   truncated: boolean, indexes: string[]
 * }>}
 */
export async function loadSitemaps(http, sitemapUrls, { maxChildren = 5, maxUrls = 5000, maxBytes = 10 * 1024 * 1024, log = () => {} } = {}) {
  const out = { urls: [], sources: [], truncated: false, indexes: [] };
  const collected = new Set();
  const visited = new Set();
  const reserved = new Map(); // a child's source row, placed in index order before it is fetched
  const queue = [...new Set((sitemapUrls || []).map((u) => String(u).trim()).filter(Boolean))];
  let childrenFollowed = 0;

  while (queue.length && !out.truncated) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    let res;
    try { res = await http.get(url, { as: 'buffer', maxBytes }); } catch (e) { res = { status: 0, ok: false, error: e?.message || String(e) }; }
    let source = reserved.get(url);
    if (!source) { source = { url, status: null, kind: 'unknown', count: 0, error: null }; out.sources.push(source); }
    source.status = res.status ?? 0;
    if (!res.ok) { source.error = res.error || `HTTP ${res.status}`; log(`sitemap ${url} -> ${source.error}`); continue; }
    const parsed = parseSitemapBody(res.body, { url: res.finalUrl || url, contentType: res.contentType || '' });
    source.kind = parsed.kind;
    source.count = parsed.count;
    source.error = parsed.error || (res.truncated ? `body truncated at ${res.bytes} bytes` : null);
    log(`sitemap ${url} -> ${parsed.kind}, ${parsed.count} entries${source.error ? ` (${source.error})` : ''}`);
    if (parsed.kind === 'sitemapindex') {
      out.indexes.push(url);
      for (const { loc } of parsed.sitemaps) {
        if (visited.has(loc) || queue.includes(loc)) continue;
        if (childrenFollowed >= maxChildren) {
          out.sources.push({ url: loc, status: null, kind: 'skipped', count: 0, error: `skipped: more than ${maxChildren} index children` });
          continue;
        }
        childrenFollowed++;
        const row = { url: loc, status: null, kind: 'unknown', count: 0, error: null };
        reserved.set(loc, row);
        out.sources.push(row);
        queue.push(loc);
      }
      continue;
    }
    for (const { loc } of parsed.urls) {
      if (collected.has(loc)) continue;
      if (collected.size >= maxUrls) { out.truncated = true; break; }
      collected.add(loc);
    }
  }
  for (const url of queue) if (!visited.has(url) && !reserved.has(url)) out.sources.push({ url, status: null, kind: 'unknown', count: 0, error: null });
  for (const row of out.sources) if (row.status === null && row.kind === 'unknown') { row.kind = 'skipped'; row.error = 'not fetched: URL cap reached'; }
  out.urls = [...collected];
  return out;
}
