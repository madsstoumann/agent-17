import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { targetDir, isTool, renameLegacy, adoptLegacy } from '../lib/target-state.mjs';
import { discoverReports } from '../lib/report.mjs';

test('targetDir moves a target folder kept under the old skill name', () => {
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-legacy-'));
  try {
    fs.mkdirSync(path.join(reports, 'launch-audit', 'www.shop.dk'), { recursive: true });
    fs.writeFileSync(path.join(reports, 'launch-audit', 'www.shop.dk', 'notes.md'), 'keep me\n');
    const dir = targetDir({ reports, skill: 'audit-launch', name: 'www.shop.dk' });
    assert.equal(dir, path.join(reports, 'audit-launch', 'www.shop.dk'));
    assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), 'keep me\n');
    assert.ok(!fs.existsSync(path.join(reports, 'launch-audit')), 'old folder gone');
  } finally { fs.rmSync(reports, { recursive: true, force: true }); }
});

test('adoptLegacy merges into an existing new folder and never overwrites', () => {
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-legacy-'));
  try {
    for (const [skill, host, text] of [['security-audit', 'shop-web', 'old'], ['security-audit', 'cms', 'old cms'], ['audit-security', 'shop-web', 'new']]) {
      fs.mkdirSync(path.join(reports, skill, host), { recursive: true });
      fs.writeFileSync(path.join(reports, skill, host, 'notes.md'), text);
    }
    assert.equal(adoptLegacy(reports, 'audit-security'), true);
    assert.equal(fs.readFileSync(path.join(reports, 'audit-security', 'shop-web', 'notes.md'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(reports, 'audit-security', 'cms', 'notes.md'), 'utf8'), 'old cms');
    assert.ok(fs.existsSync(path.join(reports, 'security-audit', 'shop-web')), 'clashing entry left where it was');
    assert.equal(adoptLegacy(reports, 'audit-all'), false, 'audit-all had no old name');
  } finally { fs.rmSync(reports, { recursive: true, force: true }); }
});

test('isTool and renameLegacy accept the old names', () => {
  assert.ok(isTool('launch-audit', 'audit-launch'));
  assert.ok(isTool('audit-launch', 'audit-launch'));
  assert.ok(!isTool('seo-audit', 'audit-launch'));
  assert.equal(renameLegacy('security-audit-shop-web'), 'audit-security-shop-web');
  assert.equal(renameLegacy('a11y-audit'), 'audit-a11y');
  assert.equal(renameLegacy('solution-health-shop-web'), 'solution-health-shop-web');
});

test('discoverReports reads run folders written before the rename', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-legacy-run-'));
  try {
    for (const name of ['launch-audit', 'security-audit-shop-web', 'audit-seo']) {
      fs.mkdirSync(path.join(run, name));
      fs.writeFileSync(path.join(run, name, 'report.md'), `# ${name}\n`);
    }
    const found = discoverReports(run).map((r) => [r.kind, r.target, r.folder]);
    assert.deepEqual(found, [['audit-launch', null, 'launch-audit'], ['audit-seo', null, 'audit-seo'], ['audit-security', 'shop-web', 'security-audit-shop-web']]);
  } finally { fs.rmSync(run, { recursive: true, force: true }); }
});
