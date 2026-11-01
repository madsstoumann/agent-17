import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLinks, thinReason, visibleText } from '../lib/page.mjs';

test('pickLinks prefers other hosts, then new sections, and skips files and other sites', () => {
  const html = `<a href="/">Home</a><a href="/about/">About</a><a href="/about/team">Team</a>
    <a href="https://shop.example.com/">Shop</a><a href="/blog/post-1?x=1#c">Post</a><a href="/report.pdf">PDF</a>
    <a href="https://other.net/">Other</a><a href="mailto:a@b.c">Mail</a><a href="/careers/">Jobs</a>`;
  assert.deepEqual(pickLinks(html, 'https://www.example.com/', 3), ['https://shop.example.com/', 'https://www.example.com/about/', 'https://www.example.com/blog/post-1']);
  assert.deepEqual(pickLinks(html, 'https://www.example.com/', 0), []);
  assert.equal(pickLinks(html, 'https://www.example.com/', 10).length, 5);
});

test('thinReason: app shell, near-empty page, nothing core recognised, or fine', () => {
  const core = [{ name: 'WordPress', category: 'cms', confidence: 'detected' }];
  const text = `<p>${'Real content here. '.repeat(20)}</p>`;
  assert.equal(thinReason({ status: 200, html: '<body><div id="root"></div><script src="/a.js"></script></body>', scripts: 1 }, core), 'the page is an empty app shell');
  assert.equal(thinReason({ status: 200, html: '<body><h1>Hi</h1><script src="/a.js"></script></body>', scripts: 1 }, core), 'the HTML has almost no text');
  assert.equal(thinReason({ status: 200, html: text, scripts: 1 }, []), 'nothing in the HTML shows the CMS or framework');
  assert.equal(thinReason({ status: 200, html: text, scripts: 1 }, core), null);
  assert.equal(thinReason({ status: 403, html: '<div id="root"></div>', scripts: 1 }, []), null, 'blocked pages are not rendered');
  assert.equal(thinReason({ status: 200, challenge: 'Cloudflare challenge', html: '<div id="root"></div>' }, []), null);
});

test('visibleText drops scripts, styles and tags', () => {
  assert.equal(visibleText('<style>a{}</style><p>Hello <b>you</b></p><script>var x</script>'), 'Hello you');
});
