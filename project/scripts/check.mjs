#!/usr/bin/env node
/**
 * Lints a project's files and says what the interview still owes, per role. Errors: a missing or
 * malformed header, a dependency that does not resolve, a leftover {{placeholder}}, something that
 * looks like a secret, a generated view that is out of date, state.md and a header disagreeing.
 * Warnings: a file past its size budget or its review date, a draft with nothing open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, table, section } from './lib/md.mjs';
import { load, args, key, STATUSES, AUDIENCES, BUDGET, ANSWERS } from './lib/project.mjs';
import { build } from './build.mjs';

const USAGE = 'Usage: check.mjs --root DIR [--today YYYY-MM-DD] [--console]\n       check.mjs --root DIR --next [--role ROLE]';
const SECRET = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9/+_-]{12,})/i;

export function check(root, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const findings = [];
  const add = (level, file, message) => findings.push({ level, file, message });
  const agents = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(path.join(root, 'project'))) { add('error', 'project/', 'no project folder here: run /project:new'); return finish(root, findings, []); }
  const { files, written, changes } = load(root);

  if (!fs.existsSync(agents)) add('error', 'AGENTS.md', 'missing');
  else {
    const t = fs.readFileSync(agents, 'utf8');
    if (Buffer.byteLength(t) > BUDGET['AGENTS.md']) add('warn', 'AGENTS.md', `${Buffer.byteLength(t)} bytes, over the ${BUDGET['AGENTS.md']} budget: it loads in every session, keep rules only`);
    if (/\{\{[A-Z_]+\}\}/.test(t)) add('error', 'AGENTS.md', 'a {{placeholder}} was never filled in');
    if (SECRET.test(t)) add('error', 'AGENTS.md', 'looks like it holds a secret: remove it and rotate it');
  }
  for (const c of ['CLAUDE.md', '.claude/CLAUDE.md']) {
    const p = path.join(root, c);
    if (fs.existsSync(p) && !/^@AGENTS\.md\s*$/m.test(fs.readFileSync(p, 'utf8'))) add('warn', c, 'exists without an `@AGENTS.md` line, so Claude Code reads it instead of AGENTS.md');
  }

  const keys = new Map();
  for (const f of files) {
    if (!f.hasHeader) { add('error', f.rel, 'no frontmatter header'); continue; }
    if (/\{\{[A-Z_]+\}\}/.test(f.text)) add('error', f.rel, 'a {{placeholder}} was never filled in');
    if (SECRET.test(f.text)) add('error', f.rel, 'looks like it holds a secret: remove it and rotate it');
    if (f.meta.generated === 'true') continue;
    if (keys.has(f.key)) add('error', f.rel, `same file name as ${keys.get(f.key)}: names must be unique, links use them`); else keys.set(f.key, f.rel);
    for (const k of ['name', 'description']) if (!f.data[k]) add('error', f.rel, `header has no ${k}`);
    if (f.data.name && f.key !== 'design' && f.data.name !== f.key) add('error', f.rel, `name "${f.data.name}" should be "${f.key}", the file name`);
    for (const k of ['version', 'status', 'audience', 'owner', 'changelog']) if (!f.meta[k] || typeof f.meta[k] === 'object') add('error', f.rel, `header has no metadata.${k}`);
    if (f.meta.version && !/^\d+\.\d+\.\d+$/.test(f.meta.version)) add('error', f.rel, `version "${f.meta.version}" is not x.y.z`);
    if (f.meta.status && !STATUSES.includes(f.meta.status)) add('error', f.rel, `status "${f.meta.status}" is not one of ${STATUSES.join(', ')}`);
    if (f.meta.audience && !AUDIENCES.includes(f.meta.audience)) add('error', f.rel, `audience "${f.meta.audience}" is not one of ${AUDIENCES.join(', ')}`);
    if (Array.isArray(f.meta.owner)) add('error', f.rel, 'owner is one role; the others go in contributors');
    if (f.meta.changelog && typeof f.meta.changelog === 'string' && f.meta.changelog !== `memory/changelog/${f.key}.md`) add('error', f.rel, `changelog should point to memory/changelog/${f.key}.md`);
    const size = Buffer.byteLength(f.text), budget = BUDGET[f.key] ?? BUDGET.default;
    if (size > budget) add('warn', f.rel, `${size} bytes, over the ${budget} budget: split a section into its own file`);
    if (typeof f.meta.review_by === 'string' && f.meta.review_by < today) add('warn', f.rel, `review was due ${f.meta.review_by}`);
    if (f.meta.status === 'active' && list(f.meta.open).length) add('warn', f.rel, `active with ${list(f.meta.open).length} open question(s): still a draft`);
  }
  for (const f of written) for (const d of list(f.meta.depends_on)) if (!keys.has(d)) add('error', f.rel, `depends_on "${d}" is not a project file`);
  for (const c of changes) {
    if (!c.hasHeader) { add('error', c.rel, 'no frontmatter header'); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.meta.date))) add('error', c.rel, 'metadata.date is not YYYY-MM-DD');
    if (!['proposed', 'applied', 'rejected'].includes(c.meta.status)) add('error', c.rel, `status "${c.meta.status}" is not proposed, applied or rejected`);
    if (c.meta.status === 'applied' && !section(c.body, 'Deltas')) add('error', c.rel, 'applied without anything under "## Deltas"');
    if (SECRET.test(c.text)) add('error', c.rel, 'looks like it holds a secret: remove it and rotate it');
  }

  // The interview: state.md and the headers must tell the same story
  const state = files.find((f) => f.rel === 'project/memory/state.md');
  const questions = state ? table(state.body, 'Questions') : [];
  if (!state) add('error', 'project/memory/state.md', 'missing');
  const openIn = new Map();
  for (const q of questions) {
    if (!ANSWERS.includes(q.status)) add('error', 'project/memory/state.md', `question ${q.id}: status "${q.status}" is not one of ${ANSWERS.join(', ')}`);
    if (q.status !== 'answered') openIn.set(q.id, q);
  }
  for (const f of written) {
    const mine = questions.filter((q) => q.file === f.key && q.status !== 'answered').map((q) => q.id).sort();
    const header = list(f.meta.open).slice().sort();
    if (state && mine.join() !== header.join()) add('error', f.rel, `open: [${header.join(', ')}] but state.md has [${mine.join(', ')}] unanswered for this file`);
  }

  const b = build(root, { check: true });
  for (const p of b.problems) add('error', 'project/memory/changes', p);
  if (!b.problems.length) for (const p of b.changed) add('error', p, 'out of date: run build.mjs');
  return finish(root, findings, questions, written, state);
}

function finish(root, findings, questions, written = [], state = null) {
  const byRole = {};
  for (const q of questions) {
    const r = (byRole[q.role] ??= { open: [], draft: [], skipped: [], parked: [], answered: 0 });
    if (q.status === 'answered') r.answered++; else (r[q.status] ?? r.open).push(q.id);
  }
  const count = (l) => findings.filter((f) => f.level === l).length;
  return {
    root,
    phase: state?.meta.phase ?? null,
    size: state?.meta.size ?? null,
    kind: state?.meta.kind ?? null,
    files: { total: written.length, draft: written.filter((f) => f.meta.status === 'draft').map((f) => f.key) },
    questions: { total: questions.length, answered: questions.filter((q) => q.status === 'answered').length, draft: questions.filter((q) => q.status === 'draft').length, byRole },
    errors: count('error'),
    warnings: count('warn'),
    findings,
  };
}

/**
 * The next round of the interview: drafts waiting for a person to confirm them, then the open
 * questions whose prerequisites are answered. A draft counts as a prerequisite met, so one
 * unconfirmed answer does not hold up everything after it.
 */
export function frontier(root, bank, role = null) {
  const { files } = load(root);
  const state = files.find((f) => f.rel === 'project/memory/state.md');
  const rows = state ? table(state.body, 'Questions') : [];
  // Only a question nobody has dealt with holds up what follows: a parked or skipped one is settled for now.
  const done = new Set(rows.filter((q) => q.status !== 'open').map((q) => q.id));
  const known = new Map(bank.map((q) => [q.id, q]));
  return rows.filter((q) => !role || q.role === role).filter((q) => q.status === 'draft' || q.status === 'open' && (known.get(q.id)?.after ?? []).every((id) => done.has(id) || !rows.some((r) => r.id === id)))
    .map((q) => ({ ...q, section: known.get(q.id)?.section ?? null }))
    .sort((a, b) => (b.status === 'draft') - (a.status === 'draft'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { console: 'bool', help: 'bool', next: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  const root = path.resolve(a.root);
  if (a.next) {
    const bank = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'questions.json'), 'utf8')).questions;
    console.log(JSON.stringify(frontier(root, bank, a.role ?? null), null, 2));
    process.exit(0);
  }
  const r = check(root, { today: a.today });
  if (a.console) {
    console.log(`${r.errors} error(s), ${r.warnings} warning(s); ${r.questions.answered} of ${r.questions.total} questions answered${r.questions.draft ? `, ${r.questions.draft} draft(s) to confirm` : ''}`);
    for (const [role, q] of Object.entries(r.questions.byRole)) {
      const left = ['draft', 'open', 'skipped', 'parked'].filter((k) => q[k].length).map((k) => `${k}: ${q[k].join(', ')}`);
      console.log(`${role}: ${q.answered} answered${left.length ? '; ' + left.join('; ') : ''}`);
    }
    for (const f of [...r.findings].sort((x, y) => x.level.localeCompare(y.level))) console.log(`${f.level.padEnd(5)} ${f.file}: ${f.message}`);
  } else console.log(JSON.stringify(r, null, 2));
  process.exit(r.errors ? 1 : 0);
}
