#!/usr/bin/env node
/**
 * audit-security — code mode scanner, and site mode for a live URL.
 *
 *   node scan.mjs [path] [--only deps,secrets,...] [--history [N]] [--offline] [--out DIR] [--json]
 *   node scan.mjs <https://url> [--only headers,redirects,exposed,blocklists] [--out DIR] [--header "Name: value"]
 *
 * Collects candidates; it does not decide. Claude triages every hit in context and writes the
 * report (see SKILL.md). Read-only: never edits, installs or runs project code.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execFileSync } from 'node:child_process';

import { RULES, FILE_RULES, PLATFORM_FILES, platformFor, rulesFor, scanText, redact } from './lib/patterns.mjs';
import { listFiles, readScannable, historyAddedLines, TEST_PATH } from './lib/files.mjs';
import { collectPackages, queryOsv } from './lib/deps.mjs';
import { targetDir, claimTarget, newRun, markRun, findEarlier, readNotes } from './lib/target-state.mjs';
import { annotate, baselineLines, tag } from './lib/baseline.mjs';
import { parseLevel, levelOfWord, scratchDir, consoleList } from './lib/levels.mjs';
import { SITE_GROUPS, siteUrl, runSite, renderSiteMarkdown, diffRows, consoleItems } from './lib/site.mjs';

export const VERSION = '2.5.1';
const GROUPS = ['deps', 'secrets', 'xss', 'injection', 'request', 'crypto', 'config', 'ci'];
const SEV = { high: 3, medium: 2, low: 1 };

const USAGE = `audit-security ${VERSION}
Usage: node scan.mjs [path] [options]       code mode: a repo or folder
       node scan.mjs <url> [options]        site mode: the live site, passive checks only

  --only a,b        Groups: ${GROUPS.join(' ')}
  --skip a,b        The inverse.
  --history [N]     Also scan the last N commits (default 1000) for secrets that were removed.
  --offline         No OSV lookup (dependency inventory only).
  --no-tests        Leave out hits in test/fixture/example/docs paths (default: kept, tagged).
  --max N           Hits printed per rule (default 6; findings.json has all).
  --out DIR         Where findings.json goes (default <target>/runs/<stamp>/).
  --baseline FILE   Compare with this findings.json (or a folder holding one). Default: the last scan
                    of this repo (<target>/last-findings.json). Prints new, still open and fixed.
  --no-baseline     Do not compare with the last scan (the scan is still recorded as the new baseline).
  --state DIR       Target folder (default <reports>/audit-security/<repo folder name>/, where <reports> is
                    $AUDIT_OUT_DIR, else Downloads, else ~/audit-reports). It keeps triage.json, notes.md
                    and last-findings.json between runs.
  --visibility V    public, private or internal: the repo's visibility, when gh cannot tell
                    (it sets the severity of platform credential files such as umbraco-cloud.json).
  --level LIST      Which candidates the summary lists, and what you put in report.md: error (high, critical),
                    warn (medium, moderate, low), info, a comma list (error,warn), or all (default).
                    findings.json and last-findings.json always keep every hit.
  --console         No report.md: after triage, print the compact list of confirmed issues instead.
                    findings.json goes to a scratch folder in the system temp folder. Add --report for both.
  --json            Print findings.json to stdout instead of the summary.

Site mode (a URL instead of a path, or --url URL):
  --only / --skip   Groups: ${SITE_GROUPS.join(' ')}. headers, redirects and exposed are audit-launch's
                    checks (it must be installed next to this skill); blocklists are OpenPhish, plus
                    Google Safe Browsing, URLhaus and VirusTotal when GOOGLE_SAFE_BROWSING_KEY,
                    URLHAUS_AUTH_KEY or VIRUSTOTAL_API_KEY is set.
  --header "N: v"   Send this header to the site (a WAF bypass rule), repeatable.
  --insecure        Accept a self-signed certificate (local and staging hosts).
  --offline         No blocklist lookups.
  --out, --state, --baseline, --no-baseline, --level, --console, --report, --json as above;
                    the site's target folder is <reports>/audit-security/<host>/ and the scanner
                    writes report.json and report.md itself (no triage step).
`;

export function parseArgs(argv) {
  const a = { root: '.', only: null, skip: [], history: 0, offline: false, tests: true, max: 6, out: null, json: false, baseline: null, noBaseline: false, state: null, visibility: null, levels: parseLevel('all'), console: false, report: false, headers: {}, insecure: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => argv[++i];
    if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--only') a.only = next().split(',');
    else if (v === '--skip') a.skip = next().split(',');
    else if (v === '--history') a.history = /^\d+$/.test(argv[i + 1] || '') ? Number(next()) : 1000;
    else if (v === '--offline') a.offline = true;
    else if (v === '--no-tests') a.tests = false;
    else if (v === '--max') a.max = Number(next());
    else if (v === '--out') a.out = next();
    else if (v === '--baseline') a.baseline = next();
    else if (v === '--no-baseline') a.noBaseline = true;
    else if (v === '--state') a.state = next();
    else if (v === '--visibility') a.visibility = next();
    else if (v === '--json') a.json = true;
    else if (v === '--level') a.levels = parseLevel(next());
    else if (v === '--console') a.console = true;
    else if (v === '--report') a.report = true;
    else if (v === '--url') a.root = next();
    else if (v === '--insecure') a.insecure = true;
    else if (v === '--header') {
      const h = String(next() || '');
      const i = h.indexOf(':');
      if (i < 1) throw new Error(`--header needs "Name: value", got "${h}"`);
      a.headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
    } else if (v.startsWith('--')) throw new Error(`Unknown option ${v}`);
    else a.root = v;
  }
  if (a.visibility && !VISIBILITY.includes(a.visibility)) throw new Error(`--visibility must be one of ${VISIBILITY.join(', ')}`);
  a.mode = siteUrl(a.root) ? 'site' : 'code';
  if (a.mode === 'code' && /^[a-z][a-z0-9+.-]*:\/\//i.test(a.root)) throw new Error(`Site mode takes an http or https URL, not ${a.root}`);
  const groups = a.mode === 'site' ? SITE_GROUPS : GROUPS;
  for (const g of [...(a.only || []), ...a.skip]) if (!groups.includes(g)) throw new Error(`Unknown group "${g}". Groups: ${groups.join(' ')}`);
  return a;
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

const expandHome = (p, home) => p.replace(/^~(?=$|[\\/])/, home);

/** The repo's target folder: `--state`, else <reportsRoot>/audit-security/<repo folder name>/ (hash suffix if the name is taken). */
export function resolveStateDir(state, root, { home = os.homedir(), base } = {}) {
  if (state) return path.resolve(expandHome(state, home));
  return targetDir({ reports: base || reportsRoot({ home }), skill: 'audit-security', name: path.basename(root), owner: root });
}

/** Where findings.json and report.md go: `--out` (a leading ~ is expanded), else null (a new <target>/runs/<stamp>/). */
export function resolveOutDir(out, { home = os.homedir() } = {}) {
  return out ? path.resolve(expandHome(out, home)) : null;
}

/**
 * The findings.json to compare with: --baseline (a file or a folder with findings.json), else the
 * target's last-findings.json, else (first run after upgrading) the newest earlier findings.json for
 * this repo under <reports>/audit-security/ or <reports>/audit-all/, found by its `root`.
 */
export function resolveBaseline(args, root, stateDir, { base, exclude } = {}) {
  if (args.noBaseline) return null;
  if (args.baseline) {
    const f = path.resolve(expandHome(args.baseline, os.homedir()));
    return fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'findings.json') : f;
  }
  const last = path.join(stateDir, 'last-findings.json');
  if (fs.existsSync(last)) return last;
  const reports = base || reportsRoot();
  const roots = [path.join(reports, 'audit-security'), path.join(reports, 'audit-all')];
  return findEarlier(roots, 'findings.json', (j) => j?.tool === 'audit-security' && j.root === root, { exclude })[0] || null;
}
const log = (m) => process.stderr.write(`${m}\n`);

const VISIBILITY = ['public', 'private', 'internal'];

/**
 * The repo's visibility on GitHub, via `gh repo view` (needs gh installed and signed in, and a
 * GitHub remote). { visibility: public|private|internal|unknown, repo?, via, reason? }.
 */
export function repoVisibility(root, { given = null, exec = execFileSync } = {}) {
  if (given) return { visibility: given, via: '--visibility' };
  try {
    const out = exec('gh', ['repo', 'view', '--json', 'visibility,nameWithOwner'], { cwd: root, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    const j = JSON.parse(out);
    const v = String(j.visibility || '').toLowerCase();
    if (VISIBILITY.includes(v)) return { visibility: v, repo: j.nameWithOwner || null, via: 'gh repo view' };
    return { visibility: 'unknown', via: 'gh repo view', reason: `unexpected answer: ${out.trim().slice(0, 80)}` };
  } catch (e) {
    const why = e.code === 'ENOENT' ? 'gh is not installed' : String(e.stderr || e.message || '').trim().split('\n')[0].slice(0, 120) || 'gh repo view failed';
    return { visibility: 'unknown', via: 'gh repo view', reason: why };
  }
}

/** Severity of a platform credential file by repo visibility. */
export const platformSeverity = (visibility) => (visibility === 'public' ? 'high' : visibility === 'unknown' ? 'medium' : 'low');

export async function run(args) {
  const root = path.resolve(args.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a folder: ${root}`);
  const on = (g) => (args.only ? args.only.includes(g) : true) && !args.skip.includes(g);
  const ruleById = Object.fromEntries([...RULES, ...FILE_RULES, ...PLATFORM_FILES].map((r) => [r.id, r]));

  const { git, all, tracked } = listFiles(root);
  log(`files: ${all.length} (${git ? 'git: tracked + untracked, .gitignore respected' : 'not a git repo: folder walk'})`);

  // -------------------------------------------------------------- code + file rules
  const hits = [];
  let scanned = 0;
  for (const rel of all) {
    const inTest = TEST_PATH.test(rel);
    if (inTest && !args.tests) continue;
    for (const fr of FILE_RULES) {
      if (!on(fr.group) || !fr.test(rel)) continue;
      // Outside git we cannot tell committed from local: report, but say so.
      if (git && !tracked.has(rel)) continue;
      hits.push({ id: fr.id, file: rel, line: 0, text: git ? 'tracked in git' : 'present (not a git repo: check it is not deployed or committed)', inTest });
    }
    const rules = rulesFor(rel).filter((r) => on(r.group));
    if (!rules.length) continue;
    const text = readScannable(root, rel);
    if (text == null) continue;
    scanned++;
    const plat = platformFor(rel);
    for (const h of scanText(rel, text, rules)) {
      // A secret in a platform file (umbraco-cloud.json) is reported under the platform rule, keeping the rule that matched it.
      if (plat && h.id.startsWith('secrets.')) hits.push({ ...h, id: plat.id, matchedBy: h.id, file: rel, inTest });
      else hits.push({ ...h, file: rel, inTest });
    }
  }
  log(`scanned: ${scanned} text files, ${hits.length} hits`);

  // -------------------------------------------------------------- history (secrets that were committed and later removed)
  let history = null;
  if (args.history && on('secrets')) {
    if (!git) history = { skipped: 'not a git repo' };
    else {
      const added = historyAddedLines(root, args.history);
      if (!added) history = { skipped: 'git log failed' };
      else {
        const secretRules = RULES.filter((r) => r.secret && r.id !== 'secrets.generic');
        const current = new Set(hits.filter((h) => h.id.startsWith('secrets.')).map((h) => `${h.id}|${h.text}`));
        const found = new Map();
        for (const a of added) {
          if (platformFor(a.file)) continue; // the platform rotates these itself; the platform rule covers the file
          for (const h of scanText(a.file, a.text, secretRules.filter((r) => r.langs === null || rulesFor(a.file).includes(r)))) {
            const key = `${h.id}|${h.text}`;
            if (current.has(key) || found.has(key)) continue;
            found.set(key, { id: h.id, file: a.file, commit: a.commit.slice(0, 10), date: a.date, line: a.line, text: h.text, match: h.match });
          }
        }
        history = { commits: args.history, lines: added.length, hits: [...found.values()] };
        log(`history: ${added.length} added lines, ${history.hits.length} secret hits not in the working tree`);
      }
    }
  }

  // -------------------------------------------------------------- dependencies
  let deps = null;
  if (on('deps')) {
    const { sources, packages } = collectPackages(root, all);
    deps = { sources, packages: packages.length, ecosystems: [...new Set(packages.map((p) => p.ecosystem))] };
    if (!packages.length) deps.skipped = 'no lockfile or pinned manifest found';
    else if (args.offline) deps.skipped = '--offline';
    else {
      try { Object.assign(deps, await queryOsv(packages, { log })); }
      catch (e) { deps.skipped = `OSV lookup failed: ${e.message}`; }
    }
  }

  // -------------------------------------------------------------- platform credential files: severity by repo visibility
  let repo = null;
  const platformHit = hits.some((h) => ruleById[h.id]?.platform);
  if (platformHit || args.visibility) {
    repo = git || args.visibility ? repoVisibility(root, { given: args.visibility, exec: args.exec }) : { visibility: 'unknown', reason: 'not a git repo' };
    if (platformHit) log(`repo visibility: ${repo.visibility}${repo.repo ? ` (${repo.repo})` : ''}${repo.reason ? ` — ${repo.reason}` : ''}`);
  }

  // -------------------------------------------------------------- assemble
  const byRule = {};
  for (const h of hits) (byRule[h.id] ||= []).push(h);
  const rules = Object.entries(byRule)
    .map(([id, list]) => {
      const r = ruleById[id];
      const plat = r.platform ? { platform: r.platform, owner: r.owner, visibility: repo?.visibility || 'unknown' } : {};
      return { id, group: r.group, severity: r.platform ? platformSeverity(plat.visibility) : r.severity, title: r.title, review: r.review, fix: r.fix, ...plat, count: list.length, inTest: list.filter((h) => h.inTest).length, hits: list };
    })
    .sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.count - a.count);

  return {
    tool: 'audit-security', mode: 'code', version: VERSION, root, git, startedAt: new Date().toISOString(),
    filesListed: all.length, filesScanned: scanned,
    groups: GROUPS.filter(on),
    ...(repo ? { repo } : {}),
    deps, rules, history,
  };
}

export function summarise(r, max = 6, levels = null) {
  const L = [];
  // --level: list only the candidates at the chosen levels; findings.json keeps every hit.
  const show = (sev) => !levels || levels.all || Boolean(levels[levelOfWord(sev) || 'info']);
  L.push(`audit-security ${r.version} — code mode — ${r.root}`);
  if (levels && !levels.all) L.push(`Showing ${levels.label} (--level ${levels.words}); findings.json has every hit`);
  L.push(`${r.filesScanned} text files scanned of ${r.filesListed} listed (${r.git ? 'git' : 'folder walk'}); groups: ${r.groups.join(' ')}`);
  L.push('');
  if (r.deps) {
    const d = r.deps;
    L.push(`DEPENDENCIES  ${d.sources.length} lockfile(s), ${d.packages} unique packages${d.ecosystems.length ? ` (${d.ecosystems.join(', ')})` : ''}`);
    for (const s of d.sources.filter((s) => s.error)) L.push(`  could not parse ${s.file}: ${s.error}`);
    if (d.skipped) L.push(`  SKIP: ${d.skipped}`);
    else {
      const counts = {};
      for (const p of d.vulnerable) for (const v of p.vulns) counts[v.severity] = (counts[v.severity] || 0) + 1;
      L.push(`  ${d.vulnerable.length} vulnerable package version(s); advisories: ${Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'none'}`);
      const vulnerable = d.vulnerable.filter((p) => show(p.vulns[0]?.severity));
      for (const p of vulnerable.slice(0, 15)) {
        const v = p.vulns[0];
        L.push(`  ${v.severity.padEnd(8)} ${p.ecosystem} ${p.name}@${p.version}${p.dev ? ' (dev)' : ''}  ${v.id}${p.vulns.length > 1 ? ` +${p.vulns.length - 1}` : ''}  ${v.summary.slice(0, 70)}${v.fixed.length ? `  → fixed ${v.fixed.join(', ')}` : ''}${tag(v)}  #${v.fp || ''}`);
      }
      if (vulnerable.length > 15) L.push(`  … ${vulnerable.length - 15} more in findings.json`);
    }
    L.push('');
  }
  const total = r.rules.reduce((n, x) => n + x.count, 0);
  L.push(`CODE HITS TO TRIAGE  ${total} hit(s) across ${r.rules.length} rule(s) — candidates, not findings`);
  for (const rule of r.rules.filter((x) => show(x.severity))) {
    L.push(`  [${rule.severity}] ${rule.id} — ${rule.title} (${rule.count}${rule.inTest ? `, ${rule.inTest} in test/docs paths` : ''})`);
    if (rule.platform) L.push(`      platform file, owner ${rule.owner}: repo is ${rule.visibility}${r.repo?.repo ? ` (${r.repo.repo})` : ''}${r.repo?.reason ? ` — ${r.repo.reason}; pass --visibility` : ''}. ${rule.visibility === 'public' ? 'Public: blocker, rotate in the Umbraco Cloud portal.' : rule.visibility === 'unknown' ? 'Check the visibility before calling it accepted.' : 'Review, not a blocker: accept in triage.json.'}`);
    for (const h of rule.hits.slice(0, max)) L.push(`      ${h.file}${h.line ? `:${h.line}` : ''}${h.inTest ? ' [test]' : ''}${tag(h)}  ${h.text.slice(0, 140)}  #${h.fp || ''}`);
    if (rule.count > max) L.push(`      … ${rule.count - max} more`);
  }
  if (r.baseline) { L.push(''); L.push(...baselineLines(r.baseline)); }
  if (r.history) {
    L.push('');
    if (r.history.skipped) L.push(`HISTORY  SKIP: ${r.history.skipped}`);
    else {
      L.push(`HISTORY  last ${r.history.commits} commits: ${r.history.hits.length} secret hit(s) no longer in the working tree (still in git history)`);
      for (const h of r.history.hits.slice(0, 15)) L.push(`  ${h.id}  ${h.file}  ${h.commit} ${h.date}${tag(h)}  ${h.text.slice(0, 100)}  #${h.fp || ''}`);
    }
  }
  return L.join('\n');
}

/** The site's target folder: `--state`, else <reportsRoot>/audit-security/<host>/. */
export function resolveSiteStateDir(state, url, { home = os.homedir(), base } = {}) {
  if (state) return path.resolve(expandHome(state, home));
  const u = new URL(url);
  return targetDir({ reports: base || reportsRoot({ home }), skill: 'audit-security', name: u.host, owner: u.origin });
}

/** The site report to compare with: --baseline (a report.json or its folder), else the last site scan of this host. */
export function resolveSiteBaseline(args, stateDir) {
  if (args.noBaseline) return null;
  if (args.baseline) {
    const f = path.resolve(expandHome(args.baseline, os.homedir()));
    return fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'report.json') : f;
  }
  const last = path.join(stateDir, 'last-report.json');
  return fs.existsSync(last) ? last : null;
}

async function siteMain(args) {
  const url = siteUrl(args.root);
  const origin = new URL(url).origin;
  const stateDir = claimTarget(resolveSiteStateDir(args.state, url), origin);
  const scratch = args.console && !args.report && !args.out ? scratchDir('audit-security') : null;
  const outDir = scratch || resolveOutDir(args.out) || newRun(stateDir, { info: { skill: 'audit-security', target: origin } });
  fs.mkdirSync(outDir, { recursive: true });
  markRun(outDir, { skill: 'audit-security', target: origin });
  const report = await runSite(args, { version: VERSION, outDir, stateDir, log });
  const baseFile = resolveSiteBaseline(args, stateDir);
  if (baseFile) {
    try {
      const prev = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
      if (prev?.tool === 'audit-security' && prev.mode === 'site') report.diff = { ...diffRows(prev, report), from: baseFile };
    } catch (e) { log(`baseline not usable (${baseFile}): ${e.message}`); }
  }
  const notes = readNotes(stateDir);
  report.state = { dir: stateDir, notes: notes ? path.join(stateDir, 'notes.md') : null };
  const md = renderSiteMarkdown(report, { levels: args.levels });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (!scratch) fs.writeFileSync(path.join(outDir, 'report.md'), md);
  fs.writeFileSync(path.join(stateDir, 'last-report.json'), JSON.stringify(report, null, 2));
  if (args.json) { process.stdout.write(JSON.stringify(report, null, 2)); return; }
  if (args.console) { process.stdout.write(`${consoleList({ title: `audit-security site ${report.site.host}`, items: consoleItems(report), levels: args.levels })}${scratch ? '' : `\nReport: ${path.join(outDir, 'report.md')}`}\nState: ${stateDir}\n`); return; }
  const c = report.counts;
  const act = report.results.filter((r) => r.status === 'fail' || r.status === 'warn').sort((a, b) => (a.status === 'fail' ? -1 : 0) - (b.status === 'fail' ? -1 : 0));
  process.stdout.write(`audit-security ${VERSION} — site mode — ${report.site.finalUrl}
${c.pass} pass · ${c.warn} warn · ${c.fail} fail · ${c.info} info · ${c.skip} skipped
${act.map((r) => `  ${r.status.toUpperCase().padEnd(4)} ${r.id}  ${r.title} — ${String(r.evidence).slice(0, 140)}`).join('\n')}${report.diff ? `\nSince last run: ${report.diff.new.length} new, ${report.diff.worse.length} worse, ${report.diff.fixed.length} fixed${report.diff.merged?.length ? `, ${report.diff.merged.length} merged into another row` : ''}` : ''}

report:   ${path.join(outDir, 'report.md')} (written by the scanner; add a **Verdict:** line under the title)
state:    ${stateDir}${notes ? `\nnotes:    ${report.state.notes} (read it before presenting)` : ''}
`);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { log(e.message); log(USAGE); process.exit(2); }
  if (args.help) { process.stdout.write(USAGE); return; }
  if (args.mode === 'site') { await siteMain(args); return; }
  const report = await run(args);
  const stateDir = claimTarget(resolveStateDir(args.state, report.root), report.root);
  // --console alone (no --report, no --out): findings.json goes to a scratch folder in the temp folder (kept for triage).
  const scratch = args.console && !args.report && !args.out ? scratchDir('audit-security') : null;
  const outDir = scratch || resolveOutDir(args.out) || newRun(stateDir, { info: { skill: 'audit-security', target: report.root } });
  markRun(outDir, { skill: 'audit-security', target: report.root });
  const baseFile = resolveBaseline(args, report.root, stateDir, { exclude: outDir });
  let baseline = null;
  if (baseFile) {
    try { baseline = JSON.parse(fs.readFileSync(baseFile, 'utf8')); } catch (e) { log(`baseline not usable (${baseFile}): ${e.message}`); }
  }
  let triage = null;
  try { triage = JSON.parse(fs.readFileSync(path.join(stateDir, 'triage.json'), 'utf8')); } catch { /* none yet */ }
  annotate(report, { baseline, triage, from: baseline ? baseFile : null });
  report.state = { dir: stateDir, triage: path.join(stateDir, 'triage.json'), notes: readNotes(stateDir) ? path.join(stateDir, 'notes.md') : null };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'findings.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(stateDir, 'last-findings.json'), JSON.stringify(report, null, 2));
  if (args.json) process.stdout.write(JSON.stringify(report, null, 2));
  else process.stdout.write(`${summarise(report, args.max, args.levels)}\n\nfindings: ${file}\nreport:   ${scratch ? 'none (--console): after triage, print the compact list of confirmed issues (SKILL.md)' : `${path.join(outDir, 'report.md')} (you write this${args.levels.all ? '' : `; ${args.levels.label}`})`}\nstate:    ${stateDir}\ntriage:   ${report.state.triage} (you update this after triage)${report.state.notes ? `\nnotes:    ${report.state.notes} (read it before triage)` : ''}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { log(`audit-security failed: ${e.stack || e.message}`); process.exit(1); });
}

export { redact };
