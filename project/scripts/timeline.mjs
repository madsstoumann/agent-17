#!/usr/bin/env node
/**
 * A project's milestones: one table in project/foundation/timeline.md. Reads it (what is next, what
 * is overdue), adds a milestone, or changes one. A date that moves keeps its first date in the note,
 * so the file shows that it moved; the reason goes in the change record the skill writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { table, cell, setMeta } from './lib/md.mjs';
import { args } from './lib/project.mjs';
import { addFile } from './file.mjs';
import { build } from './build.mjs';

export const TIMELINE = 'project/foundation/timeline.md';
export const MILESTONE = ['planned', 'done', 'moved', 'dropped'];
const HEAD = '| Milestone | Date | Owner | Status | Note |\n|---|---|---|---|---|';
const USAGE = `Usage: timeline.mjs --root DIR [--today YYYY-MM-DD]
       timeline.mjs --root DIR --add "Name" --date YYYY-MM-DD --owner ROLE [--note TEXT]
       timeline.mjs --root DIR --set "Name" [--date YYYY-MM-DD] [--status ${MILESTONE.join('|')}] [--note TEXT]`;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && !Number.isNaN(Date.parse(d));
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const one = (s, what) => { if (!s || /[\n|{}"\\]/.test(s)) throw new Error(`${what} is required, on one line, without quotes, braces or bars`); return s.trim(); };
const iso = () => new Date().toISOString().slice(0, 10);

export function timeline(root, { today = iso() } = {}) {
  const p = path.join(root, TIMELINE);
  if (!fs.existsSync(p)) return { root, exists: false, file: TIMELINE, milestones: [], next: null, overdue: [], problems: [] };
  const rows = table(fs.readFileSync(p, 'utf8'), 'Milestones').map((r) => ({ name: r.Milestone, date: r.Date, owner: r.Owner, status: r.Status, note: r.Note }));
  const problems = [];
  const seen = new Set();
  for (const m of rows) {
    if (!isDate(m.date)) problems.push(`"${m.name}": date "${m.date}" is not YYYY-MM-DD`);
    if (!MILESTONE.includes(m.status)) problems.push(`"${m.name}": status "${m.status}" is not one of ${MILESTONE.join(', ')}`);
    if (seen.has(m.name.toLowerCase())) problems.push(`"${m.name}" is listed twice`);
    seen.add(m.name.toLowerCase());
  }
  const live = rows.filter((m) => (m.status === 'planned' || m.status === 'moved') && isDate(m.date)).sort((a, b) => a.date.localeCompare(b.date));
  const withDays = (m) => ({ ...m, days: days(today, m.date) });
  return { root, exists: true, file: TIMELINE, today, milestones: rows, next: live.filter((m) => m.date >= today).map(withDays)[0] ?? null, overdue: live.filter((m) => m.date < today).map(withDays), problems };
}

const line = (m) => `| ${[m.name, m.date, m.owner, m.status, m.note ?? ''].map(cell).join(' | ')} |`;

function write(root, rows, date) {
  const p = path.join(root, TIMELINE);
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n');
  const h = lines.findIndex((l) => l.trim() === '## Milestones');
  if (h < 0) throw new Error(`${TIMELINE} has no "## Milestones" section`);
  let end = h + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  lines.splice(h + 1, end - h - 1, '', HEAD, ...sorted.map(line), '');
  fs.writeFileSync(p, setMeta(lines.join('\n'), 'updated', date));
}

/** Adds a milestone. The first one creates the file, as a child of product-context. */
export function addMilestone(root, { name, date, owner, note = '', today = iso() }) {
  name = one(name, '--add');
  if (!isDate(date)) throw new Error('--date is YYYY-MM-DD');
  if (!/^[a-z0-9-]+$/.test(owner ?? '')) throw new Error('--owner is one role, as a word (pm, designer, tech-lead)');
  if (note) one(note, '--note');
  let created = false;
  if (!fs.existsSync(path.join(root, TIMELINE))) {
    addFile(root, { path: TIMELINE, description: 'Milestones, their dates and who owns each', owner: 'pm', parent: 'product-context', date: today });
    fs.appendFileSync(path.join(root, TIMELINE), `\n## Milestones\n\n${HEAD}\n`);
    created = true;
  }
  const t = timeline(root, { today });
  if (t.milestones.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" is already a milestone: change it with --set`);
  write(root, [...t.milestones, { name, date, owner, status: 'planned', note }], today);
  build(root);
  return { milestone: name, date, owner, created, bump: created ? 'timeline:new' : 'timeline:minor' };
}

/** Changes a milestone. A new date marks it `moved` and keeps the first date in the note. */
export function setMilestone(root, name, { date, status, note, today = iso() } = {}) {
  const t = timeline(root, { today });
  if (!t.exists) throw new Error(`no ${TIMELINE}: add the first milestone with --add`);
  const m = t.milestones.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!m) throw new Error(`no milestone "${name}" (${t.milestones.map((x) => x.name).join(', ')})`);
  if (date && !isDate(date)) throw new Error('--date is YYYY-MM-DD');
  if (status && !MILESTONE.includes(status)) throw new Error(`--status is one of ${MILESTONE.join(', ')}`);
  if (!date && !status && note === undefined) throw new Error('nothing to change: pass --date, --status or --note');
  const from = { date: m.date, status: m.status };
  if (note !== undefined) m.note = note ? one(note, '--note') : '';
  if (date && date !== m.date) {
    if (!/\bwas \d{4}-\d{2}-\d{2}/.test(m.note ?? '')) m.note = [m.note, `was ${m.date}`].filter(Boolean).join('; ');
    m.date = date;
    if (!status && m.status === 'planned') m.status = 'moved';
  }
  if (status) m.status = status;
  write(root, t.milestones, today);
  build(root);
  return { milestone: m.name, from, to: { date: m.date, status: m.status }, moved: from.date !== m.date, bump: 'timeline:minor' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try {
    const root = path.resolve(a.root);
    const r = a.add ? addMilestone(root, { name: a.add, date: a.date, owner: a.owner, note: a.note, today: a.today })
      : a.set ? setMilestone(root, a.set, { date: a.date, status: a.status, note: a.note, today: a.today })
      : timeline(root, { today: a.today });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.problems?.length ? 1 : 0);
  } catch (e) { console.error(e.message); process.exit(2); }
}
