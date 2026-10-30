#!/usr/bin/env node
/**
 * security-audit — code mode scanner.
 *
 *   node scan.mjs [path] [--only deps,secrets,...] [--history [N]] [--offline] [--out DIR] [--json]
 *
 * Collects candidates; it does not decide. Claude triages every hit in context and writes the
 * report (see SKILL.md). Read-only: never edits, installs or runs project code.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RULES, FILE_RULES, rulesFor, scanText, redact } from './lib/patterns.mjs';
import { listFiles, readScannable, historyAddedLines, TEST_PATH } from './lib/files.mjs';
import { collectPackages, queryOsv } from './lib/deps.mjs';

export const VERSION = '1.0.1';
const GROUPS = ['deps', 'secrets', 'xss', 'injection', 'request', 'crypto', 'config', 'ci'];
const SEV = { high: 3, medium: 2, low: 1 };

const USAGE = `security-audit ${VERSION} — code mode
Usage: node scan.mjs [path] [options]

  --only a,b        Groups: ${GROUPS.join(' ')}
  --skip a,b        The inverse.
  --history [N]     Also scan the last N commits (default 1000) for secrets that were removed.
  --offline         No OSV lookup (dependency inventory only).
  --no-tests        Leave out hits in test/fixture/example/docs paths (default: kept, tagged).
  --max N           Hits printed per rule (default 6; findings.json has all).
  --out DIR         Where findings.json goes (default ~/Downloads/security-audit/<name>-<stamp>/).
  --json            Print findings.json to stdout instead of the summary.
`;

export function parseArgs(argv) {
  const a = { root: '.', only: null, skip: [], history: 0, offline: false, tests: true, max: 6, out: null, json: false };
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
    else if (v === '--json') a.json = true;
    else if (v.startsWith('--')) throw new Error(`Unknown option ${v}`);
    else a.root = v;
  }
  for (const g of [...(a.only || []), ...a.skip]) if (!GROUPS.includes(g)) throw new Error(`Unknown group "${g}". Groups: ${GROUPS.join(' ')}`);
  return a;
}

/** Where findings.json and report.md go: `--out` (a leading ~ is expanded) or ~/Downloads/security-audit/<name>-<stamp>/. */
export function resolveOutDir(out, root, { home = os.homedir(), now = stamp() } = {}) {
  if (!out) return path.join(home, 'Downloads', 'security-audit', `${path.basename(root)}-${now}`);
  return path.resolve(out.replace(/^~(?=$|[\\/])/, home));
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const log = (m) => process.stderr.write(`${m}\n`);

export async function run(args) {
  const root = path.resolve(args.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a folder: ${root}`);
  const on = (g) => (args.only ? args.only.includes(g) : true) && !args.skip.includes(g);
  const ruleById = Object.fromEntries([...RULES, ...FILE_RULES].map((r) => [r.id, r]));

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
    for (const h of scanText(rel, text, rules)) hits.push({ ...h, file: rel, inTest });
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
          for (const h of scanText(a.file, a.text, secretRules.filter((r) => r.langs === null || rulesFor(a.file).includes(r)))) {
            const key = `${h.id}|${h.text}`;
            if (current.has(key) || found.has(key)) continue;
            found.set(key, { id: h.id, file: a.file, commit: a.commit.slice(0, 10), date: a.date, line: a.line, text: h.text });
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

  // -------------------------------------------------------------- assemble
  const byRule = {};
  for (const h of hits) (byRule[h.id] ||= []).push(h);
  const rules = Object.entries(byRule)
    .map(([id, list]) => {
      const r = ruleById[id];
      return { id, group: r.group, severity: r.severity, title: r.title, review: r.review, fix: r.fix, count: list.length, inTest: list.filter((h) => h.inTest).length, hits: list };
    })
    .sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.count - a.count);

  return {
    tool: 'security-audit', mode: 'code', version: VERSION, root, git, startedAt: new Date().toISOString(),
    filesListed: all.length, filesScanned: scanned,
    groups: GROUPS.filter(on),
    deps, rules, history,
  };
}

export function summarise(r, max = 6) {
  const L = [];
  L.push(`security-audit ${r.version} — code mode — ${r.root}`);
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
      for (const p of d.vulnerable.slice(0, 15)) {
        const v = p.vulns[0];
        L.push(`  ${v.severity.padEnd(8)} ${p.ecosystem} ${p.name}@${p.version}${p.dev ? ' (dev)' : ''}  ${v.id}${p.vulns.length > 1 ? ` +${p.vulns.length - 1}` : ''}  ${v.summary.slice(0, 70)}${v.fixed.length ? `  → fixed ${v.fixed.join(', ')}` : ''}`);
      }
      if (d.vulnerable.length > 15) L.push(`  … ${d.vulnerable.length - 15} more in findings.json`);
    }
    L.push('');
  }
  const total = r.rules.reduce((n, x) => n + x.count, 0);
  L.push(`CODE HITS TO TRIAGE  ${total} hit(s) across ${r.rules.length} rule(s) — candidates, not findings`);
  for (const rule of r.rules) {
    L.push(`  [${rule.severity}] ${rule.id} — ${rule.title} (${rule.count}${rule.inTest ? `, ${rule.inTest} in test/docs paths` : ''})`);
    for (const h of rule.hits.slice(0, max)) L.push(`      ${h.file}${h.line ? `:${h.line}` : ''}${h.inTest ? ' [test]' : ''}  ${h.text.slice(0, 140)}`);
    if (rule.count > max) L.push(`      … ${rule.count - max} more`);
  }
  if (r.history) {
    L.push('');
    if (r.history.skipped) L.push(`HISTORY  SKIP: ${r.history.skipped}`);
    else {
      L.push(`HISTORY  last ${r.history.commits} commits: ${r.history.hits.length} secret hit(s) no longer in the working tree (still in git history)`);
      for (const h of r.history.hits.slice(0, 15)) L.push(`  ${h.id}  ${h.file}  ${h.commit} ${h.date}  ${h.text.slice(0, 100)}`);
    }
  }
  return L.join('\n');
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { log(e.message); log(USAGE); process.exit(2); }
  if (args.help) { process.stdout.write(USAGE); return; }
  const report = await run(args);
  const outDir = resolveOutDir(args.out, report.root);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'findings.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  if (args.json) process.stdout.write(JSON.stringify(report, null, 2));
  else process.stdout.write(`${summarise(report, args.max)}\n\nfindings: ${file}\nreport:   ${path.join(outDir, 'report.md')} (you write this)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { log(`security-audit failed: ${e.stack || e.message}`); process.exit(1); });
}

export { redact };
