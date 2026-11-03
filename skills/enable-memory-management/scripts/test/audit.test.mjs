import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit, parseArgs } from '../audit.mjs';
import { parseFrontmatter, meta, wikiLinks, mdLinks, codePaths, prosePaths, boldBullets, shellBlocks } from '../lib/markdown.mjs';
import { planStatus } from '../lib/checks.mjs';
import { stepsFor, renderReport } from '../lib/report.mjs';
import { projectSlug, imports } from '../lib/discover.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures');
const SKILLS = path.join(here, '..', '..', '..');

/** A copy of the fixture store with a fake secret written at test time (never committed). */
function memoryCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emm-mem-'));
  for (const f of fs.readdirSync(path.join(FIX, 'memory'))) fs.copyFileSync(path.join(FIX, 'memory', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'leak.md'), `---\nname: leak\ndescription: x\nmetadata:\n  type: reference\n---\n\nkey ${'sk-' + 'ant-' + 'x'.repeat(32)}\n`);
  return dir;
}

const run = (extra = {}) => audit({ ...parseArgs(['--root', path.join(FIX, 'project'), '--transcripts', 'none', '--today', '2026-11-03']), budgetLines: 10, ...extra });
const ids = (r) => r.findings.map((x) => x.id);
const find = (r, id, where) => r.findings.filter((x) => x.id === id && (!where || x.where.includes(where)));

test('markdown helpers: frontmatter, links, paths, bullets, shell blocks', () => {
  const fm = parseFrontmatter('---\nname: a\ndescription: "b c"\nmetadata:\n  type: user\n  source: [x, y]\n---\nbody');
  assert.equal(fm.data.name, 'a');
  assert.equal(fm.data.description, 'b c');
  assert.equal(meta(fm.data, 'type'), 'user');
  assert.deepEqual(meta(fm.data, 'source'), ['x', 'y']);
  assert.equal(fm.body, 'body');
  assert.equal(parseFrontmatter('no frontmatter').raw, null);
  assert.deepEqual(wikiLinks('see [[a]], [[b|label]] and [[a]]'), ['a', 'b']);
  assert.deepEqual(mdLinks('[x](docs/a.md#top) [y](https://e.com) [z](#here)\n```\n[q](in-fence.md)\n```'), ['docs/a.md']);
  assert.deepEqual(codePaths('`scripts/a.py` `src/b.ts:12` `docs/*.md` `content/x(.da).json` `PLAN.md` `npm run build` `<id>.json`'), ['scripts/a.py', 'src/b.ts', 'PLAN.md']);
  assert.deepEqual(prosePaths('See docs/plans/a.md §4, and (scripts/b.py). Not `docs/c.md`, not https://x.com/d/e.md, not [l](docs/f.md), not docs/folder/.'), ['docs/plans/a.md', 'scripts/b.py']);
  const b = boldBullets('- **One.** text\n  more\n- **Two.** x\n\nafter');
  assert.deepEqual(b.map((x) => x.title), ['One.', 'Two.']);
  assert.match(b[0].text, /more/);
  const s = shellBlocks('## Run\n```sh\nnpm ci\nnpm test # tests\n```\n```js\nconst a = 1;\n```');
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].commands, ['npm ci', 'npm test']);
  assert.equal(s[0].heading, 'Run');
});

test('planStatus reads the header, and a negation wins', () => {
  assert.equal(planStatus('# P\n\n> **Built 2026-10-01** on x'), 'built');
  assert.equal(planStatus('# P\nStatus, 2026-10-13: built and verified'), 'built');
  assert.equal(planStatus('# P\nA plan; nothing is built.'), 'open');
  assert.equal(planStatus('# P\nItems need a decision before anything is built.'), 'open');
  assert.equal(planStatus('# P\nNothing\nhere is built yet.'), 'open');
  assert.equal(planStatus('# P\nWhat is already merged, on this branch'), 'unknown');
});

test('discover: project slug and @imports', () => {
  assert.equal(projectSlug('/home/user/my.repo'), '-home-user-my-repo');
  const p = imports('Read @AGENTS.md and @docs/x.md\n```\n@not-this.md\n```\n`@nor-this.md`', '/r/CLAUDE.md');
  assert.deepEqual(p, ['/r/AGENTS.md', '/r/docs/x.md']);
});

test('instructions: budget, moved paths, long rules, procedures', () => {
  const r = run();
  assert.deepEqual(r.instructions.loaded.map((x) => x.rel), ['CLAUDE.md', 'AGENTS.md']);
  assert.ok(find(r, 'I1').length, 'over the 10-line budget');
  const moved = find(r, 'I3', 'AGENTS.md')[0];
  assert.deepEqual(moved.detail.moved, [['docs/plans/old-plan.md', 'docs/archive/old-plan.md']]);
  assert.equal(find(r, 'I5')[0].detail.rules.length, 1);
  assert.equal(find(r, 'I6').length, 1, 'the long rule names docs/FEATURE.md');
  assert.ok(!ids(r).includes('I0') && !ids(r).includes('I2'), 'CLAUDE.md exists and imports AGENTS.md');
  const proc = r.candidates.find((c) => c.name === 'Running the site');
  assert.ok(proc);
  assert.equal(proc.covered, true, 'the deploy skill names scripts/run.py');
});

test('docs: moved and missing paths, built plans, orphans; archives and placeholders stay quiet', () => {
  const r = run();
  assert.deepEqual(find(r, 'D2', 'FEATURE')[0].detail.missing, ['scripts/gone.py']);
  assert.deepEqual(find(r, 'D1', 'FEATURE')[0].detail.moved, [['scripts/run.py', '../scripts/run.py']], 'a link relative to the wrong folder gets the path from the doc');
  assert.deepEqual(find(r, 'D3').map((x) => x.where), ['docs/plans/built-plan.md']);
  assert.deepEqual(find(r, 'D4').map((x) => x.where), ['docs/ORPHAN.md']);
  assert.equal(r.docs.plans.find((p) => p.path.endsWith('open-plan.md')).status, 'open');
  const archived = find(r, 'D1', 'archive/old-plan.md')[0];
  assert.equal(archived?.level, 'info', 'a stale link inside the archive is history, not a warning');
});

test('memory: index, links, frontmatter, secrets, duplicates, stale and dead paths', () => {
  const dir = memoryCopy();
  const r = run({ memory: dir });
  const m = Object.fromEntries(r.findings.filter((x) => x.source === 'memory').map((x) => [x.id, x]));
  assert.ok(m.M3, 'a long index line');
  assert.deepEqual(m.M4.detail.files.sort(), ['feedback-tone.md', 'leak.md', 'loose.md']);
  assert.deepEqual(m.M6.detail.links, [['MEMORY.md', 'missing-note']]);
  assert.equal(m.M7.level, 'error');
  assert.match(m.M7.where, /leak\.md/);
  assert.ok(!JSON.stringify(r).includes('x'.repeat(32)), 'the secret never reaches the report');
  assert.match(m.M8.where, /loose\.md/);
  assert.match(m.M10.where, /feedback-tone/);
  assert.match(m.M12.where, /feedback-tone/);
  assert.match(m.M13.where, /deploy-habits/);
  assert.equal(m.M14.detail.files[0].missing[0], 'scripts/deploy.py');
  assert.deepEqual(m.M15.detail.pairs.map((p) => p.slice(0, 2)), [['deploy-habits.md', 'user-role.md']]);
  assert.equal(r.memory.files, 5);
  assert.equal(r.memory.index.lines, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('steps follow the findings, and the report renders every section', () => {
  const dir = memoryCopy();
  const r = run({ memory: dir, transcripts: path.join(FIX, 'transcripts') });
  const steps = stepsFor(r.findings).map((s) => s.id);
  for (const s of ['E1', 'E2', 'E3', 'E6', 'E7', 'E8']) assert.ok(steps.includes(s), s);
  const md = renderReport(r);
  for (const h of ['## The layers', '## Findings', '## Enable steps that apply', '## Paths to moved files', '## Skill candidates', '## Plans', '## Corrections in the sessions']) assert.ok(md.includes(h), h);
  assert.ok(r.transcripts.commands.some((c) => c.command === 'python3 scripts/run.py' && c.sessions === 3));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: --lint exits 1 on errors and writes nothing; a normal run writes report.md and compares with the last one', () => {
  const dir = memoryCopy();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'emm-state-'));
  const cli = path.join(here, '..', 'audit.mjs');
  let code = 0;
  let out = '';
  try { out = execFileSync('node', [cli, '--root', path.join(FIX, 'project'), '--memory', dir, '--transcripts', 'none', '--lint'], { encoding: 'utf8' }); } catch (e) { code = e.status; out = e.stdout; }
  assert.equal(code, 1);
  assert.match(out, /ERROR/);
  assert.doesNotMatch(out, /INFO/);
  const args = [cli, '--root', path.join(FIX, 'project'), '--memory', dir, '--transcripts', 'none', '--state', state];
  const first = JSON.parse(execFileSync('node', args, { encoding: 'utf8' }));
  assert.ok(fs.existsSync(first.report));
  assert.ok(fs.existsSync(path.join(state, 'last-report.json')));
  const second = JSON.parse(execFileSync('node', args, { encoding: 'utf8' }));
  assert.match(fs.readFileSync(second.report, 'utf8'), /Since the last run/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

test('shared helpers are identical to the other skills\' copies', () => {
  for (const [file, owner] of [['levels.mjs', 'audit-all'], ['target-state.mjs', 'audit-security']]) {
    const theirs = path.join(SKILLS, owner, 'scripts', 'lib', file);
    if (!fs.existsSync(theirs)) continue;
    assert.equal(fs.readFileSync(path.join(here, '..', 'lib', file), 'utf8'), fs.readFileSync(theirs, 'utf8'), file);
  }
});
