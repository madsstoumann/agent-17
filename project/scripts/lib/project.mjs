/** What a project looks like on disk: where the files are, which are written, generated or records. */
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, list } from './md.mjs';

export const SIZES = ['small', 'medium', 'large'];
export const STATUSES = ['draft', 'active', 'superseded'];
export const AUDIENCES = ['people', 'agents', 'people-and-agents'];
/** Size budgets in bytes. A file past its budget is split, not grown. */
export const BUDGET = { 'AGENTS.md': 4096, 'design': 16384, default: 8192 };

export const key = (file) => path.basename(file).replace(/\.md$/i, '').toLowerCase();

export function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.md$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** Every markdown file under project/, read once, sorted into what it is. */
export function load(root) {
  const base = path.join(root, 'project');
  const files = [];
  const changes = [];
  for (const p of walk(base)) {
    const rel = path.relative(root, p).split(path.sep).join('/');
    const text = fs.readFileSync(p, 'utf8');
    const fm = parseFrontmatter(text);
    const meta = fm.data.metadata ?? {};
    const entry = { path: p, rel, key: key(p), text, data: fm.data, meta, body: fm.body, hasHeader: fm.raw !== null };
    if (rel.startsWith('project/memory/changes/')) changes.push(entry);
    else if (rel.startsWith('project/memory/changelog/') || rel.startsWith('project/memory/reports/')) continue;
    else files.push(entry);
  }
  changes.sort((a, b) => String(a.meta.date).localeCompare(String(b.meta.date)) || a.key.localeCompare(b.key));
  return { base, files, changes, written: files.filter((f) => f.hasHeader && f.meta.generated !== 'true') };
}

/** `[design:minor, themes:new]` → [{ file: 'design', level: 'minor' }, …] */
export const bumps = (meta) => list(meta.bumps).map((b) => { const [file, level] = b.split(':').map((s) => s.trim()); return { file, level }; });

export const LEVELS = ['new', 'patch', 'minor', 'major', 'complete'];

/**
 * A file's version after one more change. Every file starts at 0.1.0. `complete` is the step to
 * 1.0.0 when a file's open questions are all answered; it does nothing to a file already there.
 */
export function bump(version, level) {
  let [a, b, c] = String(version).split('.').map(Number);
  if (level === 'new') return '0.1.0';
  if (level === 'complete') return a >= 1 ? `${a}.${b}.${c}` : '1.0.0';
  if (level === 'major') return a >= 1 ? `${a + 1}.0.0` : `0.${b + 1}.0`;
  if (level === 'minor') return a >= 1 ? `${a}.${b + 1}.0` : `0.${b + 1}.0`;
  if (level === 'patch') return `${a}.${b}.${c + 1}`;
  throw new Error(`unknown bump level: ${level}`);
}

export function args(argv, flags = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (flags[name] === 'bool') out[name] = true; else out[name] = argv[++i];
  }
  return out;
}
