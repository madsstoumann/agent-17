import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { reportsRoot, resolveOutDir } from '../lib/out-dir.mjs';

const home = '/home/u';
const none = () => null;

test('reportsRoot: AUDIT_OUT_DIR wins, with ~ expanded', () => {
  assert.equal(reportsRoot({ env: { AUDIT_OUT_DIR: '~/r' }, home, isDir: () => true, readFile: none }), '/home/u/r');
});

test('reportsRoot: the XDG download folder comes before ~/Downloads', () => {
  const readFile = () => 'XDG_DOWNLOAD_DIR="$HOME/Hentet"\n';
  assert.equal(reportsRoot({ env: {}, home, isDir: () => true, readFile }), '/home/u/Hentet');
  assert.equal(reportsRoot({ env: { XDG_DOWNLOAD_DIR: '/data/dl' }, home, isDir: () => true, readFile: none }), '/data/dl');
});

test('reportsRoot: ~/Downloads only if it exists, else ~/audit-reports', () => {
  assert.equal(reportsRoot({ env: {}, home, isDir: (p) => p === '/home/u/Downloads', readFile: none }), '/home/u/Downloads');
  assert.equal(reportsRoot({ env: {}, home, isDir: () => false, readFile: none }), '/home/u/audit-reports');
});

test('resolveOutDir: --out is used as given, ~ expanded', () => {
  assert.equal(resolveOutDir('~/x', 'a.com', { home }), '/home/u/x');
  assert.equal(resolveOutDir('rel', 'a.com', { home }), path.resolve('rel'));
  assert.equal(resolveOutDir(null, 'a.com', { home, base: '/b', now: '20261030-0800' }), '/b/tech-stack/a.com-20261030-0800');
});
