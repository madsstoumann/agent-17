import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageRecordFromHtml, extractCrawlLinks, crawlSite, checkLinks } from '../lib/crawl.mjs';

const site = {
  'https://ex.com/': '<html lang="en"><head><title>Home</title><meta name="description" content="d"><link rel="canonical" href="https://ex.com/"></head><body><h1>Hi</h1><img src="a.png"><img src="http://cdn.ex.com/b.png" alt=""><a href="/about">About</a><a href="/about#team">Team</a><a href="mailto:x@y.z">m</a><a href="https://other.com/x">ext</a><a href="/file.pdf">pdf</a></body></html>',
  'https://ex.com/about': '<html><head><title>About</title></head><body><h1>A</h1><h1>B</h1><a href="/">home</a><a href="/missing">gone</a><script type="application/ld+json">{"@type":"Organization"}</script></body></html>',
  'https://ex.com/missing': null,
};
const fakeHttp = {
  get: async (url, o = {}) => {
    const body = site[url];
    if (body === undefined) return { url, finalUrl: url, status: 0, ok: false, headers: {}, setCookie: [], body: null, error: 'ENOTFOUND', contentType: '', ms: 1 };
    if (body === null) return { url, finalUrl: url, status: 404, ok: false, headers: { 'content-type': 'text/html' }, setCookie: [], body: '<h1>nope</h1>', contentType: 'text/html', ms: 1 };
    return { url, finalUrl: url, status: 200, ok: true, headers: { 'content-type': 'text/html; charset=utf-8' }, setCookie: [], body: o.maxBytes === 0 ? null : body, contentType: 'text/html; charset=utf-8', ms: 1 };
  },
  head: async (url) => ({ url, finalUrl: url, status: url.includes('other.com') ? 405 : (site[url] === null ? 404 : (site[url] === undefined ? 0 : 200)), ok: true, headers: {}, setCookie: [], body: null, contentType: '', ms: 1, error: site[url] === undefined ? 'ENOTFOUND' : null }),
};

test('pageRecordFromHtml extracts SEO basics, alt-less images and mixed content', () => {
  const r = pageRecordFromHtml('https://ex.com/', 200, { 'content-type': 'text/html; charset=utf-8' }, site['https://ex.com/']);
  assert.equal(r.title, 'Home');
  assert.equal(r.h1Count, 1);
  assert.equal(r.imgCount, 2);
  assert.equal(r.imgNoAlt, 1, 'alt="" is decorative, missing alt is not');
  assert.equal(r.imgEmptyAlt, 1);
  assert.equal(r.mixedContent, 1);
  assert.equal(r.contentType, 'text/html');
  assert.equal(r.canonical, 'https://ex.com/');
  const empty = pageRecordFromHtml('https://ex.com/x.pdf', 200, { 'content-type': 'application/pdf' }, null);
  assert.equal(empty.title, null);
});

test('extractCrawlLinks resolves, dedupes and drops mailto/fragment-only links', () => {
  const links = extractCrawlLinks(site['https://ex.com/'], 'https://ex.com/');
  assert.deepEqual(links, ['https://ex.com/about', 'https://other.com/x', 'https://ex.com/file.pdf']);
});

test('crawlSite stays on host, honours maxPages and records where links were seen', async () => {
  const c = await crawlSite(fakeHttp, { startUrl: 'https://ex.com/', maxPages: 10, concurrency: 2 });
  assert.deepEqual(c.pages.map((p) => [p.url, p.status]).sort(), [['https://ex.com/', 200], ['https://ex.com/about', 200], ['https://ex.com/missing', 404]]);
  assert.equal(c.truncated, false);
  assert.ok(c.internalLinks.has('https://ex.com/file.pdf'), 'pdf recorded as a link but not crawled');
  assert.deepEqual([...c.internalLinks.get('https://ex.com/missing')], ['https://ex.com/about']);
  assert.deepEqual([...c.externalLinks.keys()], ['https://other.com/x']);
  const capped = await crawlSite(fakeHttp, { startUrl: 'https://ex.com/', maxPages: 1 });
  assert.equal(capped.pages.length, 1);
  assert.equal(capped.truncated, true);
});

test('checkLinks falls back to GET and marks blocked externals', async () => {
  const r = await checkLinks(fakeHttp, ['https://ex.com/about', 'https://ex.com/missing', 'https://other.com/x', 'https://nowhere.test/'], { external: true });
  assert.deepEqual(r.map((x) => [x.url, x.status, x.ok, x.method]), [
    ['https://ex.com/about', 200, true, 'HEAD'],
    ['https://ex.com/missing', 404, false, 'HEAD'],
    ['https://other.com/x', 0, false, 'GET'],
    ['https://nowhere.test/', 0, false, 'GET'],
  ]);
});
