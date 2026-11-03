import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLevel, levelOf, levelOfWord, shows, byLevel, countLevels, levelNote, consoleList } from '../lib/levels.mjs';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('every report-writing skill carries the same levels.mjs', () => {
  const copies = ['audit-launch', 'audit-a11y', 'audit-seo', 'audit-eco', 'audit-privacy', 'audit-infra', 'audit-security', 'audit-solution-health', 'audit-all', 'enable-memory-management']
    .map((s) => path.join(SKILLS, s, 'scripts', 'lib', 'levels.mjs'))
    .filter((f) => fs.existsSync(f));
  assert.ok(copies.length >= 1);
  const mine = fs.readFileSync(path.join(SKILLS, 'audit-all', 'scripts', 'lib', 'levels.mjs'), 'utf8');
  for (const f of copies) assert.equal(fs.readFileSync(f, 'utf8'), mine, `${f} differs from audit-all's copy`);
});

test('parseLevel: the four combinations, aliases and errors', () => {
  assert.equal(parseLevel(undefined).all, true);
  assert.equal(parseLevel('all').label, 'all');
  assert.deepEqual([parseLevel('error').label, parseLevel('error').words], ['errors only', 'error']);
  assert.deepEqual([parseLevel('warnings').label, parseLevel('warnings').words], ['warnings only', 'warn']);
  const ew = parseLevel('warn,errors');
  assert.deepEqual([ew.error, ew.warn, ew.info, ew.label, ew.words], [true, true, false, 'errors and warnings', 'error,warn']);
  assert.equal(parseLevel('error+warn+info').label, 'errors, warnings and info');
  assert.throws(() => parseLevel('critical'), /--level must be/);
  assert.throws(() => parseLevel('all,error'), /cannot be combined/);
});

test('levelOf: one scale across statuses, severities and traffic lights', () => {
  for (const w of ['fail', 'blocker', 'critical', 'high', 'red', 'urgent']) assert.equal(levelOfWord(w), 'error', w);
  for (const w of ['warn', 'medium', 'moderate', 'low', 'amber', 'MODERATE']) assert.equal(levelOfWord(w), 'warn', w);
  for (const w of ['info', 'unknown']) assert.equal(levelOfWord(w), 'info', w);
  for (const w of ['pass', 'green', 'skip', 'ignored']) assert.equal(levelOfWord(w), null, w);
  assert.equal(levelOf({ status: 'pass', severity: 'high' }), null, 'a passing check stays a pass');
  assert.equal(levelOf({ status: 'warn', severity: 'high' }), 'warn', 'the check status wins');
  assert.equal(levelOf({ severity: 'blocker' }), 'error');
  assert.equal(levelOf({ level: 'amber' }), 'warn');
  assert.equal(levelOf({ status: 'unknown' }), 'info');
});

test('shows, byLevel, countLevels and levelNote', () => {
  const rows = [{ status: 'fail' }, { status: 'warn' }, { status: 'info' }, { status: 'pass' }];
  assert.equal(byLevel(rows, parseLevel('all')).length, 4, 'all keeps passes');
  assert.deepEqual(byLevel(rows, parseLevel('error,warn')).map((r) => r.status), ['fail', 'warn']);
  assert.equal(shows(null, rows[3]), true);
  assert.deepEqual(countLevels(rows), { error: 1, warn: 1, info: 1 });
  assert.equal(levelNote(parseLevel('all')), '');
  assert.equal(levelNote(parseLevel('error'), { hidden: 3 }), '> Showing errors only (`--level error`); 3 other rows hidden. The full results are in report.json.');
});

test('consoleList: one aligned line per issue, errors first, counts in the title', () => {
  const items = [
    { level: 'warn', source: 'headers', id: 'csp', title: 'CSP allows unsafe-inline', where: 'script-src' },
    { level: 'error', source: 'exposed', id: 'env', title: '.env is served', where: '/.env 200' },
    { level: 'info', source: 'ops', id: 'x', title: 'Note' },
    { level: null, title: 'a pass' },
  ];
  const all = consoleList({ title: 'audit-launch x.dk', items }).split('\n');
  assert.equal(all[0], 'audit-launch x.dk — 1 error · 1 warning · 1 info');
  assert.equal(all[1], 'ERROR  exposed  env  .env is served · /.env 200');
  assert.equal(all[2], 'WARN   headers  csp  CSP allows unsafe-inline · script-src');
  assert.equal(all[3], 'INFO   ops      x    Note');
  assert.equal(all.length, 4);
  const warn = consoleList({ title: 't', items, levels: parseLevel('warn') }).split('\n');
  assert.equal(warn[0], 't — 1 error · 1 warning · 1 info — showing warnings only');
  assert.equal(warn.length, 2);
  assert.equal(consoleList({ title: 't', items: [], levels: parseLevel('error') }), 't — 0 errors · 0 warnings · 0 info — showing errors only\nNo errors.');
  assert.match(consoleList({ items, max: 1 }), /\+2 more$/);
});
