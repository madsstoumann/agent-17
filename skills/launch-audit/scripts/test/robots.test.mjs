import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  parseRobotsTxt, groupFor, isDisallowedForAll, parseSitemap, parseSitemapBody, sampleSitemapUrls, loadSitemaps,
} from '../lib/robots.mjs';

const fixture = (dir, name) => readFileSync(new URL(`./fixtures/${dir}/${name}`, import.meta.url), 'utf8');
const ioiRobots = fixture('robots', 'ioi.txt');
const perAgent = fixture('robots', 'per-agent.txt');
const indexXml = fixture('sitemaps', 'index.xml');
const urlsetXml = fixture('sitemaps', 'urlset.xml');
const urls282 = fixture('sitemaps', 'urls-282.txt').split('\n').filter(Boolean);

// ---------------------------------------------------------------- robots.txt

test('parseRobotsTxt reads the nuxt-robots "indexing disabled" file', () => {
  const p = parseRobotsTxt(ioiRobots);
  assert.deepEqual(p, {
    groups: [{ agents: ['*'], allow: [], disallow: ['/'], crawlDelay: null }],
    sitemaps: [],
    host: null,
  });
  assert.equal(isDisallowedForAll(p), true);
});

test('parseRobotsTxt: consecutive user-agents share a group, keys are case-insensitive, comments stripped, sitemaps global', () => {
  const p = parseRobotsTxt(perAgent);
  assert.equal(p.groups.length, 3);
  assert.deepEqual(p.groups[0], { agents: ['*'], allow: ['/'], disallow: ['/admin/'], crawlDelay: null });
  assert.deepEqual(p.groups[1], { agents: ['googlebot', 'bingbot'], allow: ['/private/public-bit/'], disallow: ['/private/', '/tmp/'], crawlDelay: 5 });
  assert.deepEqual(p.groups[2], { agents: ['adsbot-google'], allow: [], disallow: ['/'], crawlDelay: null });
  assert.deepEqual(p.sitemaps, ['https://example.com/sitemap.xml', 'https://example.com/sitemap-news.xml']);
  assert.equal(p.host, 'example.com');
  assert.equal(isDisallowedForAll(p), false);
});

test('parseRobotsTxt tolerates CRLF, a BOM, rules before any group and garbage lines', () => {
  const p = parseRobotsTxt('﻿Disallow: /orphan\r\nthis is not a directive\r\nUser-agent: Foo\r\nDisallow: /a\r\n\r\nUser-agent: Bar\r\nAllow: /b\r\n');
  assert.deepEqual(p.groups, [
    { agents: ['foo'], allow: [], disallow: ['/a'], crawlDelay: null },
    { agents: ['bar'], allow: ['/b'], disallow: [], crawlDelay: null },
  ]);
  assert.deepEqual(parseRobotsTxt(''), { groups: [], sitemaps: [], host: null });
  assert.deepEqual(parseRobotsTxt(null), { groups: [], sitemaps: [], host: null });
});

test('parseRobotsTxt: any line that is not a user-agent ends the run of agents, as Google parses it', () => {
  const p = parseRobotsTxt('User-agent: a\nSitemap: https://x.example/s.xml\nUser-agent: b\nDisallow: /y\nUser-agent: c\nNoindex: /z\nUser-agent: d\nDisallow: /w');
  assert.deepEqual(p.groups.map((g) => g.agents), [['a'], ['b'], ['c'], ['d']]);
  assert.deepEqual(p.groups[1].disallow, ['/y']);
  assert.deepEqual(p.groups[3].disallow, ['/w']);
  assert.deepEqual(p.sitemaps, ['https://x.example/s.xml']);
});

test('groupFor prefers the exact agent, falls back to *, else null; repeated groups for one agent are combined', () => {
  const p = parseRobotsTxt(perAgent);
  assert.deepEqual(groupFor(p, 'Googlebot').disallow, ['/private/', '/tmp/']);
  assert.deepEqual(groupFor(p, 'BINGBOT').crawlDelay, 5);
  assert.deepEqual(groupFor(p, 'adsbot-google').disallow, ['/']);
  assert.deepEqual(groupFor(p, 'yandex').agents, ['*']);
  assert.equal(groupFor(parseRobotsTxt('User-agent: Foo\nDisallow: /'), 'bar'), null);
  const merged = parseRobotsTxt('User-agent: *\nDisallow: /a\n\nUser-agent: *\nDisallow: /b\nCrawl-delay: 2');
  assert.deepEqual(groupFor(merged, 'anything'), { agents: ['*'], allow: [], disallow: ['/a', '/b'], crawlDelay: 2 });
});

test('isDisallowedForAll needs Disallow: / on * with no Allow: /', () => {
  assert.equal(isDisallowedForAll(parseRobotsTxt('User-agent: *\nDisallow: /')), true);
  assert.equal(isDisallowedForAll(parseRobotsTxt('User-agent: *\nDisallow: /\nAllow: /')), false);
  assert.equal(isDisallowedForAll(parseRobotsTxt('User-agent: *\nDisallow: /admin/')), false);
  assert.equal(isDisallowedForAll(parseRobotsTxt('User-agent: Googlebot\nDisallow: /')), false, 'only the * group counts');
  assert.equal(isDisallowedForAll(parseRobotsTxt('User-agent: *\nDisallow:')), false, 'an empty Disallow allows everything');
  assert.equal(isDisallowedForAll(parseRobotsTxt('')), false);
});

// ---------------------------------------------------------------- sitemaps

test('parseSitemap reads a urlset with CDATA, entities, whitespace, lastmod and xhtml alternates', () => {
  const s = parseSitemap(urlsetXml);
  assert.equal(s.kind, 'urlset');
  assert.equal(s.error, null);
  assert.equal(s.count, 4);
  assert.deepEqual(s.sitemaps, []);
  assert.deepEqual(s.urls[0], {
    loc: 'https://example.com/',
    lastmod: '2026-09-22',
    alternates: [
      { lang: 'en', href: 'https://example.com/' },
      { lang: 'da', href: 'https://example.com/da/' },
      { lang: 'x-default', href: 'https://example.com/' },
    ],
  });
  assert.deepEqual(s.urls[1], { loc: 'https://example.com/search?q=a&lang=en', lastmod: '2026-09-21T08:30:00Z', alternates: [] });
  assert.deepEqual(s.urls[2], { loc: 'https://example.com/hitman/world-of-assassination/', lastmod: null, alternates: [] }, 'image:loc is not the loc');
  assert.deepEqual(s.urls[3], { loc: 'https://example.com/careers/', lastmod: null, alternates: [] });
});

test('parseSitemap reads a sitemap index', () => {
  const s = parseSitemap(indexXml);
  assert.equal(s.kind, 'sitemapindex');
  assert.equal(s.count, 3);
  assert.deepEqual(s.urls, []);
  assert.deepEqual(s.sitemaps, [
    { loc: 'https://example.com/sitemap-pages.xml', lastmod: '2026-09-20T10:00:00+00:00' },
    { loc: 'https://example.com/sitemap-news.xml', lastmod: null },
    { loc: 'https://example.com/sitemap-images.xml.gz', lastmod: '2026-09-01' },
  ]);
});

test('parseSitemap handles namespace prefixes on the sitemap elements', () => {
  const s = parseSitemap('<?xml version="1.0"?><sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://example.com/a</sm:loc><sm:lastmod>2026-01-01</sm:lastmod></sm:url></sm:urlset>');
  assert.equal(s.kind, 'urlset');
  assert.deepEqual(s.urls, [{ loc: 'https://example.com/a', lastmod: '2026-01-01', alternates: [] }]);
});

test('parseSitemap returns unknown with an error for HTML, plain text and empty input', () => {
  const h = parseSitemap('<!DOCTYPE html><html><body>404</body></html>');
  assert.equal(h.kind, 'unknown');
  assert.match(h.error, /HTML/);
  assert.equal(h.count, 0);
  assert.deepEqual(h.urls, []);
  assert.deepEqual(h.sitemaps, []);
  assert.equal(parseSitemap('hello').kind, 'unknown');
  assert.equal(typeof parseSitemap('hello').error, 'string');
  assert.equal(typeof parseSitemap('').error, 'string');
  assert.equal(parseSitemap(null).kind, 'unknown');
});

test('parseSitemapBody gunzips by magic bytes or a .gz URL, and passes plain bodies through', () => {
  const gz = gzipSync(Buffer.from(urlsetXml));
  const a = parseSitemapBody(gz, { url: 'https://example.com/sitemap.xml', contentType: 'application/octet-stream' });
  assert.equal(a.kind, 'urlset');
  assert.equal(a.count, 4);
  const b = parseSitemapBody(gz, { url: 'https://example.com/sitemap.xml.gz', contentType: 'application/gzip' });
  assert.equal(b.count, 4);
  const c = parseSitemapBody(Buffer.from(indexXml), { url: 'https://example.com/sitemap.xml.gz', contentType: 'application/xml' });
  assert.equal(c.kind, 'sitemapindex', 'a .gz URL whose body is already plain XML still parses');
  const d = parseSitemapBody(urlsetXml, { url: 'https://example.com/sitemap.xml', contentType: 'text/xml' });
  assert.equal(d.count, 4);
  const e = parseSitemapBody(Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]), { url: 'https://example.com/s.gz', contentType: '' });
  assert.equal(e.kind, 'unknown');
  assert.match(e.error, /gunzip/i);
  const f = parseSitemapBody('﻿' + urlsetXml, { url: 'https://example.com/sitemap.xml', contentType: 'text/xml' });
  assert.equal(f.kind, 'urlset', 'a BOM is tolerated');
});

// ---------------------------------------------------------------- sampling

test('sampleSitemapUrls picks template diversity deterministically', () => {
  const three = sampleSitemapUrls(urls282, { startUrl: 'https://example.com/', n: 3 });
  assert.equal(three.length, 3);
  const segs = three.map((u) => new URL(u).pathname.split('/')[1]);
  assert.equal(new Set(segs).size, 3, `three different first segments, got ${segs}`);
  assert.equal(three.includes('https://example.com/'), false, 'the start URL is dropped');
  assert.deepEqual(sampleSitemapUrls(urls282, { startUrl: 'https://example.com/', n: 3 }), three, 'same input, same output');
  assert.deepEqual(sampleSitemapUrls([...urls282].reverse(), { startUrl: 'https://example.com', n: 3 }), three, 'input order does not matter');
  const ten = sampleSitemapUrls(urls282, { startUrl: 'https://example.com/', n: 10 });
  assert.equal(ten.length, 10);
  assert.equal(new Set(ten).size, 10, 'never repeats a URL');
  assert.equal(new Set(ten.map((u) => new URL(u).pathname.split('/')[1])).size, 7, 'ten picks cover all seven sections');
});

test('sampleSitemapUrls drops the start URL modulo slash, query strings, excluded and invalid URLs; shortest first in a bucket', () => {
  const urls = [
    'https://example.com/a/long-page-name/', 'https://example.com/a/x/', 'https://example.com/a/y/',
    'https://example.com/b/?page=2', 'https://example.com/b/', 'https://example.com/', 'not a url', 'https://example.com/c/',
  ];
  const picked = sampleSitemapUrls(urls, { startUrl: 'https://example.com', n: 10, exclude: ['https://example.com/c'] });
  assert.deepEqual(picked, ['https://example.com/a/x/', 'https://example.com/b/', 'https://example.com/a/y/', 'https://example.com/a/long-page-name/']);
  assert.deepEqual(sampleSitemapUrls([], { startUrl: 'https://example.com/', n: 3 }), []);
  assert.deepEqual(sampleSitemapUrls(urls, { startUrl: 'https://example.com/', n: 0 }), []);
});

// ---------------------------------------------------------------- loadSitemaps

function fakeHttp(map, calls = []) {
  return {
    async get(url, opts) {
      calls.push({ url, opts });
      const r = map[url];
      if (!r) return { url, finalUrl: url, status: 404, ok: false, headers: {}, setCookie: [], body: Buffer.from('<html>404</html>'), bytes: 16, truncated: false, contentType: 'text/html', ms: 1, redirected: false };
      if (r.error) return { url, finalUrl: url, status: 0, ok: false, headers: {}, setCookie: [], body: null, bytes: 0, truncated: false, contentType: '', ms: 1, redirected: false, error: r.error };
      const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body);
      return { url, finalUrl: url, status: 200, ok: true, headers: {}, setCookie: [], body, bytes: body.length, truncated: Boolean(r.truncated), contentType: r.contentType || 'application/xml', ms: 1, redirected: false };
    },
  };
}
const urlsetOf = (...locs) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;

test('loadSitemaps follows an index, gunzips, records a 404 child and dedupes URLs', async () => {
  const calls = [];
  const http = fakeHttp({
    'https://example.com/sitemap.xml': { body: indexXml },
    'https://example.com/sitemap-pages.xml': { body: urlsetOf('https://example.com/', 'https://example.com/a/') },
    'https://example.com/sitemap-images.xml.gz': { body: gzipSync(Buffer.from(urlsetOf('https://example.com/a/', 'https://example.com/b/'))), contentType: 'application/gzip' },
  }, calls);
  const r = await loadSitemaps(http, ['https://example.com/sitemap.xml']);
  assert.deepEqual(r.urls, ['https://example.com/', 'https://example.com/a/', 'https://example.com/b/']);
  assert.deepEqual(r.indexes, ['https://example.com/sitemap.xml']);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.sources.map((s) => [s.url, s.status, s.kind, s.count]), [
    ['https://example.com/sitemap.xml', 200, 'sitemapindex', 3],
    ['https://example.com/sitemap-pages.xml', 200, 'urlset', 2],
    ['https://example.com/sitemap-news.xml', 404, 'unknown', 0],
    ['https://example.com/sitemap-images.xml.gz', 200, 'urlset', 2],
  ]);
  assert.match(r.sources[2].error, /404/);
  assert.equal(r.sources[0].error, null);
  assert.equal(calls.every((c) => c.opts.as === 'buffer' && c.opts.maxBytes === 10 * 1024 * 1024), true, 'fetched as buffer with the byte cap');
});

test('loadSitemaps caps index children, caps URLs with truncated: true, and never throws on a network error', async () => {
  const many = urlsetOf(...Array.from({ length: 6 }, (_, i) => `https://example.com/p${i}/`));
  const http = fakeHttp({
    'https://example.com/sitemap.xml': { body: indexXml },
    'https://example.com/sitemap-pages.xml': { body: many },
    'https://example.com/sitemap-news.xml': { body: many },
    'https://example.com/sitemap-images.xml.gz': { body: many },
    'https://example.com/dead.xml': { error: 'ECONNREFUSED: connect' },
  });
  const capped = await loadSitemaps(http, ['https://example.com/sitemap.xml'], { maxChildren: 1 });
  assert.deepEqual(capped.sources.map((s) => s.kind), ['sitemapindex', 'urlset', 'skipped', 'skipped']);
  assert.equal(capped.urls.length, 6);
  assert.match(capped.sources[2].error, /skipped/i);

  const trunc = await loadSitemaps(http, ['https://example.com/sitemap-pages.xml', 'https://example.com/sitemap-news.xml'], { maxUrls: 4 });
  assert.equal(trunc.urls.length, 4);
  assert.equal(trunc.truncated, true);
  assert.deepEqual(trunc.sources.map((s) => [s.kind, s.status]), [['urlset', 200], ['skipped', null]], 'a starting URL never fetched is a skipped row');
  assert.match(trunc.sources[1].error, /URL cap/);

  const truncIndex = await loadSitemaps(http, ['https://example.com/sitemap.xml'], { maxUrls: 4 });
  assert.equal(truncIndex.truncated, true);
  assert.deepEqual(truncIndex.sources.map((s) => [s.url, s.kind]), [
    ['https://example.com/sitemap.xml', 'sitemapindex'],
    ['https://example.com/sitemap-pages.xml', 'urlset'],
    ['https://example.com/sitemap-news.xml', 'skipped'],
    ['https://example.com/sitemap-images.xml.gz', 'skipped'],
  ], 'children in index order; the ones the cap stopped are skipped rows');

  const dead = await loadSitemaps(http, ['https://example.com/dead.xml']);
  assert.deepEqual(dead.urls, []);
  assert.equal(dead.sources[0].status, 0);
  assert.match(dead.sources[0].error, /ECONNREFUSED/);

  const none = await loadSitemaps(http, []);
  assert.deepEqual(none, { urls: [], sources: [], truncated: false, indexes: [] });
  const bad = await loadSitemaps({ async get() { throw new Error('boom'); } }, ['https://example.com/sitemap.xml']);
  assert.match(bad.sources[0].error, /boom/);
});

test('loadSitemaps fetches each starting URL once and does not loop on an index that lists itself', async () => {
  const calls = [];
  const self = '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/sitemap.xml</loc></sitemap><sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap></sitemapindex>';
  const http = fakeHttp({
    'https://example.com/sitemap.xml': { body: self },
    'https://example.com/sitemap-pages.xml': { body: urlsetOf('https://example.com/a/') },
  }, calls);
  const r = await loadSitemaps(http, ['https://example.com/sitemap.xml', 'https://example.com/sitemap.xml']);
  assert.deepEqual(calls.map((c) => c.url), ['https://example.com/sitemap.xml', 'https://example.com/sitemap-pages.xml']);
  assert.deepEqual(r.urls, ['https://example.com/a/']);
});
