import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, setMeta, list, table, section } from '../lib/md.mjs';
import { bump } from '../lib/project.mjs';
import { scaffold, questionsFor } from '../scaffold.mjs';
import { build } from '../build.mjs';
import { check, frontier } from '../check.mjs';
import { answer, addQuestion } from '../answer.mjs';
import { create, set, listRecords } from '../record.mjs';
import { addFile, sizes } from '../file.mjs';
import { status, setPhase } from '../status.mjs';
import { report, period } from '../report.mjs';
import { tokens, exportTokens, toCss, toJson } from '../tokens.mjs';
import { timeline, addMilestone, setMilestone } from '../timeline.mjs';
import { pr } from '../pr.mjs';
import { execFileSync } from 'node:child_process';

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BANK = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'templates/questions.json'), 'utf8')).questions;
// One invented project. Nothing in this plugin names a real one.
const NAME = 'Harbour Books';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
const fresh = (size = 'small') => { const root = tmp(); scaffold({ root, name: NAME, size, date: '2026-11-25' }); build(root); return root; };
const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');
const header = (root, p) => parseFrontmatter(read(root, p)).data;
const record = (root, name, meta, body = '## Asked\n\nx\n\n## Why\n\ny\n\n## Deltas\n\n- design: added a dark colour group\n') => {
  const m = Object.entries(meta).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n');
  fs.writeFileSync(path.join(root, 'project/memory/changes', `${name}.md`), `---\nname: ${name}\ndescription: ${meta.title}\nmetadata:\n  type: change\n${m}\n---\n\n${body}`);
};
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };

test('frontmatter: nesting, lists, quoted versions, block lists skipped, setMeta keeps the rest', () => {
  const t = read(fresh(), 'project/building-blocks/DESIGN.md');
  const { data } = parseFrontmatter(t);
  assert.equal(data.version, 'alpha');
  assert.equal(data.metadata.version, '0.1.0');
  assert.deepEqual(data.metadata.depends_on, ['experience', 'boundaries']);
  assert.equal(data.metadata.owner, 'designer');
  const next = setMeta(t, 'version', '1.2.0');
  assert.equal(parseFrontmatter(next).data.metadata.version, '1.2.0');
  assert.equal(next.replace('version: "1.2.0"', 'version: "0.1.0"'), t, 'only that line changed');
  assert.ok(next.includes('version: alpha'), "DESIGN.md's own spec version is untouched");
  assert.deepEqual(list({}), []);
});

test('version steps', () => {
  assert.equal(bump('0.1.0', 'patch'), '0.1.1');
  assert.equal(bump('0.1.1', 'minor'), '0.2.0');
  assert.equal(bump('0.2.0', 'complete'), '1.0.0');
  assert.equal(bump('1.3.2', 'complete'), '1.3.2');
  assert.equal(bump('1.3.2', 'minor'), '1.4.0');
  assert.equal(bump('1.4.0', 'major'), '2.0.0');
  assert.throws(() => bump('1.0.0', 'huge'));
});

test('a new project: six written files, three kept, and a clean check', () => {
  const root = fresh('small');
  const r = check(root, { today: '2026-11-25' });
  assert.deepEqual(r.findings, []);
  assert.equal(r.files.total, 5, 'five written files carry a header; AGENTS.md carries none');
  for (const p of ['AGENTS.md', 'project/INDEX.md', 'project/memory/state.md', 'project/memory/decisions.md', 'project/foundation/product-context.md', 'project/foundation/technical-context.md', 'project/intent/experience.md', 'project/intent/boundaries.md', 'project/building-blocks/DESIGN.md']) assert.ok(fs.existsSync(path.join(root, p)), p);
  assert.ok(!fs.existsSync(path.join(root, 'CLAUDE.md')), 'no CLAUDE.md is written');
  assert.ok(!/\{\{/.test(walk(root).map((p) => fs.readFileSync(p, 'utf8')).join('')), 'no placeholder left');
  assert.ok(read(root, 'AGENTS.md').length < 1200, 'AGENTS.md stays short');
  for (const p of walk(path.join(root, 'project')).filter((f) => f.endsWith('.md'))) for (const l of fs.readFileSync(p, 'utf8').split('\n').filter((x) => /^(name|description): /.test(x))) assert.ok(!/^\w+: [^"].*: /.test(l), `${p}: an unquoted value with ": " is not valid YAML: ${l}`);
  assert.throws(() => scaffold({ root: tmp(), name: 'A "quoted" name' }));
  assert.equal(r.questions.total, questionsFor('small').length);
  assert.equal(r.questions.answered, 0);
});

test('size sets how much is asked', () => {
  const n = (s) => questionsFor(s).length;
  assert.ok(n('small') < n('medium') && n('medium') < n('large'));
  assert.equal(n('large'), BANK.length);
  assert.throws(() => scaffold({ root: tmp(), name: NAME, size: 'huge' }));
});

test('running the scaffold again overwrites nothing', () => {
  const root = fresh();
  fs.appendFileSync(path.join(root, 'project/intent/boundaries.md'), '\nNever sells a customer list.\n');
  const again = scaffold({ root, name: 'Another name', size: 'large', date: '2027-01-01' });
  assert.deepEqual(again.written, []);
  assert.ok(again.kept.includes('project/intent/boundaries.md'));
  assert.ok(read(root, 'project/intent/boundaries.md').includes('Never sells a customer list.'));
  assert.ok(read(root, 'AGENTS.md').includes(NAME));
});

test('an existing CLAUDE.md is reported, and warned about until it imports AGENTS.md', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Notes\n');
  const r = scaffold({ root, name: NAME, date: '2026-11-25' });
  assert.deepEqual(r.claudeMd, { path: 'CLAUDE.md', importsAgents: false });
  build(root);
  assert.ok(check(root).findings.some((f) => f.file === 'CLAUDE.md' && f.level === 'warn'));
  fs.appendFileSync(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.ok(!check(root).findings.some((f) => f.file === 'CLAUDE.md'));
});

test('the interview: rounds follow prerequisites, and it resumes from what is on disk', () => {
  const root = fresh('small');
  const first = frontier(root, BANK).map((q) => q.id);
  assert.ok(first.includes('what') && !first.includes('who'), '"who" waits for "what"');
  assert.ok(frontier(root, BANK).every((q) => q.section), 'each question names the heading its answer goes under');
  answer(root, { id: 'what', status: 'answered', date: '2026-11-25' });
  // a later session knows nothing but the files
  const second = frontier(root, BANK).map((q) => q.id);
  assert.ok(second.includes('who') && !second.includes('what'), 'no question is asked twice');
  assert.deepEqual(check(root).findings, [], 'state.md and the headers agree');
  assert.ok(!list(header(root, 'project/foundation/product-context.md').metadata.open).includes('what'));
});

test('skipped and parked questions stay open on their file; the last answer makes it active', () => {
  const root = fresh('small');
  const mine = questionsFor('small').filter((q) => q.file === 'boundaries').map((q) => q.id);
  answer(root, { id: mine[0], status: 'parked', note: 'needs the legal review | see notes' });
  assert.equal(header(root, 'project/intent/boundaries.md').metadata.status, 'draft');
  assert.equal(table(parseFrontmatter(read(root, 'project/memory/state.md')).body, 'Questions').find((q) => q.id === mine[0]).note, 'needs the legal review | see notes');
  let last;
  for (const id of mine) last = answer(root, { id, status: 'answered' });
  assert.equal(last.fileStatus, 'active');
  assert.deepEqual(last.stillOpen, []);
  const r = check(root);
  assert.equal(r.questions.byRole.pm.parked.length, 0);
  assert.ok(!r.files.draft.includes('boundaries'));
  assert.throws(() => answer(root, { id: 'nope', status: 'answered' }));
});

test('the kind of project changes the wording, never the number of questions', () => {
  const ask = (kind, id) => questionsFor('medium', kind).find((q) => q.id === id).ask;
  assert.ok(/client contact/.test(ask('client', 'roles')) && !/client/.test(ask('library', 'roles')));
  assert.ok(/pays/.test(ask('client', 'who')) && !/pays/.test(ask('library', 'who')));
  assert.ok(/licence/.test(ask('library', 'compliance')));
  for (const k of ['product', 'library']) {
    assert.equal(questionsFor('large', k).length, BANK.length);
    assert.ok(!questionsFor('large', k).some((q) => /\bclient/i.test(q.ask)), `${k}: no question mentions a client`);
  }
  const root = tmp();
  assert.equal(scaffold({ root, name: NAME, kind: 'library', date: '2026-11-25' }).kind, 'library');
  build(root);
  assert.equal(check(root).kind, 'library');
  assert.ok(!/client/.test(read(root, 'project/memory/state.md').split('## Questions')[1]));
  assert.throws(() => scaffold({ root: tmp(), name: NAME, kind: 'hobby' }));
  for (const q of BANK) for (const k of Object.keys(q.askFor ?? {})) assert.ok(['product', 'library'].includes(k), `${q.id}: askFor.${k}`);
});

test('a draft from the repo unlocks the next round, is asked first, and keeps its file a draft', () => {
  const root = fresh('small');
  answer(root, { id: 'what', status: 'draft', note: 'from the README' });
  const round = frontier(root, BANK);
  assert.equal(round[0].id, 'what', 'the draft comes first, to be confirmed');
  assert.equal(round[0].status, 'draft');
  assert.ok(round.some((q) => q.id === 'who'), 'what depends on it is no longer held up');
  const r = check(root);
  assert.deepEqual(r.findings, []);
  assert.equal(r.questions.draft, 1);
  assert.equal(r.questions.answered, 0, 'a draft is not an answer');
  assert.deepEqual(r.questions.byRole.pm.draft, ['what']);
  assert.ok(list(header(root, 'project/foundation/product-context.md').metadata.open).includes('what'));
  answer(root, { id: 'what', status: 'answered' });
  assert.ok(!frontier(root, BANK).some((q) => q.id === 'what'));
  assert.throws(() => answer(root, { id: 'what', status: 'maybe' }));
});

test('a DESIGN.md the repo already has is kept as the design file: no second one, no questions about it', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# Design\n');
  const r = scaffold({ root, name: NAME, size: 'large', date: '2026-11-25' });
  assert.equal(r.designMd, 'DESIGN.md');
  assert.ok(!fs.existsSync(path.join(root, 'project/building-blocks/DESIGN.md')));
  assert.ok(!r.written.some((w) => /DESIGN/.test(w)));
  build(root);
  const c = check(root);
  assert.deepEqual(c.findings, []);
  assert.ok(!c.questions.byRole.designer, 'the designer is asked nothing by the scaffold');
  assert.equal(read(root, 'DESIGN.md'), '# Design\n', 'the existing file is not touched');
  assert.equal(scaffold({ root: tmp(), name: NAME }).designMd, null);
});

test('a parked or skipped question does not hold up what follows; --role narrows the round', () => {
  const root = fresh('medium');
  for (const id of ['what', 'starting-point', 'systems', 'who', 'compliance']) answer(root, { id, status: 'answered' });
  assert.ok(!frontier(root, BANK).some((q) => q.id === 'choices'), '"choices" waits while hosting is open');
  answer(root, { id: 'hosting', status: 'parked', note: 'after the vendor replies' });
  const round = frontier(root, BANK).map((q) => q.id);
  assert.ok(round.includes('choices') && round.includes('tech-constraints'));
  assert.ok(!round.includes('hosting'), 'a parked question is not asked in a round');
  const mine = frontier(root, BANK, 'tech-lead');
  assert.ok(mine.length && mine.every((q) => q.role === 'tech-lead'));
});

test('a question found on the way is tracked like the others', () => {
  const root = fresh('small');
  const r = addQuestion(root, { id: 'legacy-urls', file: 'technical-context', role: 'tech-lead', ask: 'Which old URLs must keep working?' });
  assert.ok(r.stillOpen.includes('legacy-urls'));
  assert.deepEqual(check(root).findings, []);
  assert.throws(() => addQuestion(root, { id: 'legacy-urls', file: 'technical-context', role: 'tech-lead', ask: 'again' }));
});

test('state.md and a header that disagree is an error', () => {
  const root = fresh('small');
  const p = path.join(root, 'project/intent/experience.md');
  fs.writeFileSync(p, setMeta(fs.readFileSync(p, 'utf8'), 'open', []));
  assert.ok(check(root).findings.some((f) => f.level === 'error' && f.file === 'project/intent/experience.md' && /state\.md/.test(f.message)));
});

test('change records are the only place a change is written: versions, changelogs, rollup and index follow', () => {
  const root = fresh('small');
  record(root, '2026-11-26-setup', { title: 'Design direction agreed', date: '2026-11-26', status: 'applied', bumps: ['design:complete', 'boundaries:patch'], decision: 'none' });
  record(root, '2026-11-27-dark-mode', { title: 'Dark mode as a second theme', date: '2026-11-27', status: 'applied', bumps: ['design:minor'], decision: 'accepted' });
  record(root, '2026-11-28-later', { title: 'Motion system', date: '2026-11-28', status: 'proposed', bumps: ['design:minor'], decision: 'proposed' });
  assert.ok(check(root).findings.some((f) => /out of date/.test(f.message)), 'the check sees the views are behind');
  const b = build(root);
  assert.deepEqual(b.problems, []);
  assert.equal(header(root, 'project/building-blocks/DESIGN.md').metadata.version, '1.1.0');
  assert.equal(header(root, 'project/building-blocks/DESIGN.md').metadata.updated, '2026-11-27');
  assert.equal(header(root, 'project/intent/boundaries.md').metadata.version, '0.1.1');
  assert.equal(header(root, 'project/intent/experience.md').metadata.version, '0.1.0', 'untouched files keep their version');
  const log = read(root, 'project/memory/changelog/design.md');
  assert.ok(log.indexOf('## 1.1.0 - 2026-11-27') < log.indexOf('## 1.0.0 - 2026-11-26'), 'newest first');
  assert.ok(log.includes('(../changes/2026-11-27-dark-mode.md)'));
  assert.ok(!log.includes('Motion system'), 'a proposed change is not history yet');
  assert.ok(read(root, 'project/memory/CHANGELOG.md').includes('design (minor)'));
  const d = read(root, 'project/memory/decisions.md');
  assert.ok(section(d, 'Standing').includes('Dark mode') && section(d, 'Open').includes('Motion system'));
  assert.ok(/DESIGN\.md.*\| 1\.1\.0 \|/.test(read(root, 'project/INDEX.md')));
  assert.deepEqual(build(root, { check: true }).changed, [], 'a second build changes nothing');
  assert.deepEqual(check(root).findings, []);
});

test('a decision that replaces another moves the old one to superseded', () => {
  const root = fresh('small');
  record(root, '2026-11-26-fridays', { title: 'Releases on Fridays', date: '2026-11-26', status: 'applied', bumps: ['technical-context:patch'], decision: 'accepted' });
  record(root, '2026-12-03-tuesdays', { title: 'Releases on Tuesdays', date: '2026-12-03', status: 'applied', bumps: ['technical-context:patch'], decision: 'accepted', supersedes: ['2026-11-26-fridays'] });
  build(root);
  const d = read(root, 'project/memory/decisions.md');
  assert.ok(section(d, 'Standing').includes('Tuesdays') && !section(d, 'Standing').includes('Fridays'));
  assert.ok(section(d, 'Superseded').includes('Fridays'));
});

test('a decision: proposed, accepted, then replaced by one that supersedes it', () => {
  const root = fresh('medium');
  const fill = (name) => { const p = path.join(root, 'project/memory/changes', `${name}.md`); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('## Deltas\n', '## Deltas\n\n- technical-context: ADDED the choice and its reason\n')); };
  const a = create(root, { slug: 'orders-by-email', title: 'Orders are confirmed by email only', askedBy: 'pm', bumps: ['technical-context:minor'], decision: 'proposed', date: '2026-12-01' });
  assert.equal(a.name, '2026-12-01-orders-by-email');
  assert.deepEqual(check(root, { today: '2026-12-01' }).findings, [], 'the decision list is rebuilt when a proposal is recorded');
  assert.match(read(root, 'project/memory/decisions.md').split('## Waiting')[0], /Orders are confirmed by email only/, 'a proposed decision is listed as open');
  assert.equal(header(root, 'project/foundation/technical-context.md').metadata.version, '0.1.0', 'nothing is bumped until it is applied');
  assert.throws(() => set(root, a.name, { decision: 'accepted' }), /applies it/);
  fill(a.name);
  assert.deepEqual(set(root, a.name, { status: 'applied', decision: 'accepted' }).problems, []);
  assert.equal(header(root, 'project/foundation/technical-context.md').metadata.version, '0.2.0');
  assert.match(read(root, 'project/memory/decisions.md').split('## Standing')[1], /Orders are confirmed by email only/);

  const b = create(root, { slug: 'orders-by-text', title: 'Orders are confirmed by text message', askedBy: 'pm', bumps: ['technical-context:major'], decision: 'accepted', status: 'applied', supersedes: [a.name], date: '2026-12-09' });
  fill(b.name);
  build(root);
  const d = read(root, 'project/memory/decisions.md');
  assert.match(d.split('## Standing')[1].split('## Superseded')[0], /text message/);
  assert.match(d.split('## Superseded')[1], /email only/);
  assert.deepEqual(check(root, { today: '2026-12-09' }).findings, []);
  assert.equal(listRecords(root).length, 2);
  assert.throws(() => set(root, a.name, { status: 'rejected' }), /stays/, 'an applied record is never withdrawn');
});

test('record.mjs refuses what a person would get wrong by hand', () => {
  const root = fresh('small');
  const ok = { slug: 'x', title: 'A choice', askedBy: 'pm', date: '2026-12-01' };
  assert.throws(() => create(root, { ...ok, bumps: ['pricing:minor'] }), /not a project file/);
  assert.throws(() => create(root, { ...ok, bumps: ['design:huge'] }), /level/);
  assert.throws(() => create(root, { ...ok, slug: 'Not A Slug' }));
  assert.throws(() => create(root, { ...ok, title: 'x'.repeat(101) }), /under 100/);
  assert.equal(listRecords(root).length, 0);
  assert.throws(() => create(root, { ...ok, title: 'A "quoted" title' }));
  assert.throws(() => create(root, { ...ok, decision: 'accepted' }), /applied/);
  assert.throws(() => create(root, { ...ok, decision: 'proposed', supersedes: ['2026-01-01-nothing'] }), /no such record/);
  const plain = create(root, { ...ok, slug: 'wording' });
  assert.throws(() => create(root, { ...ok, slug: 'wording' }), /exists/);
  assert.throws(() => create(root, { ...ok, slug: 'y', decision: 'proposed', supersedes: [plain.name] }), /holds no decision/);
  assert.throws(() => set(root, 'nope', { status: 'applied' }));
  assert.equal(set(root, plain.name, { status: 'rejected' }).status, 'rejected');
});

test('parked questions show as waiting decisions; a question can move to another role', () => {
  const root = fresh('small');
  answer(root, { id: 'what', status: 'answered' });
  answer(root, { id: 'hosting', status: 'parked', note: 'after the vendor replies' });
  assert.match(read(root, 'project/memory/decisions.md').split('## Waiting')[1].split('## Standing')[0], /Where will it run.*after the vendor replies/);
  answer(root, { id: 'hosting', status: 'answered' });
  assert.equal(table(parseFrontmatter(read(root, 'project/memory/state.md')).body, 'Questions').find((q) => q.id === 'hosting').note, '', 'an answered question drops the note that said what it waited for');
  addQuestion(root, { id: 'gift-cards', file: 'boundaries', role: 'client', ask: 'May the shop sell gift cards?', status: 'parked', note: 'the owner is thinking about it' });
  assert.match(read(root, 'project/memory/decisions.md').split('## Waiting')[1], /gift cards.*the owner is thinking/);
  answer(root, { id: 'audiences', status: 'open', role: 'designer' });
  const r = check(root);
  assert.deepEqual(r.findings, []);
  assert.ok(r.questions.byRole.designer.open.includes('audiences'));
  assert.ok(!r.questions.byRole['experience-lead'].open.includes('audiences'));
  assert.throws(() => answer(root, { id: 'audiences', status: 'open', role: 'Not A Role' }));
});

test('a file added on a trigger: header, parent, a `new` bump, and it shows in the index', () => {
  const root = fresh('small');
  const f = addFile(root, { path: 'project/building-blocks/design/themes.md', description: 'Light and dark themes and how a colour is chosen for each', owner: 'designer', parent: 'design', date: '2026-12-02' });
  assert.deepEqual([f.name, f.bump, f.depends_on], ['themes', 'themes:new', ['design']]);
  fs.appendFileSync(path.join(root, f.path), '\n## Dark\n\nA second colour group.\n');
  const r = create(root, { slug: 'dark-theme', title: 'A dark theme is added', askedBy: 'designer', bumps: [f.bump, 'design:minor'], status: 'applied', date: '2026-12-02' });
  const p = path.join(root, r.path);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('## Deltas\n', '## Deltas\n\n- themes: ADDED\n- design: MODIFIED colours point to themes\n'));
  build(root);
  assert.deepEqual(check(root, { today: '2026-12-02' }).findings, []);
  assert.equal(header(root, f.path).metadata.version, '0.1.0');
  assert.equal(header(root, 'project/building-blocks/DESIGN.md').metadata.version, '0.2.0');
  assert.match(read(root, 'project/INDEX.md'), /building-blocks\/design\/themes\.md/);
  assert.ok(fs.existsSync(path.join(root, 'project/memory/changelog/themes.md')));
  const ok = { description: 'x', owner: 'designer' };
  assert.equal(addFile(root, { ...ok, path: 'project/building-blocks/design/motion.md', parent: 'DESIGN.md' }).depends_on[0], 'design', 'the parent can be given as its file name');
  assert.deepEqual(check(root, { today: '2026-12-02' }).findings, [], 'the index is rebuilt when a file is added');
  assert.throws(() => addFile(root, { ...ok, path: 'project/building-blocks/design/themes.md' }), /exists/);
  assert.throws(() => addFile(root, { ...ok, path: 'project/intent/themes.md' }), /unique/);
  assert.throws(() => addFile(root, { ...ok, path: 'project/memory/notes.md' }), /kept by the skills/);
  assert.throws(() => addFile(root, { ...ok, path: 'docs/notes.md' }));
  assert.throws(() => addFile(root, { ...ok, path: 'project/tech/Data Model.md' }));
  assert.throws(() => addFile(root, { ...ok, path: 'project/tech/security.md', parent: 'nothing' }), /not a project file/);
  assert.throws(() => addFile(root, { ...ok, path: 'project/tech/security.md', owner: 'Two People' }));
  const s = sizes(root);
  assert.ok(s.some((x) => x.key === 'agents') && s.every((x) => x.used >= 0 && x.budget > 0));
  assert.ok(s[0].used >= s[s.length - 1].used, 'fullest first');
});

test('status: what waits on whom, what is stale, what has drifted, and the phase', () => {
  assert.equal(status(tmp()).setUp, false);
  const root = fresh('small');
  answer(root, { id: 'what', status: 'answered' });
  answer(root, { id: 'hosting', status: 'parked', note: 'after the vendor replies' });
  answer(root, { id: 'who', status: 'skipped', note: 'ask the owner' });
  create(root, { slug: 'pickup-only', title: 'Orders are for pickup only at launch', askedBy: 'pm', bumps: ['boundaries:minor'], decision: 'proposed', date: '2026-11-26' });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/app.js'), '');
  const p = path.join(root, 'project/foundation/technical-context.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '\nThe entry point is `src/app.js`; the old one was `src/legacy/main.js`. See `https://example.com/a/b.html` and `npm run build`.\n');
  const s = status(root, { today: '2026-12-10' });
  assert.equal(s.phase, 'context');
  assert.deepEqual(s.waiting.parked.map((q) => q.id), ['hosting']);
  assert.deepEqual(s.waiting.skipped.map((q) => q.id), ['who']);
  assert.deepEqual(s.waiting.proposed.map((x) => [x.name, x.days]), [['2026-11-26-pickup-only', 14]]);
  assert.deepEqual(s.drift.missingPaths, [{ file: 'project/foundation/technical-context.md', path: 'src/legacy/main.js' }], 'only the path that is gone; not the URL, the command or the one that exists');
  assert.deepEqual(s.stale, []);
  assert.equal(s.errors, 0);
  const later = status(root, { today: '2027-06-01' });
  assert.ok(later.stale.some((f) => f.file === 'project/intent/experience.md' && f.why.some((w) => /draft/.test(w))));
  assert.deepEqual(setPhase(root, 'planning', '2026-12-10'), { from: 'context', to: 'planning' });
  assert.equal(status(root, { today: '2026-12-10' }).phase, 'planning');
  assert.deepEqual(check(root, { today: '2026-12-10' }).findings, []);
  assert.throws(() => setPhase(root, 'holiday'));
});

test('report: each reader gets the changes to the files they read, every decision, and what waits on them', () => {
  const root = fresh('small');
  const apply = (o, delta) => { const r = create(root, { askedBy: 'pm', status: 'applied', ...o }); const p = path.join(root, r.path); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('## Deltas\n', `## Deltas\n\n- ${delta}\n`).replace('## Why\n', '## Why\n\nBecause the owner asked.\n')); build(root); return r; };
  apply({ slug: 'old', title: 'An older change to scope', bumps: ['boundaries:minor'], date: '2026-11-01' }, 'boundaries: ADDED a line');
  apply({ slug: 'tech-only', title: 'The build runs on push', bumps: ['technical-context:minor'], date: '2026-12-02' }, 'technical-context: ADDED');
  apply({ slug: 'scope', title: 'Gift cards are out of scope', bumps: ['boundaries:minor'], date: '2026-12-03' }, 'boundaries: ADDED');
  apply({ slug: 'host', title: 'The shop runs on a managed platform', bumps: ['technical-context:minor'], decision: 'accepted', askedBy: 'tech-lead', date: '2026-12-03' }, 'technical-context: MODIFIED');
  addQuestion(root, { id: 'gift-wrap', file: 'boundaries', role: 'client', ask: 'Should orders offer gift wrapping?', status: 'parked', note: 'the owner decides' });
  answer(root, { id: 'hosting', status: 'parked', note: 'after the vendor replies' });
  addQuestion(root, { id: 'opening-hours', file: 'product-context', role: 'client-contact', ask: 'Which opening hours are shown?', status: 'skipped', note: 'the shop' });
  const opt = { since: '7d', today: '2026-12-04' };
  const c = report(root, { audience: 'client', ...opt });
  assert.deepEqual(c.period, { since: '2026-11-27', until: '2026-12-04' });
  assert.deepEqual(c.changes.map((x) => x.title), ['Gift cards are out of scope'], 'not the technical change, not the one before the period');
  assert.deepEqual(c.decisions.map((x) => x.title), ['The shop runs on a managed platform'], 'a decision reaches every reader');
  assert.equal(c.changes[0].why, 'Because the owner asked.');
  assert.deepEqual(c.waiting.onClient.map((q) => q.id).sort(), ['gift-wrap', 'opening-hours'], 'any role on the client side');
  assert.ok(!c.waiting.parked.some((q) => q.id === 'hosting'), 'a technical question is not the client\'s');
  assert.deepEqual(c.attention, {});
  assert.equal(c.saveAs, 'project/memory/reports/2026-12-04-client.md');
  const t = report(root, { audience: 'tech', ...opt });
  assert.deepEqual(t.changes.map((x) => x.title), ['The build runs on push', 'Gift cards are out of scope'], 'boundaries bind the tech team too');
  assert.ok(t.waiting.parked.some((q) => q.id === 'hosting') && 'missingPaths' in t.attention);
  const p = report(root, { audience: 'pm', today: '2026-12-04' });
  assert.equal(p.changes.length, 3, 'no period: everything, as an outline');
  assert.equal(report(root, { audience: 'pm', since: '2026-12-04', today: '2026-12-04' }).empty, true);
  fs.writeFileSync(path.join(root, c.saveAs), '---\nname: 2026-12-04-client\ndescription: "Client report"\nmetadata:\n  type: report\n---\n\nHello.\n');
  assert.equal(report(root, { audience: 'client', ...opt }).exists, true);
  assert.deepEqual(check(root, { today: '2026-12-04' }).findings, [], 'a saved report is not a project file');
  assert.throws(() => report(root, { audience: 'everyone' }));
  assert.throws(() => period('soon', null, '2026-12-04'));
  assert.throws(() => period('2027-01-01', null, '2026-12-04'));
  assert.throws(() => report(tmp(), { audience: 'pm' }), /no project here/);
});

test('tokens: DESIGN.md is the source, the exports are generated, and drift is caught', () => {
  const root = fresh();
  const d = 'project/building-blocks/DESIGN.md';
  assert.deepEqual(tokens(root).tokens, [], 'a new DESIGN.md has no tokens yet');
  assert.ok(tokens(root).omitted.includes('colors'), 'and says which sections are not decided');
  fs.writeFileSync(path.join(root, d), read(root, d).replace('omitted:', 'colors:\n  primary: "#1A1C1E"\n  onPrimary: "#FFFFFF"\ntypography:\n  h1:\n    fontFamily: Public Sans\n    fontSize: 3rem\nrounded:\n  sm: 4px\ncomponents:\n  button-primary:\n    backgroundColor: "{colors.primary}"\nspacing:\n  md: 16px\n  gutter: "{spacing.md}"\nomitted:'));
  const t = tokens(root);
  assert.deepEqual(t.problems, []);
  assert.deepEqual(t.groups, ['colors', 'typography', 'rounded', 'spacing'], 'components are guidance, not tokens');
  const css = toCss(t);
  for (const l of ['--color-primary: #1A1C1E;', '--color-on-primary: #FFFFFF;', '--type-h1-font-size: 3rem;', '--rounded-sm: 4px;', '--space-gutter: var(--space-md);']) assert.ok(css.includes(l), l);
  const j = JSON.parse(toJson(t));
  assert.equal(j.colors.$type, 'color');
  assert.equal(j.colors.primary.$value, '#1A1C1E');
  assert.equal(j.spacing.gutter.$value, '{spacing.md}', 'a reference stays a reference in the JSON');
  assert.equal(exportTokens(root, { css: 'src/tokens.css', check: true }).files[0].state, 'missing');
  assert.ok(exportTokens(root, { css: 'src/tokens.css', json: 'src/tokens.json' }).wrote);
  assert.ok(exportTokens(root, { css: 'src/tokens.css', json: 'src/tokens.json', check: true }).inSync);
  assert.ok(!exportTokens(root, { css: 'src/tokens.css' }).wrote, 'a second export writes nothing');
  fs.writeFileSync(path.join(root, d), read(root, d).replace('#1A1C1E', '#000000'));
  const drift = exportTokens(root, { css: 'src/tokens.css', check: true });
  assert.ok(!drift.inSync && drift.files[0].state === 'differs');
  assert.ok(read(root, 'src/tokens.css').includes('#1A1C1E'), '--check writes nothing');
  fs.writeFileSync(path.join(root, 'src/own.css'), ':root { --x: 1 }\n');
  assert.throws(() => exportTokens(root, { css: 'src/own.css' }), /not generated here/);
  assert.throws(() => exportTokens(root, { css: '../out.css' }), /outside/);
  fs.writeFileSync(path.join(root, d), read(root, d).replace('"{spacing.md}"', '"{spacing.huge}"').replace('"#FFFFFF"', '12px'));
  const bad = exportTokens(root, { css: 'src/tokens.css' });
  assert.ok(bad.problems.some((p) => /spacing\.huge/.test(p)) && bad.problems.some((p) => /colour/.test(p)) && !bad.wrote, 'nothing is exported from a DESIGN.md with problems');
  const own = tmp();
  fs.writeFileSync(path.join(own, 'DESIGN.md'), '---\nversion: alpha\nname: X\ncolors:\n  primary: "#fff"\n---\n');
  assert.equal(tokens(own).design, 'DESIGN.md', "a repo's own DESIGN.md is read when the project has none");
  assert.match(tokens(tmp()).problems[0], /no DESIGN\.md/);
});

test('timeline: the first milestone creates the file, a moved date keeps the old one, status and reports read it', () => {
  const root = fresh();
  assert.equal(timeline(root).exists, false);
  assert.equal(status(root, { today: '2026-11-25' }).timeline, null);
  const a = addMilestone(root, { name: 'Design approved', date: '2026-12-10', owner: 'designer', today: '2026-11-25' });
  assert.ok(a.created && a.bump === 'timeline:new');
  assert.equal(addMilestone(root, { name: 'Launch', date: '2027-02-01', owner: 'pm', note: 'Before the spring catalogue', today: '2026-11-25' }).bump, 'timeline:minor');
  addMilestone(root, { name: 'Kick-off', date: '2026-11-20', owner: 'pm', today: '2026-11-25' });
  assert.equal(header(root, 'project/foundation/timeline.md').metadata.owner, 'pm');
  assert.deepEqual(check(root, { today: '2026-11-25' }).findings.filter((f) => f.level === 'error'), []);
  let t = timeline(root, { today: '2026-11-25' });
  assert.deepEqual(t.milestones.map((m) => m.name), ['Kick-off', 'Design approved', 'Launch'], 'kept in date order');
  assert.equal(t.next.name, 'Design approved');
  assert.equal(t.next.days, 15);
  assert.deepEqual(t.overdue.map((m) => m.name), ['Kick-off']);
  setMilestone(root, 'kick-off', { status: 'done', today: '2026-11-25' });
  const moved = setMilestone(root, 'Design approved', { date: '2026-12-17', today: '2026-11-26' });
  assert.ok(moved.moved && moved.to.status === 'moved');
  setMilestone(root, 'Design approved', { date: '2027-01-07', today: '2026-11-27' });
  t = timeline(root, { today: '2026-11-27' });
  assert.equal(t.milestones.find((m) => m.name === 'Design approved').note, 'was 2026-12-10', 'the first date is the one kept');
  assert.deepEqual(t.overdue, []);
  const s = status(root, { today: '2026-11-27' });
  assert.equal(s.timeline.next.name, 'Design approved');
  assert.equal(report(root, { audience: 'client', today: '2026-11-27' }).milestones.next.date, '2027-01-07');
  assert.throws(() => addMilestone(root, { name: 'launch', date: '2027-03-01', owner: 'pm' }), /already a milestone/);
  assert.throws(() => addMilestone(root, { name: 'Beta', date: 'March', owner: 'pm' }), /YYYY-MM-DD/);
  assert.throws(() => setMilestone(root, 'Nope', { status: 'done' }), /no milestone/);
  assert.throws(() => setMilestone(root, 'Launch', { status: 'late' }), /one of/);
  fs.writeFileSync(path.join(root, 'project/foundation/timeline.md'), read(root, 'project/foundation/timeline.md').replace('| Launch | 2027-02-01 | pm | planned', '| Launch | spring | pm | soon'));
  assert.equal(timeline(root).problems.length, 2);
});

test('pr: the records a branch adds, and a project file changed without one', () => {
  const root = fresh();
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { stdio: 'pipe' });
  assert.throws(() => pr(root), /not a git repository|no base/);
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'Set up');
  git('checkout', '-qb', 'dark-theme');
  assert.ok(pr(root, { base: 'main' }).empty);
  const d = 'project/building-blocks/DESIGN.md';
  fs.writeFileSync(path.join(root, d), read(root, d) + '\nDark theme follows the system setting.\n');
  fs.writeFileSync(path.join(root, 'project/intent/boundaries.md'), read(root, 'project/intent/boundaries.md') + '\nNo autoplay.\n');
  record(root, '2026-11-26-dark', { title: 'Dark theme', date: '2026-11-26', status: 'applied', asked_by: 'designer', bumps: ['design:minor'], decision: 'accepted' }, '## Why\n\nReaders asked for it.\n\n## Deltas\n\n- design: dark theme follows the system\n\n## Decision\n\nFollow the system setting.\n');
  record(root, '2026-11-26-later', { title: 'Maybe a sepia theme', date: '2026-11-26', status: 'proposed', asked_by: 'designer', bumps: [], decision: 'proposed' });
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/theme.css'), ':root{}\n');
  build(root); git('add', '-A'); git('commit', '-qm', 'Add a dark theme');
  const r = pr(root, { base: 'main' });
  assert.equal(r.branch, 'dark-theme');
  assert.deepEqual(r.records.map((x) => x.name), ['2026-11-26-dark', '2026-11-26-later']);
  assert.equal(r.records[0].why, 'Readers asked for it.');
  assert.deepEqual(r.decisions, ['2026-11-26-dark', '2026-11-26-later']);
  assert.deepEqual(r.projectFiles.sort(), [d, 'project/intent/boundaries.md'], 'generated and kept files are not listed');
  assert.deepEqual(r.otherFiles, { count: 1, sample: ['src/theme.css'] });
  assert.ok(r.rules.includes('project/intent/boundaries.md'));
  assert.ok(r.problems.some((p) => /boundaries\.md changed, and no change record/.test(p)));
  assert.ok(!r.problems.some((p) => /DESIGN\.md changed/.test(p)));
  assert.ok(r.problems.some((p) => /later is still proposed/.test(p)));
  assert.throws(() => pr(root, { base: 'nowhere' }), /no base/);
});

test('bad records and bad files are caught', () => {
  const root = fresh('small');
  record(root, '2026-11-26-typo', { title: 'Typo', date: '2026-11-26', status: 'applied', bumps: ['desing:minor'], decision: 'none' });
  const b = build(root);
  assert.ok(b.problems.some((p) => /desing/.test(p)) && !b.wrote, 'nothing is written when a record is wrong');
  fs.rmSync(path.join(root, 'project/memory/changes/2026-11-26-typo.md'));
  record(root, '2026-11-26-empty', { title: 'Empty', date: '2026-11-26', status: 'applied', bumps: ['design:patch'], decision: 'none' }, '## Deltas\n');
  fs.writeFileSync(path.join(root, 'project/tech/notes.md'), '# No header\n');
  fs.writeFileSync(path.join(root, 'project/tech/keys.md'), '---\nname: keys\ndescription: x\nmetadata:\n  type: project\n  version: "0.1.0"\n  status: live\n  audience: people\n  owner: [a, b]\n  depends_on: [nowhere]\n  open: []\n  changelog: memory/changelog/keys.md\n  review_by: 2026-01-01\n---\napi_key: "abcd1234abcd1234abcd"\n' + 'x'.repeat(9000));
  const msgs = check(root, { today: '2026-11-25' }).findings.map((f) => `${f.file}: ${f.message}`).join('\n');
  for (const must of ['notes.md: no frontmatter', 'status "live"', 'owner is one role', 'depends_on "nowhere"', 'secret', 'over the 8192 budget', 'review was due', 'applied without anything under']) assert.ok(msgs.includes(must), must);
});

test('no client data: templates use only documented placeholders, and nothing names a real project', () => {
  const allowed = ['PROJECT', 'DATE', 'SIZE', 'KIND', 'QUESTIONS', 'SLUG', 'TITLE', 'ROLE', 'BUMPS'];
  const docs = fs.readFileSync(path.join(PLUGIN, 'references/files.md'), 'utf8') + fs.readFileSync(path.join(PLUGIN, 'skills/new/SKILL.md'), 'utf8');
  const hosts = ['example.com', 'example.dk', 'github.com', 'semver.org', 'keepachangelog.com', 'www.designtokens.org', 'www.aihero.dev', 'arxiv.org', 'www.atlassian.com', 'www.martinfowler.com', 'www.thoughtworks.com', 'asantos2000.github.io', 'code.claude.com', 'aws.amazon.com', 'claude.ai'];
  for (const p of walk(PLUGIN).filter((f) => /\.(md|json|mjs|html)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`))) {
    const t = fs.readFileSync(p, 'utf8');
    const rel = path.relative(PLUGIN, p);
    if (rel.startsWith('templates')) for (const m of t.matchAll(/\{\{([A-Z_]+)\}\}/g)) { assert.ok(allowed.includes(m[1]), `${rel}: {{${m[1]}}} is not a documented placeholder`); assert.ok(docs.includes(`{{${m[1]}}}`), `{{${m[1]}}} is explained in files.md or SKILL.md`); }
    if (rel.endsWith('.html')) continue;
    for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.ok(hosts.includes(m[1].toLowerCase()), `${rel}: ${m[1]} is not on the list of hosts these files may name`);
    assert.ok(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(t.replace(/@AGENTS\.md|@design\/[\w.-]+|[\w-]+@agent-17|@google\/design\.md/g, '')), `${rel}: holds an email address`);
  }
});

test('the question bank is well formed', () => {
  const ids = new Set(BANK.map((q) => q.id));
  assert.equal(ids.size, BANK.length, 'ids are unique');
  const files = { 'product-context': 'project/foundation/product-context.md', 'technical-context': 'project/foundation/technical-context.md', experience: 'project/intent/experience.md', boundaries: 'project/intent/boundaries.md', design: 'project/building-blocks/DESIGN.md', agents: 'AGENTS.md' };
  const rank = { small: 0, medium: 1, large: 2 };
  for (const q of BANK) {
    assert.ok(files[q.file], `${q.id}: ${q.file} is a starting file`);
    assert.ok(fs.readFileSync(path.join(PLUGIN, 'templates', files[q.file]), 'utf8').includes(`## ${q.section}`), `${q.id}: "${q.section}" is a heading in its template`);
    for (const a of q.after) { assert.ok(ids.has(a), `${q.id}: after "${a}" exists`); assert.ok(rank[BANK.find((x) => x.id === a).size] <= rank[q.size], `${q.id}: its prerequisite "${a}" is asked at this size too`); }
  }
});
