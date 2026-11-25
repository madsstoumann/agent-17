#!/usr/bin/env node
/**
 * Creates a change record from the template, or moves one along: proposed to applied or rejected,
 * a proposed decision to accepted. It checks what a person would get wrong by hand: a bump that
 * names no project file, a record it would overwrite, a decision that supersedes nothing that
 * exists. The record's prose (Asked, Why, Deltas, Decision) is written by the skill afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMeta, list } from './lib/md.mjs';
import { load, args, LEVELS } from './lib/project.mjs';
import { build } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `Usage: record.mjs --root DIR --slug SLUG --title "One line" --asked-by ROLE [--bumps file:level,...]
                  [--decision none|proposed|accepted] [--supersedes NAME,...] [--status proposed|applied] [--date YYYY-MM-DD]
       record.mjs --root DIR --set NAME [--status applied|rejected] [--decision accepted|proposed|none]
       record.mjs --root DIR --list`;
const STATUS = ['proposed', 'applied', 'rejected'];
const DECISION = ['none', 'proposed', 'accepted', 'superseded'];
const csv = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

function checkBumps(root, items) {
  const { written } = load(root);
  const keys = new Set(written.map((f) => f.key));
  for (const b of items) {
    const [file, level] = b.split(':');
    if (!keys.has(file)) throw new Error(`--bumps "${b}": "${file}" is not a project file (${[...keys].join(', ')})`);
    if (!LEVELS.includes(level)) throw new Error(`--bumps "${b}": level must be one of ${LEVELS.join(', ')}`);
  }
}

export function create(root, { slug, title, askedBy, bumps = [], decision = 'none', supersedes = [], status = 'proposed', date = new Date().toISOString().slice(0, 10) }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')) throw new Error('--slug is lowercase letters, digits and hyphens');
  if (!title || /[{}\n"\\]/.test(title)) throw new Error('--title is required, on one line, without quotes or braces');
  if (!/^[a-z0-9-]+$/.test(askedBy ?? '')) throw new Error('--asked-by is one role, as a word (pm, designer, tech-lead)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date is YYYY-MM-DD');
  if (!['proposed', 'applied'].includes(status)) throw new Error('--status is proposed or applied');
  if (!['none', 'proposed', 'accepted'].includes(decision)) throw new Error('--decision is none, proposed or accepted');
  if (decision === 'accepted' && status !== 'applied') throw new Error('an accepted decision is applied; a decision still waiting is --decision proposed');
  checkBumps(root, bumps);
  const { changes } = load(root);
  for (const s of supersedes) {
    const old = changes.find((c) => c.key === s);
    if (!old) throw new Error(`--supersedes "${s}": no such record in project/memory/changes/`);
    if (!old.meta.decision || old.meta.decision === 'none') throw new Error(`--supersedes "${s}": that record holds no decision`);
  }
  if (supersedes.length && decision === 'none') throw new Error('only a decision supersedes another: set --decision');
  const name = `${date}-${slug}`;
  const target = path.join(root, 'project', 'memory', 'changes', `${name}.md`);
  if (fs.existsSync(target)) throw new Error(`${name}.md exists: pick another slug`);
  let text = fs.readFileSync(path.join(HERE, '..', 'templates', 'change.md'), 'utf8')
    .replaceAll('{{DATE}}', date).replaceAll('{{SLUG}}', slug).replaceAll('{{TITLE}}', title).replaceAll('{{ROLE}}', askedBy).replaceAll('{{BUMPS}}', bumps.join(', '));
  text = setMeta(text, 'status', status);
  text = setMeta(text, 'decision', decision);
  if (supersedes.length) text = setMeta(text, 'supersedes', supersedes);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  return { name, path: path.relative(root, target).split(path.sep).join('/'), status, decision, supersedes };
}

/** Moves a record along. Rebuilds when the result is applied, so versions and the decision list follow. */
export function set(root, name, { status, decision } = {}) {
  const { changes } = load(root);
  const c = changes.find((x) => x.key === name);
  if (!c) throw new Error(`no record "${name}" in project/memory/changes/`);
  if (status && !STATUS.includes(status)) throw new Error(`--status is one of ${STATUS.join(', ')}`);
  if (decision && !DECISION.includes(decision)) throw new Error(`--decision is one of ${DECISION.join(', ')}`);
  if (c.meta.status === 'applied' && status && status !== 'applied') throw new Error('an applied record stays: versions were built from it. Write a new record that supersedes or reverses it');
  const next = { status: status ?? c.meta.status, decision: decision ?? c.meta.decision ?? 'none' };
  if (next.decision === 'accepted' && next.status !== 'applied') throw new Error('accepting a decision applies it: pass --status applied, after the files are edited');
  if (next.status === 'applied') checkBumps(root, list(c.meta.bumps));
  let text = c.text;
  if (next.status !== c.meta.status) text = setMeta(text, 'status', next.status);
  if (next.decision !== c.meta.decision) text = setMeta(text, 'decision', next.decision);
  fs.writeFileSync(c.path, text);
  const b = build(root);
  return { name, ...next, problems: b.problems };
}

export function listRecords(root) {
  return load(root).changes.map((c) => ({ name: c.key, title: c.data.description, date: c.meta.date, status: c.meta.status, decision: c.meta.decision ?? 'none', asked_by: c.meta.asked_by, bumps: list(c.meta.bumps), supersedes: list(c.meta.supersedes) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool', list: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  const root = path.resolve(a.root);
  try {
    const r = a.list ? listRecords(root)
      : a.set ? set(root, a.set, { status: a.status, decision: a.decision })
      : create(root, { slug: a.slug, title: a.title, askedBy: a['asked-by'], bumps: csv(a.bumps), decision: a.decision, supersedes: csv(a.supersedes), status: a.status, date: a.date });
    console.log(JSON.stringify(r, null, 2));
  } catch (e) { console.error(e.message); process.exit(2); }
}
