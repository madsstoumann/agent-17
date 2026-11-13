// Checks borrowed as generic rules from an outside SEO plugin's deterministic checks: signals
// JavaScript changes, conflicting head tags, snippet controls, sitemap file limits, HTML size and
// meta refresh redirects. Every host is a placeholder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { extractMeta, nosnippetText } from '../lib/html.mjs';
import { pageRecord, xRobotsDirectives, snippetControl, headerCanonicals, internalLinks } from '../lib/crawl.mjs';
import { runChecks, jsDrift, jsSignalsRow, HTML_LIMIT } from '../lib/checks.mjs';
import { parseSitemap, parseSitemapBody, loadSitemaps, SITEMAP_MAX_BYTES } from '../lib/robots.mjs';
import { snippetControlsRow, isGeoRow } from '../lib/geo.mjs';
import { applyArchiveMode } from '../lib/offline.mjs';

const H = 'https://www.example.com';
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const html = ({ head = '', body = `<h1>Heading</h1><p>${words(200)}</p>` } = {}) => `<!doctype html><html lang="en"><head><title>A page title for tests</title><meta name="description" content="A description that is long enough to pass the fifty character check.">${head}</head><body>${body}</body></html>`;
const rec = (path, opts = {}, headers = {}, res = {}) => pageRecord(`${H}${path}`, { status: 200, headers: { 'content-type': 'text/html', ...headers }, ...res }, html({ head: `<link rel="canonical" href="${H}${path}">${opts.head || ''}`, body: opts.body }));
const site = (pages, extra = {}) => ({ finalUrl: `${H}/`, hosts: ['www.example.com'], pages, robots: { status: 200, parsed: { groups: [], sitemaps: [] } }, ...extra });
const byId = (rows, id) => rows.find((r) => r.id === id);

// ---------------------------------------------------------------- extractMeta

test('extractMeta joins every robots meta tag, so a second one with noindex counts', () => {
  const m = extractMeta('<head><meta name="robots" content="index, follow"><meta name="robots" content="noindex"></head>', `${H}/`);
  assert.equal(m.robots, 'index, follow, noindex');
  assert.equal(rec('/a', { head: '<meta name="robots" content="index"><meta name="robots" content="noindex">' }).noindex, true, 'the strictest robots tag wins');
  assert.equal(extractMeta('<meta name="googlebot" content="nosnippet"><meta name="googlebot" content="noarchive">', H).googlebot, 'nosnippet, noarchive');
});

test('extractMeta lists every distinct canonical, title and description; the first stays the value', () => {
  const m = extractMeta(`<head><title>One</title><title>Two</title><title>One</title><meta name="description" content="d1"><meta name="description" content="d1"><link rel="canonical" href="/a"><link rel="canonical" href="${H}/b"></head><body><svg><title>icon</title></svg></body>`, `${H}/p`);
  assert.equal(m.title, 'One');
  assert.deepEqual(m.titles, ['One', 'Two'], 'an svg <title> is not a page title');
  assert.deepEqual(m.descriptions, ['d1']);
  assert.equal(m.canonical, `${H}/a`);
  assert.deepEqual(m.canonicals, [`${H}/a`, `${H}/b`]);
});

test('extractMeta reads meta refresh: delay, quoted or bare url, reload only', () => {
  assert.deepEqual(extractMeta(`<meta http-equiv="refresh" content="0; URL='/new'">`, `${H}/old`).refresh, { delay: 0, url: `${H}/new` });
  assert.deepEqual(extractMeta('<meta http-equiv="Refresh" content="5;url=https://example.org/x">', H).refresh, { delay: 5, url: 'https://example.org/x' });
  assert.deepEqual(extractMeta('<meta http-equiv="refresh" content="30">', H).refresh, { delay: 30, url: null });
  assert.equal(extractMeta('<meta name="x" content="1">', H).refresh, null);
});

test('nosnippetText: outermost data-nosnippet elements, nested tags balanced, scripts left out', () => {
  assert.equal(nosnippetText('<p>a</p><div data-nosnippet><div>x y</div><div>z<script>var q = 1;</script></div></div><p>tail</p><span data-nosnippet="">q</span>'), 'x y z q');
  assert.equal(nosnippetText('<p>nothing here</p>'), '');
  assert.equal(nosnippetText('<img data-nosnippet src="a.png"><p>after</p>'), '', 'a void element holds no text');
  assert.equal(nosnippetText('<section data-nosnippet><p>open to the end'), 'open to the end', 'an unclosed element runs to the end');
});

// ---------------------------------------------------------------- page records

test('xRobotsDirectives scopes "name:" prefixes to that agent and keeps max-snippet:N as one directive', () => {
  assert.deepEqual(xRobotsDirectives('noindex, max-snippet: 20'), [{ agent: '*', directive: 'noindex' }, { agent: '*', directive: 'max-snippet:20' }]);
  assert.deepEqual(xRobotsDirectives('otherbot: noindex, nofollow'), [{ agent: 'otherbot', directive: 'noindex' }, { agent: 'otherbot', directive: 'nofollow' }]);
  assert.deepEqual(xRobotsDirectives('googlebot: nosnippet'), [{ agent: 'googlebot', directive: 'nosnippet' }]);
  assert.deepEqual(xRobotsDirectives(null), []);
});

test('snippetControl: the strictest of header and meta tags for Google; other agents and -1 do not count', () => {
  assert.equal(snippetControl('googlebot: nosnippet', null, null), 'nosnippet');
  assert.equal(snippetControl('otherbot: nosnippet', null, null), null);
  assert.equal(snippetControl(null, 'max-snippet:50, max-snippet:0', null), 'max-snippet:0');
  assert.equal(snippetControl(null, 'max-snippet:-1', null), null);
  assert.equal(snippetControl(null, 'index', 'max-snippet: 120'), 'max-snippet:120');
  assert.equal(snippetControl(null, null, null), null);
});

test('headerCanonicals reads rel=canonical out of a Link header', () => {
  assert.deepEqual(headerCanonicals(`<${H}/a>; rel="canonical", </b.css>; rel=preload; as=style`, `${H}/p`), [`${H}/a`]);
  assert.deepEqual(headerCanonicals('</x>; rel=canonical', `${H}/p`), [`${H}/x`]);
  assert.deepEqual(headerCanonicals('', H), []);
});

test('pageRecord records head conflicts, refresh, snippet controls, hidden words and a cut-off read', () => {
  const two = rec('/a', { head: `<link rel="canonical" href="${H}/b">` });
  assert.deepEqual(two.headConflicts.canonical, [`${H}/a`, `${H}/b`]);
  assert.equal(rec('/s', { head: `<link rel="canonical" href="${H}/s/">` }).headConflicts, undefined, 'a trailing slash is not a second canonical');
  assert.deepEqual(rec('/h', {}, { link: `<${H}/other>; rel="canonical"` }).headConflicts.canonical, [`${H}/h`, `${H}/other`], 'the Link header and the HTML disagree');
  assert.equal(rec('/same', {}, { link: `<${H}/same>; rel="canonical"` }).headConflicts, undefined);
  assert.deepEqual(rec('/t', { head: '<title>Second</title>' }).headConflicts.title, ['A page title for tests', 'Second']);
  assert.deepEqual(rec('/r', { head: '<meta http-equiv="refresh" content="0;url=/new">' }).refresh, { delay: 0, url: `${H}/new` });
  assert.equal(rec('/reload', { head: '<meta http-equiv="refresh" content="60">' }).refresh, undefined, 'a reload is not a redirect');
  assert.equal(rec('/n', {}, { 'x-robots-tag': 'nosnippet' }).snippet, 'nosnippet');
  assert.equal(rec('/d', { body: `<h1>H</h1><p>${words(50)}</p><div data-nosnippet><p>${words(150)}</p></div>` }).nosnippetWords, 150);
  assert.equal(rec('/big', {}, {}, { truncated: true }).truncated, true);
  const plain = rec('/plain');
  for (const k of ['headConflicts', 'refresh', 'snippet', 'nosnippetWords', 'truncated']) assert.equal(k in plain, false, `${k} is only set when present`);
});

// ---------------------------------------------------------------- site rows

test('seo.html-size: past the 2 MB Googlebot reads fails, close to it is info', () => {
  const pass = runChecks(site([rec('/')]));
  assert.equal(byId(pass, 'seo.html-size').status, 'pass');
  const near = rec('/near'); near.bytes = 1_700_000;
  assert.equal(byId(runChecks(site([rec('/'), near])), 'seo.html-size').status, 'info');
  const cut = rec('/cut', {}, {}, { truncated: true }); cut.bytes = HTML_LIMIT;
  const big = rec('/big'); big.bytes = HTML_LIMIT + 10;
  const row = byId(runChecks(site([rec('/'), cut, big, near])), 'seo.html-size');
  assert.equal(row.status, 'fail');
  assert.deepEqual(row.urls.map((u) => u.url), [`${H}/cut`, `${H}/big`]);
  assert.match(row.urls[0].note, /more than 2.1 MB \(the read stopped at 2.1 MB\)/);
});

test('seo.head-conflicts: two canonicals fail, a second title is a warning', () => {
  assert.equal(byId(runChecks(site([rec('/')])), 'seo.head-conflicts').status, 'pass');
  assert.equal(byId(runChecks(site([rec('/'), rec('/t', { head: '<title>Second</title>' })])), 'seo.head-conflicts').status, 'warn');
  const row = byId(runChecks(site([rec('/'), rec('/t', { head: '<title>Second</title>' }), rec('/a', { head: `<link rel="canonical" href="${H}/b">` })])), 'seo.head-conflicts');
  assert.equal(row.status, 'fail');
  assert.match(row.evidence, /two or more different canonicals \(and titles or descriptions twice\)/);
  assert.match(row.urls.find((u) => u.url === `${H}/a`).note, /2 different canonicals/);
  assert.match(row.fix, /may ignore all of them/);
});

test('seo.meta-refresh: a refresh to another URL is a warning; one to the page itself is not', () => {
  assert.equal(byId(runChecks(site([rec('/'), rec('/self', { head: `<meta http-equiv="refresh" content="300;url=${H}/self/">` })])), 'seo.meta-refresh').status, 'pass');
  const row = byId(runChecks(site([rec('/'), rec('/old', { head: '<meta http-equiv="refresh" content="0; url=/new">' })])), 'seo.meta-refresh');
  assert.equal(row.status, 'warn');
  assert.equal(row.urls[0].note, `after 0 s → ${H}/new`);
  assert.equal(row.area, 'links');
});

test('seo.sitemap-limits: URL count, size, nested index and news entries per file', () => {
  const sitemap = (sources) => ({ urls: [`${H}/`], declared: [`${H}/sitemap.xml`], sources });
  const ok = { url: `${H}/sitemap.xml`, status: 200, kind: 'urlset', count: 1, bytes: 200, error: null };
  assert.equal(byId(runChecks(site([rec('/')], { sitemap: sitemap([ok]) })), 'seo.sitemap-limits').status, 'pass');
  const row = byId(runChecks(site([rec('/')], { sitemap: sitemap([
    ok,
    { url: `${H}/big.xml`, status: 200, kind: 'urlset', count: 50001, bytes: 9e6, error: null },
    { url: `${H}/huge.xml.gz`, status: 200, kind: 'unknown', count: 0, bytes: SITEMAP_MAX_BYTES + 1, oversize: true, error: 'larger than 50 MB uncompressed' },
    { url: `${H}/inner-index.xml`, status: 200, kind: 'sitemapindex', count: 2, bytes: 300, error: null, parent: `${H}/sitemap.xml` },
    { url: `${H}/news.xml`, status: 200, kind: 'urlset', count: 1200, news: 1200, bytes: 4e5, error: null },
  ]) })), 'seo.sitemap-limits');
  assert.equal(row.status, 'fail');
  assert.deepEqual(row.urls.map((u) => u.url), [`${H}/big.xml`, `${H}/huge.xml.gz`, `${H}/inner-index.xml`, `${H}/news.xml`]);
  assert.match(row.urls[0].note, /50,001 URLs \(limit 50,000\)/);
  assert.match(row.urls[2].note, /listed by another index/);
  assert.match(row.urls[3].note, /1,200 news entries/);
});

test('parseSitemap counts news entries; parseSitemapBody gives the uncompressed size and stops inflating past 50 MB', () => {
  const news = `<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>${H}/a</loc><news:news><news:title>A</news:title></news:news></url><url><loc>${H}/b</loc><news:news><news:title>B</news:title></news:news></url></urlset>`;
  assert.equal(parseSitemap(news).news, 2);
  assert.equal(parseSitemap(`<urlset><url><loc>${H}/a</loc></url></urlset>`).news, 0);
  const small = parseSitemapBody(gzipSync(Buffer.from(news)), { url: `${H}/news.xml.gz` });
  assert.equal(small.bytes, Buffer.byteLength(news));
  assert.equal(small.oversize, undefined);
  const bomb = parseSitemapBody(gzipSync(Buffer.alloc(SITEMAP_MAX_BYTES + 1024, 0x20)), { url: `${H}/big.xml.gz` });
  assert.equal(bomb.oversize, true);
  assert.equal(bomb.kind, 'unknown');
});

test('loadSitemaps marks an index listed by an index and a read that stopped at the cap', async () => {
  const bodies = {
    [`${H}/sitemap.xml`]: `<sitemapindex><sitemap><loc>${H}/inner.xml</loc></sitemap><sitemap><loc>${H}/pages.xml</loc></sitemap></sitemapindex>`,
    [`${H}/inner.xml`]: `<sitemapindex><sitemap><loc>${H}/deep.xml</loc></sitemap></sitemapindex>`,
    [`${H}/deep.xml`]: `<urlset><url><loc>${H}/d</loc></url></urlset>`,
    [`${H}/pages.xml`]: `<urlset><url><loc>${H}/p</loc></url></urlset>`,
  };
  const http = { get: async (url) => (bodies[url] ? { status: 200, ok: true, body: Buffer.from(bodies[url]), bytes: bodies[url].length, contentType: 'application/xml' } : { status: 404, ok: false }) };
  const sm = await loadSitemaps(http, [`${H}/sitemap.xml`], { maxChildren: 10 });
  const by = Object.fromEntries(sm.sources.map((s) => [s.url, s]));
  assert.equal(by[`${H}/sitemap.xml`].parent, undefined);
  assert.equal(by[`${H}/inner.xml`].parent, `${H}/sitemap.xml`);
  assert.equal(by[`${H}/inner.xml`].kind, 'sitemapindex');
  assert.equal(by[`${H}/pages.xml`].bytes, bodies[`${H}/pages.xml`].length);
  assert.deepEqual(sm.urls.sort(), [`${H}/d`, `${H}/p`]);
  const cut = { get: async () => ({ status: 200, ok: true, body: Buffer.from(`<urlset><url><loc>${H}/a</loc></url>`), bytes: SITEMAP_MAX_BYTES + 1, truncated: true, contentType: 'application/xml' }) };
  assert.equal((await loadSitemaps(cut, [`${H}/s.xml`])).sources[0].oversize, true);
});

// ---------------------------------------------------------------- signals JavaScript changes

const served = (o = {}) => ({ url: `${H}/p`, metaRobots: null, canonical: `${H}/p`, title: 'Title', h1: 'Heading', ...o });
const renderedMeta = (o = {}) => ({ robots: null, googlebot: null, canonicals: [`${H}/p`], title: 'Title', h1s: ['Heading'], ...o });
const links = (n, prefix = 'l') => new Set(Array.from({ length: n }, (_, i) => `${H}/${prefix}${i}`));

test('jsDrift: nothing changes', () => {
  assert.deepEqual(jsDrift(served(), renderedMeta(), links(5), links(5)), []);
  assert.deepEqual(jsDrift(served({ title: ' Title ' }), renderedMeta({ title: 'Title', canonicals: [`${H}/p/`] })), [], 'whitespace and a trailing slash are not changes');
});

test('jsDrift: robots and canonical changes fail, title and h1 changes warn', () => {
  const sig = (p, r) => jsDrift(served(p), renderedMeta(r)).map((d) => `${d.signal}:${d.severity}`);
  assert.deepEqual(sig({ metaRobots: 'noindex' }, {}), ['robots:fail']);
  assert.deepEqual(sig({}, { robots: 'noindex, nofollow' }), ['robots:fail']);
  assert.deepEqual(sig({ metaGooglebot: 'noindex' }, { googlebot: 'noindex' }), [], 'the same noindex on both sides');
  assert.deepEqual(sig({}, { robots: 'nofollow' }), ['robots:warn']);
  assert.deepEqual(sig({ canonical: null }, {}), ['canonical:warn']);
  assert.deepEqual(sig({}, { canonicals: [] }), ['canonical:fail']);
  assert.deepEqual(sig({}, { canonicals: [`${H}/other`] }), ['canonical:fail']);
  assert.deepEqual(sig({ title: '' }, {}), ['title:warn']);
  assert.deepEqual(sig({}, { title: 'Other' }), ['title:warn']);
  assert.deepEqual(sig({ h1: null }, {}), ['h1:warn']);
  assert.deepEqual(sig({}, { h1s: ['Other'] }), ['h1:warn']);
  assert.deepEqual(sig({}, { title: '', h1s: [] }), [], 'a rendered DOM that lost its title or h1 is not judged here');
});

test('jsDrift: links only after JavaScript need 10 and 30 %, and are not judged on a cut-off page', () => {
  const s = links(20);
  const r = new Set([...s, ...links(10, 'js')]);
  assert.match(jsDrift(served(), renderedMeta(), s, r)[0].note, /10 of 30 internal links exist only after JavaScript \(20 in the served HTML\)/);
  assert.deepEqual(jsDrift(served(), renderedMeta(), s, new Set([...s, ...links(9, 'js')])), [], 'nine is under the floor');
  assert.deepEqual(jsDrift(served(), renderedMeta(), links(40), new Set([...links(40), ...links(12, 'js')])), [], '12 of 52 is under 30 %');
  assert.deepEqual(jsDrift(served({ truncated: true }), renderedMeta(), s, r), []);
  assert.deepEqual(jsDrift(served(), renderedMeta(), null, r), [], 'no served link set, no judgement');
});

test('internalLinks counts the same links in served and rendered HTML: own hosts, no files', () => {
  const own = new Set(['www.example.com']);
  const set = internalLinks(`<a href="/a">a</a><a href="/a#x">a</a><a href="/doc.pdf">p</a><a href="https://example.org/">x</a><a href="/cdn-cgi/l/email">e</a><a href="mailto:a@example.com">m</a>`, `${H}/`, own);
  assert.deepEqual([...set], [`${H}/a`]);
});

test('jsSignalsRow: skip, pass, warn and fail', () => {
  assert.equal(jsSignalsRow(null).status, 'skip');
  assert.match(jsSignalsRow({ ran: false, error: 'no Chrome' }).evidence, /no Chrome/);
  assert.equal(jsSignalsRow({ ran: true, pages: [{ url: `${H}/`, ok: false, error: 'x' }] }).status, 'skip');
  assert.equal(jsSignalsRow({ ran: true, pages: [{ url: `${H}/`, ok: true }] }).status, 'pass');
  const warn = jsSignalsRow({ ran: true, pages: [{ url: `${H}/`, ok: true, drift: [{ signal: 'links', severity: 'warn', note: 'n' }] }, { url: `${H}/b`, ok: true }] });
  assert.equal(warn.status, 'warn');
  assert.match(warn.evidence, /1 page of 2 rendered changes links/);
  assert.match(warn.fix, /<a href>/);
  assert.doesNotMatch(warn.fix, /canonical/, 'the fix names only what changed');
  const fail = jsSignalsRow({ ran: true, pages: [{ url: `${H}/`, ok: true, drift: [{ signal: 'canonical', severity: 'fail', note: 'c' }, { signal: 'title', severity: 'warn', note: 't' }] }] });
  assert.equal(fail.status, 'fail');
  assert.deepEqual(fail.urls.map((u) => u.note), ['c', 't']);
  assert.equal(fail.area, 'indexing');
});

// ---------------------------------------------------------------- snippet controls

test('seo.snippet-controls: nosnippet, max-snippet:0 and mostly data-nosnippet warn; a limit is info; noindex pages are left out', () => {
  assert.equal(snippetControlsRow({ pages: [rec('/')] }).status, 'pass');
  assert.equal(snippetControlsRow({ pages: [] }).status, 'skip');
  const limited = snippetControlsRow({ pages: [rec('/'), rec('/l', { head: '<meta name="robots" content="max-snippet:50">' })] });
  assert.equal(limited.status, 'info');
  assert.match(limited.evidence, /max-snippet:50/);
  assert.equal(snippetControlsRow({ pages: [rec('/'), rec('/x', { head: '<meta name="robots" content="noindex, nosnippet">' })] }).status, 'pass', 'a noindex page is out anyway');
  const row = snippetControlsRow({ pages: [
    rec('/'),
    rec('/n', {}, { 'x-robots-tag': 'nosnippet' }),
    rec('/z', { head: '<meta name="googlebot" content="max-snippet:0">' }),
    rec('/d', { body: `<h1>H</h1><p>${words(20)}</p><div data-nosnippet><p>${words(200)}</p></div>` }),
    rec('/small', { body: `<h1>H</h1><p>${words(200)}</p><span data-nosnippet>price 10</span>` }),
  ] });
  assert.equal(row.status, 'warn');
  assert.deepEqual(row.urls.map((u) => u.url), [`${H}/n`, `${H}/z`, `${H}/d`, `${H}/small`], 'blocked pages first, then pages that only hide a little');
  assert.match(row.evidence, /3 indexable pages of 5/);
  assert.match(row.fix, /nosnippet, max-snippet:0, data-nosnippet/, 'the fix names what the site sends');
  assert.equal(row.area, 'geo');
});

// ---------------------------------------------------------------- GEO view and archive mode

test('the render comparison and snippet controls are GEO rows; the other new rows are not', () => {
  assert.equal(isGeoRow({ id: 'seo.js-signals', area: 'indexing' }), true);
  assert.equal(isGeoRow({ id: 'seo.snippet-controls', area: 'geo' }), true);
  for (const [id, area] of [['seo.head-conflicts', 'canonical'], ['seo.html-size', 'indexing'], ['seo.sitemap-limits', 'sitemap'], ['seo.meta-refresh', 'links']]) assert.equal(isGeoRow({ id, area }), false, id);
});

test('archive mode skips the render comparison and the sitemap limits without a sitemap, and degrades header-based rows', () => {
  const rows = [
    { id: 'seo.js-signals', area: 'indexing', status: 'skip', title: 't', evidence: '' },
    { id: 'seo.sitemap-limits', area: 'sitemap', status: 'pass', title: 't', evidence: '' },
    { id: 'seo.snippet-controls', area: 'geo', status: 'pass', title: 't', evidence: '' },
    { id: 'seo.head-conflicts', area: 'canonical', status: 'pass', title: 't', evidence: '' },
  ];
  const out = applyArchiveMode(structuredClone(rows), { robots: true, sitemap: false, llms: true });
  const list = out.rows;
  assert.deepEqual(out.degraded.map((d) => d.id), ['seo.snippet-controls', 'seo.head-conflicts']);
  const st = (id) => list.find((r) => r.id === id);
  assert.equal(st('seo.js-signals').status, 'skip');
  assert.match(st('seo.js-signals').evidence, /rendered in Chrome from the live site/);
  assert.equal(st('seo.sitemap-limits').status, 'skip');
  assert.equal(st('seo.snippet-controls').archive, 'degraded');
  assert.equal(st('seo.head-conflicts').archive, 'degraded');
});
