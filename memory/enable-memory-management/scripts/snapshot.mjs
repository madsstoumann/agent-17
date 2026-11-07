#!/usr/bin/env node
/**
 * Versions and safe writes for a memory store.
 *
 *   node snapshot.mjs --memory DIR [--state DIR] [--label TEXT]   copy the store to <state>/snapshots/<stamp>/ with a sha256 manifest
 *   node snapshot.mjs --memory DIR --diff [--against STAMP]        what changed since the newest (or a named) snapshot
 *   node snapshot.mjs --memory DIR --list                          the snapshots, newest first
 *   node snapshot.mjs --sha FILE                                   print a file's sha256 (read it before you edit)
 *   node snapshot.mjs --check FILE --expect SHA                    exit 0 when FILE still has that sha256, 1 when it changed
 *   node snapshot.mjs --memory DIR --restore STAMP [--yes]         copy a snapshot back (shows the diff and stops without --yes)
 *
 * --check is the hash-before-write rule: read a file, keep its sha256, and just before writing check
 * it again. A different hash means another session wrote in between: re-read, merge, then write.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stamp } from './lib/target-state.mjs';
import { reportsRoot } from './audit.mjs';

const SKILL = 'enable-memory-management';
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Every file under dir (dot folders skipped), relative, with its sha256. */
export function manifest(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out[path.relative(dir, full).split(path.sep).join('/')] = sha256(fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

export function diff(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before)).sort();
  const removed = Object.keys(before).filter((k) => !(k in after)).sort();
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]).sort();
  return { added, removed, changed, same: !added.length && !removed.length && !changed.length };
}

export function snapshotsDir(state) { return path.join(state, 'snapshots'); }

export function listSnapshots(state) {
  try { return fs.readdirSync(snapshotsDir(state)).filter((n) => fs.existsSync(path.join(snapshotsDir(state), n, 'manifest.json'))).sort().reverse(); } catch { return []; }
}

/** Copies the store and writes manifest.json ({ memory, label, at, files: { path: sha256 } }). */
export function takeSnapshot(memory, state, { label = '', now = new Date() } = {}) {
  const files = manifest(memory);
  let name = stamp(now);
  for (let i = 2; fs.existsSync(path.join(snapshotsDir(state), name)); i++) name = `${stamp(now)}-${i}`;
  const dir = path.join(snapshotsDir(state), name);
  for (const rel of Object.keys(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'files', rel)), { recursive: true });
    fs.copyFileSync(path.join(memory, rel), path.join(dir, 'files', rel));
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ memory: path.resolve(memory), label, at: now.toISOString(), files }, null, 2)}\n`);
  return { name, dir, count: Object.keys(files).length };
}

export function restore(memory, state, name) {
  const dir = path.join(snapshotsDir(state), name);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const rel of Object.keys(m.files)) {
    fs.mkdirSync(path.dirname(path.join(memory, rel)), { recursive: true });
    fs.copyFileSync(path.join(dir, 'files', rel), path.join(memory, rel));
  }
  return Object.keys(m.files).length;
}

/** <reports>/enable-memory-management/stores/<name>/, the name from the store's folder (a Claude Code store is named by its project). */
export function defaultState(memory, { reports = reportsRoot() } = {}) {
  const abs = path.resolve(memory);
  const base = path.basename(abs);
  const parent = path.basename(path.dirname(abs));
  const name = base === 'memory' ? parent : `${parent}-${base}`;
  return path.join(reports, SKILL, 'stores', name.replace(/[^\w.-]+/g, '-').replace(/^-+/, ''));
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (['--memory', '--state', '--label', '--against', '--sha', '--check', '--expect', '--restore'].includes(k)) a[k.slice(2)] = argv[++i];
    else if (k === '--diff' || k === '--list' || k === '--yes') a[k.slice(2)] = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown flag ${k} (see --help)`);
  }
  if (a.help) { process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, '')); return 0; }
  if (a.sha) { process.stdout.write(`${sha256(fs.readFileSync(a.sha))}\n`); return 0; }
  if (a.check) {
    const now = fs.existsSync(a.check) ? sha256(fs.readFileSync(a.check)) : 'missing';
    if (now === a.expect) { process.stdout.write('unchanged\n'); return 0; }
    process.stdout.write(`changed since you read it (now ${now}): re-read, merge, then write\n`);
    return 1;
  }
  if (!a.memory) throw new Error('--memory DIR is required (see --help)');
  const memory = path.resolve(a.memory);
  const state = a.state ? path.resolve(a.state) : defaultState(memory);
  if (a.list) { process.stdout.write(`${JSON.stringify({ state, snapshots: listSnapshots(state) })}\n`); return 0; }
  if (a.diff || a.restore) {
    const name = a.restore || a.against || listSnapshots(state)[0];
    if (!name) throw new Error(`No snapshot in ${snapshotsDir(state)}`);
    const before = JSON.parse(fs.readFileSync(path.join(snapshotsDir(state), name, 'manifest.json'), 'utf8')).files;
    const d = diff(before, manifest(memory));
    if (a.restore && a.yes) {
      const safety = takeSnapshot(memory, state, { label: `before restoring ${name}` });
      const n = restore(memory, state, name);
      process.stdout.write(`${JSON.stringify({ restored: name, files: n, kept: d.added, safety: safety.name })}\n`);
      return 0;
    }
    process.stdout.write(`${JSON.stringify({ snapshot: name, ...d, ...(a.restore ? { note: 'Nothing restored. Run again with --yes; files added since then are kept.' } : {}) })}\n`);
    return 0;
  }
  const s = takeSnapshot(memory, state, { label: a.label || '' });
  process.stdout.write(`${JSON.stringify({ snapshot: s.name, files: s.count, dir: s.dir })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 2; }
}
