#!/usr/bin/env node
/**
 * audit-seo — site-wide SEO and content audit.
 *
 *   node seo.mjs <url> [--pages N] [--sitemap-sample N] [--external-links N] [--schema-pages N] [--out DIR] ...
 *   node seo.mjs <url> --schema-only      structured data on one page
 *   node seo.mjs <file.html>              structured data in a local file
 *
 * Start page and redirects → robots.txt and sitemaps → crawl (links, then a sitemap sample) →
 * Chrome render of the start page and pages without JSON-LD (JSON-LD added by JavaScript) →
 * og:image and external link checks → validator.schema.org on one page per template →
 * llms.txt, llms-full.txt and ai.txt → a few pages fetched as each AI crawler → checks →
 * report.md, report.json, findings.json, pages.csv.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { createHash } from 'node:crypto';

import { parseCli, resolveOut, resolveState, reportsRoot, usage } from './lib/cli.mjs';
import { claimTarget, markRun, findEarlier, readNotes } from './lib/target-state.mjs';
import { diffRows } from './lib/diff.mjs';
import { createHttp, isPrivateHost, isPrivateAddress, siblingHost, challengeVendor, pLimit, VERSION } from './lib/http.mjs';
import { parseRobotsTxt, loadSitemaps } from './lib/robots.mjs';
import { followChain } from './lib/redirects.mjs';
import { crawlSite, checkExternal, checkInternal, headThenGet, normalise } from './lib/crawl.mjs';
import { runChecks, schemaChecks, pickSchemaPages, pickRenderPages, htmlPages } from './lib/checks.mjs';
import { extractMeta } from './lib/html.mjs';
import { richOf } from './lib/rich.mjs';
import { findChrome, launch, render, TEXT_MEASURE } from './lib/render.mjs';
import { schemaValidate } from './lib/schema.mjs';
import { fetchGeo, geoChecks, fetchBotAccess, botAccessRow, renderedTextRow, freshnessRows, answerStructureRow, schemaOpportunitiesRow, bingRow, geoScore } from './lib/geo.mjs';
import { renderMarkdown, renderStdout, findings, pagesCsv, consoleItems } from './lib/report.mjs';
import { consoleList, scratchDir, removeScratch } from './lib/levels.mjs';
import { openArchive, archiveHttp, hasMask, isSiteFile, createArchiveWriter } from './lib/archive.mjs';
import { applyArchiveMode } from './lib/offline.mjs';

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
  let http = createHttp({ timeout: opts.timeout, concurrency: opts.concurrency, siteHeaders: opts.headers, siteHosts, log: (m) => { if (process.env.AUDIT_SEO_DEBUG) log(m); } });
  // --from-archive: every site request is answered from the archive (live only with --allow-live).
  let archive = null;
  if (opts.fromArchive) {
    try { archive = openArchive(opts.fromArchive); } catch (e) { fail(1, e.message); }
    http = archiveHttp(archive, { live: http, allowLive: opts.allowLive });
  }
  // --save-html: keep what the site answered, to write as an archive at the end.
  const recorder = opts.saveHtml ? recordResponses(http, siteHosts) : null;
  if (recorder) http = recorder.http;

  log(`audit-seo ${VERSION} — ${opts.file || opts.url}${archive ? ` (from the archive of ${archive.date})` : ''}`);
  const { report, inlinks } = opts.schemaOnly ? await schemaOnly(opts, http, siteHosts, log, archive) : await fullAudit(opts, http, siteHosts, log, archive);
  if (recorder) report.savedHtml = saveArchive(opts.saveHtml, recorder, report, log);
  await writeOut(opts, report, inlinks);
}

/**
 * Wraps `http` so every GET of the site's own hosts that returns a body, as served (a redirect
 * not followed, or no redirect met), is kept. -> { http, responses: Map<url, [res]> }
 */
function recordResponses(http, siteHosts) {
  const responses = new Map();
  const keep = (url, opts, res) => {
    if (!res || !res.status || res.body == null || (opts.maxBytes ?? 1) === 0) return;
    if (opts.redirect !== 'manual' && res.redirected) return;
    let host; try { host = new URL(url).host.toLowerCase(); } catch { return; }
    if (!siteHosts.includes(host)) return;
    const key = normalise(url);
    if (!responses.has(key)) responses.set(key, []);
    responses.get(key).push({ ...res, fetchedAt: new Date() });
  };
  const get = async (url, opts = {}) => { const res = await http.get(url, opts); keep(url, opts, res); return res; };
  const request = async (url, opts = {}) => { const res = await http.request(url, opts); if ((opts.method || 'GET').toUpperCase() === 'GET') keep(url, opts, res); return res; };
  return { http: { ...http, get, request }, responses };
}

/** Writes the pages (and robots.txt, sitemaps, llms.txt) this run fetched as a page archive. */
function saveArchive(dir, recorder, report, log) {
  const w = createArchiveWriter(dir, { host: report.site.host, source: `audit-seo ${VERSION} --save-html: the served HTML of every URL the crawl fetched, redirects not followed, plus robots.txt, sitemaps and llms.txt` });
  const titled = (r) => /<title[^>]*>\s*[^<\s]/i.test(typeof r.body === 'string' ? r.body : '');
  // The crawl's own answer: whole (the start-page probe reads only 512 kB) and, after a retry, the one with a title.
  const pick = (list) => list.find((r) => !r.truncated && titled(r)) || list.find((r) => !r.truncated) || list[0];
  const done = new Set();
  // Pages that answered 200 first: /page/ (the page) takes the plain slug, /page (its redirect) the -x one.
  const ok = (p) => (p.status >= 200 && p.status < 300 ? 0 : 1);
  for (const p of [...(report.pages || [])].sort((a, b) => ok(a) - ok(b))) {
    const list = recorder.responses.get(p.url);
    if (!list?.length) continue;
    const r = pick(list);
    w.add({ url: p.url, status: r.status, contentType: r.headers?.['content-type'] || r.contentType || '', location: r.headers?.location || null, body: r.body, title: p.title ?? null, fetchedAt: r.fetchedAt });
    done.add(p.url);
  }
  // Site files: robots.txt, sitemaps, llms.txt, llms-full.txt, ai.txt.
  for (const [url, list] of recorder.responses) {
    if (done.has(url)) continue;
    if (!isSiteFile(url)) continue;
    const r = list[0];
    w.add({ url, status: r.status, contentType: r.headers?.['content-type'] || r.contentType || '', location: r.headers?.location || null, body: r.body, title: null, fetchedAt: r.fetchedAt });
  }
  const out = w.finish();
  log(`--save-html: ${out.count} URLs archived in ${out.dir}`);
  return out;
}

async function fullAudit(opts, http, siteHosts, log, archive = null) {
  const chain = await followChain(http, opts.url, { maxHops: 10 });
  if (chain.error && !chain.final) fail(2, `Cannot reach ${opts.url}: ${chain.error}${/CERT|certificate|SELF_SIGNED/i.test(chain.error) ? '\nSelf-signed certificate? Re-run with --insecure.' : ''}`);
  const finalUrl = normalise(chain.final || opts.url);
  const first = await http.get(finalUrl, { redirect: 'manual', maxBytes: 512 * 1024 });
  const challenge = challengeVendor(first.status, first.body, first.headers);
  if (challenge) fail(2, `${finalUrl} answered ${first.status} with a ${challenge} bot challenge. Ask the owner for a firewall rule that skips the challenge for a secret header and pass it with --header "Name: value".`);
  const u = new URL(finalUrl);
  for (const h of [u.host.toLowerCase(), siblingHost(u.host.toLowerCase())]) if (h && !siteHosts.includes(h)) siteHosts.push(h);
  // Archive mode posts the archived HTML to the validator, as for a private host.
  const isPrivate = archive ? true : isPrivateHost(u.hostname) || await resolvedPrivately(u.hostname);
  const remote = !opts.noRemote;

  const robotsRes = await http.get(`${u.origin}/robots.txt`, { redirect: 'follow', maxBytes: 256 * 1024 });
  const robotsText = robotsRes.status === 200 && !/<html/i.test(robotsRes.body || '') ? robotsRes.body : '';
  const robots = { status: robotsRes.status, parsed: robotsText ? parseRobotsTxt(robotsText) : null, error: robotsRes.error || null };
  const declared = robots.parsed?.sitemaps || [];
  const candidates = [...new Set([...declared.map((s) => { try { return new URL(s, u.origin).toString(); } catch { return null; } }).filter(Boolean), `${u.origin}/sitemap.xml`, `${u.origin}/sitemap_index.xml`])];
  const sitemap = await loadSitemaps(http, candidates, { maxChildren: 20, maxUrls: 20000, log });
  sitemap.declared = declared;
  log(`robots.txt ${robots.status}; sitemap: ${sitemap.urls.length} URLs`);

  const crawl = await crawlSite(http, archive ? archiveCrawl(archive, opts, { startUrl: finalUrl, hosts: siteHosts, robots: robots.parsed, log }) : {
    startUrl: finalUrl, hosts: siteHosts, sitemapUrls: sitemap.urls, robots: robots.parsed,
    maxPages: opts.pages, sitemapSample: opts.sitemapSample, ignoreRobots: opts.ignoreRobots, concurrency: opts.concurrency, log,
  });
  if (archive) {
    Object.assign(crawl, { archiveExtra: crawl.sitemapSampled, sitemapSampled: 0, sitemapMissing: 0 });
    // Link targets the crawl recorded but never asked for (links on pages read after the link
    // crawl): the ones the archive lacks are not archived too.
    const read = new Set(crawl.pages.map((p) => p.url));
    for (const link of crawl.inlinks.keys()) if (!read.has(link) && !archive.entry(link)) (hasMask(link) ? archive.masked : archive.notArchived).add(link);
  }
  log(`crawl done: ${crawl.pages.length} URLs, ${htmlPages(crawl.pages).length} HTML pages`);

  // JSON-LD that only exists after JavaScript runs: render a few pages in Chrome and adopt what they add.
  const renderInfo = archive ? { summary: { ran: false, error: 'skipped: archive mode', pages: [] }, html: new Map() }
    : await renderPass(pickRenderPages(crawl.pages, finalUrl, opts.renderPages), crawl.pages, { opts, siteHosts, log });
  const html = htmlPages(crawl.pages);

  // og:image: one check per distinct absolute image.
  const ogUrls = archive ? [] : [...new Set(html.map((p) => p.og?.image).filter((x) => x && /^https?:\/\//i.test(x)))].slice(0, 40);
  const lim = pLimit(opts.concurrency);
  const ogImages = await Promise.all(ogUrls.map((img) => lim(async () => {
    // HEAD can 404 where GET (what Facebook, LinkedIn and Slack send) answers 200: trust the GET.
    const r = await headThenGet(http, img);
    return { url: img, status: r.status, contentType: r.contentType, error: r.error || null };
  })));

  // Internal links the crawl found but did not fetch (past --pages): a status each, so a broken
  // footer link in a section the budget only touched once is still reported.
  let internal = null;
  if (opts.internalLinks > 0 && !archive) {
    internal = await checkInternal(http, crawl, { max: opts.internalLinks, concurrency: opts.concurrency });
    if (internal.checked.length) log(`internal links: checked ${internal.checked.length} not crawled${internal.unchecked ? `, ${internal.unchecked} left unchecked` : ''}`);
  }

  let external = null;
  if (opts.externalLinks > 0 && !archive) {
    const list = [...crawl.external.keys()].filter((x) => /^https?:/i.test(x)).slice(0, opts.externalLinks);
    log(`external links: checking ${list.length} of ${crawl.external.size}`);
    external = await checkExternal(http, list, { concurrency: opts.concurrency });
  }

  let schema = null;
  if (remote && opts.schemaPages > 0) {
    const picks = pickSchemaPages(crawl.pages, opts.schemaPages);
    log(`validator.schema.org: ${picks.length} pages${archive ? ' (posting the archived HTML)' : isPrivate ? ' (posting the HTML: private host)' : ''}`);
    schema = [];
    const validate = cachedValidator(http);
    for (const url of picks) {
      let res;
      const rendered = renderInfo.html.get(url);
      if (rendered) res = { ...(await validate({ html: rendered })), rendered: true };
      else if (isPrivate) {
        const page = await http.get(url, { redirect: 'follow', maxBytes: 4 * 1024 * 1024 });
        res = await validate({ html: page.body || '' });
      } else res = await validate({ url });
      const { raw: _raw, ...kept } = res;
      schema.push({ url, ...kept });
      if (!res.ok && /network|timeout|HTTP 5|rate/i.test(res.error || '')) break;
    }
  }

  log('llms.txt, llms-full.txt, ai.txt');
  // Archive mode: llms.txt is read when archived, its links are not status-checked.
  const geo = archive ? await fetchGeo(http, u.origin, { maxLinks: 0 }) : await fetchGeo(http, u.origin);

  // What the edge does to AI crawlers: no --header bypass here, since that would skip the very
  // rule being tested. Start page first, then one page per section.
  let botAccess = null;
  if (opts.botPages > 0 && !archive) {
    const botUrls = pickRenderPages(crawl.pages, finalUrl, opts.botPages);
    log(`AI crawler user agents: ${botUrls.length} page${botUrls.length === 1 ? '' : 's'}`);
    const plain = createHttp({ timeout: opts.timeout, concurrency: opts.concurrency });
    botAccess = await fetchBotAccess(plain, botUrls, { robots: opts.ignoreRobots ? null : robots.parsed, challengeVendor });
  }

  const rows = runChecks({
    finalUrl, hosts: siteHosts, productionHost: opts.productionHost, pages: crawl.pages, inlinks: crawl.inlinks, blocked: crawl.blocked,
    truncated: crawl.truncated, robots, sitemap, external, externalFrom: crawl.external, internal, ogImages: ogUrls.length ? ogImages : null, schema, render: renderInfo.summary,
  });
  const startPage = crawl.pages.find((p) => p.url === finalUrl);
  rows.push(...geoChecks({ robots, robotsText, geo, start: startPage }));
  rows.push(botAccessRow(botAccess));
  rows.push(renderedTextRow({ pages: crawl.pages, render: renderInfo.summary }));
  rows.push(...freshnessRows({ pages: crawl.pages, sitemap }));
  rows.push(...[answerStructureRow({ pages: crawl.pages }), schemaOpportunitiesRow({ pages: crawl.pages }), bingRow({ robots, start: startPage })].filter(Boolean));

  // Archive mode: rows that need the network become "skipped: archive mode", rows that see less
  // than a live run say so. robots.txt, sitemaps and llms.txt count as read when they answered.
  let archiveInfo = null;
  if (archive) {
    const notArchivedLinks = [...crawl.inlinks.keys()].filter((l) => archive.notArchived.has(l)).length;
    const applied = applyArchiveMode(rows, { robots: robots.status > 0, sitemap: sitemap.sources.some((x) => x.status > 0), llms: geo.llms.status > 0, notArchivedLinks });
    rows.splice(0, rows.length, ...applied.rows);
    archiveInfo = archiveSummary(archive, opts, { skipped: applied.skipped, degraded: applied.degraded, extra: crawl.archiveExtra, notArchivedLinks });
  }

  const date = new Date().toISOString().slice(0, 10);
  return { inlinks: crawl.inlinks, report: {
    tool: 'audit-seo',
    version: VERSION, date,
    site: { url: opts.url, finalUrl, host: u.host.toLowerCase() },
    env: { note: /(^|[.-])(dev|develop|staging|stage|stg|test|uat|qa|preview)([.-]|$)/i.test(u.hostname) ? 'This looks like a dev or staging host: noindex and a blocking robots.txt are expected here and belong on the launch checklist, not the fix list.' : null },
    stats: {
      html: html.length, other: crawl.pages.length - html.length, redirects: crawl.pages.filter((p) => p.location).length,
      errors: crawl.pages.filter((p) => p.status === 0 || p.status >= 400).length, indexable: html.filter((p) => !p.noindex).length,
      truncated: crawl.truncated, maxPages: opts.pages, sitemapUrls: sitemap.urls.length, sitemapSampled: crawl.sitemapSampled, sitemapMissing: crawl.sitemapMissing,
      linksChecked: internal?.checked.length || 0, linksUnchecked: internal?.unchecked || 0, locales: crawl.locales,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    },
    geo: { score: geoScore(rows), botAccess },
    ...(archiveInfo ? { archive: archiveInfo } : {}),
    rows,
    pages: crawl.pages,
  } };
}

/**
 * The crawl options for archive mode: links first as usual, but only archived URLs are queued
 * (the others are listed as not archived), with a budget the size of the archive; then every
 * archived page the links did not reach. --allow-live keeps the --pages budget and fetches link
 * targets the archive does not hold from the site. URLs that hold a masked placeholder are never
 * queued.
 */
function archiveCrawl(archive, opts, { startUrl, hosts, robots, log }) {
  const known = (n) => {
    if (hasMask(n)) { archive.masked.add(n); return false; }
    if (archive.entry(n)) return true;
    if (opts.allowLive) return true;
    archive.notArchived.add(n);
    return false;
  };
  return {
    startUrl, hosts, robots, sitemapUrls: archive.urls().filter((u) => !isSiteFile(u)), known, retryDelay: 0,
    maxPages: opts.allowLive ? opts.pages : Math.max(opts.pages, archive.size), sitemapSample: archive.size,
    ignoreRobots: opts.ignoreRobots, concurrency: opts.concurrency, log,
  };
}

/** report.archive: where the pages came from and what archive mode left out. */
function archiveSummary(archive, opts, { skipped = [], degraded = [], extra = 0, notArchivedLinks = 0 } = {}) {
  return {
    dir: archive.dir, date: archive.date, allowLive: opts.allowLive, extra, notArchivedLinks,
    live: [...archive.live], notArchived: [...archive.notArchived], masked: archive.maskedValues, maskedUrls: [...archive.masked],
    skipped, degraded,
  };
}

/** validator.schema.org with one answer per distinct request in a run (same URL or same HTML). */
function cachedValidator(http) {
  const seen = new Map();
  return (input) => {
    const key = input.url ? `url:${input.url}` : `html:${createHash('sha256').update(input.html || '').digest('hex')}`;
    if (!seen.has(key)) seen.set(key, schemaValidate(http, input));
    return seen.get(key);
  };
}

/**
 * Render `urls` in Chrome; where the rendered DOM has more JSON-LD blocks than the served HTML,
 * the page's jsonLd is replaced by the rendered one and its DOM kept for the validator.
 * -> { summary: { ran, error, pages: [{ url, ok, added, error }] }, html: Map<url, renderedHtml> }
 */
async function renderPass(urls, pages, { opts, siteHosts, log }) {
  const html = new Map();
  if (!urls.length) return { summary: { ran: false, error: opts.renderPages ? 'no HTML page to render' : null, pages: [] }, html };
  if (!findChrome()) return { summary: { ran: false, error: 'no Chrome, Chromium or Edge found (install one or set CHROME_PATH)', pages: [] }, html };
  log(`Chrome: rendering ${urls.length} page${urls.length === 1 ? '' : 's'} (JSON-LD and text added by JavaScript)`);
  let browser;
  try { browser = await launch({ insecure: opts.insecure }); } catch (e) { return { summary: { ran: false, error: e.message, pages: [] }, html }; }
  const out = [];
  try {
    for (const url of urls) {
      const r = await render(browser, url, { headers: opts.headers, hosts: siteHosts, timeout: Math.max(opts.timeout * 2, 20000), measure: TEXT_MEASURE });
      if (!r.ok) { out.push({ url, ok: false, added: 0, error: r.error }); continue; }
      const blocks = extractMeta(r.html, url).jsonLd;
      const page = pages.find((p) => p.url === url);
      if (page && r.measured && Number.isFinite(r.measured.words)) {
        page.renderedWords = r.measured.words;
        page.renderedHeadings = r.measured.headings;
      }
      const before = page?.jsonLd?.length || 0;
      const added = Math.max(0, blocks.length - before);
      if (added && page) {
        page.jsonLd = blocks.map((j) => ({ types: j.types, error: j.error }));
        Object.assign(page, richOf(blocks));
        page.jsonLdClientSide = added;
        html.set(url, r.html);
      }
      out.push({ url, ok: true, added });
    }
  } finally { await browser.close(); }
  return { summary: { ran: true, error: null, pages: out }, html };
}

/** --schema-only and local files: one page, structured-data checks only, every validator issue listed. */
async function schemaOnly(opts, http, siteHosts, log, archive = null) {
  let url = opts.url; let body; let isPrivate = true;
  if (opts.file) {
    body = await fs.readFile(opts.file, 'utf8');
  } else {
    const chain = await followChain(http, opts.url, { maxHops: 10 });
    if (chain.error && !chain.final) fail(2, `Cannot reach ${opts.url}: ${chain.error}${/CERT|certificate|SELF_SIGNED/i.test(chain.error) ? '\nSelf-signed certificate? Re-run with --insecure.' : ''}`);
    url = normalise(chain.final || opts.url);
    const res = await http.get(url, { redirect: 'follow', maxBytes: 4 * 1024 * 1024 });
    const challenge = challengeVendor(res.status, res.body, res.headers);
    if (challenge) fail(2, `${url} answered ${res.status} with a ${challenge} bot challenge. Pass a firewall bypass header with --header "Name: value".`);
    if (!res.ok) fail(2, `${url} answered ${res.status || res.error}`);
    body = res.body || '';
    const u = new URL(url);
    for (const h of [u.host.toLowerCase(), siblingHost(u.host.toLowerCase())]) if (h && !siteHosts.includes(h)) siteHosts.push(h);
    isPrivate = archive ? true : isPrivateHost(u.hostname) || await resolvedPrivately(u.hostname);
  }
  const meta = extractMeta(body, url);
  const page = { url, status: 200, title: meta.title ?? '', noindex: false, canonical: null, jsonLd: meta.jsonLd.map((j) => ({ types: j.types, error: j.error })), ...richOf(meta.jsonLd) };
  const pages = [page];
  const renderInfo = archive ? { summary: { ran: false, error: 'skipped: archive mode', pages: [] }, html: new Map() }
    : await renderPass(opts.renderPages ? [url] : [], pages, { opts, siteHosts, log });
  let schema = null;
  if (!opts.noRemote) {
    const rendered = renderInfo.html.get(url);
    log(`validator.schema.org: ${rendered ? 'posting the rendered DOM' : isPrivate ? 'posting the HTML' : 'by URL'}`);
    let res = rendered ? { ...(await schemaValidate(http, { html: rendered })), rendered: true }
      : isPrivate ? await schemaValidate(http, { html: body }) : await schemaValidate(http, { url });
    if (!rendered && !isPrivate && (!res.ok || res.raw?.fetchError)) res = await schemaValidate(http, { html: body });
    const { raw: _raw, ...kept } = res;
    schema = [{ url, ...kept }];
  }
  let rows = schemaChecks({ pages, schema, render: renderInfo.summary, detailed: true });
  let archiveInfo = null;
  if (archive) {
    const applied = applyArchiveMode(rows, { robots: true, sitemap: true, llms: true });
    rows = applied.rows.filter((r) => r.archive !== 'skipped' || r.id === 'seo.jsonld-client-side');
    archiveInfo = archiveSummary(archive, opts, { skipped: applied.skipped.filter((x) => x.id === 'seo.jsonld-client-side'), degraded: applied.degraded });
  }
  const where = opts.file ? opts.file : url;
  return { inlinks: new Map(), report: {
    tool: 'audit-seo', mode: 'schema',
    version: VERSION, date: new Date().toISOString().slice(0, 10),
    site: { url: opts.file || opts.url, finalUrl: where, host: opts.host },
    env: { note: null },
    stats: { html: 1, other: 0, redirects: 0, errors: 0, indexable: 1, truncated: false, maxPages: 1, sitemapUrls: 0, sitemapSampled: 0, sitemapMissing: 0, seconds: Math.round((Date.now() - startedAt) / 1000) },
    ...(archiveInfo ? { archive: archiveInfo } : {}),
    rows,
    pages,
  } };
}

async function writeOut(opts, report, inlinks) {
  // A --schema-only run keeps its own baseline, so it never replaces the full audit's.
  // An archive run keeps its own too: its skipped rows must not become the live run's baseline.
  const lastName = `last-${report.archive ? 'archive-' : ''}${report.mode === 'schema' ? 'schema-' : ''}report.json`;
  const stateDir = claimTarget(resolveState({ state: opts.state, host: opts.host }), opts.host);
  // --console alone (no --report, no --out): the run's files go to a scratch folder that is removed at the end.
  const scratch = opts.console && !opts.report && !opts.out ? scratchDir('audit-seo') : null;
  const dir = resolveOut({ out: scratch || opts.out, host: opts.host }, { state: stateDir, exists: fsSync.existsSync });
  markRun(dir, { skill: 'audit-seo', target: opts.host });
  report.state = stateDir;
  const notes = readNotes(stateDir);
  if (notes) report.notes = notes;
  const baselineFile = findBaseline(opts, stateDir, dir, report.mode, lastName, Boolean(report.archive));
  if (baselineFile) {
    try {
      const prev = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
      report.diff = { from: baselineFile, date: prev.date, ...diffRows(prev.rows, report.rows) };
    } catch (e) {
      report.diff = { from: baselineFile, error: e.message, fixed: [], regressed: [], changed: [] };
    }
  }
  const paths = { md: path.join(dir, 'report.md'), json: path.join(dir, 'report.json'), findings: path.join(dir, 'findings.json'), csv: path.join(dir, 'pages.csv') };
  await fs.writeFile(paths.md, renderMarkdown(report, { levels: opts.levels, geo: opts.geo && report.mode !== 'schema' }));
  await fs.writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(paths.findings, `${JSON.stringify(findings(report), null, 2)}\n`);
  await fs.writeFile(paths.csv, pagesCsv(report.pages, inlinks));
  await fs.writeFile(path.join(stateDir, lastName), JSON.stringify(report));
  const head = opts.console
    ? `${consoleList({ title: `audit-seo ${report.site.host}`, items: consoleItems(report, { geo: opts.geo && report.mode !== 'schema' }), levels: opts.levels })}${(opts.report || opts.out) ? `\nReport: ${paths.md}` : ''}`
    : renderStdout(report, paths, { levels: opts.levels, geo: opts.geo && report.mode !== 'schema' });
  removeScratch(scratch);
  process.stdout.write(`${head}\nState: ${stateDir}\nCompared with: ${baselineFile || 'nothing (first run for this host)'}${notes ? '\nNotes: notes.md included in the report' : ''}\n`);
}

/**
 * --baseline, else the last run for this host (last-report.json in the target folder;
 * last-schema-report.json for --schema-only), else the
 * newest earlier report.json for this host under <reports>/audit-seo/ or <reports>/audit-all/,
 * found by its content rather than its folder name.
 */
function findBaseline(opts, stateDir, outDir, mode, lastName, fromArchive = false) {
  if (opts.noBaseline) return null;
  if (opts.baseline) return path.resolve(opts.baseline);
  const last = path.join(stateDir, lastName);
  if (fsSync.existsSync(last)) return last;
  const reports = reportsRoot();
  return findEarlier([path.join(reports, 'audit-seo'), path.join(reports, 'audit-all')], 'report.json', (j) => j?.tool === 'audit-seo' && j.site?.host === opts.host && j.mode === mode && Boolean(j.archive) === fromArchive, { exclude: outDir })[0] || null;
}

main().catch((e) => fail(1, `audit-seo failed: ${e?.stack || e}`));
