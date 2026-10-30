// Shared plumbing for this skill: the result shape, the report folder, Markdown and the task
// candidates audit-all copies into tasks.json. privacy-audit carries the same file; keep the two
// in step (the skills install separately, so neither imports the other).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

export const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

/** `--out` (a leading ~ expanded), else <reportsRoot>/<skill>/<name>-<YYYYMMDD-HHMM>/. */
export function resolveOutDir(out, { skill, name, home = os.homedir(), now = new Date(), base, cwd = process.cwd() } = {}) {
  if (out) return path.resolve(cwd, expandHome(out, home));
  return path.join(base || reportsRoot({ home }), skill, `${String(name || 'site').replace(/[:/\\]/g, '-')}-${stamp(now)}`);
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
