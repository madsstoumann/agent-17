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
  const allowed = ['PROJECT', 'DATE', 'SIZE', 'QUESTIONS', 'SLUG', 'TITLE', 'ROLE', 'BUMPS'];
  const docs = fs.readFileSync(path.join(PLUGIN, 'references/files.md'), 'utf8') + fs.readFileSync(path.join(PLUGIN, 'new/SKILL.md'), 'utf8');
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
