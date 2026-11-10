/**
 * audit-security — site mode: the live site checked from outside, passively.
 *
 * The header, redirect and exposed-file checks are audit-launch's own (its `headers`, `redirects`
 * and `exposed` groups, run as a child process from the sibling skill), so the two skills never
 * disagree about a header. This file adds what audit-launch does not have: a clickjacking row
 * (CSP frame-ancestors against X-Frame-Options) and the blocklists (OpenPhish, plus Google Safe
 * Browsing, URLhaus and VirusTotal when their keys are set, via is-website-safe's sources.mjs).
 *
 * Passive only: one request per well-known path, no fuzzing, no login attempts, no load.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseTarget } from './target.mjs';
import { openPhish, safeBrowsing, urlhaus, virusTotal } from './sources.mjs';
import { shows, levelNote, levelOf } from './levels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LAUNCH_SCRIPT = path.resolve(HERE, '..', '..', '..', 'audit-launch', 'scripts', 'audit.mjs');

export const SITE_GROUPS = ['headers', 'redirects', 'exposed', 'blocklists'];
const LAUNCH_GROUPS = ['redirects', 'exposed', 'headers'];
const SECTION = {
  headers: 'Security headers',
  redirects: 'HTTPS and redirects',
  exposed: 'Exposed files and admin paths',
  blocklists: 'Blocklists',
};
const GLYPH = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️', skip: '⏭️' };
const RANK = { fail: 0, warn: 1, info: 2, skip: 3, pass: 4 };

const cell = (s, max = 300) => {
  if (s == null) return '';
  let t = String(s).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
  if (t.length > max) t = `${t.slice(0, max)}…`;
  return t;
};
const row = (id, status, title, evidence, extra = {}) => ({ id, group: id.split('.')[0], status, title, evidence, fix: '', ...extra });

/** A URL, or null for anything else (code mode takes a path). */
export function siteUrl(input) {
  const s = String(input || '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try { return new URL(s).href; } catch { return null; }
}

/** The audit-launch command line for the groups site mode borrows. */
export function launchArgs({ url, groups = LAUNCH_GROUPS, outDir, stateDir, headers = [], insecure = false, noBaseline = false }) {
  return [
    url, '--only', groups.join(','), '--out', outDir, '--state', stateDir, '--quiet',
    ...(noBaseline ? ['--no-baseline'] : []),
    ...(insecure ? ['--insecure'] : []),
    ...headers.flatMap((h) => ['--header', h]),
  ];
}

/** CSP directives by name (first policy wins, as browsers apply each one separately). */
function cspDirectives(value) {
  const out = {};
  for (const part of String(value || '').split(',')[0].split(';')) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name && !(name.toLowerCase() in out)) out[name.toLowerCase()] = rest;
  }
  return out;
}

// Hosting suffixes where anyone can publish a site for free: a wildcard on one of them lets any
// stranger's deployment frame the page. Public suffixes, not a vendor's own subdomains.
export const PUBLIC_HOSTING_SUFFIXES = [
  'vercel.app', 'now.sh', 'netlify.app', 'netlify.com', 'github.io', 'gitlab.io', 'pages.dev', 'workers.dev',
  'azurewebsites.net', 'azurestaticapps.net', 'cloudapp.net', 'blob.core.windows.net', 'web.core.windows.net',
  'herokuapp.com', 'herokudns.com', 'web.app', 'firebaseapp.com', 'appspot.com', 'run.app', 'cloudfront.net',
  's3.amazonaws.com', 'amplifyapp.com', 'onrender.com', 'fly.dev', 'railway.app', 'surge.sh', 'glitch.me',
  'repl.co', 'replit.app', 'ngrok.io', 'ngrok-free.app', 'ngrok.app', 'trycloudflare.com', 'deno.dev',
  'netlify.live', 'webflow.io', 'framer.app', 'framer.website', 'wixsite.com', 'squarespace.com', 'wordpress.com',
  'blogspot.com', 'codepen.io', 'stackblitz.io', 'csb.app', 'loca.lt',
];

/** The public hosting suffix a frame-ancestors source wildcards, or null: 'https://*.vercel.app' -> 'vercel.app'. */
export function publicWildcard(source) {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\*\.([^/:]+)(?::[0-9*]+)?(?:\/.*)?$/i.exec(String(source || '').trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/\.$/, '');
  return PUBLIC_HOSTING_SUFFIXES.find((sfx) => host === sfx) || null;
}

// Hosts that are not production: a dev, staging, test or preview deployment ("dev-site.example.io",
// "stage.example.com"). Allowed to frame the live site, one of them is a weaker, less watched origin.
const NON_PROD = /^(?:dev|develop|development|stage|staging|stg|test|testing|uat|qa|preview|sandbox|demo|local)$/i;

/** The host of a frame-ancestors source when it is a dev, staging, test or preview host, else null. */
export function nonProductionSource(source) {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/:*]+)(?::[0-9*]+)?(?:\/.*)?$/i.exec(String(source || '').trim());
  if (!m || String(source).startsWith("'")) return null;
  const host = m[1].toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  // The first label, or a part of it: dev.example.com, dev-site.example.io, site-stage.example.io.
  return labels.slice(0, Math.max(1, labels.length - 2)).some((l) => l.split(/[-_]/).some((p) => NON_PROD.test(p))) ? host : null;
}

/**
 * Clickjacking: can another site frame this page? CSP frame-ancestors is the modern control and
 * wins over X-Frame-Options where both are sent; a report-only policy enforces nothing.
 */
export function frameAncestors(headers = {}) {
  const csp = headers['content-security-policy'];
  const fa = csp ? cspDirectives(csp)['frame-ancestors'] : null;
  const xfo = String(headers['x-frame-options'] || '').trim().toUpperCase();
  const valid = xfo === 'DENY' || xfo === 'SAMEORIGIN';
  const title = 'Clickjacking (frame-ancestors)';
  // Keep what the site sends; suggest SAMEORIGIN only when it sends nothing browsers honour.
  const keep = valid ? `keep X-Frame-Options: ${xfo} for old browsers` : 'add X-Frame-Options: SAMEORIGIN for old browsers';
  const fix = `Content-Security-Policy: frame-ancestors 'self' (or 'none'); ${keep}.`;
  if (fa) {
    const v = fa.join(' ');
    if (fa.some((s) => s === '*' || /^https?:$/i.test(s))) return row('headers.frame-ancestors', 'fail', title, `frame-ancestors ${v} lets any site frame the page`, { fix });
    const open = fa.filter(publicWildcard);
    if (open.length) {
      return row('headers.frame-ancestors', 'warn', title, `frame-ancestors ${v}: ${open.join(', ')} ${open.length > 1 ? 'are public hosting suffixes' : 'is a public hosting suffix'}, so anyone's deployment there can frame the page`, {
        fix: `Replace ${open.join(', ')} with the exact hosts that need to frame the page (a preview or editor host), or drop ${open.length > 1 ? 'them' : 'it'}; ${keep}.`,
      });
    }
    const dev = fa.map(nonProductionSource).filter(Boolean);
    if (dev.length) {
      return row('headers.frame-ancestors', 'warn', title, `frame-ancestors ${v}: ${dev.join(', ')} ${dev.length > 1 ? 'are dev, staging or test hosts' : 'is a dev, staging or test host'}, so a less protected deployment can frame the live page`, {
        fix: `Drop ${dev.join(', ')} from the live site's frame-ancestors (send ${dev.length > 1 ? 'them' : 'it'} only from the environments that need them, such as the CMS preview); ${keep}.`,
      });
    }
    return row('headers.frame-ancestors', 'pass', title, `CSP frame-ancestors ${v}${xfo ? ` (X-Frame-Options ${xfo} too)` : ''}`);
  }
  if (valid) return row('headers.frame-ancestors', 'warn', title, `X-Frame-Options ${xfo} only; no CSP frame-ancestors${headers['content-security-policy-report-only'] ? ' (a report-only CSP enforces nothing)' : ''}`, { fix });
  return row('headers.frame-ancestors', 'fail', title, xfo ? `X-Frame-Options ${xfo} is not a value browsers honour, and there is no CSP frame-ancestors` : 'neither CSP frame-ancestors nor X-Frame-Options: any site can frame the page', { fix });
}

/**
 * HSTS without includeSubDomains: an info note on a policy audit-launch passes. Subdomains (www,
 * shop, mail web front ends) can still be reached over http, and the domain cannot be preloaded.
 */
export function hstsSubdomains(headers = {}) {
  const v = String(headers['strict-transport-security'] || '');
  const age = Number(/max-age\s*=\s*"?(\d+)/i.exec(v)?.[1] || 0);
  if (!v || age < 31536000 || /includesubdomains/i.test(v)) return null;
  return row('headers.hsts-subdomains', 'info', 'HSTS includeSubDomains', `Strict-Transport-Security: ${v.trim()}: no includeSubDomains, so subdomains are not covered and the domain cannot be preloaded`, {
    fix: 'Add includeSubDomains once every subdomain answers over https (then preload if wanted): Strict-Transport-Security: max-age=31536000; includeSubDomains.',
  });
}

const OBS_GRADES = [[100, 'A+'], [90, 'A'], [85, 'A-'], [80, 'B+'], [70, 'B'], [65, 'B-'], [60, 'C+'], [50, 'C'], [45, 'C-'], [40, 'D+'], [30, 'D'], [25, 'D-'], [0, 'F']];

/**
 * One missing frame-ancestors is one finding: the Clickjacking row says it, so audit-launch's
 * X-Frame-Options row and the Observatory's x-frame-options test do not count it again. The
 * X-Frame-Options row becomes info; the Observatory row is graded as if that test had passed.
 */
export function countFramingOnce(results) {
  const fa = results.find((r) => r.id === 'headers.frame-ancestors');
  if (!fa || (fa.status !== 'fail' && fa.status !== 'warn')) return results;
  const note = 'counted once, under Clickjacking (frame-ancestors)';
  return results.map((r) => {
    if (r.id === 'headers.xfo' && (r.status === 'fail' || r.status === 'warn')) return { ...r, status: 'info', evidence: `${r.evidence} (${note})`, fix: '' };
    if (r.id === 'headers.observatory' && (r.status === 'fail' || r.status === 'warn')) {
      const failed = r.data?.failed || [];
      const xfo = failed.find((t) => t.name === 'x-frame-options');
      if (!xfo || !Number.isFinite(r.data?.score)) return r;
      const score = Math.min(100, r.data.score - Math.min(0, Number(xfo.modifier) || 0));
      const grade = OBS_GRADES.find(([min]) => score >= min)[1];
      const status = /^A/.test(grade) ? 'pass' : /^B/.test(grade) ? 'warn' : 'fail';
      // Its framing advice is the Clickjacking row's fix; keep the rest.
      const fix = String(r.fix || '').split(/(?<=\.)\s+/).filter((x) => !/frame-ancestors|x-frame-options/i.test(x)).join(' ');
      return { ...r, status, evidence: `${r.evidence} (x-frame-options ${note}; ${grade} without it)`, fix };
    }
    return r;
  });
}

/** Blocklist answers -> rows. `a` holds openphish, safeBrowsing, urlhaus, virusTotal results. */
export function blocklistRows(a = {}, host = '') {
  const out = [];
  const op = a.openphish;
  if (!op) { /* left out */ } else if (!op.ok) out.push(row('blocklists.openphish', 'skip', 'OpenPhish', `not checked: ${op.error || 'no answer'}`));
  else out.push(op.hits?.length
    ? row('blocklists.openphish', 'fail', 'OpenPhish', `${op.hits.length} phishing URL(s) on ${host}: ${op.hits.slice(0, 3).join(', ')}`, { fix: 'Treat the site as compromised: find and remove the phishing pages, rotate credentials, then ask OpenPhish to delist.', blocker: true })
    : row('blocklists.openphish', 'pass', 'OpenPhish', `${host} is not in the community phishing feed`));
  const keyed = [
    ['safeBrowsing', 'blocklists.safe-browsing', 'Google Safe Browsing', (r) => (r.threats?.length ? `listed: ${r.threats.join(', ')}` : null), 'not listed'],
    ['urlhaus', 'blocklists.urlhaus', 'URLhaus (abuse.ch)', (r) => (r.listed ? `${r.urls} malware URL(s) on this host, ${r.online} online${r.tags?.length ? ` (${r.tags.join(', ')})` : ''}` : null), 'not listed'],
    ['virusTotal', 'blocklists.virustotal', 'VirusTotal', (r) => (r.malicious || r.suspicious ? `${r.malicious} engine(s) say malicious, ${r.suspicious} suspicious${r.engines?.length ? `: ${r.engines.join('; ')}` : ''}` : null), null],
  ];
  for (const [key, id, title, listed, clean] of keyed) {
    const r = a[key];
    if (!r) continue;
    if (r.skipped) { out.push(row(id, 'skip', title, `not checked: ${r.skipped}`)); continue; }
    if (!r.ok) { out.push(row(id, 'skip', title, `not checked: ${r.error || 'no answer'}`)); continue; }
    const hit = listed(r);
    out.push(hit
      ? row(id, 'fail', title, hit, { fix: 'Find out why (malware, phishing pages, a compromised plugin), clean it up, then request a review with the list.', blocker: true, link: r.link })
      : row(id, 'pass', title, clean || `0 engines flag it (${r.harmless} harmless)`, { link: r.link }));
  }
  return out;
}

export async function checkBlocklists(url, { fetch: f = globalThis.fetch, env = process.env, sources = { openPhish, safeBrowsing, urlhaus, virusTotal } } = {}) {
  let t;
  try { t = parseTarget(url); } catch (e) { return [row('blocklists.target', 'skip', 'Blocklists', `not checked: ${e.message}`)]; }
  const [openphish, sb, uh, vt] = await Promise.all([
    sources.openPhish(t, { fetch: f }), sources.safeBrowsing(t, { fetch: f, env }), sources.urlhaus(t, { fetch: f, env }), sources.virusTotal(t, { fetch: f, env }),
  ]);
  return blocklistRows({ openphish, safeBrowsing: sb, urlhaus: uh, virusTotal: vt }, t.host);
}

/** Rows that changed since the last site scan: { fixed, new, worse } by id + subject. */
export function diffRows(prev, cur) {
  const key = (r) => `${r.id}|${r.subject || ''}`;
  const bad = (r) => r && (r.status === 'fail' || r.status === 'warn');
  const before = new Map((prev?.results || []).map((r) => [key(r), r]));
  const now = new Map((cur?.results || []).map((r) => [key(r), r]));
  const out = { fixed: [], new: [], worse: [] };
  for (const [k, r] of now) {
    const p = before.get(k);
    if (bad(r) && !bad(p)) out.new.push(r);
    else if (r.status === 'fail' && p?.status === 'warn') out.worse.push(r);
  }
  for (const [k, p] of before) if (bad(p) && now.has(k) && !bad(now.get(k))) out.fixed.push(p);
  return out;
}

export const countStatuses = (results) => {
  const c = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const r of results) if (r.status in c) c[r.status]++;
  return c;
};

/** Runs audit-launch's groups in a child process; { ok, report } or { ok: false, error }. */
export function runLaunch(opts, { spawn = spawnSync, script = LAUNCH_SCRIPT, exists = fs.existsSync } = {}) {
  if (!exists(script)) return { ok: false, error: 'the audit-launch skill is not installed next to audit-security; site mode borrows its header, redirect and exposed-file checks' };
  fs.mkdirSync(opts.outDir, { recursive: true });
  const r = spawn(process.execPath, [script, ...launchArgs(opts)], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600000 });
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(opts.outDir, 'report.json'), 'utf8')); } catch { /* none */ }
  if (!report || report.tool !== 'audit-launch') return { ok: false, error: `audit-launch failed (exit ${r.status ?? r.signal ?? '?'}); run it on its own to see why` };
  return { ok: true, report };
}

/** AUDIT_HEADERS ("Name: value" per line), the WAF bypass headers audit-launch also reads. */
export function envHeaders(env = process.env) {
  const out = {};
  for (const line of String(env.AUDIT_HEADERS || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(i + 1).trim()) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Response headers of the final URL, lower-cased; {} when the site does not answer. */
export async function pageHeaders(url, { fetch: f = globalThis.fetch, headers = {} } = {}) {
  try {
    const res = await f(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; audit-security site mode)', ...headers }, signal: AbortSignal.timeout(20000) });
    const out = {};
    res.headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return out;
  } catch { return {}; }
}

/**
 * The whole site scan: { tool, mode: 'site', version, input, site, counts, results, launch }.
 * `deps` lets tests replace the child process and the network.
 */
export async function runSite(args, { version, outDir, stateDir, log = () => {}, deps = {} } = {}) {
  const url = siteUrl(args.root);
  const on = (g) => (args.only ? args.only.includes(g) : true) && !args.skip.includes(g);
  const groups = LAUNCH_GROUPS.filter(on);
  const headerLines = Object.entries(args.headers || {}).map(([k, v]) => `${k}: ${v}`);
  const results = [];
  let launch = null;
  let finalUrl = url;
  if (groups.length) {
    log(`audit-launch --only ${groups.join(',')} ${url}`);
    const l = (deps.runLaunch || runLaunch)({ url, groups, outDir: path.join(outDir, 'audit-launch'), stateDir: path.join(stateDir, 'audit-launch'), headers: headerLines, insecure: args.insecure, noBaseline: true });
    if (!l.ok) results.push(row('headers.launch', 'skip', 'Header, redirect and exposed-file checks', `not run: ${l.error}`));
    else {
      launch = l.report;
      finalUrl = launch.site?.finalUrl || url;
      for (const r of launch.results || []) if (groups.includes(r.group || r.id.split('.')[0])) results.push({ ...r, group: r.group || r.id.split('.')[0] });
    }
    // audit-launch reads AUDIT_HEADERS itself; this one request needs them too, or a WAF answers with its challenge page's headers.
    if (on('headers')) {
      const h = await (deps.pageHeaders || pageHeaders)(finalUrl, { headers: { ...envHeaders(deps.env || process.env), ...(args.headers || {}) } });
      results.push(frameAncestors(h));
      const sub = hstsSubdomains(h);
      if (sub) results.push(sub);
      results.splice(0, results.length, ...countFramingOnce(results));
    }
  }
  if (on('blocklists')) {
    if (args.offline) results.push(row('blocklists.offline', 'skip', 'Blocklists', 'not checked: --offline'));
    else { log('blocklists'); results.push(...await (deps.checkBlocklists || checkBlocklists)(finalUrl)); }
  }
  const host = (() => { try { return new URL(finalUrl).host; } catch { return url; } })();
  return {
    tool: 'audit-security', mode: 'site', version, generatedAt: new Date().toISOString(),
    input: { url, env: launch?.input?.env || null, production: launch?.input?.production ?? null, groups: SITE_GROUPS.filter(on) },
    site: { finalUrl, host },
    launch: launch ? { version: launch.version, report: path.join('audit-launch', 'report.json') } : null,
    counts: countStatuses(results),
    results,
  };
}

const fmtDate = (iso) => { try { return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`; } catch { return String(iso); } };

/** report -> report.md. `levels` (from --level) filters the rows; the counts stay whole. */
export function renderSiteMarkdown(report, { levels } = {}) {
  const { input = {}, site = {}, counts = {} } = report;
  const results = (report.results || []).filter((r) => shows(levels, r));
  const L = [];
  L.push(`# Security audit (site) — ${site.host || input.url}`, '');
  L.push(`**Site:** ${input.url}${site.finalUrl && site.finalUrl !== input.url ? ` → ${site.finalUrl}` : ''}${input.env ? `  ·  **Environment:** ${input.env}` : ''}  ·  **Date:** ${fmtDate(report.generatedAt)}  ·  **Tool:** audit-security ${report.version} (site mode${report.launch ? `; header, redirect and exposed-file checks from audit-launch ${report.launch.version}` : ''})`, '');
  L.push(`**Result:** ${counts.pass || 0} pass · ${counts.warn || 0} warn · ${counts.fail || 0} fail · ${counts.info || 0} info · ${counts.skip || 0} skipped`, '');
  const note = levelNote(levels, { hidden: (report.results || []).length - results.length });
  if (note) L.push(note, '');

  const act = results.filter((r) => r.status === 'fail' || r.status === 'warn').sort((a, b) => RANK[a.status] - RANK[b.status]);
  if (act.length) {
    L.push('## Fix first', '');
    for (const r of act) L.push(`- ${GLYPH[r.status]} **${r.title}**${r.subject ? ` (${r.subject})` : ''} — ${r.evidence}${r.fix ? ` → ${r.fix}` : ''}`);
    L.push('');
  }
  const d = report.diff;
  if (d && (d.fixed.length || d.new.length || d.worse.length)) {
    L.push('## Since last run', '');
    for (const r of d.new) L.push(`- New: ${GLYPH[r.status]} **${r.title}** — ${r.evidence}`);
    for (const r of d.worse) L.push(`- Worse: ❌ **${r.title}** — ${r.evidence}`);
    for (const r of d.fixed) L.push(`- Fixed: ✅ **${r.title}** (was ${r.status})`);
    L.push('');
  }
  for (const g of SITE_GROUPS) {
    const rows = results.filter((r) => r.group === g);
    if (!rows.length) continue;
    L.push(`## ${SECTION[g]}`, '', '| | Check | Evidence | Fix |', '|---|---|---|---|');
    for (const r of rows) L.push(`| ${GLYPH[r.status] || ''} | ${cell(r.title)}${r.subject ? ` (page: ${cell(r.subject)})` : ''} | ${cell(r.evidence)}${r.link ? ` [↗](${r.link})` : ''} | ${cell(r.fix)} |`);
    L.push('');
  }
  L.push('## Not covered', '');
  L.push('Passive checks only: one request per well-known path, no fuzzing, login attempts, load or exploitation. The code, its git history and its dependencies are code mode (`scan.mjs <repo>`); TLS, DNS and mail are audit-infra; cookies and trackers set before consent are audit-privacy.', '');
  return L.join('\n');
}

/** One line per issue for --console. */
export const consoleItems = (report) => (report.results || []).map((r) => ({ level: levelOf(r), source: r.group, id: r.id.startsWith(`${r.group}.`) ? r.id.slice(r.group.length + 1) : r.id, title: r.title, where: [r.subject, r.evidence].filter(Boolean).join(' — ').slice(0, 160) }));
