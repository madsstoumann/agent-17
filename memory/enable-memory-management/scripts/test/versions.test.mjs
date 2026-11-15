// Every memory skill's SKILL.md metadata.version must be the newest CHANGELOG.md entry, and the
// plugin and marketplace descriptions must name every memory skill on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const memory = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const skills = fs.readdirSync(memory).filter(n => fs.existsSync(path.join(memory, n, 'SKILL.md')));

test('every memory skill: SKILL.md version is the newest CHANGELOG entry', () => {
  assert.ok(skills.length >= 2, `expected the memory skills, found ${skills.length}`);
  for (const name of skills) {
    const md = fs.readFileSync(path.join(memory, name, 'SKILL.md'), 'utf8');
    const want = md.match(/^metadata:\s*\n(?:\s+.*\n)*?\s+version:\s*"([^"]+)"/m)?.[1];
    assert.ok(want, `${name}: SKILL.md has no quoted metadata.version`);
    const log = fs.readFileSync(path.join(memory, name, 'CHANGELOG.md'), 'utf8');
    const top = log.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
    assert.equal(top, want, `${name}: CHANGELOG says ${top}, SKILL.md says ${want}`);
  }
});

test('plugin, marketplace and memory/README.md name every memory skill', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(memory, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(memory, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = market.plugins.find(p => p.name === plugin.name);
  assert.ok(entry, `marketplace has no "${plugin.name}" plugin`);
  const readme = fs.readFileSync(path.join(memory, 'README.md'), 'utf8');
  for (const name of skills) {
    assert.ok(plugin.description.includes(name), `plugin.json description misses ${name}`);
    assert.ok(entry.description.includes(name), `marketplace description misses ${name}`);
    assert.ok(readme.includes(`](${name}/SKILL.md)`), `memory/README.md contents miss ${name}`);
  }
});
