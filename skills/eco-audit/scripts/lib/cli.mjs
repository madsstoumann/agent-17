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
import { gridIntensity } from './co2.mjs';

export const DEFAULTS = { pages: 4, timeout: 45000 };

export function parseCli(argv, env = process.env) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        pages: { type: 'string' },
        grid: { type: 'string' },
        views: { type: 'string' },
        mobile: { type: 'boolean' },
        'no-browser': { type: 'boolean' },
        chrome: { type: 'string' },
        out: { type: 'string' },
        state: { type: 'string' },
        baseline: { type: 'string' },
        'no-baseline': { type: 'boolean' },
        header: { type: 'string', multiple: true },
        timeout: { type: 'string' },
        insecure: { type: 'boolean' },
        'no-remote': { type: 'boolean' },
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
  if (!positionals.length) return { ok: false, error: 'Give the site URL.' };
  try {
    const urls = positionals.map((p) => { try { return normaliseUrl(p); } catch { throw new Error(`Not a URL: ${p}`); } });
    const int = (v, d, name) => {
      if (v === undefined) return d;
      const n = Number(String(v).replace(/[_,. ]/g, ''));
      if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
      return n;
    };
    let grid = null;
    if (values.grid) {
      const value = gridIntensity(values.grid);
      if (value == null) throw new Error(`--grid ${values.grid}: unknown country (use an ISO code such as DK, DNK, SE or DEU)`);
      grid = { code: values.grid.toUpperCase(), value };
    }
    return {
      ok: true,
      opts: {
        url: urls[0],
        extraUrls: urls.slice(1),
        host: new URL(urls[0]).host.toLowerCase(),
        pages: int(values.pages, DEFAULTS.pages, 'pages'),
        grid,
        views: int(values.views, 0, 'views'),
        mobile: Boolean(values.mobile),
        noBrowser: Boolean(values['no-browser']),
        chrome: values.chrome || null,
        out: values.out || null,
      state: values.state || null,
      baseline: values.baseline || null,
      noBaseline: Boolean(values['no-baseline']),
        headers: parseHeaderLines([...(values.header || []), ...String(env.AUDIT_HEADERS || '').split('\n').filter((l) => l.trim())]),
        timeout: int(values.timeout, DEFAULTS.timeout, 'timeout'),
        insecure: Boolean(values.insecure),
        noRemote: Boolean(values['no-remote']),
        quiet: Boolean(values.quiet),
      },
    };
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
 * The site's target folder: --state, else <reportsRoot>/eco-audit/<host>/. It keeps last-report.json
 * (the next run's baseline) and notes.md, and holds the default run folders.
 */
export function resolveState({ state, host }, { home = os.homedir(), cwd = process.cwd(), root } = {}) {
  if (state) return path.resolve(cwd, expandHome(state, home));
  return targetDir({ reports: root || reportsRoot({ home }), skill: 'eco-audit', name: host || 'site', owner: host || 'site' });
}

/** `--out DIR`, else <target>/runs/<YYYYMMDD-HHMM>/ (-2, -3, … for a second run in the same minute). */
export function resolveOut({ out, host }, { now = new Date(), home = os.homedir(), cwd = process.cwd(), root, state, exists = () => false } = {}) {
  if (out) return path.resolve(cwd, expandHome(out, home));
  let dir = path.join(state || resolveState({ host }, { home, cwd, root }), 'runs', stamp(now));
  for (let i = 2, base = dir; exists(dir); i++) dir = `${base}-${i}`;
  return dir;
}

export function usage() {
  return `eco-audit ${VERSION}: page weight and CO2e per page view (Sustainable Web Design model v4)

Usage: node eco.mjs <url> [more page urls] [flags]

  --pages N           Extra pages from the sitemap, one per template (default ${DEFAULTS.pages}). Page URLs after
                      the first are measured as well.
  --grid CODE         Grid intensity of the visitors' country for device and network (DK, DNK, SE, DEU, ...).
                      Default: the model's global 494 g/kWh, which keeps sites comparable.
  --views N           Page views a month, for a yearly CO2e estimate.
  --mobile            Measure with a phone viewport (412x915, DPR 2.6) instead of desktop 1366x900.
  --no-browser        Do not start Chrome; estimate from the HTML and what it references.
  --chrome PATH       Chrome, Chromium or Edge to use (also CHROME_PATH).
  --out DIR           Run folder (default <target>/runs/<stamp>/).
  --state DIR         Target folder (default <reports>/eco-audit/<host>/; <reports> is AUDIT_OUT_DIR, else
                      Downloads if it exists, else ~/audit-reports). Keeps last-report.json and notes.md.
  --baseline FILE     A previous report.json for "Since last run". Default: the last run for this host.
  --no-baseline       No "Since last run" section.
  --header "N: v"     Sent with page loads, for a WAF bypass rule (repeatable; also AUDIT_HEADERS). Chrome sends it
                      with every request the page makes, third parties included.
  --insecure          Accept a self-signed certificate.
  --no-remote         Skip the Green Web Foundation lookup.
  --timeout MS        Per page load (default ${DEFAULTS.timeout}).
  --quiet             No progress on stderr.

Writes report.md, report.json and findings.json.`;
}
