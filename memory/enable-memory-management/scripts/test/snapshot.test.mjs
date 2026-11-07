import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { manifest, diff, takeSnapshot, listSnapshots, restore, sha256, defaultState } from '../snapshot.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'snapshot.mjs');

function store() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emm-snap-'));
  const mem = path.join(root, 'mem');
  fs.mkdirSync(path.join(mem, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(mem, 'a.md'), 'a');
  fs.writeFileSync(path.join(mem, 'sub', 'b.md'), 'b');
  fs.writeFileSync(path.join(mem, '.sync'), 'hidden');
  return { root, mem, state: path.join(root, 'state') };
}

test('snapshot, diff and restore', () => {
  const { root, mem, state } = store();
  assert.deepEqual(Object.keys(manifest(mem)).sort(), ['a.md', 'sub/b.md']);
  const s = takeSnapshot(mem, state, { now: new Date('2026-11-03T08:00:00') });
  assert.equal(s.count, 2);
  const again = takeSnapshot(mem, state, { now: new Date('2026-11-03T08:00:00') });
  assert.equal(again.name, `${s.name}-2`, 'a second snapshot in the same minute gets a suffix');
  fs.writeFileSync(path.join(mem, 'a.md'), 'changed');
  fs.writeFileSync(path.join(mem, 'c.md'), 'new');
  fs.rmSync(path.join(mem, 'sub', 'b.md'));
  const d = diff(JSON.parse(fs.readFileSync(path.join(state, 'snapshots', s.name, 'manifest.json'), 'utf8')).files, manifest(mem));
  assert.deepEqual(d, { added: ['c.md'], removed: ['sub/b.md'], changed: ['a.md'], same: false });
  assert.equal(restore(mem, state, s.name), 2);
  assert.equal(fs.readFileSync(path.join(mem, 'a.md'), 'utf8'), 'a');
  assert.ok(fs.existsSync(path.join(mem, 'c.md')), 'restore keeps files added since');
  assert.deepEqual(listSnapshots(state), [`${s.name}-2`, s.name]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--check is hash-before-write: 0 when unchanged, 1 when another writer got there first', () => {
  const { root, mem } = store();
  const f = path.join(mem, 'a.md');
  const sha = execFileSync('node', [CLI, '--sha', f], { encoding: 'utf8' }).trim();
  assert.equal(sha, sha256(Buffer.from('a')));
  assert.equal(execFileSync('node', [CLI, '--check', f, '--expect', sha], { encoding: 'utf8' }).trim(), 'unchanged');
  fs.writeFileSync(f, 'someone else');
  let code = 0;
  try { execFileSync('node', [CLI, '--check', f, '--expect', sha], { encoding: 'utf8' }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('--restore shows the diff and changes nothing without --yes', () => {
  const { root, mem, state } = store();
  const first = JSON.parse(execFileSync('node', [CLI, '--memory', mem, '--state', state], { encoding: 'utf8' }));
  fs.writeFileSync(path.join(mem, 'a.md'), 'later');
  const dry = JSON.parse(execFileSync('node', [CLI, '--memory', mem, '--state', state, '--restore', first.snapshot], { encoding: 'utf8' }));
  assert.deepEqual(dry.changed, ['a.md']);
  assert.equal(fs.readFileSync(path.join(mem, 'a.md'), 'utf8'), 'later');
  const done = JSON.parse(execFileSync('node', [CLI, '--memory', mem, '--state', state, '--restore', first.snapshot, '--yes'], { encoding: 'utf8' }));
  assert.equal(done.files, 2);
  assert.ok(done.safety, 'a safety snapshot is taken first');
  assert.equal(fs.readFileSync(path.join(mem, 'a.md'), 'utf8'), 'a');
  fs.rmSync(root, { recursive: true, force: true });
});

test('defaultState names a Claude Code store by its project', () => {
  assert.equal(defaultState('/h/.claude/projects/-home-me-app/memory', { reports: '/R' }), '/R/enable-memory-management/stores/home-me-app');
  assert.equal(defaultState('/tmp/claude/memory/team/silo', { reports: '/R' }), '/R/enable-memory-management/stores/team-silo');
});
