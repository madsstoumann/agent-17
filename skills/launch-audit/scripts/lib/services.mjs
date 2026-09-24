/**
 * Third-party validators and scanners: the Nu HTML checker, the schema.org validator,
 * Mozilla Observatory, hstspreload.org, SSL Labs and securityheaders.com.
 *
 * Zero dependencies. Node >= 22. Async functions never throw: a failure is
 * { ok: false, error }. Every function takes the `http` from createHttp(); a POST that
 * carries a body goes through `http.post` when the object has one (a test fake), else
 * through postBody() below, because http.mjs's request() sends no body.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UA, AUDIT_HEADER, describeError } from './http.mjs';
import { runCommand } from './proc.mjs';

const MB = 1024 * 1024;
const W3C_MAX_HTML = 2 * MB;
const OBSERVATORY = 'https://observatory-api.mdn.mozilla.net/api/v2';
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(text) {
  try { return { json: JSON.parse(text) }; } catch (e) { return { error: e.message }; }
}

/** What went wrong with an http.mjs response, or null when it is a 2xx. */
function httpProblem(res) {
  if (res.status === 0) return res.error || 'network failure';
  if (!res.ok) return `HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`;
  return null;
}

/** Tags out, block ends as spaces, a few entities decoded, whitespace collapsed. */
function stripHtml(s) {
  return String(s || '')
    .replace(/<\/(?:p|div|li|br|tr|h\d)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * postBody(url, { method = 'POST', headers, body, timeout = 60000, maxBytes = 8 MiB }, { fetch = globalThis.fetch, limit })
 *   -> the http.mjs response shape: { url, finalUrl, status, ok, headers, setCookie, body, bytes, truncated, contentType, ms, redirected, error? }
 *
 * The audit's User-Agent and X-Audit headers are set as createHttp() sets them. Never throws.
 */
export async function postBody(url, { method = 'POST', headers = {}, body, timeout = 60000, maxBytes = 8 * MB } = {}, { fetch: fetchImpl = globalThis.fetch, limit } = {}) {
  const started = Date.now();
  const run = async () => {
    const res = await fetchImpl(url, { method, body, redirect: 'follow', headers: { 'user-agent': UA, 'x-audit': AUDIT_HEADER, ...headers }, signal: AbortSignal.timeout(timeout) });
    const hobj = {};
    res.headers?.forEach?.((value, key) => { const k = key.toLowerCase(); if (k !== 'set-cookie') hobj[k] = hobj[k] ? `${hobj[k]}, ${value}` : value; });
    const setCookie = typeof res.headers?.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    let buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.length > maxBytes;
    if (truncated) buf = buf.subarray(0, maxBytes);
    return { url, finalUrl: res.url || url, status: res.status, ok: res.ok, headers: hobj, setCookie, body: buf.toString('utf8'), bytes: buf.length, truncated, contentType: hobj['content-type'] || '', ms: Date.now() - started, redirected: Boolean(res.redirected) };
  };
  try {
    return await (typeof limit === 'function' ? limit(run) : run());
  } catch (e) {
    return { url, finalUrl: url, status: 0, ok: false, headers: {}, setCookie: [], body: null, bytes: 0, truncated: false, contentType: '', ms: Date.now() - started, redirected: false, error: describeError(e) };
  }
}

/** A request with a body: http.post when the http object offers one, else fetch through postBody. */
function send(http, url, opts) {
  if (typeof http.post === 'function') return http.post(url, { ...opts, method: 'POST' });
  return postBody(url, opts, { limit: http.limit });
}

// ---------------------------------------------------------------- W3C Nu HTML checker

/** stripJsonGuard(text) -> text without a leading )]}' line (with or without its newline). */
export function stripJsonGuard(text) {
  return String(text ?? '').replace(/^\)\]\}'\r?\n?/, '');
}

/**
 * groupW3cMessages(messages) -> { errors, warnings, info, fatal, distinct,
 *   groups: [{ type, subType, message, count, sample: { lastLine, firstColumn, extract } }] }
 *
 * type 'error' counts as an error (subType 'fatal' also as fatal); type 'info' with subType
 * 'warning' as a warning; other info as info. Grouped by trimmed message, most frequent first.
 */
export function groupW3cMessages(messages) {
  const counts = { errors: 0, warnings: 0, info: 0, fatal: 0 };
  const groups = new Map();
  for (const m of Array.isArray(messages) ? messages : []) {
    const type = m?.type || 'info';
    const subType = m?.subType || null;
    if (type === 'error' || type === 'non-document-error') { counts.errors++; if (subType === 'fatal') counts.fatal++; }
    else if (subType === 'warning') counts.warnings++;
    else counts.info++;
    const message = String(m?.message ?? '').trim();
    let g = groups.get(message);
    if (!g) {
      g = { type, subType, message, count: 0, sample: { lastLine: m?.lastLine ?? null, firstColumn: m?.firstColumn ?? m?.lastColumn ?? null, extract: m?.extract ?? null } };
      groups.set(message, g);
    }
    g.count++;
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count);
  return { ...counts, distinct: list.length, groups: list };
}

/**
 * w3cValidate(http, { url, html, timeout = 60000 })
 *   -> { ok, status, mode: 'url'|'html', messages: [], summary: groupW3cMessages(messages), error? }
 *
 * url mode GETs validator.w3.org/nu/?doc=…&out=json; html mode POSTs the markup (at most 2 MB)
 * as text/html. 429, 5xx and a non-JSON answer are ok: false.
 */
export async function w3cValidate(http, { url, html, timeout = 60000 } = {}) {
  const mode = html != null ? 'html' : 'url';
  const failed = (status, error) => ({ ok: false, status, mode, messages: [], summary: groupW3cMessages([]), error });
  if (mode === 'url' && !url) return failed(0, 'url or html required');
  // validator.w3.org sits behind a bot filter that 403s a browser User-Agent arriving without
  // a browser's client hints; an honest tool UA is let through.
  const headers = { 'user-agent': AUDIT_HEADER };
  let res;
  if (mode === 'html') {
    const markup = String(html);
    const bytes = Buffer.byteLength(markup, 'utf8');
    if (bytes > W3C_MAX_HTML) return failed(0, `html is ${bytes} bytes; the checker takes at most 2 MB, validate by url instead`);
    res = await send(http, 'https://validator.w3.org/nu/?out=json', { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' }, body: markup, timeout, maxBytes: 8 * MB });
  } else {
    res = await http.get(`https://validator.w3.org/nu/?doc=${encodeURIComponent(url)}&out=json`, { headers, timeout, maxBytes: 8 * MB });
  }
  const problem = httpProblem(res);
  if (problem) return failed(res.status, problem);
  const { json, error } = parseJson(res.body);
  if (error || !Array.isArray(json?.messages)) return failed(res.status, `not a JSON answer from the checker${error ? ` (${error})` : ''}`);
  return { ok: true, status: res.status, mode, messages: json.messages, summary: groupW3cMessages(json.messages) };
}

// ---------------------------------------------------------------- schema.org validator

/** One validator node -> { types, errors, warnings }; property errors carry their property, nested ones a dotted path. */
function summariseSchemaNode(node, prefix = '') {
  const types = (node.types || []).map((t) => t?.value).filter(Boolean);
  const errors = []; const warnings = [];
  const add = (e, property) => {
    const item = { type: e?.errorType || 'ERROR', args: Array.isArray(e?.args) ? e.args : [], property, severe: e?.isSevere !== false };
    (item.severe ? errors : warnings).push(item);
  };
  for (const e of node.errors || []) add(e, prefix || null);
  for (const p of node.properties || []) for (const e of p.errors || []) add(e, `${prefix}${p.pred ?? ''}`);
  for (const p of node.nodeProperties || []) {
    const name = `${prefix}${p.pred ?? ''}`;
    for (const e of p.errors || []) add(e, name);
    if (p.target) {
      const inner = summariseSchemaNode(p.target, `${name}.`);
      errors.push(...inner.errors); warnings.push(...inner.warnings);
    }
  }
  return { types, errors, warnings };
}

/**
 * schemaValidate(http, { url, html, timeout = 60000 })
 *   -> { ok, status, mode, objects, errors, warnings, types: string[],
 *        nodes: [{ types: string[], errors: [{ type, args, property, severe }], warnings: [same] }],
 *        raw (the parsed JSON minus its `html`), error? }
 *
 * POSTs validator.schema.org/validate as a form (url= or html=). The answer starts with )]}'.
 */
export async function schemaValidate(http, { url, html, timeout = 60000 } = {}) {
  const mode = html != null ? 'html' : 'url';
  const failed = (status, error) => ({ ok: false, status, mode, objects: 0, errors: 0, warnings: 0, types: [], nodes: [], raw: null, error });
  if (mode === 'url' && !url) return failed(0, 'url or html required');
  const body = mode === 'html' ? `html=${encodeURIComponent(String(html))}` : `url=${encodeURIComponent(url)}`;
  const res = await send(http, 'https://validator.schema.org/validate', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, timeout, maxBytes: 16 * MB });
  const problem = httpProblem(res);
  if (problem) return failed(res.status, problem);
  const { json, error } = parseJson(stripJsonGuard(res.body));
  if (error || !json || typeof json !== 'object') return failed(res.status, `not a JSON answer from the validator${error ? ` (${error})` : ''}`);
  const { html: _rendered, ...raw } = json;
  const nodes = []; const types = [];
  for (const group of raw.tripleGroups || []) {
    for (const n of group.nodes || []) {
      const node = summariseSchemaNode(n);
      nodes.push(node);
      for (const t of node.types) if (!types.includes(t)) types.push(t);
    }
  }
  return { ok: true, status: res.status, mode, objects: raw.numObjects ?? nodes.length, errors: raw.totalNumErrors ?? 0, warnings: raw.totalNumWarnings ?? 0, types, nodes, raw };
}

// ---------------------------------------------------------------- Mozilla Observatory

/**
 * summariseObservatory(scan, analyze) -> { ok, grade, score, testsPassed, testsFailed, testsQuantity, detailsUrl, scannedAt,
 *   failed: [{ name, result, modifier, expectation, recommendation }] (costliest first), raw: { scan, analyze }, error? }
 *
 * `scan` is the POST /scan body, `analyze` the GET /analyze body; either may be null.
 * A test counts as failed only when its `pass` is false (null is "not applicable").
 */
export function summariseObservatory(scan, analyze) {
  const usable = (x) => (x && typeof x === 'object' && x.grade != null ? x : null);
  const meta = usable(scan) || usable(analyze?.scan);
  const tests = analyze?.tests && typeof analyze.tests === 'object' ? Object.values(analyze.tests) : [];
  const failed = tests
    .filter((t) => t && t.pass === false)
    .map((t) => ({ name: t.name, result: t.result ?? null, modifier: t.score_modifier ?? 0, expectation: t.expectation ?? null, recommendation: stripHtml(t.recommendation || t.score_description) }))
    .sort((a, b) => a.modifier - b.modifier);
  const out = {
    ok: Boolean(meta),
    grade: meta?.grade ?? null, score: meta?.score ?? null,
    testsPassed: meta?.tests_passed ?? null, testsFailed: meta?.tests_failed ?? null, testsQuantity: meta?.tests_quantity ?? null,
    detailsUrl: scan?.details_url ?? null, scannedAt: meta?.scanned_at ?? null,
    failed, raw: { scan: scan ?? null, analyze: analyze ?? null },
  };
  if (!out.ok) out.error = scan?.error || 'no scan result';
  return out;
}

/**
 * observatoryScan(http, host, { timeout = 30000 }) -> summariseObservatory(scan, analyze), detailsUrl always set when ok
 *
 * POST /scan?host= starts (or returns) a scan; GET /analyze?host= adds the per-test detail.
 * When the POST fails or is rate limited the GET alone is used.
 */
export async function observatoryScan(http, host, { timeout = 30000 } = {}) {
  const h = encodeURIComponent(host);
  const problems = [];
  const take = (res, label) => {
    const problem = httpProblem(res);
    if (problem) { problems.push(`${label}: ${problem}`); return null; }
    const { json, error } = parseJson(res.body);
    if (error || !json || typeof json !== 'object') { problems.push(`${label}: not JSON`); return null; }
    if (json.error) { problems.push(`${label}: ${json.error}`); return null; }
    return json;
  };
  const scan = take(await http.request(`${OBSERVATORY}/scan?host=${h}`, { method: 'POST', timeout }), 'scan');
  const analyze = take(await http.get(`${OBSERVATORY}/analyze?host=${h}`, { timeout }), 'analyze');
  const summary = summariseObservatory(scan, analyze);
  if (summary.ok && !summary.detailsUrl) summary.detailsUrl = `https://developer.mozilla.org/en-US/observatory/analyze?host=${h}`;
  if (!summary.ok) summary.error = problems.join('; ') || summary.error;
  return summary;
}

// ---------------------------------------------------------------- hstspreload.org

/**
 * hstsPreloadStatus(http, host, { timeout = 30000 })
 *   -> { ok, status: 'unknown'|'pending'|'preloaded', preloadedDomain, bulk, errors: [], warnings: [], error? }
 *
 * ok follows the status call; a failed preloadable call leaves empty lists and sets error.
 */
export async function hstsPreloadStatus(http, host, { timeout = 30000 } = {}) {
  const d = encodeURIComponent(host);
  const out = { ok: false, status: 'unknown', preloadedDomain: null, bulk: false, errors: [], warnings: [] };
  const problems = [];
  const [st, pr] = await Promise.all([
    http.get(`https://hstspreload.org/api/v2/status?domain=${d}`, { timeout }),
    http.get(`https://hstspreload.org/api/v2/preloadable?domain=${d}`, { timeout }),
  ]);
  const stJson = httpProblem(st) ? null : parseJson(st.body).json;
  if (stJson && typeof stJson === 'object') {
    out.ok = true;
    out.status = ['unknown', 'pending', 'preloaded'].includes(stJson.status) ? stJson.status : 'unknown';
    out.preloadedDomain = stJson.preloadedDomain || null;
    out.bulk = Boolean(stJson.bulk);
  } else problems.push(`status: ${httpProblem(st) || 'not JSON'}`);
  const prJson = httpProblem(pr) ? null : parseJson(pr.body).json;
  if (prJson && typeof prJson === 'object') {
    out.errors = Array.isArray(prJson.errors) ? prJson.errors : [];
    out.warnings = Array.isArray(prJson.warnings) ? prJson.warnings : [];
  } else problems.push(`preloadable: ${httpProblem(pr) || 'not JSON'}`);
  if (problems.length) out.error = problems.join('; ');
  return out;
}

// ---------------------------------------------------------------- SSL Labs

const gradesOf = (j) => (Array.isArray(j?.endpoints) ? j.endpoints : []).map((e) => ({ ip: e.ipAddress ?? null, grade: e.grade ?? null, serverName: e.serverName ?? null, hasWarnings: Boolean(e.hasWarnings) }));

/**
 * sslLabsAnalyze(http, host, { timeout = 600000, poll = 15000, log })
 *   -> { ok, status ('READY'|'ERROR'|'IN_PROGRESS'|'DNS'|null), grades: [{ ip, grade, serverName, hasWarnings }], raw, error? }
 *
 * Polls api.ssllabs.com/api/v3/analyze (cached results accepted, nothing published) until
 * READY, ERROR or the timeout. 429 / 5xx answers are waited out. Opt-in: v3 is deprecated.
 */
export async function sslLabsAnalyze(http, host, { timeout = 600000, poll = 15000, log } = {}) {
  const url = `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(host)}&all=done&fromCache=on&maxAge=24&publish=off`;
  const deadline = Date.now() + timeout;
  let last = null; let status = null;
  for (;;) {
    const res = await http.get(url, { timeout: Math.min(30000, Math.max(1000, deadline - Date.now())) });
    if (res.status === 0) return { ok: false, status, grades: gradesOf(last), raw: last, error: res.error || 'network failure' };
    const { json } = parseJson(res.body);
    const apiErrors = Array.isArray(json?.errors) ? json.errors.map((e) => e?.message || String(e)).filter(Boolean) : [];
    if (res.status === 400 || apiErrors.length) return { ok: false, status: 'ERROR', grades: [], raw: json ?? null, error: apiErrors.join('; ') || `HTTP ${res.status}` };
    if (!res.ok || !json) {
      log?.(`ssllabs ${host}: ${res.ok ? 'not JSON' : `HTTP ${res.status}`}, waiting`);
    } else {
      last = json; status = json.status || null;
      const done = (json.endpoints || []).filter((e) => e.grade).length;
      log?.(`ssllabs ${host}: ${status}${json.endpoints?.length ? ` (${done}/${json.endpoints.length} endpoints graded)` : ''}`);
      if (status === 'READY') return { ok: true, status, grades: gradesOf(json), raw: json };
      if (status === 'ERROR') return { ok: false, status, grades: [], raw: json, error: json.statusMessage || 'SSL Labs reported an error' };
    }
    if (Date.now() + poll > deadline) return { ok: false, status, grades: gradesOf(last), raw: last, error: `timed out after ${timeout} ms` };
    await sleep(poll);
  }
}

// ---------------------------------------------------------------- securityheaders.com

/**
 * securityHeadersApi(http, url, key, { timeout = 60000 }) -> { ok, grade, raw, error? }
 *
 * The paid API: x-api-key in, the grade from the x-grade response header or the JSON body.
 */
export async function securityHeadersApi(http, url, key, { timeout = 60000 } = {}) {
  if (!key) return { ok: false, grade: null, raw: null, error: 'no securityheaders.com API key' };
  const res = await http.get(`https://api.securityheaders.com/?q=${encodeURIComponent(url)}&followRedirects=on&hide=on`, { headers: { 'x-api-key': key }, timeout });
  if (res.status === 0) return { ok: false, grade: null, raw: null, error: res.error || 'network failure' };
  const { json } = parseJson(res.body);
  const raw = json ?? res.body;
  const problem = httpProblem(res);
  if (problem) return { ok: false, grade: null, raw, error: problem };
  const grade = res.headers?.['x-grade'] || json?.grade || null;
  if (!grade) return { ok: false, grade: null, raw, error: 'no grade in the answer' };
  return { ok: true, grade: String(grade).trim().toUpperCase(), raw };
}

/**
 * parseSecurityHeadersPage(html) -> { grade } | { challenge: true } | null
 *
 * A Cloudflare interstitial ("Just a moment…", cf-chl, challenge-platform) is a challenge;
 * otherwise the grade from the score markup, or a "Grade: X" text fallback.
 */
export function parseSecurityHeadersPage(html) {
  if (typeof html !== 'string' || !html.trim()) return null;
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '';
  if (/just a moment/i.test(title) || /cf-chl|challenge-platform/i.test(html)) return { challenge: true };
  const m = /class="score_(?:green|lightgreen|yellow|orange|red)"[^>]*>\s*<span>([A-F][+-]?)<\/span>/i.exec(html)
    || /<div class="score[^"]*">[\s\S]{0,300}?<span>([A-F][+-]?)<\/span>/i.exec(html)
    || /Grade:\s*([A-F][+-]?)(?![\w+-])/.exec(html);
  return m ? { grade: m[1].toUpperCase() } : null;
}

/** buildScrapeArgs(url, { profileDir, virtualTimeBudget = 20000 }) -> string[] (headless Chrome arguments, URL last). */
export function buildScrapeArgs(url, { profileDir, virtualTimeBudget = 20000 } = {}) {
  return [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profileDir}`, `--virtual-time-budget=${virtualTimeBudget}`, '--dump-dom',
    `https://securityheaders.com/?q=${encodeURIComponent(url)}&followRedirects=on&hide=on`,
  ];
}

/**
 * findChrome({ chromePath, env = process.env, exists = fs.existsSync }) -> path | null
 *
 * An explicit path, then CHROME_PATH, then the macOS bundle, then google-chrome / chromium on PATH.
 */
export function findChrome({ chromePath, env = process.env, exists = existsSync } = {}) {
  if (chromePath) return chromePath;
  if (env.CHROME_PATH) return env.CHROME_PATH;
  if (exists(MAC_CHROME)) return MAC_CHROME;
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of CHROME_NAMES) for (const dir of dirs) { const p = path.join(dir, name); if (exists(p)) return p; }
  return null;
}

/**
 * securityHeadersScrape(url, { chromePath, timeout = 45000, virtualTimeBudget = 20000, env, exists })
 *   -> { ok, grade, challenge, ms, error? }
 *
 * Loads the report page in headless Chrome (--dump-dom) with a throw-away profile under
 * os.tmpdir(), removed afterwards. A timeout is reported as a Cloudflare challenge.
 */
export async function securityHeadersScrape(url, { chromePath, timeout = 45000, virtualTimeBudget = 20000, env, exists } = {}) {
  const chrome = findChrome({ chromePath, env, exists });
  if (!chrome) return { ok: false, grade: null, challenge: false, ms: 0, error: 'Chrome not found' };
  let profileDir;
  try {
    profileDir = await mkdtemp(path.join(os.tmpdir(), 'launch-audit-shs-'));
  } catch (e) {
    return { ok: false, grade: null, challenge: false, ms: 0, error: `temp profile: ${describeError(e)}` };
  }
  try {
    const r = await runCommand(chrome, buildScrapeArgs(url, { profileDir, virtualTimeBudget }), { timeout });
    if (r.timedOut) return { ok: false, grade: null, challenge: true, ms: r.ms, error: 'timed out (Cloudflare challenge)' };
    const parsed = parseSecurityHeadersPage(r.stdout || '');
    if (parsed?.challenge) return { ok: false, grade: null, challenge: true, ms: r.ms, error: 'Cloudflare challenge page' };
    if (parsed?.grade) return { ok: true, grade: parsed.grade, challenge: false, ms: r.ms };
    const error = r.error || (r.code !== 0 ? `Chrome exited ${r.code}: ${String(r.stderr || '').trim().slice(-300)}` : 'no grade found in the page');
    return { ok: false, grade: null, challenge: false, ms: r.ms, error };
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
