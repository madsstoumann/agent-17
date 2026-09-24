/**
 * Lighthouse for the launch audit: find a Chrome, run Lighthouse 13 locally
 * through npx (or the PageSpeed Insights API where it cannot run), and boil an
 * LHR down to the numbers the report prints. Understands both the Lighthouse 13
 * insight audits and the older opportunity audits the PSI API may still return.
 *
 * Zero dependencies. Node >= 22. No top-level side effects, nothing writes to the
 * console: pass `log` where a function accepts one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import { runCommand } from './proc.mjs';
import { hostOf, sameUrlModuloSlash } from './http.mjs';

export const LIGHTHOUSE_SPEC = 'lighthouse@^13.4.1';
export const MIN_NODE = '22.19.0'; // Lighthouse 13's engines.node
/** SEO audits a dev site fails purely because it is noindex. */
export const SEO_NOINDEX_AUDITS = ['is-crawlable', 'robots-txt'];

const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
const CATEGORY_KEYS = { performance: 'performance', accessibility: 'accessibility', 'best-practices': 'bestPractices', seo: 'seo' };
const METRIC_AUDITS = {
  LCP: 'largest-contentful-paint', CLS: 'cumulative-layout-shift', TBT: 'total-blocking-time', FCP: 'first-contentful-paint',
  SI: 'speed-index', TTFB: 'server-response-time', INP: 'interaction-to-next-paint',
};
const FIELD_METRICS = {
  LCP: 'LARGEST_CONTENTFUL_PAINT_MS', INP: 'INTERACTION_TO_NEXT_PAINT', CLS: 'CUMULATIVE_LAYOUT_SHIFT_SCORE',
  FCP: 'FIRST_CONTENTFUL_PAINT_MS', TTFB: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE',
};
// [good, poor]: <= good passes, <= poor warns, above fails (web.dev thresholds; TBT/SI are Lighthouse's)
const CWV_THRESHOLDS = { LCP: [2500, 4000], CLS: [0.1, 0.25], TBT: [200, 600], FCP: [1800, 3000], SI: [3400, 5800], INP: [200, 500], TTFB: [800, 1800] };
const COUNTED_MODES = new Set(['binary', 'numeric']);
const PASS_SCORE = 0.9; // Lighthouse's own "passed" line for a scored audit
const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_MAX_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------- small pure helpers

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const score100 = (s) => (num(s) === null ? null : Math.round(s * 100));
const text = (v) => (typeof v === 'string' && v ? v : null);
const tail = (s, lines) => String(s || '').trimEnd().split('\n').slice(-lines).join('\n').trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Compare dotted versions numerically ("v" prefix and a pre-release tail ignored) -> -1 | 0 | 1. */
export function compareVersions(a, b) {
  const parse = (v) => String(v).trim().replace(/^v/i, '').split('.').map((p) => parseInt(p, 10) || 0);
  const pa = parse(a); const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** 'pass' | 'warn' | 'fail' for a lab or field value of LCP, CLS, TBT, FCP, SI, INP or TTFB; null when unknown. */
export function cwvRating(metric, value) {
  const t = CWV_THRESHOLDS[String(metric || '').toUpperCase()];
  const v = num(value);
  if (!t || v === null) return null;
  return v <= t[0] ? 'pass' : v <= t[1] ? 'warn' : 'fail';
}

/** 'pass' (>= 90) | 'warn' (>= 50) | 'fail' for a 0-100 category score; null for null. */
export function scoreVerdict(score) {
  const s = num(score);
  if (s === null) return null;
  return s >= 90 ? 'pass' : s >= 50 ? 'warn' : 'fail';
}

// ---------------------------------------------------------------- local Lighthouse

/**
 * Absolute path of a Chrome binary, or null: env.CHROME_PATH when it exists, else the
 * macOS Chrome / Chrome Canary / Chromium apps (system or ~/Applications), else a
 * google-chrome / google-chrome-stable / chromium / chromium-browser on PATH.
 */
export function findChrome({ env = process.env } = {}) {
  if (env.CHROME_PATH && existsSync(env.CHROME_PATH)) return env.CHROME_PATH;
  const home = env.HOME || '';
  for (const app of MAC_APPS) {
    for (const p of home ? [app, home + app] : [app]) if (existsSync(p)) return p;
  }
  for (const name of PATH_NAMES) {
    try {
      const found = execFileSync('which', [name], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (found) return found;
    } catch { /* not on PATH */ }
  }
  return null;
}

/**
 * Can Lighthouse 13 run here? -> { ok, nodeOk, chrome: string|null, reason: string|null }
 * `chromePath` is trusted as given; pass null for "none", omit to auto-detect (`env` feeds findChrome).
 * `reason` names what is missing and points at PSI_API_KEY; null when ok.
 */
export function checkLocalLighthouse({ nodeVersion = process.versions.node, chromePath, env = process.env } = {}) {
  const nodeOk = compareVersions(nodeVersion, MIN_NODE) >= 0;
  const chrome = chromePath === undefined ? findChrome({ env }) : (chromePath || null);
  const missing = [];
  if (!nodeOk) missing.push(`Node ${nodeVersion} is below ${MIN_NODE}, the minimum for Lighthouse 13`);
  if (!chrome) missing.push('no Chrome found (install Google Chrome or set CHROME_PATH)');
  const ok = nodeOk && Boolean(chrome);
  return { ok, nodeOk, chrome, reason: ok ? null : `${missing.join('; ')} - set PSI_API_KEY to use the PageSpeed Insights API instead` };
}

/**
 * The argv after `npx -y lighthouse@^13.4.1`: string[]. All five categories run (never
 * --only-categories); `desktop` adds --preset=desktop, `insecure` ignores certificate errors.
 * Throws TypeError without url or file.
 */
export function buildLighthouseArgs({ url, file, desktop = false, insecure = false } = {}) {
  if (!url || !file) throw new TypeError('buildLighthouseArgs: url and file are required');
  return [
    url,
    '--output=json',
    `--output-path=${file}`,
    `--chrome-flags=--headless=new${insecure ? ' --ignore-certificate-errors' : ''}`,
    '--quiet',
    '--disable-full-page-screenshot',
    '--max-wait-for-load=45000',
    '--extra-headers={"X-Audit":"launch-audit/1.0"}',
    ...(desktop ? ['--preset=desktop'] : []),
  ];
}

/**
 * Run Lighthouse through npx and read the JSON report it wrote to `file`.
 * -> { ok, file, lhr: object|null, ms, version: string|null, error?: string, stderrTail: string }
 * Never throws. ok is false on a non-zero exit, a timeout, a missing or unparsable report, or a
 * runtimeError inside it; `error` then ends with the last ~15 stderr lines. The report, when
 * it parsed, is returned even when ok is false. `file` is the caller's to delete.
 */
export async function runLighthouseLocal({ url, file, desktop = false, insecure = false, timeout = 240000, chromePath, log = () => {} } = {}) {
  const result = { ok: false, file: file ?? null, lhr: null, ms: 0, version: null, stderrTail: '' };
  if (!url || !file) return { ...result, error: 'url and file are required' };
  const args = buildLighthouseArgs({ url, file, desktop, insecure });
  log(`lighthouse ${desktop ? 'desktop' : 'mobile'} ${url} via npx ${LIGHTHOUSE_SPEC}`);
  const run = await runCommand('npx', ['-y', LIGHTHOUSE_SPEC, ...args], { timeout, env: chromePath ? { CHROME_PATH: chromePath } : undefined });
  result.ms = run.ms;
  result.stderrTail = tail(run.stderr, 15);
  let readError = null;
  try {
    const lhr = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (lhr && typeof lhr === 'object') { result.lhr = lhr; result.version = lhr.lighthouseVersion ?? null; }
  } catch (e) { readError = e.message; }
  const problems = [];
  if (run.timedOut) problems.push(`timed out after ${timeout} ms`);
  else if (run.error) problems.push(run.error);
  else if (run.code !== 0) problems.push(`lighthouse exited with code ${run.code}`);
  if (!result.lhr) problems.push(`no report at ${file}${readError ? ` (${readError})` : ''}`);
  const rte = result.lhr?.runtimeError;
  if (rte?.message) problems.push(`runtime error ${rte.code ? `${rte.code}: ` : ''}${rte.message}`);
  if (problems.length) {
    result.error = [problems.join('; '), result.stderrTail].filter(Boolean).join('\n');
    log(`lighthouse failed after ${run.ms} ms: ${problems.join('; ')}`);
    return result;
  }
  result.ok = true;
  log(`lighthouse ${result.version} done in ${run.ms} ms`);
  return result;
}

// ---------------------------------------------------------------- PageSpeed Insights

/**
 * GET the PSI v5 API (performance, accessibility, best-practices and seo; PSI has no
 * agentic-browsing) -> { ok, status, lhr, loadingExperience, originLoadingExperience, error? }
 * Never throws. Without `key` it returns { ok: false, error: 'PSI_API_KEY required' } and
 * makes no request (the keyless quota is 0). `http` is a createHttp() instance.
 */
export async function runPsi(http, { url, strategy = 'mobile', key, timeout = 120000 } = {}) {
  const base = { ok: false, status: 0, lhr: null, loadingExperience: null, originLoadingExperience: null };
  if (!key) return { ...base, error: 'PSI_API_KEY required' };
  if (!url) return { ...base, error: 'url required' };
  const categories = ['performance', 'accessibility', 'best-practices', 'seo'].map((c) => `category=${c}`).join('&');
  const endpoint = `${PSI_ENDPOINT}?url=${encodeURIComponent(url)}&strategy=${encodeURIComponent(strategy)}&${categories}&key=${encodeURIComponent(key)}`;
  const res = await http.get(endpoint, { timeout, maxBytes: PSI_MAX_BYTES });
  if (res.status === 0) return { ...base, error: `PSI request failed: ${res.error || 'network error'}` };
  if (res.truncated) return { ...base, status: res.status, error: 'PSI response exceeded 20 MB' };
  let body;
  try { body = JSON.parse(res.body); } catch { return { ...base, status: res.status, error: `PSI answered HTTP ${res.status} with a non-JSON body` }; }
  if (!res.ok) {
    const message = body?.error?.message || `HTTP ${res.status}`;
    return { ...base, status: res.status, error: res.status === 429 ? `PSI quota exceeded (HTTP 429): ${message}` : `PSI error (HTTP ${res.status}): ${message}` };
  }
  const lhr = body?.lighthouseResult;
  if (!lhr || typeof lhr !== 'object') return { ...base, status: res.status, error: 'PSI response has no lighthouseResult' };
  return { ok: true, status: res.status, lhr, loadingExperience: body.loadingExperience ?? null, originLoadingExperience: body.originLoadingExperience ?? null };
}

// ---------------------------------------------------------------- summarising an LHR

/** A category's auditRefs joined to their audits; a ref whose audit is missing (trimmed, older LH) is skipped. */
function auditsOf(lhr, category) {
  const refs = lhr.categories?.[category]?.auditRefs;
  if (!Array.isArray(refs)) return [];
  return refs.map((ref) => ({ id: ref.id, ref, audit: lhr.audits?.[ref.id] })).filter(({ audit }) => audit && typeof audit === 'object');
}

const isFailing = (audit) => num(audit.score) !== null && audit.score < 1;
const itemCount = (audit) => (Array.isArray(audit.details?.items) ? audit.details.items.length : null);
const entityName = (e) => (typeof e === 'string' ? text(e) : text(e?.text));

/**
 * Milliseconds an opportunity could save, or null when the audit is not one.
 * LH 13: the largest of `metricSavings` (CLS is unitless and ignored; a CLS-only saving is 0 ms).
 * Older: details.type === 'opportunity' with details.overallSavingsMs.
 */
function savingsOf(audit) {
  const ms = audit.metricSavings;
  if (ms && typeof ms === 'object') {
    const values = Object.entries(ms).filter(([k, v]) => k !== 'CLS' && num(v) !== null).map(([, v]) => v);
    if (values.length) return Math.max(...values);
    if (Object.keys(ms).length) return 0;
  }
  const d = audit.details;
  return d?.type === 'opportunity' && num(d.overallSavingsMs) !== null ? d.overallSavingsMs : null;
}

/** agentic-browsing is a 'fraction' category: passed/total over its binary and numeric audits. */
function agenticOf(lhr) {
  if (!lhr.categories?.['agentic-browsing']) return null;
  const audits = {}; let passed = 0; let total = 0;
  for (const { id, ref, audit } of auditsOf(lhr, 'agentic-browsing')) {
    const score = num(audit.score); const mode = audit.scoreDisplayMode ?? null;
    audits[id] = { score, mode, displayValue: text(audit.displayValue), title: audit.title ?? id };
    if (ref.group === 'hidden' || !COUNTED_MODES.has(mode)) continue;
    total++;
    if (score !== null && score >= PASS_SCORE) passed++;
  }
  return { passed, total, audits };
}

/** PSI loadingExperience -> field data. CLS arrives x100 and is returned as the real score. */
function fieldOf(le) {
  const m = le?.metrics;
  if (!m || typeof m !== 'object' || !Object.keys(m).length) return null;
  const field = {};
  for (const [k, key] of Object.entries(FIELD_METRICS)) {
    const p75 = num(m[key]?.percentile);
    field[k] = { p75: k === 'CLS' && p75 !== null ? p75 / 100 : p75, category: m[key]?.category ?? null };
  }
  field.overall = le.overall_category ?? null;
  return field;
}

function requestsOf(lhr) {
  const items = lhr.audits?.['network-requests']?.details?.items;
  const requests = []; const protocols = { h1: 0, h2: 0, h3: 0, other: 0 };
  for (const it of Array.isArray(items) ? items : []) {
    const url = text(it?.url);
    if (!url || /^(data|blob|about):/i.test(url)) continue; // not network requests
    const protocol = text(it.protocol);
    requests.push({ url, host: hostOf(url), protocol, resourceType: it.resourceType ?? null, statusCode: num(it.statusCode), entity: entityName(it.entity) });
    const p = (protocol || '').toLowerCase();
    if (p === 'h2') protocols.h2++; else if (p === 'h3') protocols.h3++; else if (p.startsWith('http/1')) protocols.h1++; else protocols.other++;
  }
  return { requests, protocols };
}

/**
 * Boil an LHR (local, or PSI's `lighthouseResult`) down to what the report prints.
 * Pure; throws TypeError only when `lhr` is not an object. Missing audits and categories yield
 * nulls and empty lists, never a throw.
 * -> {
 *   source, strategy, version: string|null, finalUrl: string|null, fetchTime: string|null,
 *   scores: { performance, accessibility, bestPractices, seo }        (0-100 integers or null),
 *   agentic: { passed, total, audits: { [id]: { score, mode, displayValue, title } } } | null
 *            (Lighthouse 13's fraction-scored category; present it as passed/total, never 0-100),
 *   metrics: { LCP, CLS, TBT, FCP, SI, TTFB, INP: { value: number|null, display: string|null } },
 *   field: { LCP, INP, CLS, FCP, TTFB: { p75: number|null, category: string|null }, overall: string|null } | null,
 *   opportunities: [{ id, title, displayValue, savingsMs, score }]    (score < 1, top 8 by savingsMs, ties by id),
 *   thirdParties: [{ entity, transferBytes, blockingMs: number|null, mainThreadMs: number|null }],
 *   requests: [{ url, host, protocol, resourceType, statusCode, entity }]   (data:/blob: URLs left out),
 *   protocols: { h1, h2, h3, other }                                   (request counts),
 *   failingAudits: { accessibility, seo, bestPractices: [{ id, title, count: number|null }] }
 *                  (score !== null && score < 1; count = details.items.length when present),
 *   seoNoindexAffected: boolean                                        (any SEO_NOINDEX_AUDITS failing),
 *   runWarnings: string[]                                              (a runtimeError is prepended as one)
 * }
 */
export function summariseLhr(lhr, { source = 'local', strategy = 'mobile', loadingExperience = null } = {}) {
  if (!lhr || typeof lhr !== 'object') throw new TypeError('summariseLhr: lhr must be an object');
  const audits = lhr.audits || {};

  const scores = {};
  for (const [cat, key] of Object.entries(CATEGORY_KEYS)) scores[key] = score100(lhr.categories?.[cat]?.score);

  const metrics = {};
  for (const [k, id] of Object.entries(METRIC_AUDITS)) metrics[k] = { value: num(audits[id]?.numericValue), display: text(audits[id]?.displayValue) };

  const opportunities = auditsOf(lhr, 'performance')
    .map(({ id, audit }) => ({ id, title: audit.title ?? id, displayValue: text(audit.displayValue), savingsMs: savingsOf(audit), score: num(audit.score) }))
    .filter((o) => o.savingsMs !== null && o.score !== null && o.score < 1)
    .sort((a, b) => b.savingsMs - a.savingsMs || cmp(a.id, b.id))
    .slice(0, 8);

  const tp = audits['third-parties-insight'] ?? audits['third-party-summary'];
  const thirdParties = (Array.isArray(tp?.details?.items) ? tp.details.items : [])
    .map((it) => ({ entity: entityName(it.entity), transferBytes: num(it.transferSize) ?? 0, blockingMs: num(it.blockingTime), mainThreadMs: num(it.mainThreadTime) }))
    .filter((t) => t.entity);

  const failingAudits = {};
  for (const [cat, key] of Object.entries(CATEGORY_KEYS)) {
    if (cat === 'performance') continue;
    failingAudits[key] = auditsOf(lhr, cat).filter(({ audit }) => isFailing(audit)).map(({ id, audit }) => ({ id, title: audit.title ?? id, count: itemCount(audit) }));
  }

  const runWarnings = (Array.isArray(lhr.runWarnings) ? lhr.runWarnings : []).map((w) => (typeof w === 'string' ? w : JSON.stringify(w)));
  const rte = lhr.runtimeError;
  if (rte?.message) runWarnings.unshift(`Runtime error${rte.code ? ` ${rte.code}` : ''}: ${rte.message}`);

  return {
    source, strategy,
    version: lhr.lighthouseVersion ?? null,
    finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl || lhr.requestedUrl || null,
    fetchTime: lhr.fetchTime ?? null,
    scores,
    agentic: agenticOf(lhr),
    metrics,
    field: fieldOf(loadingExperience),
    opportunities,
    thirdParties,
    ...requestsOf(lhr),
    failingAudits,
    seoNoindexAffected: SEO_NOINDEX_AUDITS.some((id) => audits[id] && isFailing(audits[id])),
    runWarnings,
  };
}

// ---------------------------------------------------------------- choosing pages to audit

/**
 * A deterministic sample of at most `n` URLs (default 5) chosen for template diversity -> string[].
 * Drops the start URL (trailing slash ignored), URLs with a query string, unparsable strings and
 * duplicates; buckets by (first path segment, path depth); orders buckets by size desc then key;
 * round-robins the buckets; inside a bucket the shortest URL comes first, then alphabetical.
 * Throws TypeError when `urls` is not an array.
 */
export function pickPerfPages(urls, { startUrl, n = 5 } = {}) {
  if (!Array.isArray(urls)) throw new TypeError('pickPerfPages: urls must be an array');
  const seen = new Set(); const buckets = new Map();
  for (const raw of urls) {
    let u;
    try { u = new URL(String(raw)); } catch { continue; }
    if (u.search) continue;
    u.hash = '';
    const href = u.href;
    if (seen.has(href) || (startUrl && sameUrlModuloSlash(href, startUrl))) continue;
    seen.add(href);
    const segments = u.pathname.split('/').filter(Boolean);
    const key = `${segments[0] || ''}/${segments.length}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(href);
  }
  const ordered = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || cmp(a[0], b[0]))
    .map(([, list]) => list.sort((a, b) => a.length - b.length || cmp(a, b)));
  const picked = [];
  for (let lap = 0; picked.length < n && ordered.some((list) => lap < list.length); lap++) {
    for (const list of ordered) {
      if (picked.length >= n) break;
      if (lap < list.length) picked.push(list[lap]);
    }
  }
  return picked;
}
