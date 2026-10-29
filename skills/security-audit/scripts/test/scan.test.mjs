// security-audit: ignore-file
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { scanText, rulesFor, redact, FILE_RULES } from '../lib/patterns.mjs';
import {
  parsePackageLock, parseYarnLock, parsePnpmLock, parseComposerLock, parseNugetLock, parseMsbuild,
  parseRequirements, parseTomlLock, parseGemfileLock, parseGoMod, osvSeverity, osvFixed,
} from '../lib/deps.mjs';
import { run, parseArgs } from '../scan.mjs';

// Fake secrets are assembled at runtime so GitHub push protection does not flag this file.
const STRIPE = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_');
const STRIPE_TEST = ['sk', 'test', 'abcdefghijklmnopqrstuvwx'].join('_');
const GHP = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');

const ids = (rel, text) => scanText(rel, text).map((h) => h.id);

// ---------------------------------------------------------------- patterns: each rule fires on its target and not on the safe twin

const CASES = [
  ['src/a.js', 'el.innerHTML = location.hash', 'el.textContent = location.hash', 'xss.dom-sink'],
  ['src/a.tsx', '<div dangerouslySetInnerHTML={{ __html: body }} />', '<div>{body}</div>', 'xss.framework-raw'],
  ['Views/a.cshtml', '@Html.Raw(Model.Query)', '@Model.Query', 'xss.razor-raw'],
  ['src/a.js', 'db.query(`SELECT * FROM users WHERE id = ${id}`)', 'db.query("SELECT * FROM users WHERE id = ?", [id])', 'inject.sql'],
  ['src/a.js', 'msg(`update available (${a} → ${b})`)', 'msg("ok")', null],
  ['src/a.cs', 'ctx.Users.FromSqlRaw($"SELECT * FROM Users WHERE Name = {name}")', 'ctx.Users.FromSqlInterpolated($"SELECT * FROM Users WHERE Name = {name}")', 'inject.sql'],
  ['app.py', 'cur.execute(f"SELECT * FROM t WHERE id = {i}")', 'cur.execute("SELECT * FROM t WHERE id = %s", (i,))', 'inject.sql'],
  ['src/a.js', 'exec(`git log ${branch}`)', 'execFile("git", ["log", branch])', 'inject.command'],
  ['src/a.js', 'const f = eval(code)', 'const f = JSON.parse(code)', 'inject.eval'],
  ['src/a.js', 'res.redirect(req.query.next)', 'res.redirect("/home")', 'redirect.open'],
  ['src/a.js', 'await fetch(req.query.url)', 'await fetch(API_URL)', 'ssrf.request-url'],
  ['src/a.js', 'res.sendFile(path.join(dir, req.params.name))', 'res.sendFile(path.join(dir, "index.html"))', 'path.traversal'],
  ['src/a.js', 'new https.Agent({ rejectUnauthorized: false })', 'new https.Agent({ ca })', 'tls.verify-disabled'],
  ['src/a.js', "crypto.createHash('md5')", "crypto.createHash('sha256')", 'crypto.weak-hash'],
  ['src/a.js', 'const resetToken = Math.random().toString(36)', 'const x = Math.random() * width', 'crypto.insecure-random'],
  ['Startup.cs', 'p.SetIsOriginAllowed(_ => true)', 'p.WithOrigins("https://a.dk")', 'auth.cors'],
  ['src/a.cs', 'var f = new BinaryFormatter();', 'var f = new JsonSerializer();', 'deserialize.unsafe'],
  ['settings.py', 'DEBUG = True', 'DEBUG = env("DEBUG")', 'config.debug'],
  ['.github/workflows/ci.yml', '      - run: echo "${{ github.event.issue.title }}"', '      - run: echo "$TITLE"', 'ci.script-injection'],
  ['.github/workflows/ci.yml', '      - uses: tj-actions/changed-files@v44', '      - uses: tj-actions/changed-files@0123456789abcdef0123456789abcdef01234567 # v44', 'ci.unpinned-action'],
  ['.github/workflows/ci.yml', '  pull_request_target:', '  pull_request:', 'ci.pull-request-target'],
  ['config/a.json', `"stripe": "${STRIPE}"`, `"stripe": "${STRIPE_TEST}"`, 'secrets.stripe'],
  ['src/a.js', `const k = "${GHP}"`, 'const k = process.env.GH_TOKEN', 'secrets.github-token'],
  ['src/a.js', 'const url = "postgres://app:s3cretPw@db.internal:5432/app"', 'const url = process.env.DATABASE_URL', 'secrets.db-url'],
  ['appsettings.json', '"Default": "Server=db;Database=x;User Id=sa;Password=Hunter22!;"', '"Default": "Server=db;Database=x;Integrated Security=true;"', 'secrets.connection-string'],
  ['src/a.js', 'const apiKey = "Zx81kQp02LmNv7Rt5Ws3"', 'const apiKey = "your-api-key-here"', 'secrets.generic'],
  ['README.md', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', 'AWS_ACCESS_KEY_ID=<your key>', null],
];

for (const [rel, bad, good, id] of CASES) {
  test(`${id ?? 'no rule'}: ${bad.slice(0, 50)}`, () => {
    if (id) assert.ok(ids(rel, bad).includes(id), `expected ${id} on: ${bad} (got ${ids(rel, bad)})`);
    else assert.deepEqual(ids(rel, bad), []);
    assert.ok(!ids(rel, good).includes(id ?? '__none__'), `did not expect ${id} on: ${good}`);
  });
}

test('rules are scoped by file type: CI rules only in workflow files, C# rules not in JS', () => {
  assert.ok(!rulesFor('src/ci.yml').some((r) => r.group === 'ci'));
  assert.ok(rulesFor('.github/workflows/x.yaml').some((r) => r.group === 'ci'));
  assert.deepEqual(ids('src/a.js', '@Html.Raw(x)'), []);
});

test('secrets are redacted in the hit text', () => {
  const [h] = scanText('src/a.js', `const k = "${GHP}"`);
  assert.ok(!h.text.includes('abcdefghijklmnop'));
  assert.match(h.text, /ghp_ab…\[40 chars\]/);
  assert.equal(redact('abc'), 'ab…');
});

test('inline and file-level ignore markers', () => {
  assert.deepEqual(ids('src/a.js', 'el.innerHTML = x // security-audit: ignore'), []);
  assert.deepEqual(ids('src/a.js', '// security-audit: ignore-file\nel.innerHTML = x'), []);
});

test('file rules: committed .env, key files, but not .env.example', () => {
  const env = FILE_RULES.find((r) => r.id === 'secrets.env-file');
  assert.ok(env.test('.env') && env.test('apps/web/.env.production'));
  assert.ok(!env.test('.env.example') && !env.test('.env.sample'));
  const key = FILE_RULES.find((r) => r.id === 'secrets.key-file');
  assert.ok(key.test('certs/server.key') && !key.test('test/fixtures/server.key'));
});

// ---------------------------------------------------------------- lockfile parsers

test('package-lock v3 and v1', () => {
  const v3 = parsePackageLock(JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'x' }, 'node_modules/a': { version: '1.0.0' }, 'node_modules/a/node_modules/@s/b': { version: '2.0.0', dev: true }, 'node_modules/l': { link: true } } }));
  assert.deepEqual(v3, [{ name: 'a', version: '1.0.0', dev: false }, { name: '@s/b', version: '2.0.0', dev: true }]);
  const v1 = parsePackageLock(JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '0.1.0' } } }, g: { version: 'git+https://x' } } }));
  assert.deepEqual(v1.map((p) => `${p.name}@${p.version}`), ['a@1.0.0', 'b@0.1.0']);
});

test('yarn v1 and berry', () => {
  const v1 = '# yarn lockfile v1\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.2.0"\n  resolved "x"\n\nlodash@^4.17.0:\n  version "4.17.15"\n';
  assert.deepEqual(parseYarnLock(v1), [{ name: '@babel/core', version: '7.2.0' }, { name: 'lodash', version: '4.17.15' }]);
  const berry = '__metadata:\n  version: 6\n\n"lodash@npm:^4.17.0":\n  version: 4.17.21\n  resolution: "lodash@npm:4.17.21"\n\n"app@workspace:.":\n  version: 0.0.0\n';
  assert.deepEqual(parseYarnLock(berry), [{ name: 'lodash', version: '4.17.21' }]);
});

test('pnpm v5, v6, v9', () => {
  const t = "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies: {}\n\npackages:\n  '@scope/a@1.2.3':\n    resolution: {}\n  b@2.0.0(react@18.0.0):\n    resolution: {}\n  /c@3.0.0:\n    resolution: {}\n  /@s/d/4.0.0_react@18:\n    resolution: {}\n\nsnapshots:\n  e@5.0.0: {}\n";
  assert.deepEqual(parsePnpmLock(t).map((p) => `${p.name}@${p.version}`), ['@scope/a@1.2.3', 'b@2.0.0', 'c@3.0.0', '@s/d@4.0.0']);
});

test('composer, NuGet lock, csproj, requirements, poetry, Gemfile.lock, go.mod', () => {
  assert.deepEqual(parseComposerLock(JSON.stringify({ packages: [{ name: 'a/b', version: 'v1.0.0' }], 'packages-dev': [{ name: 'c/d', version: 'dev-main' }] })), [{ name: 'a/b', version: '1.0.0' }]);
  assert.deepEqual(parseNugetLock(JSON.stringify({ dependencies: { 'net8.0': { Umbraco: { type: 'Direct', resolved: '13.1.0' }, App: { type: 'Project' } } } })), [{ name: 'Umbraco', version: '13.1.0' }]);
  assert.deepEqual(parseMsbuild('<PackageReference Include="Newtonsoft.Json" Version="12.0.1" />\n<PackageReference Include="X" Version="[1.0,2.0)" />\n<PackageReference Include="Y">\n  <Version>2.0.0</Version>\n</PackageReference>'), [{ name: 'Newtonsoft.Json', version: '12.0.1' }, { name: 'Y', version: '2.0.0' }]);
  assert.deepEqual(parseRequirements('django==3.2.0\nrequests>=2\nflask[async]==2.0.1 ; python_version>"3"\n# c'), [{ name: 'django', version: '3.2.0' }, { name: 'flask', version: '2.0.1' }]);
  assert.deepEqual(parseTomlLock('[[package]]\nname = "jinja2"\nversion = "2.10"\n\n[[package]]\nname = "x"\nversion = "1"\n'), [{ name: 'jinja2', version: '2.10' }, { name: 'x', version: '1' }]);
  assert.deepEqual(parseGemfileLock('GEM\n  remote: x\n  specs:\n    rails (6.0.0)\n      actionpack (= 6.0.0)\n    nokogiri (1.10.0-x86_64-linux)\n\nPLATFORMS\n'), [{ name: 'rails', version: '6.0.0' }, { name: 'nokogiri', version: '1.10.0' }]);
  assert.deepEqual(parseGoMod('module x\n\nrequire (\n\tgithub.com/a/b v1.2.3\n\tgolang.org/x/net v0.1.0 // indirect\n)\nrequire github.com/c/d v0.0.1\n'), [{ name: 'github.com/a/b', version: 'v1.2.3' }, { name: 'golang.org/x/net', version: 'v0.1.0' }, { name: 'github.com/c/d', version: 'v0.0.1' }]);
});

test('OSV severity and fixed versions', () => {
  assert.equal(osvSeverity({ database_specific: { severity: 'MODERATE' } }), 'MODERATE');
  assert.equal(osvSeverity({ severity: [{ type: 'CVSS_V3', score: '9.8' }] }), 'CRITICAL');
  assert.equal(osvSeverity({}), 'UNKNOWN');
  const v = { affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }, { package: { ecosystem: 'npm', name: 'other' }, ranges: [{ events: [{ fixed: '9' }] }] }] };
  assert.deepEqual(osvFixed(v, 'npm', 'lodash'), ['4.17.21']);
});

// ---------------------------------------------------------------- end to end (offline)

test('run(): a git repo with a committed .env, a removed secret in history, and a lockfile', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-'));
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', ...a], { stdio: 'ignore' });
  g('init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=not-committed\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env.local\n');
  fs.writeFileSync(path.join(dir, 'src/old.js'), `const k = "${GHP}"\n`);
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'el.innerHTML = location.hash\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4.17.15' } } }));
  g('add', '-A'); g('commit', '-qm', 'a');
  g('rm', '-q', 'src/old.js'); g('commit', '-qm', 'b');

  const r = await run(parseArgs([dir, '--offline', '--history', '50']));
  const ruleIds = r.rules.map((x) => x.id);
  assert.ok(ruleIds.includes('secrets.env-file'));
  assert.ok(ruleIds.includes('xss.dom-sink'));
  assert.ok(!r.rules.find((x) => x.id === 'secrets.env-file').hits.some((h) => h.file === '.env.local'), 'ignored .env.local is not committed');
  assert.equal(r.history.hits.length, 1);
  assert.equal(r.history.hits[0].id, 'secrets.github-token');
  assert.equal(r.deps.packages, 1);
  assert.equal(r.deps.skipped, '--offline');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseArgs rejects unknown groups and options', () => {
  assert.throws(() => parseArgs(['--only', 'nope']), /Unknown group/);
  assert.throws(() => parseArgs(['--frobnicate']), /Unknown option/);
  assert.equal(parseArgs(['--history']).history, 1000);
});
