// Shared plumbing for this skill: the result shape, the report folder, Markdown and the task
// candidates audit-all copies into tasks.json. privacy-audit carries the same file; keep the two
// in step (the skills install separately, so neither imports the other).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { targetDir, claimTarget, newRun, markRun, findEarlier, readNotes } from './target-state.mjs';

export const STATUSES = ['pass', 'warn', 'fail', 'info', 'skip'];
export const GLYPH = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️', skip: '⏭️' };

/** One check row: { id, status, title, evidence, fix, blocker?, link?, subject?, data? }. */
export function result(id, status, title, evidence, extra = {}) {
  if (!STATUSES.includes(status)) throw new Error(`bad status "${status}" for ${id}`);
  return { id, status, title, evidence: String(evidence ?? ''), fix: '', ...extra };
}

export function countStatuses(results) {
  const c = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const r of results) c[r.status]++;
  return c;
}

// ---- Report folder: --out > $AUDIT_OUT_DIR > Downloads (XDG on Linux) if writable > ~/audit-reports

const expandHome = (p, home) => p.replace(/^~(?=$|[\\/])/, home);

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
 * Where this run goes and what it compares with (target-state.mjs layout):
 *   state    <reports>/<skill>/<host>/            target.txt, notes.md, last-report.json
 *   dir      <state>/runs/<YYYYMMDD-HHMM>/ or --out (audit-all passes its own run folder)
 *   baseline --baseline, else the state's last-report.json, else the newest earlier report.json for
 *            this host under <reports>/<skill> or <reports>/audit-all (runs from before target folders)
 */
export function prepareRun({ skill, host, out, baseline }, { home = os.homedir(), cwd = process.cwd(), now = new Date(), root } = {}) {
  const reports = root || reportsRoot({ home });
  const state = claimTarget(targetDir({ reports, skill, name: host, owner: host }), host);
  const dir = out ? markRun(path.resolve(cwd, expandHome(out, home)), { skill, target: host }) : newRun(state, { now, info: { skill, target: host } });
  let baselineFile = null;
  if (baseline) baselineFile = path.resolve(cwd, expandHome(baseline, home));
  else if (fs.existsSync(path.join(state, 'last-report.json'))) baselineFile = path.join(state, 'last-report.json');
  else baselineFile = findEarlier([path.join(reports, skill), path.join(reports, 'audit-all')], 'report.json', (j) => j?.tool === skill && j.target?.host === host, { exclude: dir })[0] || null;
  return { state, dir, baselineFile, notes: readNotes(state) };
}

/** Keep this run as the next run's baseline. */
export function finishRun(state, report) {
  fs.writeFileSync(path.join(state, 'last-report.json'), `${JSON.stringify(report)}\n`);
}

const BAD = new Set(['fail', 'warn']);
/** diffRows(prevRows, rows) -> { fixed, regressed, changed }, by check id (rows with a subject keyed by both). */
export function diffRows(prevRows = [], rows = []) {
  const key = (r) => `${r.id}|${r.subject || ''}`;
  const before = new Map(prevRows.map((r) => [key(r), r]));
  const fixed = []; const regressed = []; const changed = [];
  for (const r of rows) {
    const was = before.get(key(r))?.status || null;
    if (was === r.status || r.status === 'skip' || was === 'skip') continue;
    const row = { id: r.id, title: r.title, was, now: r.status };
    if (BAD.has(was) && !BAD.has(r.status)) fixed.push(row);
    else if (BAD.has(r.status) && (!BAD.has(was) || (was === 'warn' && r.status === 'fail'))) regressed.push(row);
    else if (BAD.has(was) && BAD.has(r.status)) changed.push(row);
  }
  const now = new Set(rows.map(key));
  for (const p of prevRows) if (BAD.has(p.status) && !now.has(key(p))) fixed.push({ id: p.id, title: p.title, was: p.status, now: null });
  return { fixed, regressed, changed };
}

/** "Notes" (the hand-written notes.md) and "Since last run" sections, when there is something to show. */
export function carryOverSections(report) {
  const out = [];
  if (report.notes) out.push('## Notes', '', report.notes.trim(), '');
  const d = report.diff;
  if (!d) return out;
  out.push('## Since last run', '', `Compared with \`${d.from}\`${d.date ? ` (${d.date.slice(0, 10)})` : ''}.`, '');
  if (d.error) { out.push(`Baseline not usable: ${d.error}`, ''); return out; }
  const list = (title, rows) => {
    if (!rows.length) return;
    out.push(`**${title}**`, '');
    for (const r of rows) out.push(`- ${r.title}: ${r.was || 'new'} → ${r.now || 'no longer checked'}`);
    out.push('');
  };
  list('Fixed', d.fixed);
  list('New or worse', d.regressed);
  list('Still open, status changed', d.changed);
  if (!d.fixed.length && !d.regressed.length && !d.changed.length) out.push('No check changed status.', '');
  return out;
}

// ---- Markdown

export function escapeCell(s, max = 300) {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t.replace(/\|/g, '\\|');
}

export const resultLine = (counts) => `**Result:** ${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail · ${counts.info} info · ${counts.skip} skipped`;

/** Sections as numbered H2s with one table each; `sections` is [{ id, title, prefixes }]. */
export function sectionTables(results, sections) {
  const out = [];
  sections.forEach((s, i) => {
    const rows = results.filter((r) => s.prefixes.includes(r.id.split('.')[0]));
    out.push(`## ${i + 1}. ${s.title}`, '');
    if (!rows.length) { out.push('_Not run._', ''); return; }
    out.push('| | Check | Finding | Fix |', '|---|---|---|---|');
    for (const r of rows) {
      const link = r.link ? ` [↗](${r.link})` : '';
      out.push(`| ${GLYPH[r.status]} | ${escapeCell(r.title)}${r.subject ? ` (${escapeCell(r.subject, 80)})` : ''} | ${escapeCell(r.evidence, 400)}${link} | ${escapeCell(r.fix)} |`);
    }
    out.push('');
  });
  return out;
}

export function fixFirst(results) {
  const bad = results.filter((r) => r.status === 'fail').sort((a, b) => Number(Boolean(b.blocker)) - Number(Boolean(a.blocker)));
  if (!bad.length) return [];
  const out = ['## Fix first', ''];
  for (const r of bad) out.push(`- ❌ **${r.title}**${r.subject ? ` (${r.subject})` : ''}${r.blocker ? ' · blocker' : ''} — ${r.evidence}${r.fix ? ` → ${r.fix}` : ''}`);
  out.push('');
  return out;
}

// ---- Task candidates in the tasks.json shape audit-all reads

export function severityOf(r) {
  if (r.status === 'fail') return r.blocker ? 'blocker' : 'high';
  if (r.status === 'warn') return r.severity || 'medium';
  return null;
}

/**
 * Every fail and warn as a tasks.json task. `owner` defaults to human (DNS, hosting and legal
 * settings live outside the repo); audit-all flips one to an agent task when a repo holds the setting.
 */
export function taskCandidates(results, { source, ref }) {
  return results.filter((r) => severityOf(r)).map((r, i) => ({
    id: `${source[0].toUpperCase()}${i + 1}`,
    title: r.task || r.title,
    severity: severityOf(r),
    owner: r.owner || 'human',
    sources: [source],
    area: r.id.split('.')[0],
    check: r.id,
    evidence: `${r.subject ? `${r.subject}: ` : ''}${r.evidence}`,
    fix: r.fix || 'See the report.',
    verify: `The ${r.id} check passes on the next ${source}-audit run.`,
    refs: [ref],
  }));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export const log = (m) => process.stderr.write(`${m}\n`);

/** fn with a deadline; resolves to `fallback(error)` instead of throwing. */
export async function settle(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms); })]);
  } catch (e) {
    return fallback(e);
  } finally {
    clearTimeout(timer);
  }
}

export function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
