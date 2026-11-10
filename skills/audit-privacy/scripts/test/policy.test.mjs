import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { analyse } from '../lib/analyse.mjs';
import { findChrome, launch } from '../lib/cdp.mjs';
import { openContext } from '../lib/visit.mjs';
import { policyText, subPolicies } from '../scan.mjs';

const status = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.status]));
const row = (rows, id) => rows.find((r) => r.id === id);
const para = (n) => `<p>${'Vi behandler dine personoplysninger efter databeskyttelsesforordningen. '.repeat(n)}</p>`;

// A site whose start page has no policy link; the policy is in the sitemap. /legal/privacy is a
// selector page whose real policies sit one level down.
const PAGES = {
  '/': '<html><body><main><h1>Forside</h1><p>Velkommen.</p></main></body></html>',
  '/robots.txt': 'User-agent: *\nSitemap: /sitemap-index.xml\n',
  '/sitemap-index.xml': '<?xml version="1.0"?><sitemapindex><sitemap><loc>ORIGIN/sitemap-da.xml</loc></sitemap></sitemapindex>',
  '/sitemap-da.xml': '<?xml version="1.0"?><urlset><url><loc>ORIGIN/om/kontakt</loc></url><url><loc>ORIGIN/om/privatlivspolitik</loc></url></urlset>',
  '/om/privatlivspolitik': `<html><body>
    <div id="cookie-information-template-wrapper"><p>Vi bruger cookies til statistik og markedsføring. Accepter alle eller vælg selv.</p><button>Accepter</button></div>
    <header><nav><a href="/">Forside</a> <a href="/om">Om os</a></nav></header>
    <main><h1>Privatlivspolitik</h1>${para(3)}<div id="coi-cookie-declaration"><table><tr><td>_ga_EXAMPLE</td><td>2 år</td></tr></table></div></main>
    <footer><p>Example ApS · Eksempelvej 1 · CVR 12345678</p></footer></body></html>`,
  '/legal/privacy': `<html><body><header><a href="/">Home</a></header>
    <main><h1>Privacy Policies</h1><p>Select game</p>
      <a href="/legal/privacy/game-one" aria-label="Go to Game One Privacy Policy"></a>
      <a href="/legal/privacy/game-two">Game Two Privacy Policy</a>
      <a href="/shop">Shop</a></main>
    <footer><a href="/legal/terms">Terms</a></footer></body></html>`,
};

async function withSite(fn) {
  const server = http.createServer((req, res) => {
    const origin = `http://${req.headers.host}`;
    const body = PAGES[req.url];
    if (!body) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not found</h1>'); return; }
    const type = req.url.endsWith('.xml') ? 'application/xml' : req.url.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type });
    res.end(body.replaceAll('ORIGIN', origin));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await launch({});
  try { await fn(b, origin); } finally { await b.close(); server.close(); }
}

const chrome = Boolean(findChrome({}));

test('policyText leaves out the consent banner, the site header and navigation, and the footer', { skip: !chrome && 'no Chrome' }, async () => {
  await withSite(async (b, origin) => {
    const p = await openContext(b, {});
    try {
      await p.goto(`${origin}/om/privatlivspolitik`, { extraWait: 100 });
      const text = await policyText(p);
      assert.match(text, /^Privatlivspolitik/);
      assert.match(text, /databeskyttelsesforordningen/);
      assert.match(text, /_ga_EXAMPLE/, 'a cookie declaration embedded in the policy stays');
      assert.doesNotMatch(text, /Accepter|statistik og markedsføring|Om os|CVR/);
    } finally { await p.close(); }
  });
});

test('a selector page: its links to the policies under it, one level, the site chrome left out', { skip: !chrome && 'no Chrome' }, async () => {
  await withSite(async (b, origin) => {
    const p = await openContext(b, {});
    try {
      await p.goto(`${origin}/legal/privacy`, { extraWait: 100 });
      const out = {};
      await policyText(p, out);
      assert.deepEqual(out.links.map((l) => [l.href.replace(origin, ''), l.child]), [['/legal/privacy/game-one', true], ['/legal/privacy/game-two', true]]);
      assert.equal(out.links[0].text, 'Go to Game One Privacy Policy');
    } finally { await p.close(); }
  });
});

test('findPolicies: a policy the start page does not link to is found through the sitemap', { skip: !chrome && 'no Chrome' }, async () => {
  await withSite(async (b, origin) => {
    const p = await openContext(b, {});
    try {
      await p.goto(`${origin}/`, { extraWait: 100 });
      assert.deepEqual(await p.findPolicies(), [{ text: '', href: `${origin}/om/privatlivspolitik`, via: 'sitemap' }]);
    } finally { await p.close(); }
  });
});

test('subPolicies: pages under the selector first, at most three, none read twice', () => {
  const links = [
    { href: 'https://example.com/privacy-faq', child: false },
    { href: 'https://example.com/legal/privacy/a', child: true },
    { href: 'https://example.com/legal/privacy/b', child: true },
    { href: 'https://example.com/legal/privacy/c', child: true },
  ];
  assert.deepEqual(subPolicies(links).map((l) => l.href.slice(-1)), ['a', 'b', 'c']);
  assert.deepEqual(subPolicies(links, new Set(['https://example.com/legal/privacy/a'])).map((l) => l.href.split('/').pop()), ['b', 'c', 'privacy-faq']);
});

const base = (policies, policyLinks = [{ text: 'Privacy', href: 'https://example.com/legal/privacy' }]) => ({
  url: 'https://example.com/', host: 'example.com', reject: null, accept: null, policies,
  first: { requests: [], cookies: [], facts: { policyLinks }, banner: { found: false, accept: [], reject: [], settings: [] }, pages: [] },
});
const long = 'Vi behandler personoplysninger. '.repeat(150);

test('analyse: a thin privacy policy warns; a selector page whose linked policies were read is info', () => {
  const thin = analyse(base([{ url: 'https://example.com/legal/privacy', ok: true, text: 'Privacy Policies. Select game.', words: 21 }]));
  assert.equal(status(thin)['policy.privacy'], 'pass');
  assert.equal(status(thin)['policy.thin'], 'warn');
  assert.match(row(thin, 'policy.thin').evidence, /21 words once the consent banner, navigation and footer are left out/);
  const selector = analyse(base([
    { url: 'https://example.com/legal/privacy', ok: true, text: 'Select game', words: 21 },
    { url: 'https://example.com/legal/privacy/game-one', ok: true, text: long, words: 600, parent: 'https://example.com/legal/privacy' },
  ]));
  assert.equal(status(selector)['policy.thin'], 'info');
  const deeper = analyse(base([
    { url: 'https://example.com/legal/privacy', ok: true, text: 'Select game', words: 21 },
    { url: 'https://example.com/legal/privacy/game-one', ok: true, text: 'Select language', words: 40, parent: 'https://example.com/legal/privacy', links: ['https://example.com/legal/privacy/game-one/en'] },
  ]));
  assert.equal(status(deeper)['policy.thin'], 'warn');
  assert.match(row(deeper, 'policy.thin').evidence, /may be under https:\/\/example\.com\/legal\/privacy\/game-one\/en/);
  // A full policy and a short cookie page: no thin row.
  const fine = analyse(base([{ url: 'https://example.com/privacy', ok: true, text: long, words: 600 }, { url: 'https://example.com/cookies', ok: true, text: 'Cookies', words: 50 }]));
  assert.equal(status(fine)['policy.thin'], undefined);
});

test('analyse: no link on the start page still fails, and says where the policy was found and read', () => {
  const rows = analyse(base([{ url: 'https://example.com/om/privatlivspolitik', ok: true, text: long, words: 600, via: 'sitemap' }], []));
  assert.equal(status(rows)['policy.privacy'], 'fail');
  assert.match(row(rows, 'policy.privacy').evidence, /no link to a privacy or cookie policy on the start page; found https:\/\/example\.com\/om\/privatlivspolitik through the sitemap and read it/);
  const none = analyse(base([], []));
  assert.equal(row(none, 'policy.privacy').evidence, 'no link to a privacy or cookie policy on the start page');
});
