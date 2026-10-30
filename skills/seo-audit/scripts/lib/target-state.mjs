/**
 * Where an audit keeps what carries over between runs, and where each run goes.
 *
 *   <reports>/<skill>/<target>/            the target folder: state that carries over
 *     target.txt                           what the folder belongs to (repo path or site origin)
 *     notes.md, last-*.json, …             hand-written notes, the last result to compare with
 *     runs/<YYYYMMDD-HHMM>/                one folder per run, marked with .audit-run
 *
 * <target> is the repo folder name or the site host, never a run folder's name, so the next run
 * finds the state whatever the last run folder was called. A run folder is never a state folder:
 * the `.audit-run` marker tells other skills (solution-health) not to keep state inside one.
 *
 * Skills install separately, so launch-audit, security-audit and audit-all each carry a copy of
 * this file. Keep the copies identical (the tests compare them).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RUN_MARKER = '.audit-run';
export const OWNER_FILE = 'target.txt';

export function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** A folder-safe name: host of a URL, or a repo folder name. */
export const targetName = (s) => String(s || 'target').replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/**
 * <reports>/<skill>/<name>/. When a folder of that name already belongs to another target (its
 * target.txt says so), a short hash of `owner` is appended, the same rule solution-health uses.
 */
export function targetDir({ reports, skill, name, owner = name }, { readFile = readText } = {}) {
  const base = path.join(reports, skill);
  const safe = targetName(name);
  const plain = path.join(base, safe);
  const current = readFile(path.join(plain, OWNER_FILE));
  if (current === null || current.trim() === String(owner)) return plain;
  return path.join(base, `${safe}-${crypto.createHash('sha256').update(String(owner)).digest('hex').slice(0, 8)}`);
}

/** Create the target folder and record its owner (once). */
export function claimTarget(dir, owner) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, OWNER_FILE);
  if (!fs.existsSync(f)) fs.writeFileSync(f, `${owner}\n`);
  return dir;
}

/** Mark a folder as a run folder (never a state folder). */
export function markRun(dir, info = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, RUN_MARKER);
  if (!fs.existsSync(f)) fs.writeFileSync(f, `${JSON.stringify({ ...info, startedAt: new Date().toISOString() })}\n`);
  return dir;
}

/** <target>/runs/<stamp>/, created and marked. A second run in the same minute gets -2, -3, … */
export function newRun(target, { now = new Date(), info = {} } = {}) {
  const runs = path.join(target, 'runs');
  let dir = path.join(runs, stamp(now));
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(runs, `${stamp(now)}-${i}`);
  return markRun(dir, info);
}

/** True when `dir` is a run folder or inside one. */
export function insideRun(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, RUN_MARKER))) return true;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}

/** Earlier runs of a target, newest first: <target>/runs/* folders. */
export function previousRuns(target, { exclude } = {}) {
  const runs = path.join(target, 'runs');
  let names = [];
  try { names = fs.readdirSync(runs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  return names.sort().reverse().map((n) => path.join(runs, n)).filter((d) => !exclude || path.resolve(d) !== path.resolve(exclude));
}

/**
 * Files called `file` under `roots` (at most `depth` folders down), newest first, that `accept`
 * says belong to this target. Used once, to pick up results from before target folders existed
 * (old timestamped folders, audit-all run folders), by content rather than by folder name.
 */
export function findEarlier(roots, file, accept, { depth = 4, exclude } = {}) {
  const found = [];
  const walk = (dir, left) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === file) found.push(full);
      else if (e.isDirectory() && left > 0 && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(full, left - 1);
    }
  };
  for (const r of roots) walk(r, depth);
  return found
    .filter((f) => !exclude || !path.resolve(f).startsWith(path.resolve(exclude) + path.sep))
    .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.f)
    .filter((f) => { try { return accept(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { return false; } });
}

/** notes.md in the target folder, or null. Hand-written; no script ever rewrites it. */
export function readNotes(target) {
  const t = readText(path.join(target, 'notes.md'));
  return t && t.trim() ? t : null;
}
