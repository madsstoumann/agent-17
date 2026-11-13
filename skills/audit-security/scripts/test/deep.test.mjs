// audit-security: ignore-file
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { scanText, rulesFor, DEEP_RULES, RULES } from '../lib/patterns.mjs';
import { createInventory, seedLedger, validateDeep, recordFp, diffVerdicts, manifestNames, subsystemOf, CORE_AREAS, AREAS } from '../lib/deep.mjs';
import { parseSemgrep, parseGitleaks, parseTrufflehog, parseOsvScanner, runTool, runTools, toolRules, TOOLS, onPath } from '../lib/tools.mjs';
import { parsePage, pickPages, detectLibraries, bundleLines, bundleSecrets, messageListeners, mapUrl, apiDescription, clientChecks, sameSite } from '../lib/client.mjs';
import { run, parseArgs, comparable, writeDeep } from '../scan.mjs';
import { check } from '../deep-check.mjs';
import { runSite } from '../lib/site.mjs';

// Fake secrets are assembled at runtime so GitHub push protection does not flag this file.
const STRIPE = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_');
const AWS = ['AKIA', 'QWERTYUIOPASDFGH'].join('');

const deepIds = (rel, text) => scanText(rel, text, rulesFor(rel, { deep: true })).map((h) => h.id);

// ---------------------------------------------------------------- deep rules: each fires on its target and not on the safe twin

const CASES = [
  ['src/a.js', "window.addEventListener('message', (e) => { go(e.data.url) })", "window.addEventListener('message', (e) => { if (e.origin !== ORIGIN) return; })", 'xss.message-no-origin'],
  ['src/a.js', "parent.postMessage({ token }, '*')", "parent.postMessage({ token }, 'https://app.example.com')", 'xss.postmessage-wildcard'],
  ['src/a.js', '_.merge(settings, req.body)', '_.merge(settings, defaults)', 'inject.prototype-pollution'],
  ['src/a.js', "navigator.serviceWorker.register('/sw.js')", "navigator.serviceWorker.ready", 'xss.service-worker'],
  ['src/a.js', 'const link = `https://${req.headers.host}/reset?t=${t}`', 'const link = `${PUBLIC_URL}/reset?t=${t}`', 'request.host-header'],
  ['src/a.js', "app.set('trust proxy', true)", "app.set('trust proxy', 1)", 'request.forwarded-trust'],
  ['src/a.js', 'if (signature === req.headers["x-sig"]) ok()', 'if (crypto.timingSafeEqual(a, b)) ok()', 'auth.timing-compare'],
  ['src/a.js', "const t = jwt.sign(payload, 'hunter2-signing')", 'const t = jwt.sign(payload, process.env.JWT_KEY)', 'auth.hardcoded-signing-key'],
  ['src/a.js', "crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16))", "crypto.createCipheriv('aes-256-gcm', key, crypto.randomBytes(12))", 'crypto.static-iv'],
  ['src/a.js', 'new ApolloServer({ schema, introspection: true })', 'new ApolloServer({ schema, introspection: dev })', 'config.graphql-introspection'],
  ['src/a.js', "app.use(express.json({ limit: '500mb' }))", "app.use(express.json({ limit: '1mb' }))", 'config.body-limit'],
  ['src/a.js', 'const re = new RegExp(req.query.q)', 'const re = new RegExp(escapeRegExp(q))', 'inject.regex'],
  ['src/a.js', 'const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })', 'const openai = new OpenAI({ apiKey })', 'secrets.llm-browser-key'],
  ['src/a.js', 'el.innerHTML = completion.choices[0].message.content', 'el.textContent = completion.choices[0].message.content', 'inject.llm-output'],
  ['src/a.js', 'const systemPrompt = `You help ${req.body.name}`', "const systemPrompt = 'You help customers'", 'inject.prompt-concat'],
  ['Dockerfile', 'USER root', 'USER node', 'config.container-root'],
  ['k8s/deploy.yaml', '      hostNetwork: true', '      hostNetwork: false', 'config.k8s-host'],
  ['infra/iam.json', '"Action": "*",', '"Action": "s3:GetObject",', 'config.iam-wildcard'],
  ['infra/main.tf', '  cidr_blocks = ["0.0.0.0/0"]', '  cidr_blocks = ["10.0.0.0/8"]', 'config.open-ingress'],
  ['infra/main.tf', '  acl    = "public-read"', '  acl    = "private"', 'config.public-storage'],
  ['.github/workflows/ci.yml', '    runs-on: self-hosted', '    runs-on: ubuntu-latest', 'ci.self-hosted'],
  ['.github/workflows/ci.yml', '  workflow_run:', '  push:', 'ci.workflow-run'],
];

for (const [file, bad, safe, id] of CASES) {
  test(`deep rule ${id}: fires on its target, not on the safe twin`, () => {
    assert.ok(deepIds(file, bad).includes(id), `${id} should fire on: ${bad}`);
    assert.ok(!deepIds(file, safe).includes(id), `${id} should not fire on: ${safe}`);
  });
}

test('deep rules run only with --deep, keep the default groups and unique ids', () => {
  const ids = new Set(RULES.map((r) => r.id));
  for (const r of DEEP_RULES) {
    assert.ok(!ids.has(r.id), `${r.id} duplicates a default rule`);
    ids.add(r.id);
    assert.ok(['deps', 'secrets', 'xss', 'injection', 'request', 'crypto', 'config', 'ci'].includes(r.group), `${r.id} has group ${r.group}`);
    assert.ok(r.review && r.fix && r.title, `${r.id} needs title, review and fix`);
  }
  assert.ok(!scanText('src/a.js', "parent.postMessage(x, '*')").some((h) => h.id === 'xss.postmessage-wildcard'), 'not in the default rules');
});

// ---------------------------------------------------------------- inventory and ledger

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-deep-'));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

const APP = {
  'package.json': JSON.stringify({ dependencies: { express: '4.18.2', openai: '4.0.0', react: '18.2.0' } }),
  'src/api/users.js': "router.get('/users/:id', requireAuth, (req, res) => res.json(db.find(req.params.id)))\nrouter.post('/users/:id/export', handler)\n",
  'src/admin/routes.js': "app.post('/admin/import', importHandler)\n",
  'src/chat.js': 'const r = await openai.chat.completions.create({ messages })\n',
  'Dockerfile': 'FROM node:20\nUSER root\n',
  'test/users.test.js': "router.get('/fake', x)\n",
};

test('inventory: surfaces, subsystems and review areas with evidence; test paths left out', () => {
  const inv = createInventory();
  for (const [f, t] of Object.entries(APP)) { if (f.startsWith('test/')) continue; inv.file(f); inv.text(f, t); }
  const r = inv.done();
  assert.equal(r.surfaces['http-route'].count, 3);
  assert.ok(r.surfaces['auth-control'].count >= 1);
  assert.equal(r.surfaces['llm-call'].count, 1);
  assert.deepEqual(r.subsystems.map((s) => s.name).sort(), ['src/admin', 'src/api', 'src/chat.js'.split('/').slice(0, 1).join('/')].sort());
  const sel = Object.fromEntries(r.domains.map((d) => [d.id, d.selected]));
  assert.equal(sel.web, true);
  assert.equal(sel.ai, true);
  assert.equal(sel.client, true);
  assert.equal(sel.cloud, true);
  assert.equal(sel.native, false);
  assert.match(r.domains.find((d) => d.id === 'ai').evidence[0].why, /package openai|chat\.completions/);
});

test('manifestNames reads npm, NuGet, pip, Gemfile and go.mod', () => {
  assert.deepEqual(manifestNames('package.json', '{"dependencies":{"a":"1"},"devDependencies":{"b":"2"}}'), ['a', 'b']);
  assert.deepEqual(manifestNames('Web/Web.csproj', '<PackageReference Include="Umbraco.Cms" Version="13.0.0" />'), ['Umbraco.Cms']);
  assert.deepEqual(manifestNames('requirements.txt', 'django==4.2\n# c\n-r base.txt\nopenai>=1'), ['django', 'openai']);
  assert.deepEqual(manifestNames('Gemfile', "gem 'rails', '7.1'"), ['rails']);
  assert.deepEqual(manifestNames('go.mod', 'require github.com/gin-gonic/gin v1.9.1'), ['github.com/gin-gonic/gin']);
  assert.equal(subsystemOf('src/api/users.js'), 'src/api');
  assert.equal(subsystemOf('lib/x.js'), 'lib');
  assert.equal(subsystemOf('x.js'), '.');
});

test('seedLedger: core areas always, injection and access split per subsystem, selected domains, prior status carried', () => {
  const inv = createInventory();
  for (const [f, t] of Object.entries(APP)) { inv.file(f); inv.text(f, t); }
  const r = inv.done();
  const ledger = seedLedger(r, { at: 'x' });
  const ids = ledger.units.map((u) => u.id);
  for (const a of CORE_AREAS.filter((x) => !x.split)) assert.ok(ids.includes(`${a.id}::all`));
  assert.ok(ids.includes('access::src/api') && ids.includes('access::src/admin'));
  assert.ok(ids.includes('ai::all') && ids.includes('cloud::all'));
  assert.ok(!ids.includes('native::all'));
  assert.ok(ledger.units.every((u) => u.status === 'planned' && u.classes.startsWith('references/deep-classes.md#')));
  assert.ok(ledger.units.find((u) => u.id === 'access::src/api').startingPaths.some((p) => p.startsWith('src/api/users.js:')));
  const prior = { units: [{ id: 'logic::all', area: 'logic', status: 'candidate', findings: ['D1'] }, { id: 'native::all', area: 'native', status: 'blocked', reason: 'no toolchain' }] };
  const next = seedLedger(r, { prior, at: 'y' });
  assert.deepEqual(next.units.find((u) => u.id === 'logic::all').prior, { status: 'candidate', findings: ['D1'], reason: '' });
  const carried = next.units.find((u) => u.id === 'native::all');
  assert.equal(carried.status, 'planned');
  assert.equal(carried.prior.status, 'blocked');
  assert.match(carried.note, /last deep run/);
  assert.ok(AREAS.length >= 18);
});

// ---------------------------------------------------------------- verdicts and the checker

const ROOT = repo({ 'src/api/users.js': 'a\nb\nc\nd\ne\n', 'src/db.js': '1\n2\n3\n' });
const boundary = { principal: 'any signed-in user', input: 'id path parameter', control: 'requireAuth only (no owner check)', crossed: 'user to user', affected: 'another user record' };
const goodLedger = () => ({ units: [
  { id: 'access::all', area: 'access', status: 'candidate', checked: ['src/api/users.js:1'], findings: ['D1', 'D2'] },
  { id: 'injection::all', area: 'injection', status: 'covered', checked: ['src/db.js:2 parameterised'], findings: [] },
  { id: 'native::all', area: 'native', status: 'not_applicable', checked: [], findings: [], reason: 'no native code' },
] });
const goodVerdicts = () => ({ records: [
  { id: 'D1', unit: 'access::all', verdict: 'confirmed', title: 'Any user reads any user', boundary: { ...boundary }, trace: ['src/api/users.js:1', 'src/db.js:3'], result: 'GET /users/2 as user 1 returns user 2', severity: 'high', fix: 'scope the query to req.user.id', verifiedBy: 'fresh agent' },
  { id: 'D2', unit: 'access::all', verdict: 'needs-validation', title: 'Export may include drafts', trace: ['src/api/users.js:2'], blocker: 'export filter is set in deployment config', check: 'owner runs an export as a viewer' },
  { id: 'D3', unit: 'injection::all', verdict: 'rejected', title: 'SQL injection in find', reason: 'parameterised at src/db.js:2' },
] });

test('validateDeep: a complete ledger and verdicts pass', () => {
  const r = validateDeep({ ledger: goodLedger(), verdicts: goodVerdicts(), root: ROOT });
  assert.deepEqual(r.errors, []);
  assert.equal(r.counts.confirmed, 1);
  assert.equal(r.counts.units.candidate, 1);
});

test('validateDeep: each rule of the evidence bar is enforced', () => {
  const bad = (mut, re) => {
    const ledger = goodLedger();
    const verdicts = goodVerdicts();
    mut(ledger, verdicts);
    const r = validateDeep({ ledger, verdicts, root: ROOT });
    assert.ok(r.errors.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(r.errors)}`);
  };
  bad((l) => { l.units[1].status = 'planned'; }, /still planned/);
  bad((l) => { l.units[1].checked = []; }, /covered needs "checked"/);
  bad((l) => { l.units[2].reason = ''; }, /not_applicable needs a "reason"/);
  bad((l, v) => { v.records[1].severity = 'low'; }, /only confirmed records get a severity/);
  bad((l, v) => { delete v.records[0].boundary.control; }, /boundary\.control/);
  bad((l, v) => { v.records[0].trace = ['src/api/users.js:1']; }, /entry point to the sink/);
  bad((l, v) => { v.records[0].trace[1] = 'src/db.js:99'; }, /has 4 lines, trace says 99/);
  bad((l, v) => { v.records[0].trace[1] = 'src/missing.js:1'; }, /not in the repo/);
  bad((l, v) => { v.records[0].trace[1] = '../../etc/passwd:1'; }, /not in the repo/);
  bad((l, v) => { delete v.records[0].verifiedBy; }, /"verifiedBy"/);
  bad((l, v) => { delete v.records[1].blocker; }, /"blocker"/);
  bad((l, v) => { delete v.records[2].reason; }, /rejected needs a "reason"/);
  bad((l, v) => { v.records[0].unit = 'nope'; }, /not in ledger\.json/);
  bad((l) => { l.units[0].findings = ['D1']; }, /does not list it/);
  bad((l) => { l.units[0].findings.push('D9'); }, /D9.*not in verdicts/);
  bad((l, v) => { v.records[0].result = `key ${STRIPE} works`; }, /looks like a secret/);
});

test('recordFp ignores wording and line numbers; diffVerdicts reports new, open and gone', () => {
  const l = goodLedger();
  const a = goodVerdicts().records[0];
  const b = { ...a, title: 'Reworded', trace: ['src/api/users.js:4', 'src/db.js:1'] };
  assert.equal(recordFp(a, l), recordFp(b, l));
  assert.notEqual(recordFp(a, l), recordFp({ ...a, boundary: { ...boundary, control: 'other' } }, l));
  const prev = { records: [{ ...a, fp: 'x' }, { id: 'old', verdict: 'confirmed', fp: 'gone', title: 'Old' }] };
  const cur = { records: [{ ...a, fp: 'x' }, { id: 'n', verdict: 'needs-validation', fp: 'y' }] };
  const d = diffVerdicts(prev, cur);
  assert.equal(d.open.length, 1);
  assert.equal(d.new.length, 1);
  assert.equal(d.gone[0].title, 'Old');
});

test('deep-check --save adds fps and saves the baseline only when the check passes', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-deep-state-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-deep-run-'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ root: ROOT, stateDir: state }));
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify({ ...goodLedger(), units: goodLedger().units.map((u, i) => (i === 1 ? { ...u, status: 'planned' } : u)) }));
  fs.writeFileSync(path.join(dir, 'verdicts.json'), JSON.stringify(goodVerdicts()));
  const fail = check(dir, { save: true });
  assert.ok(fail.errors.length);
  assert.ok(!fs.existsSync(path.join(state, 'last-deep-ledger.json')));
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(goodLedger()));
  const ok = check(dir, { save: true });
  assert.deepEqual(ok.errors, []);
  assert.ok(fs.existsSync(path.join(state, 'last-deep-ledger.json')));
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'verdicts.json'), 'utf8')).records.every((r) => r.fp));
  const again = check(dir, { save: true });
  assert.equal(again.diff.open.length, 2);
});

// ---------------------------------------------------------------- external tools

const fakeWhich = (present) => (name) => present.includes(name);

test('runTools: a missing tool is a not-run row with the install line, never a pass', () => {
  const { rows, rules } = runTools({ root: ROOT, git: false, which: fakeWhich([]), exec: () => { throw new Error('must not run'); } });
  assert.equal(rows.length, TOOLS.length);
  for (const r of rows) {
    assert.equal(r.status, 'skip');
    assert.match(r.evidence, /^not checked \(\S+ is not installed\)$/);
    assert.ok(r.install);
  }
  assert.deepEqual(rules, []);
});

test('runTools: --offline skips the tools that need the network; --only leaves out the others', () => {
  const ran = [];
  const exec = (cmd) => { ran.push(cmd); return { status: 0, stdout: '', stderr: '' }; };
  const { rows } = runTools({ root: ROOT, git: false, offline: true, which: fakeWhich(['semgrep', 'osv-scanner', 'gitleaks', 'trufflehog']), exec, on: (g) => g === 'secrets' });
  assert.match(rows.find((r) => r.id === 'tools.semgrep').evidence, /--offline/);
  assert.match(rows.find((r) => r.id === 'tools.osv-scanner').evidence, /--only\/--skip/);
  assert.deepEqual(ran.sort(), ['gitleaks', 'gitleaks', 'trufflehog']);
});

test('semgrep: results become rules; secrets rules never keep the matched line; timeouts are a not-run row', () => {
  const json = { results: [
    { check_id: 'javascript.express.security.audit.xss.direct-response-write', path: path.join(ROOT, 'src/api/users.js'), start: { line: 2 }, extra: { message: 'Direct write of user input.\nMore.', severity: 'WARNING', lines: 'res.send(req.query.q)' } },
    { check_id: 'generic.secrets.security.detected-stripe-api-key', path: 'src/db.js', start: { line: 1 }, extra: { message: 'Stripe key', severity: 'ERROR', lines: `k = "${STRIPE}"` } },
    { check_id: 'x', path: 'node_modules/a/b.js', start: { line: 1 }, extra: { message: 'm', severity: 'INFO', lines: 'x' } },
  ], errors: [{}] };
  const { hits, errors } = parseSemgrep(json, ROOT);
  assert.equal(hits.length, 2);
  assert.equal(errors, 1);
  assert.equal(hits[0].file, 'src/api/users.js');
  assert.equal(hits[0].severity, 'medium');
  assert.ok(!JSON.stringify(hits).includes(STRIPE));
  const rules = toolRules('semgrep', hits);
  assert.ok(rules.every((r) => r.deep && r.id.startsWith('semgrep:')));
  const tmo = runTool(TOOLS[0], { root: ROOT, tmp: os.tmpdir(), which: () => true, exec: () => ({ status: null, stdout: '', stderr: '', timedOut: true }) });
  assert.equal(tmo.row.status, 'skip');
  assert.match(tmo.row.evidence, /timed out/);
});

test('gitleaks: new sub-commands first, then detect; the report is redacted and merged with the scanner\'s own secret hits', () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'git') return { status: 1, stdout: '', stderr: 'unknown command "git"' };
    const out = args[args.indexOf('--report-path') + 1];
    fs.writeFileSync(out, JSON.stringify([
      { RuleID: 'stripe-access-token', Description: 'Stripe Access Token', File: 'src/db.js', StartLine: 1, Secret: 'REDACTED', Match: 'REDACTED' },
      { RuleID: 'aws-access-token', Description: 'AWS', File: 'old/conf.js', StartLine: 3, Commit: 'abcdef1234567890', Date: '2025-01-02T00:00:00Z', Secret: 'REDACTED' },
    ]));
    return { status: 0, stdout: '', stderr: '' };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-gl-'));
  const r = runTool(TOOLS.find((t) => t.id === 'gitleaks'), { root: ROOT, git: true, tmp, exec, which: () => true });
  assert.deepEqual(calls, ['git', 'detect']);
  assert.equal(r.row.status, 'pass');
  assert.equal(r.hits.length, 2);
  const rules = toolRules('gitleaks', r.hits, [{ file: 'src/db.js', line: 1 }]);
  assert.equal(rules.length, 1, 'the in-tree hit the scanner already has is merged away; the history hit stays');
  assert.match(rules[0].hits[0].text, /commit abcdef1234/);
  assert.equal(parseGitleaks([{ File: 'node_modules/x/y.js', StartLine: 1 }], ROOT).hits.length, 0);
});

test('trufflehog: verification off, raw secret reduced to a redacted prefix', () => {
  let args;
  const line = JSON.stringify({ DetectorName: 'AWS', Raw: AWS, SourceMetadata: { Data: { Git: { file: 'src/db.js', line: 2, commit: '0123456789abcdef', timestamp: '2025-02-03 10:00:00 +0000' } } } });
  const r = runTool(TOOLS.find((t) => t.id === 'trufflehog'), { root: ROOT, git: true, tmp: os.tmpdir(), which: () => true, exec: (c, a) => { args = a; return { status: 0, stdout: `${line}\n${line}\n`, stderr: '' }; } });
  assert.ok(args.includes('--no-verification'));
  assert.equal(r.hits.length, 1);
  assert.ok(!JSON.stringify(r).includes(AWS));
  assert.match(r.hits[0].text, /AWS credential \(commit 0123456789/);
  assert.equal(parseTrufflehog('not json\n{"x":1}', ROOT).hits.length, 0);
});

test('osv-scanner: v2 then v1 command line; advisories the lockfile lookup already has are left out', () => {
  const json = { results: [{ source: { path: path.join(ROOT, 'Cargo.lock') }, packages: [
    { package: { name: 'time', version: '0.1.0', ecosystem: 'crates.io' }, vulnerabilities: [{ id: 'RUSTSEC-2020-0071', summary: 'segfault' }], groups: [{ ids: ['RUSTSEC-2020-0071', 'GHSA-wcg3-cvx6-7396'], max_severity: '6.2' }] },
    { package: { name: 'lodash', version: '4.17.15', ecosystem: 'npm' }, vulnerabilities: [{ id: 'GHSA-35jh-r3h4-6jhm' }], groups: [{ ids: ['GHSA-35jh-r3h4-6jhm'], max_severity: '7.2' }] },
  ] }] };
  const known = new Set(['npm|lodash|4.17.15|ghsa-35jh-r3h4-6jhm']);
  const tries = [];
  const exec = (c, a) => { tries.push(a[0]); return a[0] === 'scan' ? { status: 2, stdout: '', stderr: 'unknown flag' } : { status: 1, stdout: JSON.stringify(json), stderr: '' }; };
  const r = runTool(TOOLS.find((t) => t.id === 'osv-scanner'), { root: ROOT, tmp: os.tmpdir(), which: () => true, exec, known });
  assert.deepEqual(tries, ['scan', '--format']);
  assert.equal(r.hits.length, 1);
  assert.match(r.hits[0].text, /crates\.io time@0\.1\.0 GHSA-wcg3-cvx6-7396/);
  assert.equal(r.hits[0].severity, 'medium');
  assert.equal(parseOsvScanner(json, ROOT).hits.length, 2);
});

test('onPath finds executables on PATH only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-path-'));
  fs.writeFileSync(path.join(dir, 'semgrep'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'gitleaks'), 'not executable', { mode: 0o644 });
  if (process.platform !== 'win32') {
    assert.equal(onPath('semgrep', { env: { PATH: dir } }), true);
    assert.equal(onPath('gitleaks', { env: { PATH: dir } }), false);
  }
  assert.equal(onPath('trufflehog', { env: { PATH: dir } }), false);
});

// ---------------------------------------------------------------- scan.mjs with and without --deep

test('parseArgs: --deep turns on history unless --history N is given; client needs --deep in site mode', () => {
  assert.equal(parseArgs(['.', '--deep']).history, 1000);
  assert.equal(parseArgs(['.', '--deep', '--history', '50']).history, 50);
  assert.equal(parseArgs(['.']).history, 0);
  assert.equal(parseArgs(['.']).deep, false);
  assert.throws(() => parseArgs(['https://www.example.com', '--only', 'client']), /--deep/);
  assert.equal(parseArgs(['https://www.example.com', '--only', 'client', '--deep']).deep, true);
});

test('run without --deep: no deep rules, no inventory, no tools (as before); with --deep all three', async () => {
  const dir = repo({ ...APP, 'src/msg.js': "window.addEventListener('message', (e) => go(e.data))\n" });
  let toolsRan = false;
  const plain = await run({ ...parseArgs([dir, '--offline']), runTools: () => { toolsRan = true; return { rows: [], rules: [] }; } });
  assert.equal(plain.deep, undefined);
  assert.equal(toolsRan, false);
  assert.ok(!plain.rules.some((r) => r.deep));
  const deep = await run({ ...parseArgs([dir, '--offline', '--deep']), which: () => false });
  assert.ok(deep.rules.some((r) => r.id === 'xss.message-no-origin' && r.deep));
  assert.ok(deep.deep.inventory.surfaces['http-route'].count >= 3);
  assert.equal(deep.deep.tools.length, TOOLS.length);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-deep-out-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-deep-st-'));
  writeDeep(deep, out, state, { exec: () => { throw new Error('no git'); } });
  const ledger = JSON.parse(fs.readFileSync(path.join(out, 'deep', 'ledger.json'), 'utf8'));
  assert.ok(ledger.units.length >= CORE_AREAS.length);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'deep', 'verdicts.json'), 'utf8')), { version: 1, records: [] });
  fs.writeFileSync(path.join(out, 'deep', 'verdicts.json'), '{"version":1,"records":[{"id":"kept"}]}');
  writeDeep(deep, out, state, { exec: () => { throw new Error('no git'); } });
  assert.match(fs.readFileSync(path.join(out, 'deep', 'verdicts.json'), 'utf8'), /kept/, 'a re-used --out folder keeps your verdicts');
});

test('comparable: a scan that did not look is not told deep or history hits were fixed', () => {
  const baseline = { rules: [{ id: 'a', hits: [] }, { id: 'semgrep:x', deep: true, hits: [] }], history: { hits: [{ id: 'secrets.aws-key' }] } };
  const plain = comparable(baseline, { history: null });
  assert.deepEqual(plain.rules.map((r) => r.id), ['a']);
  assert.equal(plain.history, null);
  const deep = comparable(baseline, { deep: {}, history: { hits: [] } });
  assert.equal(deep.rules.length, 2);
  assert.ok(deep.history);
});

test('a real git repo: --deep reads history and records the source ref', async () => {
  const dir = repo({ 'a.js': 'x\n' });
  try { execFileSync('git', ['init', '-q', dir]); execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.']); execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'x']); } catch { return; }
  const r = await run({ ...parseArgs([dir, '--deep', '--offline']), which: () => false });
  assert.ok(r.history && !r.history.skipped);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-deep-out-'));
  writeDeep(r, out, out);
  assert.match(r.deep.sourceRef.commit, /^[0-9a-f]{40}$/);
  assert.equal(r.deep.sourceRef.dirty, false);
});

// ---------------------------------------------------------------- site mode: the client group

test('parsePage: scripts with integrity, styles, inline scripts, preloads and links', () => {
  const html = `<html><head>
    <script src="/app.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js" integrity="sha384-x" crossorigin="anonymous"></script>
    <script type="application/ld+json">{"@type":"Thing"}</script>
    <script>window.cfg = 1</script>
    <link rel="stylesheet" href="https://unpkg.com/a@1/a.css">
    <link rel="modulepreload" href="/chunk.js">
  </head><body><a href="/about">a</a><a href="https://other.example.org/x">b</a></body></html>`;
  const p = parsePage(html, 'https://www.example.com/');
  assert.deepEqual(p.scripts.map((s) => [s.url, s.integrity]), [['https://www.example.com/app.js', false], ['https://cdn.jsdelivr.net/npm/jquery@3.4.1/dist/jquery.min.js', true], ['https://www.example.com/chunk.js', false]]);
  assert.equal(p.inline.length, 1, 'JSON-LD is not a script');
  assert.equal(p.styles[0].integrity, false);
  assert.deepEqual(pickPages('https://www.example.com/', p.links), ['https://www.example.com/about']);
  assert.ok(sameSite('https://cdn.example.com/a.js', 'https://www.example.com/'));
});

test('client helpers: library banners, bundle lines, secrets levels, listeners, map URLs, API descriptions', () => {
  assert.deepEqual(detectLibraries('https://www.example.com/js/x.js', '/*! jQuery v1.12.4 | (c) jQuery Foundation */').map((l) => `${l.pkg}@${l.version}`), ['jquery@1.12.4']);
  assert.deepEqual(detectLibraries('https://cdn.jsdelivr.net/npm/bootstrap@4.0.0/dist/js/bootstrap.min.js').map((l) => l.pkg), ['bootstrap']);
  assert.ok(bundleLines('a;b{c}').split('\n').length >= 3);
  const min = `${'x'.repeat(5000)};var k="${STRIPE}";var g="AIzaSyA1234567890abcdefghijklmnopqrstuv";`;
  const s = bundleSecrets('https://www.example.com/app.js', min);
  assert.ok(s.some((h) => h.id === 'secrets.stripe' && h.level === 'fail'));
  assert.ok(!JSON.stringify(s).includes(STRIPE));
  assert.deepEqual(messageListeners('addEventListener("message",function(e){if(e.origin!==o)return})addEventListener("message",function(e){go(e.data)})'), { total: 2, unchecked: 1 });
  assert.deepEqual(mapUrl('https://www.example.com/js/app.js', 'x\n//# sourceMappingURL=app.js.map'), { url: 'https://www.example.com/js/app.js.map' });
  assert.deepEqual(mapUrl('https://www.example.com/a.js', '//# sourceMappingURL=data:application/json;base64,e30='), { inline: true });
  assert.equal(mapUrl('https://www.example.com/a.js', 'no map'), null);
  assert.equal(apiDescription('json', 200, '{"openapi":"3.0.1","paths":{"/a":{}}}').found, true);
  assert.equal(apiDescription('json', 200, '<!doctype html><div id=root></div>').found, false, 'an SPA catch-all page is not an API description');
  assert.equal(apiDescription('ui', 200, '<div id="swagger-ui"></div>').found, true);
  assert.equal(apiDescription('ide', 200, '<!doctype html><title>GraphiQL</title>').found, true);
  assert.equal(apiDescription('ide', 404, 'GraphiQL').found, false);
});

function fakeSite(files) {
  return async (url) => {
    const u = new URL(url);
    const f = files[u.href] ?? files[u.pathname];
    const body = f == null ? '<!doctype html><div id=root></div>' : typeof f === 'string' ? f : f.body;
    const status = f == null ? (files.spa ? 200 : 404) : (f.status || 200);
    return { status, url, headers: new Map(Object.entries((f && f.headers) || {})), text: async () => body };
  };
}

test('clientChecks: SRI, source maps with source, secrets, vulnerable library, listeners and an exposed OpenAPI document', async () => {
  const fetch = fakeSite({
    spa: true,
    '/': '<!doctype html><script src="/static/app.js"></script><script src="https://code.jquery.com/jquery-1.12.4.min.js"></script><script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script><a href="/shop">s</a>',
    '/shop': '<!doctype html><script src="/static/shop.js"></script>',
    '/static/app.js': `var k="${STRIPE}";addEventListener("message",function(e){location=e.data})\n//# sourceMappingURL=app.js.map`,
    '/static/app.js.map': JSON.stringify({ version: 3, sources: ['src/app.ts'], sourcesContent: ['secret stuff'], mappings: 'AAAA' }),
    '/static/shop.js': 'console.log(1)',
    'https://code.jquery.com/jquery-1.12.4.min.js': '/*! jQuery v1.12.4 */',
    '/swagger/v1/swagger.json': '{"openapi":"3.0.1","paths":{"/api/admin":{}}}',
  });
  const queryOsv = async (pkgs) => ({ vulnerable: pkgs.filter((p) => p.name === 'jquery').map((p) => ({ ...p, vulns: [{ id: 'GHSA-gxr4-xjj5-5px2', severity: 'MODERATE', fixed: ['3.5.0'] }] })) });
  const rows = await clientChecks('https://www.example.com/', { deps: { fetch, queryOsv } });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by['client.sri'].status, 'warn');
  assert.match(by['client.sri'].evidence, /code\.jquery\.com/);
  assert.equal(by['client.source-maps'].status, 'warn');
  assert.match(by['client.source-maps'].evidence, /with the original source/);
  assert.equal(by['client.bundle-secrets'].status, 'fail');
  assert.ok(!JSON.stringify(rows).includes(STRIPE));
  assert.equal(by['client.libraries'].status, 'warn');
  assert.match(by['client.libraries'].evidence, /jquery 1\.12\.4: GHSA-gxr4-xjj5-5px2 moderate, fixed in 3\.5\.0/);
  assert.match(by['client.messages'].evidence, /1 listener\(s\).*1 with no origin check/);
  assert.equal(by['client.api-docs'].status, 'warn');
  assert.match(by['client.api-docs'].evidence, /swagger\/v1\/swagger\.json \(OpenAPI 3\.0\.1, 1 path/);
  assert.ok(!/\/graphql/.test(by['client.api-docs'].evidence), 'the SPA catch-all page is not a GraphQL IDE');
});

test('clientChecks: a clean page passes; offline skips the OSV lookup; a page that is not HTML is one skip row', async () => {
  const fetch = fakeSite({ '/': '<!doctype html><script src="/a.js"></script>', '/a.js': '/*! Bootstrap v5.3.3 */ console.log(1)' });
  const rows = await clientChecks('https://www.example.com/', { offline: true, deps: { fetch, queryOsv: async () => { throw new Error('offline'); } } });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by['client.sri'].status, 'pass');
  assert.equal(by['client.source-maps'].status, 'pass');
  assert.equal(by['client.bundle-secrets'].status, 'pass');
  assert.equal(by['client.libraries'].status, 'skip');
  assert.match(by['client.libraries'].evidence, /--offline/);
  assert.equal(by['client.api-docs'].status, 'pass');
  const none = await clientChecks('https://www.example.com/', { deps: { fetch: fakeSite({ '/': { status: 503, body: 'down' } }) } });
  assert.equal(none.length, 1);
  assert.equal(none[0].status, 'skip');
});

test('runSite: the client group runs only with --deep', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-site-deep-'));
  let ran = 0;
  const deps = { runLaunch: () => ({ ok: false, error: 'x' }), pageHeaders: async () => ({}), checkBlocklists: async () => [], clientChecks: async () => { ran++; return [{ id: 'client.sri', group: 'client', status: 'pass', title: 't', evidence: 'e' }]; } };
  const plain = await runSite({ root: 'https://www.example.com/', only: null, skip: [] }, { version: 'x', outDir: out, stateDir: out, deps });
  assert.equal(ran, 0);
  assert.ok(!plain.input.groups.includes('client'));
  assert.equal(plain.input.deep, undefined);
  const deep = await runSite({ root: 'https://www.example.com/', only: null, skip: [], deep: true }, { version: 'x', outDir: out, stateDir: out, deps });
  assert.equal(ran, 1);
  assert.ok(deep.input.groups.includes('client'));
  assert.ok(deep.results.some((r) => r.group === 'client'));
});
