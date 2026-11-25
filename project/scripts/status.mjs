#!/usr/bin/env node
/**
 * Where a project stands, from its files alone: the phase, what the interview still owes per role,
 * what is waiting on a decision, what is going stale, and where the files and the repo disagree.
 * Reads only; `--phase` is the one thing it writes, into state.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMeta, list, table } from './lib/md.mjs';
import { load, args } from './lib/project.mjs';
import { check } from './check.mjs';
import { sizes } from './file.mjs';

export const PHASES = ['context', 'planning', 'design', 'dev', 'qa', 'release'];
const USAGE = `Usage: status.mjs --root DIR [--today YYYY-MM-DD] [--stale-days N] [--console]
       status.mjs --root DIR --phase ${PHASES.join('|')}`;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Paths a project file names in backticks that are not in the repo: the commonest way a file goes wrong unnoticed. */
function missingPaths(root, files) {
  const out = [];
  for (const f of files) {
    const seen = new Set();
    for (const m of f.text.matchAll(/`([^`\s]+)`/g)) {
      const p = m[1].replace(/[.,;:]+$/, '');
      if (seen.has(p) || !/\//.test(p) || /^(https?:|@|\/|~|\.\.)/.test(p) || /[*<>{}$|()=]/.test(p) || !/\.[a-z0-9]{1,5}$|\/$/i.test(p)) continue;
      seen.add(p);
      const here = [path.join(root, p), path.join(root, 'project', p), path.join(path.dirname(f.path), p)];
      if (!here.some((x) => fs.existsSync(x))) out.push({ file: f.rel, path: p });
    }
  }
  return out;
}

export function status(root, { today = new Date().toISOString().slice(0, 10), staleDays = 90 } = {}) {
  const c = check(root, { today });
  if (!fs.existsSync(path.join(root, 'project', 'memory', 'state.md'))) return { root, setUp: false, check: c };
  const { files, written, changes } = load(root);
  const st = files.find((f) => f.rel === 'project/memory/state.md');
  const questions = table(st.body, 'Questions');
  const note = (q) => ({ id: q.id, role: q.role, file: q.file, question: q.question, note: q.note });
  const agents = path.join(root, 'AGENTS.md');
  const scan = [...written, ...(fs.existsSync(agents) ? [{ rel: 'AGENTS.md', path: agents, text: fs.readFileSync(agents, 'utf8') }] : [])];
  const recent = changes.filter((x) => x.meta.status === 'applied').slice(-5).reverse();
  return {
    root, setUp: true, today,
    phase: st.meta.phase ?? null, size: st.meta.size ?? null, kind: st.meta.kind ?? null,
    questions: { total: c.questions.total, answered: c.questions.answered, byRole: c.questions.byRole },
    drafts: questions.filter((q) => q.status === 'draft').map(note),
    waiting: {
      parked: questions.filter((q) => q.status === 'parked').map(note),
      skipped: questions.filter((q) => q.status === 'skipped').map(note),
      proposed: changes.filter((x) => x.meta.status === 'proposed').map((x) => ({ name: x.key, title: x.data.description, date: x.meta.date, days: days(String(x.meta.date), today), decision: x.meta.decision ?? 'none', asked_by: x.meta.asked_by })),
    },
    files: written.map((f) => ({ file: f.rel, owner: f.meta.owner, status: f.meta.status, version: f.meta.version, updated: f.meta.updated, open: list(f.meta.open).length })),
    stale: written.filter((f) => f.meta.status !== 'superseded').flatMap((f) => {
      const why = [];
      if (typeof f.meta.review_by === 'string' && f.meta.review_by < today) why.push(`review was due ${f.meta.review_by}`);
      if (typeof f.meta.updated === 'string' && days(f.meta.updated, today) > staleDays) why.push(`not changed for ${days(f.meta.updated, today)} days`);
      if (f.meta.status === 'draft' && typeof f.meta.updated === 'string' && days(f.meta.updated, today) > 30) why.push('still a draft after 30 days');
      return why.length ? [{ file: f.rel, owner: f.meta.owner, why }] : [];
    }),
    nearBudget: sizes(root).filter((s) => s.used >= 80),
    drift: { missingPaths: missingPaths(root, scan) },
    recent: recent.map((x) => ({ date: x.meta.date, title: x.data.description, name: x.key })),
    errors: c.errors, warnings: c.warnings, findings: c.findings,
  };
}

export function setPhase(root, phase, date = new Date().toISOString().slice(0, 10)) {
  if (!PHASES.includes(phase)) throw new Error(`--phase is one of ${PHASES.join(', ')}`);
  const p = path.join(root, 'project', 'memory', 'state.md');
  if (!fs.existsSync(p)) throw new Error('no project here: run /project:new');
  const text = fs.readFileSync(p, 'utf8');
  const from = text.match(/^\s+phase:\s*(\S+)/m)?.[1] ?? null;
  fs.writeFileSync(p, setMeta(setMeta(text, 'phase', phase), 'updated', date));
  return { from, to: phase };
}

function print(s) {
  if (!s.setUp) { console.log('No project here: run /project:new'); return; }
  const line = (t) => console.log(t);
  line(`Phase: ${s.phase} · size ${s.size}${s.kind ? ` · ${s.kind}` : ''} · ${s.questions.answered} of ${s.questions.total} questions answered · ${s.errors} error(s), ${s.warnings} warning(s)`);
  for (const [role, q] of Object.entries(s.questions.byRole)) {
    const left = ['draft', 'open', 'skipped', 'parked'].filter((k) => q[k]?.length).map((k) => `${k}: ${q[k].join(', ')}`);
    if (left.length) line(`  ${role}: ${left.join('; ')}`);
  }
  const block = (title, rows, f) => { if (rows.length) { line(`${title}:`); for (const r of rows) line(`  - ${f(r)}`); } };
  block('Waiting on a decision', [...s.waiting.proposed.map((p) => `${p.title} (proposed ${p.days} day(s) ago by ${p.asked_by})`), ...s.waiting.parked.map((q) => `${q.question} (${q.role}${q.note ? `; ${q.note}` : ''})`)], (x) => x);
  block('Waiting on a person', s.waiting.skipped, (q) => `${q.question} (${q.note || q.role})`);
  block('Going stale', s.stale, (f) => `${f.file} (${f.owner}): ${f.why.join('; ')}`);
  block('Near or over budget', s.nearBudget, (b) => `${b.file}: ${b.used}% of ${b.budget} bytes`);
  block('Names a path that is not in the repo', s.drift.missingPaths, (m) => `${m.file}: ${m.path}`);
  block('Last changes', s.recent, (r) => `${r.date} ${r.title}`);
  for (const f of s.findings.filter((x) => x.level === 'error')) line(`error ${f.file}: ${f.message}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool', console: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try {
    const root = path.resolve(a.root);
    if (a.phase) { console.log(JSON.stringify(setPhase(root, a.phase, a.today), null, 2)); process.exit(0); }
    const s = status(root, { today: a.today, staleDays: a['stale-days'] ? Number(a['stale-days']) : 90 });
    if (a.console) print(s); else console.log(JSON.stringify(s, null, 2));
    process.exit(s.setUp && !s.errors ? 0 : 1);
  } catch (e) { console.error(e.message); process.exit(2); }
}
