// Every project skill's SKILL.md metadata.version must be the newest CHANGELOG.md entry; the plugin,
// the marketplace and project/README.md must name every skill on disk; and every plugin this one
// depends on must be in the same marketplace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skills = fs.readdirSync(project).filter((n) => fs.existsSync(path.join(project, n, 'SKILL.md')));
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const plugin = json(path.join(project, '.claude-plugin', 'plugin.json'));
const market = json(path.join(project, '..', '.claude-plugin', 'marketplace.json'));

test('every project skill: SKILL.md version is the newest CHANGELOG entry, and its name is its folder', () => {
  assert.ok(skills.length >= 1, 'expected at least one project skill');
  for (const name of skills) {
    const md = fs.readFileSync(path.join(project, name, 'SKILL.md'), 'utf8');
    assert.equal(md.match(/^name:\s*(\S+)/m)?.[1], name, `${name}: SKILL.md name`);
    const want = md.match(/^metadata:\s*\n(?:\s+.*\n)*?\s+version:\s*"([^"]+)"/m)?.[1];
    assert.ok(want, `${name}: SKILL.md has no quoted metadata.version`);
    const top = fs.readFileSync(path.join(project, name, 'CHANGELOG.md'), 'utf8').match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
    assert.equal(top, want, `${name}: CHANGELOG says ${top}, SKILL.md says ${want}`);
  }
});

test('plugin, marketplace and project/README.md name every project skill', () => {
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, `marketplace has no "${plugin.name}" plugin`);
  assert.equal(entry.source, './project');
  const readme = fs.readFileSync(path.join(project, 'README.md'), 'utf8');
  for (const name of skills) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(plugin.description), `plugin.json description misses ${name}`);
    assert.ok(new RegExp(`\\b${name}\\b`).test(entry.description), `marketplace description misses ${name}`);
    assert.ok(readme.includes(`](${name}/SKILL.md)`), `project/README.md contents miss ${name}`);
  }
});

test('dependencies: memory is declared, the audits are not, and each one is in this marketplace', () => {
  assert.deepEqual(plugin.dependencies, ['memory']);
  for (const d of plugin.dependencies) assert.ok(market.plugins.some((p) => p.name === d), `"${d}" is not a plugin in this marketplace`);
  const readme = fs.readFileSync(path.join(project, 'README.md'), 'utf8');
  assert.ok(readme.includes('declared dependency') && readme.includes('add **memory** yourself'), 'README says what is installed with it, and what is not on claude.ai');
});
