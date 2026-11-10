import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openArchive, archiveHttp, archiveSlug, hasMask, countMasks, stripMasks, createArchiveWriter } from '../lib/archive.mjs';
import { applyArchiveMode, ARCHIVE_SKIPPED } from '../lib/offline.mjs';
import { result } from '../lib/checks.mjs';
import { parseCli } from '../lib/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'archive');
const SEO = path.join(HERE, '..', 'seo.mjs');
const H = 'https://www.example.com';

function run(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SEO, ...args], { env: { ...process.env, ...env } });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audit-seo-archive-'));
const rowOf = (report, id) => report.rows.find((r) => r.id === id);

test('archive.mjs is identical to plan-geo\'s copy', () => {
  const theirs = path.join(HERE, '..', '..', '..', 'plan-geo', 'scripts', 'lib', 'archive.mjs');
  if (fs.existsSync(theirs)) assert.equal(fs.readFileSync(theirs, 'utf8'), fs.readFileSync(path.join(HERE, '..', 'lib', 'archive.mjs'), 'utf8'));
});

test('archiveSlug: path with --, home, a sha1 of the query, -x when taken', () => {
  const used = new Set();
  assert.equal(archiveSlug(`${H}/`, used), 'home');
  assert.equal(archiveSlug(`${H}/news/2026/launch`, used), 'news--2026--launch');
  assert.equal(archiveSlug(`${H}/news/2026/launch/`, used), 'news--2026--launch-x');
  assert.equal(archiveSlug(`http://${'www.example.com'}/`, used), 'home-x');
  assert.match(archiveSlug(`${H}/search?q=a&page=2`), /^search--[0-9a-f]{8}$/);
  assert.equal(archiveSlug(`${H}/search?q=a`), archiveSlug(`${H}/search?q=a`));
  assert.notEqual(archiveSlug(`${H}/search?q=a`), archiveSlug(`${H}/search?q=b`));
});

test('masked placeholders: found with and without a type, percent-encoded too, and stripped', () => {
  assert.equal(hasMask('signature=82ef…[masked]'), true);
  assert.equal(hasMask('"apiKey":"AIza…[masked google-api-key]"'), true);
  assert.equal(hasMask(`${H}/download?token=abcd%E2%80%A6[masked%20token]`), true);
  assert.equal(hasMask('An ellipsis… [not masked]'), false);
  assert.equal(hasMask('plain text'), false);
  assert.equal(countMasks('a 1234…[masked] b 5678…[masked jwt] c'), 2);
  assert.equal(stripMasks('key: sk_l…[masked stripe-key].'), 'key: .');
});

test('openArchive and archiveHttp: an archived page, a redirect, a missing URL, a masked URL', async () => {
  const archive = openArchive(FIXTURE);
  assert.equal(archive.date, '2026-11-10');
  assert.equal(archive.host, 'www.example.com');
  assert.equal(archive.size, 6);
  const h = archiveHttp(archive);

  const home = await h.get(`${H}/`, { redirect: 'manual' });
  assert.equal(home.status, 200);
  assert.match(home.contentType, /text\/html/);
  assert.match(home.body, /<title>Example<\/title>/);
  assert.equal(home.ms, null, 'no timing in archive mode');

  // The redirect as served (not followed), then followed inside the archive.
  const old = await h.get(`${H}/old`, { redirect: 'manual' });
  assert.equal(old.status, 301);
  assert.equal(old.headers.location, '/about');
  const followed = await h.get(`${H}/old`, { redirect: 'follow' });
  assert.equal(followed.status, 200);
  assert.equal(followed.finalUrl, `${H}/about`);
  assert.equal(followed.redirected, true);

  const missing = await h.get(`${H}/missing`);
  assert.equal(missing.status, 0);
  assert.equal(missing.error, 'not archived');
  assert.ok(archive.notArchived.has(`${H}/missing`));

  const masked = await h.get(`${H}/download?token=abcd…[masked token]`);
  assert.equal(masked.error, 'masked placeholder');
  assert.equal(archive.notArchived.has(`${H}/download?token=abcd…[masked token]`), false, 'a masked URL is not "not archived"');

  const buf = await h.get(`${H}/`, { as: 'buffer' });
  assert.ok(Buffer.isBuffer(buf.body));
  assert.equal(archive.text(`${H}/faq`).includes('Example City'), true);
  assert.match(archive.hidden(`${H}/faq`), /### What does Example do\?/);
  assert.equal(archive.hidden(`${H}/contact`), null, 'a page without hidden text');
});

test('archiveHttp --allow-live: only what the archive lacks goes live, never a masked URL', async () => {
  const archive = openArchive(FIXTURE);
  const asked = [];
  const live = { request: async (url) => { asked.push(url); return { url, finalUrl: url, status: 200, ok: true, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *', contentType: 'text/plain' }; } };
  const h = archiveHttp(archive, { live, allowLive: true });
  assert.equal((await h.get(`${H}/robots.txt`)).body, 'User-agent: *');
  assert.equal((await h.get(`${H}/`)).status, 200);
  assert.equal((await h.get(`${H}/x?k=1234…[masked]`)).status, 0);
  assert.deepEqual(asked, [`${H}/robots.txt`]);
  assert.deepEqual([...archive.live], [`${H}/robots.txt`]);
  assert.equal(archive.notArchived.size, 0);
});

test('openArchive: a folder without index.json is an error', () => {
  const dir = tmp();
  try { assert.throws(() => openArchive(dir), /no index\.json/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('createArchiveWriter: index fields, gzip bodies, redirects keep their location', () => {
  const dir = tmp();
  try {
    const w = createArchiveWriter(dir, { host: 'www.example.com', source: 'test', date: '2026-11-10' });
    w.add({ url: `${H}/a`, status: 200, contentType: 'text/html', body: '<title>A</title>', title: 'A' });
    w.add({ url: `${H}/a`, status: 200, contentType: 'text/html', body: 'second copy is ignored' });
    w.add({ url: `${H}/b`, status: 308, contentType: 'text/plain', location: '/a', body: 'Moved' });
    w.add({ url: `${H}/sitemap.xml.gz`, status: 200, contentType: 'application/gzip', body: zlib.gzipSync('<urlset></urlset>') });
    assert.equal(w.finish().count, 3);
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    assert.deepEqual(Object.keys(idx), ['host', 'date', 'source', 'redaction', 'count', 'pages']);
    const [a, b, sm] = idx.pages;
    assert.deepEqual(Object.keys(a), ['url', 'status', 'content_type', 'fetched_at', 'bytes', 'sha256', 'title', 'files', 'redactions']);
    assert.match(a.fetched_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(a.bytes, 16);
    assert.equal(b.location, '/a');
    assert.deepEqual(a.files, ['a.html.gz']);
    const back = openArchive(dir);
    assert.equal(back.body(`${H}/a`), '<title>A</title>');
    assert.equal(zlib.gunzipSync(back.bytes(`${H}/sitemap.xml.gz`)).toString(), '<urlset></urlset>', 'binary bodies survive');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('applyArchiveMode: network rows skipped, file rows skipped only when the file is missing, degraded rows say so', () => {
  const rows = [
    result('seo.broken-external', 'warn', 'Broken external links', '3 dead', { urls: [{ url: 'https://example.org/' }] }),
    result('seo.robots-txt', 'fail', 'robots.txt', 'no answer'),
    result('seo.sitemap', 'pass', 'XML sitemap', '10 URLs'),
    result('seo.broken-internal', 'warn', 'Broken internal links', '1 URL answers 404', { urls: [{ url: `${H}/x` }] }),
    result('seo.title-missing', 'pass', 'Missing titles', 'all 5 pages have a title'),
  ];
  const a = applyArchiveMode(rows, { robots: false, sitemap: true, llms: false });
  const by = (id) => a.rows.find((r) => r.id === id);
  assert.equal(by('seo.broken-external').status, 'skip');
  assert.deepEqual(by('seo.broken-external').urls, []);
  assert.match(by('seo.broken-external').evidence, /^skipped: archive mode/);
  assert.equal(by('seo.robots-txt').status, 'skip');
  assert.match(by('seo.robots-txt').evidence, /robots\.txt is not in the archive/);
  assert.equal(by('seo.sitemap').status, 'pass', 'an archived sitemap is read');
  assert.equal(by('seo.broken-internal').status, 'warn');
  assert.match(by('seo.broken-internal').evidence, /\(archive mode: statuses as archived/);
  assert.equal(by('seo.title-missing').evidence, 'all 5 pages have a title', 'HTML checks are untouched');
  for (const id of Object.keys(ARCHIVE_SKIPPED)) assert.equal(by(id)?.status, 'skip', `${id} is named as skipped`);
  assert.ok(a.skipped.some((s) => s.id === 'seo.llms-txt'));
  assert.match(a.skipped.find((s) => s.id === 'seo.ai-txt').why, /^ai\.txt is not in the archive/, 'each file row names its own file');
  assert.match(a.skipped.find((s) => s.id === 'seo.llms-full').why, /^llms-full\.txt is not/);
  assert.deepEqual(a.degraded.map((d) => d.id), ['seo.broken-internal']);
});

test('cli: --from-archive without a URL, --allow-live and --save-html combinations, --no-validate', () => {
  const p = parseCli(['--from-archive', FIXTURE]);
  assert.equal(p.ok, true, p.error);
  assert.equal(p.opts.url, `${H}/`);
  assert.equal(p.opts.fromArchive, FIXTURE);
  assert.equal(parseCli([`${H}/`, '--allow-live']).ok, false);
  assert.equal(parseCli([`${H}/`, '--from-archive', FIXTURE, '--save-html', '/tmp/x']).ok, false);
  assert.equal(parseCli([`${H}/`, '--no-validate']).opts.noRemote, true);
  assert.equal(parseCli([`${H}/`]).opts.noRemote, false);
});

test('seo.mjs --from-archive: pages from the archive only, skipped and degraded checks named, masked values are not findings', async () => {
  const dir = tmp();
  try {
    const r = await run(['--from-archive', FIXTURE, '--no-validate', '--out', path.join(dir, 'run')], { AUDIT_OUT_DIR: dir });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Built from the archive of 2026-11-10, not the live site/);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'report.json'), 'utf8'));
    assert.deepEqual(report.pages.map((p) => p.url).sort(), [`${H}/`, `${H}/about`, `${H}/contact`, `${H}/faq`, `${H}/news/launch`, `${H}/old`]);
    assert.equal(report.pages.find((p) => p.url === `${H}/old`).location, `${H}/about`);
    assert.ok(report.archive.notArchived.includes(`${H}/missing`), 'the missing URL is reported, not fetched');
    assert.equal(report.archive.notArchived.some((u) => /masked/.test(decodeURIComponent(u))), false);
    assert.equal(report.archive.masked, 4);
    assert.equal(report.pages.some((p) => /masked/.test(decodeURIComponent(p.url))), false, 'a masked link is never crawled');
    // No finding points at a masked value or at a URL the archive does not hold.
    for (const row of report.rows) for (const u of row.urls) assert.doesNotMatch(decodeURIComponent(u.url), /masked|\/missing$/, `${row.id} lists ${u.url}`);
    assert.equal(rowOf(report, 'seo.broken-internal').status, 'pass');
    assert.equal(rowOf(report, 'seo.redirect-chains').status, 'skip');
    assert.equal(rowOf(report, 'seo.og-image').status, 'skip');
    assert.equal(rowOf(report, 'seo.title-missing').status, 'pass');
    const md = fs.readFileSync(path.join(dir, 'run', 'report.md'), 'utf8');
    assert.match(md, /\*\*Built from the archive of 2026-11-10, not the live site\.\*\*/);
    assert.match(md, /\*\*Skipped \(archive mode\):\*\* .*Redirect chains/);
    assert.match(md, /\*\*Degraded \(archive mode\):\*\* .*Broken internal links/);
    // An archive run keeps its own baseline, so a live run never compares with it.
    const state = path.join(dir, 'audit-seo', 'www.example.com');
    assert.ok(fs.existsSync(path.join(state, 'last-archive-report.json')));
    assert.equal(fs.existsSync(path.join(state, 'last-report.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('seo.mjs --save-html then --from-archive: same pages, same HTML checks, site files archived too', async () => {
  const pages = {
    '/': { status: 200, type: 'text/html', body: '<!doctype html><html lang="en"><head><title>Example home page</title><meta name="description" content="The example home page for the save-html round trip test."><link rel="canonical" href="/"></head><body><main><h1>Home</h1><p>Welcome. <a href="/a">A</a> <a href="/old">Old</a> <a href="/gone">Gone</a></p></main></body></html>' },
    '/a': { status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><html lang="en"><head><title>Page A of the example</title><meta name="description" content="Page A of the example site for the save-html round trip test."></head><body><main><h1>A</h1><p>Text.</p></main></body></html>' },
    '/old': { status: 301, type: 'text/plain', body: 'Moved', location: '/a' },
    '/gone': { status: 404, type: 'text/html', body: '<html><head><title>Not found</title></head><body>404</body></html>' },
    '/robots.txt': { status: 200, type: 'text/plain', body: 'User-agent: *\nAllow: /\n' },
    '/sitemap.xml': { status: 200, type: 'application/xml', body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>BASE/</loc></url><url><loc>BASE/a</loc></url></urlset>' },
  };
  const server = http.createServer((req, res) => {
    const p = pages[req.url];
    if (!p) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no'); return; }
    res.writeHead(p.status, { 'content-type': p.type, ...(p.location ? { location: p.location } : {}) });
    res.end(p.body.replaceAll('BASE', `http://127.0.0.1:${server.address().port}`));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = tmp();
  const quick = ['--no-validate', '--render-pages', '0', '--bot-pages', '0', '--external-links', '0', '--no-baseline'];
  try {
    const live = await run([`${base}/`, ...quick, '--out', path.join(dir, 'live'), '--save-html', path.join(dir, 'archive')], { AUDIT_OUT_DIR: dir });
    assert.equal(live.code, 0, live.err);
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'archive', 'index.json'), 'utf8'));
    const urls = idx.pages.map((p) => p.url);
    for (const p of ['/', '/a', '/old', '/gone', '/robots.txt', '/sitemap.xml']) assert.ok(urls.includes(`${base}${p}`), `${p} archived`);
    assert.equal(idx.pages.find((p) => p.url === `${base}/old`).location, '/a');
    assert.equal(idx.pages.find((p) => p.url === `${base}/`).title, 'Example home page');
    assert.equal(idx.pages.find((p) => p.url === `${base}/gone`).status, 404);
    assert.match(idx.redaction, /not masked/);

    const off = await run([...quick, '--from-archive', path.join(dir, 'archive'), '--out', path.join(dir, 'off')], { AUDIT_OUT_DIR: dir });
    assert.equal(off.code, 0, off.err);
    const a = JSON.parse(fs.readFileSync(path.join(dir, 'live', 'report.json'), 'utf8'));
    const b = JSON.parse(fs.readFileSync(path.join(dir, 'off', 'report.json'), 'utf8'));
    assert.deepEqual(b.pages.map((p) => p.url).sort(), a.pages.map((p) => p.url).sort());
    const fields = ['status', 'location', 'title', 'description', 'canonical', 'h1', 'words', 'lang', 'noindex', 'sig'];
    for (const p of a.pages) {
      const q = b.pages.find((x) => x.url === p.url);
      for (const f of fields) assert.deepEqual(q[f], p[f], `${p.url} ${f}`);
    }
    // robots.txt and the sitemap were archived, so their rows run offline too.
    assert.equal(rowOf(b, 'seo.robots-txt').status, rowOf(a, 'seo.robots-txt').status);
    assert.equal(rowOf(b, 'seo.sitemap').status, rowOf(a, 'seo.sitemap').status);
    assert.equal(rowOf(b, 'seo.redirect-chains').status, 'skip');
    for (const row of a.rows) {
      const twin = rowOf(b, row.id);
      if (twin.archive) continue;
      assert.equal(twin.status, row.status, `${row.id}: ${row.evidence} / ${twin.evidence}`);
      assert.equal(twin.evidence, row.evidence, row.id);
    }
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
