#!/usr/bin/env node
/**
 * seo-audit — site-wide SEO and content audit.
 *
 *   node seo.mjs <url> [--pages N] [--sitemap-sample N] [--external-links N] [--schema-pages N] [--out DIR] ...
 *
 * Start page and redirects → robots.txt and sitemaps → crawl (links, then a sitemap sample) →
 * og:image and external link checks → validator.schema.org on one page per template →
 * llms.txt, llms-full.txt and ai.txt → checks → report.md, report.json, findings.json, pages.csv.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';

import { parseCli, resolveOut, resolveState, reportsRoot, usage } from './lib/cli.mjs';
import { claimTarget, markRun, findEarlier, readNotes } from './lib/target-state.mjs';
import { diffRows } from './lib/diff.mjs';
import { createHttp, isPrivateHost, isPrivateAddress, siblingHost, challengeVendor, pLimit, VERSION } from './lib/http.mjs';
import { parseRobotsTxt, loadSitemaps } from './lib/robots.mjs';
import { followChain } from './lib/redirects.mjs';
import { crawlSite, checkExternal, normalise } from './lib/crawl.mjs';
import { runChecks, pickSchemaPages, htmlPages } from './lib/checks.mjs';
import { schemaValidate } from './lib/schema.mjs';
import { fetchGeo, geoChecks } from './lib/geo.mjs';
import { renderMarkdown, renderStdout, findings, pagesCsv } from './lib/report.mjs';

const startedAt = Date.now();
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1).padStart(6);

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function resolvedPrivately(hostname) {
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => isPrivateAddress(a.address));
  } catch { return false; }
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
  const http = createHttp({ timeout: opts.timeout, concurrency: opts.concurrency, siteHeaders: opts.headers, siteHosts, log: (m) => { if (process.env.SEO_AUDIT_DEBUG) log(m); } });

  log(`seo-audit ${VERSION} — ${opts.url}`);
  const chain = await followChain(http, opts.url, { maxHops: 10 });
  if (chain.error && !chain.final) fail(2, `Cannot reach ${opts.url}: ${chain.error}${/CERT|certificate|SELF_SIGNED/i.test(chain.error) ? '\nSelf-signed certificate? Re-run with --insecure.' : ''}`);
  const finalUrl = normalise(chain.final || opts.url);
  const first = await http.get(finalUrl, { redirect: 'manual', maxBytes: 512 * 1024 });
  const challenge = challengeVendor(first.status, first.body, first.headers);
  if (challenge) fail(2, `${finalUrl} answered ${first.status} with a ${challenge} bot challenge. Ask the owner for a firewall rule that skips the challenge for a secret header and pass it with --header "Name: value".`);
  const u = new URL(finalUrl);
  for (const h of [u.host.toLowerCase(), siblingHost(u.host.toLowerCase())]) if (h && !siteHosts.includes(h)) siteHosts.push(h);
  const isPrivate = isPrivateHost(u.hostname) || await resolvedPrivately(u.hostname);
  const remote = !opts.noRemote;

  const robotsRes = await http.get(`${u.origin}/robots.txt`, { redirect: 'follow', maxBytes: 256 * 1024 });
  const robotsText = robotsRes.status === 200 && !/<html/i.test(robotsRes.body || '') ? robotsRes.body : '';
  const robots = { status: robotsRes.status, parsed: robotsText ? parseRobotsTxt(robotsText) : null, error: robotsRes.error || null };
  const declared = robots.parsed?.sitemaps || [];
  const candidates = [...new Set([...declared.map((s) => { try { return new URL(s, u.origin).toString(); } catch { return null; } }).filter(Boolean), `${u.origin}/sitemap.xml`, `${u.origin}/sitemap_index.xml`])];
  const sitemap = await loadSitemaps(http, candidates, { maxChildren: 20, maxUrls: 20000, log });
  sitemap.declared = declared;
  log(`robots.txt ${robots.status}; sitemap: ${sitemap.urls.length} URLs`);

  const crawl = await crawlSite(http, {
    startUrl: finalUrl, hosts: siteHosts, sitemapUrls: sitemap.urls, robots: robots.parsed,
    maxPages: opts.pages, sitemapSample: opts.sitemapSample, ignoreRobots: opts.ignoreRobots, concurrency: opts.concurrency, log,
  });
  const html = htmlPages(crawl.pages);
  log(`crawl done: ${crawl.pages.length} URLs, ${html.length} HTML pages`);

  // og:image: one check per distinct absolute image.
  const ogUrls = [...new Set(html.map((p) => p.og?.image).filter((x) => x && /^https?:\/\//i.test(x)))].slice(0, 40);
  const lim = pLimit(opts.concurrency);
  const ogImages = await Promise.all(ogUrls.map((img) => lim(async () => {
    let r = await http.head(img, { redirect: 'follow', timeout: 10000 });
    if (r.status === 405 || r.status === 403 || r.status === 0) r = await http.get(img, { redirect: 'follow', timeout: 10000, maxBytes: 0 });
    return { url: img, status: r.status, contentType: r.contentType, error: r.error || null };
  })));

  let external = null;
  if (opts.externalLinks > 0) {
    const list = [...crawl.external.keys()].filter((x) => /^https?:/i.test(x)).slice(0, opts.externalLinks);
    log(`external links: checking ${list.length} of ${crawl.external.size}`);
    external = await checkExternal(http, list, { concurrency: opts.concurrency });
  }

  let schema = null;
  if (remote && opts.schemaPages > 0) {
    const picks = pickSchemaPages(crawl.pages, opts.schemaPages);
    log(`validator.schema.org: ${picks.length} pages${isPrivate ? ' (posting the HTML: private host)' : ''}`);
    schema = [];
    for (const url of picks) {
      let res;
      if (isPrivate) {
        const page = await http.get(url, { redirect: 'follow', maxBytes: 4 * 1024 * 1024 });
        res = await schemaValidate(http, { html: page.body || '' });
      } else res = await schemaValidate(http, { url });
      schema.push({ url, ...res });
      if (!res.ok && /network|timeout|HTTP 5|rate/i.test(res.error || '')) break;
    }
  }

  log('llms.txt, llms-full.txt, ai.txt');
  const geo = await fetchGeo(http, u.origin);

  const rows = runChecks({
    finalUrl, hosts: siteHosts, productionHost: opts.productionHost, pages: crawl.pages, inlinks: crawl.inlinks, blocked: crawl.blocked,
    truncated: crawl.truncated, robots, sitemap, external, externalFrom: crawl.external, ogImages: ogUrls.length ? ogImages : null, schema,
  });
  rows.push(...geoChecks({ robots, robotsText, geo, start: crawl.pages.find((p) => p.url === finalUrl) }));

  const date = new Date().toISOString().slice(0, 10);
  const report = {
    tool: 'seo-audit',
    version: VERSION, date,
    site: { url: opts.url, finalUrl, host: u.host.toLowerCase() },
    env: { note: /(^|[.-])(dev|develop|staging|stage|stg|test|uat|qa|preview)([.-]|$)/i.test(u.hostname) ? 'This looks like a dev or staging host: noindex and a blocking robots.txt are expected here and belong on the launch checklist, not the fix list.' : null },
    stats: {
      html: html.length, other: crawl.pages.length - html.length, redirects: crawl.pages.filter((p) => p.location).length,
      errors: crawl.pages.filter((p) => p.status === 0 || p.status >= 400).length, indexable: html.filter((p) => !p.noindex).length,
      truncated: crawl.truncated, maxPages: opts.pages, sitemapUrls: sitemap.urls.length, sitemapSampled: crawl.sitemapSampled, sitemapMissing: crawl.sitemapMissing,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    },
    rows,
    pages: crawl.pages,
  };

  const stateDir = claimTarget(resolveState({ state: opts.state, host: opts.host }), opts.host);
  const dir = resolveOut({ out: opts.out, host: opts.host }, { state: stateDir, exists: fsSync.existsSync });
  markRun(dir, { skill: 'seo-audit', target: opts.host });
  report.state = stateDir;
  const notes = readNotes(stateDir);
  if (notes) report.notes = notes;
  const baselineFile = findBaseline(opts, stateDir, dir);
  if (baselineFile) {
    try {
      const prev = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
      report.diff = { from: baselineFile, date: prev.date, ...diffRows(prev.rows, report.rows) };
    } catch (e) {
      report.diff = { from: baselineFile, error: e.message, fixed: [], regressed: [], changed: [] };
    }
  }
  const paths = { md: path.join(dir, 'report.md'), json: path.join(dir, 'report.json'), findings: path.join(dir, 'findings.json'), csv: path.join(dir, 'pages.csv') };
  await fs.writeFile(paths.md, renderMarkdown(report));
  await fs.writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(paths.findings, `${JSON.stringify(findings(report), null, 2)}\n`);
  await fs.writeFile(paths.csv, pagesCsv(crawl.pages, crawl.inlinks));
  await fs.writeFile(path.join(stateDir, 'last-report.json'), JSON.stringify(report));
  process.stdout.write(`${renderStdout(report, paths)}\nState: ${stateDir}\nCompared with: ${baselineFile || 'nothing (first run for this host)'}${notes ? '\nNotes: notes.md included in the report' : ''}\n`);
}

/**
 * --baseline, else the last run for this host (last-report.json in the target folder), else the
 * newest earlier report.json for this host under <reports>/seo-audit/ or <reports>/audit-all/,
 * found by its content rather than its folder name.
 */
function findBaseline(opts, stateDir, outDir) {
  if (opts.noBaseline) return null;
  if (opts.baseline) return path.resolve(opts.baseline);
  const last = path.join(stateDir, 'last-report.json');
  if (fsSync.existsSync(last)) return last;
  const reports = reportsRoot();
  return findEarlier([path.join(reports, 'seo-audit'), path.join(reports, 'audit-all')], 'report.json', (j) => j?.tool === 'seo-audit' && j.site?.host === opts.host, { exclude: outDir })[0] || null;
}

main().catch((e) => fail(1, `seo-audit failed: ${e?.stack || e}`));
