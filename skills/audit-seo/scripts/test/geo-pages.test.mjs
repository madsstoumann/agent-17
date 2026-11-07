import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSignals } from '../lib/content.mjs';
import { extractMeta } from '../lib/html.mjs';
import { judgeFetch, botAccessRow, renderedTextRow, freshnessRows, answerStructureRow, schemaOpportunitiesRow, bingRow, geoScore, isGeoRow, newsUrl, articleLikeWithoutMarkup } from '../lib/geo.mjs';
import { visibleDate } from '../lib/content.mjs';
import { parseRobotsTxt } from '../lib/robots.mjs';
import { renderMarkdown, findings } from '../lib/report.mjs';
import { pickRenderPages } from '../lib/checks.mjs';

const byId = (rows, id) => rows.find((r) => r.id === id);
const sig = (html) => pageSignals(html, extractMeta(html, 'https://x.dk/').jsonLd);
const page = (url, s, extra = {}) => ({ url, status: 200, title: 't', noindex: false, words: 400, sig: { headings: 2, headingsAll: 3, questionHeadings: 0, lists: 0, tables: 0, paragraphs: 4, longParagraphs: 0, published: null, modified: null, author: false, articleLike: false, breadcrumbNav: false, bingVerify: false, ...s }, ...extra });

const ARTICLE = `<!doctype html><html><head><title>News</title>
<meta property="og:type" content="article"><meta name="msvalidate.01" content="abc">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"H","datePublished":"2025-03-01T08:00:00Z","dateModified":"2026-01-10","author":{"@type":"Person","name":"Ann"}}</script>
</head><body><nav><ul><li><a href="/">Home</a></li><li><a href="/a">A</a></li></ul></nav>
<nav aria-label="Breadcrumb"><a href="/">Home</a></nav>
<main><h1>Title</h1><h2>What is it?</h2><p>Short answer.</p><h2>How does it work?</h2><ul><li>one</li><li>two</li></ul><table><tr><td>1</td></tr></table>
<p>${'word '.repeat(130)}</p></main><footer><ul><li>x</li><li>y</li></ul></footer></body></html>`;

test('pageSignals reads dates, author, structure and hints from the served HTML', () => {
  const s = sig(ARTICLE);
  assert.equal(s.articleLike, true);
  assert.equal(s.published, '2025-03-01');
  assert.equal(s.modified, '2026-01-10');
  assert.equal(s.dateSource, 'JSON-LD');
  assert.equal(s.author, true);
  assert.equal(s.questionHeadings, 2);
  assert.equal(s.headings, 2);
  assert.equal(s.headingsAll, 3);
  assert.equal(s.lists, 1, 'nav and footer lists are not counted');
  assert.equal(s.tables, 1);
  assert.equal(s.paragraphs, 2);
  assert.equal(s.longParagraphs, 1);
  assert.equal(s.breadcrumbNav, true);
  assert.equal(s.bingVerify, true);
});

test('pageSignals: meta and <time> dates, and a page that is not an article', () => {
  const meta = sig('<html><head><meta property="article:published_time" content="2024-05-02"><meta name="author" content="Bo"></head><body><p>x</p></body></html>');
  assert.equal(meta.articleLike, true);
  assert.equal(meta.published, '2024-05-02');
  assert.equal(meta.dateSource, 'meta');
  assert.equal(meta.author, true);
  const time = sig('<html><head><meta property="og:type" content="article"></head><body><time dateTime="2016-11-29T00:00:00.000Z">29 Nov</time></body></html>');
  assert.equal(time.published, '2016-11-29');
  assert.equal(time.dateSource, '<time>');
  const plain = sig('<html><body><h2>Services</h2><p>We build things.</p><time datetime="2020-01-01">x</time></body></html>');
  assert.equal(plain.articleLike, false);
  assert.equal(plain.published, null, 'a <time> outside an article is not the page date');
});

test('judgeFetch: status, challenge and a stub of the page are refusals', () => {
  assert.equal(judgeFetch({ status: 403, body: '' }, 500).refused, true);
  assert.equal(judgeFetch({ status: 0, error: 'reset' }, 500).refused, true);
  assert.equal(judgeFetch({ status: 200, body: '<body>Just a moment</body>' }, 500, () => 'Cloudflare').refused, true);
  assert.equal(judgeFetch({ status: 200, body: `<body>${'w '.repeat(50)}</body>` }, 500).refused, true);
  assert.equal(judgeFetch({ status: 200, body: `<body>${'w '.repeat(480)}</body>` }, 500).refused, false);
});

const ok = { refused: false, why: 'HTTP 200' };
const no = { refused: true, why: 'HTTP 403' };
const bots = (over = {}) => ({ 'OAI-SearchBot': ok, 'ChatGPT-User': ok, 'Claude-SearchBot': ok, 'Claude-User': ok, PerplexityBot: ok, 'Perplexity-User': ok, bingbot: ok, GPTBot: ok, ClaudeBot: ok, Googlebot: ok, ...over });
const access = (over, baseline = { refused: false, words: 500 }) => ({ pages: [{ url: 'https://x.dk/', baseline, bots: bots(over) }] });

test('botAccessRow: pass, answer bots refused, training only, IP-verified edge, baseline refused', () => {
  assert.equal(botAccessRow(access({})).status, 'pass');
  const warn = botAccessRow(access({ PerplexityBot: no, 'OAI-SearchBot': no, GPTBot: no }));
  assert.equal(warn.status, 'warn');
  assert.match(warn.evidence, /OAI-SearchBot, PerplexityBot/);
  assert.match(warn.evidence, /training crawlers refused too: GPTBot/);
  assert.equal(botAccessRow(access({ GPTBot: no, ClaudeBot: no })).status, 'info');
  const ip = botAccessRow(access({ Googlebot: no, PerplexityBot: no }));
  assert.equal(ip.status, 'info');
  assert.match(ip.evidence, /by IP address/);
  assert.equal(botAccessRow(access({}, { refused: true, why: 'HTTP 403', words: 0 })).status, 'skip');
  assert.equal(botAccessRow(null).status, 'skip');
  assert.equal(botAccessRow(access({ GPTBot: { robots: true } })).status, 'pass');
});

test('renderedTextRow: pass, warn on pages that lose their text, fail for a client-rendered site', () => {
  const render = { ran: true };
  const good = [page('https://x.dk/', {}, { words: 500, renderedWords: 520, renderedHeadings: 3 })];
  assert.equal(renderedTextRow({ pages: good, render }).status, 'pass');
  const one = [...good, page('https://x.dk/a', {}, { words: 100, renderedWords: 600, renderedHeadings: 5 }), page('https://x.dk/b', {}, { words: 400, renderedWords: 410 })];
  const warn = renderedTextRow({ pages: one, render });
  assert.equal(warn.status, 'warn');
  assert.match(warn.urls[0].note, /served 100 words, 600 after JavaScript \(17% in the HTML\); headings 3 → 5/);
  const spa = [page('https://x.dk/', {}, { words: 10, renderedWords: 800 }), page('https://x.dk/a', {}, { words: 12, renderedWords: 700 })];
  assert.equal(renderedTextRow({ pages: spa, render }).status, 'fail');
  // A cookie banner's worth of difference is not a finding.
  assert.equal(renderedTextRow({ pages: [page('https://x.dk/', {}, { words: 60, renderedWords: 140 })], render }).status, 'pass');
  assert.equal(renderedTextRow({ pages: good, render: { ran: false, error: 'no Chrome' } }).status, 'skip');
});

test('freshnessRows: undated and anonymous articles, no articles, sitemap lastmod', () => {
  const pages = [
    page('https://x.dk/n/1', { articleLike: true, published: '2026-01-01', modified: '2026-02-01', author: true }),
    page('https://x.dk/n/2', { articleLike: true }),
    page('https://x.dk/n/3', { articleLike: true, published: '2020-01-01' }),
    page('https://x.dk/about', {}),
  ];
  const rows = freshnessRows({ pages, today: '2026-11-06' });
  assert.equal(byId(rows, 'seo.freshness').status, 'warn');
  assert.match(byId(rows, 'seo.freshness').evidence, /2 of 3 article pages carry a machine-readable date, 1 without dateModified; 1 last dated over two years ago/);
  assert.deepEqual(byId(rows, 'seo.freshness').urls.map((u) => u.url), ['https://x.dk/n/2']);
  assert.equal(byId(rows, 'seo.author').status, 'info');
  const none = freshnessRows({ pages: [page('https://x.dk/', {})] });
  assert.equal(byId(none, 'seo.freshness').status, 'info');
  assert.equal(byId(none, 'seo.author'), undefined);
  const urls = Array.from({ length: 12 }, (_, i) => `https://x.dk/${i}`);
  const same = freshnessRows({ pages: [], sitemap: { urls, lastmod: Object.fromEntries(urls.map((u) => [u, '2026-11-06T03:00:00Z'])) } });
  assert.equal(byId(same, 'seo.sitemap-lastmod').status, 'warn');
  assert.equal(byId(freshnessRows({ pages: [], sitemap: { urls, lastmod: {} } }), 'seo.sitemap-lastmod').status, 'info');
  const varied = freshnessRows({ pages: [], sitemap: { urls, lastmod: Object.fromEntries(urls.map((u, i) => [u, `2026-10-${String(i + 1).padStart(2, '0')}`])) } });
  assert.equal(byId(varied, 'seo.sitemap-lastmod').status, 'pass');
});

test('answerStructureRow and schemaOpportunitiesRow are info rows with the pages to start on', () => {
  const pages = [
    page('https://x.dk/faq', { questionHeadings: 4, lists: 1 }),
    page('https://x.dk/wall', { headings: 0, paragraphs: 4, longParagraphs: 3 }, { words: 900 }),
    page('https://x.dk/n/1', { articleLike: true, breadcrumbNav: true }),
  ];
  const a = answerStructureRow({ pages });
  assert.equal(a.status, 'info');
  assert.match(a.evidence, /question headings on 1, lists or tables on 1, mostly paragraphs over 120 words on 1, no subheadings on 1/);
  assert.equal(a.urls[0].url, 'https://x.dk/wall');
  const o = schemaOpportunitiesRow({ pages });
  assert.equal(o.status, 'info');
  assert.match(o.evidence, /Article 1, FAQPage 1, BreadcrumbList 1/);
  const marked = [page('https://x.dk/n/1', { articleLike: true }, { jsonLd: [{ types: ['NewsArticle'] }] })];
  assert.equal(schemaOpportunitiesRow({ pages: marked }).status, 'pass');
});

test('bingRow: bingbot blocked is a warning', () => {
  const r = (text) => ({ status: 200, parsed: parseRobotsTxt(text) });
  assert.equal(bingRow({ robots: r('User-agent: bingbot\nDisallow: /\n') }).status, 'warn');
  assert.match(bingRow({ robots: r('User-agent: *\nAllow: /\n'), start: { sig: { bingVerify: true } } }).evidence, /verification tag/);
  assert.equal(bingRow({ robots: {} }), null);
});

test('geoScore and the --geo report', () => {
  const rows = [
    { id: 'seo.ai-crawlers', area: 'geo', status: 'pass', title: 'AI crawlers', evidence: '', fix: '', urls: [] },
    { id: 'seo.ai-bot-access', area: 'geo', status: 'warn', title: 'AI crawlers at the edge', evidence: 'refused', fix: 'allow', urls: [] },
    { id: 'seo.noindex', area: 'indexing', status: 'fail', title: 'Noindex', evidence: 'x', fix: '', urls: [] },
    { id: 'seo.og-image', area: 'social', status: 'fail', title: 'og:image', evidence: 'x', fix: '', urls: [] },
    { id: 'seo.llms-txt', area: 'geo', status: 'skip', title: 'llms.txt', evidence: '', fix: '', urls: [] },
  ];
  const s = geoScore(rows);
  assert.deepEqual([s.score, s.counted], [50, 3]);
  assert.equal(rows.filter(isGeoRow).length, 4);
  const report = { site: { host: 'x.dk', finalUrl: 'https://x.dk/' }, stats: { html: 1, other: 0, redirects: 0, errors: 0, indexable: 1, sitemapMissing: 0 }, env: {}, date: '2026-11-06', version: 't', geo: { score: s }, rows, pages: [] };
  const md = renderMarkdown(report, { geo: true });
  assert.match(md, /^# GEO audit — x\.dk/);
  assert.match(md, /\*\*GEO readiness:\*\* 50\/100 over 3 AI search checks/);
  assert.match(md, /\*\*Result:\*\* 1 fail, 1 warn, 1 pass, 0 info, 1 skipped/);
  assert.match(md, /## 1\. AI search \(GEO\)/);
  assert.doesNotMatch(md, /og:image/);
  const full = renderMarkdown(report);
  assert.match(full, /^# SEO audit/);
  assert.match(full, /og:image/);
  assert.match(full, /\*\*GEO readiness:\*\* 50\/100/);
  const f = findings(report).findings;
  assert.deepEqual(f.map((x) => [x.check, x.geo]), [['seo.noindex', true], ['seo.og-image', false], ['seo.ai-bot-access', true]]);
});

test('pickRenderPages fills up with one page per section that has JSON-LD', () => {
  const ld = [{ types: ['X'], error: null }];
  const pg = (url, jsonLd = []) => ({ url, status: 200, title: 't', noindex: false, canonical: null, jsonLd });
  const pages = [pg('https://x.dk/', ld), pg('https://x.dk/blog/1'), pg('https://x.dk/news/1', ld), pg('https://x.dk/news/2', ld)];
  assert.deepEqual(pickRenderPages(pages, 'https://x.dk/', 8), ['https://x.dk/', 'https://x.dk/blog/1', 'https://x.dk/news/1']);
});

test('news pages without article markup: dated URL or a date written on the page (example.com)', () => {
  assert.deepEqual(newsUrl('https://www.example.com/about-us/news/2022/Example-signs-new-partner'), { dated: true });
  assert.deepEqual(newsUrl('https://x.dk/insights/how-to-buy'), { dated: false });
  for (const listing of ['https://x.dk/news', 'https://x.dk/news/2022', 'https://x.dk/blog/tag/ai', 'https://x.dk/blog/page/2', 'https://x.dk/about-us']) assert.equal(newsUrl(listing), null, listing);
  assert.equal(visibleDate('<p>Copenhagen, <span>November 24, 2022</span></p>'), 'November 24, 2022');
  assert.equal(visibleDate('<p>24. november 2022</p>'), '24. november 2022');
  assert.equal(visibleDate('<p>Founded in 2022, 400 clients</p>'), null);
  const html = '<html><head><title>Example signs new partner</title></head><body><main><h1>Example signs new partner</h1><p>November 24, 2022</p><p>Text.</p></main></body></html>';
  const s = sig(html);
  assert.equal(s.articleLike, false);
  assert.equal(s.visibleDate, 'November 24, 2022');
  const news = page('https://www.example.com/about-us/news/2022/Example-signs-new-partner', { visibleDate: 'November 24, 2022' });
  const insight = page('https://www.example.com/insights/buy-side-trends', { visibleDate: 'March 3, 2024' });
  const undatedInsight = page('https://www.example.com/insights/what-is-ibor', {});
  assert.equal(articleLikeWithoutMarkup(news), true);
  assert.equal(articleLikeWithoutMarkup(insight), true);
  assert.equal(articleLikeWithoutMarkup(undatedInsight), false, 'an insights page with no date anywhere may be evergreen');
  const rows = freshnessRows({ pages: [news, insight, undatedInsight, page('https://www.example.com/', {})], today: '2026-11-06' });
  const f = byId(rows, 'seo.freshness');
  assert.equal(f.status, 'warn');
  assert.match(f.evidence, /0 of 2 article pages carry a machine-readable date; 2 article-like pages \(news URL, date shown as plain text\) without a machine-readable date/);
  assert.match(f.urls[0].note, /shows "November 24, 2022" as plain text/);
  assert.equal(byId(rows, 'seo.author').status, 'warn', 'no author on any article-like page');
  assert.match(schemaOpportunitiesRow({ pages: [news] }).evidence, /Article 1/);
});

test('GEO view counts JSON-LD coverage and sitemap rows; info opportunities count three quarters', () => {
  const row = (id, status, area = 'geo', fix = '') => ({ id, area, status, title: id, evidence: '', fix, urls: [] });
  for (const id of ['seo.jsonld-coverage', 'seo.sitemap-noindex', 'seo.sitemap-blocked', 'seo.canonical-target', 'seo.title-duplicate']) assert.equal(isGeoRow(row(id, 'pass', 'x')), true, id);
  assert.equal(isGeoRow(row('seo.og-image', 'fail', 'social')), false);
  // example.com: 18 rows passing, then no JSON-LD anywhere and 9 noindex URLs in the sitemap
  const base = Array.from({ length: 18 }, (_, i) => row(`seo.x${i}`, 'pass'));
  const before = geoScore([...base, row('seo.ai-bot-access', 'warn'), row('seo.answer-structure', 'warn'), row('seo.jsonld-coverage', 'warn', 'schema'), row('seo.sitemap-noindex', 'fail', 'sitemap')]);
  assert.equal(before.counted, 22);
  assert.equal(before.score, Math.round(((18 + 1.5) / 22) * 100));
  const opp = geoScore([row('seo.ai-crawlers', 'info'), row('seo.llms-txt', 'info', 'geo', 'add one'), row('seo.schema-opportunities', 'info', 'geo', 'mark up'), row('seo.llms-full', 'info')]);
  assert.equal(opp.score, Math.round(((1 + 0.75 + 0.75 + 1) / 4) * 100));
  assert.deepEqual(opp.opportunities.map((o) => o.id), ['seo.llms-txt', 'seo.schema-opportunities']);
  const report = { site: { host: 'x.dk', finalUrl: 'https://x.dk/' }, stats: { html: 1, other: 0, redirects: 0, errors: 0, indexable: 1, sitemapMissing: 0 }, env: {}, date: '2026-11-06', version: 't', geo: { score: opp }, rows: [], pages: [] };
  const md = renderMarkdown(report, { geo: true });
  assert.match(md, /4 info, 2 of them opportunities/);
  assert.match(md, /\*\*Opportunities\*\* .*: seo\.llms-txt, seo\.schema-opportunities\./);
});
