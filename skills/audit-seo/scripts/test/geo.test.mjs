import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLlmsTxt, contentSignals, geoChecks } from '../lib/geo.mjs';
import { parseRobotsTxt } from '../lib/robots.mjs';

const byId = (rows, id) => rows.find((r) => r.id === id);
const robots = (text) => ({ status: 200, parsed: parseRobotsTxt(text) });
const geo = (llms, links = []) => ({ llms: { status: llms ? 200 : 404, text: llms }, llmsFull: { status: 404, present: false, bytes: 0 }, aiTxt: { status: 404, present: false }, linkChecks: links });

test('parseLlmsTxt reads the title, summary, sections and links', () => {
  const l = parseLlmsTxt('# Shop\n\n> Danish furniture.\n\n## Docs\n\n- [Returns](https://shop.dk/returns): how to return\n- [FAQ](/faq)\n\n## Optional\n');
  assert.equal(l.title, 'Shop');
  assert.equal(l.summary, true);
  assert.deepEqual(l.sections, ['Docs', 'Optional']);
  assert.deepEqual(l.links.map((x) => x.url), ['https://shop.dk/returns', '/faq']);
  assert.equal(parseLlmsTxt('Shop\n[a](/a)').title, null);
});

test('contentSignals reads Content-Signal lines', () => {
  assert.deepEqual(contentSignals('User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\n'), ['search=yes, ai-train=no']);
});

test('blocking an AI search crawler warns, blocking only training crawlers is info', () => {
  const answer = geoChecks({ robots: robots('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n') });
  assert.equal(byId(answer, 'seo.ai-crawlers').status, 'warn');
  assert.match(byId(answer, 'seo.ai-crawlers').evidence, /OAI-SearchBot/);
  const training = geoChecks({ robots: robots('User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n') });
  assert.equal(byId(training, 'seo.ai-crawlers').status, 'info');
  assert.match(byId(training, 'seo.ai-crawlers').evidence, /2 training crawlers/);
  assert.equal(byId(geoChecks({ robots: robots('User-agent: *\nDisallow: /admin\n') }), 'seo.ai-crawlers').status, 'pass');
  assert.match(byId(geoChecks({ robots: robots('User-agent: *\nDisallow: /\n') }), 'seo.ai-crawlers').evidence, /every crawler/);
});

test('an unreadable robots.txt is a skip, a missing one is info', () => {
  assert.equal(byId(geoChecks({ robots: { status: 403, parsed: null } }), 'seo.ai-crawlers').status, 'skip');
  assert.equal(byId(geoChecks({ robots: { status: 404, parsed: null } }), 'seo.ai-crawlers').status, 'info');
});

test('llms.txt: missing is info, malformed or with broken links warns, well-formed passes', () => {
  assert.equal(byId(geoChecks({ geo: geo(null) }), 'seo.llms-txt').status, 'info');
  assert.equal(byId(geoChecks({ geo: geo('Just text') }), 'seo.llms-txt').status, 'warn');
  const broken = byId(geoChecks({ geo: geo('# Shop\n- [A](/a)', [{ url: 'https://shop.dk/a', status: 404 }]) }), 'seo.llms-txt');
  assert.equal(broken.status, 'warn');
  assert.equal(broken.urls[0].url, 'https://shop.dk/a');
  assert.equal(byId(geoChecks({ geo: geo('# Shop\n> Hi\n## Docs\n- [A](/a)', [{ url: 'https://shop.dk/a', status: 200 }]) }), 'seo.llms-txt').status, 'pass');
});

test('entity markup wants Organization and WebSite on the start page', () => {
  const start = (types) => ({ url: 'https://shop.dk/', title: 'x', jsonLd: [{ types }] });
  assert.equal(byId(geoChecks({ start: start(['Organization', 'WebSite']) }), 'seo.entity-markup').status, 'pass');
  assert.equal(byId(geoChecks({ start: start(['Museum', 'WebSite']) }), 'seo.entity-markup').status, 'pass');
  const r = byId(geoChecks({ start: start(['BreadcrumbList']) }), 'seo.entity-markup');
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /Organization.*WebSite/);
});
