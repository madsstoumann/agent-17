#!/usr/bin/env node
/**
 * A memory store's history on a private, orphan git branch: one commit per snapshot.
 *
 *   node memory-log.mjs [--memory DIR] [--label TEXT] [--push]        snapshot the store (commits only when something changed)
 *   node memory-log.mjs --list [--max N]                              the snapshots, newest first
 *   node memory-log.mjs --diff [A [B]]                                what changed: the store now against the newest snapshot,
 *                                                                     against snapshot A, or between snapshots A and B
 *   node memory-log.mjs --show FILE [--from REV]                      a file as it was (default: the newest snapshot)
 *   node memory-log.mjs --restore FILE [--from REV] [--yes] [--push]  put one file back; shows the diff and stops without
 *                                                                     --yes, snapshots the store first with it
 *
 * Shared flags: --repo DIR (default: the git checkout around the current folder), --branch NAME
 * (default memory-log), --remote NAME (default origin). --memory defaults to $MEMORY_DIR, else Claude
 * Code's auto memory folder for the repo.
 *
 * The branch is orphan (no history shared with the main line), only ever moves forward, and is never
 * merged. Files and folders whose name starts with a dot (a sync's own state) are left out. A REV is
 * anything git reads: a commit from --list, or memory-log~1 for one snapshot back. Prints JSON.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve, dirname, isAbsolute, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRANCH = 'memory-log';
const IDENTITY = ['-c', 'user.name=Project memory', '-c', 'user.email=memory-log@localhost'];

const git = (cwd, ...x) => execFileSync('git', x, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const tryGit = (cwd, ...x) => { try { return git(cwd, ...x); } catch { return null; } };

export function parseArgs(argv) {
  const a = { label: 'snapshot', remote: 'origin', branch: BRANCH, push: false, revs: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (['--memory', '--label', '--remote', '--repo', '--branch', '--from', '--show', '--restore'].includes(k)) a[k.slice(2)] = next();
    else if (k === '--max') a.max = Number(next());
    else if (k === '--push') a.push = true;
    else if (k === '--list') a.list = true;
    else if (k === '--diff') a.diff = true;
    else if (k === '--yes') a.yes = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else if (!k.startsWith('-') && a.diff) a.revs.push(k);
    else throw new Error(`Unknown flag ${k} (see --help)`);
  }
  return a;
}

/** The memory folder: --memory, else $MEMORY_DIR, else Claude Code's auto memory folder for the repo. */
export function memoryDir(explicit, repo, { env = process.env, home = homedir() } = {}) {
  const expand = (p) => p.replace(/^~(?=$|[\\/])/, home);
  if (explicit) return resolve(expand(explicit));
  if (env.MEMORY_DIR) return resolve(expand(env.MEMORY_DIR));
  const slug = resolve(repo).replace(/[^A-Za-z0-9]/g, '-');
  const auto = join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects', slug, 'memory');
  if (existsSync(auto)) return auto;
  throw new Error('No memory folder: pass --memory DIR or set MEMORY_DIR');
}

/** Every file under dir, relative, sorted; dotfiles and dot-folders (a sync's own state) left out. */
export function storeFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** Brings the local branch up to the remote's (never back), and says which of the two exist. */
function syncBranch(repo, remote, branch) {
  let hasRemote = false;
  if (tryGit(repo, 'fetch', '-q', remote, `${branch}:refs/remotes/${remote}/${branch}`) !== null) hasRemote = true;
  let hasLocal = tryGit(repo, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`) !== null;
  if (!hasLocal && hasRemote) { git(repo, 'branch', '-q', branch, `${remote}/${branch}`); hasLocal = true; }
  else if (hasLocal && hasRemote && tryGit(repo, 'merge-base', '--is-ancestor', branch, `${remote}/${branch}`) !== null) {
    git(repo, 'branch', '-q', '-f', branch, `${remote}/${branch}`);
  }
  return { hasLocal, hasRemote };
}

export function snapshot({ memory, label = 'snapshot', repo = process.cwd(), remote = 'origin', branch = BRANCH, push = false }) {
  if (!existsSync(memory)) throw new Error(`No memory folder at ${memory}`);
  const files = storeFiles(memory);
  if (!files.length) throw new Error(`${memory} holds no files; nothing to snapshot`);
  const wt = mkdtempSync(join(tmpdir(), 'memory-log-'));
  rmSync(wt, { recursive: true, force: true });
  const { hasLocal, hasRemote } = syncBranch(repo, remote, branch);
  try {
    if (hasLocal) git(repo, 'worktree', 'add', '-q', wt, branch);
    else {
      git(repo, 'worktree', 'add', '-q', '--detach', wt);
      git(wt, 'checkout', '-q', '--orphan', branch);
      git(wt, 'rm', '-rq', '--cached', '--ignore-unmatch', '.');
      for (const name of readdirSync(wt)) if (name !== '.git') rmSync(join(wt, name), { recursive: true, force: true });
    }
    for (const rel of storeFiles(wt)) if (!files.includes(rel)) rmSync(join(wt, rel));
    for (const rel of files) { mkdirSync(dirname(join(wt, rel)), { recursive: true }); cpSync(join(memory, rel), join(wt, rel)); }
    git(wt, 'add', '-A', '.');
    const changed = git(wt, 'status', '--porcelain').split('\n').filter(Boolean);
    let commit = null;
    if (changed.length) {
      git(wt, ...IDENTITY, 'commit', '-q', '-m', `${label}: ${files.length} files, ${changed.length} changed`);
      commit = git(wt, 'rev-parse', '--short', 'HEAD');
    }
    if (push && (commit || !hasRemote)) git(repo, 'push', '-q', remote, `${branch}:${branch}`);
    return { commit, changed: changed.map((l) => l.slice(3)), files: files.length, branch, pushed: Boolean(push && (commit || !hasRemote)) };
  } finally {
    if (tryGit(repo, 'worktree', 'remove', '--force', wt) === null) rmSync(wt, { recursive: true, force: true });
  }
}

function needBranch(repo, remote, branch) {
  const { hasLocal } = syncBranch(repo, remote, branch);
  if (!hasLocal) throw new Error(`No ${branch} branch yet: take a snapshot first`);
}

/** The snapshots, newest first. */
export function list({ repo = process.cwd(), remote = 'origin', branch = BRANCH, max = 20 }) {
  needBranch(repo, remote, branch);
  const out = git(repo, 'log', `-n${max}`, '--format=%h%x09%cI%x09%s', branch);
  return out ? out.split('\n').map((l) => { const [commit, date, label] = l.split('\t'); return { commit, date, label }; }) : [];
}

/** The tree of one snapshot: path -> blob sha. */
function tree(repo, rev) {
  const out = git(repo, 'ls-tree', '-r', rev);
  const m = new Map();
  for (const l of out ? out.split('\n') : []) { const [meta, p] = l.split('\t'); m.set(p, meta.split(' ')[2]); }
  return m;
}

function storeTree(repo, memory) {
  const files = storeFiles(memory);
  const m = new Map();
  if (!files.length) return m;
  const shas = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: repo, input: files.map((f) => join(memory, f)).join('\n'), encoding: 'utf8' }).trim().split('\n');
  files.forEach((f, i) => m.set(f, shas[i]));
  return m;
}

/** What changed from `from` to `to`; a missing `to` is the store as it is now. */
export function diff({ repo = process.cwd(), remote = 'origin', branch = BRANCH, memory, from, to }) {
  needBranch(repo, remote, branch);
  const a = tree(repo, from || branch);
  const b = to ? tree(repo, to) : storeTree(repo, memory);
  const added = [...b.keys()].filter((p) => !a.has(p)).sort();
  const removed = [...a.keys()].filter((p) => !b.has(p)).sort();
  const changed = [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p)).sort();
  return { from: git(repo, 'rev-parse', '--short', from || branch), to: to ? git(repo, 'rev-parse', '--short', to) : 'store', added, removed, changed, same: !added.length && !removed.length && !changed.length };
}

function safeRel(file) {
  const p = normalize(String(file)).split(sep).join('/');
  if (!p || isAbsolute(p) || p === '..' || p.startsWith('../') || p.split('/').some((s) => s.startsWith('.'))) throw new Error(`${file}: give a path inside the store, as --list or --diff names it`);
  return p;
}

/** A file's text in a snapshot. */
export function show({ repo = process.cwd(), remote = 'origin', branch = BRANCH, file, from }) {
  needBranch(repo, remote, branch);
  const p = safeRel(file);
  try {
    return execFileSync('git', ['show', `${from || branch}:${p}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch { throw new Error(`${p} is not in ${from || branch}`); }
}

/** Puts one file back from a snapshot. Without yes it only says what would change. */
export function restoreFile({ repo = process.cwd(), remote = 'origin', branch = BRANCH, memory, file, from, yes = false, push = false }) {
  const p = safeRel(file);
  const old = show({ repo, remote, branch, file: p, from });
  const target = join(memory, p);
  const now = existsSync(target) ? readFileSync(target, 'utf8') : null;
  const rev = git(repo, 'rev-parse', '--short', from || branch);
  if (now === old) return { file: p, from: rev, restored: false, same: true };
  if (!yes) {
    const dir = mkdtempSync(join(tmpdir(), 'memory-log-diff-'));
    try {
      writeFileSync(join(dir, 'snapshot'), old);
      writeFileSync(join(dir, 'store'), now ?? '');
      let patch = '';
      try { execFileSync('git', ['diff', '--no-index', '--no-color', 'store', 'snapshot'], { cwd: dir, encoding: 'utf8' }); } catch (e) { patch = String(e.stdout || ''); }
      return { file: p, from: rev, restored: false, same: false, exists: now !== null, patch, next: 'run again with --yes to write it' };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const before = snapshot({ memory, label: `Before restoring ${p} from ${rev}`, repo, remote, branch, push });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, old);
  return { file: p, from: rev, restored: true, before: before.commit };
}

const HELP = `node memory-log.mjs [--memory DIR] [--label TEXT] [--push]
node memory-log.mjs --list [--max N]
node memory-log.mjs --diff [A [B]]
node memory-log.mjs --show FILE [--from REV]
node memory-log.mjs --restore FILE [--from REV] [--yes] [--push]
shared: --repo DIR  --branch NAME (memory-log)  --remote NAME (origin)
`;

function main(argv) {
  const a = parseArgs(argv);
  if (a.help) { process.stdout.write(HELP); return; }
  const repo = resolve(a.repo || git(process.cwd(), 'rev-parse', '--show-toplevel'));
  const base = { repo, remote: a.remote, branch: a.branch };
  const mem = () => memoryDir(a.memory, repo);
  let out;
  if (a.list) out = list({ ...base, max: a.max || 20 });
  else if (a.diff) out = diff({ ...base, memory: a.revs.length < 2 ? mem() : null, from: a.revs[0], to: a.revs[1] });
  else if (a.show) { process.stdout.write(show({ ...base, file: a.show, from: a.from })); return; }
  else if (a.restore) {
    out = restoreFile({ ...base, memory: mem(), file: a.restore, from: a.from, yes: a.yes, push: a.push });
    if (out.patch !== undefined) { const { patch, ...rest } = out; process.stdout.write(`${JSON.stringify(rest, null, 2)}\n${patch}`); return; }
  } else out = snapshot({ ...base, memory: mem(), label: a.label, push: a.push });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 2; }
}
