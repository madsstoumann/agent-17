import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { templateKey, groupTemplates, pickSample, siteName, properTitle, pageDate, pageSlug, guessType } from '../lib/templates.mjs';
import { toMarkdown, questionPairs, visibleDates, leadDate, breadcrumbs, organisation, extractPage, pageDigest } from '../lib/extract.mjs';
import { verifyDraft, norm, onPage, knownUrl } from '../lib/verify.mjs';
import { parseCsv, readQuestions, renderProposals } from '../lib/proposals.mjs';
import { extractMeta } from '../lib/html.mjs';
import { topTypes, draftPage, checkLine, VERSION } from '../plan.mjs';
import { nodesOf, mergeGraph, sampleHtml, injectLive, samplesReadme } from '../lib/samples.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(HERE, '..', '..', '..');
const PLAN = path.join(HERE, '..', 'plan.mjs');

// ---------------------------------------------------------------- shared copies

test('shared libs are identical to the skills they come from', () => {
  const pairs = [['html.mjs', 'audit-seo'], ['render.mjs', 'audit-seo'], ['rich.mjs', 'audit-seo'], ['schema.mjs', 'audit-seo'], ['tasks.mjs', 'audit-all'], ['levels.mjs', 'audit-all'], ['target-state.mjs', 'audit-security'], ['rsc.mjs', 'audit-privacy']];
  for (const [file, owner] of pairs) {
    const theirs = path.join(SKILLS, owner, 'scripts', 'lib', file);
    if (!fs.existsSync(theirs)) continue;
    assert.equal(fs.readFileSync(path.join(HERE, '..', 'lib', file), 'utf8'), fs.readFileSync(theirs, 'utf8'), `${file} differs from ${owner}'s copy`);
  }
});

// ---------------------------------------------------------------- templates

test('templateKey: sections, locale prefixes, years and one-segment pages', () => {
  assert.equal(templateKey('https://x.com/'), 'home');
  assert.equal(templateKey('https://x.com/en/'), 'home');
  assert.equal(templateKey('https://x.com/resources/insights/industry-articles/2025/x'), 'resources/insights');
  assert.equal(templateKey('https://x.com/da-DK/resources/insights/y'), 'resources/insights');
  assert.equal(templateKey('https://x.com/Solutions/Example-One/x'), 'solutions/example-one');
  assert.equal(templateKey('https://x.com/your-industry/pensions'), 'your-industry');
  assert.equal(templateKey('https://x.com/news/2024/x'), 'news');
  assert.equal(templateKey('https://x.com/contact'), 'contact');
  assert.equal(templateKey('https://x.com/trust-center'), 'top-level');
  assert.equal(templateKey('https://x.com/faq/what'), 'faq', '"faq" is not a locale');
});

test('guessType: by URL first, then by dated pages', () => {
  assert.equal(guessType('about-us/news').type, 'news');
  assert.equal(guessType('resources/client-success-stories').type, 'case-study');
  assert.equal(guessType('resources/insights').type, 'article');
  assert.equal(guessType('solutions/axioma-solutions').type, 'product');
  assert.equal(guessType('your-industry').type, 'audience');
  assert.equal(guessType('legal').type, 'legal');
  assert.equal(guessType('home').type, 'home');
  assert.equal(guessType('things', [{ sig: { visibleDate: '2025-01-01' } }, { sig: {} }]).type, 'article');
  assert.equal(guessType('things', [{ sig: {} }]).type, 'page');
});

const page = (url, extra = {}) => ({ url, status: 200, noindex: false, contentType: 'text/html', words: 300, sig: { questionHeadings: 0 }, jsonLd: [], ...extra });

test('groupTemplates and pickSample: home first, case duplicates once, legal skipped, question pages added', () => {
  const pages = [
    page('https://x.com/'),
    ...Array.from({ length: 6 }, (_, i) => page(`https://x.com/blog/2025/post-${i}`, { words: 400 + i, jsonLd: i ? [] : [{ types: ['Article'] }] })),
    page('https://x.com/Blog/2025/post-1'),
    page('https://x.com/legal/terms'),
    page('https://x.com/products/a', { sig: { questionHeadings: 4 } }),
    page('https://x.com/products/b', { sig: { questionHeadings: 3 }, words: 100 }),
    page('https://x.com/hidden', { noindex: true }),
  ];
  const t = groupTemplates(pages);
  assert.equal(t[0].key, 'home');
  const blog = t.find((x) => x.key === 'blog');
  assert.equal(blog.pages, 6, 'the case-only duplicate is counted once');
  assert.deepEqual(blog.markup, { Article: 1 });
  assert.equal(blog.slug, 'blog');
  assert.ok(!t.some((x) => x.key === 'hidden'));
  const s = pickSample(t, pages, { max: 10 });
  assert.equal(s[0].url, 'https://x.com/');
  assert.ok(!s.some((x) => x.template === 'legal'), 'legal pages are not read');
  assert.equal(s.find((x) => x.template === 'blog').url, 'https://x.com/blog/2025/post-5', 'undated and untitled alike: the longest');
  assert.ok(s.some((x) => x.url === 'https://x.com/products/b' && /question headings/.test(x.why)));
  assert.equal(pickSample(t, pages, { max: 2 }).length, 2);
  assert.equal(pageSlug('https://x.com/'), 'home');
  assert.equal(pageSlug('https://x.com/Blog/2025/Post-1/'), 'blog-2025-post-1');
});

test('pickSample: the example page is representative and recent with a title of its own, not the longest', () => {
  const news = (y, slug, title, words, shown) => page(`https://example.com/about/news/${y}/${slug}`, { title: `${title} | Example`, words, sig: { questionHeadings: 0, visibleDate: shown } });
  const pages = [
    page('https://example.com/', { title: 'Welcome to Example | Example' }),
    news(2023, 'statement-by-the-board', '', 2400, 'June 7, 2023'), // longest, titled only with the site name
    news(2022, 'old-award', 'Example wins an award', 900, 'December 1, 2022'),
    news(2026, 'new-client', 'A client selects Example One', 650, 'May 20, 2026'),
    news(2026, 'stub', 'Short note', 40, 'June 1, 2026'), // thin for the template
    news(2025, 'award', 'Example wins best platform', 700, 'November 7, 2025'),
  ];
  pages[1].title = 'Example';
  assert.equal(siteName(pages), 'example');
  assert.equal(properTitle('Example', 'example'), false);
  assert.equal(properTitle('Example | Example', 'example'), false);
  assert.equal(properTitle('A client selects Example One | Example', 'example'), true);
  assert.equal(pageDate(pages[3]), '2026-05-20');
  const s = pickSample(groupTemplates(pages), pages, { max: 10 });
  const ex = s.find((x) => x.template === 'about/news');
  assert.equal(ex.url, 'https://example.com/about/news/2026/new-client', 'recent, a proper title, not thin');
  assert.equal(ex.why, 'representative page of the template');
  assert.equal(s.find((x) => x.why === 'second page of a large template').url, 'https://example.com/about/news/2025/award');
  const listing = [page('https://example.com/docs/a', { title: 'A guide | Example', words: 300 }), page('https://example.com/docs/b?page=2', { title: 'B guide | Example', words: 350 })];
  assert.equal(pickSample(groupTemplates(listing), listing).find((x) => x.template === 'docs').url, 'https://example.com/docs/a', 'a query-string variant is not the example');
});

// ---------------------------------------------------------------- extract

const HTML = `<!doctype html><html lang="en"><head><title>What is an IBOR? | Acme</title>
<meta name="description" content="An IBOR explained.">
<meta property="og:site_name" content="Acme"><meta property="og:image" content="https://cdn.acme.com/og.png">
<link rel="apple-touch-icon" href="/icon.png"></head><body>
<header><a href="/"><img src="/img/acme-logo.svg" alt="Acme logo"></a><nav><ul><li><a href="/products">Products</a></li></ul></nav></header>
<div id="onetrust-banner-sdk"><p>We use cookies to improve things for everyone here.</p></div>
<main>
<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/insights">Insights</a></li><li>What is an IBOR?</li></ol></nav>
<p>March 7, 2025</p>
<h1>What is an IBOR?</h1>
<p>By Jane Doe, Head of Data</p>
<p>An investment book of record (IBOR) is the single source of positions for the front office.</p>
<h2>Why does an IBOR matter?</h2>
<p>It gives one real-time view of <a href="/products/one">Acme One</a> positions.</p>
<p>The deadline is 1 January 2027 for most funds.</p>
<table><tr><th>Book</th><th>Purpose</th></tr><tr><td>IBOR</td><td>Positions</td></tr></table>
</main>
<footer><a href="https://www.linkedin.com/company/acme">LinkedIn</a><a href="tel:+4512345678">Call</a><a href="mailto:info@acme.com">Mail</a><img src="/clients/client-logo.png" alt="Client logo"></footer>
</body></html>`;

test('toMarkdown, questionPairs, dates and the page date', () => {
  const md = toMarkdown('<h2>What is X?</h2><p>X is <b>a</b> thing.</p><ul><li>One</li><li>Two</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  assert.match(md, /^## What is X\?$/m);
  assert.match(md, /^X is a thing\.$/m);
  assert.match(md, /^- One$/m);
  assert.match(md, /^\| A \| B \|$/m);
  assert.deepEqual(questionPairs(md).map((q) => q.question), ['What is X?']);
  assert.match(questionPairs(md)[0].answer, /^X is a thing/);
  assert.deepEqual(visibleDates('On 12 March 2025, March 7, 2023, 2024-01-31, 05.06.2022 and March 7 2023 again'), ['2022-06-05', '2023-03-07', '2024-01-31', '2025-03-12']);
  assert.deepEqual(visibleDates('2025-13-40 and 99/99/2020'), []);
  assert.equal(leadDate('March 7 2023\n\n# Title\n\nText.'), '2023-03-07');
  assert.equal(leadDate('# Title\n\nPublished 4 June 2024\n\nText.'), '2024-06-04');
  assert.equal(leadDate(`# Title\n\n${'word '.repeat(200)}\n\nThe deadline is 1 January 2027.`), null, 'a date deep in the text is not the page date');
  // A news item dated above its h1 whose first paragraph cites an older order: the shown date wins.
  const news = 'June 7, 2023\n\n# Statement by the Board\n\n- News\n\nWith reference to the announcement of 25 May 2023 under Executive Order no. 636 of 15 May 2020 on Takeover Offers.';
  assert.equal(leadDate(news), '2023-06-07', 'first date in reading order, not the earliest');
  const meta = (d) => `<html lang="en"><head><title>Example</title><meta property="article:published_time" content="${d}T08:00:00Z"></head><body><main><h1>Statement</h1><p>Board statement.</p><p>Published ${d === '2023-06-07' ? '7 June 2023' : 'some day'}.</p>${'<p>word word word word word word word word word word word word word word word word word word word word.</p>'.repeat(8)}</main></body></html>`;
  const shown = extractPage(meta('2023-06-07'), 'https://example.com/news/statement');
  assert.equal(shown.publishedMeta, '2023-06-07');
  assert.equal(shown.leadDate, '2023-06-07');
  const unshown = extractPage(meta('2021-01-02'), 'https://example.com/news/statement');
  assert.equal(unshown.leadDate, null, 'article:published_time alone is not a date the page shows');
  assert.match(pageDigest(unshown), /article:published_time 2021-01-02 \(not shown on the page\)/);
});

test('extractPage: main content, breadcrumb, organisation details, no cookie banner', () => {
  const p = extractPage(HTML, 'https://acme.com/insights/what-is-an-ibor');
  assert.equal(p.title, 'What is an IBOR? | Acme');
  assert.equal(p.h1, 'What is an IBOR?');
  assert.equal(p.leadDate, '2025-03-07');
  assert.deepEqual(p.dates, ['2025-03-07', '2027-01-01']);
  assert.deepEqual(p.questions.map((q) => q.question), ['What is an IBOR?', 'Why does an IBOR matter?']);
  assert.equal(p.tables, 2);
  assert.deepEqual(p.bylines, ['Jane Doe']);
  assert.deepEqual(p.breadcrumbs.map((b) => b.name), ['Home', 'Insights', 'What is an IBOR?']);
  assert.equal(p.breadcrumbs[1].url, 'https://acme.com/insights');
  assert.equal(p.org.logo, 'https://acme.com/img/acme-logo.svg', 'the header logo, not a client logo');
  assert.equal(p.org.name, 'Acme');
  assert.deepEqual(p.org.social, ['https://www.linkedin.com/company/acme']);
  assert.deepEqual(p.org.phones, ['+4512345678']);
  assert.deepEqual(p.org.emails, ['info@acme.com']);
  assert.ok(!/cookies/.test(p.text), 'the consent banner is left out');
  assert.ok(!/Products/.test(p.markdown), 'the header nav is not main content');
  assert.ok(p.urls.includes('https://acme.com/products/one'));
  assert.ok(p.urls.includes('https://cdn.acme.com/og.png'));
  const meta = extractMeta(HTML, 'https://acme.com/');
  assert.equal(organisation(HTML, 'https://acme.com/', meta).icon, 'https://acme.com/icon.png');
  assert.deepEqual(breadcrumbs('<p>none</p>', 'https://acme.com/'), []);
});

test('visibleDates: Danish and other day-month-year dates, ranges, and no date without a year', () => {
  assert.deepEqual(visibleDates('Udstillingen vises 1. oktober 2026 - 29. marts 2027'), ['2026-10-01', '2027-03-29']);
  assert.deepEqual(visibleDates('Periode: 1. oktober – 29. marts 2027'), ['2026-10-01', '2027-03-29'], 'the first date takes the year from the second');
  assert.deepEqual(visibleDates('Opdateret d. 9. november 2026'), ['2026-11-09']);
  assert.deepEqual(visibleDates('3.–5. juni 2026'), ['2026-06-03', '2026-06-05']);
  assert.deepEqual(visibleDates('15. august 2026 til 3. januar 2027'), ['2026-08-15', '2027-01-03']);
  assert.deepEqual(visibleDates('12. März 2025 · 1er octobre 2026 · 1 de octubre de 2026 · 4 mei 2024 · 7 augusti 2023'), ['2023-08-07', '2024-05-04', '2025-03-12', '2026-10-01']);
  assert.deepEqual(visibleDates('Torsdag den 5. november kl. 17-22'), [], 'no year, no date');
  assert.deepEqual(visibleDates('des 3 2024 and 4 dese 2024'), [], '"des" is a French word, not a month');
});

test('extractPage: text only in the Next.js payload counts, and is marked as hidden', () => {
  const tree = ['$', 'main', null, { children: [
    ['$', 'h1', null, { children: 'Årskort' }],
    ['$', 'p', null, { children: 'Med et årskort kommer du gratis ind på museet hele året, så ofte du vil.' }],
    ['$', '$L5d', 'q1', { children: [
      ['$', '$L5e', null, { children: ['$', 'h3', null, { children: 'Kan man dele et årskort?' }] }],
      ['$', '$L5f', null, { children: ['$', 'p', null, { children: 'Et årskort er personligt og kan ikke deles. Prisen gælder fra 1. oktober 2026.' }] }],
    ] }],
  ] }];
  const push = `<script>self.__next_f.push(${JSON.stringify([1, `4:${JSON.stringify(tree)}\n`])})</script>`;
  const html = `<html lang="da"><head><title>Årskort</title></head><body><main><h1>Årskort</h1><p>Med et årskort kommer du gratis ind på museet hele året, så ofte du vil.</p><h3>Kan man dele et årskort?</h3></main>${push}</body></html>`;
  const p = extractPage(html, 'https://example.dk/besog/aarskort');
  assert.equal(p.hidden.source, 'Next.js payload');
  assert.equal(p.hidden.words, 14);
  assert.match(p.hidden.markdown, /^### Kan man dele et årskort\?\n\nEt årskort er personligt/);
  assert.deepEqual(p.questions.map((q) => [q.question, q.answer.slice(0, 25), q.hidden || false]), [['Kan man dele et årskort?', 'Et årskort er personligt ', true]], 'the payload answer fills the empty one');
  assert.ok(p.text.includes('kan ikke deles'));
  assert.deepEqual(p.dates, ['2026-10-01']);
  assert.deepEqual(verifyDraft({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Kan man dele et årskort?', acceptedAnswer: { '@type': 'Answer', text: 'Et årskort er personligt og kan ikke deles.' } }] }, p), []);
  assert.equal(extractPage('<html><body><main><p>Plain</p></main></body></html>', 'https://example.dk/').hidden, null);
});

test('extractPage: payload text that the head already carries (meta description, og:, title) is not hidden', () => {
  const desc = 'How brands build long-term performance with creative, data and media working together.';
  const tree = ['$', 'main', null, { children: [
    ['$', 'h1', null, { children: 'Long-term growth' }],
    ['$', 'p', null, { children: desc }],
    ['$', 'p', null, { children: ['$', 'span', null, { children: 'Share the full story with your team today' }] }],
    ['$', '$L5d', 'q1', { children: [['$', '$L5e', null, { children: 'What is long-term performance?' }], ['$', '$L5f', null, { children: ['$', 'p', null, { children: 'Growth that lasts beyond a single campaign.' }] }]] }],
  ] }];
  const push = `<script>self.__next_f.push(${JSON.stringify([1, `4:${JSON.stringify(tree)}\n`])})</script>`;
  const head = `<title>Long-term growth</title><meta name="description" content="${desc}"><meta property="og:description" content="Share the full story with your team today">`;
  const html = `<html lang="en"><head>${head}</head><body><main><h1>Long-term growth</h1><h3>What is long-term performance?</h3></main>${push}</body></html>`;
  const p = extractPage(html, 'https://example.com/en/insights/long-term-growth');
  assert.doesNotMatch(p.hidden.markdown, /creative, data and media/, 'the meta description is in the served HTML');
  assert.doesNotMatch(p.hidden.markdown, /Share the full story/, 'og:description too');
  assert.match(p.hidden.markdown, /Growth that lasts beyond a single campaign/, 'the closed accordion answer still counts');
  assert.equal(p.hidden.words, 7);
  assert.equal(p.description, desc);
});

test('extractPage: site-wide payload text (not-found page, scripts, header teasers, footer nav) is not the page\'s hidden text', () => {
  const rows = {
    0: { P: null, b: 'build', c: ['', 'visit'], f: [[
      ['', { children: ['__PAGE__', {}] }, '$undefined', '$undefined', true],
      ['', ['$', '$1', 'c', { children: [null, ['$', '$L3', null, { notFound: [['$', 'h2', null, { children: 'This page could not be found.' }]] }]] }], { children: ['__PAGE__', ['$', '$1', 'c', { children: ['$L5'] }], {}, null, false] }, null, false],
      null, false]] },
    5: ['$', 'main', null, { children: [
      ['$', 'header', null, { children: ['$', '$L85', null, { items: [{ teaser: { title: 'Årskort', desc: 'Besøg museet to gange på et år, før årskortet er tjent hjem' } }] }] }],
      ['$', 'h1', null, { children: 'Besøg' }],
      ['$', '$L9', null, { id: 'plausible-init', children: 'window.plausible = window.plausible || function() { (plausible.q = plausible.q || []).push(arguments) }' }],
      ['$', '$L5d', 'q1', { children: [['$', '$L5e', null, { children: 'Hvilke dage er gratis?' }], ['$', '$L5f', null, { children: ['$', 'p', null, { children: 'Museet har gratis adgang den sidste onsdag i hver måned.' }] }]] }],
      ['$', 'footer', null, { children: ['$', 'nav', null, { children: [['$', '$L2a', null, { href: '/om', children: 'Om museet' }], ['$', '$L2a', null, { href: '/presse', children: 'Presse og medier' }]] }] }],
    ] }],
  };
  const payload = Object.entries(rows).map(([id, v]) => `${id}:${JSON.stringify(v)}\n`).join('');
  const html = `<html lang="da"><head><title>Besøg</title></head><body><main><h1>Besøg</h1><h3>Hvilke dage er gratis?</h3></main><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></body></html>`;
  const p = extractPage(html, 'https://example.dk/besog');
  assert.equal(p.hidden.words, 10, 'only the closed FAQ answer');
  assert.equal(p.hidden.markdown, '### Hvilke dage er gratis?\n\nMuseet har gratis adgang den sidste onsdag i hver måned.');
  assert.ok(!/findes|could not be found|plausible|årskortet|Om museet|Presse/.test(p.text), p.text);
});

test('draftPage: a page slug wins over a template of the same name', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-geo-draft-'));
  fs.mkdirSync(path.join(run, 'pages'));
  for (const [slug, url] of [['home', 'https://example.dk/'], ['besog', 'https://example.dk/besog'], ['besog-aarskort', 'https://example.dk/besog/aarskort'], ['det-sker-kalender-x', 'https://example.dk/det-sker/kalender/x']]) {
    fs.writeFileSync(path.join(run, 'pages', `${slug}.json`), JSON.stringify({ url }));
  }
  const inv = { templates: [{ key: 'home', slug: 'home', example: 'home' }, { key: 'besog', slug: 'besog', example: 'besog-aarskort' }, { key: 'det-sker/kalender', slug: 'det-sker--kalender', example: 'det-sker-kalender-x' }] };
  const visit = draftPage(run, inv, 'besog');
  assert.equal(visit.page.url, 'https://example.dk/besog');
  assert.deepEqual(visit.template, { key: 'besog', example: 'besog-aarskort' });
  assert.equal(draftPage(run, inv, 'besog-aarskort').page.url, 'https://example.dk/besog/aarskort');
  const tpl = draftPage(run, inv, 'det-sker--kalender');
  assert.equal(tpl.page.url, 'https://example.dk/det-sker/kalender/x');
  assert.equal(tpl.template, null);
  assert.equal(draftPage(run, inv, 'site').page.url, 'https://example.dk/');
  assert.equal(draftPage(run, inv, 'nothing'), null);
  fs.rmSync(run, { recursive: true, force: true });
});

test('checkLine: a draft named after a page reads as matched to that page, not as misnamed', () => {
  const line = checkLine({ file: 'markup/besog.jsonld', slug: 'besog', page: 'https://example.dk/besog', types: ['WebPage'], notOnPage: [], required: [], recommended: [], validator: null, alsoTemplate: { key: 'besog', example: 'besog-aarskort' } });
  assert.match(line, /^OK {3}markup\/besog\.jsonld/);
  assert.match(line, /checked against https:\/\/example\.dk\/besog, the page it is named after, as intended; keep the file name/);
  assert.match(line, /Only if every "besog" page needs markup too, add a second draft for that, besog-aarskort\.jsonld/);
  assert.doesNotMatch(line, /not the example|name the draft|would be a separate draft|rename/);
});

test('verifyDraft: event dates the page shows in Danish pass; a date without a year is flagged', () => {
  const html = '<html lang="da"><body><main><h1>Magt og mode</h1><p>1. oktober 2026 - 29. marts 2027</p><p>Torsdag den 5. november kl. 17-22</p></main></body></html>';
  const p = extractPage(html, 'https://example.dk/udstillinger/magt-mode');
  assert.deepEqual(verifyDraft({ '@type': 'ExhibitionEvent', name: 'Magt og mode', startDate: '2026-10-01', endDate: '2027-03-29' }, p), []);
  const flags = verifyDraft({ '@type': 'Event', name: 'Magt og mode', startDate: '2026-11-05T17:00:00+01:00' }, p);
  assert.deepEqual(flags.map((f) => [f.path, f.reason]), [['startDate', 'date not shown on the page']]);
});

// ---------------------------------------------------------------- verify

test('verifyDraft: values from the page pass, invented ones are flagged', () => {
  const p = extractPage(HTML, 'https://acme.com/insights/what-is-an-ibor');
  const good = {
    '@context': 'https://schema.org', '@type': 'Article', '@id': 'https://acme.com/insights/what-is-an-ibor#article',
    headline: 'What is an IBOR?', datePublished: '2025-03-07', image: 'https://cdn.acme.com/og.png',
    description: 'An investment book of record (IBOR) is the single source of positions for the front office.',
    author: { '@type': 'Person', name: 'Jane Doe', jobTitle: 'Head of Data' },
    publisher: { '@id': 'https://acme.com/#organization', name: 'Acme', logo: { '@type': 'ImageObject', url: 'https://acme.com/img/acme-logo.svg' }, sameAs: ['https://www.linkedin.com/company/acme'] },
    mentions: { '@type': 'SoftwareApplication', name: 'Acme One', url: 'https://acme.com/products/one' },
    inLanguage: 'en',
  };
  assert.deepEqual(verifyDraft(good, p), []);
  const bad = {
    '@type': 'Article', headline: 'What is an IBOR?',
    datePublished: '2027-01-01', dateModified: '2025-04-01', award: 'Best IBOR vendor 2025', foundingDate: '1971',
    author: { '@type': 'Person', name: 'John Smith', sameAs: 'https://www.linkedin.com/in/johnsmith' }, url: 'https://acme.com/somewhere-else',
  };
  const flags = Object.fromEntries(verifyDraft(bad, p).map((f) => [f.path, f.reason]));
  assert.match(flags.datePublished, /page's own date is 2025-03-07/);
  assert.match(flags.dateModified, /not shown/);
  assert.match(flags.award, /text not on the page/);
  assert.match(flags.foundingDate, /year not on the page/);
  assert.match(flags['author.name'], /text not on the page/);
  assert.match(flags['author.sameAs'], /URL not linked/);
  assert.match(flags.url, /URL not linked/);
  assert.equal(flags.headline, undefined);
});

test('norm, onPage and knownUrl', () => {
  assert.equal(norm('Example’s “One” – platform & data'), "example's one platform and data");
  const hay = norm('The quick brown fox jumps over the lazy dog while the cat sleeps on the warm mat today and the birds sing in the old oak tree near the river bank all morning long');
  assert.ok(onPage('quick brown fox', hay));
  assert.ok(!onPage('quick red fox', hay));
  assert.ok(onPage('The quick brown fox jumps over the lazy dog while the cat sleeps on the warm mat today and the birds sing in the old oak tree near the river bank all day long', hay), 'long text with a small change passes');
  assert.ok(!onPage('A slow grey wolf walks past the busy fox while the cat sleeps on the warm mat today and nobody sings', hay), 'long text that only shares a phrase does not');
  const pg = { url: 'https://a.com/x', urls: ['https://a.com/en/products/one'] };
  assert.ok(knownUrl('https://a.com/', pg));
  assert.ok(knownUrl('https://a.com/x/', pg));
  assert.ok(knownUrl('https://a.com/products/one', pg), 'same path without the locale prefix');
  assert.ok(!knownUrl('https://b.com/', pg));
});

test('topTypes: top level and @graph members only', () => {
  assert.deepEqual(topTypes({ '@type': 'NewsArticle', mentions: { '@type': 'SoftwareApplication' } }), ['NewsArticle']);
  assert.deepEqual(topTypes({ '@graph': [{ '@type': 'Article' }, { '@type': ['BreadcrumbList'] }] }), ['Article', 'BreadcrumbList']);
});

// ---------------------------------------------------------------- questions and proposals

test('parseCsv and readQuestions', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  const ok = readQuestions('question,intent,status,page,brief\nWhat is X?,definition,missing,,01-x.md\n"X vs Y?",comparison,answered,https://a.com/x,\n');
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.questions[1].question, 'X vs Y?');
  const bad = readQuestions('question,intent,status,page\nWhat?,guess,maybe,\nWhy?,other,answered,\n');
  assert.equal(bad.errors.length, 4, 'bad intent, bad status, and a page missing on both non-missing rows');
  assert.deepEqual(readQuestions('question,page\nx,y').errors, ['questions.csv has no "status" column']);
});

test('renderProposals: markup table, questions ordered missing first, not-covered section', () => {
  const inventory = { host: 'a.com', crawled: 10, indexable: 9, truncated: false, sample: [{ slug: 'news-2025-x', template: 'news' }], templates: [
    { key: 'home', slug: 'home', type: 'home', types: ['Organization', 'WebSite'], pages: 1, markup: {} },
    { key: 'news', slug: 'news', type: 'news', types: ['NewsArticle', 'BreadcrumbList'], pages: 5, markup: { NewsArticle: 2 } },
    { key: 'legal', slug: 'legal', type: 'legal', types: ['WebPage'], pages: 2, markup: {} },
  ] };
  const check = { drafts: [
    { file: 'markup/site.jsonld', slug: 'site', types: ['Organization', 'WebSite'], notOnPage: [], required: [], recommended: [] },
    { file: 'markup/news-2025-x.jsonld', slug: 'news-2025-x', types: ['NewsArticle'], notOnPage: [{ path: 'datePublished', value: '2020-01-01', reason: 'date not shown on the page' }], required: [], recommended: [] },
  ] };
  const md = renderProposals({ inventory, check, version: VERSION, summary: 'Do the site graph first.', profile: '# A\n\nA sells things.\n\n## Context (not from the site)\n\nMore.',
    questions: [{ question: 'Q answered', intent: 'other', status: 'answered', page: 'https://a.com/q' }, { question: 'Q missing', intent: 'definition', status: 'missing', brief: '01-q.md' }], briefs: ['01-q.md'] });
  assert.match(md, /^# GEO plan: a\.com/);
  assert.match(md, /Do the site graph first\./);
  assert.match(md, /^### Context \(not from the site\)/m, 'profile headings are demoted under "About the site"');
  assert.match(md, /\| home \| 1 \| home \| none \| Organization, WebSite \| \[site\.jsonld\]\(markup\/site\.jsonld\) \| passes \|/);
  assert.match(md, /\| news \| 5 \| news \| NewsArticle \(2\) \| NewsArticle \| \[news-2025-x\.jsonld\]\(markup\/news-2025-x\.jsonld\) \| 1 not on page \|/, 'a page-slug draft lands on its template');
  assert.match(md, /\| legal \| 2 \| legal \| none \| not drafted/);
  assert.match(md, /datePublished: "2020-01-01" \(date not shown on the page\)/);
  assert.ok(md.indexOf('Q missing') < md.indexOf('Q answered'));
  assert.match(md, /## Not covered/);
});

// ---------------------------------------------------------------- end to end (local server, no Chrome, no validator)

function serve(pages) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = pages[req.url];
      if (!body) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function run(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [PLAN, ...args], { env: { ...process.env, ...env } });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

// ---------------------------------------------------------------- samples

const SITE = { '@context': 'https://schema.org', '@graph': [
  { '@type': 'Organization', '@id': 'https://x.com/#organization', name: 'Acme', url: 'https://x.com/' },
  { '@type': 'WebSite', '@id': 'https://x.com/#website', url: 'https://x.com/', publisher: { '@id': 'https://x.com/#organization' } },
] };

test('nodesOf and mergeGraph: one @graph, site first, same @id merged', () => {
  assert.deepEqual(nodesOf(null), []);
  assert.deepEqual(nodesOf({ '@context': 'https://schema.org', '@type': 'Article', headline: 'H' }), [{ '@type': 'Article', headline: 'H' }]);
  assert.equal(nodesOf([{ '@type': 'A' }, { '@graph': [{ '@type': 'B' }, { '@type': 'C' }] }]).length, 3);
  const g = mergeGraph(SITE, { '@context': 'https://schema.org', '@type': 'AboutPage', about: { '@id': 'https://x.com/#organization' } });
  assert.equal(g['@context'], 'https://schema.org');
  assert.deepEqual(topTypes(g), ['Organization', 'WebSite', 'AboutPage']);
  const m = mergeGraph(SITE, { '@graph': [{ '@type': 'Organization', '@id': 'https://x.com/#organization', foundingDate: '1971' }] });
  assert.equal(m['@graph'].length, 2, 'a node with a site @id is merged, not added');
  assert.deepEqual(m['@graph'][0], { '@type': 'Organization', '@id': 'https://x.com/#organization', name: 'Acme', url: 'https://x.com/', foundingDate: '1971' });
  assert.equal(mergeGraph(null, { '@type': 'Article' })['@graph'].length, 1);
  assert.equal(SITE['@graph'][0].foundingDate, undefined, 'inputs are not changed');
});

test('sampleHtml: the graph in one script, "<" escaped, and how to test it', () => {
  const html = sampleHtml({ graph: mergeGraph(SITE, { '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: '<p>A</script></p>' } }] }), url: 'https://x.com/faq', title: 'FAQ & more', draft: 'markup/faq.jsonld', notes: ['Note <1>'] });
  assert.equal(html.match(/application\/ld\+json/g).length, 1);
  assert.ok(!html.includes('</script></p>'), 'CMS text cannot close the script tag');
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json)['@graph'][2].mainEntity[0].acceptedAnswer.text, '<p>A</script></p>');
  assert.match(html, /<title>Sample: FAQ &amp; more<\/title>/);
  assert.match(html, /Rich Results Test/);
  assert.match(html, /<li>Note &lt;1&gt;<\/li>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('injectLive: own JSON-LD replaced, graph and <base> in <head>', () => {
  const page = '<!doctype html><html><head><title>P</title><script type="application/ld+json">{"@type":"Thing"}</script><script type=\'application/ld+json\'>{}</script><link rel="stylesheet" href="/a.css"></head><body><img src="x.png"></body></html>';
  const { html, removed } = injectLive(page, { graph: mergeGraph(SITE, null), url: 'https://x.com/p' });
  assert.equal(removed, 2);
  assert.equal(html.match(/application\/ld\+json/g).length, 1);
  assert.match(html, /<head>\n<base href="https:\/\/x\.com\/p">/);
  assert.ok(html.indexOf('application/ld+json') < html.indexOf('</head>'));
  assert.match(html, /<body><img src="x\.png"><\/body>/);
  assert.equal(injectLive('<html><head><base href="/b/"></head></html>', { graph: SITE, url: 'https://x.com/' }).html.match(/<base /g).length, 1, 'an existing <base> is kept');
  assert.match(injectLive('<p>no head</p>', { graph: SITE, url: 'https://x.com/' }).html, /^<head>\n<base href="https:\/\/x\.com\/">\n<script/);
});

test('samplesReadme: a row per sample, validator and rich-result columns', () => {
  const md = samplesReadme({ host: 'x.com', live: true, date: new Date('2026-01-02'), rows: [
    { file: 'insights.html', live: 'insights.live.html', url: 'https://x.com/i', types: ['Organization', 'Article'], validator: { errors: 0, warnings: 1 }, required: [], notOnPage: 0 },
    { file: 'product.html', live: null, url: 'https://x.com/p', types: ['SoftwareApplication'], validator: null, required: ['SoftwareApplication.offers.price'], notOnPage: 2 },
  ] });
  assert.match(md, /^# JSON-LD samples: x\.com/);
  assert.match(md, /\| \[insights\.html\]\(insights\.html\) · \[live\]\(insights\.live\.html\) \| https:\/\/x\.com\/i \| Organization, Article \| 0 errors, 1 warnings \| nothing missing \| 0 \|/);
  assert.match(md, /not checked \(--no-remote\) \| needs SoftwareApplication\.offers\.price for the rich result \| 2 \|/);
  assert.match(md, /`\.live\.html` files/);
  assert.ok(!/\n\n\n/.test(md));
});

test('extract → check → build on a local site', async () => {
  const home = '<html lang="en"><head><title>Acme</title><meta name="description" content="Acme makes investment software."></head><body><main><h1>Acme</h1><p>Acme makes investment software for pension funds and insurers around the world.</p></main><footer><a href="https://www.linkedin.com/company/acme">in</a></footer></body></html>';
  const server = await serve({ '/': home, '/insights/what-is-an-ibor': HTML });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-geo-'));
  try {
    const seoRun = path.join(tmp, 'seo-run');
    fs.mkdirSync(seoRun);
    fs.writeFileSync(path.join(seoRun, 'report.json'), JSON.stringify({ tool: 'audit-seo', mode: 'site', site: { url: `${base}/`, host: `127.0.0.1:${server.address().port}` }, pages: [
      page(`${base}/`), page(`${base}/insights/what-is-an-ibor`, { sig: { questionHeadings: 2 } }), page(`${base}/legal/terms`),
    ] }));
    const out = path.join(tmp, 'plan');
    const ex = await run(['extract', seoRun, '--out', out, '--no-render', '--competitors', 'b.com'], { AUDIT_OUT_DIR: path.join(tmp, 'reports') });
    assert.equal(ex.code, 0, ex.err);
    assert.match(ex.out, /2 pages read in full/);
    const inv = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'));
    assert.deepEqual(inv.options.competitors, ['b.com']);
    assert.equal(inv.templates.find((t) => t.key === 'insights').example, 'insights-what-is-an-ibor');
    assert.ok(fs.existsSync(path.join(out, 'pages', 'insights-what-is-an-ibor.md')));
    assert.ok(fs.existsSync(path.join(out, '.audit-run')));

    fs.mkdirSync(path.join(out, 'markup'));
    fs.writeFileSync(path.join(out, 'markup', 'insights.jsonld'), JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'What is an IBOR?', datePublished: '2025-03-07', author: { '@type': 'Person', name: 'Jane Doe' }, award: 'Invented award' }));
    fs.writeFileSync(path.join(out, 'markup', 'broken.jsonld'), '{ nope');
    const ck = await run(['check', out, '--no-remote']);
    assert.equal(ck.code, 0, ck.err);
    assert.match(ck.out, /WARN markup\/insights\.jsonld \[Article\]: 1 value\(s\) not on the page: award "Invented award"/);
    assert.match(ck.out, /FAIL markup\/broken\.jsonld: does not parse/);

    fs.writeFileSync(path.join(out, 'markup', 'site.jsonld'), JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', '@id': `${base}/#organization`, name: 'Acme', url: `${base}/` }, { '@type': 'SoftwareApplication', name: 'Acme One' }] }));
    const ck2 = await run(['check', out, '--no-remote']);
    assert.match(ck2.out, /markup\/site\.jsonld .*the site graph is on every page, so move that node/);
    const sm = await run(['samples', out, '--no-remote', '--live']);
    assert.equal(sm.code, 0, sm.err);
    assert.match(sm.err, /skip markup\/broken\.jsonld: does not parse/);
    assert.match(sm.out, /samples\/insights\.html \[Organization, SoftwareApplication, Article\]/);
    assert.match(sm.out, /live copy: insights\.live\.html/);
    const sample = fs.readFileSync(path.join(out, 'samples', 'insights.html'), 'utf8');
    assert.match(sample, /"headline": "What is an IBOR\?"/);
    assert.match(sample, /"name": "Acme"/);
    const live = fs.readFileSync(path.join(out, 'samples', 'insights.live.html'), 'utf8');
    assert.match(live, new RegExp(`<base href="${base}/insights/what-is-an-ibor">`));
    assert.match(live, /What is an IBOR/);
    assert.ok(fs.existsSync(path.join(out, 'samples', 'site.html')), 'the site graph gets its own sample without a home draft');
    assert.match(fs.readFileSync(path.join(out, 'samples', 'README.md'), 'utf8'), /\| \[insights\.html\]\(insights\.html\) · \[live\]\(insights\.live\.html\) \|/);

    fs.mkdirSync(path.join(out, 'content', 'briefs'), { recursive: true });
    fs.writeFileSync(path.join(out, 'content', 'questions.csv'), `question,intent,status,page,brief\nWhat is an IBOR?,definition,answered,${base}/insights/what-is-an-ibor,\nIBOR vs ABOR?,comparison,missing,,01-ibor-abor.md\n`);
    fs.writeFileSync(path.join(out, 'content', 'briefs', '01-ibor-abor.md'), '# IBOR vs ABOR\n');
    fs.writeFileSync(path.join(out, 'summary.md'), 'Add Article markup first.');
    fs.writeFileSync(inv.profile, '# Acme\n\nAcme makes investment software.');
    fs.writeFileSync(path.join(out, 'tasks.json'), JSON.stringify({ tasks: [{ id: 'G1', owner: 'human', title: 'Article markup', fix: 'Follow markup/insights.jsonld', sources: ['plan-geo'] }] }));
    const b = await run(['build', out, '--no-remote']);
    assert.equal(b.code, 0, b.err);
    assert.match(b.out, /Questions: 2 \(1 answered, 0 partly, 1 missing\); 1 brief/);
    const md = fs.readFileSync(path.join(out, 'proposals.md'), 'utf8');
    assert.match(md, /Acme makes investment software\./);
    assert.match(md, /\[samples\/README\.md\]\(samples\/README\.md\)/);
    assert.match(b.out, /samples +.*samples\/README\.md/);
    assert.match(md, /Invented award/);
    assert.ok(fs.existsSync(path.join(out, 'fix', 'TODO.md')));
    assert.ok(fs.existsSync(path.join(out, 'site-profile.md')));
    assert.ok(fs.existsSync(path.join(inv.target, 'last-plan.json')));

    const none = await run(['extract', path.join(tmp, 'nothing-here')]);
    assert.notEqual(none.code, 0);
    assert.match(none.err, /does not exist/);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// validator.schema.org rate-limits a burst: build --samples must reuse the answers this run already
// has (samples first, then check reads them) instead of posting every draft again.
test('build --samples reuses the run\'s validator answers instead of posting every draft again', { timeout: 120000 }, async () => {
  const home = '<html lang="en"><head><title>Acme</title></head><body><main><h1>Acme</h1><p>Acme makes investment software for pension funds.</p></main></body></html>';
  const server = await serve({ '/': home, '/insights/what-is-an-ibor': HTML });
  let posts = 0;
  const answer = `)]}'\n${JSON.stringify({ numObjects: 1, totalNumErrors: 0, totalNumWarnings: 0, tripleGroups: [{ nodes: [{ types: [{ value: 'Article' }] }] }] })}`;
  // Two posts are fine; any more is a burst and gets HTTP 429, as the real validator does.
  const validator = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      posts += 1;
      if (posts > 2) { res.writeHead(429); res.end('slow down'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(answer);
    });
  });
  await new Promise((r) => validator.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { PLAN_GEO_VALIDATOR: `http://127.0.0.1:${validator.address().port}/validate` };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-geo-'));
  try {
    const seoRun = path.join(tmp, 'seo-run');
    fs.mkdirSync(seoRun);
    fs.writeFileSync(path.join(seoRun, 'report.json'), JSON.stringify({ tool: 'audit-seo', mode: 'site', site: { url: `${base}/`, host: `127.0.0.1:${server.address().port}` }, pages: [page(`${base}/`), page(`${base}/insights/what-is-an-ibor`)] }));
    const out = path.join(tmp, 'plan');
    assert.equal((await run(['extract', seoRun, '--out', out, '--no-render'], { AUDIT_OUT_DIR: path.join(tmp, 'reports') })).code, 0);
    const inv = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'));
    fs.mkdirSync(path.join(out, 'markup'));
    fs.writeFileSync(path.join(out, 'markup', 'insights.jsonld'), JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'What is an IBOR?' }));
    fs.writeFileSync(path.join(out, 'markup', 'site.jsonld'), JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme', url: `${base}/` }));
    fs.writeFileSync(path.join(out, 'summary.md'), 'Add Article markup first.');
    fs.writeFileSync(inv.profile, '# Acme\n');
    fs.writeFileSync(path.join(out, 'tasks.json'), JSON.stringify({ tasks: [{ id: 'G1', owner: 'human', title: 'Article markup', fix: 'Follow markup/insights.jsonld', sources: ['plan-geo'] }] }));

    const sm = await run(['samples', out], env);
    assert.equal(sm.code, 0, sm.err);
    assert.equal(posts, 2, 'one post per sample');
    const b = await run(['build', out, '--samples'], env);
    assert.equal(b.code, 0, b.err);
    assert.equal(posts, 2, 'build --samples right after samples posts nothing new');
    assert.doesNotMatch(b.out, /not reached/);
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'samples', 'README.md'), 'utf8'), /not reached/);
    const ck = JSON.parse(fs.readFileSync(path.join(out, 'markup', 'check.json'), 'utf8'));
    assert.deepEqual(ck.drafts.map((d) => [d.slug, d.validator?.via]), [['insights', 'samples/insights.html'], ['site', 'samples/site.html']]);
    assert.ok(ck.drafts.every((d) => d.validator && !d.validator.error && d.validator.errors === 0));
  } finally {
    server.close(); validator.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- archive mode

test('archive.mjs is identical to audit-seo\'s copy', () => {
  const theirs = path.join(SKILLS, 'audit-seo', 'scripts', 'lib', 'archive.mjs');
  if (fs.existsSync(theirs)) assert.equal(fs.readFileSync(path.join(HERE, '..', 'lib', 'archive.mjs'), 'utf8'), fs.readFileSync(theirs, 'utf8'));
});

test('verifyDraft: a masked placeholder is never a value, even when the page shows it', () => {
  const pageRec = { url: 'https://www.example.com/', text: 'Our key is AIza…[masked google-api-key] and we sell examples', title: 'Example', dates: [], urls: [] };
  const issues = verifyDraft({ '@type': 'Organization', name: 'Example', identifier: 'AIza…[masked google-api-key]', logo: 'https://www.example.com/x.png?sig=82ef…[masked]' }, pageRec);
  assert.deepEqual(issues.filter((i) => /masked placeholder/.test(i.reason)).map((i) => i.path).sort(), ['identifier', 'logo']);
});

test('extract --from-archive: archived pages, archived text for thin pages, served HTML only without it, missing pages and masked values', async () => {
  const H = 'https://www.example.com';
  const FIXTURE = path.join(HERE, 'fixtures', 'archive');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-geo-archive-'));
  try {
    const seoRun = path.join(tmp, 'seo-run');
    fs.mkdirSync(seoRun);
    fs.writeFileSync(path.join(seoRun, 'report.json'), JSON.stringify({ tool: 'audit-seo', site: { url: `${H}/`, host: 'www.example.com' }, pages: [
      page(`${H}/`), page(`${H}/about`), page(`${H}/news/launch`), page(`${H}/faq`, { words: 20 }), page(`${H}/contact`, { words: 10 }), page(`${H}/missing`),
    ] }));
    const out = path.join(tmp, 'plan');
    // Without --no-render: a live run would render the thin pages; archive mode must not start Chrome.
    const ex = await run(['extract', seoRun, '--out', out, '--from-archive', FIXTURE], { AUDIT_OUT_DIR: path.join(tmp, 'reports'), CHROME_PATH: '/nonexistent/chrome' });
    assert.equal(ex.code, 0, ex.err);
    assert.match(ex.out, /Built from the archive of 2026-11-10, not the live site: 1 page\(s\) served HTML only, 1 served HTML \+ archived text, 1 not archived/);
    const inv = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'));
    assert.equal(inv.archive.date, '2026-11-10');
    assert.deepEqual(inv.archive.notArchived, [`${H}/missing`]);
    const how = Object.fromEntries(inv.sample.map((s) => [s.slug, s.how]));
    assert.equal(how.contact, 'served HTML only', 'a thin page without hidden text');
    assert.equal(how.faq, 'served HTML + archived text + 26 words only in the archived hidden text');
    assert.match(how.home, /^served HTML \(\d+ masked values? left out\)$/);
    assert.equal(inv.sample.some((s) => s.url === `${H}/missing`), false);
    assert.deepEqual(inv.archive.degraded.map((d) => [d.slug, Boolean(d.partial)]).sort(), [['contact', false], ['faq', true]]);

    // The thin FAQ page: the archived hidden text counts, as the rendered page's would.
    const faq = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'faq.json'), 'utf8'));
    assert.match(faq.text, /Example builds example software/);
    assert.match(faq.hidden.markdown, /### What does Example do\?/);
    assert.ok(faq.dates.includes('2026-11-03'), 'dates are read from the archived text');

    // Masked values are left out of what Claude reads, so no draft can copy one.
    const { how: _how, ...home } = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'home.json'), 'utf8'));
    assert.doesNotMatch(JSON.stringify(home), /masked/);
    assert.equal(home.og.image, undefined, 'an og:image URL with a masked signature is dropped');
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'pages', 'home.md'), 'utf8'), /masked/);
    const about = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'about.json'), 'utf8'));
    assert.doesNotMatch(about.text, /masked/);
    assert.match(about.text, /Contact key:/);

    const md = fs.readFileSync(path.join(out, 'inventory.md'), 'utf8');
    assert.match(md, /\*\*Built from the archive of 2026-11-10, not the live site\.\*\*/);
    assert.match(md, /\*\*Degraded, served HTML only:\*\* pages\/contact\.md/);
    assert.match(md, /\*\*Not archived:\*\* https:\/\/www\.example\.com\/missing/);

    // build: proposals.md carries the same cover.
    fs.writeFileSync(path.join(out, 'tasks.json'), JSON.stringify({ tasks: [] }));
    const b = await run(['build', out, '--no-validate']);
    assert.equal(b.code, 0, b.err);
    const prop = fs.readFileSync(path.join(out, 'proposals.md'), 'utf8');
    assert.match(prop, /\*\*Built from the archive of 2026-11-10, not the live site\.\*\*/);
    assert.match(prop, /\*\*Degraded, served HTML only:\*\* https:\/\/www\.example\.com\/contact/);
    assert.match(prop, /\*\*Not archived:\*\* 1 page/);

    // samples --live reads the archive the plan was built from.
    fs.mkdirSync(path.join(out, 'markup'), { recursive: true });
    fs.writeFileSync(path.join(out, 'markup', 'about.jsonld'), JSON.stringify({ '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About Example' }));
    const sm = await run(['samples', out, '--no-validate', '--live']);
    assert.equal(sm.code, 0, sm.err);
    assert.match(fs.readFileSync(path.join(out, 'samples', 'about.live.html'), 'utf8'), /<base href="https:\/\/www\.example\.com\/about">/);

    const bad = await run(['extract', seoRun, '--allow-live']);
    assert.notEqual(bad.code, 0);
    assert.match(bad.err, /--allow-live only goes with --from-archive/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
