import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageUrls, metaTags, title, siteOf, sameSite } from '../lib/page.mjs';
import { markdown, siteLine } from '../lib/report.mjs';
import { detect } from '../lib/detect.mjs';

test('pageUrls resolves scripts, styles and preloads against the final URL', () => {
  const html = `<script src="/a.js"></script><script async src='https://cdn.x.net/b.js'></script>
    <link rel="stylesheet" href="css/site.css"><link rel="modulepreload" href="/m.js"><link rel="preload" as="style" href="/p.css">
    <link rel="icon" href="/favicon.ico"><iframe src="https://www.youtube.com/embed/x"></iframe><script>inline()</script>`;
  const u = pageUrls(html, 'https://example.com/dk/');
  assert.deepEqual(u.scripts, ['https://example.com/a.js', 'https://cdn.x.net/b.js', 'https://example.com/m.js']);
  assert.deepEqual(u.styles, ['https://example.com/dk/css/site.css', 'https://example.com/p.css']);
  assert.deepEqual(u.other, ['https://example.com/favicon.ico', 'https://www.youtube.com/embed/x']);
});

test('metaTags and title decode entities', () => {
  const html = '<title>A &amp; B</title><meta name="Generator" content="Umbraco 13"><meta property="og:title" content="X">';
  assert.deepEqual(metaTags(html), { generator: ['Umbraco 13'], 'og:title': ['X'] });
  assert.equal(title(html), 'A & B');
});

test('siteOf groups subdomains, including second-level country domains', () => {
  assert.equal(siteOf('static.example.com'), 'example.com');
  assert.equal(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.ok(sameSite('https://cdn.example.com/x.js', 'https://www.example.com/'));
  assert.ok(!sameSite('https://example.net/x.js', 'https://www.example.com/'));
});

const site = (url, techInput) => ({
  url, finalUrl: url, status: 200, redirects: [], title: 'T', assetStats: { scripts: 1, styles: 1, sameSite: 1, fetched: 1 }, browser: false, errors: [],
  technologies: detect({ url, ...techInput }),
});

test('single-site report lists detected and possible technologies', () => {
  const r = site('https://a.example/', { headers: [['server', 'nginx']], html: '<img src="/media/ab12cd34/x.jpg">' });
  const md = markdown([r], { generatedAt: '2026-10-29T00:00:00Z', version: '1.0.0' });
  assert.match(md, /^# Tech stack: a\.example/);
  assert.match(md, /\| Web server \| Nginx \|/);
  assert.match(md, /Possible \(weak evidence only/);
  assert.match(md, /- Umbraco \(CMS\)/);
  assert.doesNotMatch(md, /## Comparison/);
});

test('batch report has a comparison matrix and usage counts, and keeps failed sites', () => {
  const a = site('https://a.example/', { headers: [['server', 'nginx'], ['cf-ray', '1']] });
  const b = site('https://b.example/', { headers: [['cf-ray', '2']], urls: ['https://consent.cookiebot.com/uc.js'] });
  const c = { url: 'https://c.example/', error: 'ENOTFOUND', technologies: [] };
  const md = markdown([a, b, c]);
  assert.match(md, /# Tech stack: 3 sites/);
  assert.match(md, /\| a\.example \|/);
  assert.match(md, /\| CDN \| Cloudflare \| 2\/2 \|/);
  assert.match(md, /failed: ENOTFOUND/);
  assert.match(siteLine(b), /Hosting \/ CDN: Cloudflare · Consent: Cookiebot/);
  assert.match(siteLine(c), /failed \(ENOTFOUND\)/);
});

test('challenge pages are recognised and flagged in the report', async () => {
  const { challengeReason } = await import('../lib/page.mjs');
  assert.match(challengeReason(200, '<title>Client Challenge</title><link href="/_fs-ch-1T1w/assets/styles.css">'), /Client Challenge/);
  assert.match(challengeReason(403, '<p>nope</p>'), /HTTP 403/);
  assert.equal(challengeReason(200, '<title>Home</title>'), null);
  const r = { ...site('https://d.example/', {}), challenge: 'HTTP 403, likely bot protection' };
  assert.match(markdown([r]), /\*\*Blocked:\*\*/);
  const ok = site('https://e.example/', { headers: [['server', 'nginx']] });
  const batch = markdown([ok, { ...r, technologies: detect({ url: r.url, headers: [['server', 'nginx']] }) }]);
  assert.match(batch, /\| d\.example \(blocked\) \|/);
  assert.match(batch, /\| Web server \| Nginx \| 1\/1 \| e\.example \|/);
  assert.match(siteLine(r), /\(200, HTTP 403, likely bot protection\)/);
});
