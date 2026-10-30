#!/usr/bin/env node
/**
 * audit-all: merge the per-audit reports in a run folder into one report.md, report.html and report.pdf.
 *
 *   node combine.mjs <run-dir> [--style serif|sans] [--repo PATH]... [--no-pdf] [--chrome PATH]
 *   (also writes fix/TODO.md and fix/tasks/*.md when <run-dir>/tasks.json exists)
 *   node combine.mjs --new <name>      print a fresh run folder path (and create it)
 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverReports, headline, parseSummary, combinedMarkdown, combinedHtml } from './lib/report.mjs';
import { printPdf } from './lib/pdf.mjs';
import { writeFixPlan } from './lib/tasks.mjs';
import { targetDir, claimTarget, newRun, previousRuns, readNotes, targetName } from './lib/target-state.mjs';

export const VERSION = '1.5.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const SIBLINGS = path.join(HERE, '..', '..');

const USAGE = `audit-all ${VERSION}: combine launch-audit, a11y-audit, seo-audit, eco-audit, privacy-audit, infra-audit, security-audit and solution-health reports

Usage:
  node combine.mjs <run-dir> [flags]   Combine <run-dir>/<kind>[-<target>]/report.md into <run-dir>/report.{md,html,pdf},
                                       and <run-dir>/tasks.json (if any) into fix/TODO.md and fix/tasks/*.md
  node combine.mjs --new <name>        Create and print a run folder: <reports>/audit-all/<name>/runs/<stamp>/
                                       (and, on stderr, the previous run of <name>, to compare with)

Flags:
  --style serif|sans   Typeface for the HTML and PDF (default serif). Also editorial (= serif), modern (= sans).
  --repo PATH          Copy PATH's solution-health report (<reports>/solution-health/<repo name>/report.md,
                       or PATH/.solution-health/report.md for --in-repo setups) into <run-dir>/solution-health-<repo name>/ first.
                       Repeat for several repos.
  --no-pdf             Write report.md and report.html only.
  --chrome PATH        Browser to print with (default: CHROME_PATH, installed Chrome/Chromium/Edge, Playwright's Chromium).

<reports> is $AUDIT_OUT_DIR, else the Downloads folder if it exists (XDG download folder on Linux), else ~/audit-reports.
`;

const STYLES = { serif: 'serif', sans: 'sans', editorial: 'serif', modern: 'sans' };

export function parseArgs(argv) {
  const a = { dir: null, style: 'serif', repos: [], pdf: true, chrome: null, newName: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${v} needs a value`); return argv[++i]; };
    if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--style' || v.startsWith('--style=')) {
      const s = (v.includes('=') ? v.split('=')[1] : next()).toLowerCase();
      if (!STYLES[s]) throw new Error(`Unknown style "${s}". Styles: serif (editorial), sans (modern)`);
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

export const safeName = (s) => String(s || 'audit').replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'audit';

/**
 * A new run folder for `name` in its target folder <reports>/audit-all/<name>/runs/<stamp>/, plus the
 * previous run to compare with: the newest earlier run there, else (first run after upgrading) the
 * newest old-layout run folder <reports>/audit-all/<name>-<stamp>/ that has a summary.md.
 */
export function newRunFolder(name, { reports = reportsRoot(), now = new Date() } = {}) {
  const target = claimTarget(targetDir({ reports, skill: 'audit-all', name, owner: targetName(name) }), targetName(name));
  const dir = newRun(target, { now, info: { skill: 'audit-all', target: name } });
  let previous = previousRuns(target, { exclude: dir })[0] || null;
  if (!previous) {
    const base = path.join(reports, 'audit-all');
    const prefix = `${targetName(name)}-`;
    let old = [];
    try { old = fs.readdirSync(base).filter((n) => n.startsWith(prefix) && /-\d{8}-\d{4}$/.test(n) && fs.existsSync(path.join(base, n, 'summary.md'))); } catch { /* none */ }
    previous = old.sort().reverse().map((n) => path.join(base, n))[0] || null;
  }
  return { dir, target, previous };
}

/** The target folder of a run folder laid out as <target>/runs/<stamp>/, else null. */
export const targetOfRun = (runDir) => (path.basename(path.dirname(runDir)) === 'runs' ? path.dirname(path.dirname(runDir)) : null);

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

/**
 * Where solution-health keeps a repo's report: its state folder under the report root (the same
 * name rule as solution-health's defaultStateDir), else an in-repo `.solution-health/` (--in-repo).
 */
export function solutionHealthReport(root, { reports = reportsRoot(), readFile = readText, exists = fs.existsSync } = {}) {
  const base = path.join(reports, 'solution-health');
  const name = path.basename(root).replace(/[^\w.-]+/g, '-') || 'solution';
  const owner = readFile(path.join(base, name, 'root.txt'));
  const dir = owner === null || owner.trim() === root ? path.join(base, name) : path.join(base, `${name}-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 8)}`);
  return [path.join(dir, 'report.md'), path.join(root, '.solution-health', 'report.md')].find((f) => exists(f)) || null;
}

/** Copy each repo's solution-health report into the run folder. */
export function collectSolutionHealth(runDir, repos, opts = {}) {
  const copied = [];
  for (const repo of repos) {
    const root = path.resolve(expandHome(repo, os.homedir()));
    const src = solutionHealthReport(root, opts);
    if (!src) { copied.push({ repo: root, ok: false }); continue; }
    const dest = path.join(runDir, `solution-health-${safeName(path.basename(root))}`);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(src, path.join(dest, 'report.md'));
    // solution-health 2.2+ also writes its red and amber findings as draft fix tasks in this skill's tasks.json shape.
    const tasks = path.join(path.dirname(src), 'tasks.json');
    if (fs.existsSync(tasks)) fs.copyFileSync(tasks, path.join(dest, 'tasks.json'));
    copied.push({ repo: root, ok: true, dest });
  }
  return copied;
}

export async function combine(args, { now = new Date(), log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const runDir = path.resolve(expandHome(args.dir, os.homedir()));
  if (!fs.existsSync(runDir)) throw new Error(`Run folder not found: ${runDir}`);
  for (const c of collectSolutionHealth(runDir, args.repos)) log(c.ok ? `solution-health: copied ${c.repo} -> ${c.dest}` : `solution-health: no report for ${c.repo} (run solution-health there first)`);

  const reports = discoverReports(runDir);
  if (!reports.length) throw new Error(`No reports in ${runDir}. Expected sub-folders like launch-audit/, a11y-audit/, privacy-audit/, infra-audit/, security-audit-<repo>/, solution-health-<repo>/ with a report.md each.`);
  const summaryFile = path.join(runDir, 'summary.md');
  let summaryMd = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  if (!summaryMd) log('summary.md not found: the report will have no verdict or "Fix first" list.');
  // notes.md in the target folder: hand-written, never rewritten, shown after the summary in every run.
  const target = targetOfRun(runDir);
  const notes = target && readNotes(target);
  if (notes) summaryMd = `${summaryMd.trimEnd()}\n\n## Notes\n\n${notes.trim().replace(/^(#{1,4}) /gm, (m, h) => `${'#'.repeat(Math.min(h.length + 2, 6))} `)}\n`;
  const summary = parseSummary(summaryMd);
  summary.raw = summaryMd.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const heads = reports.map(headline);
  const toolVersions = Object.fromEntries([...new Set(reports.map((r) => r.kind))].map((k) => [k, skillVersion(k)]).filter(([, v]) => v));

  const md = combinedMarkdown({ summary, reports, heads, date: now, version: VERSION });
  const html = combinedHtml({ summary, reports, heads, date: now, version: VERSION, css: stylesheet(args.style), style: args.style, toolVersions });
  const out = { md: path.join(runDir, 'report.md'), html: path.join(runDir, 'report.html'), pdf: null, todo: null, reports: reports.map((r) => r.folder) };
  fs.writeFileSync(out.md, md);
  fs.writeFileSync(out.html, html);
  const fix = writeFixPlan(runDir, { date: now, subject: summary.meta.subject || null });
  for (const w of fix.warnings || []) log(`tasks.json: ${w}`);
  if (fix.written) out.todo = fix.todo;
  else if (fix.errors?.length) log(`Fix plan not written, tasks.json has problems:\n  ${fix.errors.join('\n  ')}`);
  else log('tasks.json not found: no fix plan written.');
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
    const { dir, target, previous } = newRunFolder(args.newName);
    process.stdout.write(`${dir}\n`);
    process.stderr.write(`target folder: ${target}${readNotes(target) ? ' (has notes.md)' : ''}\nprevious run:  ${previous || 'none'}\n`);
    return;
  }
  if (!args.dir) { process.stderr.write(USAGE); process.exit(2); }
  try {
    const out = await combine(args);
    process.stdout.write(`combined: ${out.reports.join(', ')}\n\nreport.md:   ${out.md}\nreport.html: ${out.html}\nreport.pdf:  ${out.pdf || '(not written)'}\nfix plan:    ${out.todo || '(not written)'}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
