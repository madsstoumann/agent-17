import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followChain, classifyChain, buildRedirectMatrix } from '../lib/redirects.mjs';

/**
 * A fake http: answers from a table of url -> { status, headers }. Unknown URLs are
 * a network failure (status 0). Every answer is deferred a tick so concurrency shows
 * in the call log.
 */
function fakeHttp(table) {
  const calls = [];
  return {
    calls,
    async request(url, opts = {}) {
      calls.push({ url, opts });
      await new Promise((r) => setImmediate(r));
      const row = table[url];
      if (!row) {
        return { url, finalUrl: url, status: 0, ok: false, headers: {}, setCookie: [], body: null, bytes: 0, truncated: false, contentType: '', ms: 1, redirected: false, error: 'ENOTFOUND: getaddrinfo ENOTFOUND' };
      }
      return { url, finalUrl: url, status: row.status, ok: row.status >= 200 && row.status < 300, headers: row.headers || {}, setCookie: [], body: null, bytes: 0, truncated: false, contentType: '', ms: 1, redirected: false };
    },
  };
}

const HSTS = { 'strict-transport-security': 'max-age=31536000' };

// ---------------------------------------------------------------- followChain

test('followChain: a single 301 from http to https, fetched as a manual GET with no body', async () => {
  const http = fakeHttp({
    'http://example.com/': { status: 301, headers: { location: 'https://example.com/' } },
    'https://example.com/': { status: 200, headers: HSTS },
  });
  const r = await followChain(http, 'http://example.com/');
  assert.deepEqual(r, {
    start: 'http://example.com/',
    chain: [
      { url: 'http://example.com/', status: 301, location: 'https://example.com/', hsts: false },
      { url: 'https://example.com/', status: 200, location: null, hsts: true },
    ],
    final: 'https://example.com/',
    finalStatus: 200,
    loop: false,
    tooMany: false,
    error: null,
  });
  assert.equal(http.calls.length, 2);
  for (const { opts } of http.calls) {
    assert.equal(opts.redirect, 'manual');
    assert.equal(opts.maxBytes, 0);
    assert.ok(!opts.method || opts.method === 'GET', 'GET, never HEAD');
  }
});

test('followChain: a relative Location is resolved against the current URL', async () => {
  const http = fakeHttp({
    'https://example.com/a': { status: 302, headers: { location: '/b' } },
    'https://example.com/b': { status: 302, headers: { location: 'c/' } },
    'https://example.com/c/': { status: 200, headers: {} },
  });
  const r = await followChain(http, 'https://example.com/a');
  assert.deepEqual(r.chain.map((h) => [h.status, h.location]), [[302, 'https://example.com/b'], [302, 'https://example.com/c/'], [200, null]]);
  assert.equal(r.final, 'https://example.com/c/');
  assert.equal(r.error, null);
});

test('followChain: a loop is detected and the chain is cut', async () => {
  const http = fakeHttp({
    'https://a.example/': { status: 301, headers: { location: 'https://b.example/' } },
    'https://b.example/': { status: 302, headers: { location: 'https://a.example/' } },
  });
  const r = await followChain(http, 'https://a.example/');
  assert.equal(r.loop, true);
  assert.equal(r.tooMany, false);
  assert.equal(r.error, null);
  assert.equal(r.chain.length, 2);
  assert.equal(r.final, 'https://a.example/', 'the URL it was about to revisit');
  assert.equal(r.finalStatus, 302, 'the status of the last response');
  assert.equal(http.calls.length, 2);
});

test('followChain: a 3xx without Location is an error', async () => {
  const http = fakeHttp({ 'https://example.com/': { status: 301, headers: {} } });
  const r = await followChain(http, 'https://example.com/');
  assert.match(r.error, /Location/);
  assert.equal(r.final, 'https://example.com/');
  assert.equal(r.finalStatus, 301);
  assert.equal(r.chain.length, 1);
  assert.equal(r.chain[0].location, null);
});

test('followChain: an unparseable Location is an error', async () => {
  const http = fakeHttp({ 'https://example.com/': { status: 302, headers: { location: 'http://' } } });
  const r = await followChain(http, 'https://example.com/');
  assert.match(r.error, /Location/);
  assert.equal(r.finalStatus, 302);
});

test('followChain: a network failure carries the http error and stops', async () => {
  const http = fakeHttp({ 'https://example.com/': { status: 307, headers: { location: 'https://gone.example/' } } });
  const r = await followChain(http, 'https://example.com/');
  assert.equal(r.finalStatus, 0);
  assert.equal(r.final, null, 'nothing answered, so the chain landed nowhere');
  assert.match(r.error, /ENOTFOUND/);
  assert.equal(r.chain.length, 2);
  assert.equal(r.chain[1].status, 0);
  assert.equal(r.chain[1].hsts, false);
  assert.match(r.chain[1].error, /ENOTFOUND/);
});

test('followChain: stops at maxHops with tooMany', async () => {
  const table = {};
  for (let i = 0; i < 6; i++) table[`https://example.com/${i}`] = { status: 301, headers: { location: `https://example.com/${i + 1}` } };
  table['https://example.com/6'] = { status: 200, headers: {} };
  const ok = await followChain(fakeHttp(table), 'https://example.com/0', { maxHops: 6 });
  assert.equal(ok.tooMany, false);
  assert.equal(ok.finalStatus, 200);
  const http = fakeHttp(table);
  const r = await followChain(http, 'https://example.com/0', { maxHops: 3 });
  assert.equal(r.tooMany, true);
  assert.equal(r.loop, false);
  assert.equal(r.error, null);
  assert.equal(r.chain.length, 4, 'the fourth redirect is one too many; its target is not fetched');
  assert.equal(r.final, 'https://example.com/4');
  assert.equal(r.finalStatus, 301);
  assert.equal(http.calls.length, 4);
});

test('followChain: an invalid start URL never throws', async () => {
  const http = fakeHttp({});
  const r = await followChain(http, 'not a url');
  assert.equal(r.start, 'not a url');
  assert.deepEqual(r.chain, []);
  assert.equal(r.final, null);
  assert.equal(r.finalStatus, 0);
  assert.match(r.error, /URL/i);
  assert.equal(http.calls.length, 0);
});

// ---------------------------------------------------------------- classifyChain

test('classifyChain: single permanent hop http to https', async () => {
  const http = fakeHttp({
    'http://example.com/': { status: 301, headers: { location: 'https://example.com/' } },
    'https://example.com/': { status: 200, headers: HSTS },
  });
  const c = classifyChain(await followChain(http, 'http://example.com/'));
  assert.deepEqual(c, {
    start: 'http://example.com/', final: 'https://example.com/', finalStatus: 200,
    hops: 1, codes: [301, 200], singleHop: true, allPermanent: true, httpToHttps: true,
    loop: false, tooMany: false, error: null, hstsOnHttps: true, reachedOk: true,
  });
});

test('classifyChain: a 302 chain is neither single nor permanent', async () => {
  const http = fakeHttp({
    'https://example.com/old': { status: 302, headers: { location: 'https://example.com/mid', ...HSTS } },
    'https://example.com/mid': { status: 302, headers: { location: 'https://example.com/new', ...HSTS } },
    'https://example.com/new': { status: 200, headers: HSTS },
  });
  const c = classifyChain(await followChain(http, 'https://example.com/old'));
  assert.equal(c.hops, 2);
  assert.deepEqual(c.codes, [302, 302, 200]);
  assert.equal(c.singleHop, false);
  assert.equal(c.allPermanent, false);
  assert.equal(c.httpToHttps, false);
  assert.equal(c.hstsOnHttps, true);
  assert.equal(c.reachedOk, true);
});

test('classifyChain: three hops apex -> www -> trailing slash; HSTS missing on one https hop', async () => {
  const http = fakeHttp({
    'http://example.com/about': { status: 301, headers: { location: 'https://example.com/about' } },
    'https://example.com/about': { status: 308, headers: { location: 'https://www.example.com/about' } },
    'https://www.example.com/about': { status: 301, headers: { location: '/about/', ...HSTS } },
    'https://www.example.com/about/': { status: 200, headers: HSTS },
  });
  const c = classifyChain(await followChain(http, 'http://example.com/about'));
  assert.equal(c.hops, 3);
  assert.deepEqual(c.codes, [301, 308, 301, 200]);
  assert.equal(c.final, 'https://www.example.com/about/');
  assert.equal(c.singleHop, false);
  assert.equal(c.allPermanent, true);
  assert.equal(c.httpToHttps, true);
  assert.equal(c.hstsOnHttps, false, 'https://example.com/about answered without HSTS');
  assert.equal(c.reachedOk, true);
});

test('classifyChain: loop, missing Location and network error are never ok', async () => {
  const loop = classifyChain(await followChain(fakeHttp({
    'https://a.example/': { status: 301, headers: { location: 'https://b.example/' } },
    'https://b.example/': { status: 301, headers: { location: 'https://a.example/' } },
  }), 'https://a.example/'));
  assert.equal(loop.loop, true);
  assert.equal(loop.hops, 2);
  assert.equal(loop.reachedOk, false);
  assert.equal(loop.allPermanent, true);

  const noLoc = classifyChain(await followChain(fakeHttp({ 'https://x.example/': { status: 301, headers: {} } }), 'https://x.example/'));
  assert.match(noLoc.error, /Location/);
  assert.equal(noLoc.hops, 0);
  assert.deepEqual(noLoc.codes, [301]);
  assert.equal(noLoc.reachedOk, false);

  const dead = classifyChain(await followChain(fakeHttp({}), 'http://dead.example/'));
  assert.match(dead.error, /ENOTFOUND/);
  assert.deepEqual(dead.codes, [0]);
  assert.equal(dead.finalStatus, 0);
  assert.equal(dead.reachedOk, false);
  assert.equal(dead.hstsOnHttps, null, 'no https response at all');
  assert.equal(dead.httpToHttps, false);
});

test('classifyChain: a direct 200 has no hops and HSTS null on plain http', async () => {
  const c = classifyChain(await followChain(fakeHttp({ 'http://example.com/': { status: 200, headers: {} } }), 'http://example.com/'));
  assert.equal(c.hops, 0);
  assert.equal(c.singleHop, false);
  assert.equal(c.allPermanent, true, 'vacuously: nothing was temporary');
  assert.equal(c.hstsOnHttps, null);
  assert.equal(c.reachedOk, true);
});

// ---------------------------------------------------------------- buildRedirectMatrix

test('buildRedirectMatrix: four variants, run concurrently, each classified', async () => {
  const http = fakeHttp({
    'http://example.com/': { status: 301, headers: { location: 'https://www.example.com/' } },
    'https://example.com/': { status: 301, headers: { location: 'https://www.example.com/', ...HSTS } },
    'http://www.example.com/': { status: 301, headers: { location: 'https://www.example.com/' } },
    'https://www.example.com/': { status: 200, headers: HSTS },
  });
  const rows = await buildRedirectMatrix(http, { host: 'www.example.com' });
  assert.deepEqual(rows.map((r) => r.variant), ['http-apex', 'https-apex', 'http-www', 'https-www']);
  assert.deepEqual(rows.map((r) => r.start), ['http://example.com/', 'https://example.com/', 'http://www.example.com/', 'https://www.example.com/']);
  for (const r of rows) {
    assert.equal(r.final, 'https://www.example.com/');
    assert.equal(r.reachedOk, true);
    assert.equal(r.allPermanent, true);
  }
  assert.deepEqual(rows.map((r) => r.hops), [1, 1, 1, 0]);
  assert.equal(rows[0].httpToHttps, true);
  assert.equal(rows[1].hstsOnHttps, true);
  assert.deepEqual(http.calls.slice(0, 4).map((c) => c.url), rows.map((r) => r.start), 'all four starts were issued before any follow-up');
});

test('buildRedirectMatrix: an apex host yields the same four variants; a path is honoured', async () => {
  const http = fakeHttp({ 'https://example.com/shop': { status: 200, headers: {} } });
  const rows = await buildRedirectMatrix(http, { host: 'example.com', path: '/shop' });
  assert.deepEqual(rows.map((r) => [r.variant, r.start]), [
    ['http-apex', 'http://example.com/shop'], ['https-apex', 'https://example.com/shop'],
    ['http-www', 'http://www.example.com/shop'], ['https-www', 'https://www.example.com/shop'],
  ]);
  assert.equal(rows[1].reachedOk, true);
  assert.equal(rows[0].finalStatus, 0);
  assert.match(rows[0].error, /ENOTFOUND/);
});

test('buildRedirectMatrix: a deep subdomain has no www sibling, so only its own two variants', async () => {
  const http = fakeHttp({
    'http://dev.example.com/': { status: 301, headers: { location: 'https://dev.example.com/' } },
    'https://dev.example.com/': { status: 200, headers: HSTS },
  });
  const rows = await buildRedirectMatrix(http, { host: 'dev.example.com' });
  assert.deepEqual(rows.map((r) => [r.variant, r.start, r.reachedOk]), [
    ['http-apex', 'http://dev.example.com/', true], ['https-apex', 'https://dev.example.com/', true],
  ]);
});
