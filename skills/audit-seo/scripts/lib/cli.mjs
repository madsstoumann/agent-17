/**
 * Flags, the report folder and the help text.
 *
 * Zero dependencies. Node >= 22. The report-folder resolver is the same as audit-launch's
 * (`reportsRoot` in audit-launch/scripts/lib/cli.mjs); keep them in step.
 */
import { parseLevel } from './levels.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normaliseUrl, parseHeaderLines, VERSION } from './http.mjs';
import { targetDir, stamp } from './target-state.mjs';

export const DEFAULTS = { pages: 150, sitemapSample: 50, externalLinks: 150, internalLinks: 300, schemaPages: 8, renderPages: 8, botPages: 3, concurrency: 6, timeout: 15000 };

export function parseCli(argv, env = process.env, { cwd = process.cwd() } = {}) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        pages: { type: 'string' },
        'sitemap-sample': { type: 'string' },
        'external-links': { type: 'string' },
        'internal-links': { type: 'string' },
        'schema-pages': { type: 'string' },
        'render-pages': { type: 'string' },
        'schema-only': { type: 'boolean' },
        'bot-pages': { type: 'string' },
        geo: { type: 'boolean' },
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
        level: { type: 'string' },
        console: { type: 'boolean' },
        report: { type: 'boolean' },
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
  if (positionals.length !== 1) return { ok: false, error: positionals.length ? `One URL or file only (got ${positionals.join(' ')})` : 'Give the site URL (or a local HTML file).' };
  // A local HTML file (a path that exists, or file://): structured data only, nothing crawled.
  const file = localFile(positionals[0], cwd);
  let url;
  if (file) url = pathToFileURL(file).href;
  else try { url = normaliseUrl(positionals[0]); } catch { return { ok: false, error: `Not a URL or an existing file: ${positionals[0]}` }; }
  const int = (v, d, name) => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
    return n;
  };
  try {
    const opts = {
      url,
      file,
      host: file ? `file-${path.basename(file).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}` : new URL(url).host.toLowerCase(),
      schemaOnly: Boolean(file || values['schema-only']),
      pages: Math.max(1, int(values.pages, DEFAULTS.pages, 'pages')),
      sitemapSample: int(values['sitemap-sample'], DEFAULTS.sitemapSample, 'sitemap-sample'),
      externalLinks: int(values['external-links'], DEFAULTS.externalLinks, 'external-links'),
      internalLinks: int(values['internal-links'], DEFAULTS.internalLinks, 'internal-links'),
      schemaPages: int(values['schema-pages'], DEFAULTS.schemaPages, 'schema-pages'),
      renderPages: int(values['render-pages'], DEFAULTS.renderPages, 'render-pages'),
      botPages: int(values['bot-pages'], DEFAULTS.botPages, 'bot-pages'),
      geo: Boolean(values.geo),
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
      levels: parseLevel(values.level),
      console: Boolean(values.console),
      report: Boolean(values.report),
      quiet: Boolean(values.quiet),
    };
    return { ok: true, opts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** The absolute path when `arg` names an existing file (or is a file:// URL), else null. */
export function localFile(arg, cwd = process.cwd()) {
  let p = String(arg || '');
  if (/^file:/i.test(p)) { try { p = fileURLToPath(p); } catch { return null; } }
  else if (/^https?:\/\//i.test(p)) return null;
  p = path.resolve(cwd, p.replace(/^~(?=$|[/\\])/, os.homedir()));
  try { return fs.statSync(p).isFile() ? p : null; } catch { return null; }
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
 * The site's target folder: --state, else <reportsRoot>/audit-seo/<host>/. It keeps last-report.json
 * (the next run's baseline) and notes.md, and holds the default run folders.
 */
export function resolveState({ state, host }, { home = os.homedir(), cwd = process.cwd(), root } = {}) {
  if (state) return path.resolve(cwd, expandHome(state, home));
  return targetDir({ reports: root || reportsRoot({ home }), skill: 'audit-seo', name: host || 'site', owner: host || 'site' });
}

/** `--out DIR`, else <target>/runs/<YYYYMMDD-HHMM>/ (-2, -3, … for a second run in the same minute). */
export function resolveOut({ out, host }, { now = new Date(), home = os.homedir(), cwd = process.cwd(), root, state, exists = () => false } = {}) {
  if (out) return path.resolve(cwd, expandHome(out, home));
  let dir = path.join(state || resolveState({ host }, { home, cwd, root }), 'runs', stamp(now));
  for (let i = 2, base = dir; exists(dir); i++) dir = `${base}-${i}`;
  return dir;
}

export function usage() {
  return `audit-seo ${VERSION}: site-wide SEO and content audit

Usage: node seo.mjs <url> [flags]
       node seo.mjs <url> --schema-only     structured data on that one page (no crawl)
       node seo.mjs <file.html>             structured data in a local file (no crawl)

  --pages N              Pages to crawl by following links (default ${DEFAULTS.pages}).
  --sitemap-sample N     Extra sitemap URLs to fetch that the crawl did not reach (default ${DEFAULTS.sitemapSample}).
  --external-links N     External links to check (default ${DEFAULTS.externalLinks}, 0 to skip).
  --internal-links N     Internal link targets the crawl found but did not fetch (past --pages), checked for a
                         status so broken links on every crawled page are found (default ${DEFAULTS.internalLinks}, 0 to skip).
  --schema-pages N       Pages (one per template) sent to validator.schema.org (default ${DEFAULTS.schemaPages}, 0 to skip).
  --render-pages N       Pages rendered in headless Chrome: the start page, pages without JSON-LD in the served HTML,
                         then one page per section. Finds JSON-LD that JavaScript adds and compares the served text with
                         the rendered text, as AI crawlers that do not run JavaScript see it (default ${DEFAULTS.renderPages}, 0 to skip).
  --bot-pages N          Pages fetched as each AI crawler (OAI-SearchBot, Claude-SearchBot, PerplexityBot…), bingbot and
                         Googlebot, to find CDN or WAF rules that refuse them (default ${DEFAULTS.botPages}, 0 to skip).
  --geo                  GEO view: report.md and the summary show the AI search rows and the rows that decide what AI
                         crawlers can reach, under a GEO readiness score. report.json and findings.json keep everything.
  --schema-only          Only the structured-data checks, on the given page alone, every validator error listed.
                         Implied for a local HTML file.
  --production-host H    The future live host; canonical, og:url and hreflang on it are not "another host".
  --out DIR              Run folder (default <target>/runs/<stamp>/).
  --state DIR            Target folder (default <reports>/audit-seo/<host>/; <reports> is AUDIT_OUT_DIR, else
                         Downloads if it exists, else ~/audit-reports). Keeps last-report.json and notes.md.
  --baseline FILE        A previous report.json for "Since last run". Default: the last run for this host.
  --no-baseline          No "Since last run" section.
  --header "Name: value" Sent to the audited host only, for a WAF bypass rule (repeatable; also AUDIT_HEADERS).
  --insecure             Accept a self-signed certificate (localhost, dev).
  --no-remote            Skip validator.schema.org.
                         Chrome: found automatically, or set CHROME_PATH.
  --ignore-robots        Crawl paths robots.txt disallows (they are still reported).
  --concurrency N        Parallel requests (default ${DEFAULTS.concurrency}).
  --timeout MS           Per request (default ${DEFAULTS.timeout}).
  --level LIST           What report.md and the summary show: error, warn, info, a comma list (error,warn), or all (default).
                         report.json, findings.json and last-report.json always keep every result.
  --console              Print a compact list of issues instead of writing report files (last-report.json is still saved).
                         Add --report to get both.
  --quiet                No progress on stderr.

Writes report.md, report.json, findings.json and pages.csv.`;
}
