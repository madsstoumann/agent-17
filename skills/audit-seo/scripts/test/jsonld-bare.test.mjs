import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMeta, bareJsonLd } from '../lib/html.mjs';
import { pageRecord } from '../lib/crawl.mjs';
import { schemaChecks } from '../lib/checks.mjs';
import { geoScore, isGeoRow } from '../lib/geo.mjs';

// A product page whose server model is serialised with PascalCase names: the @ is gone.
const BARE = '{"Context":"http://schema.org","Type":"Product","Name":"Example 100 GB","Offers":{"Type":"Offer","Price":"99","PriceCurrency":"DKK"}}';
const GOOD = '{"@context":"https://schema.org","@type":"Organization","name":"Example","url":"https://www.example.dk/"}';
const page = (url, blocks) => pageRecord(url, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  `<!doctype html><html lang="da"><head><title>${url}</title><link rel="canonical" href="${url}">${blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join('')}</head><body><h1>Side</h1><p>Tekst.</p></body></html>`);

test('bareJsonLd finds Context/Type keys without the @ and their meant types', () => {
  assert.deepEqual(bareJsonLd(JSON.parse(BARE)), ['Product', 'Offer']);
  assert.equal(bareJsonLd(JSON.parse(GOOD)), null);
  assert.equal(bareJsonLd({ type: 'module', name: 'x' }), null, 'lower-case type values are not schema.org types');
  assert.equal(bareJsonLd({ '@context': 'https://schema.org', Type: 'Product' }), null, 'a block with @context is not bare');
  const m = extractMeta(`<script type="application/ld+json">${BARE}</script>`, 'https://www.example.dk/');
  assert.deepEqual(m.jsonLd[0].types, []);
  assert.equal(m.jsonLd[0].error, null);
  assert.deepEqual(m.jsonLd[0].bare, ['Product', 'Offer']);
});

test('seo.jsonld-bare fails and lists the pages; coverage does not count them; GEO readiness counts the row', () => {
  const pages = [
    page('https://www.example.dk/', [GOOD]),
    page('https://www.example.dk/abonnement/a', [BARE]),
    page('https://www.example.dk/abonnement/b', [BARE]),
  ];
  assert.deepEqual(pages[1].jsonLd, [{ types: [], error: null, bare: ['Product', 'Offer'] }]);
  const rows = schemaChecks({ pages, schema: null, render: null });
  const bare = rows.find((r) => r.id === 'seo.jsonld-bare');
  assert.equal(bare.status, 'fail');
  assert.match(bare.evidence, /2 pages with a JSON-LD block whose keys look like Context\/Type/);
  assert.deepEqual(bare.urls.map((u) => u.url), ['https://www.example.dk/abonnement/a', 'https://www.example.dk/abonnement/b']);
  const cov = rows.find((r) => r.id === 'seo.jsonld-coverage');
  assert.match(cov.evidence, /^1 of 3 indexable pages carry JSON-LD: Organization ×1; 2 more pages only without @context\/@type/);
  assert.equal(cov.urls[0].note, 'JSON-LD without @context/@type only');
  assert.equal(isGeoRow(bare), true);
  const withBare = geoScore(rows).score;
  const without = geoScore(rows.filter((r) => r.id !== 'seo.jsonld-bare')).score;
  assert.ok(withBare < without);
});

test('no seo.jsonld-bare row when every block has @context/@type', () => {
  const rows = schemaChecks({ pages: [page('https://www.example.dk/', [GOOD])], schema: null, render: null });
  assert.equal(rows.find((r) => r.id === 'seo.jsonld-bare'), undefined);
});
