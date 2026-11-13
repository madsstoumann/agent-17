/**
 * Every SEO check, as pure functions over the crawl. Each returns result rows:
 *   { id, area, status: pass|warn|fail|info|skip, title, evidence, fix, urls: [{ url, note }] }
 * `urls` lists the affected pages (all of them; the report shows the first few).
 *
 * Zero dependencies. Node >= 22. Pure: no I/O here.
 */
import { hostOf, sameUrlModuloSlash, stripWww } from './http.mjs';
import { isAllowed } from './robotsmatch.mjs';
import { normalise } from './crawl.mjs';
import { RICH_TEST, DOCS, prop } from './rich.mjs';
import { SITEMAP_MAX_URLS, SITEMAP_MAX_BYTES, NEWS_SITEMAP_MAX } from './robots.mjs';

export const AREAS = [
  ['indexing', 'Indexing and crawl'],
  ['sitemap', 'Sitemap and robots.txt'],
  ['links', 'Links and redirects'],
  ['content', 'Titles, descriptions and headings'],
  ['canonical', 'Canonical and hreflang'],
  ['social', 'Open Graph and share previews'],
  ['schema', 'Structured data'],
  ['geo', 'AI search (GEO)'],
];

const LANG_RE = /^([a-z]{2,3}(-[A-Za-z]{2,4}(-[A-Za-z0-9]{2,8})?)?|x-default)$/i;
const TITLE = [10, 60];
const DESC = [50, 160];
const THIN_WORDS = 150;
// Googlebot reads the first 2 MB of an HTML file when crawling for Search; the rest is ignored
// (developers.google.com/search/docs/crawling-indexing/googlebot). The crawl reads 2 MiB of a page,
// so a page that reaches the read cap is past the limit however "MB" is counted.
export const HTML_LIMIT = 2 * 1024 * 1024;
const HTML_NEAR = 1.6 * 1000 * 1000;

export function result(id, status, title, evidence, { fix = '', urls = [] } = {}) {
  return { id, area: AREA_OF[id] || 'indexing', status, title, evidence, fix, urls };
}

// Which section each check id belongs to.
const AREA_OF = {
  'seo.start': 'indexing', 'seo.noindex': 'indexing', 'seo.html-size': 'indexing', 'seo.js-signals': 'indexing', 'seo.sitemap-limits': 'sitemap', 'seo.meta-refresh': 'links', 'seo.head-conflicts': 'canonical', 'seo.snippet-controls': 'geo', 'seo.status': 'indexing', 'seo.thin': 'indexing', 'seo.url-hygiene': 'indexing', 'seo.slash-duplicates': 'indexing',
  'seo.robots-txt': 'sitemap', 'seo.sitemap': 'sitemap', 'seo.sitemap-status': 'sitemap', 'seo.sitemap-noindex': 'sitemap', 'seo.sitemap-canonical': 'sitemap',
  'seo.sitemap-blocked': 'sitemap', 'seo.sitemap-hosts': 'sitemap', 'seo.sitemap-missing': 'sitemap', 'seo.orphans': 'sitemap', 'seo.robots-blocked-links': 'sitemap',
  'seo.broken-internal': 'links', 'seo.internal-redirects': 'links', 'seo.redirect-chains': 'links', 'seo.temporary-redirects': 'links', 'seo.broken-external': 'links',
  'seo.title-missing': 'content', 'seo.title-length': 'content', 'seo.title-duplicate': 'content', 'seo.description-missing': 'content',
  'seo.description-length': 'content', 'seo.description-duplicate': 'content', 'seo.h1': 'content', 'seo.lang': 'content',
  'seo.canonical-missing': 'canonical', 'seo.canonical-relative': 'canonical', 'seo.canonical-target': 'canonical', 'seo.canonical-host': 'canonical', 'seo.canonicalised': 'canonical',
  'seo.hreflang-codes': 'canonical', 'seo.hreflang-self': 'canonical', 'seo.hreflang-x-default': 'canonical', 'seo.hreflang-return': 'canonical', 'seo.hreflang-target': 'canonical', 'seo.hreflang-lang': 'canonical',
  'seo.og-missing': 'social', 'seo.og-image': 'social', 'seo.og-url': 'social', 'seo.twitter-card': 'social',
  'seo.jsonld-parse': 'schema', 'seo.jsonld-coverage': 'schema', 'seo.schema-validator': 'schema', 'seo.jsonld-client-side': 'schema', 'seo.rich-required': 'schema', 'seo.rich-recommended': 'schema', 'seo.rich-notes': 'schema',
  'seo.ai-crawlers': 'geo', 'seo.content-signal': 'geo', 'seo.llms-txt': 'geo', 'seo.llms-full': 'geo', 'seo.ai-txt': 'geo', 'seo.entity-markup': 'geo',
  'seo.ai-bot-access': 'geo', 'seo.ai-rendered-text': 'geo', 'seo.freshness': 'geo', 'seo.author': 'geo', 'seo.sitemap-lastmod': 'geo',
  'seo.answer-structure': 'geo', 'seo.schema-opportunities': 'geo', 'seo.bingbot': 'geo',
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

/** Pages that answered 200 with HTML. */
export const htmlPages = (pages) => pages.filter((p) => p.status >= 200 && p.status < 300 && p.title !== undefined);
const indexable = (p) => !p.noindex && (!p.canonical || sameUrlModuloSlash(p.canonical, p.url));

/** Follow recorded redirects from `url`: { hops: [{ url, status }], final, finalStatus, loop }. */
export function chainFrom(url, byUrl, max = 10) {
  const hops = [];
  const seen = new Set();
  let cur = url;
  while (cur && byUrl.has(cur) && hops.length <= max) {
    const p = byUrl.get(cur);
    if (seen.has(cur)) return { hops, final: cur, finalStatus: p.status, loop: true };
    seen.add(cur);
    if (!p.location) return { hops, final: cur, finalStatus: p.status, loop: false };
    hops.push({ url: cur, status: p.status });
    cur = normalise(p.location);
  }
  return { hops, final: cur, finalStatus: byUrl.get(cur)?.status ?? null, loop: false };
}

function duplicates(pages, key) {
  const groups = new Map();
  for (const p of pages) {
    const v = (p[key] || '').trim().toLowerCase();
    if (!v) continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(p);
  }
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
}

const fromList = (set, n = 2) => [...(set || [])].slice(0, n).join(', ');

/** A link written without its scheme ("www.x.dk/…", "shop.example.com/…") resolves as a path on this site. */
export const looksSchemeless = (url) => { try { return /^\/?(?:[^/]*\/)*?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|dk|se|no|de|uk|io|eu|nu|info)(?:[/:?]|$)/i.test(new URL(url).pathname.replace(/^\//, '')); } catch { return false; } };

/**
 * runChecks(input) -> result rows. input:
 *   { finalUrl, hosts, productionHost, pages, inlinks, blocked, truncated, robots: { status, parsed, error },
 *     sitemap: { urls, sources, truncated, declared }, external: [{ url, status, ok, blocked, error }] | null,
 *     internal: { checked: [{ url, status, error }], unchecked } | null (link targets the crawl did not fetch),
 *     ogImages: [{ url, status, contentType }] | null, schema: [{ url, types, ok, errors, warnings, nodes, error }] | null,
 *     sitemapSampled, sitemapMissing, render, detailed } (render and detailed: see schemaChecks)
 */
export function runChecks(input) {
  const { finalUrl, pages, inlinks = new Map(), blocked = new Map(), robots = {}, sitemap = { urls: [], sources: [], declared: [] } } = input;
  const own = new Set(input.hosts || [hostOf(finalUrl)]);
  const prod = input.productionHost;
  const otherHost = (u) => { const h = hostOf(u); return h && !own.has(h) && h !== prod && stripWww(h) !== stripWww(prod || ''); };
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const html = htmlPages(pages);
  const idx = html.filter(indexable);
  const out = [];
  const start = byUrl.get(normalise(finalUrl));

  // ---------------------------------------------------------------- indexing
  if (start?.noindex) out.push(result('seo.start', 'fail', 'Start page indexable', `the start page is noindex (${start.xRobots ? `X-Robots-Tag: ${start.xRobots}` : `meta robots "${start.metaRobots}"`})`, { fix: 'Remove noindex from the production build. Expected on dev and staging; check it before launch.', urls: [{ url: start.url }] }));
  else if (start) out.push(result('seo.start', 'pass', 'Start page indexable', 'no noindex on the start page'));

  const noindex = html.filter((p) => p.noindex);
  if (noindex.length && noindex.length === html.length) out.push(result('seo.noindex', 'fail', 'Noindex pages', `every crawled page (${html.length}) is noindex`, { fix: 'The whole site is hidden from search. Remove the noindex header or meta tag on production.', urls: noindex.map((p) => ({ url: p.url })) }));
  else if (noindex.length) out.push(result('seo.noindex', 'info', 'Noindex pages', `${plural(noindex.length, 'page')} of ${html.length} are noindex; check each is meant to be`, { fix: 'Fine for search results, filters, thank-you and account pages. Anything that should rank must not be noindex.', urls: noindex.map((p) => ({ url: p.url, note: p.xRobots ? `X-Robots-Tag: ${p.xRobots}` : `meta: ${p.metaRobots}` })) }));
  else out.push(result('seo.noindex', 'pass', 'Noindex pages', `none of ${html.length} crawled pages is noindex`));

  // Crawled pages plus link targets that were only status-checked (past the --pages budget).
  const linkOnly = (input.internal?.checked || []).filter((c) => !byUrl.has(c.url));
  const bad = [...pages, ...linkOnly].filter((p) => p.status === 0 || p.status >= 400);
  const linked = bad.filter((p) => inlinks.has(p.url));
  const answered = pages.length + linkOnly.length;
  const unchecked = input.internal?.unchecked || 0;
  out.push(linked.length
    ? result('seo.broken-internal', linked.some((p) => p.status >= 500 || p.status === 0) || linked.length > 3 ? 'fail' : 'warn', 'Broken internal links', `${plural(linked.length, 'URL')} linked from the site answer ${[...new Set(linked.map((p) => p.status || p.error))].slice(0, 4).join(', ')}`, { fix: 'Fix or remove the links, or redirect the old URL (301) to its replacement.', urls: linked.map((p) => ({ url: p.url, note: `${p.status || p.error}${looksSchemeless(p.url) ? ' · the href is missing https:// so it resolves as a path on this site' : ''} · linked from ${fromList(inlinks.get(p.url))}${inlinks.get(p.url).size > 2 ? ` and ${inlinks.get(p.url).size - 2} more` : ''}` })) })
    : result('seo.broken-internal', 'pass', 'Broken internal links', `every internal link of ${answered} URLs answers${linkOnly.length ? ` (${linkOnly.length} of them link targets past the crawl, status only)` : ''}${unchecked ? `; ${unchecked} more not checked (raise --internal-links)` : ''}`));

  const thin = idx.filter((p) => p.words < THIN_WORDS && !sameUrlModuloSlash(p.url, finalUrl));
  out.push(thin.length
    ? result('seo.thin', 'info', 'Thin pages', `${plural(thin.length, 'indexable page')} with fewer than ${THIN_WORDS} words of text`, { fix: 'Thin pages rarely rank. Add content, merge them, or noindex utility pages. Pages that render their text with JavaScript also show up here.', urls: thin.map((p) => ({ url: p.url, note: `${p.words} words` })) })
    : result('seo.thin', 'pass', 'Thin pages', `every indexable page has at least ${THIN_WORDS} words`));

  const tooBig = html.filter((p) => p.truncated || p.bytes >= HTML_LIMIT);
  const nearBig = html.filter((p) => !tooBig.includes(p) && p.bytes >= HTML_NEAR);
  const mb = (n) => `${(n / 1000 / 1000).toFixed(1)} MB`;
  out.push(tooBig.length
    ? result('seo.html-size', 'fail', 'HTML size', `${plural(tooBig.length, 'page')} with more than 2 MB of HTML: Googlebot reads the first 2 MB and ignores the rest`, { fix: 'Bring the HTML under 2 MB (uncompressed): move inline data, SVG sprites, base64 images and large JSON state out of the page, or load them as files.', urls: tooBig.map((p) => ({ url: p.url, note: p.truncated ? `more than ${mb(HTML_LIMIT)} (the read stopped at ${mb(p.bytes)})` : mb(p.bytes) })) })
    : nearBig.length
      ? result('seo.html-size', 'info', 'HTML size', `${plural(nearBig.length, 'page')} close to the 2 MB Googlebot reads`, { urls: nearBig.map((p) => ({ url: p.url, note: mb(p.bytes) })) })
      : result('seo.html-size', 'pass', 'HTML size', `every page under ${mb(HTML_NEAR)} of HTML (Googlebot reads 2 MB)`));

  const hygiene = html.filter((p) => { const u = new URL(p.url); return /[A-Z]/.test(u.pathname) || /_/.test(u.pathname) || p.url.length > 115; });
  if (hygiene.length) out.push(result('seo.url-hygiene', 'info', 'URL hygiene', `${plural(hygiene.length, 'URL')} with capitals, underscores or more than 115 characters`, { fix: 'Lowercase, hyphenated, short URLs are easier to share and avoid case duplicates. Change URLs only with 301 redirects.', urls: hygiene.map((p) => ({ url: p.url })) }));

  const slashPairs = html.filter((p) => !p.url.endsWith('/') && html.some((q) => q.url === `${p.url}/`));
  if (slashPairs.length) out.push(result('seo.slash-duplicates', 'warn', 'Trailing-slash duplicates', `${plural(slashPairs.length, 'page')} answer 200 both with and without a trailing slash`, { fix: 'Pick one form and 301 the other to it, or at least canonicalise to one.', urls: slashPairs.map((p) => ({ url: p.url, note: `and ${p.url}/` })) }));

  // ---------------------------------------------------------------- robots.txt and sitemap
  if (robots.status === 200 && robots.parsed) {
    const star = isAllowed(robots.parsed, '/');
    out.push(star
      ? result('seo.robots-txt', 'pass', 'robots.txt', `${robots.parsed.groups.length} group(s), ${plural(robots.parsed.sitemaps.length, 'Sitemap line')}`)
      : result('seo.robots-txt', 'fail', 'robots.txt', 'Disallow: / for every crawler', { fix: 'Allow crawling on production. Expected on dev and staging.' }));
  } else {
    out.push(result('seo.robots-txt', 'warn', 'robots.txt', robots.status === 404 ? 'no robots.txt (404)' : `robots.txt answers ${robots.status || robots.error}`, { fix: 'Serve a plain-text robots.txt with "User-agent: *", "Allow: /" and a "Sitemap:" line. A 5xx here makes Google pause crawling.' }));
  }
  if (blocked.size) out.push(result('seo.robots-blocked-links', 'info', 'Links to disallowed paths', `${plural(blocked.size, 'internal URL')} linked from the site but disallowed in robots.txt (not crawled)`, { fix: 'Fine for search, cart and account paths. Content pages must not be disallowed; noindex them instead if they should stay out of results.', urls: [...blocked.entries()].map(([u, from]) => ({ url: u, note: `linked from ${fromList(from)}` })) }));

  const smUrls = (sitemap.urls || []).map(normalise).filter(Boolean);
  const smSet = new Set(smUrls);
  const okSources = (sitemap.sources || []).filter((s) => s.status === 200 && s.kind !== 'unknown' && s.kind !== 'skipped');
  if (!smUrls.length) {
    out.push(result('seo.sitemap', 'warn', 'XML sitemap', okSources.length ? 'the sitemap lists no URLs' : 'no sitemap found (robots.txt, /sitemap.xml, /sitemap_index.xml)', { fix: 'Generate an XML sitemap of every indexable page, declare it in robots.txt and submit it in Search Console.' }));
  } else {
    out.push(result('seo.sitemap', (sitemap.declared || []).length ? 'pass' : 'warn', 'XML sitemap', `${smUrls.length}${sitemap.truncated ? '+' : ''} URLs in ${plural(okSources.length, 'file')}${(sitemap.declared || []).length ? ', declared in robots.txt' : ', but robots.txt does not declare it'}`, { fix: (sitemap.declared || []).length ? '' : 'Add "Sitemap: <absolute URL>" to robots.txt.' }));
    const foreign = smUrls.filter(otherHost);
    if (foreign.length) out.push(result('seo.sitemap-hosts', 'fail', 'Sitemap hosts', `${plural(foreign.length, 'sitemap URL')} on other hosts (${[...new Set(foreign.map(hostOf))].slice(0, 3).join(', ')})`, { fix: 'A sitemap may only list URLs on its own host. Generate it from the live hostname.', urls: foreign.map((u) => ({ url: u })) }));

    const over = [];
    for (const src of sitemap.sources || []) {
      const why = [];
      if (src.count > SITEMAP_MAX_URLS) why.push(`${src.count.toLocaleString('en')} ${src.kind === 'sitemapindex' ? 'sitemaps listed' : 'URLs'} (limit 50,000)`);
      if (src.oversize || src.bytes > SITEMAP_MAX_BYTES) why.push('larger than 50 MB uncompressed');
      if (src.kind === 'sitemapindex' && src.parent) why.push(`a sitemap index listed by another index (${src.parent})`);
      if (src.news > NEWS_SITEMAP_MAX) why.push(`${src.news.toLocaleString('en')} news entries (limit 1,000)`);
      if (why.length) over.push({ url: src.url, note: why.join('; ') });
    }
    out.push(over.length
      ? result('seo.sitemap-limits', 'fail', 'Sitemap file limits', `${plural(over.length, 'sitemap file')} past the sitemap protocol's limits`, { fix: 'Split a file past 50,000 URLs or 50 MB (uncompressed) into several and list them in one sitemap index. An index may list sitemaps only, not other indexes. A news sitemap holds at most 1,000 articles from the last two days.', urls: over })
      : result('seo.sitemap-limits', 'pass', 'Sitemap file limits', `${plural(okSources.length, 'file')} within 50,000 URLs and 50 MB each`));

    const checked = smUrls.filter((u) => byUrl.has(u));
    const answers = checked.map((u) => ({ u, p: byUrl.get(u) }));
    const notOk = answers.filter(({ p }) => p.status !== 200);
    const share = `${checked.length} of ${smUrls.length} sitemap URLs fetched`;
    out.push(notOk.length
      ? result('seo.sitemap-status', notOk.some(({ p }) => p.status >= 400 || p.status === 0) ? 'fail' : 'warn', 'Sitemap URLs answer 200', `${plural(notOk.length, 'URL')} of ${checked.length} checked do not answer 200 (${share})`, { fix: 'List only final, 200 URLs: no redirects, no 404s. Regenerate the sitemap from published content.', urls: notOk.map(({ u, p }) => ({ url: u, note: p.location ? `${p.status} → ${p.location}` : String(p.status || p.error) })) })
      : result('seo.sitemap-status', 'pass', 'Sitemap URLs answer 200', `all ${checked.length} checked answer 200 (${share})`));
    const smNoindex = answers.filter(({ p }) => p.noindex);
    out.push(smNoindex.length
      ? result('seo.sitemap-noindex', 'fail', 'Noindex pages in the sitemap', `${plural(smNoindex.length, 'sitemap URL')} are noindex`, { fix: 'A sitemap says "index this"; noindex says the opposite. Drop them from the sitemap or remove the noindex.', urls: smNoindex.map(({ u }) => ({ url: u })) })
      : result('seo.sitemap-noindex', 'pass', 'Noindex pages in the sitemap', 'none'));
    const smCanon = answers.filter(({ p }) => p.canonical && !p.noindex && !sameUrlModuloSlash(p.canonical, p.url));
    if (smCanon.length) out.push(result('seo.sitemap-canonical', 'warn', 'Sitemap URLs canonicalised elsewhere', `${plural(smCanon.length, 'sitemap URL')} name another URL as canonical`, { fix: 'List the canonical URL in the sitemap, not its duplicates.', urls: smCanon.map(({ u, p }) => ({ url: u, note: `canonical ${p.canonical}` })) }));
    if (robots.parsed) {
      const smBlocked = smUrls.filter((u) => !isAllowed(robots.parsed, new URL(u).pathname + new URL(u).search));
      out.push(smBlocked.length
        ? result('seo.sitemap-blocked', 'fail', 'Sitemap URLs blocked by robots.txt', `${plural(smBlocked.length, 'sitemap URL')} are disallowed in robots.txt`, { fix: 'Either allow them in robots.txt or drop them from the sitemap; Search Console reports both as errors.', urls: smBlocked.map((u) => ({ url: u })) })
        : result('seo.sitemap-blocked', 'pass', 'Sitemap URLs blocked by robots.txt', 'none'));
    }
    if (!sitemap.truncated) {
      const missing = idx.filter((p) => !smSet.has(p.url) && ![...smSet].some((s) => sameUrlModuloSlash(s, p.url)));
      out.push(missing.length
        ? result('seo.sitemap-missing', missing.length > 5 ? 'warn' : 'info', 'Indexable pages missing from the sitemap', `${plural(missing.length, 'crawled indexable page')} of ${idx.length} not in the sitemap`, { fix: 'Make the sitemap cover every indexable page (most CMS sitemap plugins skip some page types by default).', urls: missing.map((p) => ({ url: p.url })) })
        : result('seo.sitemap-missing', 'pass', 'Indexable pages missing from the sitemap', `every crawled indexable page (${idx.length}) is in the sitemap`));
    }
    if (!input.truncated) {
      const orphans = smUrls.filter((u) => !otherHost(u) && !inlinks.has(u) && !sameUrlModuloSlash(u, finalUrl) && ![...inlinks.keys()].some((k) => sameUrlModuloSlash(k, u)));
      if (orphans.length) out.push(result('seo.orphans', orphans.length > 5 ? 'warn' : 'info', 'Orphan pages', `${plural(orphans.length, 'sitemap URL')} that no crawled page links to`, { fix: 'Pages reachable only from the sitemap get little weight. Link them from navigation, hubs or related content, or retire them.', urls: orphans.map((u) => ({ url: u })) }));
    }
  }

  // ---------------------------------------------------------------- redirects
  const redirects = pages.filter((p) => p.location);
  const linkedRedirects = redirects.filter((p) => inlinks.has(p.url) && [...inlinks.get(p.url)].some((f) => !byUrl.get(f)?.location));
  out.push(linkedRedirects.length
    ? result('seo.internal-redirects', linkedRedirects.length > 10 ? 'warn' : 'info', 'Links to redirects', `${plural(linkedRedirects.length, 'internal link target')} redirect; link to the final URL instead`, { fix: 'Update menus, content and templates to link straight to the final URL. Each redirect costs a round trip and some crawl budget.', urls: linkedRedirects.map((p) => ({ url: p.url, note: `${p.status} → ${p.location} · from ${fromList([...inlinks.get(p.url)].filter((f) => !byUrl.get(f)?.location), 1)}` })) })
    : result('seo.internal-redirects', 'pass', 'Links to redirects', 'no internal link points at a redirect'));
  const chains = redirects.filter((p) => !(inlinks.get(p.url) && [...inlinks.get(p.url)].every((f) => byUrl.get(f)?.location))).map((p) => ({ p, c: chainFrom(p.url, byUrl) })).filter(({ c }) => c.loop || c.hops.length > 1);
  out.push(chains.length
    ? result('seo.redirect-chains', chains.some(({ c }) => c.loop) ? 'fail' : 'warn', 'Redirect chains', `${plural(chains.length, 'redirect')} with more than one hop${chains.some(({ c }) => c.loop) ? ', including a loop' : ''}`, { fix: 'Point every old URL straight at its final destination in one 301.', urls: chains.map(({ p, c }) => ({ url: p.url, note: c.loop ? 'loop' : `${c.hops.map((h) => h.status).join(' → ')} → ${c.finalStatus} ${c.final}` })) })
    : result('seo.redirect-chains', 'pass', 'Redirect chains', redirects.length ? `${plural(redirects.length, 'redirect')}, each one hop` : 'no redirects met'));
  const temp = redirects.filter((p) => [302, 303, 307].includes(p.status) && inlinks.has(p.url));
  if (temp.length) out.push(result('seo.temporary-redirects', 'warn', 'Temporary redirects', `${plural(temp.length, 'redirect')} use ${[...new Set(temp.map((p) => p.status))].join('/')} instead of 301/308`, { fix: 'Use 301 (or 308) for moves that stay; a temporary redirect keeps the old URL in the index.', urls: temp.map((p) => ({ url: p.url, note: `${p.status} → ${p.location}` })) }));
  const refresh = html.filter((p) => p.refresh?.url && !sameUrlModuloSlash(p.refresh.url, p.url));
  out.push(refresh.length
    ? result('seo.meta-refresh', 'warn', 'Meta refresh redirects', `${plural(refresh.length, 'page')} ${refresh.length === 1 ? 'sends' : 'send'} visitors on with <meta http-equiv="refresh">`, { fix: 'Redirect on the server with a 301 (or 308) instead. Google follows a meta refresh, but other search engines, AI crawlers and link previews may index the empty page or not follow it at all.', urls: refresh.map((p) => ({ url: p.url, note: `after ${p.refresh.delay} s → ${p.refresh.url}` })) })
    : result('seo.meta-refresh', 'pass', 'Meta refresh redirects', 'no page redirects with a meta refresh'));

  if (input.external) {
    const dead = input.external.filter((r) => !r.ok);
    const walls = input.external.filter((r) => r.blocked);
    out.push(dead.length
      ? result('seo.broken-external', 'warn', 'Broken external links', `${plural(dead.length, 'external link')} of ${input.external.length} checked are dead${walls.length ? `; ${walls.length} more refused the checker (verify by hand)` : ''}`, { fix: 'Update or remove dead outbound links.', urls: dead.map((r) => ({ url: r.url, note: `${r.status || r.error}${input.externalFrom?.get(r.url) ? ` · from ${fromList(input.externalFrom.get(r.url), 1)}` : ''}` })) })
      : result('seo.broken-external', 'pass', 'Broken external links', `${input.external.length} checked${walls.length ? `, ${walls.length} refused the checker (bot walls, verify by hand)` : ''}`));
  } else out.push(result('seo.broken-external', 'skip', 'Broken external links', 'not checked (--external-links 0)'));

  // ---------------------------------------------------------------- titles, descriptions, headings
  const noTitle = html.filter((p) => !p.title);
  out.push(noTitle.length
    ? result('seo.title-missing', 'fail', 'Missing titles', `${plural(noTitle.length, 'page')} without a <title>`, { fix: 'Every page needs a unique, descriptive <title>.', urls: noTitle.map((p) => ({ url: p.url })) })
    : result('seo.title-missing', 'pass', 'Missing titles', `all ${html.length} pages have a title`));
  const badTitle = html.filter((p) => p.title && (p.title.length < TITLE[0] || p.title.length > TITLE[1]));
  out.push(badTitle.length
    ? result('seo.title-length', pct(badTitle.length, html.length) > 25 ? 'warn' : 'info', 'Title length', `${plural(badTitle.length, 'title')} outside ${TITLE[0]}–${TITLE[1]} characters`, { fix: `Aim for ${TITLE[0]}–${TITLE[1]} characters with the page topic first; Google truncates around 60. A long site-name suffix is the usual cause.`, urls: badTitle.map((p) => ({ url: p.url, note: `${p.title.length} chars: "${p.title.slice(0, 70)}${p.title.length > 70 ? '…' : ''}"` })) })
    : result('seo.title-length', 'pass', 'Title length', `every title is ${TITLE[0]}–${TITLE[1]} characters`));
  const dupTitle = duplicates(idx, 'title');
  out.push(dupTitle.length
    ? result('seo.title-duplicate', 'warn', 'Duplicate titles', `${plural(dupTitle.length, 'title')} shared by ${dupTitle.reduce((n, g) => n + g.length, 0)} indexable pages`, { fix: 'Give each indexable page its own title. Shared titles usually come from a template default, or from duplicates that need a canonical.', urls: dupTitle.flatMap((g) => g.map((p) => ({ url: p.url, note: `"${p.title.slice(0, 60)}" (×${g.length})` }))) })
    : result('seo.title-duplicate', 'pass', 'Duplicate titles', 'every indexable page has its own title'));

  const noDesc = idx.filter((p) => !p.description);
  out.push(noDesc.length
    ? result('seo.description-missing', pct(noDesc.length, idx.length) > 20 ? 'warn' : 'info', 'Missing meta descriptions', `${plural(noDesc.length, 'indexable page')} without a meta description`, { fix: 'Write a 50–160 character description per page; it is the snippet under the title in results.', urls: noDesc.map((p) => ({ url: p.url })) })
    : result('seo.description-missing', 'pass', 'Missing meta descriptions', `all ${idx.length} indexable pages have one`));
  const badDesc = idx.filter((p) => p.description && (p.description.length < DESC[0] || p.description.length > DESC[1]));
  if (badDesc.length) out.push(result('seo.description-length', 'info', 'Description length', `${plural(badDesc.length, 'description')} outside ${DESC[0]}–${DESC[1]} characters`, { fix: `Aim for ${DESC[0]}–${DESC[1]} characters.`, urls: badDesc.map((p) => ({ url: p.url, note: `${p.description.length} chars` })) }));
  const dupDesc = duplicates(idx, 'description');
  out.push(dupDesc.length
    ? result('seo.description-duplicate', 'warn', 'Duplicate descriptions', `${plural(dupDesc.length, 'description')} shared by ${dupDesc.reduce((n, g) => n + g.length, 0)} indexable pages`, { fix: 'Write a description per page, or leave it out so Google picks a snippet; a template-wide default helps no one.', urls: dupDesc.flatMap((g) => g.map((p) => ({ url: p.url, note: `"${p.description.slice(0, 60)}…" (×${g.length})` }))) })
    : result('seo.description-duplicate', 'pass', 'Duplicate descriptions', 'none'));

  const noH1 = idx.filter((p) => !p.h1Count);
  const manyH1 = idx.filter((p) => p.h1Count > 1);
  out.push(noH1.length
    ? result('seo.h1', 'warn', 'H1 headings', `${plural(noH1.length, 'indexable page')} without an h1${manyH1.length ? `, ${manyH1.length} with several` : ''}`, { fix: 'One h1 per page that names its topic; a logo or carousel heading should not take it.', urls: [...noH1.map((p) => ({ url: p.url, note: 'no h1' })), ...manyH1.map((p) => ({ url: p.url, note: `${p.h1Count} h1` }))] })
    : result('seo.h1', manyH1.length ? 'info' : 'pass', 'H1 headings', manyH1.length ? `${plural(manyH1.length, 'page')} with more than one h1` : 'one h1 on every indexable page', { urls: manyH1.map((p) => ({ url: p.url, note: `${p.h1Count} h1` })) }));

  const noLang = html.filter((p) => !p.lang);
  out.push(noLang.length
    ? result('seo.lang', 'warn', 'html lang', `${plural(noLang.length, 'page')} without <html lang>`, { fix: 'Set <html lang="…"> on every page; search engines and screen readers use it.', urls: noLang.map((p) => ({ url: p.url })) })
    : result('seo.lang', 'pass', 'html lang', `set on all ${html.length} pages (${[...new Set(html.map((p) => p.lang))].slice(0, 5).join(', ')})`));

  // ---------------------------------------------------------------- canonical
  const noCanon = html.filter((p) => !p.canonical && !p.noindex);
  out.push(noCanon.length
    ? result('seo.canonical-missing', pct(noCanon.length, html.length) > 20 ? 'warn' : 'info', 'Missing canonical', `${plural(noCanon.length, 'indexable page')} without rel=canonical`, { fix: 'Add a self-referencing absolute canonical on every page, so query strings and tracking parameters do not make duplicates.', urls: noCanon.map((p) => ({ url: p.url })) })
    : result('seo.canonical-missing', 'pass', 'Missing canonical', 'every indexable page has a canonical'));
  const relCanon = html.filter((p) => p.canonicalRaw && !/^https?:\/\//i.test(p.canonicalRaw));
  if (relCanon.length) out.push(result('seo.canonical-relative', 'warn', 'Relative canonical', `${plural(relCanon.length, 'page')} use a relative canonical URL`, { fix: 'Use an absolute URL with the production host.', urls: relCanon.map((p) => ({ url: p.url, note: p.canonicalRaw })) }));
  const crossCanon = html.filter((p) => p.canonical && otherHost(p.canonical));
  out.push(crossCanon.length
    ? result('seo.canonical-host', 'fail', 'Canonical on another host', `${plural(crossCanon.length, 'page')} name a canonical on another host (${[...new Set(crossCanon.map((p) => hostOf(p.canonical)))].slice(0, 3).join(', ')})`, { fix: 'Canonicals must name this site\'s live host, or the other host gets indexed instead. Often a staging or old domain left in config.', urls: crossCanon.map((p) => ({ url: p.url, note: p.canonical })) })
    : result('seo.canonical-host', 'pass', 'Canonical on another host', 'none'));
  const canonTargets = html.filter((p) => p.canonical && !sameUrlModuloSlash(p.canonical, p.url) && !otherHost(p.canonical));
  const badTargets = canonTargets.map((p) => ({ p, t: byUrl.get(normalise(p.canonical)) })).filter(({ t }) => t && (t.status !== 200 || t.noindex || (t.canonical && !sameUrlModuloSlash(t.canonical, t.url))));
  out.push(badTargets.length
    ? result('seo.canonical-target', 'fail', 'Canonical points at a bad URL', `${plural(badTargets.length, 'page')} canonicalise to a redirect, an error, a noindex page or a page with another canonical`, { fix: 'A canonical must name a 200, indexable page that is its own canonical; otherwise search engines ignore it and pick one themselves.', urls: badTargets.map(({ p, t }) => ({ url: p.url, note: `→ ${p.canonical} (${t.location ? `${t.status} redirect` : t.noindex ? 'noindex' : t.status !== 200 ? t.status : `canonical ${t.canonical}`})` })) })
    : result('seo.canonical-target', 'pass', 'Canonical points at a bad URL', 'no canonical points at a redirect, error or noindex page'));
  if (canonTargets.length) out.push(result('seo.canonicalised', 'info', 'Canonicalised pages', `${plural(canonTargets.length, 'page')} name another URL as canonical (duplicates by design, check each)`, { urls: canonTargets.map((p) => ({ url: p.url, note: `→ ${p.canonical}` })) }));

  const conflicted = html.filter((p) => p.headConflicts);
  const canonConflict = conflicted.filter((p) => p.headConflicts.canonical);
  const conflictNote = (c) => Object.entries(c).map(([k, v]) => `${v.length} different ${k === 'canonical' ? 'canonicals' : `${k}s`}: ${v.map((x) => `"${String(x).slice(0, 80)}"`).join(' / ')}`).join('; ');
  out.push(conflicted.length
    ? result('seo.head-conflicts', canonConflict.length ? 'fail' : 'warn', 'Conflicting head tags', `${plural(conflicted.length, 'page')} ${conflicted.length === 1 ? 'states' : 'state'} ${canonConflict.length ? 'two or more different canonicals' : 'a title or description twice, differently'}${canonConflict.length && conflicted.length > canonConflict.length ? ' (and titles or descriptions twice)' : ''}`, { fix: canonConflict.length ? 'Keep one rel=canonical per page (in the HTML or the Link header, not both with different URLs). When a page names several, Google may ignore all of them and pick the canonical itself.' : 'Keep one <title> and one meta description per page; a second one usually comes from a plugin or a layout and a template both writing it.', urls: conflicted.map((p) => ({ url: p.url, note: conflictNote(p.headConflicts) })) })
    : result('seo.head-conflicts', 'pass', 'Conflicting head tags', 'no page states two different canonicals, titles or descriptions'));

  // ---------------------------------------------------------------- hreflang
  const withHl = html.filter((p) => p.hreflang?.length);
  if (!withHl.length) out.push(result('seo.hreflang-codes', 'info', 'hreflang', 'no hreflang on any page (fine for a single-language site)'));
  else {
    const badCodes = withHl.filter((p) => p.hreflang.some((a) => !LANG_RE.test(a.lang)));
    out.push(badCodes.length
      ? result('seo.hreflang-codes', 'fail', 'hreflang codes', `${plural(badCodes.length, 'page')} use invalid hreflang codes (${[...new Set(badCodes.flatMap((p) => p.hreflang.filter((a) => !LANG_RE.test(a.lang)).map((a) => a.lang)))].slice(0, 5).join(', ')})`, { fix: 'Use ISO 639-1 language codes with an optional ISO 3166-1 region: "da", "da-DK", "en-GB", plus "x-default". "en-UK" and "dk" are wrong.', urls: badCodes.map((p) => ({ url: p.url })) })
      : result('seo.hreflang-codes', 'pass', 'hreflang codes', `${plural(withHl.length, 'page')} with hreflang, codes valid (${[...new Set(withHl.flatMap((p) => p.hreflang.map((a) => a.lang)))].slice(0, 8).join(', ')})`));
    const noSelf = withHl.filter((p) => !p.hreflang.some((a) => sameUrlModuloSlash(a.href, p.url) || (p.canonical && sameUrlModuloSlash(a.href, p.canonical))));
    out.push(noSelf.length
      ? result('seo.hreflang-self', 'warn', 'hreflang self reference', `${plural(noSelf.length, 'page')} do not list themselves`, { fix: 'Each language version lists every version, itself included.', urls: noSelf.map((p) => ({ url: p.url })) })
      : result('seo.hreflang-self', 'pass', 'hreflang self reference', 'every page lists itself'));
    const noDefault = withHl.filter((p) => !p.hreflang.some((a) => a.lang.toLowerCase() === 'x-default'));
    if (noDefault.length) out.push(result('seo.hreflang-x-default', 'info', 'hreflang x-default', `${plural(noDefault.length, 'page')} without x-default`, { fix: 'Add x-default pointing at the language picker or main version, for visitors whose language you do not serve.', urls: noDefault.map((p) => ({ url: p.url })) }));
    const notBack = []; const badTarget = [];
    for (const p of withHl) {
      for (const a of p.hreflang) {
        if (a.lang.toLowerCase() === 'x-default' || sameUrlModuloSlash(a.href, p.url)) continue;
        const t = byUrl.get(normalise(a.href));
        if (!t) continue;
        if (t.status !== 200 || t.noindex || (t.canonical && !sameUrlModuloSlash(t.canonical, t.url))) badTarget.push({ url: p.url, note: `${a.lang} → ${a.href} (${t.location ? `${t.status} redirect` : t.noindex ? 'noindex' : t.status !== 200 ? t.status : 'canonicalised'})` });
        else if (t.hreflang && !t.hreflang.some((b) => sameUrlModuloSlash(b.href, p.url))) notBack.push({ url: p.url, note: `${a.lang} → ${a.href} does not link back` });
      }
    }
    out.push(notBack.length
      ? result('seo.hreflang-return', 'warn', 'hreflang return links', `${plural(notBack.length, 'alternate')} without a return link`, { fix: 'hreflang only counts when both pages name each other. Generate the set from one source of truth.', urls: notBack })
      : result('seo.hreflang-return', 'pass', 'hreflang return links', 'every crawled alternate links back'));
    if (badTarget.length) out.push(result('seo.hreflang-target', 'warn', 'hreflang targets', `${plural(badTarget.length, 'alternate')} point at a redirect, an error, a noindex or a canonicalised page`, { fix: 'Alternates must be the canonical, 200 URL of each version.', urls: badTarget }));
    const mismatch = withHl.filter((p) => { const self = p.hreflang.find((a) => sameUrlModuloSlash(a.href, p.url)); return self && p.lang && self.lang.toLowerCase() !== 'x-default' && self.lang.split('-')[0].toLowerCase() !== p.lang.split('-')[0].toLowerCase(); });
    if (mismatch.length) out.push(result('seo.hreflang-lang', 'warn', 'hreflang and html lang disagree', `${plural(mismatch.length, 'page')} where the self hreflang and <html lang> name different languages`, { fix: 'Set <html lang> per language version; a template-wide lang="en" is the usual cause.', urls: mismatch.map((p) => ({ url: p.url, note: `lang="${p.lang}", hreflang ${p.hreflang.find((a) => sameUrlModuloSlash(a.href, p.url)).lang}` })) }));
  }

  // ---------------------------------------------------------------- Open Graph
  const ogNeed = ['title', 'description', 'image'];
  const ogMissing = idx.filter((p) => ogNeed.some((k) => !p.og?.[k]));
  out.push(ogMissing.length
    ? result('seo.og-missing', pct(ogMissing.length, idx.length) > 20 ? 'warn' : 'info', 'Open Graph tags', `${plural(ogMissing.length, 'indexable page')} miss og:title, og:description or og:image`, { fix: 'Set og:title, og:description, og:image (1200×630, absolute URL) and og:url on every page so links shared on LinkedIn, Facebook, Slack and Teams get a preview.', urls: ogMissing.map((p) => ({ url: p.url, note: `missing ${ogNeed.filter((k) => !p.og?.[k]).map((k) => `og:${k}`).join(', ')}` })) })
    : result('seo.og-missing', 'pass', 'Open Graph tags', `og:title, og:description and og:image on all ${idx.length} indexable pages`));
  const ogRel = html.filter((p) => p.og?.image && !/^https?:\/\//i.test(p.og.image));
  const ogDead = (input.ogImages || []).filter((r) => r.status !== 200 || !/^image\//i.test(r.contentType || ''));
  if (ogRel.length || ogDead.length) {
    const users = (img) => html.filter((p) => p.og?.image === img).map((p) => p.url);
    out.push(result('seo.og-image', 'fail', 'og:image', `${ogRel.length ? `${plural(ogRel.length, 'page')} with a relative og:image` : ''}${ogRel.length && ogDead.length ? '; ' : ''}${ogDead.length ? `${plural(ogDead.length, 'og:image')} not served as an image` : ''}`, { fix: 'og:image must be an absolute URL that answers 200 with an image; scrapers do not resolve relative paths.', urls: [...ogRel.map((p) => ({ url: p.url, note: p.og.image })), ...ogDead.map((r) => ({ url: users(r.url)[0] || r.url, note: `${r.url} → ${r.status || r.error} ${r.contentType || ''}`.trim() }))] }));
  } else if (input.ogImages) out.push(result('seo.og-image', 'pass', 'og:image', `${plural(input.ogImages.length, 'distinct image')} checked, all absolute and served`));
  const ogUrlOff = html.filter((p) => p.og?.url && p.canonical && !sameUrlModuloSlash(p.og.url, p.canonical));
  if (ogUrlOff.length) out.push(result('seo.og-url', 'info', 'og:url and canonical', `${plural(ogUrlOff.length, 'page')} where og:url differs from the canonical`, { fix: 'Use the canonical URL for og:url, so shares count towards one URL.', urls: ogUrlOff.map((p) => ({ url: p.url, note: `og:url ${p.og.url}` })) }));
  const noCard = idx.filter((p) => !p.twitter?.card);
  if (noCard.length) out.push(result('seo.twitter-card', 'info', 'twitter:card', `${plural(noCard.length, 'indexable page')} without twitter:card (X falls back to Open Graph, but shows a small card)`, { fix: 'Add <meta name="twitter:card" content="summary_large_image"> for a large preview on X.', urls: noCard.map((p) => ({ url: p.url })) }));

  out.push(...schemaChecks(input, { html, idx }));
  return out;
}

/**
 * The structured-data rows. Also the whole check list for --schema-only and a local file.
 *   input.schema:   validator results per page, or null when it did not run
 *   input.render:   { ran, error, pages: [{ url, ok, added, error }] } from the Chrome pass, or null
 *   input.detailed: list every validator error and warning as its own line (one page, --schema-only)
 */
export function schemaChecks(input, { html = htmlPages(input.pages || []), idx = html.filter(indexable) } = {}) {
  const out = [];
  const broken = html.filter((p) => p.jsonLd?.some((j) => j.error));
  out.push(broken.length
    ? result('seo.jsonld-parse', 'fail', 'JSON-LD that does not parse', `${plural(broken.length, 'page')} with a JSON-LD block that is not valid JSON`, { fix: 'Search engines ignore a block that does not parse. Usually an unescaped quote or a trailing comma from a template; build it with JSON.stringify.', urls: broken.map((p) => ({ url: p.url, note: p.jsonLd.find((j) => j.error).error })) })
    : result('seo.jsonld-parse', 'pass', 'JSON-LD that does not parse', `${html.filter((p) => p.jsonLd?.length).length} pages carry JSON-LD, all of it parses`));
  const none = idx.filter((p) => !p.jsonLd?.length);
  const typeCount = new Map();
  for (const p of html) for (const t of new Set((p.jsonLd || []).flatMap((j) => j.types))) typeCount.set(t, (typeCount.get(t) || 0) + 1);
  const typeList = [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ×${n}`).join(', ');
  out.push(result('seo.jsonld-coverage', none.length === idx.length && idx.length ? 'warn' : 'info', 'Structured data coverage', none.length === idx.length ? `no JSON-LD on any indexable page${input.render?.ran ? ', also after rendering in Chrome' : ''}` : `${idx.length - none.length} of ${idx.length} indexable pages carry JSON-LD: ${typeList}`, { fix: none.length ? 'At least Organization (or LocalBusiness) and WebSite on the start page, BreadcrumbList on inner pages, and Article, Product, Event or FAQPage where the content is one.' : '', urls: none.length === idx.length ? [] : none.map((p) => ({ url: p.url, note: 'no JSON-LD' })) }));

  const r = input.render;
  if (r?.ran) {
    const gained = r.pages.filter((x) => x.ok && x.added > 0);
    const rendered = r.pages.filter((x) => x.ok).length;
    const failedRender = r.pages.filter((x) => !x.ok);
    if (gained.length) out.push(result('seo.jsonld-client-side', 'warn', 'JSON-LD added by JavaScript', `${plural(gained.length, 'page')} of ${rendered} rendered in Chrome ${gained.length === 1 ? "adds" : "add"} JSON-LD only after JavaScript runs`, { fix: 'Google renders JavaScript and sees it (later than the HTML), but Bing, social scrapers and most AI crawlers read the served HTML only. Render the JSON-LD on the server (SSR or in the page template).', urls: gained.map((x) => ({ url: x.url, note: `${plural(x.added, 'block')} added on the client` })) }));
    else if (rendered) out.push(result('seo.jsonld-client-side', 'pass', 'JSON-LD added by JavaScript', `${plural(rendered, 'page')} rendered in Chrome: no JSON-LD beyond what the served HTML has`));
    else out.push(result('seo.jsonld-client-side', 'skip', 'JSON-LD added by JavaScript', `Chrome could not render the pages: ${failedRender[0]?.error || 'unknown error'}`));
  } else if (r) out.push(result('seo.jsonld-client-side', 'skip', 'JSON-LD added by JavaScript', `not checked: ${r.error || 'rendering is off (--render-pages 0)'}`));

  if (input.schema) {
    const failed = input.schema.filter((s) => !s.ok);
    const withErr = input.schema.filter((s) => s.ok && s.errors);
    const withWarn = input.schema.filter((s) => s.ok && !s.errors && s.warnings);
    const issue = (n, e) => `${n.types[0] || '?'}${e.property ? ` ${e.property}` : ''}: ${e.type}${e.args?.length ? ` (${e.args.join(', ')})` : ''}`;
    const detail = (s) => s.nodes.flatMap((n) => n.errors.map((e) => issue(n, e))).slice(0, 3).join('; ');
    const each = (list, kind) => list.flatMap((s) => s.nodes.flatMap((n) => n[kind].map((e) => ({ url: s.url, note: `${kind === 'errors' ? 'ERROR' : 'WARN'} ${issue(n, e)}` }))));
    const rendered = (s) => (s.rendered ? ' (rendered DOM posted)' : '');
    if (withErr.length) out.push(result('seo.schema-validator', 'fail', 'schema.org validator', `${plural(withErr.length, 'page')} of ${input.schema.length} validated have errors`, { fix: 'Fix the errors validator.schema.org reports (open the page in https://validator.schema.org/ for the full list); invalid markup is ignored by search engines.', urls: input.detailed ? [...each(withErr, 'errors'), ...each(withErr, 'warnings')] : withErr.map((s) => ({ url: s.url, note: `${s.errors} errors: ${detail(s)}${rendered(s)}` })) }));
    else if (input.schema.length - failed.length) out.push(result('seo.schema-validator', withWarn.length ? 'info' : 'pass', 'schema.org validator', `${input.schema.length - failed.length} pages validated, no errors${withWarn.length ? `, ${withWarn.length} with warnings` : ''}`, { urls: input.detailed ? each(withWarn, 'warnings') : withWarn.map((s) => ({ url: s.url, note: `${s.warnings} warnings${rendered(s)}` })) }));
    else out.push(result('seo.schema-validator', 'skip', 'schema.org validator', failed.length ? `validator unreachable: ${failed[0].error}` : 'no page with structured data to validate'));
  } else out.push(result('seo.schema-validator', 'skip', 'schema.org validator', 'not run (--no-remote or --schema-pages 0)'));
  out.push(...richChecks(html, input.detailed));
  return out;
}

/**
 * Google rich-result rules (rich.mjs) over every page's JSON-LD: a missing required property
 * makes the page ineligible for that rich result (warn); missing recommended ones only thin it (info).
 */
function richChecks(html, detailed) {
  const out = [];
  const withTypes = html.filter((p) => p.richTypes?.length);
  if (!withTypes.length) return out;
  const pick = (key) => html.flatMap((p) => (p.rich || []).filter((r) => r[key]?.length).map((r) => ({ p, r })));
  const line = (r, key) => `${r.type}: ${r[key].map(prop).join(', ')}`;
  const urls = (hits, key, tag) => (detailed
    ? hits.flatMap(({ p, r }) => r[key].map((x) => ({ url: p.url, note: `${tag} ${r.type} ${prop(x)}: ${key === 'required' ? 'required by Google for the rich result' : 'recommended by Google'}` })))
    : [...new Map(hits.map(({ p }) => [p.url, p])).values()].map((p) => ({ url: p.url, note: (p.rich || []).filter((r) => r[key]?.length).map((r) => line(r, key)).join('; ') })));
  const req = pick('required');
  const reqPages = new Set(req.map((x) => x.p.url));
  const types = [...new Set(withTypes.flatMap((p) => p.richTypes))].join(', ');
  out.push(req.length
    ? result('seo.rich-required', 'warn', 'Google rich results: required properties', `${plural(reqPages.size, 'page')} of ${withTypes.length} with rich-result markup miss a property Google requires (${[...new Set(req.map((x) => x.r.type))].join(', ')})`, { fix: `Without the required properties Google will not show the rich result (stars, price, dates, breadcrumbs). Add them, then confirm with the Rich Results Test (${RICH_TEST(req[0].p.url)}). Rules: ${DOCS}`, urls: urls(req, 'required', 'WARN') })
    : result('seo.rich-required', 'pass', 'Google rich results: required properties', `${plural(withTypes.length, 'page')} with ${types} markup carry every property Google requires`));
  const rec = pick('recommended');
  if (rec.length) out.push(result('seo.rich-recommended', 'info', 'Google rich results: recommended properties', `${plural(new Set(rec.map((x) => x.p.url)).size, 'page')} could add properties Google recommends (${[...new Set(rec.map((x) => x.r.type))].join(', ')})`, { fix: 'Recommended properties make a richer result (images, ratings, availability) and help AI answers describe the page.', urls: urls(rec, 'recommended', 'INFO') }));
  const notes = html.flatMap((p) => (p.rich || []).filter((r) => r.note).map((r) => ({ url: p.url, note: `${r.type}: ${r.note}` })));
  const byNote = [...new Map(notes.map((n) => [n.note, n])).values()];
  if (byNote.length) out.push(result('seo.rich-notes', 'info', 'Google rich results: limited types', byNote.map((n) => n.note).join(' '), { urls: notes }));
  return out;
}

/**
 * Pages to render in Chrome: the start page first, then indexable pages without JSON-LD (the
 * fallback for JSON-LD the served HTML lacks), one per first path segment, then one page per
 * section not picked yet, so the served-versus-rendered text check sees every template, up to `n`.
 */
export function pickRenderPages(pages, startUrl, n) {
  if (n <= 0) return [];
  const html = htmlPages(pages);
  const picked = [];
  const start = html.find((p) => p.url === startUrl) || html[0];
  if (start) picked.push(start.url);
  const seen = new Set();
  for (const p of html.filter(indexable)) {
    if (picked.length >= n) break;
    if (picked.includes(p.url) || p.jsonLd?.length) continue;
    let key;
    try { key = new URL(p.url).pathname.split('/').filter(Boolean)[0] || '/'; } catch { key = p.url; }
    if (seen.has(key)) continue;
    seen.add(key); picked.push(p.url);
  }
  for (const p of html.filter(indexable)) {
    if (picked.length >= n) break;
    if (picked.includes(p.url)) continue;
    let key;
    try { key = new URL(p.url).pathname.split('/').filter(Boolean)[0] || '/'; } catch { key = p.url; }
    if (seen.has(key)) continue;
    seen.add(key); picked.push(p.url);
  }
  return picked.slice(0, n);
}

/** One page per template for the validator: distinct JSON-LD type sets first, then distinct first path segments. */
export function pickSchemaPages(pages, n) {
  const withLd = htmlPages(pages).filter((p) => p.jsonLd?.length && !p.jsonLd.every((j) => j.error));
  const picked = []; const keys = new Set();
  for (const p of withLd) {
    const key = [...new Set(p.jsonLd.flatMap((j) => j.types))].sort().join(',');
    if (keys.has(key)) continue;
    keys.add(key); picked.push(p.url);
    if (picked.length >= n) return picked;
  }
  return picked;
}

export const STATUS_ORDER = { fail: 0, warn: 1, info: 2, pass: 3, skip: 4 };

export function countStatuses(rows) {
  const c = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

// ---------------------------------------------------------------- signals JavaScript changes

const LINKS_ONLY_MIN = 10;
const LINKS_ONLY_SHARE = 0.3;
const flagsOf = (v) => {
  const d = String(v || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  return { noindex: d.includes('noindex') || d.includes('none'), nofollow: d.includes('nofollow') || d.includes('none') };
};
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const noSlash = (u) => String(u).replace(/\/$/, '');

/**
 * What JavaScript changes in a page's indexing signals: the served page record against the head of
 * the rendered DOM (`extractMeta` of it) and the internal links of each. Pure.
 * -> Array<{ signal: 'robots'|'canonical'|'title'|'h1'|'links', severity: 'fail'|'warn', note: string }>
 */
export function jsDrift(page, rendered, servedLinks = null, renderedLinks = null) {
  const out = [];
  const before = flagsOf([page.metaRobots, page.metaGooglebot].filter(Boolean).join(','));
  const after = flagsOf([rendered.robots, rendered.googlebot].filter(Boolean).join(','));
  if (before.noindex && !after.noindex) out.push({ signal: 'robots', severity: 'fail', note: 'served HTML is noindex, JavaScript removes it: Google does not render a page it sees as noindex, so the page stays out' });
  else if (!before.noindex && after.noindex) out.push({ signal: 'robots', severity: 'fail', note: 'JavaScript adds noindex: crawlers that do not render index the page, Google drops it' });
  else if (before.nofollow !== after.nofollow) out.push({ signal: 'robots', severity: 'warn', note: `JavaScript ${after.nofollow ? 'adds' : 'removes'} nofollow` });
  const sc = [...new Set((page.headConflicts?.canonical || (page.canonical ? [page.canonical] : [])).map(noSlash))];
  const rc = [...new Set((rendered.canonicals || []).map(noSlash))];
  if (!sc.length && rc.length) out.push({ signal: 'canonical', severity: 'warn', note: `canonical only after JavaScript: ${rc[0]}` });
  else if (sc.length && !rc.length) out.push({ signal: 'canonical', severity: 'fail', note: `JavaScript removes the canonical (${sc[0]})` });
  else if (sc.length && (sc.length !== rc.length || sc.some((c) => !rc.includes(c)))) out.push({ signal: 'canonical', severity: 'fail', note: `canonical ${sc[0]} served, ${rc[0]} after JavaScript` });
  const st = squash(page.title); const rt = squash(rendered.title);
  if (!st && rt) out.push({ signal: 'title', severity: 'warn', note: `title only after JavaScript: "${rt.slice(0, 80)}"` });
  else if (st && rt && st !== rt) out.push({ signal: 'title', severity: 'warn', note: `title "${st.slice(0, 60)}" served, "${rt.slice(0, 60)}" after JavaScript` });
  const sh = squash(page.h1); const rh = squash(rendered.h1s?.[0]);
  if (!sh && rh) out.push({ signal: 'h1', severity: 'warn', note: `h1 only after JavaScript: "${rh.slice(0, 80)}"` });
  else if (sh && rh && sh !== rh) out.push({ signal: 'h1', severity: 'warn', note: `h1 "${sh.slice(0, 60)}" served, "${rh.slice(0, 60)}" after JavaScript` });
  if (servedLinks && renderedLinks && renderedLinks.size && !page.truncated) {
    const only = [...renderedLinks].filter((l) => !servedLinks.has(l)).length;
    if (only >= LINKS_ONLY_MIN && only / renderedLinks.size >= LINKS_ONLY_SHARE) out.push({ signal: 'links', severity: 'warn', note: `${only} of ${renderedLinks.size} internal links exist only after JavaScript (${servedLinks.size} in the served HTML)` });
  }
  return out;
}

/** seo.js-signals over the render pass: `render.pages[].drift` from jsDrift. */
export function jsSignalsRow(render) {
  const T = 'Signals changed by JavaScript';
  if (!render?.ran) return result('seo.js-signals', 'skip', T, render?.error ? `not rendered: ${render.error}` : 'not rendered (--render-pages 0)');
  const ok = (render.pages || []).filter((p) => p.ok);
  if (!ok.length) return result('seo.js-signals', 'skip', T, 'Chrome rendered no page');
  const hit = ok.filter((p) => p.drift?.length);
  if (!hit.length) return result('seo.js-signals', 'pass', T, `${plural(ok.length, 'page')} rendered in Chrome: robots, canonical, title, h1 and internal links are the same as in the served HTML`);
  const bad = hit.some((p) => p.drift.some((d) => d.severity === 'fail'));
  const signals = [...new Set(hit.flatMap((p) => p.drift.map((d) => d.signal)))];
  const fix = [
    signals.includes('robots') || signals.includes('canonical') ? 'Put meta robots and the canonical in the served HTML and never change them with JavaScript: Google may act on either version, and crawlers that do not render see only the served one.' : '',
    signals.includes('title') || signals.includes('h1') ? 'Render the title and h1 on the server; Bing, link previews and most AI crawlers read the served HTML only.' : '',
    signals.includes('links') ? 'Render navigation and content links as <a href> in the served HTML, so crawlers that do not run JavaScript can find the pages.' : '',
  ].filter(Boolean).join(' ');
  return result('seo.js-signals', bad ? 'fail' : 'warn', T, `${plural(hit.length, 'page')} of ${ok.length} rendered ${hit.length === 1 ? 'changes' : 'change'} ${signals.join(', ')} after JavaScript runs`, { fix, urls: hit.flatMap((p) => p.drift.map((d) => ({ url: p.url, note: d.note }))) });
}
