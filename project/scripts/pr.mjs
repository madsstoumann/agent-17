#!/usr/bin/env node
/**
 * What a pull request description is written from: the change records this branch adds, the project
 * files it changes, and where the two disagree (a project file changed with no record, a record
 * still proposed). Reads git; writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { list, section } from './lib/md.mjs';
import { load, args, bumps } from './lib/project.mjs';

const USAGE = `Usage: pr.mjs --root DIR [--base BRANCH]`;
const git = (root, ...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (root, ...a) => { try { return git(root, ...a); } catch { return null; } };

export function defaultBase(root) {
  const head = tryGit(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (head) return head;
  return ['origin/main', 'origin/master', 'main', 'master'].find((b) => tryGit(root, 'rev-parse', '--verify', '--quiet', b)) ?? null;
}

export function pr(root, { base = null } = {}) {
  if (tryGit(root, 'rev-parse', '--is-inside-work-tree') !== 'true') throw new Error('not a git repository: a pull request needs one');
  base = base ?? defaultBase(root);
  if (!base || !tryGit(root, 'rev-parse', '--verify', '--quiet', base)) throw new Error(`no base branch found${base ? ` ("${base}")` : ''}: pass --base`);
  const branch = tryGit(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  const top = git(root, 'rev-parse', '--show-toplevel');
  const prefix = path.relative(top, path.resolve(root)).split(path.sep).join('/');
  const inRoot = (f) => (prefix ? f.startsWith(prefix + '/') : true);
  const local = (f) => (prefix ? f.slice(prefix.length + 1) : f);
  const diff = (git(root, 'diff', '--name-status', `${base}...HEAD`) || '').split('\n').filter(Boolean).map((l) => { const p = l.split('\t'); return { state: p[0][0], file: p.at(-1) }; }).filter((d) => inRoot(d.file)).map((d) => ({ ...d, file: local(d.file) }));
  const { changes, written } = load(root);
  const isRecord = (f) => f.startsWith('project/memory/changes/');
  const kept = (f) => f.startsWith('project/memory/') || f === 'project/INDEX.md';
  const touched = new Set(diff.filter((d) => isRecord(d.file) && d.state !== 'D').map((d) => path.basename(d.file, '.md')));
  const records = changes.filter((c) => touched.has(c.key)).map((c) => ({
    name: c.key, title: c.data.description, date: c.meta.date, status: c.meta.status, decision: c.meta.decision ?? 'none', asked_by: c.meta.asked_by,
    bumps: list(c.meta.bumps), supersedes: list(c.meta.supersedes),
    why: section(c.body, 'Why'), deltas: section(c.body, 'Deltas'), decided: section(c.body, 'Decision'), hooks: section(c.body, 'Hooks'),
  }));
  const projectFiles = diff.filter((d) => d.file.startsWith('project/') && !kept(d.file)).map((d) => d.file);
  const covered = new Set(changes.filter((c) => touched.has(c.key)).flatMap((c) => bumps(c.meta).map((b) => b.file)));
  const byRel = new Map(written.map((f) => [f.rel, f.key]));
  const other = diff.filter((d) => !d.file.startsWith('project/')).map((d) => d.file);
  const rules = ['project/tech/pr-rules.md', 'project/tech/guardrails.md', 'project/intent/boundaries.md'].filter((f) => fs.existsSync(path.join(root, f)));
  const template = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'pull_request_template.md'].find((f) => fs.existsSync(path.join(top, f))) ?? null;
  return {
    root, base, branch,
    commits: (tryGit(root, 'log', '--format=%s', `${base}..HEAD`) || '').split('\n').filter(Boolean),
    records,
    decisions: records.filter((r) => r.decision !== 'none').map((r) => r.name),
    projectFiles,
    otherFiles: { count: other.length, sample: other.slice(0, 20) },
    rules, template,
    problems: [
      ...projectFiles.filter((f) => byRel.has(f) && !covered.has(byRel.get(f))).map((f) => `${f} changed, and no change record on this branch bumps it`),
      ...records.filter((r) => r.status === 'proposed').map((r) => `${r.name} is still proposed: the branch carries a change nobody has said yes to`),
    ],
    empty: !diff.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try { console.log(JSON.stringify(pr(path.resolve(a.root), { base: a.base }), null, 2)); } catch (e) { console.error(e.message); process.exit(2); }
}
