import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schemaValidate, parseSchemaAnswer, stripGuard } from '../lib/schema.mjs';
import { schemaChecks, pickRenderPages } from '../lib/checks.mjs';
import { consoleItems, renderMarkdown } from '../lib/report.mjs';
import { parseCli, localFile } from '../lib/cli.mjs';

const ANSWER = ")]}'\n" + JSON.stringify({
  numObjects: 1, totalNumErrors: 1, totalNumWarnings: 1, html: '<html>echo</html>',
  tripleGroups: [{ nodes: [{ types: [{ value: 'Product' }], errors: [], properties: [{ pred: 'madeUp', errors: [{ errorType: 'INVALID_PREDICATE', args: ['madeUp', 'Product'], isSevere: true }] }], nodeProperties: [{ pred: 'offers', errors: [], target: { types: [{ value: 'Offer' }], properties: [{ pred: 'foo', errors: [{ errorType: 'INVALID_PREDICATE', args: ['foo', 'Offer'], isSevere: false }] }] } }] }] }],
});
const fake = (res) => ({ calls: [], async post(url, opts) { this.calls.push({ url, opts }); return typeof res === 'function' ? res() : res; } });

test('schemaValidate posts url= or html=, strips the guard and the echoed html', async () => {
  const http = fake({ status: 200, ok: true, body: ANSWER });
  const r = await schemaValidate(http, { url: 'https://x.dk/' });
  assert.equal(http.calls[0].opts.body, 'url=https%3A%2F%2Fx.dk%2F');
  assert.equal(r.ok, true); assert.equal(r.mode, 'url');
  assert.deepEqual(r.types, ['Product']);
  assert.equal(r.nodes[0].errors[0].property, 'madeUp');
  assert.equal(r.nodes[0].warnings[0].property, 'offers.foo', 'nested warnings carry a dotted path');
  assert.equal('html' in r.raw, false);
  await schemaValidate(http, { html: '<p>&</p>' });
  assert.equal(http.calls[1].opts.body, 'html=%3Cp%3E%26%3C%2Fp%3E');
  assert.equal(stripGuard(")]}'\n{}"), '{}');
  assert.match(parseSchemaAnswer('<html>').error, /JSON/);
});

test('schemaValidate never throws', async () => {
  assert.equal((await schemaValidate(fake({ status: 0, ok: false, error: 'ECONNRESET' }), { url: 'https://x.dk/' })).error, 'ECONNRESET');
  assert.match((await schemaValidate(fake({ status: 429, ok: false }), { url: 'https://x.dk/' })).error, /rate limited/);
  assert.equal((await schemaValidate(fake(() => { throw new Error('boom'); }), { url: 'https://x.dk/' })).error, 'boom');
  assert.equal((await schemaValidate(fake({}), {})).ok, false);
});

test('schema.mjs is identical to audit-launch\'s copy', () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const mine = fs.readFileSync(path.join(here, '..', 'lib', 'schema.mjs'), 'utf8');
  const theirs = path.join(here, '..', '..', '..', 'audit-launch', 'scripts', 'lib', 'schema.mjs');
  if (fs.existsSync(theirs)) assert.equal(fs.readFileSync(theirs, 'utf8'), mine);
});

const pg = (url, jsonLd = [], extra = {}) => ({ url, status: 200, title: 't', noindex: false, canonical: null, jsonLd, ...extra });

test('schemaChecks reports JSON-LD that JavaScript adds, and when rendering did not run', () => {
  const pages = [pg('https://x.dk/', [{ types: ['Organization'], error: null }]), pg('https://x.dk/a')];
  const gained = schemaChecks({ pages, schema: null, render: { ran: true, pages: [{ url: 'https://x.dk/', ok: true, added: 1 }, { url: 'https://x.dk/a', ok: true, added: 0 }] } });
  const row = gained.find((r) => r.id === 'seo.jsonld-client-side');
  assert.equal(row.status, 'warn'); assert.equal(row.area, 'schema');
  assert.match(row.evidence, /1 page of 2 rendered in Chrome adds/);
  assert.equal(schemaChecks({ pages, render: { ran: true, pages: [{ url: 'https://x.dk/', ok: true, added: 0 }] } }).find((r) => r.id === 'seo.jsonld-client-side').status, 'pass');
  const noChrome = schemaChecks({ pages, render: { ran: false, error: 'no Chrome found', pages: [] } }).find((r) => r.id === 'seo.jsonld-client-side');
  assert.equal(noChrome.status, 'skip'); assert.match(noChrome.evidence, /no Chrome/);
  assert.equal(schemaChecks({ pages }).find((r) => r.id === 'seo.jsonld-client-side'), undefined, 'no row when the caller has no render pass');
});

test('detailed schemaChecks lists every validator issue, and the console shows one line each', () => {
  const parsed = parseSchemaAnswer(ANSWER);
  const pages = [pg('file:///tmp/a.html', [{ types: ['Product'], error: null }])];
  const rows = schemaChecks({ pages, schema: [{ url: pages[0].url, ok: true, ...parsed }], detailed: true });
  const v = rows.find((r) => r.id === 'seo.schema-validator');
  assert.equal(v.status, 'fail');
  assert.deepEqual(v.urls.map((u) => u.note), ['ERROR Product madeUp: INVALID_PREDICATE (madeUp, Product)', 'WARN Product offers.foo: INVALID_PREDICATE (foo, Offer)']);
  const report = { mode: 'schema', tool: 'audit-seo', version: 'x', date: '2026-11-01', site: { url: 'a.html', finalUrl: '/tmp/a.html', host: 'file-a.html' }, env: {}, stats: { html: 1 }, rows, pages };
  const items = consoleItems(report).filter((i) => i.id === 'schema-validator');
  assert.deepEqual(items.map((i) => i.level), ['error', 'warn']);
  assert.match(renderMarkdown(report), /\*\*Checked:\*\* structured data on this one page only \(a local file\)/);
});

test('pickRenderPages: start page first, then pages without JSON-LD, one per section', () => {
  const ld = [{ types: ['X'], error: null }];
  const pages = [pg('https://x.dk/blog/1'), pg('https://x.dk/', ld), pg('https://x.dk/blog/2'), pg('https://x.dk/shop/1', ld), pg('https://x.dk/shop/2'), pg('https://x.dk/about', [], { noindex: true })];
  assert.deepEqual(pickRenderPages(pages, 'https://x.dk/', 8), ['https://x.dk/', 'https://x.dk/blog/1', 'https://x.dk/shop/2']);
  assert.deepEqual(pickRenderPages(pages, 'https://x.dk/', 1), ['https://x.dk/']);
  assert.deepEqual(pickRenderPages(pages, 'https://x.dk/', 0), []);
});

test('a local file argument means structured data only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-'));
  const f = path.join(dir, 'Index Page.html');
  fs.writeFileSync(f, '<html></html>');
  assert.equal(localFile('Index Page.html', dir), f);
  assert.equal(localFile(`file://${f}`), f);
  assert.equal(localFile('https://x.dk/', dir), null);
  assert.equal(localFile('nope.html', dir), null);
  const p = parseCli(['Index Page.html'], {}, { cwd: dir });
  assert.equal(p.ok, true);
  assert.equal(p.opts.file, f); assert.equal(p.opts.schemaOnly, true);
  assert.equal(p.opts.host, 'file-index-page.html');
  assert.match(p.opts.url, /^file:\/\//);
  const u = parseCli(['example.dk', '--schema-only', '--render-pages', '0'], {}, { cwd: dir });
  assert.equal(u.opts.schemaOnly, true); assert.equal(u.opts.renderPages, 0); assert.equal(u.opts.file, null);
  assert.equal(parseCli(['example.dk'], {}, { cwd: dir }).opts.renderPages, 8);
  fs.rmSync(dir, { recursive: true });
});
