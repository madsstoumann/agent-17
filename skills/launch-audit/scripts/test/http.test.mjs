import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateHost, isPrivateAddress, normaliseUrl, sameUrlModuloSlash, sameHost,
  pLimit, withTimeout, headersToObject, stripWww, siblingHost,
} from '../lib/http.mjs';

test('isPrivateHost recognises loopback, private names and RFC1918 literals', () => {
  for (const h of ['localhost', 'LOCALHOST', 'app.localhost', 'foo.local', 'api.internal', 'x.test', 'site.example', 'x.invalid', 'a.home.arpa', 'box.lan', 'intranet',
    '127.0.0.1', '127.5.5.5', '10.1.2.3', '172.16.0.1', '172.20.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', '[::1]', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ['dev.example.com', 'browser.style', 'akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app', '8.8.8.8', '172.32.0.1', '172.15.0.1', '2606:4700::1111', 'localhost.example.com']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('isPrivateAddress handles v4 and v6 literals only', () => {
  assert.equal(isPrivateAddress('192.168.0.5'), true);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
  assert.equal(isPrivateAddress('not-an-ip'), false);
});

test('normaliseUrl adds https, keeps path and query, strips credentials and hash', () => {
  assert.equal(normaliseUrl('example.com'), 'https://example.com/');
  assert.equal(normaliseUrl('example.com/a?b=1#c'), 'https://example.com/a?b=1');
  assert.equal(normaliseUrl('http://user:pw@example.com/x'), 'http://example.com/x');
  assert.equal(normaliseUrl('HTTPS://Example.COM'), 'https://example.com/');
  assert.equal(normaliseUrl('https://localhost:44380'), 'https://localhost:44380/');
  assert.throws(() => normaliseUrl('not a url at all'));
  assert.throws(() => normaliseUrl('ftp://example.com'));
});

test('sameUrlModuloSlash ignores trailing slash, case of host, default port and hash', () => {
  assert.equal(sameUrlModuloSlash('https://Example.com', 'https://example.com/'), true);
  assert.equal(sameUrlModuloSlash('https://example.com:443/a/', 'https://example.com/a#x'), true);
  assert.equal(sameUrlModuloSlash('https://example.com/a', 'https://example.com/b'), false);
  assert.equal(sameUrlModuloSlash('https://example.com/a?x=1', 'https://example.com/a'), false);
  assert.equal(sameUrlModuloSlash('http://example.com/', 'https://example.com/'), false);
  assert.equal(sameUrlModuloSlash('garbage', 'https://example.com/'), false);
});

test('sameHost, stripWww, siblingHost', () => {
  assert.equal(sameHost('https://www.example.com/a', 'HTTPS://WWW.example.com/b'), true);
  assert.equal(sameHost('https://www.example.com/a', 'https://example.com/b'), false);
  assert.equal(stripWww('www.example.com'), 'example.com');
  assert.equal(stripWww('example.com'), 'example.com');
  assert.equal(siblingHost('www.example.com'), 'example.com');
  assert.equal(siblingHost('example.com'), 'www.example.com');
  assert.equal(siblingHost('dev.example.com'), null, 'a deep subdomain has no www sibling');
  assert.equal(siblingHost('localhost'), null);
});

test('pLimit caps concurrency and preserves results', async () => {
  const limit = pLimit(2);
  let running = 0, peak = 0;
  const job = (n) => limit(async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 10));
    running--; return n * 2;
  });
  const results = await Promise.all([1, 2, 3, 4, 5].map(job));
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test('withTimeout rejects with a labelled error and lets fast promises through', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'fast'), 'ok');
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 200)), 20, 'slow thing'), /slow thing timed out after 20 ms/);
});

test('headersToObject lowercases and joins repeated headers, keeps set-cookie apart', () => {
  const h = new Headers();
  h.append('Content-Type', 'text/html');
  h.append('Set-Cookie', 'a=1; Path=/');
  h.append('Set-Cookie', 'b=2; Secure');
  h.append('Vary', 'Accept');
  const { headers, setCookie } = headersToObject(h);
  assert.equal(headers['content-type'], 'text/html');
  assert.equal(headers.vary, 'Accept');
  assert.deepEqual(setCookie, ['a=1; Path=/', 'b=2; Secure']);
  assert.equal('set-cookie' in headers, false);
});

test('post sends the body and is never retried', async () => {
  const { createHttp } = await import('../lib/http.mjs');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }); };
  try {
    const http = createHttp({ timeout: 1000 });
    const r = await http.post('https://example.test/v', { body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, 'a=1');
    assert.equal(calls[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(calls[0].init.headers['x-audit'].startsWith('launch-audit/'), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
