#!/usr/bin/env node
/**
 * Records what happened to one interview question, in both places that track it: its row in
 * state.md and the `open` list of the file it belongs to. A file whose last question is answered
 * becomes `status: active`, and the index is rebuilt. The answer's text is written into the file by the skill, before this.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMeta, list, cell, parseFrontmatter } from './lib/md.mjs';
import { load, args, ANSWERS as STATUSES } from './lib/project.mjs';
import { build } from './build.mjs';

const USAGE = 'Usage: answer.mjs --root DIR --id QUESTION --status answered|draft|skipped|parked|open [--note TEXT] [--date YYYY-MM-DD]\n       answer.mjs --root DIR --add ID --file KEY --role ROLE --ask "Question"';

export function answer(root, { id, status, note = '', date = new Date().toISOString().slice(0, 10) }) {
  if (!STATUSES.includes(status)) throw new Error(`--status must be one of ${STATUSES.join(', ')}`);
  const statePath = path.join(root, 'project', 'memory', 'state.md');
  const lines = fs.readFileSync(statePath, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.startsWith(`| ${id} |`));
  if (at < 0) throw new Error(`no question "${id}" in state.md`);
  const cells = lines[at].split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  const file = cells[1];
  cells[3] = status;
  if (note) cells[5] = cell(note);
  lines[at] = `| ${cells.join(' | ')} |`;
  fs.writeFileSync(statePath, setMeta(lines.join('\n'), 'updated', date));

  const { written } = load(root);
  const f = written.find((w) => w.key === file);
  const out = { id, file, status, fileStatus: null, stillOpen: [] };
  if (f) {
    const open = new Set(list(f.meta.open));
    if (status === 'answered') open.delete(id); else open.add(id);
    let text = setMeta(f.text, 'open', [...open]);
    const next = open.size ? 'draft' : 'active';
    if (f.meta.status !== 'superseded' && f.meta.status !== next) text = setMeta(text, 'status', next);
    fs.writeFileSync(f.path, text);
    out.fileStatus = parseFrontmatter(text).data.metadata.status;
    out.stillOpen = [...open];
  }
  build(root); // the index shows each file's status and open count
  return out;
}

/** A question the interview found on the way: added as open, to state.md and to its file. */
export function addQuestion(root, { id, file, role, ask }) {
  if (!/^[a-z0-9-]+$/.test(id ?? '')) throw new Error('--add takes an id of lowercase letters, digits and hyphens');
  const statePath = path.join(root, 'project', 'memory', 'state.md');
  const lines = fs.readFileSync(statePath, 'utf8').replace(/\n+$/, '').split('\n');
  if (lines.some((l) => l.startsWith(`| ${id} |`))) throw new Error(`question "${id}" already exists`);
  let last = -1;
  lines.forEach((l, i) => { if (l.startsWith('|')) last = i; });
  lines.splice(last + 1, 0, `| ${id} | ${file} | ${role} | open | ${cell(ask)} | |`);
  fs.writeFileSync(statePath, lines.join('\n') + '\n');
  return answer(root, { id, status: 'open' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool' });
  if (a.help || !a.root || (!a.id && !a.add)) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try {
    const r = a.add ? addQuestion(path.resolve(a.root), { id: a.add, file: a.file, role: a.role, ask: a.ask }) : answer(path.resolve(a.root), a);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) { console.error(e.message); process.exit(2); }
}
