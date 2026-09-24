import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeEntities, stripTags, parseAttrs, tokenize, extractMeta, extractLinks, extractAssets, findMixedContent, extractHosts,
} from '../lib/html.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/html/${name}`, import.meta.url), 'utf8');
const IOI_URL = 'https://akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app/';
const ioi = fixture('ioi-like.html');
const multi = fixture('multilang.html');

// ---------------------------------------------------------------- primitives

test('decodeEntities handles named, decimal and hex references and leaves unknown ones alone', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos;'), 'a & b <c> "d" \'e\' \'f\'');
  assert.equal(decodeEntities('x&nbsp;y &copy; &ndash; &mdash; &hellip;'), 'x y © – — …');
  assert.equal(decodeEntities('&#65;&#x42;&#X43;&#8211;'), 'ABC–');
  assert.equal(decodeEntities('&euro; &eacute; &rsquo;'), '€ é ’');
  assert.equal(decodeEntities('&bogus; &#; plain'), '&bogus; &#; plain');
  assert.equal(decodeEntities(''), '');
  assert.equal(decodeEntities(null), '');
});

test('stripTags removes markup, decodes entities and collapses whitespace', () => {
  assert.equal(stripTags('<p>Hello <b>big</b>\n\n  world &amp; <br/>friends</p>'), 'Hello big world & friends');
  assert.equal(stripTags('  <span>x</span>  '), 'x');
  assert.equal(stripTags(''), '');
});

test('parseAttrs reads every quoting style, lowercases keys and decodes values', () => {
  const a = parseAttrs(`NAME="robots" content='noindex, nofollow' data-x=unquoted disabled title="a &amp; b" empty=""`);
  assert.deepEqual(a, { name: 'robots', content: 'noindex, nofollow', 'data-x': 'unquoted', disabled: '', title: 'a & b', empty: '' });
  assert.deepEqual(parseAttrs(''), {});
  assert.deepEqual(parseAttrs(' crossorigin '), { crossorigin: '' });
  assert.deepEqual(parseAttrs(`href=/a/b?c=1&amp;d=2`), { href: '/a/b?c=1&d=2' });
});

test('tokenize yields lowercase start tags with attrs, skips comments and script/style bodies', () => {
  const toks = tokenize(`<!-- <meta name="x"> --><META name="a" content="1"><script>var s = "<meta name='b'>";</script><style>a{}</style><title>T &amp; U</title><script type="application/ld+json" id="x">{"@type":"Thing"}</script><div>`);
  assert.deepEqual(toks.map((t) => t.tag), ['meta', 'script', 'style', 'title', 'script', 'div']);
  assert.equal(toks[0].attrs.name, 'a');
  assert.equal(toks[0].raw, '<META name="a" content="1">');
  assert.equal(typeof toks[0].index, 'number');
  assert.equal(toks[1].content, undefined, 'a plain script has no content');
  assert.equal(toks[3].content, 'T &amp; U', 'title content is raw');
  assert.equal(toks[4].content, '{"@type":"Thing"}', 'ld+json content is kept');
  assert.equal(toks.some((t) => t.attrs.name === 'b'), false, 'a tag inside a script is not a tag');
  assert.equal(toks.some((t) => t.attrs.name === 'x'), false, 'a tag inside a comment is not a tag');
});

test('tokenize treats the ld+json type case-insensitively and with other attrs first', () => {
  const toks = tokenize(`<script async type="Application/LD+JSON">[]</script><script data-a="1" type='application/ld+json'>{}</script>`);
  assert.equal(toks[0].content, '[]');
  assert.equal(toks[1].content, '{}');
});

// ---------------------------------------------------------------- extractMeta

test('extractMeta on the ioi-like page', () => {
  const m = extractMeta(ioi, IOI_URL);
  assert.equal(m.title, 'IO Interactive – Home');
  assert.equal(m.description, 'IO Interactive is the independent studio behind HITMAN & Project 007.');
  assert.equal(m.robots, 'noindex, nofollow', 'meta name is matched case-insensitively');
  assert.equal(m.googlebot, null);
  assert.equal(m.canonical, 'https://akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app/', 'absolute; the URL class adds the root slash');
  assert.equal(m.lang, 'en');
  assert.equal(m.viewport, 'width=device-width, initial-scale=1');
  assert.equal(m.charset, 'utf-8');
  assert.equal(m.base, null);
  assert.equal(m.themeColor, '#000000');
  assert.equal(m.generator, 'Nuxt');
  assert.equal(m.h1Count, 1);
  assert.deepEqual(m.h1s, ['We make worlds & assassins']);
  assert.deepEqual(m.hreflang, []);
  assert.deepEqual(m.og, {
    title: 'IO Interactive',
    description: 'The studio behind HITMAN & Project 007.',
    type: 'website',
    site_name: 'IO Interactive',
    locale: 'en_US',
    url: 'https://akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app/',
    image: 'https://images.ctfassets.net/abc123/og.jpg',
  });
  assert.deepEqual(m.twitter, {
    card: 'summary_large_image',
    title: 'IO Interactive',
    description: 'The studio behind HITMAN & Project 007.',
    image: 'https://images.ctfassets.net/abc123/twitter.jpg',
  });
  assert.deepEqual(m.icons, [
    { rel: 'icon', href: `${IOI_URL}favicon.ico`, sizes: '32x32', type: null },
    { rel: 'icon', href: `${IOI_URL}favicon.svg`, sizes: null, type: 'image/svg+xml' },
    { rel: 'icon', href: `${IOI_URL}favicon-192.png`, sizes: '192x192', type: 'image/png' },
    { rel: 'apple-touch-icon', href: `${IOI_URL}apple-touch-icon.png`, sizes: '180x180', type: null },
  ]);
  assert.equal(m.manifest, `${IOI_URL}site.webmanifest`);
  assert.equal(m.jsonLd.length, 1);
  assert.deepEqual(m.jsonLd[0].types, ['WebSite']);
  assert.equal(m.jsonLd[0].data.name, 'IO Interactive');
  assert.equal(m.jsonLd[0].error, null);
  assert.equal(typeof m.jsonLd[0].raw, 'string');
});

test('extractMeta on the multilang page: base href, hreflang, two h1, @graph, broken JSON-LD, script text ignored', () => {
  const m = extractMeta(multi, 'https://www.example.com/somewhere/else.html');
  assert.equal(m.title, 'Multilang & friends', 'title whitespace collapsed');
  assert.equal(m.lang, 'da');
  assert.equal(m.charset, 'ISO-8859-1', 'from http-equiv content-type');
  assert.equal(m.base, 'https://www.example.com/sub/');
  assert.equal(m.description, 'Unquoted');
  assert.equal(m.robots, null, 'the robots meta inside the script body is a string, not a tag');
  assert.equal(m.googlebot, 'max-snippet:-1, max-image-preview:large');
  assert.equal(m.canonical, null);
  assert.equal(m.viewport, null);
  assert.equal(m.themeColor, null);
  assert.equal(m.generator, null);
  assert.equal(m.manifest, null);
  assert.equal(m.h1Count, 2);
  assert.deepEqual(m.h1s, ['First heading', 'Second "heading"'], 'not the fake heading inside the script');
  assert.deepEqual(m.hreflang, [
    { lang: 'en', href: 'https://www.example.com/sub/en/' },
    { lang: 'da', href: 'https://www.example.com/sub/da/' },
    { lang: 'x-default', href: 'https://www.example.com/' },
  ]);
  assert.deepEqual(m.og, {});
  assert.deepEqual(m.twitter, {});
  assert.deepEqual(m.icons, [{ rel: 'icon', href: 'https://www.example.com/sub/icon.png', sizes: null, type: null }]);
  assert.equal(m.jsonLd.length, 2);
  assert.deepEqual(m.jsonLd[0].types, ['Organization', 'WebSite', 'CreativeWork'], '@graph flattened, arrays flattened, unique');
  assert.equal(m.jsonLd[0].error, null);
  assert.deepEqual(m.jsonLd[1].types, []);
  assert.equal(m.jsonLd[1].data, null);
  assert.match(m.jsonLd[1].error, /JSON/i);
});

test('extractMeta caps h1s at three while counting them all, and returns empty shapes for empty input', () => {
  const m = extractMeta('<h1>a</h1><h1>b</h1><h1>c</h1><h1>d</h1>', 'https://x.example/');
  assert.equal(m.h1Count, 4);
  assert.deepEqual(m.h1s, ['a', 'b', 'c']);
  const e = extractMeta('', 'https://x.example/');
  assert.equal(e.title, null);
  assert.deepEqual(e.hreflang, []);
  assert.deepEqual(e.og, {});
  assert.deepEqual(e.icons, []);
  assert.deepEqual(e.jsonLd, []);
});

test('extractMeta takes the head title, never an inline SVG title in the body', () => {
  assert.equal(extractMeta('<html><head></head><body><svg><title>Icon</title></svg></body></html>', 'https://x.example/').title, null);
  assert.equal(extractMeta('<title>Real</title><body><svg><title>Icon</title></svg>', 'https://x.example/').title, 'Real');
  assert.equal(extractMeta('<title></title><title>Second</title>', 'https://x.example/').title, '', 'an empty first title stays empty');
});

// ---------------------------------------------------------------- links

test('extractLinks resolves, strips fragments, dedupes and drops non-http schemes', () => {
  const links = extractLinks(ioi, IOI_URL);
  const hrefs = links.map((l) => l.href);
  assert.deepEqual(hrefs, [
    IOI_URL,
    `${IOI_URL}hitman/`,
    `${IOI_URL}careers?team=engineering`,
    'https://www.youtube.com/@ioi',
  ], 'mailto, #main and the /hitman/#trailer duplicate are gone');
  const yt = links.find((l) => l.href.includes('youtube'));
  assert.equal(yt.text, 'YouTube');
  assert.equal(yt.rel, 'nofollow noopener');
  assert.equal(yt.nofollow, true);
  assert.equal(links[0].nofollow, false);
  assert.equal(links[0].rel, null);
  assert.equal(links[1].text, 'Hitman');
});

test('extractLinks honours <base href> and skips javascript:, tel:, data:', () => {
  const links = extractLinks(multi, 'https://www.example.com/');
  assert.deepEqual(links.map((l) => l.href), [
    'http://www.example.com/insecure-link/',
    'https://www.example.com/sub/sub-page/',
    'https://www.example.com/root-page/',
  ]);
  assert.equal(links[1].nofollow, true, 'the first occurrence of a deduped href wins');
});

// ---------------------------------------------------------------- assets

test('extractAssets on the ioi-like page', () => {
  const a = extractAssets(ioi, IOI_URL);
  assert.deepEqual(a.scripts, [`${IOI_URL}_nuxt/entry.js`]);
  assert.deepEqual(a.styles, [`${IOI_URL}_nuxt/entry.css`]);
  assert.deepEqual(a.images, [
    'http://cdn.example.com/x.png',
    `${IOI_URL}_nuxt/hero.webp`, `${IOI_URL}_nuxt/hero-480.webp`, `${IOI_URL}_nuxt/hero-960.webp`,
    `${IOI_URL}_nuxt/hero.avif`, `${IOI_URL}_nuxt/hero@2x.avif`, `${IOI_URL}_nuxt/hero.jpg`,
  ]);
  assert.deepEqual(a.iframes, ['https://www.youtube-nocookie.com/embed/xyz']);
  assert.deepEqual(a.media, [`${IOI_URL}media/teaser.mp4`, `${IOI_URL}media/teaser.webp`]);
  assert.deepEqual(a.preloads, [{ href: `${IOI_URL}f.woff2`, as: 'font' }]);
  assert.equal(a.all.some((x) => x.url === 'http://cdn.example.com/x.png' && x.tag === 'img' && x.attr === 'src'), true);
  assert.equal(a.all.some((x) => x.url === `${IOI_URL}media/teaser.webp` && x.tag === 'video' && x.attr === 'poster'), true);
  assert.equal(new Set(a.all.map((x) => x.url)).size, a.all.length, 'all is deduped by url');
});

test('extractAssets on the multilang page: base href, protocol-relative, data: skipped, <source> inside <video>', () => {
  const a = extractAssets(multi, 'https://www.example.com/');
  assert.deepEqual(a.scripts, ['https://cdn.example.com/lib.js'], 'protocol-relative takes the page scheme');
  assert.deepEqual(a.styles, ['http://static.example.com/site.css']);
  assert.deepEqual(a.images, ['https://www.example.com/sub/b.jpg', 'https://www.example.com/sub/b-2x.jpg', 'http://cdn.example.com/b-3x.jpg'], 'no data: URI');
  assert.deepEqual(a.media, ['https://www.example.com/sub/audio.mp3', 'https://www.example.com/sub/poster.jpg', 'https://www.example.com/sub/clip.webm']);
  assert.deepEqual(a.preloads, [{ href: 'https://www.example.com/sub/hero.jpg', as: 'image' }]);
  assert.deepEqual(a.iframes, []);
});

// ---------------------------------------------------------------- mixed content

test('findMixedContent lists http:// resources on an https page and nothing on an http page', () => {
  const mixed = findMixedContent(ioi, IOI_URL);
  assert.deepEqual(mixed, [{ tag: 'img', attr: 'src', url: 'http://cdn.example.com/x.png' }]);
  assert.deepEqual(findMixedContent(ioi, 'http://example.com/'), []);
});

test('findMixedContent covers srcset, data-src, action, link href — never <a>, alternate or xmlns', () => {
  const mixed = findMixedContent(multi, 'https://www.example.com/');
  assert.deepEqual(mixed, [
    { tag: 'link', attr: 'href', url: 'http://static.example.com/site.css' },
    { tag: 'img', attr: 'data-src', url: 'http://lazy.example.com/a.jpg' },
    { tag: 'img', attr: 'srcset', url: 'http://cdn.example.com/b-3x.jpg' },
    { tag: 'form', attr: 'action', url: 'http://forms.example.com/submit' },
  ]);
});

// ---------------------------------------------------------------- hosts

test('extractHosts finds hostnames in URLs and CSP tokens, ignoring keywords, schemes and hashes', () => {
  const hosts = extractHosts([
    "default-src 'self' https://*.example.com *.cdn.example.net example.com:443 'unsafe-inline' https: blob: data: 'nonce-abc123' 'sha256-AbC+/=='",
    'https://Images.CTFAssets.net/abc/og.jpg and http://cdn.example.com/x.png',
    '//static.example.org/lib.js',
    'wss://live.example.io:8443/socket',
    '', null,
  ]);
  assert.deepEqual(hosts, [
    '*.example.com', '*.cdn.example.net', 'example.com', 'images.ctfassets.net', 'cdn.example.com', 'static.example.org', 'live.example.io',
  ]);
  assert.deepEqual(extractHosts([]), []);
  assert.deepEqual(extractHosts(['sha256-AbC', 'nonce-x', "'self'", 'https:', 'unsafe-eval']), []);
});
