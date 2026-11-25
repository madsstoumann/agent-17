#!/usr/bin/env node
/**
 * Writes the starting set into a project: the folders, the six written files as skeletons, state.md
 * with the interview's questions for the project's size, and each file's `open` list. Never
 * overwrites: a file that exists is left as it is and reported, so running it again is safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMeta, cell } from './lib/md.mjs';
import { SIZES, KINDS, args, key } from './lib/project.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, '..', 'templates');
const USAGE = 'Usage: scaffold.mjs --root DIR --name "Project name" [--size small|medium|large] [--kind client|product|library] [--date YYYY-MM-DD] [--dry-run]';

/** The questions for a size, each worded for the kind of project. `skip` drops whole files' questions. */
export function questionsFor(size, kind = 'client', skip = []) {
  const all = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'questions.json'), 'utf8')).questions;
  return all.filter((q) => SIZES.indexOf(q.size) <= SIZES.indexOf(size) && !skip.includes(q.file))
    .map((q) => ({ ...q, ask: q.askFor?.[kind] ?? q.ask }));
}

export function scaffold({ root, name, size = 'medium', kind = 'client', date = new Date().toISOString().slice(0, 10), dryRun = false }) {
  if (!SIZES.includes(size)) throw new Error(`--size must be one of ${SIZES.join(', ')}`);
  if (!name || /[{}\n"\\]/.test(name)) throw new Error('--name is required, on one line, without quotes or braces');
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);
  // A DESIGN.md the repo already has stays the design file: no second one, and no questions about it.
  const designMd = ['DESIGN.md', 'design.md', 'docs/DESIGN.md'].find((f) => fs.existsSync(path.join(root, f))) ?? null;
  const ours = path.join('project', 'building-blocks', 'DESIGN.md');
  const adopt = designMd && !fs.existsSync(path.join(root, ours));
  const questions = questionsFor(size, kind, adopt ? ['design'] : []);
  const rows = questions.map((q) => `| ${q.id} | ${q.file} | ${q.role} | open | ${cell(q.ask)} | |`).join('\n');
  const fill = (t) => t.replaceAll('{{PROJECT}}', name).replaceAll('{{DATE}}', date).replaceAll('{{SIZE}}', size).replaceAll('{{KIND}}', kind).replaceAll('{{QUESTIONS}}', rows);
  const result = { root, size, kind, written: [], kept: [], folders: [], claudeMd: null, designMd: adopt ? designMd : null, questions: questions.length };

  const plan = [['AGENTS.md', 'AGENTS.md']];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(TEMPLATES, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!(adopt && p === ours)) plan.push([p, p]); } };
  walk('project');

  for (const [from, to] of plan) {
    const target = path.join(root, to);
    const rel = to.split(path.sep).join('/');
    if (fs.existsSync(target)) { result.kept.push(rel); continue; }
    let text = fill(fs.readFileSync(path.join(TEMPLATES, from), 'utf8'));
    const open = questions.filter((q) => q.file === key(to)).map((q) => q.id);
    if (open.length && /^metadata:/m.test(text) && !/generated: true/.test(text)) text = setMeta(text, 'open', open);
    if (!dryRun) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
    result.written.push(rel);
  }
  for (const d of ['project/memory/changes', 'project/memory/changelog', 'project/memory/reports', 'project/tech']) {
    const p = path.join(root, d);
    if (!fs.existsSync(p)) { if (!dryRun) { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, '.gitkeep'), ''); } result.folders.push(d); }
  }
  // Claude Code reads AGENTS.md by itself only when no CLAUDE.md exists; the skill adds the import.
  for (const c of ['CLAUDE.md', '.claude/CLAUDE.md']) {
    const p = path.join(root, c);
    if (fs.existsSync(p)) result.claudeMd = { path: c, importsAgents: /^@AGENTS\.md\s*$/m.test(fs.readFileSync(p, 'utf8')) };
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { 'dry-run': 'bool', help: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try { console.log(JSON.stringify(scaffold({ root: path.resolve(a.root), name: a.name, size: a.size, kind: a.kind, date: a.date, dryRun: a['dry-run'] }), null, 2)); }
  catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }
}
