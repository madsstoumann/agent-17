#!/usr/bin/env node
/**
 * launch-audit — pre-launch website audit.
 *
 *   node audit.mjs <url> [--env dev|staging|production] [--pages N] [--skip a,b] [--out DIR] [--baseline report.json] ...
 *
 * Phases: A bootstrap (start page, robots, sitemap) → B fast groups in parallel →
 * C Lighthouse (sequential) + the groups that read it → D assemble, write, summarise.
 * A failing check never stops the run; a failing group becomes one skip row.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';

import { parseCli, resolveOut, usage } from './lib/cli.mjs';
import { createHttp, curlProbe, isPrivateHost, isPrivateAddress, hostOf, siblingHost, stripWww, VERSION, UA } from './lib/http.mjs';
import { GROUPS, runGroups, filterGroups, applyEnvPolicy, countStatuses, result, isSkipped } from './lib/registry.mjs';
import { renderMarkdown, renderStdout, buildManualLinks } from './lib/report.mjs';
import { diffReports } from './lib/diff.mjs';
import { extractMeta } from './lib/html.mjs';
import { parseRobotsTxt, loadSitemaps } from './lib/robots.mjs';
import { followChain } from './lib/redirects.mjs';
import { checkLocalLighthouse, findChrome, runLighthouseLocal, runPsi, summariseLhr, pickPerfPages } from './lib/lighthouse.mjs';

import crawlability from './lib/groups/01-crawlability.mjs';
import redirects from './lib/groups/02-redirects.mjs';
import notfound from './lib/groups/03-notfound.mjs';
import tlsDnsEmail from './lib/groups/04-tls-dns-email.mjs';
import exposed from './lib/groups/05-exposed.mjs';
import headers from './lib/groups/06-headers.mjs';
import caching from './lib/groups/07-caching.mjs';
import perf from './lib/groups/08-perf.mjs';
import a11y from './lib/groups/09-a11y.mjs';
import privacy from './lib/groups/10-privacy.mjs';
import links from './lib/groups/11-links.mjs';
import ops from './lib/groups/12-operational.mjs';

const GROUP_MODULES = [crawlability, redirects, notfound, tlsDnsEmail, exposed, headers, caching, perf, a11y, privacy, links, ops];

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

function looksLikeChallenge(status, body) {
  return (status === 403 || status === 503) && /just a moment|cf-chl|challenge-platform|attention required|access denied|incapsula|akamai/i.test(body || '');
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
  if (parsed.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
  if (!parsed.ok) fail(1, `${parsed.error}\n\n${usage()}`);
  const opts = parsed.opts;

  // Must happen before the first TLS connection.
  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const out = resolveOut({ out: opts.out, host: opts.host });
  await fs.mkdir(out.dir, { recursive: true });
  await fs.mkdir(out.rawDir, { recursive: true });

  const log = opts.quiet ? () => {} : (m) => process.stderr.write(`[${elapsed()}s] ${m}\n`);
  const http = createHttp({ timeout: opts.timeout, ua: opts.ua || UA, from: opts.from, concurrency: opts.concurrency, log: (m) => { if (process.env.LAUNCH_AUDIT_DEBUG) log(m); } });

  // ------------------------------------------------------------------ Phase A
  log(`launch-audit ${VERSION} — ${opts.url} (env: ${opts.env}, ${opts.envSource})`);
  const chain = await followChain(http, opts.url, { maxHops: 10 });
  if (chain.error && !chain.final) {
    fail(2, `Cannot reach ${opts.url}: ${chain.error}${/CERT|certificate|self.signed|SELF_SIGNED/i.test(chain.error) ? '\nSelf-signed certificate? Re-run with --insecure.' : ''}`);
  }
  const finalUrl = chain.final || opts.url;
  const page = await http.get(finalUrl, { redirect: 'follow', maxBytes: 3 * 1024 * 1024 });
  if (page.status === 0) fail(2, `Cannot fetch ${finalUrl}: ${page.error}${/CERT|certificate|self.signed|SELF_SIGNED/i.test(page.error || '') ? '\nSelf-signed certificate? Re-run with --insecure.' : ''}`);
  if (looksLikeChallenge(page.status, page.body)) {
    fail(2, `${finalUrl} answered ${page.status} with a bot challenge. Allowlist this machine's IP in the WAF (Cloudflare: disable Bot Fight Mode / add a WAF skip rule for staging) and re-run.`);
  }
  const html = /text\/html|application\/xhtml/i.test(page.contentType) ? (page.body || '') : '';
  const meta = html ? extractMeta(html, finalUrl) : null;
  const u = new URL(finalUrl);
  const origin = u.origin;
  const host = u.host.toLowerCase();
  const hostname = u.hostname.toLowerCase();
  const isPrivate = isPrivateHost(hostname) || await resolvedPrivately(hostname);
  const remote = !isPrivate && !opts.noRemote;
  log(`start page ${page.status} ${page.contentType.split(';')[0]} ${(page.bytes / 1024).toFixed(0)} kB${isPrivate ? ' — private host: remote services will be skipped' : ''}`);

  const curl = await curlProbe(finalUrl, { insecure: opts.insecure, timeout: 20000, ua: opts.ua || UA });

  const robotsRes = await http.get(`${origin}/robots.txt`, { redirect: 'follow', maxBytes: 256 * 1024 });
  const robotsText = robotsRes.status === 200 && /text\/plain/i.test(robotsRes.contentType) ? robotsRes.body : (robotsRes.status === 200 && !/<html/i.test(robotsRes.body || '') ? robotsRes.body : '');
  const robots = { status: robotsRes.status, contentType: robotsRes.contentType, text: robotsText || '', parsed: robotsText ? parseRobotsTxt(robotsText) : null, error: robotsRes.error || null };

  const declared = robots.parsed?.sitemaps || [];
  const candidates = [...new Set([...declared.map((s) => { try { return new URL(s, origin).toString(); } catch { return null; } }).filter(Boolean), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`])];
  const sitemap = await loadSitemaps(http, candidates, { maxChildren: 5, maxUrls: 5000, log });
  sitemap.declared = declared;
  sitemap.candidates = candidates;
  log(`robots.txt ${robots.status}; sitemap: ${sitemap.urls.length} URLs from ${sitemap.sources.filter((s) => s.status === 200).length} file(s)`);

  const raw = {};
  const ctx = {
    opts, log, http, startedAt,
    startUrl: opts.url, finalUrl, origin, host, hostname,
    apexHost: stripWww(hostname), wwwHost: hostname.startsWith('www.') ? hostname : `www.${stripWww(hostname)}`, sibling: siblingHost(hostname),
    emailDomain: opts.emailDomain, productionHost: opts.productionHost,
    production: opts.production, env: opts.env,
    isPrivate, insecure: opts.insecure, remote,
    page: { status: page.status, headers: page.headers, setCookie: page.setCookie, html, meta, curl, chain, contentType: page.contentType, bytes: page.bytes },
    robots, sitemap,
    sampledPages: pickPerfPages(sitemap.urls, { startUrl: finalUrl, n: opts.pages }),
    crawl: null, lh: null,
    scoreboard: {}, raw, rawDir: out.rawDir,
    chromePath: opts.chromePath || findChrome() || null,
    async saveRaw(name, data) {
      const file = path.join(out.rawDir, name);
      await fs.writeFile(file, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
      raw[name.replace(/\.json$/, '')] = out.mode === 'file' ? path.relative(out.dir, file) : name;
      return file;
    },
  };

  const selected = filterGroups(GROUP_MODULES.map((m) => ({ ...m, ...GROUPS.find((g) => g.id === m.id) })), { skip: opts.skip, only: opts.only });
  const timings = {};
  const results = [];
  let partialWritten = false;

  const assemble = ({ partial }) => {
    const policy = applyEnvPolicy(results, { production: opts.production, env: opts.env });
    const report = {
      schemaVersion: 1, tool: 'launch-audit', version: VERSION, generatedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
      input: { url: opts.url, env: opts.env, envSource: opts.envSource, envReason: opts.envReason, production: opts.production, productionHost: opts.productionHost, flags: { pages: opts.pages, maxPages: opts.maxPages, skip: opts.skip, only: opts.only, lighthouse: opts.lighthouse, insecure: opts.insecure, noRemote: opts.noRemote, emailDomain: opts.emailDomain } },
      site: { finalUrl, host, ip: curl.remoteIp || null, server: page.headers.server || null, httpVersion: curl.httpVersion || null, isPrivate, lighthouse: ctx.lh ? { runner: ctx.lh.runner, version: ctx.lh.version } : { runner: opts.lighthouse === 'off' ? 'off' : 'pending', version: null } },
      counts: countStatuses(policy.results),
      blockers: policy.results.filter((r) => r.blocker && r.status === 'fail').map((r) => r.id),
      beforeProduction: policy.beforeProduction,
      scoreboard: ctx.scoreboard,
      results: policy.results,
      pages: ctx.crawl?.pages || [],
      manual: buildManualLinks({ url: finalUrl, host }),
      raw,
      timings,
      ...(partial ? { partial: true } : {}),
    };
    return report;
  };

  const writeReport = async (report) => {
    await fs.writeFile(out.reportJson, JSON.stringify(report, null, 1));
    await fs.writeFile(out.reportMd, renderMarkdown(report));
  };

  const onSignal = async (sig) => {
    log(`${sig}: writing partial report`);
    try { await writeReport(assemble({ partial: true })); } catch { /* ignore */ }
    process.exit(130);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('unhandledRejection', (e) => log(`unhandled rejection: ${e?.message || e}`));

  // ------------------------------------------------------------------ Phase B
  const phaseB = selected.filter((g) => g.phase === 'B');
  log(`phase B: ${phaseB.map((g) => g.id).join(', ')}`);
  const b = await runGroups(phaseB, ctx, { log });
  results.push(...b.results); Object.assign(timings, b.timings);
  await writeReport(assemble({ partial: true })); partialWritten = true;

  // ------------------------------------------------------------------ Phase C
  // Lighthouse runs only when the perf group is selected (--skip perf skips Lighthouse; a11y/privacy then fall back)
  const perfWanted = selected.some((g) => g.id === 'perf') && opts.lighthouse !== 'off';
  ctx.lh = { runner: 'off', version: null, mobile: null, desktop: null, pages: [], errors: [], loadingExperience: null };
  if (perfWanted) {
    let runner = opts.lighthouse;
    if (runner === 'psi' && isPrivate) { runner = 'local'; ctx.lh.errors.push('PSI cannot reach a private host; used local Lighthouse'); }
    if (runner === 'local') {
      const check = checkLocalLighthouse({ chromePath: ctx.chromePath });
      if (!check.ok) { ctx.lh.errors.push(check.reason); runner = 'off'; }
    }
    ctx.lh.runner = runner;
    const runOne = async ({ url, strategy, name }) => {
      log(`lighthouse ${strategy} ${url}`);
      if (runner === 'psi') {
        const r = await runPsi(http, { url, strategy, key: opts.psiKey, timeout: 150000 });
        if (!r.ok && (r.status === 429 || r.status === 403) && !ctx.lh.fellBack) {
          ctx.lh.errors.push(`PSI answered ${r.status}; fell back to local Lighthouse`);
          ctx.lh.fellBack = true;
          const check = checkLocalLighthouse({ chromePath: ctx.chromePath });
          if (check.ok) { runner = 'local'; ctx.lh.runner = 'local'; return runOne({ url, strategy, name }); }
        }
        if (!r.ok) { ctx.lh.errors.push(`${name}: ${r.error}`); return null; }
        await ctx.saveRaw(`${name}.json`, { lighthouseResult: r.lhr, loadingExperience: r.loadingExperience, originLoadingExperience: r.originLoadingExperience });
        ctx.lh.version = r.lhr?.lighthouseVersion || ctx.lh.version;
        return summariseLhr(r.lhr, { source: 'psi', strategy, loadingExperience: r.loadingExperience });
      }
      const file = path.join(out.rawDir, `${name}.json`);
      const r = await runLighthouseLocal({ url, file, desktop: strategy === 'desktop', insecure: opts.insecure, timeout: opts.lhTimeout, chromePath: ctx.chromePath, log });
      if (!r.ok) { ctx.lh.errors.push(`${name}: ${r.error}`); return null; }
      raw[name] = out.mode === 'file' ? path.relative(out.dir, file) : `${name}.json`;
      ctx.lh.version = r.version || r.lhr?.lighthouseVersion || ctx.lh.version;
      return summariseLhr(r.lhr, { source: 'local', strategy });
    };
    if (runner !== 'off') {
      ctx.lh.mobile = await runOne({ url: finalUrl, strategy: 'mobile', name: 'lighthouse-mobile' });
      ctx.lh.desktop = await runOne({ url: finalUrl, strategy: 'desktop', name: 'lighthouse-desktop' });
      let i = 0;
      for (const pageUrl of ctx.sampledPages) {
        i++;
        const s = await runOne({ url: pageUrl, strategy: 'mobile', name: `lighthouse-page-${i}` });
        if (s) ctx.lh.pages.push({ url: pageUrl, summary: s });
      }
    }
  }
  const phaseC = selected.filter((g) => g.phase === 'C');
  if (phaseC.length) {
    log(`phase C: ${phaseC.map((g) => g.id).join(', ')}`);
    const c = await runGroups(phaseC, ctx, { log });
    results.push(...c.results); Object.assign(timings, c.timings);
  }

  // ------------------------------------------------------------------ Phase D
  const report = assemble({ partial: false });
  if (opts.baseline) {
    try {
      const prev = JSON.parse(await fs.readFile(path.resolve(opts.baseline), 'utf8'));
      report.diff = diffReports(prev, report);
    } catch (e) {
      report.diff = { error: `could not read ${opts.baseline}: ${e.message}`, fixed: [], regressed: [], newFindings: [], removed: [], scores: [] };
    }
  }
  await writeReport(report);
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
  else process.stdout.write(`${renderStdout(report, { reportMd: out.reportMd, reportJson: out.reportJson })}\n`);
  if (opts.strict && report.counts.fail > 0) process.exit(3);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`launch-audit crashed: ${e?.stack || e}\n`);
  process.exit(1);
});
