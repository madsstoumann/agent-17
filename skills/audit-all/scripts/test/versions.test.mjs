// The version a script prints (report headers, the combined report's section heads) must be the
// version in its SKILL.md metadata. A run on example.dk showed audit-launch 2.1.1 and audit-infra 2.1.0 in
// the section heads while their SKILL.md said 2.2.0, because the script constants were not bumped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const skills = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

function scriptFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...scriptFiles(p));
    else if (/\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('every script VERSION constant matches its SKILL.md metadata.version', () => {
  let checked = 0;
  for (const name of fs.readdirSync(skills)) {
    const skillMd = path.join(skills, name, 'SKILL.md');
    const scripts = path.join(skills, name, 'scripts');
    if (!fs.existsSync(skillMd) || !fs.existsSync(scripts)) continue;
    const want = fs.readFileSync(skillMd, 'utf8').match(/^metadata:\s*\n(?:\s+.*\n)*?\s+version:\s*"([^"]+)"/m)?.[1];
    assert.ok(want, `${name}: SKILL.md has no metadata.version`);
    for (const f of scriptFiles(scripts)) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/export const VERSION = ['"]([^'"]+)['"]/g)) {
        assert.equal(m[1], want, `${path.relative(skills, f)} says ${m[1]}, SKILL.md says ${want}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 9, `expected the audit scripts' VERSION constants, found ${checked}`);
});
