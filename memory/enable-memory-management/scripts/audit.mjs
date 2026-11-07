#!/usr/bin/env node
/**
 * Measures a project's memory layers and writes report.md + report.json.
 *
 *   node audit.mjs [--root DIR] [--memory DIR] [--transcripts DIR|none] [--since YYYY-MM-DD]
 *                  [--exclude glob,glob] [--out DIR] [--state DIR] [--level …] [--console] [--report]
 *                  [--lint] [--no-baseline] [--budget-lines N] [--index-bytes N]
 *
 * Report only: it never changes the project or the memory store.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFiles, makeIgnored, instructionFiles, memoryCandidates, memoryFiles, skillFiles, transcriptsDir, lastChanged, readText } from './lib/discover.mjs';
import { makeContext, checkInstructions, checkDocs, checkMemory, readMemory, checkSkills, skillCandidates, DEFAULTS } from './lib/checks.mjs';
import { readSessions, summarise } from './lib/transcripts.mjs';
import { renderReport } from './lib/report.mjs';
import { parseLevel, consoleList, scratchDir, removeScratch } from './lib/levels.mjs';
import { targetDir, claimTarget, newRun } from './lib/target-state.mjs';

const SKILL = 'enable-memory-management';

const HELP = `enable-memory-management audit — measure a project's memory layers (report only)

  --root DIR            the project (default: the current folder)
  --memory DIR          the memory folder (default: Claude Code's auto memory for this project, if any)
  --transcripts DIR     session transcripts to count (default: Claude Code's for this project); "none" skips
  --since YYYY-MM-DD    only sessions that ran on or after this date
  --exclude a/,b/**     folders or globs to leave out (vendored copies, generated docs)
  --out DIR             write report.md and report.json here instead of a new run folder
  --state DIR           the target folder (default <reports>/${SKILL}/<project>/)
  --level LIST          error, warn, info, a comma list, or all (default)
  --console             print the list instead of writing report.md; --report writes both
  --lint                quick check for hooks and CI: errors and warnings only, no files, exit 1 on errors
  --no-baseline         do not compare with the last run
  --budget-lines N      lines the always-read layer should stay under (default ${DEFAULTS.budgetLines})
  --index-bytes N       hard limit for MEMORY.md (default ${DEFAULTS.indexBytes})
`;

export function parseArgs(argv) {
  const a = { root: process.cwd(), exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--root') a.root = next();
    else if (k === '--memory') a.memory = next();
    else if (k === '--transcripts') a.transcripts = next();
    else if (k === '--since') a.since = next();
    else if (k === '--exclude') a.exclude.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (k === '--out') a.out = next();
    else if (k === '--state') a.state = next();
    else if (k === '--level') a.level = next();
    else if (k === '--console') a.console = true;
    else if (k === '--report') a.report = true;
    else if (k === '--lint') a.lint = true;
    else if (k === '--no-baseline') a.noBaseline = true;
    else if (k === '--budget-lines') a.budgetLines = Number(next());
    else if (k === '--index-bytes') a.indexBytes = Number(next());
    else if (k === '--today') a.today = next();
    else if (!k.startsWith('-')) a.root = k;
    else throw new Error(`Unknown flag ${k} (see --help)`);
  }
  return a;
}

export function reportsRoot({ env = process.env, home = os.homedir() } = {}) {
  const expand = (p) => p.replace(/^~(?=$|[\\/])/, home);
  if (env.AUDIT_OUT_DIR) return path.resolve(expand(env.AUDIT_OUT_DIR));
  let xdg = env.XDG_DOWNLOAD_DIR;
  if (!xdg) {
    const m = String(readText(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'user-dirs.dirs')) || '').match(/^\s*XDG_DOWNLOAD_DIR\s*=\s*"?([^"\n]+)"?/m);
    xdg = m ? m[1].trim() : null;
  }
  const writable = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return fs.statSync(p).isDirectory(); } catch { return false; } };
  const candidates = [xdg && path.resolve(expand(xdg.replace(/^\$HOME(?=$|\/)/, home))), path.join(home, 'Downloads')].filter(Boolean);
  return candidates.find(writable) || path.join(home, 'audit-reports');
}

/** Runs every check and returns the result object (what report.json holds). */
export function audit(args) {
  const root = path.resolve(args.root);
  const opts = { ...DEFAULTS, ...(args.budgetLines ? { budgetLines: args.budgetLines } : {}), ...(args.indexBytes ? { indexBytes: args.indexBytes } : {}), ...(args.today ? { today: args.today } : {}) };
  const { files, git } = listFiles(root, { exclude: args.exclude });
  const instr = instructionFiles(root);
  const skills = skillFiles(root);
  const memoryDir = memoryCandidates(root, { explicit: args.memory })[0] || null;
  const memoryList = memoryDir ? memoryFiles(memoryDir) : [];
  const ctx = makeContext({ root, files, git, ignored: makeIgnored(root, git), lastChanged: lastChanged(root, git), instr, skills, memoryDir, memoryList, opts });

  const ins = checkInstructions(ctx);
  const mem = readMemory(ctx);
  const memory = checkMemory(ctx, mem);
  const docs = checkDocs(ctx, { memoryTexts: mem.map((m) => ({ name: m.name, text: m.text })) });
  const sk = checkSkills(ctx);

  let transcripts = null;
  if (args.transcripts !== 'none') {
    const dir = transcriptsDir(root, { explicit: args.transcripts });
    if (dir && fs.existsSync(dir)) {
      const sessions = readSessions(dir, { since: args.since || null });
      if (sessions.length) transcripts = { dir, ...summarise(sessions, { root, minSessions: Math.min(opts.minSessions, Math.max(2, sessions.length)) }) };
    }
  }
  const cand = skillCandidates(ctx, ins.summary, transcripts);

  const setup = [];
  const loadedText = instr.loaded.map((x) => readText(x.file) || '').join('\n') + (instr.agents ? readText(instr.agents.file) || '' : '');
  if (!/MEMORY\.md|^#{1,3}\s+Memory\b/m.test(loadedText)) setup.push({ level: 'info', source: 'setup', id: 'E3', title: 'The instructions say nothing about memory: where it is, what to save, how to write it', where: instr.loaded[0]?.rel || 'CLAUDE.md', fix: 'Step E3' });
  if (!skills.some((s) => s.name === 'memory-dream')) setup.push({ level: 'info', source: 'setup', id: 'E8', title: 'No dreaming: nothing reviews past sessions against the memory', where: '.claude/skills/', fix: 'Step E8' });

  const findings = [...ins.findings, ...memory.findings, ...docs.findings, ...sk.findings, ...cand.findings, ...setup];
  const byTop = {};
  for (const r of docs.summary.rows) { const t = r.path.includes('/') ? `${r.path.split('/')[0]}/` : '.'; byTop[t] = (byTop[t] || 0) + 1; }
  return {
    skill: SKILL,
    project: path.basename(root),
    root,
    date: new Date().toISOString(),
    opts,
    git,
    instructions: ins.summary,
    memory: memory.summary,
    docs: { ...docs.summary, byTop },
    skills: sk.summary,
    transcripts,
    candidates: cand.summary,
    findings,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const levels = args.lint ? parseLevel(args.level || 'error,warn') : parseLevel(args.level || 'all');
  const result = audit(args);
  const counts = { error: 0, warn: 0, info: 0 };
  for (const x of result.findings) counts[x.level]++;

  if (args.lint) {
    const items = result.findings.filter((x) => ['instructions', 'memory', 'skills'].includes(x.source) || x.id === 'D1');
    process.stdout.write(`${consoleList({ title: `${SKILL} lint ${result.project}`, items, levels })}\n`);
    process.exitCode = items.some((x) => x.level === 'error') ? 1 : 0;
    return;
  }

  const target = args.state ? path.resolve(args.state) : targetDir({ reports: reportsRoot(), skill: SKILL, name: result.project, owner: result.root });
  claimTarget(target, result.root);
  const last = path.join(target, 'last-report.json');
  if (!args.noBaseline && fs.existsSync(last)) {
    try {
      const prev = JSON.parse(fs.readFileSync(last, 'utf8'));
      const c = { error: 0, warn: 0, info: 0 };
      for (const x of prev.findings || []) c[x.level]++;
      result.since = { date: String(prev.date).slice(0, 10), ...c };
    } catch { /* unreadable baseline */ }
  }
  const scratch = args.console && !args.report && !args.out ? scratchDir(SKILL) : null;
  const out = args.out ? path.resolve(args.out) : scratch || newRun(target, { info: { skill: SKILL, root: result.root } });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(last, `${JSON.stringify(result, null, 2)}\n`);
  if (args.console) {
    process.stdout.write(`${consoleList({ title: `${SKILL} ${result.project}`, items: result.findings, levels })}\n`);
    if (!args.report && !args.out) { removeScratch(scratch); return; }
  }
  fs.writeFileSync(path.join(out, 'report.md'), `${renderReport(result, { levels })}\n`);
  process.stdout.write(`${JSON.stringify({ report: path.join(out, 'report.md'), json: path.join(out, 'report.json'), target, ...counts })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 2; }
}
