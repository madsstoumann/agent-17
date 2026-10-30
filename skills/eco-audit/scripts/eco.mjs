#!/usr/bin/env node
/**
 * eco-audit — page weight and CO2e per page view.
 *
 *   node eco.mjs <url> [more page urls] [--pages N] [--grid DK] [--views N] [--mobile] [--out DIR] ...
 *
 * Start page and a few sitemap pages (one per template) → each loaded once in headless Chrome
 * with an empty cache (or estimated from the HTML without one) → Green Web Foundation lookup →
 * Sustainable Web Design model v4 → checks → report.md, report.json, findings.json.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { parseCli, resolveOut, resolveState, reportsRoot, usage } from './lib/cli.mjs';
import { claimTarget, markRun, findEarlier, readNotes } from './lib/target-state.mjs';
import { diffRows } from './lib/diff.mjs';
import { createHttp, siblingHost, challengeVendor, VERSION } from './lib/http.mjs';
import { parseRobotsTxt, loadSitemaps, sampleSitemapUrls } from './lib/robots.mjs';
import { launch, measure, findChrome } from './lib/browser.mjs';
import { measureStatic } from './lib/static.mjs';
import { summarisePage, runChecks } from './lib/checks.mjs';
import { perView } from './lib/co2.mjs';
import { renderMarkdown, renderStdout, findings } from './lib/report.mjs';

const startedAt = Date.now();
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1).padStart(6);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** Green Web Foundation: { green, hostedBy } or { error }. */
async function greenCheck(http, host) {
  const res = await http.get(`https://api.thegreenwebfoundation.org/api/v3/greencheck/${encodeURIComponent(host)}`, { timeout: 15000, maxBytes: 256 * 1024 });
  if (!res.ok) return { error: res.error || `HTTP ${res.status}` };
  try {
    const j = JSON.parse(res.body);
    return { green: Boolean(j.green), hostedBy: j.hosted_by || null, url: j.url };
  } catch (e) { return { error: `not JSON (${e.message})` }; }
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
  if (parsed.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
  if (!parsed.ok) fail(1, `${parsed.error}\n\n${usage()}`);
  const opts = parsed.opts;
  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const log = opts.quiet ? () => {} : (m) => process.stderr.write(`[${elapsed()}s] ${m}\n`);
  const siteHosts = [opts.host, siblingHost(opts.host)].filter(Boolean);
  const http = createHttp({ timeout: 20000, siteHeaders: opts.headers, siteHosts, log: (m) => { if (process.env.ECO_AUDIT_DEBUG) log(m); } });

  log(`eco-audit ${VERSION} — ${opts.url}`);
  const first = await http.get(opts.url, { redirect: 'follow', maxBytes: 512 * 1024 });
  if (first.status === 0) fail(2, `Cannot reach ${opts.url}: ${first.error}${/CERT|certificate|SELF_SIGNED/i.test(first.error || '') ? '\nSelf-signed certificate? Re-run with --insecure.' : ''}`);
  const challenge = challengeVendor(first.status, first.body, first.headers);
  if (challenge) fail(2, `${opts.url} answered ${first.status} with a ${challenge} bot challenge. Ask the owner for a firewall rule that skips the challenge for a secret header and pass it with --header "Name: value".`);
  const finalUrl = first.finalUrl || opts.url;
  const u = new URL(finalUrl);
  const host = u.host.toLowerCase();

  // Pages: the start page, any the user named, then one sitemap page per template.
  const targets = [finalUrl, ...opts.extraUrls];
  if (opts.pages > 0) {
    const robotsRes = await http.get(`${u.origin}/robots.txt`, { redirect: 'follow', maxBytes: 256 * 1024 });
    const robots = robotsRes.status === 200 && !/<html/i.test(robotsRes.body || '') ? parseRobotsTxt(robotsRes.body) : null;
    const candidates = [...new Set([...(robots?.sitemaps || []), `${u.origin}/sitemap.xml`])];
    const sitemap = await loadSitemaps(http, candidates, { maxChildren: 5, maxUrls: 5000 });
    const own = sitemap.urls.filter((x) => { try { return siteHosts.includes(new URL(x).host.toLowerCase()) || new URL(x).host.toLowerCase() === host; } catch { return false; } });
    targets.push(...sampleSitemapUrls(own, { startUrl: finalUrl, n: opts.pages, exclude: targets }));
    log(`sitemap: ${sitemap.urls.length} URLs; measuring ${targets.length} pages`);
  }

  const viewport = opts.mobile ? { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true } : { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false };
  const measured = [];
  const failed = [];
  let browser = null;
  let estimate = opts.noBrowser;
  if (!estimate) {
    const chrome = findChrome({ chromePath: opts.chrome });
    if (!chrome) { estimate = true; log('no Chrome, Chromium or Edge found: estimating from the HTML (install one or set CHROME_PATH for real numbers)'); }
    else {
      try { browser = await launch({ chromePath: chrome, insecure: opts.insecure }); log(`browser: ${chrome}`); } catch (e) { estimate = true; log(`Chrome did not start (${e.message}): estimating from the HTML`); }
    }
  }
  try {
    for (const url of targets) {
      log(`measuring ${url}`);
      const m = browser ? await measure(browser, url, { headers: opts.headers, viewport, timeout: opts.timeout }) : await measureStatic(http, url);
      if (m.ok) measured.push(m); else { failed.push({ url, error: m.error }); log(`  failed: ${m.error}`); }
    }
  } finally {
    if (browser) await browser.close();
  }
  if (!measured.length) fail(2, `No page could be measured: ${failed.map((f) => `${f.url} (${f.error})`).join('; ')}`);

  const green = opts.noRemote ? null : await greenCheck(http, u.hostname);
  if (green) log(`green hosting: ${green.error ? `lookup failed (${green.error})` : green.green ? `yes${green.hostedBy ? ` (${green.hostedBy})` : ''}` : 'not verified'}`);
  const grid = opts.grid ? { deviceGrid: opts.grid.value, networkGrid: opts.grid.value } : {};
  const summaries = measured.map((m) => summarisePage(m, { siteHost: host, green: Boolean(green?.green), grid }));
  const rows = runChecks({ siteHost: host, pages: measured, summaries, green });
  const medBytes = median(summaries.map((s) => s.bytes));
  const med = perView(medBytes, { green: Boolean(green?.green), ...grid });

  const report = {
    tool: 'eco-audit',
    version: VERSION,
    date: new Date().toISOString().slice(0, 10),
    site: { url: opts.url, finalUrl, host },
    estimate,
    viewport: opts.mobile ? 'phone viewport 412×915' : 'desktop viewport 1366×900',
    grid: opts.grid || {},
    green,
    views: opts.views || null,
    median: { bytes: medBytes, grams: med.grams, rating: med.rating, segments: med.segments },
    pages: summaries.map(({ co2, ...s }) => s),
    failed,
    rows,
    requests: measured.map((m) => ({ url: m.url, finalUrl: m.finalUrl, status: m.status, requests: m.requests, images: m.images })),
    seconds: Math.round((Date.now() - startedAt) / 1000),
  };

  const stateDir = claimTarget(resolveState({ state: opts.state, host: opts.host }), opts.host);
  const dir = resolveOut({ out: opts.out, host: opts.host }, { state: stateDir, exists: fsSync.existsSync });
  markRun(dir, { skill: 'eco-audit', target: opts.host });
  report.state = stateDir;
  const notes = readNotes(stateDir);
  if (notes) report.notes = notes;
  const baselineFile = findBaseline(opts, stateDir, dir);
  if (baselineFile) {
    try {
      const prev = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
      report.diff = { from: baselineFile, date: prev.date, ...diffRows(prev.rows, report.rows), prev: prev.pages?.[0] ? { grams: prev.pages[0].grams, bytes: prev.pages[0].bytes, medianGrams: prev.median?.grams } : null };
    } catch (e) {
      report.diff = { from: baselineFile, error: e.message, fixed: [], regressed: [], changed: [] };
    }
  }
  const paths = { md: path.join(dir, 'report.md'), json: path.join(dir, 'report.json'), findings: path.join(dir, 'findings.json') };
  await fs.writeFile(paths.md, renderMarkdown(report));
  await fs.writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(paths.findings, `${JSON.stringify(findings(report), null, 2)}\n`);
  await fs.writeFile(path.join(stateDir, 'last-report.json'), JSON.stringify(report));
  process.stdout.write(`${renderStdout(report, paths)}\nState: ${stateDir}\nCompared with: ${baselineFile || 'nothing (first run for this host)'}${notes ? '\nNotes: notes.md included in the report' : ''}\n`);
}

/**
 * --baseline, else the last run for this host (last-report.json in the target folder), else the
 * newest earlier report.json for this host under <reports>/eco-audit/ or <reports>/audit-all/,
 * found by its content rather than its folder name.
 */
function findBaseline(opts, stateDir, outDir) {
  if (opts.noBaseline) return null;
  if (opts.baseline) return path.resolve(opts.baseline);
  const last = path.join(stateDir, 'last-report.json');
  if (fsSync.existsSync(last)) return last;
  const reports = reportsRoot();
  return findEarlier([path.join(reports, 'eco-audit'), path.join(reports, 'audit-all')], 'report.json', (j) => j?.tool === 'eco-audit' && j.site?.host === opts.host, { exclude: outDir })[0] || null;
}

main().catch((e) => fail(1, `eco-audit failed: ${e?.stack || e}`));
