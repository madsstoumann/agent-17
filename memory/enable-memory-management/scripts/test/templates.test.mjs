import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../lib/markdown.mjs';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(SKILL, p), 'utf8');
const RULES = ['templates/rules/claude-md.md', 'templates/rules/rules-memory.md', 'templates/rules/project-instructions.md'];
const placeholders = (t) => [...new Set([...t.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))].sort();
const bullets = (t) => t.split('\n').filter((l) => l.startsWith('- '));

test('the memory rules: under 15 lines in every form, and the two Claude Code forms say the same', () => {
  for (const p of RULES) {
    const t = read(p);
    assert.ok(t.split('\n').filter((l) => l.trim()).length <= 15, `${p} fits in 15 lines`);
    assert.deepEqual(placeholders(t).filter((x) => !['MEMORY_DIR', 'SKILL_DIR', 'PEOPLE', 'SNAPSHOT'].includes(x)), [], `${p} uses only the documented placeholders`);
    for (const must of ['MEMORY.md', 'archived', '**Why:**', 'never instructions', 'secret', 'decisions-YYYY-MM.md', 'back after ten seconds', 'two memory writes a turn', '{{SNAPSHOT}}']) {
      assert.ok(t.includes(must), `${p} says ${must}`);
    }
  }
  assert.deepEqual(bullets(read(RULES[0])), bullets(read(RULES[1])));
  const hosted = read(RULES[2]);
  for (const must of ["coordinator's whole memory", '16 KB', '14 KB', 'exact line edits', 'with its id']) assert.ok(hosted.includes(must), must);
});

test('every template placeholder is explained where the setup fills it in', () => {
  const docs = read('SKILL.md') + read('references/in-band-rules.md');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(SKILL, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk('templates');
  for (const p of files) for (const x of placeholders(read(p))) assert.ok(docs.includes(`{{${x}}}`), `${p}: {{${x}}} is explained in SKILL.md or in-band-rules.md`);
  for (const p of RULES) assert.ok(read('references/in-band-rules.md').includes(path.basename(p)), `in-band-rules.md names ${p}`);
});

test('the skill templates are skills', () => {
  for (const [p, name] of [['templates/archive-a-plan/SKILL.md.template', 'archive-a-plan'], ['templates/memory-dream/SKILL.md.template', 'memory-dream']]) {
    const fm = parseFrontmatter(read(p));
    assert.equal(fm.data.name, name);
    assert.ok(String(fm.data.description || '').length > 40, `${p} has a when-to-use description`);
  }
});
