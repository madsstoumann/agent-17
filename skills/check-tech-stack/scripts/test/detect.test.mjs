import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detect } from '../lib/detect.mjs';
import { SIGNATURES, CATEGORIES } from '../lib/signatures.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const find = (techs, name) => techs.find((t) => t.name === name);
const names = (techs, confidence = 'detected') => techs.filter((t) => t.confidence === confidence).map((t) => t.name);

test('signatures are well formed', () => {
  const all = new Set(SIGNATURES.map((s) => s.name));
  assert.equal(all.size, SIGNATURES.length, 'duplicate signature name');
  for (const s of SIGNATURES) {
    assert.ok(CATEGORIES[s.cat], `${s.name}: unknown category ${s.cat}`);
    for (const i of s.implies || []) assert.ok(all.has(i), `${s.name} implies unknown ${i}`);
    for (const re of [...(s.html || []), ...(s.urls || []), ...(s.assets || []), ...(s.cookies || [])]) {
      assert.ok(re instanceof RegExp || re.re instanceof RegExp, `${s.name}: pattern is not a RegExp`);
    }
  }
});

test('WordPress page: generator version, PHP implied, GTM container ID, jQuery from ?ver', () => {
  const t = detect({
    url: 'https://example.com/',
    headers: [['server', 'nginx/1.25.3'], ['x-powered-by', 'PHP/8.2.12']],
    html: fixture('wordpress.html'),
    urls: ['https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1', 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234'],
  });
  assert.equal(find(t, 'WordPress').version, '6.4.2');
  assert.equal(find(t, 'PHP').version, '8.2.12');
  assert.equal(find(t, 'Nginx').version, '1.25.3');
  assert.deepEqual(find(t, 'Google Tag Manager').ids, ['GTM-ABC1234']);
  assert.equal(find(t, 'Google Tag Manager').version, null);
  assert.ok(find(t, 'jQuery'));
  assert.ok(find(t, 'WooCommerce'));
});

test('generic words in markup do not trigger frameworks', () => {
  // The bash detector reported React, Angular and Vue for this page.
  const t = detect({ url: 'https://example.com/', html: '<p>We react fast. Our angular logo. ng-something. Vue from the hill. <div class="rating-stars"></div></p>' });
  assert.deepEqual(names(t), []);
});

test('Next.js: headers, markup and bundle give React with its version', () => {
  const t = detect({
    url: 'https://example.com/',
    headers: [['x-powered-by', 'Next.js'], ['x-vercel-id', 'arn1::abc'], ['server', 'Vercel']],
    html: '<html><body><div id="__next"></div><script src="/_next/static/chunks/main.js"></script><script>self.__next_f.push([1,""])</script></body></html>',
    urls: ['https://example.com/_next/static/chunks/main.js'],
    assets: [{ url: 'https://example.com/_next/static/chunks/main.js', body: 'x={bundleType:0,version:"19.1.0",rendererPackageName:"react-dom"}' }],
  });
  assert.ok(find(t, 'Next.js'));
  assert.equal(find(t, 'React').version, '19.1.0');
  assert.equal(find(t, 'React').confidence, 'detected');
  assert.ok(find(t, 'Vercel'));
  assert.ok(find(t, 'Node.js'));
});

test('CDN URLs give library versions through the npm field', () => {
  const t = detect({
    url: 'https://example.com/',
    urls: [
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
      'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
      'https://unpkg.com/swiper@11.0.5/swiper-bundle.min.js',
      'https://code.jquery.com/jquery-3.6.0.min.js',
    ],
  });
  assert.equal(find(t, 'Bootstrap').version, '5.3.2');
  assert.equal(find(t, 'GSAP').version, '3.12.5');
  assert.equal(find(t, 'Swiper').version, '11.0.5');
  assert.equal(find(t, 'jQuery').version, '3.6.0');
  assert.ok(find(t, 'jsDelivr') && find(t, 'cdnjs') && find(t, 'unpkg'));
});

test('jquery-ui and jquery plugins are not counted as a jQuery version', () => {
  const t = detect({ url: 'https://example.com/', urls: ['https://example.com/js/jquery-ui-1.13.2.min.js', 'https://example.com/js/jquery.validate.min.js'] });
  assert.equal(find(t, 'jQuery UI').version, '1.13.2');
  assert.equal(find(t, 'jQuery').version, null); // implied by jQuery UI, no version of its own
});

test('Umbraco: crop URLs are strong, a bare /media/ path is only possible', () => {
  const crop = detect({ url: 'https://example.com/', html: '<img src="/media/ab12cd34/hero.jpg?rxy=0.5,0.4&amp;width=800&amp;v=1d">' });
  assert.equal(find(crop, 'Umbraco').confidence, 'detected');
  assert.equal(find(crop, 'Microsoft ASP.NET').confidence, 'detected');
  const bare = detect({ url: 'https://example.com/', html: '<img src="/media/ab12cd34/hero.jpg">' });
  assert.equal(find(bare, 'Umbraco').confidence, 'possible');
  assert.equal(find(bare, 'Microsoft ASP.NET').confidence, 'possible');
});

test('cookies and globals count as evidence; IDs are kept apart from versions', () => {
  const t = detect({
    url: 'https://example.com/',
    cookies: ['__cf_bm', 'CookieConsent', '_ga', '_ga_ABC123XYZ', 'ASP.NET_SessionId'],
    globals: { 'jQuery.fn.jquery': '3.7.1', 'next.version': '15.2.0', __reactFiber: true },
    headers: [['cf-ray', '8a1b-CPH']],
  });
  assert.equal(find(t, 'jQuery').version, '3.7.1');
  assert.equal(find(t, 'Next.js').version, '15.2.0');
  assert.ok(find(t, 'React'));
  assert.ok(find(t, 'Cookiebot'));
  assert.ok(find(t, 'Cloudflare Bot Management'));
  assert.ok(find(t, 'Microsoft ASP.NET'));
  assert.equal(find(t, 'Google Analytics 4').version, null);
});

test('GitHub Pages is not reported for github.com itself', () => {
  const headers = [['server', 'GitHub.com'], ['x-github-request-id', 'AB:CD']];
  assert.ok(!find(detect({ url: 'https://github.com/', headers }), 'GitHub Pages'));
  assert.ok(find(detect({ url: 'https://someone.github.io/', headers }), 'GitHub Pages'));
});

test('every evidence list is capped and implied evidence comes last', () => {
  const t = detect({ url: 'https://example.com/', html: fixture('wordpress.html'), urls: ['https://example.com/wp-content/plugins/woocommerce/x.js'] });
  for (const x of t) assert.ok(x.evidence.length <= 4);
  const wp = find(t, 'WordPress');
  assert.ok(!wp.evidence[0].startsWith('implied'));
});
