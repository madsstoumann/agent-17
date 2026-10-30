// Shared helpers for the solution-health scripts. Zero dependencies, Node 18+.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, accessSync, constants as fsConstants } from 'node:fs';
import { join, resolve, extname, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const USER_AGENT = 'solution-health-skill/2.1 (dependency and API health check; run by developers)';

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

// ---- Where the state lives -----------------------------------------------------------------
// Default: outside the repo, in the shared report folder, under a stable name per solution so each
// run compares with the last one. `--in-repo` (or `--dir PATH`) keeps it in the solution instead.

const expandHome = (p, home) => p.replace(/^~(?=$|[\\/])/, home);

/**
 * The folder reports go under (same order as the other audit skills). First match wins:
 * 1. AUDIT_OUT_DIR, 2. the Downloads folder if it exists and is writable (on Linux the XDG
 * download folder from XDG_DOWNLOAD_DIR or ~/.config/user-dirs.dirs, then ~/Downloads),
 * 3. ~/audit-reports.
 */
export function reportsRoot({ env = process.env, home = homedir(), isDir = writableDir, readFile = readText } = {}) {
  if (env.AUDIT_OUT_DIR) return resolve(expandHome(env.AUDIT_OUT_DIR, home));
  const m = String((env.XDG_DOWNLOAD_DIR ? '' : readFile(join(env.XDG_CONFIG_HOME || join(home, '.config'), 'user-dirs.dirs'))) || '').match(/^\s*XDG_DOWNLOAD_DIR\s*=\s*"?([^"\n]+)"?/m);
  const xdg = env.XDG_DOWNLOAD_DIR || (m && m[1].trim());
  const candidates = [xdg && resolve(expandHome(xdg.replace(/^\$HOME(?=$|\/)/, home), home)), join(home, 'Downloads')].filter(Boolean);
  return candidates.find((p) => isDir(p)) || join(home, 'audit-reports');
}

function writableDir(p) {
  try { accessSync(p, fsConstants.W_OK); return statSync(p).isDirectory(); } catch { return false; }
}

function readText(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/**
 * <reports>/solution-health/<solution folder name>/. A folder of that name that belongs to another
 * solution (its root.txt names a different path) gets a short hash of this root appended.
 */
export function defaultStateDir(root, { reports = reportsRoot(), readFile = readText } = {}) {
  const base = join(reports, 'solution-health');
  const name = basename(root).replace(/[^\w.-]+/g, '-') || 'solution';
  const plain = join(base, name);
  const owner = readFile(join(plain, 'root.txt'));
  return owner === null || owner.trim() === root ? plain : join(base, `${name}-${sha256(root).slice(0, 8)}`);
}

export const LEGACY_DIR = '.solution-health';

/** The marker audit skills leave in each run folder (see target-state.mjs in launch-audit). */
export const RUN_MARKER = '.audit-run';

/** True when `dir` is an audit run folder or inside one: a place that is gone by the next run. */
export function insideRun(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, RUN_MARKER))) return true;
    const up = resolve(d, '..');
    if (up === d) return false;
    d = up;
  }
}

export function paths(args = {}, opts = {}) {
  const root = resolve(args.root || process.cwd());
  let inRepo = typeof args.dir === 'string' || Boolean(args['in-repo']);
  let dir = typeof args.dir === 'string' ? resolve(root, args.dir) : args['in-repo'] ? resolve(root, LEGACY_DIR) : defaultStateDir(root, opts);
  // State kept in a timestamped run folder would be lost to the next run, so `--dir` there is ignored.
  let ignoredDir = null;
  if (typeof args.dir === 'string' && insideRun(dir)) { ignoredDir = dir; dir = defaultStateDir(root, opts); inRepo = false; }
  return {
    root,
    dir,
    inRepo,
    ignoredDir,
    legacyDir: resolve(root, LEGACY_DIR),
    manifest: resolve(dir, 'manifest.json'),
    state: resolve(dir, 'state.json'),
    report: resolve(dir, 'report.md'),
    notes: resolve(dir, 'notes.md'),
    tasks: resolve(dir, 'tasks.json'),
    runDir: resolve(dir, 'run'),
    cacheDir: resolve(dir, 'run', 'cache'),
    snapshotDir: resolve(dir, 'snapshots'),
  };
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function slug(text) {
  return text.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export function daysSince(dateLike) {
  if (!dateLike) return null;
  const t = new Date(dateLike).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function daysUntil(dateLike) {
  const d = daysSince(dateLike);
  return d === null ? null : -d;
}

export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', 'bin', 'obj', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage',
  '.solution-health', 'packages', 'wwwroot/lib', 'umbraco', 'App_Data', 'TestResults', '.vs', '.idea', '.turbo', '.cache', 'vendor',
]);

// Depth-first walk yielding absolute file paths. Skips the noisy directories above.
export function* walk(root, { skipDirs = DEFAULT_SKIP_DIRS, maxDepth = 12 } = {}, depth = 0) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (skipDirs.has(e.name) || skipDirs.has(relative(root, full))) continue;
      yield* walk(full, { skipDirs, maxDepth }, depth + 1);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

export function fileSize(file) {
  try { return statSync(file).size; } catch { return 0; }
}

export function ext(file) {
  return extname(file).toLowerCase();
}

// fetch that never throws. Returns { ok, status, url, redirected, headers, text|json, error }.
export async function safeFetch(url, { timeoutMs = 20_000, json = false, headers = {}, method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': USER_AGENT, accept: json ? 'application/json' : 'text/html,application/json;q=0.9,*/*;q=0.8', ...headers },
    });
    const out = {
      ok: res.ok, status: res.status, url: res.url, redirected: res.redirected,
      headers: Object.fromEntries(res.headers.entries()),
    };
    const body = await res.text();
    if (json) { try { out.json = JSON.parse(body); } catch { out.json = null; out.error = 'invalid JSON'; } }
    else out.text = body;
    return out;
  } catch (err) {
    return { ok: false, status: 0, url, redirected: false, headers: {}, error: err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

// Cached JSON fetch for public metadata APIs (deps.dev, ecosyste.ms, registries). TTL in hours.
export async function cachedJson(url, cacheDir, { ttlHours = 24, timeoutMs = 20_000 } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, sha256(url) + '.json');
  const cached = readJson(file);
  if (cached && Date.now() - cached.fetchedAt < ttlHours * 3_600_000) return { ...cached.result, fromCache: true };
  const res = await safeFetch(url, { json: true, timeoutMs });
  const result = { ok: res.ok, status: res.status, json: res.json ?? null, error: res.error ?? null };
  // Only cache definitive answers; a network failure should be retried next run.
  if (res.status > 0) writeJson(file, { url, fetchedAt: Date.now(), result });
  return result;
}

// Run async tasks with limited concurrency.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function loadManifest(p) {
  const m = readJson(p.manifest);
  if (!m) return null;
  m.apis ||= [];
  m.packages ||= {};
  m.packages.ignore ||= [];
  m.keywords ||= {};
  return m;
}

export function loadState(p) {
  return readJson(p.state, { version: 1, lastRun: null, apis: {}, packages: {}, runtimes: {}, nuget: {} });
}

export function log(...a) { console.error(...a); }

// Keyword list used to flag deprecation / shutdown language on watched pages.
// English + Danish, because the agency's public-sector integrations announce in Danish (the DAWA case).
export const DEFAULT_KEYWORDS = [
  'deprecated', 'deprecation', 'sunset', 'end of life', 'end-of-life', 'eol', 'discontinued', 'shut down', 'shutdown',
  'shutting down', 'retire', 'retired', 'retirement', 'decommission', 'no longer maintained', 'no longer supported',
  'no longer available', 'will be removed', 'has been removed', 'migrate to', 'migration guide', 'replaced by', 'successor',
  'breaking change', 'legacy', 'archived',
  'lukker', 'lukning', 'nedlukning', 'nedlukkes', 'nedlægges', 'nedlagt', 'udfases', 'udfasning', 'udfaset', 'ophører', 'ophørt',
  'erstattes', 'erstatning', 'erstattet', 'afvikles', 'afvikling', 'ikke længere', 'vedligeholdes ikke', 'understøttes ikke',
  'overgang til', 'migrering', 'migrer til', 'udgår',
];

export function keywordRegex(keywords) {
  const esc = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

export function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9"“(])|\n+/).map((s) => s.trim()).filter((s) => s.length > 12);
}

export function ensureDirs(p) {
  for (const d of [p.dir, p.runDir, p.cacheDir, p.snapshotDir]) mkdirSync(d, { recursive: true });
  const inSolution = !relative(p.root, p.dir).startsWith('..');
  if (!inSolution && !existsSync(join(p.dir, 'root.txt'))) writeFileSync(join(p.dir, 'root.txt'), `${p.root}\n`);
}

/**
 * State for this solution that an earlier run left in an audit run folder (for example `--dir` into an
 * audit-all run). Found by content, not by folder name: a folder with manifest.json whose root.txt or
 * run/discovery.json names this solution. Newest first.
 */
export function strayStateDirs(root, { reports = reportsRoot(), depth = 5 } = {}) {
  const found = [];
  const walk = (d, left) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === 'manifest.json')) {
      const owner = (readText(join(d, 'root.txt')) || '').trim() || readJson(join(d, 'run', 'discovery.json'))?.root;
      if (owner && resolve(owner) === root) found.push(d);
    }
    for (const e of entries) if (e.isDirectory() && left > 0 && !['run', 'snapshots', 'node_modules'].includes(e.name)) walk(join(d, e.name), left - 1);
  };
  walk(join(reports, 'audit-all'), depth);
  const t = (d) => { try { return statSync(join(d, existsSync(join(d, 'state.json')) ? 'state.json' : 'manifest.json')).mtimeMs; } catch { return 0; } };
  return found.sort((a, b) => t(b) - t(a));
}

/** notes.md from the state folder, headings moved below the report's `##` level, or null. */
export function readNotes(p) {
  const t = readText(p.notes);
  if (!t || !t.trim()) return null;
  return t.trim().replace(/^(#{1,4}) /gm, (m, h) => `${'#'.repeat(Math.min(h.length + 2, 6))} `);
}

/** Show a path relative to the solution when it is inside it, else in full. */
export function showPath(p, file) {
  const rel = relative(p.root, file);
  return rel && !rel.startsWith('..') && !/^[a-z]:/i.test(rel) ? rel : file;
}

export function nowIso() { return new Date().toISOString(); }

export function exists(f) { return existsSync(f); }
