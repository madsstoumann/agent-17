/**
 * Command-line parsing for audit.mjs: flags, defaults, environment detection
 * (dev / staging / production) and where the report goes.
 */
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normaliseUrl, isPrivateHost, hostOf, stripWww, parseHeaderLines, VERSION } from './http.mjs';
import { targetDir } from './target-state.mjs';

export const DEFAULTS = {
  pages: 3, maxPages: 100, maxExternal: 200, timeout: 15000, lhTimeout: 240000, concurrency: 6,
};

/** What the user may type after --env, and which of the three labels it means. */
export const ENV_ALIASES = {
  dev: 'dev', development: 'dev', local: 'dev',
  stage: 'staging', staging: 'staging', stg: 'staging', test: 'staging', uat: 'staging', qa: 'staging', preview: 'staging', sandbox: 'staging',
  prod: 'production', production: 'production', live: 'production',
};

/** A label in the hostname that marks a non-production site ("dev" must be its own label: devices.example.com is not staging). */
export const STAGING_HOST_RE = /(^|[.-])(dev|develop|development|staging|stage|stg|test|testing|uat|qa|preview|sandbox|demo)([.-]|$)/i;
/** Platform hosts that are never a customer's live domain. */
export const STAGING_SUFFIXES = [
  '.ondigitalocean.app', '.vercel.app', '.netlify.app', '.pages.dev', '.workers.dev', '.azurewebsites.net',
  '.azurestaticapps.net', '.umbraco.io', '.herokuapp.com', '.fly.dev', '.web.app', '.firebaseapp.com', '.appspot.com',
  '.ngrok.io', '.ngrok-free.app', '.trycloudflare.com', '.amplifyapp.com', '.cloudfront.net',
];

export function normaliseEnv(value) {
  const env = ENV_ALIASES[String(value || '').toLowerCase()];
  return env ? { env, production: env === 'production' } : null;
}

/** A hosting platform's own hostname (…ondigitalocean.app, …vercel.app): its DNS, CAA and mail records belong to the platform, not the site. */
export function isPlatformHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return STAGING_SUFFIXES.some((s) => h.endsWith(s));
}

export function isStagingHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return false;
  if (isPrivateHost(h)) return true;
  if (STAGING_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return STAGING_HOST_RE.test(h);
}

/** Guess the environment from the hostname; the report says the guess and how to override it. */
export function detectEnv(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (isPrivateHost(h)) return { env: 'dev', production: false, source: 'auto', reason: 'private host' };
  if (isStagingHost(h)) return { env: 'staging', production: false, source: 'auto', reason: 'hostname looks like a non-production host' };
  return { env: 'production', production: true, source: 'auto', reason: 'no staging marker in hostname' };
}

const OPTIONS = {
  env: { type: 'string' },
  'production-host': { type: 'string' },
  pages: { type: 'string' },
  'max-pages': { type: 'string' },
  'max-external': { type: 'string' },
  skip: { type: 'string' },
  only: { type: 'string' },
  lighthouse: { type: 'string' },
  out: { type: 'string' },
  baseline: { type: 'string' },
  'no-baseline': { type: 'boolean' },
  state: { type: 'string' },
  insecure: { type: 'boolean' },
  'email-domain': { type: 'string' },
  'old-sitemap': { type: 'string' },
  ssllabs: { type: 'boolean' },
  'no-remote': { type: 'boolean' },
  timeout: { type: 'string' },
  'lh-timeout': { type: 'string' },
  concurrency: { type: 'string' },
  ua: { type: 'string' },
  header: { type: 'string', multiple: true },
  from: { type: 'string' },
  strict: { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function num(value, fallback, name) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
  return n;
}

function list(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * parseCli(argv, env) -> { ok, opts, error, help, version }
 * Never throws; a usage error comes back as { ok: false, error }.
 */
export function parseCli(argv, env = process.env) {
  let values; let positionals;
  try {
    ({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }));
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (values.help) return { ok: false, help: true };
  if (values.version) return { ok: false, version: true };
  if (positionals.length !== 1) return { ok: false, error: positionals.length ? 'exactly one URL expected' : 'a URL is required' };

  let url;
  try { url = normaliseUrl(positionals[0]); } catch (e) { return { ok: false, error: e.message }; }
  const host = hostOf(url);

  let envInfo;
  if (values.env) {
    const n = normaliseEnv(values.env);
    if (!n) return { ok: false, error: `--env must be one of dev, staging, production (got "${values.env}")` };
    envInfo = { ...n, source: 'flag', reason: 'given on the command line' };
  } else {
    envInfo = detectEnv(host);
  }

  const lighthouseChoice = values.lighthouse || (env.PSI_API_KEY ? 'psi' : 'local');
  if (!['local', 'psi', 'off'].includes(lighthouseChoice)) return { ok: false, error: '--lighthouse must be local, psi or off' };

  let opts;
  try {
    opts = {
      url,
      host,
      env: envInfo.env,
      production: envInfo.production,
      envSource: envInfo.source,
      envReason: envInfo.reason,
      productionHost: (values['production-host'] || (envInfo.production ? host : '')).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || host,
      pages: num(values.pages, DEFAULTS.pages, 'pages'),
      maxPages: num(values['max-pages'], DEFAULTS.maxPages, 'max-pages'),
      maxExternal: num(values['max-external'], DEFAULTS.maxExternal, 'max-external'),
      skip: list(values.skip),
      only: list(values.only),
      lighthouse: lighthouseChoice,
      out: values.out || null,
      baseline: values.baseline || null,
      noBaseline: Boolean(values['no-baseline']),
      state: values.state || null,
      insecure: Boolean(values.insecure),
      emailDomain: (values['email-domain'] || stripWww(host.replace(/:\d+$/, ''))).toLowerCase(),
      oldSitemap: values['old-sitemap'] || null,
      ssllabs: Boolean(values.ssllabs),
      noRemote: Boolean(values['no-remote']),
      timeout: num(values.timeout, DEFAULTS.timeout, 'timeout'),
      lhTimeout: num(values['lh-timeout'], DEFAULTS.lhTimeout, 'lh-timeout'),
      concurrency: Math.max(1, num(values.concurrency, DEFAULTS.concurrency, 'concurrency')),
      ua: values.ua || null,
      headers: parseHeaderLines([...(values.header || []), ...String(env.AUDIT_HEADERS || '').split('\n').filter((l) => l.trim())]),
      from: values.from || env.AUDIT_FROM || '',
      strict: Boolean(values.strict),
      json: Boolean(values.json),
      quiet: Boolean(values.quiet),
      psiKey: env.PSI_API_KEY || '',
      shKey: env.SECURITYHEADERS_API_KEY || '',
      chromePath: env.CHROME_PATH || '',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (opts.lighthouse === 'psi' && !opts.psiKey) return { ok: false, error: '--lighthouse psi needs PSI_API_KEY in the environment' };
  return { ok: true, opts };
}

function stamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

/**
 * The folder reports go under when no --out is given. First match wins:
 * 1. AUDIT_OUT_DIR, 2. the Downloads folder if it exists and is writable (on Linux the XDG
 * download folder from XDG_DOWNLOAD_DIR or ~/.config/user-dirs.dirs, then ~/Downloads),
 * 3. ~/audit-reports. Works the same on macOS, Windows and Linux.
 */
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

function writableDir(p) {
  try { fs.accessSync(p, fs.constants.W_OK); return fs.statSync(p).isDirectory(); } catch { return false; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/**
 * The site's target folder: --state, else <reportsRoot>/launch-audit/<host>/. It keeps last-report.json
 * (the next run's baseline) and notes.md, and holds the default run folders.
 */
export function resolveState({ state, host }, { home = os.homedir(), cwd = process.cwd(), root } = {}) {
  if (state) return path.resolve(cwd, expandHome(state, home));
  return targetDir({ reports: root || reportsRoot({ home }), skill: 'launch-audit', name: host || 'site', owner: host || 'site' });
}

/**
 * Where the files go. resolveOut({ out, host }, { now, home, cwd, root, state })
 *   -> { dir, reportMd, reportJson, rawDir, mode: 'dir' | 'file' }
 * A folder (default <target>/runs/<stamp>/, target = resolveState) holds report.md, report.json and the raw JSON;
 * a path ending in .md is the report itself, with <name>.json and <name>-raw/ beside it.
 */
export function resolveOut({ out, host }, { now = new Date(), home = os.homedir(), cwd = process.cwd(), root, state, exists = () => false } = {}) {
  if (out && /\.md$/i.test(out)) {
    const reportMd = path.resolve(cwd, expandHome(out, home));
    const base = reportMd.replace(/\.md$/i, '');
    return { mode: 'file', dir: path.dirname(reportMd), reportMd, reportJson: `${base}.json`, rawDir: `${base}-raw` };
  }
  let dir = out
    ? path.resolve(cwd, expandHome(out, home))
    : path.join(state || resolveState({ host }, { home, cwd, root }), 'runs', stamp(now));
  // A second run in the same minute gets its own folder (-2, -3, …) rather than overwriting the first.
  if (!out) for (let i = 2, base = dir; exists(dir); i++) dir = `${base}-${i}`;
  return { mode: 'dir', dir, reportMd: path.join(dir, 'report.md'), reportJson: path.join(dir, 'report.json'), rawDir: dir };
}

export function usage() {
  return `launch-audit ${VERSION} — pre-launch website audit

Usage: node audit.mjs <url> [flags]

  --env dev|staging|production   Which environment this is (aliases: development, local, stage, stg, test, uat, qa, preview, prod, live).
                                 Default: guessed from the hostname; the report says so. On dev/staging, noindex and robots
                                 Disallow are expected and collected into a "Before production" checklist instead of failing.
  --production-host HOST         The future live hostname; canonical/og:url/sitemap hosts are compared against it.
  --pages N                      Extra Lighthouse pages sampled from the sitemap (mobile). Default ${DEFAULTS.pages}.
  --max-pages N                  Crawl bound (default ${DEFAULTS.maxPages}).   --max-external N   External links checked (default ${DEFAULTS.maxExternal}).
  --skip a,b / --only a,b        Group or check ids: crawl redirects notfound tls dns email exposed headers caching perf a11y privacy links social icons ops.
  --lighthouse local|psi|off     Default: psi when PSI_API_KEY is set, else local (npx lighthouse + Chrome).
  --out PATH                     Folder for report.md + report.json + raw JSON (default <target>/runs/<stamp>/),
                                 or a path ending in .md (JSON and raw files land beside it).
  --state DIR                    Target folder (default <reports>/launch-audit/<host>/, where <reports> is $AUDIT_OUT_DIR,
                                 else Downloads, else ~/audit-reports). Keeps last-report.json and notes.md between runs.
  --baseline FILE                A previous report.json for "Since last run". Default: the last run for this host.
  --no-baseline                  No "Since last run" section (the run still becomes the next baseline).
  --insecure                     Accept a self-signed certificate (local sites).
  --email-domain D               Where SPF/DMARC live (default: host without www.).
  --old-sitemap URL|FILE         Old site's URLs must redirect (not implemented yet).
  --ssllabs                      Also run a Qualys SSL Labs assessment (slow, opt-in).
  --no-remote                    Skip every third-party service (W3C, schema.org, Observatory, hstspreload, PSI, scrape).
  --timeout MS                   Per request (default ${DEFAULTS.timeout}).   --lh-timeout MS   Per Lighthouse run (default ${DEFAULTS.lhTimeout}).
  --concurrency N                Parallel requests (default ${DEFAULTS.concurrency}).
  --ua STRING / --from EMAIL     Override the User-Agent / add a From: header (also AUDIT_FROM).
  --header "Name: value"         Send this header to the audited site and from Lighthouse (repeatable; also AUDIT_HEADERS,
                                 one per line). For a WAF bypass rule; never sent to third-party services by the script.
  --strict                       Exit 3 when anything fails (CI). Default exit code is 0 whatever the findings.
  --json                         Print report.json to stdout instead of the summary.   --quiet   No progress on stderr.
  -h, --help / -v, --version

Environment: PSI_API_KEY (PageSpeed Insights, adds CrUX field data), SECURITYHEADERS_API_KEY (paid API), CHROME_PATH, AUDIT_FROM, AUDIT_HEADERS.
Exit codes: 0 done, 1 usage, 2 start URL unreachable, 3 --strict with failures.`;
}
