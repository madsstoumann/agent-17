import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, chainFrom, pickSchemaPages, looksSchemeless } from '../lib/checks.mjs';
import { pageRecord, wordCount, crawlSite, checkInternal, checkExternal, headThenGet, localeOf, sampleSpread } from '../lib/crawl.mjs';
import { isAllowed } from '../lib/robotsmatch.mjs';
import { parseRobotsTxt } from '../lib/robots.mjs';
import { parseSchemaAnswer } from '../lib/schema.mjs';
import { renderMarkdown, findings, severityOf, pagesCsv } from '../lib/report.mjs';

const H = 'https://www.example.dk';
const words = (n) => Array.from({ length: n }, (_, i) => `ord${i}`).join(' ');
const doc = ({ title = 'A page title for tests', desc = 'A description that is long enough to pass the fifty character check.', canonical, robots, lang = 'da', h1 = 1, og = true, ld, hreflang = [], links = [], body = words(200) } = {}) => `<!doctype html><html lang="${lang}"><head>
<title>${title}</title><meta name="description" content="${desc}">
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${robots ? `<meta name="robots" content="${robots}">` : ''}
${og ? '<meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:image" content="https://www.example.dk/og.jpg">' : ''}
${hreflang.map(([l, h]) => `<link rel="alternate" hreflang="${l}" href="${h}">`).join('')}
${ld ? `<script type="application/ld+json">${ld}</script>` : ''}
</head><body>${'<h1>Heading</h1>'.repeat(h1)}<p>${body}</p>${links.map((l) => `<a href="${l}">x</a>`).join('')}<script>var a = "not words";</script></body></html>`;
const page = (path, opts = {}, status = 200, headers = {}) => {
  const url = `${H}${path}`;
  return pageRecord(url, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } }, status === 200 ? doc({ canonical: url, ...opts }) : null);
};
const byId = (rows, id) => rows.find((r) => r.id === id);

test('wordCount ignores scripts, styles and svg', () => {
  assert.equal(wordCount('<html><head><title>x y</title></head><body><p>one two</p><script>a b c</script><style>.a{}</style><svg><text>z</text></svg> three</body></html>'), 3);
});

test('pageRecord reads noindex from the header and the meta tag, and keeps a redirect target', () => {
  assert.equal(page('/a', {}, 200, { 'x-robots-tag': 'noindex' }).noindex, true);
  assert.equal(page('/b', { robots: 'noindex, follow' }).noindex, true);
  assert.equal(page('/c').noindex, false);
  const r = pageRecord(`${H}/old`, { status: 301, headers: { location: '/new' } }, null);
  assert.equal(r.location, `${H}/new`);
});

test('isAllowed: longest match wins, Allow wins a tie, * and $ work', () => {
  const r = parseRobotsTxt('User-agent: *\nDisallow: /search\nDisallow: /*.pdf$\nAllow: /search/help\nDisallow: /private/');
  assert.equal(isAllowed(r, '/'), true);
  assert.equal(isAllowed(r, '/search?q=1'), false);
  assert.equal(isAllowed(r, '/search/help'), true);
  assert.equal(isAllowed(r, '/files/a.pdf'), false);
  assert.equal(isAllowed(r, '/files/a.pdf?x'), true);
  assert.equal(isAllowed(null, '/anything'), true);
});

test('chainFrom follows recorded redirects and spots loops', () => {
  const pages = [
    pageRecord(`${H}/a`, { status: 301, headers: { location: `${H}/b` } }, null),
    pageRecord(`${H}/b`, { status: 302, headers: { location: `${H}/c` } }, null),
    page('/c'),
    pageRecord(`${H}/x`, { status: 301, headers: { location: `${H}/y` } }, null),
    pageRecord(`${H}/y`, { status: 301, headers: { location: `${H}/x` } }, null),
  ];
  const by = new Map(pages.map((p) => [p.url, p]));
  assert.deepEqual(chainFrom(`${H}/a`, by).hops.map((h) => h.status), [301, 302]);
  assert.equal(chainFrom(`${H}/a`, by).final, `${H}/c`);
  assert.equal(chainFrom(`${H}/x`, by).loop, true);
});

test('looksSchemeless spots hrefs written without https://', () => {
  assert.equal(looksSchemeless(`${H}/news/shop.us2.list-manage.com/subscribe?u=1`), true);
  assert.equal(looksSchemeless(`${H}/www.facebook.com/page`), true);
  assert.equal(looksSchemeless(`${H}/blog/post.html`), false);
});

function site() {
  const pages = [
    page('/', { links: ['/om', '/kontakt', '/gammel', '/mangler'], ld: '{"@context":"https://schema.org","@type":"Organization","name":"X"}', hreflang: [['da', `${H}/`], ['en', `${H}/en/`]] }),
    page('/om', { title: 'Same title for two pages', links: ['/'] }),
    page('/kontakt', { title: 'Same title for two pages', desc: '', h1: 0, og: false, ld: '{"@type": "Thing",}' }),
    page('/en/', { lang: 'en', hreflang: [['en', `${H}/en/`]] }),
    page('/tak', { robots: 'noindex' }),
    page('/dup', { canonical: `${H}/gammel` }),
    pageRecord(`${H}/gammel`, { status: 302, headers: { location: `${H}/om` } }, null),
    pageRecord(`${H}/mangler`, { status: 404, headers: { 'content-type': 'text/html' } }, null),
  ];
  const inlinks = new Map([
    [`${H}/om`, new Set([`${H}/`, `${H}/gammel`])], [`${H}/kontakt`, new Set([`${H}/`])], [`${H}/gammel`, new Set([`${H}/`])], [`${H}/mangler`, new Set([`${H}/`])], [`${H}/`, new Set([`${H}/om`])],
  ]);
  return {
    finalUrl: `${H}/`, hosts: ['www.example.dk', 'example.dk'], pages, inlinks, truncated: false,
    robots: { status: 200, parsed: parseRobotsTxt('User-agent: *\nDisallow: /tak\nSitemap: https://www.example.dk/sitemap.xml') },
    sitemap: { urls: [`${H}/`, `${H}/om`, `${H}/tak`, `${H}/gammel`, `${H}/forladt`, 'https://staging.example.dk/x'], sources: [{ url: `${H}/sitemap.xml`, status: 200, kind: 'urlset', count: 6 }], declared: ['https://www.example.dk/sitemap.xml'], truncated: false },
    external: [{ url: 'https://dead.example.com/', status: 404, ok: false, blocked: false }, { url: 'https://www.linkedin.com/x', status: 999, ok: true, blocked: true }],
    ogImages: [{ url: `${H}/og.jpg`, status: 200, contentType: 'image/jpeg' }],
    schema: [{ url: `${H}/`, ok: true, errors: 1, warnings: 0, nodes: [{ types: ['Organization'], errors: [{ type: 'MISSING_FIELD', property: 'url' }], warnings: [] }] }],
  };
}

test('runChecks finds the planted problems', () => {
  const rows = runChecks(site());
  const st = (id) => byId(rows, id)?.status;
  assert.equal(st('seo.start'), 'pass');
  assert.equal(st('seo.broken-internal'), 'warn');
  assert.deepEqual(byId(rows, 'seo.broken-internal').urls.map((u) => u.url), [`${H}/mangler`]);
  assert.equal(st('seo.title-duplicate'), 'warn');
  assert.equal(st('seo.h1'), 'warn');
  assert.equal(st('seo.jsonld-parse'), 'fail');
  assert.equal(st('seo.schema-validator'), 'fail');
  assert.equal(st('seo.sitemap-noindex'), 'fail');
  assert.equal(st('seo.sitemap-blocked'), 'fail');
  assert.equal(st('seo.sitemap-hosts'), 'fail');
  assert.equal(st('seo.sitemap-status'), 'warn', 'a redirect in the sitemap is a warning');
  assert.equal(st('seo.temporary-redirects'), 'warn');
  assert.equal(st('seo.canonical-target'), 'fail', '/dup canonicalises to a redirect');
  assert.equal(st('seo.hreflang-return'), 'warn', '/en/ does not link back to /');
  assert.equal(st('seo.hreflang-x-default'), 'info');
  assert.equal(st('seo.broken-external'), 'warn');
  assert.match(byId(rows, 'seo.broken-external').evidence, /1 more refused/);
  assert.ok(byId(rows, 'seo.sitemap-missing').urls.some((u) => u.url === `${H}/kontakt`));
  assert.ok(byId(rows, 'seo.orphans').urls.some((u) => u.url === `${H}/forladt`));
  assert.equal(st('seo.og-missing'), 'warn');
  assert.equal(st('seo.og-image'), 'pass');
});

test('production host and a staging noindex', () => {
  const s = site();
  s.productionHost = 'staging.example.dk';
  assert.equal(byId(runChecks(s), 'seo.sitemap-hosts'), undefined, 'the production host is not "another host"');
  s.pages[0] = page('/', { robots: 'noindex' });
  assert.equal(byId(runChecks(s), 'seo.start').status, 'fail');
});

test('pickSchemaPages takes one page per JSON-LD type set', () => {
  const pages = [page('/a', { ld: '{"@type":"Article"}' }), page('/b', { ld: '{"@type":"Article"}' }), page('/c', { ld: '{"@type":"Event"}' }), page('/d')];
  assert.deepEqual(pickSchemaPages(pages, 5), [`${H}/a`, `${H}/c`]);
});

test('parseSchemaAnswer reads the guarded JSON', () => {
  const r = parseSchemaAnswer(`)]}'\n${JSON.stringify({ numObjects: 1, totalNumErrors: 1, totalNumWarnings: 0, tripleGroups: [{ nodes: [{ types: [{ value: 'Event' }], properties: [{ pred: 'startDate', errors: [{ errorType: 'INVALID_DATE' }] }] }] }] })}`);
  assert.equal(r.errors, 1);
  assert.deepEqual(r.types, ['Event']);
  assert.equal(r.nodes[0].errors[0].property, 'startDate');
  assert.ok(parseSchemaAnswer('<html>').error);
});

test('report, findings and csv', () => {
  const s = site();
  const rows = runChecks(s);
  const report = { version: '1.0.0', date: '2026-10-30', site: { finalUrl: `${H}/`, host: 'www.example.dk' }, env: {}, rows, pages: s.pages, stats: { html: 6, other: 2, redirects: 1, errors: 1, indexable: 5, truncated: false, sitemapMissing: 0, sitemapSampled: 0 } };
  const md = renderMarkdown(report);
  assert.match(md, /^# SEO audit — www\.example\.dk/);
  assert.match(md, /\*\*Result:\*\* \d+ fail, \d+ warn, \d+ pass, \d+ info, \d+ skipped/);
  assert.match(md, /## Fix list/);
  const f = findings(report);
  assert.ok(f.findings.length > 5);
  assert.ok(f.findings.every((x) => ['blocker', 'high', 'medium', 'low'].includes(x.severity) && x.sources[0] === 'seo' && x.fix !== undefined));
  assert.equal(severityOf({ id: 'seo.start', status: 'fail' }), 'blocker');
  const csv = pagesCsv(s.pages, s.inlinks).split('\n');
  assert.match(csv[0], /^url,status,/);
  assert.equal(csv.length, s.pages.length + 2);
});

test('crawlSite follows links, records redirects and samples the sitemap', async () => {
  const site = {
    '/': [200, doc({ links: ['/a', '/old', '/blocked/x', 'https://other.example.com/'] })],
    '/a': [200, doc({ links: ['/'] })],
    '/old': [301, null, { location: '/a' }],
    '/only-in-sitemap': [200, doc({ links: ['/never'] })],
  };
  const http = { get: async (url) => {
    const [status, body, headers = {}] = site[new URL(url).pathname] || [404, null];
    return { status, body, headers: { 'content-type': 'text/html', ...headers }, contentType: 'text/html', ms: 1 };
  } };
  const robots = parseRobotsTxt('User-agent: *\nDisallow: /blocked/');
  const r = await crawlSite(http, { startUrl: `${H}/`, hosts: ['www.example.dk'], sitemapUrls: [`${H}/only-in-sitemap`], robots });
  const urls = r.pages.map((p) => new URL(p.url).pathname).sort();
  assert.deepEqual(urls, ['/', '/a', '/old', '/only-in-sitemap']);
  assert.ok(r.blocked.has(`${H}/blocked/x`));
  assert.ok(r.external.has('https://other.example.com/'));
  assert.equal(r.sitemapSampled, 1);
});

test('crawlSite shares the --pages budget across language sections (wpp.com /es-ES/ footer)', async () => {
  // The English start page links 60 English pages and the Spanish home; Spanish pages carry broken footer links.
  const en = Array.from({ length: 60 }, (_, i) => `/en/p${i}`);
  const site = { '/': [301, null, { location: '/en' }], '/en': [200, doc({ links: [...en, '/es-ES'] })] };
  for (const p of en) site[p] = [200, doc({ links: ['/en', '/en/privacy-policy'] })];
  site['/en/privacy-policy'] = [200, doc()];
  site['/es-ES'] = [200, doc({ links: ['/es-ES/news', '/es-ES/privacy-policy', '/es-ES/cookies'] })];
  site['/es-ES/news'] = [200, doc({ links: ['/es-ES/privacy-policy'] })];
  const http = {
    get: async (url) => {
      const [status, body, headers = {}] = site[new URL(url).pathname] || [404, null];
      return { status, body, headers: { 'content-type': 'text/html', ...headers }, contentType: 'text/html', ms: 1 };
    },
  };
  http.head = http.get;
  const r = await crawlSite(http, { startUrl: `${H}/`, hosts: ['www.example.dk'], maxPages: 20 });
  const fetched = r.pages.map((p) => new URL(p.url).pathname);
  assert.ok(fetched.includes('/es-ES'), 'the Spanish home is fetched although 60 English links came first');
  assert.ok(fetched.includes('/es-ES/privacy-policy'), 'a Spanish footer target is fetched within the budget');
  assert.ok(r.truncated);
  assert.ok(r.locales['es-es'] >= 3);
  // whatever the crawl did not fetch is status-checked, so every broken link is found
  const internal = await checkInternal(http, r, { max: 300 });
  const rows = runChecks({ finalUrl: `${H}/en`, hosts: ['www.example.dk'], pages: r.pages, inlinks: r.inlinks, internal });
  const broken = byId(rows, 'seo.broken-internal');
  assert.notEqual(broken.status, 'pass');
  assert.deepEqual(broken.urls.map((u) => new URL(u.url).pathname).sort(), ['/es-ES/cookies', '/es-ES/privacy-policy']);
  assert.equal(internal.unchecked, 0);
});

test('localeOf reads the language prefix', () => {
  assert.equal(localeOf(`${H}/es-ES/news`), 'es-es');
  assert.equal(localeOf(`${H}/da/om-os`), 'da');
  assert.equal(localeOf(`${H}/zh_Hans/`), 'zh-hans');
  assert.equal(localeOf(`${H}/news/en`), '');
  assert.equal(localeOf(`${H}/about`), '');
});

test('checkInternal only checks link targets the crawl did not fetch, round robin over sections', async () => {
  const inlinks = new Map([[`${H}/a`, new Set([`${H}/`])], [`${H}/en/1`, new Set([`${H}/`])], [`${H}/en/2`, new Set([`${H}/`])], [`${H}/da/1`, new Set([`${H}/`])]]);
  const seen = [];
  const http = { head: async (url) => { seen.push(new URL(url).pathname); return { status: 200 }; }, get: async () => ({ status: 200 }) };
  const r = await checkInternal(http, { pages: [{ url: `${H}/a` }], inlinks }, { max: 2, concurrency: 1 });
  assert.deepEqual(seen, ['/en/1', '/da/1']);
  assert.equal(r.unchecked, 1);
});

test('sampleSpread shares the sitemap sample across language sections', () => {
  const en = Array.from({ length: 100 }, (_, i) => `${H}/en/p${i}`);
  const es = Array.from({ length: 30 }, (_, i) => `${H}/es-ES/p${i}`);
  const de = [`${H}/de-DE/a`, `${H}/de-DE/b`];
  const s = sampleSpread([...en, ...es, ...de], 20);
  const count = (pre) => s.filter((u) => u.includes(pre)).length;
  assert.equal(s.length, 20);
  assert.deepEqual([count('/en/'), count('/es-ES/'), count('/de-DE/')], [9, 9, 2]);
  assert.equal(sampleSpread(en.slice(0, 5), 50).length, 5);
  assert.deepEqual(sampleSpread(en, 4), [en[0], en[25], en[50], en[75]]);
});

test('headThenGet: Sitecore\'s image edge answers HEAD 404 and GET 200 image/png; the GET counts', async () => {
  const img = 'https://edge.sitecorecloud.io/simcorp/og.png?h=1080&iar=0&w=1920';
  const calls = [];
  const http = {
    head: async (url) => { calls.push('HEAD'); return { url, status: 404, contentType: 'text/plain', headers: {}, error: null }; },
    get: async (url, o) => { calls.push(`GET ${o.maxBytes}`); return { url, status: 200, contentType: 'image/png', headers: { 'content-type': 'image/png' }, body: null, error: null }; },
  };
  const r = await headThenGet(http, img);
  assert.equal(r.status, 200);
  assert.equal(r.contentType, 'image/png');
  assert.deepEqual(calls, ['HEAD', 'GET 0']);
  const [ext] = await checkExternal(http, [img]);
  assert.equal(ext.ok, true);
  const ok = { head: async (url) => ({ url, status: 200, contentType: 'image/png' }), get: async () => { throw new Error('no GET after a good HEAD'); } };
  assert.equal((await headThenGet(ok, img)).status, 200);
});
