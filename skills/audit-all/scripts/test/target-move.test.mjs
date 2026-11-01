import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { targetDir } from '../lib/target-state.mjs';

test('targetDir moves an old <reports>/launch-audit/ folder once, never overwriting', () => {
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-move-'));
  try {
    for (const [skill, host, text] of [['launch-audit', 'www.shop.dk', 'old'], ['launch-audit', 'cms.dk', 'old cms'], ['audit-launch', 'www.shop.dk', 'new']]) {
      fs.mkdirSync(path.join(reports, skill, host), { recursive: true });
      fs.writeFileSync(path.join(reports, skill, host, 'notes.md'), text);
    }
    assert.equal(targetDir({ reports, skill: 'audit-launch', name: 'cms.dk' }), path.join(reports, 'audit-launch', 'cms.dk'));
    assert.equal(fs.readFileSync(path.join(reports, 'audit-launch', 'cms.dk', 'notes.md'), 'utf8'), 'old cms');
    assert.equal(fs.readFileSync(path.join(reports, 'audit-launch', 'www.shop.dk', 'notes.md'), 'utf8'), 'new');
  } finally { fs.rmSync(reports, { recursive: true, force: true }); }
});
