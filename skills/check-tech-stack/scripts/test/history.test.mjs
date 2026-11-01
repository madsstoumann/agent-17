import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diff, compareAndSave, historyFile } from '../lib/history.mjs';
import { markdown, siteLine } from '../lib/report.mjs';

const tech = (name, version = null, category = 'js-library') => ({ name, version, category, categoryLabel: 'JavaScript library', confidence: 'detected', evidence: ['x'] });
const result = (techs, extra = {}) => ({ url: 'https://www.example.com/', finalUrl: 'https://www.example.com/', status: 200, redirects: [], assetStats: { scripts: 1, styles: 1, fetched: 1 }, browser: false, errors: [], technologies: techs, ...extra });

test('diff finds new, gone and changed versions, and says when the last run looked harder', () => {
  const prev = { generatedAt: '2026-10-01T00:00:00Z', browser: true, pages: 0, technologies: [tech('jQuery', '3.5.1'), tech('Hotjar'), tech('Nginx')] };
  const curr = { generatedAt: '2026-11-01T00:00:00Z', browser: false, pages: 0, technologies: [tech('jQuery', '3.7.1'), tech('Nginx'), tech('Next.js')] };
  const d = diff(prev, curr);
  assert.deepEqual(d.added.map((t) => t.name), ['Next.js']);
  assert.deepEqual(d.removed.map((t) => t.name), ['Hotjar']);
  assert.deepEqual(d.changed, [{ name: 'jQuery', category: 'js-library', from: '3.5.1', to: '3.7.1' }]);
  assert.deepEqual(d.weaker, ['the last run used the browser']);
});

test('compareAndSave keeps one last.json per host and skips failed and blocked sites', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cts-'));
  const first = [result([tech('jQuery', '3.5.1'), tech('Possible thing')]), { url: 'https://down.example/', error: 'ENOTFOUND', technologies: [] }, result([], { url: 'https://b.example/', finalUrl: 'https://b.example/', challenge: 'Cloudflare challenge' })];
  first[0].technologies[1].confidence = 'possible';
  compareAndSave(first, root, { generatedAt: '2026-10-01T00:00:00Z' });
  const saved = JSON.parse(fs.readFileSync(historyFile(root, 'www.example.com'), 'utf8'));
  assert.deepEqual(saved.technologies.map((t) => t.name), ['jQuery'], 'only detected technologies are kept');
  assert.equal(first[0].changes, undefined, 'nothing to compare the first time');
  assert.ok(!fs.existsSync(path.join(root, 'check-tech-stack', 'b.example')));
  assert.ok(!fs.existsSync(path.join(root, 'check-tech-stack', 'down.example')));

  const second = [result([tech('jQuery', '3.7.1'), tech('Next.js', null, 'meta-framework')])];
  compareAndSave(second, root, { generatedAt: '2026-11-01T00:00:00Z' });
  assert.equal(second[0].changes.since, '2026-10-01T00:00:00Z');
  const md = markdown(second, { generatedAt: '2026-11-01T00:00:00Z' });
  assert.match(md, /Changes since the last run \(2026-10-01\):/);
  assert.match(md, /- New: Next\.js/);
  assert.match(md, /- Version: jQuery 3\.5\.1 → 3\.7\.1/);
  assert.match(siteLine(second[0]), /since 2026-10-01: \+1 1 version changed$/);
});

test('report shows latest version, other pages, and why the browser ran', () => {
  const r = result([{ ...tech('jQuery', '1.12.4'), latest: '3.7.1', behind: 'major' }, { ...tech('Shopify', null, 'ecommerce'), pages: ['shop.example.com/'] }],
    { browser: true, autoBrowser: 'the page is an empty app shell', pages: [{ url: 'https://shop.example.com/', status: 200 }] });
  const md = markdown([r], { generatedAt: '2026-11-01T00:00:00Z' });
  assert.match(md, /\| jQuery \| 1\.12\.4 \(latest 3\.7\.1\) \|/);
  assert.match(md, /jQuery 1\.12\.4 → 3\.7\.1 \(major update available\)/);
  assert.match(md, /Shopify <sub>\(shop\.example\.com\/\)<\/sub>/);
  assert.match(md, /rendered in a headless browser because the page is an empty app shell/);
  assert.match(md, /- Also read: https:\/\/shop\.example\.com\//);
});
