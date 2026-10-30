#!/usr/bin/env node
/**
 * a11y-audit: WCAG 2.2 / EN 301 549 checks over a sample of a site's pages in headless Chrome.
 * axe-core and HTML_CodeSniffer (Pa11y's engine) per page, a keyboard walk, reflow at 320 px and
 * text spacing, mapped to WCAG criteria and EN 301 549 clauses.
 *
 *   node a11y.mjs <url> [--pages N] [--from launch-audit/report.json] [--urls FILE] [--keyboard N]
 *                 [--level A|AA|AAA] [--out DIR] [--repo NAME[=PATH]] [--header "Name: value"] [--insecure] [--chrome PATH]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs as nodeParseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, kill, Cdp, newPage } from './lib/cdp.mjs';
import { ENGINES, loadEngine } from './lib/engines.mjs';
import { inPage, installHelpers, runAxe, runHtmlcs, reflowCheck, textSpacingCheck, pageLinks, statementLink } from './lib/probes.mjs';
import { walk, analyseWalk } from './lib/keyboard.mjs';
import { pickPages, pagesFromLaunchAudit, pagesFromFile, sitemapUrls } from './lib/pages.mjs';
import { axeTags, htmlcsStandard, scFromAxeTags } from './lib/wcag.mjs';
import { aggregate, toTasks } from './lib/findings.mjs';
import { buildMarkdown, buildSummary } from './lib/report.mjs';

export const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA_SUFFIX = `a11y-audit/${VERSION}`;
const DESKTOP = { width: 1280, height: 900 };

const USAGE = `a11y-audit ${VERSION}: WCAG 2.2 and EN 301 549 checks in headless Chrome

Usage: node a11y.mjs <url> [flags]

  --pages N            Pages to audit, start page included (default 10).
  --from FILE          Take the pages from a launch-audit report.json (its crawl) instead of the sitemap.
  --urls FILE          Audit exactly these URLs (one per line).
  --keyboard N         Keyboard walk on the first N pages (default 3, 0 to skip).
  --max-tabs N         Tab presses per walk (default 200).
  --level A|AA|AAA     Target level (default AA).
  --out DIR            Report folder (default <reports>/a11y-audit/<host>-<YYYYMMDD-HHMM>/).
  --repo NAME[=PATH]   The repo that renders the site: tasks.json then holds agent tasks for it.
  --header "N: v"      Extra request header for the audited site (WAF bypass rule); repeatable, also AUDIT_HEADERS.
  --insecure           Accept self-signed certificates (localhost, staging).
  --chrome PATH        Browser to use (default: CHROME_PATH, installed Chrome/Chromium/Edge, Playwright's Chromium).
  --timeout MS         Page load timeout (default 30000).

<reports> is $AUDIT_OUT_DIR, else the Downloads folder if it exists (XDG download folder on Linux), else ~/audit-reports.
`;

const OPTIONS = {
  pages: { type: 'string' }, from: { type: 'string' }, urls: { type: 'string' }, keyboard: { type: 'string' },
  'max-tabs': { type: 'string' }, level: { type: 'string' }, out: { type: 'string' }, repo: { type: 'string' },
  header: { type: 'string', multiple: true }, insecure: { type: 'boolean' }, chrome: { type: 'string' },
  timeout: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
};

function num(v, fallback, name) {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
}

export function parseHeaderLines(lines) {
  const out = {};
  for (const line of lines || []) {
    const m = String(line).match(/^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m || !m[2]) throw new Error(`--header must look like "Name: value" (got "${line}")`);
    out[m[1]] = m[2];
  }
  return out;
}

export function parseCli(argv, env = process.env) {
  const { values, positionals } = nodeParseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  if (values.help || values.version) return { help: values.help, version: values.version };
  if (positionals.length !== 1) throw new Error(positionals.length ? 'exactly one URL expected' : 'a URL is required');
  let raw = positionals[0];
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw).href;
  const level = String(values.level || 'AA').toUpperCase();
  if (!['A', 'AA', 'AAA'].includes(level)) throw new Error('--level must be A, AA or AAA');
  let repo = null; let repoPath = null;
  if (values.repo) {
    const [name, ...rest] = values.repo.split('=');
    repo = name.trim(); repoPath = rest.length ? path.resolve(rest.join('=')) : null;
  }
  const headerLines = [...(values.header || []), ...String(env.AUDIT_HEADERS || '').split('\n').filter((l) => l.trim())];
  return {
    url,
    pages: Math.max(1, num(values.pages, 10, 'pages')),
    from: values.from || null,
    urls: values.urls || null,
    keyboard: num(values.keyboard, 3, 'keyboard'),
    maxTabs: num(values['max-tabs'], 200, 'max-tabs'),
    level,
    out: values.out || null,
    repo, repoPath,
    headers: parseHeaderLines(headerLines),
    insecure: !!values.insecure,
    chrome: values.chrome || null,
    timeout: num(values.timeout, 30000, 'timeout'),
  };
}

// ---- Report folder (same order as audit-all, launch-audit and security-audit) -----------------

const expandHome = (p, home) => p.replace(/^~(?=$|[\\/])/, home);

export function reportsRoot({ env = process.env, home = os.homedir(), isDir = writableDir, readFile = readText } = {}) {
  if (env.AUDIT_OUT_DIR) return path.resolve(expandHome(env.AUDIT_OUT_DIR, home));
  const xdg = env.XDG_DOWNLOAD_DIR || xdgDownloadDir(readFile(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'user-dirs.dirs')));
  const candidates = [xdg && path.resolve(expandHome(xdg.replace(/^\$HOME(?=$|\/)/, home), home)), path.join(home, 'Downloads')].filter(Boolean);
  return candidates.find((p) => isDir(p)) || path.join(home, 'audit-reports');
}

function xdgDownloadDir(text) {
  const m = String(text || '').match(/^\s*XDG_DOWNLOAD_DIR\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : null;
}
function writableDir(p) { try { fs.accessSync(p, fs.constants.W_OK); return fs.statSync(p).isDirectory(); } catch { return false; } }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

export const outDir = (opts, now = new Date()) => (opts.out
  ? path.resolve(expandHome(opts.out, os.homedir()))
  : path.join(reportsRoot(), 'a11y-audit', `${new URL(opts.url).host.replace(/[^\w.-]+/g, '-')}-${stamp(now)}`));

// ---- Run -----------------------------------------------------------------------------------

/** Headers go only to the audited host and its www/apex sibling, never to third parties. */
const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

async function auditPage(page, url, ctx, { keyboard }) {
  const result = { url };
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const nav = await page.goto(url, { timeout: ctx.opts.timeout });
  result.status = nav.status;
  result.finalUrl = nav.url;
  if (nav.error) { result.error = nav.error; return result; }
  if (nav.status && nav.status >= 400) { result.error = `HTTP ${nav.status}`; return result; }
  const challenged = await page.eval(`/vercel security checkpoint|just a moment|attention required|checking your browser/i.test(document.title)`);
  if (challenged) { result.error = 'bot challenge page (pass --header for a WAF bypass rule)'; return result; }

  await page.eval(inPage(installHelpers));
  try {
    await page.eval(`${ctx.axeSrc};true`);
    result.axe = await page.eval(inPage(runAxe, { tags: ctx.tags, maxNodes: 5 }), 120000);
    if (!ctx.axeCoverage) ctx.axeCoverage = await page.eval(`[...new Set(axe.getRules(${JSON.stringify(ctx.tags)}).flatMap(r => r.tags))]`);
  } catch (e) { result.axeError = e.message; }
  try {
    await page.eval(`${ctx.htmlcsSrc};true`);
    result.htmlcs = await page.eval(inPage(runHtmlcs, { standard: htmlcsStandard(ctx.opts.level), maxNodes: 5 }), 120000);
  } catch (e) { result.htmlcsError = e.message; }
  if (ctx.isStart) {
    result.statement = await page.eval(inPage(statementLink)).catch(() => null);
    result.links = await page.eval(inPage(pageLinks)).catch(() => []);
  }
  if (keyboard) {
    try {
      const w = await walk(page, { maxTabs: ctx.opts.maxTabs });
      result.keyboard = analyseWalk(w, { viewportHeight: DESKTOP.height });
    } catch (e) { result.keyboardError = e.message; }
  }
  try {
    result.textSpacing = await page.eval(inPage(textSpacingCheck));
  } catch (e) { result.textSpacingError = e.message; }
  try {
    await page.viewport(320, 640, false);
    await new Promise((r) => setTimeout(r, 800));
    result.reflow = await page.eval(inPage(reflowCheck));
  } catch (e) { result.reflowError = e.message; }
  return result;
}

export async function run(opts, { log = (m) => process.stderr.write(`${m}\n`), now = new Date() } = {}) {
  const dir = outDir(opts, now);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = findChrome({ chromePath: opts.chrome });
  if (!chrome) throw new Error('no Chrome, Chromium or Edge found (install one or set CHROME_PATH)');
  log(`engines: loading axe-core ${ENGINES.axe.version} and HTML_CodeSniffer ${ENGINES.htmlcs.version}`);
  const [axeSrc, htmlcsSrc] = await Promise.all([loadEngine('axe'), loadEngine('htmlcs')]);
  const host = new URL(opts.url).host;

  const { proc, wsUrl } = await launch(chrome, { insecure: opts.insecure });
  const cdp = await Cdp.open(wsUrl);
  const pages = [];
  const ctx = { opts, axeSrc, htmlcsSrc, tags: axeTags(opts.level), axeCoverage: null, isStart: true };
  try {
    const { userAgent: ua } = await cdp.send('Browser.getVersion');
    const page = await newPage(cdp, { userAgent: `${ua.replace('HeadlessChrome', 'Chrome')} ${UA_SUFFIX}` });
    await page.call('Page.setBypassCSP', { enabled: true });
    // Send --header values to the audited site only: intercept nothing, but set them per request host.
    if (Object.keys(opts.headers).length) {
      await page.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      cdp.on((m) => {
        if (m.sessionId !== page.sessionId || m.method !== 'Fetch.requestPaused') return;
        const { requestId, request } = m.params;
        let reqHost = '';
        try { reqHost = new URL(request.url).host; } catch { /* data: and the like */ }
        const params = { requestId };
        if (sameSite(reqHost, host)) params.headers = Object.entries({ ...request.headers, ...opts.headers }).map(([name, value]) => ({ name, value }));
        cdp.send('Fetch.continueRequest', params, page.sessionId).catch(() => {});
      });
    }

    let list;
    if (opts.urls) list = pagesFromFile(opts.urls);
    else {
      log(`start page: ${opts.url}`);
      const start = await auditPage(page, opts.url, ctx, { keyboard: opts.keyboard > 0 });
      ctx.isStart = false;
      pages.push(start);
      if (start.error) log(`  ${start.error}`);
      const candidates = opts.from ? pagesFromLaunchAudit(opts.from) : [...(await sitemapUrls(start.finalUrl || opts.url, { headers: opts.headers })), ...(start.links || [])];
      list = pickPages({ start: start.finalUrl || opts.url, candidates, n: opts.pages }).slice(1);
    }
    for (const url of list.slice(0, opts.urls ? undefined : opts.pages)) {
      log(`page ${pages.length + 1}: ${url}`);
      const r = await auditPage(page, url, ctx, { keyboard: pages.length < opts.keyboard });
      ctx.isStart = false;
      if (r.error) log(`  ${r.error}`);
      pages.push(r);
    }
  } finally {
    cdp.close();
    kill(proc);
  }

  const startPage = pages[0];
  const agg = aggregate(pages, {
    level: opts.level,
    axeCoverage: scFromAxeTags(ctx.axeCoverage || []),
    statement: startPage?.error ? undefined : startPage?.statement ?? null,
    startUrl: startPage?.url,
  });
  const engines = [ENGINES.axe, ENGINES.htmlcs];
  const manual = fs.readFileSync(path.join(HERE, '..', 'references', 'manual.md'), 'utf8');
  const md = buildMarkdown({ site: opts.url, date: now, level: opts.level, pages, agg, engines, version: VERSION, manual });
  const tasks = toTasks(agg.issues, { subject: host, repo: opts.repo, repoPath: opts.repoPath });
  const json = {
    tool: 'a11y-audit', version: VERSION, site: opts.url, date: now.toISOString(), level: opts.level,
    engines: engines.map((e) => ({ name: e.name, version: e.version })),
    counts: agg.counts, issues: agg.issues, review: agg.review, bestPractice: agg.bestPractice, criteria: agg.criteria,
    pages: pages.map(({ links, ...p }) => p),
  };
  fs.writeFileSync(path.join(dir, 'report.md'), md);
  fs.writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(json, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'tasks.json'), `${JSON.stringify(tasks, null, 2)}\n`);
  return { dir, agg, summary: buildSummary({ site: opts.url, agg, dir, level: opts.level }) };
}

async function main() {
  let opts;
  try { opts = parseCli(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n\n${USAGE}`); process.exit(2); }
  if (opts.help) { process.stdout.write(USAGE); return; }
  if (opts.version) { process.stdout.write(`${VERSION}\n`); return; }
  try {
    const { summary } = await run(opts);
    process.stdout.write(`${summary}\n`);
  } catch (e) {
    process.stderr.write(`a11y-audit failed: ${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
