/**
 * Flags, the report folder and the help text.
 *
 * Zero dependencies. Node >= 22. The report-folder resolver is the same as launch-audit's
 * (`reportsRoot` in launch-audit/scripts/lib/cli.mjs); keep them in step.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normaliseUrl, parseHeaderLines, VERSION } from './http.mjs';
import { targetDir, stamp } from './target-state.mjs';

export const DEFAULTS = { pages: 150, sitemapSample: 50, externalLinks: 150, schemaPages: 8, concurrency: 6, timeout: 15000 };

export function parseCli(argv, env = process.env) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        pages: { type: 'string' },
        'sitemap-sample': { type: 'string' },
        'external-links': { type: 'string' },
        'schema-pages': { type: 'string' },
        'production-host': { type: 'string' },
        out: { type: 'string' },
        state: { type: 'string' },
        baseline: { type: 'string' },
        'no-baseline': { type: 'boolean' },
        header: { type: 'string', multiple: true },
        concurrency: { type: 'string' },
        timeout: { type: 'string' },
        insecure: { type: 'boolean' },
        'no-remote': { type: 'boolean' },
        'ignore-robots': { type: 'boolean' },
        quiet: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
    }));
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (values.help) return { ok: true, help: true };
  if (values.version) return { ok: true, version: true };
  if (positionals.length !== 1) return { ok: false, error: positionals.length ? `One URL only (got ${positionals.join(' ')})` : 'Give the site URL.' };
  let url;
  try { url = normaliseUrl(positionals[0]); } catch { return { ok: false, error: `Not a URL: ${positionals[0]}` }; }
  const int = (v, d, name) => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
    return n;
  };
  try {
    const opts = {
      url,
      host: new URL(url).host.toLowerCase(),
      pages: Math.max(1, int(values.pages, DEFAULTS.pages, 'pages')),
      sitemapSample: int(values['sitemap-sample'], DEFAULTS.sitemapSample, 'sitemap-sample'),
      externalLinks: int(values['external-links'], DEFAULTS.externalLinks, 'external-links'),
      schemaPages: int(values['schema-pages'], DEFAULTS.schemaPages, 'schema-pages'),
      concurrency: Math.max(1, int(values.concurrency, DEFAULTS.concurrency, 'concurrency')),
      timeout: int(values.timeout, DEFAULTS.timeout, 'timeout'),
      productionHost: values['production-host'] ? values['production-host'].toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null,
      out: values.out || null,
      state: values.state || null,
      baseline: values.baseline || null,
      noBaseline: Boolean(values['no-baseline']),
      headers: parseHeaderLines([...(values.header || []), ...String(env.AUDIT_HEADERS || '').split('\n').filter((l) => l.trim())]),
      insecure: Boolean(values.insecure),
      noRemote: Boolean(values['no-remote']),
      ignoreRobots: Boolean(values['ignore-robots']),
      quiet: Boolean(values.quiet),
    };
    return { ok: true, opts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * The folder reports go under when no --out is given. First match wins:
 * 1. AUDIT_OUT_DIR, 2. the Downloads folder if it exists and is writable (on Linux the XDG
 * download folder from XDG_DOWNLOAD_DIR or ~/.config/user-dirs.dirs, then ~/Downloads),
 * 3. ~/audit-reports.
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

const expandHome = (p, home) => String(p).replace(/^~(?=$|[/\\])/, home);

/**
 * The site's target folder: --state, else <reportsRoot>/seo-audit/<host>/. It keeps last-report.json
 * (the next run's baseline) and notes.md, and holds the default run folders.
 */
export function resolveState({ state, host }, { home = os.homedir(), cwd = process.cwd(), root } = {}) {
  if (state) return path.resolve(cwd, expandHome(state, home));
  return targetDir({ reports: root || reportsRoot({ home }), skill: 'seo-audit', name: host || 'site', owner: host || 'site' });
}

/** `--out DIR`, else <target>/runs/<YYYYMMDD-HHMM>/ (-2, -3, … for a second run in the same minute). */
export function resolveOut({ out, host }, { now = new Date(), home = os.homedir(), cwd = process.cwd(), root, state, exists = () => false } = {}) {
  if (out) return path.resolve(cwd, expandHome(out, home));
  let dir = path.join(state || resolveState({ host }, { home, cwd, root }), 'runs', stamp(now));
  for (let i = 2, base = dir; exists(dir); i++) dir = `${base}-${i}`;
  return dir;
}

export function usage() {
  return `seo-audit ${VERSION}: site-wide SEO and content audit

Usage: node seo.mjs <url> [flags]

  --pages N              Pages to crawl by following links (default ${DEFAULTS.pages}).
  --sitemap-sample N     Extra sitemap URLs to fetch that the crawl did not reach (default ${DEFAULTS.sitemapSample}).
  --external-links N     External links to check (default ${DEFAULTS.externalLinks}, 0 to skip).
  --schema-pages N       Pages (one per template) sent to validator.schema.org (default ${DEFAULTS.schemaPages}, 0 to skip).
  --production-host H    The future live host; canonical, og:url and hreflang on it are not "another host".
  --out DIR              Run folder (default <target>/runs/<stamp>/).
  --state DIR            Target folder (default <reports>/seo-audit/<host>/; <reports> is AUDIT_OUT_DIR, else
                         Downloads if it exists, else ~/audit-reports). Keeps last-report.json and notes.md.
  --baseline FILE        A previous report.json for "Since last run". Default: the last run for this host.
  --no-baseline          No "Since last run" section.
  --header "Name: value" Sent to the audited host only, for a WAF bypass rule (repeatable; also AUDIT_HEADERS).
  --insecure             Accept a self-signed certificate (localhost, dev).
  --no-remote            Skip validator.schema.org.
  --ignore-robots        Crawl paths robots.txt disallows (they are still reported).
  --concurrency N        Parallel requests (default ${DEFAULTS.concurrency}).
  --timeout MS           Per request (default ${DEFAULTS.timeout}).
  --quiet                No progress on stderr.

Writes report.md, report.json, findings.json and pages.csv.`;
}
