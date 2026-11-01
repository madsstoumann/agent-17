#!/usr/bin/env node
/**
 * check-tech-stack: detects what a website is built with (CMS, frameworks, libraries,
 * hosting, CDN, analytics, consent, …) with the evidence for each finding.
 *
 *   node check-tech-stack.mjs <url> [<url> …] [--file urls.txt] [--browser] [--out DIR] [--json]
 *
 * Writes report.md and results.json, prints a one-line summary per site to
 * stdout, progress to stderr. Exit 0 unless the script itself fails (or, with
 * several sites, every site failed).
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { collect, normaliseUrl, VERSION } from './lib/fetch.mjs';
import { detect, mergePages, GLOBAL_PATHS } from './lib/detect.mjs';
import { pickLinks, thinReason } from './lib/page.mjs';
import { addLatest } from './lib/versions.mjs';
import { compareAndSave } from './lib/history.mjs';
import { loadPlaywright, render } from './lib/browser.mjs';
import { markdown, siteLine } from './lib/report.mjs';
import { resolveOutDir, reportsRoot } from './lib/out-dir.mjs';

const HELP = `check-tech-stack ${VERSION}: detect a website's technology stack

Usage: node check-tech-stack.mjs <url> [<url> …] [options]

  --file PATH        Read URLs from a file, one per line (# comments allowed)
  --browser          Render every start page in headless Chromium (Playwright) to see
                     JS-injected tags, JS-set cookies and window globals. Without it, a page
                     whose HTML shows little (app shell, no CMS or framework) is rendered anyway
                     when Playwright is installed
  --no-browser       Never render, not even a page whose HTML shows little
  --pages N          Also read N more same-site pages linked from the start page (default 0,
                     max 10): other subdomains and sections first, such as a shop or a blog
  --assets N         Same-site scripts/stylesheets to read per site (default 12, 0 = none)
  --jobs N           Sites analysed in parallel (default 4; 2 with --browser)
  --timeout MS       Per-request timeout (default 15000)
  --out DIR          Output folder (default <reports>/check-tech-stack/<host>/runs/<YYYYMMDD-HHMM>/,
                     or batch-<n>-<YYYYMMDD-HHMM>/ for several sites, where <reports> is
                     $AUDIT_OUT_DIR, else Downloads, else ~/audit-reports)
  --no-history       Do not compare with, or save as, each site's last run
                     (<reports>/check-tech-stack/<host>/last.json)
  --offline          Skip the npm registry lookup of the latest version of each library
  --insecure         Accept self-signed certificates (localhost, dev boxes)
  --json             Print results.json to stdout instead of the summary
  --quiet            No progress on stderr
  -h, --help         This help
`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' }, browser: { type: 'boolean' }, 'no-browser': { type: 'boolean' }, pages: { type: 'string' },
    'no-history': { type: 'boolean' }, offline: { type: 'boolean' }, assets: { type: 'string' }, jobs: { type: 'string' },
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
const extraPages = int(opt.pages, 0, 0, 10);
if (opt.browser && opt['no-browser']) { console.error('--browser and --no-browser contradict each other'); process.exit(2); }

let pw = null;
if (opt.browser) {
  pw = await loadPlaywright();
  if (!pw) log('--browser: Playwright is not installed here (npm i -g playwright && npx playwright install chromium). Continuing with raw HTML only.');
}
// Loaded on first need, when a page's HTML shows too little without a browser.
let autoPw;
const autoPlaywright = () => (autoPw ||= loadPlaywright());

async function analyse(url) {
  const started = Date.now();
  try {
    const skip = new Set();
    const c = await collect(url, { timeout, maxAssets, skip, log });
    const input = { url, finalUrl: c.finalUrl, headers: c.headers, cookies: c.cookies, html: c.html, urls: c.urls, assets: c.assets };
    let browser = false; let autoBrowser = null; let browserHint = null;
    let usePw = pw;
    if (!opt.browser && !opt['no-browser']) {
      const reason = thinReason({ status: c.status, challenge: c.challenge, html: c.html, scripts: c.assetStats.scripts }, detect(input));
      if (reason) {
        usePw = await autoPlaywright();
        if (usePw) autoBrowser = reason; else browserHint = reason;
      }
    }
    if (usePw) {
      try {
        const b = await render(usePw, c.finalUrl, { timeout: Math.max(timeout * 2, 30000), paths: GLOBAL_PATHS, insecure: !!opt.insecure });
        Object.assign(input, { renderedHtml: b.renderedHtml, globals: b.globals, urls: [...c.urls, ...b.requests], cookies: [...c.cookies, ...b.cookies] });
        browser = true;
        log(`  ${c.finalUrl}: rendered${autoBrowser ? ` (${autoBrowser})` : ''}, ${b.requests.length} requests, ${Object.keys(b.globals).length} globals`);
      } catch (e) { c.errors.push(`browser render: ${e.message.split('\n')[0]}`); autoBrowser = null; }
    }
    let technologies = detect(input);
    const pages = [];
    if (extraPages && !c.challenge && c.status < 400) {
      const extras = [];
      for (const link of pickLinks(input.renderedHtml || c.html, c.finalUrl, extraPages)) {
        try {
          const p = await collect(link, { timeout, maxAssets: Math.ceil(maxAssets / 2), skip, log });
          const where = new URL(p.finalUrl); const label = where.host === new URL(c.finalUrl).host ? where.pathname : `${where.host}${where.pathname}`;
          pages.push({ url: p.finalUrl, status: p.status, ...(p.challenge ? { challenge: p.challenge } : {}) });
          if (p.challenge || p.status >= 400) continue;
          extras.push({ path: label, technologies: detect({ url: link, finalUrl: p.finalUrl, headers: p.headers, cookies: p.cookies, html: p.html, urls: p.urls, assets: p.assets }) });
        } catch (e) { c.errors.push(`page ${link}: ${e.cause?.code || e.message}`); }
      }
      technologies = mergePages(technologies, extras);
    }
    const { html, assets, headers, cookies, urls: _u, ...meta } = c;
    return { ...meta, browser, ...(autoBrowser ? { autoBrowser } : {}), ...(browserHint ? { browserHint } : {}), ...(pages.length ? { pages } : {}), ms: Date.now() - started, technologies };
  } catch (e) {
    const msg = e.cause?.code || e.cause?.message || e.message;
    log(`  ${url}: failed (${msg})`);
    return { url, error: msg, ms: Date.now() - started, technologies: [] };
  }
}

log(`check-tech-stack ${VERSION}: ${urls.length} site${urls.length > 1 ? 's' : ''}${pw ? ', with browser' : ''}`);
const results = new Array(urls.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, urls.length) }, async () => {
  while (next < urls.length) { const i = next++; results[i] = await analyse(urls[i]); }
}));

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const name = urls.length === 1 ? new URL(results[0].finalUrl || urls[0]).host.replace(/[^a-z0-9.-]/gi, '_') : `batch-${urls.length}`;
if (!opt.offline) {
  const n = await addLatest(results, { log });
  if (n) log(`  npm: latest versions of ${n} package${n > 1 ? 's' : ''} looked up`);
}
const generatedAt = new Date().toISOString();
if (!opt['no-history']) {
  try { compareAndSave(results, reportsRoot(), { generatedAt }); } catch (e) { log(`  history: ${e.message}`); }
}
const outDir = resolveOutDir(opt.out, name, { now: stamp, batch: urls.length > 1 });
mkdirSync(outDir, { recursive: true });
const doc = { tool: 'check-tech-stack', version: VERSION, generatedAt, browser: !!pw, pages: extraPages, results };
writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
writeFileSync(path.join(outDir, 'report.md'), markdown(results, { generatedAt, version: VERSION }));

if (opt.json) process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
else {
  for (const r of results) console.log(siteLine(r));
  console.log(`\nReport: ${path.join(outDir, 'report.md')}\nJSON:   ${path.join(outDir, 'results.json')}`);
}
process.exit(results.every((r) => r.error) ? 1 : 0);
