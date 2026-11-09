import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightPayload, flightRows, rscBlocks, hiddenBlocks, blocksMarkdown, blockWords, pageNode } from '../lib/rsc.mjs';
import { policyText, HIDDEN_MARKER } from '../scan.mjs';

/** A Next.js page: the served HTML shows the accordion toggles, the answers are only in the payload. */
function nextPage() {
  const tree = ['$', 'section', null, { children: [
    ['$', 'h1', null, { children: 'Privacy policy' }],
    ['$', 'p', null, { children: ['We are ', ['$', 'strong', null, { children: 'Example Ltd' }], ', the data controller.'] }],
    ['$', '$L5d', 'a1', { value: 'a1', className: 'border-theme-accent first:border-t', children: [
      ['$', '$L5e', null, { className: 'text-left focus-visible:outline', children: ['$', '$L27', null, { as: 'span', children: 'How long do you keep my data?' }] }],
      ['$', '$L5f', null, { className: 'pb-6 pr-20', children: ['$', 'div', null, { className: 'richtext-style', children: ['$', 'p', '0', { children: ['We keep order data for five years, see ', ['$', '$L9', null, { href: '/terms', children: 'the terms' }], '.'] }] }] }],
    ] }],
    ['$', '$L5d', 'a2', { value: 'a2', children: [
      ['$', '$L5e', null, { children: 'Who receives my data?' }],
      ['$', '$L5f', null, { children: ['$', 'p', null, { children: ['Our payment provider and ', '$$5 shipping partner.'] }] }],
    ] }],
    ['$', 'svg', null, { children: ['$', 'path', null, { d: 'M5.3 21.5q-.7 0-1.2-.5' }] }],
    ['$', '$L30', null, { faq: [{ question: 'Can I withdraw consent?', answer: '<p>Yes, at any time from the cookie settings.</p>' }] }],
  ] }];
  const long = '<p>Retention periods are listed per purpose in the table below.</p>';
  const payload = `0:["$","html",null,{}]\n5:${JSON.stringify(tree)}\n7:T${Buffer.byteLength(long).toString(16)},${long}8:"$Sreact.suspense"\n`;
  const chunks = [payload.slice(0, 40), payload.slice(40)].map((c) => `<script>self.__next_f.push(${JSON.stringify([1, c])})</script>`).join('');
  const served = '<main><h1>Privacy policy</h1><p>We are <strong>Example Ltd</strong>, the data controller.</p><button aria-expanded="false">How long do you keep my data?</button><button aria-expanded="false">Who receives my data?</button></main>';
  return { html: `<html><body>${served}<script>(self.__next_f=self.__next_f||[]).push([0])</script>${chunks}</body></html>`, visible: 'Privacy policy\nWe are Example Ltd, the data controller.\nHow long do you keep my data?\nWho receives my data?' };
}

test('flightPayload joins the [1, "…"] chunks; flightRows reads JSON and T rows', () => {
  const { html } = nextPage();
  const payload = flightPayload(html);
  assert.match(payload, /^0:\["\$","html"/);
  const rows = flightRows(payload);
  assert.deepEqual(rows.map((r) => r.id), ['0', '5', '7']);
  assert.match(rows[2].text, /^<p>Retention/);
  assert.equal(flightPayload('<html><body><p>No Next.js here</p></body></html>'), '');
});

test('rscBlocks: block text with inline runs and links joined, headings, data props, no SVG or class names', () => {
  const blocks = rscBlocks(nextPage().html);
  const texts = blocks.map((b) => b.text);
  assert.deepEqual(blocks[0], { text: 'Privacy policy', heading: 1 });
  assert.ok(texts.includes('We are Example Ltd, the data controller.'));
  assert.ok(texts.includes('We keep order data for five years, see the terms.'), 'a client link stays inline');
  assert.ok(texts.includes('Our payment provider and $5 shipping partner.'), '"$$" is a literal dollar sign');
  assert.ok(texts.includes('Can I withdraw consent?') && texts.includes('Yes, at any time from the cookie settings.'), 'text in a client component\'s data props');
  assert.ok(texts.includes('Retention periods are listed per purpose in the table below.'));
  assert.ok(!texts.some((t) => /M5\.3|focus-visible|border-theme|Sreact/.test(t)), texts.join(' | '));
});

test('hiddenBlocks keeps what the page does not show, with the question it answers', () => {
  const { html, visible } = nextPage();
  const hidden = hiddenBlocks(html, visible);
  assert.deepEqual(hidden.map((b) => [b.text, b.shown]), [
    ['How long do you keep my data?', true],
    ['We keep order data for five years, see the terms.', false],
    ['Who receives my data?', true],
    ['Our payment provider and $5 shipping partner.', false],
    ['Can I withdraw consent?', false],
    ['Yes, at any time from the cookie settings.', false],
    ['Retention periods are listed per purpose in the table below.', false],
  ]);
  assert.match(blocksMarkdown(hidden), /^### How long do you keep my data\?\n\nWe keep order data/);
  assert.equal(blockWords(hidden), 39, 'the questions the page shows do not count');
  assert.deepEqual(hiddenBlocks('<p>plain page</p>', 'plain page'), []);
});

/**
 * An App Router page as Next.js 15 streams it (anonymised from a museum and an agency site): the
 * router tree in row 0 with the root layout's not-found boundary inline, a root layout with an
 * inline analytics script and a not-found page, and a page that renders the site header (mega
 * menu with promo teasers), its own FAQ accordion and the footer (nav labels, an app store link).
 */
function appRouterPage() {
  const rows = {
    0: { P: null, b: 'build', c: ['', 'visit'], i: false, f: [[
      ['', { children: [['slug', 'visit', 'oc'], { children: ['__PAGE__', {}] }] }, '$undefined', '$undefined', true],
      ['', ['$', '$1', 'c', { children: [null, '$L2'] }], { children: [['slug', 'visit', 'oc'], ['$', '$1', 'c', { children: [null, ['$', '$L3', null, { parallelRouterKey: 'children', error: '$undefined', notFound: [['$', 'title', null, { children: '404: This page could not be found.' }], ['$', 'div', null, { children: ['$', 'h2', null, { children: 'This page could not be found.' }] }]], forbidden: '$undefined' }]] }], { children: ['__PAGE__', ['$', '$1', 'c', { children: ['$L5', null] }], {}, null, false] }, null, false] }, null, false],
      ['$', '$1', 'h', { children: [null, ['$', 'meta', null, { name: 'next-size-adjust', content: '' }]] }], false]] },
    2: ['$', 'html', null, { lang: 'da', children: ['$', 'body', null, { children: [
      ['$', '$L9', null, { id: 'plausible-init', strategy: 'afterInteractive', dangerouslySetInnerHTML: { __html: 'window.plausible = window.plausible || function() { (plausible.q = plausible.q || []).push(arguments) }' } }],
      ['$', '$L3', null, { parallelRouterKey: 'children', notFound: '$L24' }],
    ] }] }],
    24: ['$L25', []],
    25: ['$L26', ['$', 'main', null, { children: ['$', 'section', null, { children: [['$', '$L27', null, { as: 'h1', children: 'Siden findes ikke' }], ['$', 'p', null, { children: 'Siden du leder efter, er flyttet eller findes ikke længere.' }]] }] }]],
    5: ['$L3c', ['$', 'main', null, { id: 'main-content', children: [
      '$L30',
      ['$', 'section', null, { children: [
        ['$', 'h1', null, { children: 'Plan your visit' }],
        ['$', '$L9', null, { id: 'consent', children: 'function OptanonWrapper() {}' }],
        ['$', '$L61', null, { featuredImage: { items: [{ content: { properties: { altText: 'torso of a Roman emperor in the exhibition hall' } } }] }, children: ['$', 'p', null, { children: 'Tickets can be bought online or at the desk.' }] }],
        '$L70',
      ] }],
      '$L40',
    ] }]],
    30: ['$', 'header', null, { className: 'sticky', children: ['$L82'] }],
    82: ['$', 'div', null, { children: ['$', '$L85', null, { landmark: 'Main menu', items: [{ title: 'Annual pass', teaser: { title: 'Annual pass', desc: 'Visit the museum twice a year and the pass has paid for itself' } }, { title: 'Exhibitions', teaser: { title: 'The future museum', desc: 'The museum is being renovated for the future' } }] }] }],
    40: ['$', 'footer', null, { children: [['$', 'nav', null, { children: [['$', '$L2a', null, { href: '/about', children: 'About the museum' }], ['$', '$L2a', null, { href: '/press', children: 'Press and media' }]] }], ['$', 'a', null, { href: 'https://apps.example.com/app', title: 'Example Museum on App Store', children: ['$', 'img', null, { src: '/app.svg' }] }]] }],
    70: ['$', 'div', null, { children: [['$', 'h2', null, { children: 'Frequently asked questions' }], ['$', '$L73', null, { children: [
      ['$', '$L74', 'q1', { children: [['$', '$L75', null, { children: 'Which days are free?' }], ['$', '$L76', null, { children: ['$', 'p', null, { children: 'Entry is free on the last Wednesday of every month.' }] }]] }],
      ['$', '$L74', 'q2', { children: [['$', '$L75', null, { children: 'Can I bring a pram?' }], ['$', '$L76', null, { children: ['$', 'p', null, { children: 'You can borrow a pushchair in the cloakroom.' }] }]] }],
    ] }]] }],
  };
  const payload = Object.entries(rows).map(([id, v]) => `${id}:${JSON.stringify(v)}\n`).join('');
  const served = '<header><a href="/">Example Museum</a><button>Menu</button></header><main><h1>Plan your visit</h1><p>Tickets can be bought online or at the desk.</p><h2>Frequently asked questions</h2><button>Which days are free?</button><button>Can I bring a pram?</button></main><footer></footer>';
  const html = `<html><body>${served}<script>self.__next_f.push(${JSON.stringify([1, payload])})</script></body></html>`;
  return { html, visible: 'Example Museum Menu Plan your visit Tickets can be bought online or at the desk. Frequently asked questions Which days are free? Can I bring a pram?' };
}

const CHROME = /could not be found|Siden findes ikke|findes ikke længere|plausible|OptanonWrapper|Annual pass|paid for itself|renovated|About the museum|Press and media|App Store|Roman emperor/;

test('hiddenBlocks reads only the page\'s own components: no not-found or error text, scripts, nav, header, footer or media alt text', () => {
  const { html, visible } = appRouterPage();
  assert.ok(pageNode(flightRows(flightPayload(html))), 'the __PAGE__ segment is found in the router tree');
  const all = rscBlocks(html).map((b) => b.text);
  assert.ok(!all.some((t) => CHROME.test(t)), all.join(' | '));
  const hidden = hiddenBlocks(html, visible);
  assert.deepEqual(hidden.map((b) => [b.text, b.shown]), [
    ['Which days are free?', true],
    ['Entry is free on the last Wednesday of every month.', false],
    ['Can I bring a pram?', true],
    ['You can borrow a pushchair in the cloakroom.', false],
  ], 'closed accordion answers are still read');
  assert.equal(blockWords(hidden), 18);
});

test('without a router tree: rows only the header or a not-found prop point at are skipped, and so is script code', () => {
  const rows = [
    ['0', ['$', 'html', null, { children: [['$', 'header', null, { children: '$L82' }], ['$', '$L3', null, { notFound: '$L25' }], ['$', 'main', null, { children: '$L5' }]] }]],
    ['82', ['$', '$L85', null, { items: [{ title: 'Annual pass', desc: 'Visit the museum twice a year and the pass has paid for itself' }] }]],
    ['25', ['$', 'h1', null, { children: 'This page could not be found.' }]],
    ['5', ['$', 'section', null, { children: [['$', 'p', null, { children: 'Our opening hours change in the winter season.' }], ['$', '$L9', null, { id: 'x', children: 'window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);}' }]] }]],
  ];
  const payload = rows.map(([id, v]) => `${id}:${JSON.stringify(v)}\n`).join('');
  const html = `<html><body><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></body></html>`;
  assert.deepEqual(rscBlocks(html).map((b) => b.text), ['Our opening hours change in the winter season.']);
});

test('policyText opens <details> and adds the payload text under a marker', async () => {
  const { html, visible } = nextPage();
  let opened = 0;
  const page = { openDetails: async () => { opened++; return 0; }, text: async () => `${visible}\n`, html: async () => html };
  const text = await policyText(page);
  assert.equal(opened, 1);
  assert.ok(text.startsWith(`${visible}\n\n${HIDDEN_MARKER}\n\n### How long`));
  const plain = await policyText({ openDetails: async () => 0, text: async () => 'Short policy text', html: async () => '<p>Short policy text</p>' });
  assert.equal(plain, 'Short policy text');
});
