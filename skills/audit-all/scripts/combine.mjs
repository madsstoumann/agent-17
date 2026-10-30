#!/usr/bin/env node
/**
 * audit-all: merge the per-audit reports in a run folder into one report.md, report.html and report.pdf.
 *
 *   node combine.mjs <run-dir> [--style serif|sans] [--repo PATH]... [--no-pdf] [--chrome PATH]
 *   node combine.mjs --new <name>      print a fresh run folder path (and create it)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverReports, headline, parseSummary, combinedMarkdown, combinedHtml } from './lib/report.mjs';
import { printPdf } from './lib/pdf.mjs';

export const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const SIBLINGS = path.join(HERE, '..', '..');

const USAGE = `audit-all ${VERSION}: combine launch-audit, security-audit and solution-health reports

Usage:
  node combine.mjs <run-dir> [flags]   Combine <run-dir>/<kind>[-<target>]/report.md into <run-dir>/report.{md,html,pdf}
  node combine.mjs --new <name>        Create and print a run folder: <reports>/audit-all/<name>-<stamp>/

Flags:
  --style serif|sans   Typeface for the HTML and PDF (default serif).
  --repo PATH          Copy PATH/.solution-health/report.md into <run-dir>/solution-health-<repo name>/ first.
                       Repeat for several repos.
  --no-pdf             Write report.md and report.html only.
  --chrome PATH        Browser to print with (default: CHROME_PATH, installed Chrome/Chromium/Edge, Playwright's Chromium).

<reports> is $AUDIT_OUT_DIR, else the Downloads folder if it exists (XDG download folder on Linux), else ~/audit-reports.
`;

const STYLES = { serif: 'serif', sans: 'sans' };

export function parseArgs(argv) {
  const a = { dir: null, style: 'serif', repos: [], pdf: true, chrome: null, newName: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${v} needs a value`); return argv[++i]; };
    if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--style' || v.startsWith('--style=')) {
      const s = (v.includes('=') ? v.split('=')[1] : next()).toLowerCase();
      if (!STYLES[s]) throw new Error(`Unknown style "${s}". Styles: serif, sans`);
      a.style = STYLES[s];
    } else if (v === '--repo') a.repos.push(next());
    else if (v === '--no-pdf') a.pdf = false;
    else if (v === '--chrome') a.chrome = next();
    else if (v === '--new') a.newName = next();
    else if (v.startsWith('--')) throw new Error(`Unknown option ${v}`);
    else a.dir = v;
  }
  return a;
}

// ---- Report folder (same order as launch-audit and security-audit) ---------------------------

const expandHome = (p, home) => p.replace(/^~(?=$|[\\/])/, home);

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

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

export const safeName = (s) => String(s || 'audit').replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'audit';

// ---- Fonts and CSS ------------------------------------------------------------------------

const FONTS = {
  serif: [
    ['AA Newsreader', 'Newsreader-opsz-wght.woff2', '200 800', 'normal'],
    ['AA Newsreader', 'Newsreader-Italic-opsz-wght.woff2', '200 800', 'italic'],
  ],
  sans: [
    ['AA Plex Sans', 'IBMPlexSans-ExtraLight.woff2', '200', 'normal'],
    ['AA Plex Sans', 'IBMPlexSans-Light.woff2', '300', 'normal'],
    ['AA Plex Sans', 'IBMPlexSans-LightItalic.woff2', '300', 'italic'],
    ['AA Plex Sans', 'IBMPlexSans-Regular.woff2', '400', 'normal'],
    ['AA Plex Sans', 'IBMPlexSans-Italic.woff2', '400', 'italic'],
    ['AA Plex Sans', 'IBMPlexSans-Medium.woff2', '500', 'normal'],
    ['AA Plex Sans', 'IBMPlexSans-SemiBold.woff2', '600', 'normal'],
  ],
  mono: [
    ['AA Plex Mono', 'IBMPlexMono-Regular.woff2', '400', 'normal'],
    ['AA Plex Mono', 'IBMPlexMono-Medium.woff2', '500 700', 'normal'],
  ],
};

/** The stylesheet with only the chosen style's fonts embedded, so report.html stands alone. */
export function stylesheet(style, assets = ASSETS) {
  const faces = [...FONTS[style], ...FONTS.mono].map(([family, file, weight, fstyle]) => {
    const p = path.join(assets, 'fonts', file);
    if (!fs.existsSync(p)) return '';
    const data = fs.readFileSync(p).toString('base64');
    return `@font-face { font-family: "${family}"; src: url(data:font/woff2;base64,${data}) format("woff2"); font-weight: ${weight}; font-style: ${fstyle}; font-display: block; }`;
  }).join('\n');
  return `${faces}\n${fs.readFileSync(path.join(assets, 'report.css'), 'utf8')}`;
}

function skillVersion(name) {
  try {
    const m = fs.readFileSync(path.join(SIBLINGS, name, 'SKILL.md'), 'utf8').match(/^\s+version:\s*"?([\d.]+)"?/m);
    return m ? m[1] : null;
  } catch { return null; }
}

/** Copy each repo's committed solution-health report into the run folder. */
export function collectSolutionHealth(runDir, repos) {
  const copied = [];
  for (const repo of repos) {
    const root = path.resolve(expandHome(repo, os.homedir()));
    const src = path.join(root, '.solution-health', 'report.md');
    if (!fs.existsSync(src)) { copied.push({ repo: root, ok: false }); continue; }
    const dest = path.join(runDir, `solution-health-${safeName(path.basename(root))}`);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(src, path.join(dest, 'report.md'));
    copied.push({ repo: root, ok: true, dest });
  }
  return copied;
}

export async function combine(args, { now = new Date(), log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const runDir = path.resolve(expandHome(args.dir, os.homedir()));
  if (!fs.existsSync(runDir)) throw new Error(`Run folder not found: ${runDir}`);
  for (const c of collectSolutionHealth(runDir, args.repos)) log(c.ok ? `solution-health: copied ${c.repo} -> ${c.dest}` : `solution-health: no .solution-health/report.md in ${c.repo} (run solution-health there first)`);

  const reports = discoverReports(runDir);
  if (!reports.length) throw new Error(`No reports in ${runDir}. Expected sub-folders like launch-audit/, security-audit-<repo>/, solution-health-<repo>/ with a report.md each.`);
  const summaryFile = path.join(runDir, 'summary.md');
  const summaryMd = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  if (!summaryMd) log('summary.md not found: the report will have no verdict or "Fix first" list.');
  const summary = parseSummary(summaryMd);
  summary.raw = summaryMd.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const heads = reports.map(headline);
  const toolVersions = Object.fromEntries([...new Set(reports.map((r) => r.kind))].map((k) => [k, skillVersion(k)]).filter(([, v]) => v));

  const md = combinedMarkdown({ summary, reports, heads, date: now, version: VERSION });
  const html = combinedHtml({ summary, reports, heads, date: now, version: VERSION, css: stylesheet(args.style), style: args.style, toolVersions });
  const out = { md: path.join(runDir, 'report.md'), html: path.join(runDir, 'report.html'), pdf: null, reports: reports.map((r) => r.folder) };
  fs.writeFileSync(out.md, md);
  fs.writeFileSync(out.html, html);
  if (args.pdf) {
    const pdfFile = path.join(runDir, 'report.pdf');
    const r = await printPdf(out.html, pdfFile, { chromePath: args.chrome });
    if (r.ok) out.pdf = pdfFile;
    else log(`PDF skipped: ${r.error}. Open report.html in a browser and print to PDF instead.`);
  }
  return out;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n\n${USAGE}`); process.exit(2); }
  if (args.help) { process.stdout.write(USAGE); return; }
  if (args.newName) {
    const dir = path.join(reportsRoot(), 'audit-all', `${safeName(args.newName)}-${stamp()}`);
    fs.mkdirSync(dir, { recursive: true });
    process.stdout.write(`${dir}\n`);
    return;
  }
  if (!args.dir) { process.stderr.write(USAGE); process.exit(2); }
  try {
    const out = await combine(args);
    process.stdout.write(`combined: ${out.reports.join(', ')}\n\nreport.md:   ${out.md}\nreport.html: ${out.html}\nreport.pdf:  ${out.pdf || '(not written)'}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
