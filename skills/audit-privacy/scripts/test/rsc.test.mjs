import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightPayload, flightRows, rscBlocks, hiddenBlocks, blocksMarkdown, blockWords } from '../lib/rsc.mjs';
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
