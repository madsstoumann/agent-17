import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richIssues, richTypes, richOf, prop, RICH_TEST } from '../lib/rich.mjs';
import { schemaChecks } from '../lib/checks.mjs';

const byType = (list, t) => list.find((x) => x.type === t);

test('Product: name, and offers or review or aggregateRating, and a price on each offer', () => {
  const none = byType(richIssues([{ '@type': 'Product', name: 'Mug' }]), 'Product');
  assert.deepEqual(none.required, ['offers|review|aggregateRating']);
  const noPrice = byType(richIssues([{ '@type': 'Product', name: 'Mug', offers: { '@type': 'Offer', priceCurrency: 'DKK' } }]), 'Product');
  assert.deepEqual(noPrice.required, ['offers.price']);
  const agg = byType(richIssues([{ '@type': 'Product', name: 'Mug', offers: { '@type': 'AggregateOffer', highPrice: 9 } }]), 'Product');
  assert.deepEqual(agg.required, ['offers.lowPrice']);
  const full = richIssues([{ '@type': 'Product', name: 'Mug', image: 'a.jpg', description: 'd', brand: 'b', gtin13: '5701234567890', offers: { '@type': 'Offer', price: '10', priceCurrency: 'DKK', availability: 'InStock' } }]);
  assert.deepEqual(full, [], 'gtin13 counts as gtin');
});

test('nested and @graph nodes are checked; a nested Organization and bare @id references are not', () => {
  const issues = richIssues([{ '@context': 'https://schema.org', '@graph': [
    { '@type': 'Organization', name: 'A' },
    { '@type': 'Article', headline: 'h', image: 'i', datePublished: '2026-01-01', dateModified: '2026-01-02', author: { '@type': 'Organization', name: 'B' }, publisher: { '@id': '#org', '@type': 'Organization' } },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: '/' }, { '@type': 'ListItem', position: 2 }] },
  ] }]);
  assert.deepEqual(issues.map((i) => i.type), ['Organization', 'BreadcrumbList']);
  assert.deepEqual(byType(issues, 'Organization').recommended, ['url', 'logo']);
  assert.deepEqual(byType(issues, 'BreadcrumbList').required, ['itemListElement[1].name'], 'the last crumb may leave out item');
});

test('Event, FAQ note, HowTo note and schema.org/ prefixed types', () => {
  assert.deepEqual(byType(richIssues([{ '@type': 'https://schema.org/Event', name: 'Gig' }]), 'Event').required, ['startDate', 'location']);
  const faq = richIssues([{ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Q?' }] }]);
  assert.match(faq[0].note, /government and health/);
  assert.deepEqual(faq[0].required, ['mainEntity[0].acceptedAnswer.text']);
  assert.match(richIssues([{ '@type': 'HowTo', name: 'x' }])[0].note, /no longer/);
  assert.deepEqual(richTypes([{ '@type': 'HowTo' }, { '@type': 'Event' }]), ['Event']);
  assert.deepEqual(richOf([{ data: { '@type': 'Event', name: 'x', startDate: 'd', location: 'l' }, error: null }, { data: null, error: 'bad' }]).richTypes, ['Event']);
  assert.equal(prop('sku|gtin|mpn'), 'sku or gtin or mpn');
  assert.match(RICH_TEST('https://x.dk/'), /search\.google\.com\/test\/rich-results\?url=https%3A/);
});

test('schemaChecks: rich-required warns per page, passes when complete, says nothing without rich markup', () => {
  const pg = (url, data) => ({ url, status: 200, title: 't', noindex: false, canonical: null, jsonLd: [{ types: [data['@type']], error: null }], ...richOf([{ data, error: null }]) });
  const rows = schemaChecks({ pages: [pg('https://x.dk/p', { '@type': 'Product', name: 'Mug' }), pg('https://x.dk/e', { '@type': 'Event', name: 'e', startDate: 'd', location: 'l' })] });
  const req = rows.find((r) => r.id === 'seo.rich-required');
  assert.equal(req.status, 'warn');
  assert.match(req.evidence, /1 page of 2/);
  assert.equal(req.urls[0].note, 'Product: offers or review or aggregateRating');
  assert.match(req.fix, /rich-results\?url=/);
  assert.equal(schemaChecks({ pages: [pg('https://x.dk/e', { '@type': 'Event', name: 'e', startDate: 'd', location: 'l' })] }).find((r) => r.id === 'seo.rich-required').status, 'pass');
  assert.equal(schemaChecks({ pages: [pg('https://x.dk/w', { '@type': 'WebSite', name: 'w' })] }).find((r) => r.id.startsWith('seo.rich')), undefined);
  const detailed = schemaChecks({ detailed: true, pages: [pg('https://x.dk/p', { '@type': 'Product', name: 'Mug' })] }).find((r) => r.id === 'seo.rich-required');
  assert.equal(detailed.urls[0].note, 'WARN Product offers or review or aggregateRating: required by Google for the rich result');
});
