import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, list, diff, show, restoreFile, storeFiles, memoryDir, parseArgs } from '../memory-log.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'memory-log.mjs');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A bare "remote", a clone with one commit on main, and a store with a subfolder and a sync's dotfiles. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-log-test-'));
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  const store = path.join(root, 'store');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', '-b', 'main', repo);
  fs.writeFileSync(path.join(repo, 'README.md'), 'main line\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'main');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main');
  fs.mkdirSync(path.join(store, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(store, '.sync-state'));
  fs.writeFileSync(path.join(store, 'MEMORY.md'), '- [[a]]: a\n');
  fs.writeFileSync(path.join(store, 'a.md'), 'a v1\n');
  fs.writeFileSync(path.join(store, 'gone.md'), 'to be removed\n');
  fs.writeFileSync(path.join(store, 'sub', 'b.md'), 'b\n');
  fs.writeFileSync(path.join(store, '.memory-sync'), '{}');
  fs.writeFileSync(path.join(store, '.sync-state', 'x'), '{}');
  return { root, remote, repo, store, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('snapshots go to an orphan branch, only when something changed, and are pushed', () => {
  const t = setup();
  try {
    assert.deepEqual(storeFiles(t.store), ['MEMORY.md', 'a.md', 'gone.md', 'sub/b.md'], 'dotfiles and dot-folders are left out');
    const first = snapshot({ memory: t.store, label: 'first', repo: t.repo, push: true });
    assert.ok(first.commit && first.files === 4 && first.pushed);
    const remoteTree = git(t.remote, 'ls-tree', '-r', '--name-only', 'memory-log').split('\n');
    assert.deepEqual(remoteTree, ['MEMORY.md', 'a.md', 'gone.md', 'sub/b.md']);

    const again = snapshot({ memory: t.store, label: 'again', repo: t.repo, push: true });
    assert.equal(again.commit, null, 'nothing changed: no commit');
    assert.equal(again.pushed, false);

    fs.writeFileSync(path.join(t.store, 'a.md'), 'a v2\n');
    fs.unlinkSync(path.join(t.store, 'gone.md'));
    const third = snapshot({ memory: t.store, label: 'third', repo: t.repo, push: true });
    assert.equal(third.changed.length, 2, 'one commit for a change and a removal');
    assert.ok(!git(t.remote, 'ls-tree', '-r', '--name-only', 'memory-log').split('\n').includes('gone.md'));
    assert.equal(git(t.remote, 'show', 'memory-log~1:a.md'), 'a v1', 'the old text is one snapshot back');
    assert.equal(git(t.remote, 'rev-list', '--count', 'memory-log'), '2');
    assert.throws(() => git(t.remote, 'merge-base', 'main', 'memory-log'), 'the branch shares no history with main');
    assert.match(git(t.remote, 'log', '-1', '--format=%s', 'memory-log'), /^third: 3 files, 2 changed$/);
  } finally { t.done(); }
});

test('a second clone catches up with the remote before it commits, and never rewrites it', () => {
  const t = setup();
  try {
    snapshot({ memory: t.store, label: 'one', repo: t.repo, push: true });
    const other = path.join(t.root, 'other');
    git(t.root, 'clone', '-q', t.remote, other);
    fs.writeFileSync(path.join(t.store, 'a.md'), 'from the other clone\n');
    const two = snapshot({ memory: t.store, label: 'two', repo: other, push: true });
    assert.ok(two.commit);
    fs.writeFileSync(path.join(t.store, 'a.md'), 'back in the first\n');
    const three = snapshot({ memory: t.store, label: 'three', repo: t.repo, push: true });
    assert.ok(three.commit, 'the first clone fast-forwards to the remote, then commits on top');
    assert.equal(git(t.remote, 'rev-list', '--count', 'memory-log'), '3');
    assert.deepEqual(list({ repo: t.repo }).map((s) => s.label.split(':')[0]), ['three', 'two', 'one']);
  } finally { t.done(); }
});

test('list, diff and show read the snapshots', () => {
  const t = setup();
  try {
    assert.throws(() => list({ repo: t.repo }), /take a snapshot first/);
    snapshot({ memory: t.store, label: 'one', repo: t.repo });
    fs.writeFileSync(path.join(t.store, 'a.md'), 'a v2\n');
    fs.writeFileSync(path.join(t.store, 'new.md'), 'new\n');
    fs.unlinkSync(path.join(t.store, 'gone.md'));
    const now = diff({ repo: t.repo, memory: t.store });
    assert.deepEqual([now.added, now.removed, now.changed, now.to], [['new.md'], ['gone.md'], ['a.md'], 'store']);
    snapshot({ memory: t.store, label: 'two', repo: t.repo });
    assert.equal(diff({ repo: t.repo, memory: t.store }).same, true, 'the store matches the newest snapshot');
    const between = diff({ repo: t.repo, from: 'memory-log~1', to: 'memory-log' });
    assert.deepEqual([between.added, between.removed, between.changed], [['new.md'], ['gone.md'], ['a.md']]);
    assert.equal(show({ repo: t.repo, file: 'a.md', from: 'memory-log~1' }), 'a v1\n');
    assert.equal(show({ repo: t.repo, file: 'sub/b.md' }), 'b\n');
    assert.throws(() => show({ repo: t.repo, file: 'gone.md' }), /not in memory-log/);
    assert.throws(() => show({ repo: t.repo, file: '../README.md' }), /inside the store/);
    assert.throws(() => show({ repo: t.repo, file: '.memory-sync' }), /inside the store/);
  } finally { t.done(); }
});

test('restore shows the change, then on --yes snapshots first and writes one file back', () => {
  const t = setup();
  try {
    snapshot({ memory: t.store, label: 'one', repo: t.repo });
    fs.writeFileSync(path.join(t.store, 'a.md'), 'a broken\n');
    fs.writeFileSync(path.join(t.store, 'MEMORY.md'), '- changed too\n');
    const dry = restoreFile({ repo: t.repo, memory: t.store, file: 'a.md' });
    assert.equal(dry.restored, false);
    assert.match(dry.patch, /-a broken/);
    assert.match(dry.patch, /\+a v1/);
    assert.equal(fs.readFileSync(path.join(t.store, 'a.md'), 'utf8'), 'a broken\n', 'nothing is written without --yes');
    const done = restoreFile({ repo: t.repo, memory: t.store, file: 'a.md', yes: true });
    assert.ok(done.restored && done.before, 'a snapshot of the broken state comes first');
    assert.equal(fs.readFileSync(path.join(t.store, 'a.md'), 'utf8'), 'a v1\n');
    assert.equal(fs.readFileSync(path.join(t.store, 'MEMORY.md'), 'utf8'), '- changed too\n', 'only the named file changes');
    assert.equal(show({ repo: t.repo, file: 'a.md' }), 'a broken\n', 'the state before the restore is kept');
    assert.equal(restoreFile({ repo: t.repo, memory: t.store, file: 'a.md', from: 'memory-log~1', yes: true }).same, true);
    fs.unlinkSync(path.join(t.store, 'gone.md'));
    assert.equal(restoreFile({ repo: t.repo, memory: t.store, file: 'gone.md', from: 'memory-log~1', yes: true }).restored, true, 'a removed file comes back');
  } finally { t.done(); }
});

test('the memory folder and the flags', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-log-home-'));
  try {
    assert.equal(memoryDir('~/m', '/r', { env: {}, home }), path.join(home, 'm'));
    assert.equal(memoryDir(null, '/r', { env: { MEMORY_DIR: '/x/y' }, home }), '/x/y');
    assert.throws(() => memoryDir(null, '/work/app', { env: {}, home }), /pass --memory/);
    const auto = path.join(home, '.claude', 'projects', '-work-app', 'memory');
    fs.mkdirSync(auto, { recursive: true });
    assert.equal(memoryDir(null, '/work/app', { env: {}, home }), auto, "Claude Code's auto memory folder for the repo");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
  assert.deepEqual(parseArgs(['--diff', 'abc', 'def']).revs, ['abc', 'def']);
  assert.equal(parseArgs(['--restore', 'a.md', '--from', 'memory-log~2', '--yes']).from, 'memory-log~2');
  assert.throws(() => parseArgs(['--nope']), /Unknown flag/);
  assert.throws(() => parseArgs(['--label']), /needs a value/);
});

test('the command line prints JSON and a help text', () => {
  const t = setup();
  try {
    const run = (...a) => execFileSync('node', [CLI, ...a], { cwd: t.repo, encoding: 'utf8' });
    assert.match(run('--help'), /--restore FILE/);
    const out = JSON.parse(run('--memory', t.store, '--label', 'cli', '--push'));
    assert.ok(out.commit && out.pushed);
    assert.equal(JSON.parse(run('--list'))[0].label, 'cli: 4 files, 4 changed');
    assert.equal(run('--show', 'a.md'), 'a v1\n');
  } finally { t.done(); }
});
