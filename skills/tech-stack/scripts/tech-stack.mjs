#!/usr/bin/env node
/**
 * tech-stack: detects what a website is built with (CMS, frameworks, libraries,
 * hosting, CDN, analytics, consent, …) with the evidence for each finding.
 *
 *   node tech-stack.mjs <url> [<url> …] [--file urls.txt] [--browser] [--out DIR] [--json]
 *
 * Writes report.md and results.json, prints a one-line summary per site to
 * stdout, progress to stderr. Exit 0 unless the script itself fails (or, with
 * several sites, every site failed).
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { collect, normaliseUrl, VERSION } from './lib/fetch.mjs';
import { detect, GLOBAL_PATHS } from './lib/detect.mjs';
import { loadPlaywright, render } from './lib/browser.mjs';
import { markdown, siteLine } from './lib/report.mjs';
import { resolveOutDir } from './lib/out-dir.mjs';

const HELP = `tech-stack ${VERSION}: detect a website's technology stack

Usage: node tech-stack.mjs <url> [<url> …] [options]

  --file PATH        Read URLs from a file, one per line (# comments allowed)
  --browser          Also render each page in headless Chromium (Playwright) to see
                     JS-injected tags, JS-set cookies and window globals
  --assets N         Same-site scripts/stylesheets to read per site (default 12, 0 = none)
  --jobs N           Sites analysed in parallel (default 4; 2 with --browser)
  --timeout MS       Per-request timeout (default 15000)
  --out DIR          Output folder (default <reports>/tech-stack/<name>-<YYYYMMDD-HHMM>/, where
                     <reports> is $AUDIT_OUT_DIR, else Downloads, else ~/audit-reports)
  --insecure         Accept self-signed certificates (localhost, dev boxes)
  --json             Print results.json to stdout instead of the summary
  --quiet            No progress on stderr
  -h, --help         This help
`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' }, browser: { type: 'boolean' }, assets: { type: 'string' }, jobs: { type: 'string' },
    timeout: { type: 'string' }, out: { type: 'string' }, insecure: { type: 'boolean' }, json: { type: 'boolean' },
    quiet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});
if (opt.help) { process.stdout.write(HELP); process.exit(0); }

const log = opt.quiet ? () => {} : (...a) => console.error(...a);
const int = (v, d, min, max) => { const n = v === undefined ? d : Number.parseInt(v, 10); if (!Number.isFinite(n) || n < min || n > max) { console.error(`invalid number: ${v} (allowed ${min}-${max})`); process.exit(2); } return n; };

let inputs = [...positionals];
if (opt.file) inputs.push(...readFileSync(opt.file, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
inputs = [...new Set(inputs)];
if (!inputs.length) { process.stderr.write(HELP); process.exit(2); }
const urls = inputs.map((u) => { try { return normaliseUrl(u); } catch (e) { console.error(`skipping ${u}: ${e.message}`); return null; } }).filter(Boolean);
if (!urls.length) process.exit(2);

if (opt.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const timeout = int(opt.timeout, 15000, 1000, 120000);
const maxAssets = int(opt.assets, 12, 0, 100);
const jobs = int(opt.jobs, opt.browser ? 2 : 4, 1, 16);

let pw = null;
if (opt.browser) {
  pw = await loadPlaywright();
  if (!pw) log('--browser: Playwright is not installed here (npm i -g playwright && npx playwright install chromium). Continuing with raw HTML only.');
}

async function analyse(url) {
  const started = Date.now();
  try {
    const c = await collect(url, { timeout, maxAssets, log });
    const input = { url, finalUrl: c.finalUrl, headers: c.headers, cookies: c.cookies, html: c.html, urls: c.urls, assets: c.assets };
    let browser = false;
    if (pw) {
      try {
        const b = await render(pw, c.finalUrl, { timeout: Math.max(timeout * 2, 30000), paths: GLOBAL_PATHS, insecure: !!opt.insecure });
        Object.assign(input, { renderedHtml: b.renderedHtml, globals: b.globals, urls: [...c.urls, ...b.requests], cookies: [...c.cookies, ...b.cookies] });
        browser = true;
        log(`  ${c.finalUrl}: rendered, ${b.requests.length} requests, ${Object.keys(b.globals).length} globals`);
      } catch (e) { c.errors.push(`browser render: ${e.message.split('\n')[0]}`); }
    }
    const { html, assets, headers, cookies, urls: _u, ...meta } = c;
    return { ...meta, browser, ms: Date.now() - started, technologies: detect(input) };
  } catch (e) {
    const msg = e.cause?.code || e.cause?.message || e.message;
    log(`  ${url}: failed (${msg})`);
    return { url, error: msg, ms: Date.now() - started, technologies: [] };
  }
}

log(`tech-stack ${VERSION}: ${urls.length} site${urls.length > 1 ? 's' : ''}${pw ? ', with browser' : ''}`);
const results = new Array(urls.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, urls.length) }, async () => {
  while (next < urls.length) { const i = next++; results[i] = await analyse(urls[i]); }
}));

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const name = urls.length === 1 ? new URL(urls[0]).host.replace(/[^a-z0-9.-]/gi, '_') : `batch-${urls.length}`;
const outDir = resolveOutDir(opt.out, name, { now: stamp });
mkdirSync(outDir, { recursive: true });
const generatedAt = new Date().toISOString();
const doc = { tool: 'tech-stack', version: VERSION, generatedAt, browser: !!pw, results };
writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
writeFileSync(path.join(outDir, 'report.md'), markdown(results, { generatedAt, version: VERSION }));

if (opt.json) process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
else {
  for (const r of results) console.log(siteLine(r));
  console.log(`\nReport: ${path.join(outDir, 'report.md')}\nJSON:   ${path.join(outDir, 'results.json')}`);
}
process.exit(results.every((r) => r.error) ? 1 : 0);
