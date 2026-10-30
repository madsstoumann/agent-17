#!/usr/bin/env node
// infra-audit: domain, DNS, mail authentication, TLS per endpoint, edge and subdomains of a site.
// Passive: DNS over HTTPS, ordinary TLS handshakes, one GET of the home page, and the public
// RDAP, crt.sh and hstspreload.org APIs. Writes report.md and report.json, prints a summary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResolver, apexOf, undot } from './lib/dns.mjs';
import { SECTIONS, domainChecks, emailChecks, tlsChecks, edgeChecks, ctChecks } from './lib/checks.mjs';
import { DKIM_SELECTORS } from './lib/email.mjs';
import { result, countStatuses, prepareRun, finishRun, diffRows, carryOverSections, sectionTables, fixFirst, resultLine, taskCandidates, writeJson, log, settle, GLYPH } from './lib/common.mjs';

export const VERSION = '1.0.0';
const UA = `Mozilla/5.0 (compatible; infra-audit/${VERSION})`;

const USAGE = `infra-audit ${VERSION}: domain, DNS, email, TLS and subdomain audit

Usage: node scan.mjs <url or host> [options]

  --out DIR              Run folder (default <reports>/infra-audit/<host>/runs/<YYYYMMDD-HHMM>/)
  --baseline FILE        Compare with this report.json (default: the last run for this host)
  --email-domain D       Mail domain when it is not the site's registrable domain
  --dkim-selector S      Your provider's DKIM selector (repeatable; added to the common ones)
  --only G,...           Groups: domain email tls edge ct
  --skip G,...           Skip groups
  --no-ct                Skip the Certificate Transparency subdomain sweep (crt.sh)
  --max-subdomains N     Subdomains to probe from CT (default 30)
  --no-legacy            Skip the TLS 1.0/1.1 acceptance probe
  --header "Name: value" Sent with the one GET of the home page (WAF bypass rule); also AUDIT_HEADERS
  -h, --help
`;

export function parseArgs(argv, env = process.env) {
  const a = { target: null, out: null, emailDomain: null, selectors: [], only: null, skip: [], ct: true, maxSubdomains: 30, legacy: true, headers: {} };
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === '-h' || k === '--help') a.help = true;
    else if (k === '--out') a.out = next();
    else if (k === '--baseline') a.baseline = next();
    else if (k === '--email-domain') a.emailDomain = undot(next());
    else if (k === '--dkim-selector') a.selectors.push(...list(next()));
    else if (k === '--only') a.only = list(next());
    else if (k === '--skip') a.skip.push(...list(next()));
    else if (k === '--no-ct') a.ct = false;
    else if (k === '--max-subdomains') a.maxSubdomains = Math.max(0, Number(next()) || 0);
    else if (k === '--no-legacy') a.legacy = false;
    else if (k === '--header') addHeader(a.headers, next());
    else if (k.startsWith('-')) throw new Error(`Unknown option ${k}`);
    else if (!a.target) a.target = k;
    else throw new Error(`Unexpected argument ${k}`);
  }
  for (const line of String(env.AUDIT_HEADERS || '').split('\n')) if (line.trim()) addHeader(a.headers, line);
  return a;
}

function addHeader(headers, line) {
  const i = line.indexOf(':');
  if (i < 1) throw new Error(`--header needs "Name: value", got "${line}"`);
  headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
}

/** "https://www.Example.dk/path" | "example.dk" -> { host, url } */
export function parseTarget(t) {
  const s = String(t || '').trim();
  if (!s) throw new Error('Give a URL or a host name');
  const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  return { host: u.hostname.toLowerCase(), url: u.href };
}

export const siblingOf = (host, apex) => (host === apex ? `www.${apex}` : host === `www.${apex}` ? apex : null);

const GROUPS = [
  ['domain', domainChecks, 60000],
  ['email', emailChecks, 90000],
  ['tls', tlsChecks, 90000],
  ['edge', edgeChecks, 45000],
  ['ct', ctChecks, 180000],
];

export async function run(args, deps = {}) {
  const { host, url } = parseTarget(args.target);
  const apex = apexOf(host);
  const now = deps.now || new Date();
  const ctx = {
    host, url, apex, sibling: siblingOf(host, apex), emailDomain: args.emailDomain || apex,
    resolver: deps.resolver || createResolver({ fetch: deps.fetch }), fetch: deps.fetch || globalThis.fetch, connect: deps.connect,
    now, ua: UA, siteHeaders: args.headers || {}, legacy: args.legacy !== false, maxSubdomains: args.maxSubdomains ?? 30,
    dkimSelectors: [...new Set([...(args.selectors || []), ...DKIM_SELECTORS])], customSelectors: Boolean(args.selectors?.length),
    shared: {},
  };
  const want = (g) => (args.only ? args.only.includes(g) : true) && !(args.skip || []).includes(g) && !(g === 'ct' && args.ct === false);
  const runGroup = async ([id, fn, budget]) => {
    if (!want(id)) return [];
    const t = Date.now();
    const rows = await settle(fn(ctx), budget, (e) => [result(`${id === 'domain' ? 'dns' : id}.error`, 'skip', `${SECTIONS.find((s) => s.id === id).title} did not finish`, e.message)]);
    log(`${id}: ${rows.length} checks in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    return rows;
  };
  // domain first (CAA and addresses feed tls and ct), edge before ct (HSTS feeds the no-https verdict).
  const results = [...await runGroup(GROUPS[0])];
  const [email, tls, edge] = await Promise.all([runGroup(GROUPS[1]), runGroup(GROUPS[2]), runGroup(GROUPS[3])]);
  results.push(...email, ...tls, ...edge, ...await runGroup(GROUPS[4]));
  markIntercepted(results);
  const counts = countStatuses(results);
  return { tool: 'infra-audit', version: VERSION, generatedAt: now.toISOString(), target: { url, host, apex, emailDomain: ctx.emailDomain, sibling: ctx.sibling }, counts, results };
}

/** With TLS inspection on the network, certificate rows describe the proxy: turn them into skips. */
export function markIntercepted(results) {
  if (!results.some((r) => r.id === 'tls.interception')) return results;
  for (const r of results) {
    if (!/^tls\.(chain|expiry|consistency|san|key|protocol|alpn|ocsp-stapling|legacy|caa-match)$/.test(r.id) || r.status === 'skip') continue;
    r.evidence = `not checked from this network (TLS is re-signed on the way, see "Certificate not in CT logs"); seen: ${r.evidence}`;
    r.status = 'skip';
    r.fix = '';
    delete r.blocker;
  }
  return results;
}

export function renderMarkdown(report) {
  const { target: t, counts, results } = report;
  const out = [`# Infrastructure audit — ${t.host}`, ''];
  out.push(`**Site:** ${t.url}  ·  **Domain:** ${t.apex}${t.emailDomain !== t.apex ? `  ·  **Mail domain:** ${t.emailDomain}` : ''}  ·  **Date:** ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC  ·  **Tool:** infra-audit ${report.version}`, '');
  out.push(resultLine(counts), '');
  out.push(...fixFirst(results));
  const warns = results.filter((r) => r.status === 'warn');
  if (warns.length) {
    out.push('## Should fix', '');
    for (const r of warns) out.push(`- ⚠️ **${r.title}** — ${r.evidence}${r.fix ? ` → ${r.fix}` : ''}`);
    out.push('');
  }
  out.push(...carryOverSections(report));
  out.push(...sectionTables(results, SECTIONS));
  out.push('## Not checked here', '', 'Redirects (http→https, www/apex), compression, cache headers, HTTP version, security headers, cookies and exposed files are checked by launch-audit (`redirects`, `caching`, `headers`, `exposed`). This audit only reads public DNS, certificates and registry data: no port scans, no load, no login.', '');
  return out.join('\n');
}

export function renderStdout(report, files) {
  const { target: t, counts, results } = report;
  const lines = [`infra-audit ${t.host} (domain ${t.apex}, mail ${t.emailDomain})`, resultLine(counts).replace(/\*/g, '')];
  for (const s of ['fail', 'warn']) for (const r of results.filter((x) => x.status === s)) lines.push(`${GLYPH[s]} ${r.id} ${r.title}: ${r.evidence.slice(0, 220)}`);
  for (const r of results.filter((x) => x.status === 'skip')) lines.push(`${GLYPH.skip} ${r.id}: ${r.evidence.slice(0, 160)}`);
  lines.push('', `report: ${files.md}`, `json:   ${files.json}`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) { process.stdout.write(USAGE); process.exit(args.help ? 0 : 2); }
  const { host } = parseTarget(args.target);
  const { state, dir, baselineFile, notes } = prepareRun({ skill: 'infra-audit', host, out: args.out, baseline: args.baseline });
  log(`infra-audit ${VERSION}: ${host} -> ${dir}`);
  const report = await run(args);
  report.tasks = taskCandidates(report.results, { source: 'infra', ref: `${path.basename(dir)}/report.md` });
  const files = { md: path.join(dir, 'report.md'), json: path.join(dir, 'report.json') };
  if (notes) report.notes = notes;
  if (baselineFile) {
    try {
      const prev = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      report.diff = { from: baselineFile, date: prev.generatedAt, ...diffRows(prev.results, report.results) };
    } catch (e) {
      report.diff = { from: baselineFile, error: e.message, fixed: [], regressed: [], changed: [] };
    }
  }
  fs.writeFileSync(files.md, renderMarkdown(report));
  writeJson(files.json, report);
  finishRun(state, report);
  process.stdout.write(`${renderStdout(report, files)}\nstate:      ${state}\ncompared:   ${baselineFile || 'nothing (first run for this host)'}${notes ? '\nnotes:      notes.md included in the report' : ''}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log(`infra-audit: ${e.message}`); process.exit(1); });
}
