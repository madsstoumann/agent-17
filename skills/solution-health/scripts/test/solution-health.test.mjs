// End-to-end test of the solution-health scripts against a fixture solution and a mock provider.
// Run from the skill folder:  node --test scripts/test/
//
// What is real here: discovery, the verdict logic, page diffing, header parsing, finalize/state.
// What is mocked: the DAWA/PSP provider (scripts/test/mock) and the metadata APIs the sandbox could not
// reach when the skill was written (api.nuget.org, packages.ecosyste.ms, api.deps.dev, endoflife.date):
// their responses are seeded into the HTTP cache in the documented shapes, so the test runs offline.
// registry.npmjs.org and `npm outdated` are called live when the network allows; the assertions do not depend on them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, writeJson } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..');
const PORT = 8700 + Math.floor(Math.random() * 200);
const root = mkdtempSync(join(tmpdir(), 'solution-health-test-'));
const sh = join(root, '.solution-health');
const run = (name, ...args) => {
  const r = spawnSync(process.execPath, [join(scripts, `${name}.mjs`), '--root', root, '--in-repo', ...args], { encoding: 'utf8', timeout: 300_000 });
  if (process.env.VERBOSE) process.stderr.write(r.stderr);
  return r;
};
const json = (f) => JSON.parse(readFileSync(join(sh, 'run', f), 'utf8'));
const ago = (months) => new Date(Date.now() - months * 30 * 86_400_000).toISOString();
let server;

before(async () => {
  cpSync(join(here, 'fixtures', 'solution'), root, { recursive: true });
  mkdirSync(join(sh, 'run', 'cache'), { recursive: true });
  writeFileSync(join(sh, 'manifest.json'), readFileSync(join(here, 'fixtures', 'manifest.test.json'), 'utf8').replaceAll('PORT', String(PORT)));

  // Seed the metadata caches (same shapes the scripts parse from the real services).
  const cache = join(sh, 'run', 'cache');
  const put = (url, body, status = 200) => writeJson(join(cache, `${sha256(url)}.json`), { url, fetchedAt: Date.now(), result: { ok: status < 400, status, json: body, error: null } });
  const eco = (reg, name, body) => put(`https://packages.ecosyste.ms/api/v1/registries/${reg}/packages/${encodeURIComponent(name)}`, body);
  eco('npmjs.org', 'request', { status: 'deprecated', repository_url: 'https://github.com/request/request', latest_release_published_at: '2020-02-11T00:00:00Z', maintainers: [{}, {}], repo_metadata: { archived: true, pushed_at: '2024-01-01T00:00:00Z' } });
  eco('npmjs.org', 'left-pad', { status: null, latest_release_published_at: '2018-04-09T00:00:00Z', maintainers: [{}], repo_metadata: { archived: true, pushed_at: '2018-04-09T00:00:00Z' } });
  eco('npmjs.org', 'node-sass', { status: 'deprecated', latest_release_published_at: '2023-10-01T00:00:00Z', maintainers: [{}], repo_metadata: { archived: true, pushed_at: '2024-07-24T00:00:00Z' } });
  for (const n of ['clsx', 'classnames']) eco('npmjs.org', n, { status: null, latest_release_published_at: '2022-01-01T00:00:00Z', maintainers: [{}], repo_metadata: { archived: false, pushed_at: '2022-01-01T00:00:00Z' } });
  for (const n of ['axios', 'react', 'next']) eco('npmjs.org', n, { status: null, latest_release_published_at: ago(1), maintainers: [{}, {}], repo_metadata: { archived: false, pushed_at: ago(0.1) } });
  eco('nuget.org', 'Umbraco.Cms', { status: null, latest_release_published_at: ago(0.5), maintainers: [{}], repo_metadata: { archived: false, pushed_at: ago(0.1) } });
  eco('nuget.org', 'Newtonsoft.Json', { status: null, latest_release_published_at: '2023-03-08T00:00:00Z', maintainers: [{}], repo_metadata: { archived: false, pushed_at: ago(14) } });
  eco('nuget.org', 'Microsoft.Azure.Storage.Blob', { status: null, latest_release_published_at: '2020-10-01T00:00:00Z', maintainers: [{}], repo_metadata: { archived: true, pushed_at: '2021-06-01T00:00:00Z' } });
  eco('nuget.org', 'Serilog', { status: null, latest_release_published_at: ago(2), maintainers: [{}, {}], repo_metadata: { archived: false, pushed_at: ago(0.2) } });
  put(`https://api.deps.dev/v3/projects/${encodeURIComponent('github.com/request/request')}`, { openIssuesCount: '142', scorecard: { date: '2026-10-13', overallScore: 3.1, checks: [{ name: 'Maintained', score: 0 }] } });
  // NuGet registration index with inline pages (shape confirmed against api.nuget.org)
  const reg = (id, versions) => put(`https://api.nuget.org/v3/registration5-gz-semver2/${id.toLowerCase()}/index.json`, { count: 1, items: [{ '@id': 'page', count: versions.length, items: versions.map((v) => ({ catalogEntry: { version: v.v, published: v.p, listed: true, projectUrl: '', ...(v.dep ? { deprecation: v.dep } : {}), ...(v.vul ? { vulnerabilities: v.vul } : {}) } })) }] });
  reg('Umbraco.Cms', [{ v: '10.8.0', p: '2023-11-01T00:00:00Z' }, { v: '16.3.1', p: ago(0.5) }]);
  reg('Newtonsoft.Json', [{ v: '12.0.3', p: '2019-11-09T00:00:00Z', vul: [{ advisoryUrl: 'https://github.com/advisories/GHSA-5crp-9r3c-p9vr', severity: '2' }] }, { v: '13.0.4', p: '2025-09-01T00:00:00Z' }]);
  reg('Microsoft.Azure.Storage.Blob', [{ v: '11.2.3', p: '2020-10-01T00:00:00Z', dep: { reasons: ['Legacy'], message: 'Please use Azure.Storage.Blobs', alternatePackage: { id: 'Azure.Storage.Blobs', range: '*' } } }]);
  reg('Serilog', [{ v: '2.12.0', p: '2022-10-01T00:00:00Z' }, { v: '4.3.0', p: ago(2) }]);
  const eol = (prod, cycles) => put(`https://endoflife.date/api/${prod}.json`, cycles);
  eol('nodejs', [{ cycle: '26', eol: '2029-04-30' }, { cycle: '16', eol: '2023-09-11', latest: '16.20.2', lts: '2021-10-26' }]);
  eol('dotnet', [{ cycle: '10.0', eol: '2028-11-14' }, { cycle: '8.0', eol: '2026-11-10' }, { cycle: '6.0', eol: '2024-11-12' }]);
  eol('umbraco', [{ cycle: '16', eol: '2026-12-14' }, { cycle: '10', eol: '2025-06-16' }]);
  eol('nextjs', [{ cycle: '16', eol: false }, { cycle: '13', eol: '2025-08-26' }]);
  eol('react', [{ cycle: '19', eol: false }, { cycle: '18', eol: false }]);
  eol('mssqlserver', [{ cycle: '2022', eol: '2033-01-11' }, { cycle: '2019', eol: '2030-01-08' }]);
  // NuGet vulnerability database (shape confirmed against api.nuget.org/v3/vulnerabilities/index.json).
  const vulnBase = 'https://api.nuget.org/v3-vulnerabilities/test/vulnerability.base.json';
  put('https://api.nuget.org/v3/vulnerabilities/index.json', [{ '@name': 'base', '@id': vulnBase, '@updated': '2026-10-28T00:00:00Z' }]);
  put(vulnBase, { 'system.text.encodings.web': [{ url: 'https://github.com/advisories/GHSA-ghhp-997w-qr28', severity: 3, versions: '[4.0.0, 4.5.1)' }], 'serilog': [{ url: 'https://example.test/old', severity: 2, versions: '(, 1.0.0)' }] });

  // A restored Web.csproj: obj/project.assets.json names its package folder, which holds the nuspecs.
  const pkgs = join(root, 'nuget-packages');
  const nuspec = (id, version, licence, files = {}) => {
    const dir = join(pkgs, id.toLowerCase(), version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id.toLowerCase()}.nuspec`), `<?xml version="1.0"?><package><metadata><id>${id}</id><version>${version}</version>${licence}</metadata></package>`);
    for (const [n, text] of Object.entries(files)) writeFileSync(join(dir, n), text);
  };
  nuspec('Umbraco.Cms', '10.8.0', '<license type="expression">MIT</license>');
  nuspec('Newtonsoft.Json', '12.0.3', '<licenseUrl>https://licenses.nuget.org/MIT</licenseUrl>');
  nuspec('Microsoft.Azure.Storage.Blob', '11.2.3', '<licenseUrl>https://go.microsoft.com/fwlink/?LinkId=329770</licenseUrl>');
  nuspec('iTextSharp', '5.5.13', '<license type="file">LICENSE.txt</license>', { 'LICENSE.txt': '                    GNU AFFERO GENERAL PUBLIC LICENSE\n                       Version 3, 19 November 2007\n' });
  nuspec('System.Text.Encodings.Web', '4.5.0', '<license type="expression">MIT</license>');
  const lib = (id, v, deps = {}) => [`${id}/${v}`, { type: 'package', dependencies: deps }];
  writeJson(join(root, 'src', 'Web', 'obj', 'project.assets.json'), {
    version: 3,
    targets: { 'net6.0': Object.fromEntries([
      lib('Umbraco.Cms', '10.8.0', { 'iTextSharp': '5.5.13', 'System.Text.Encodings.Web': '4.5.0' }),
      lib('Newtonsoft.Json', '12.0.3'), lib('Microsoft.Azure.Storage.Blob', '11.2.3'), lib('iTextSharp', '5.5.13'), lib('System.Text.Encodings.Web', '4.5.0'),
    ]) },
    libraries: Object.fromEntries(['Umbraco.Cms/10.8.0', 'Newtonsoft.Json/12.0.3', 'Microsoft.Azure.Storage.Blob/11.2.3', 'iTextSharp/5.5.13', 'System.Text.Encodings.Web/4.5.0']
      .map((k) => [k, { type: 'package', path: k.toLowerCase() }])),
    packageFolders: { [`${pkgs}/`]: {} },
    project: { frameworks: { 'net6.0': { dependencies: { 'Umbraco.Cms': {}, 'Newtonsoft.Json': {}, 'Microsoft.Azure.Storage.Blob': {} } } } },
  });

  server = spawn(process.execPath, [join(here, 'mock', 'server.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('mock up')) resolve(); });
    server.on('exit', (c) => reject(new Error(`mock server exited with ${c}`)));
    setTimeout(() => reject(new Error('mock server did not start')), 10_000);
  });
});

after(() => { server?.kill(); if (!process.env.KEEP) rmSync(root, { recursive: true, force: true }); else console.log('kept', root); });

test('discover: manifests, runtime pins and outbound hosts', () => {
  assert.equal(run('discover').status, 0);
  const d = json('discovery.json');
  assert.deepEqual(d.manifests.npm, ['frontend/package.json']);
  assert.ok(d.manifests.nuget.includes('src/Web/Web.csproj') && d.manifests.nuget.includes('Directory.Packages.props'));
  assert.ok(d.runtimePins.includes('.nvmrc'));
  const hosts = Object.fromEntries(d.hosts.map((h) => [h.host, h]));
  assert.equal(hosts['api.dataforsyningen.dk'].status, 'tracked');
  assert.equal(hosts['maps.googleapis.com'].status, 'ignored');
  assert.equal(hosts['api.hubapi.com'].status, 'untracked');
  assert.equal(hosts['api.hubapi.com'].priority, 'high', 'a host in an appsettings BaseUrl key is high priority');
  assert.equal(hosts['developer.mozilla.org'], undefined, 'documentation hosts are filtered out');
});

test('packages: deprecation, archived repos, vulnerabilities, ignores, central versions', () => {
  assert.equal(run('packages').status, 0);
  const p = json('packages.json');
  const by = Object.fromEntries(p.packages.map((x) => [x.name, x]));
  assert.equal(by['Microsoft.Azure.Storage.Blob'].verdict.level, 'red');
  assert.match(by['Microsoft.Azure.Storage.Blob'].verdict.reasons.join(' '), /Azure\.Storage\.Blobs/, 'NuGet alternatePackage is surfaced');
  assert.equal(by['Newtonsoft.Json'].verdict.level, 'red', 'high-severity NuGet vulnerability on the installed version');
  assert.equal(by['Serilog'].installed, '2.12.0', 'version resolved from Directory.Packages.props');
  assert.equal(by['node-sass'].verdict.level, 'red');
  assert.match(by['node-sass'].verdict.reasons.join(' '), /archived/);
  assert.equal(by['left-pad'].verdict.level, 'red', 'an ignore entry never hides a red');
  assert.match(by['left-pad'].verdict.reasons[0], /ignore list/);
  assert.match(by['react'].verdict.reasons[0], /expired/);
  assert.equal(by['clsx'].verdict.level, 'ignored', 'an ignore with reason and expiry hides a red caused only by staleness');
  assert.equal(by['classnames'].verdict.level, 'red', 'without an expiry the stale red stays');
  assert.match(by['classnames'].verdict.reasons[0], /reason and an expiry/);
  assert.equal(by['request'].health.maintainedCheck, 0, 'Scorecard Maintained read from deps.dev project');
  assert.equal(by['Umbraco.Cms'].facts.latest, '16.3.1');
});

test('packages: licences of the whole tree, judged against a closed-source solution', () => {
  const p = json('packages.json');
  assert.equal(p.licenses.project.id, 'proprietary');
  assert.equal(p.licenses.project.from, 'assumed');
  const lic = Object.fromEntries(p.licenses.packages.map((x) => [x.name, x]));
  assert.equal(lic['agpl-thing'].verdict.level, 'red', 'AGPL in a shipped transitive package');
  assert.equal(lic['agpl-thing'].direct, false);
  assert.deepEqual(lic['agpl-thing'].parents, ['request'], 'npm parents from the lockfile graph');
  assert.equal(lic['busl-sdk'].verdict.level, 'red', 'source-available licence');
  assert.equal(lic['mystery-pkg'].verdict.level, 'amber', 'no licence declared');
  assert.equal(lic['dual-licensed'].verdict.level, 'green', 'MIT OR GPL-3.0: MIT can be chosen');
  assert.equal(lic['gpl-build-tool'].verdict.level, 'info', 'GPL in a dev-only tool is not shipped');
  assert.equal(lic['request'].license, 'Apache-2.0', 'licence read from package-lock.json');
  assert.equal(lic['iTextSharp'].verdict.level, 'red', 'AGPL found in the licence file the nuspec points to');
  assert.deepEqual(lic['iTextSharp'].parents, ['umbraco.cms']);
  assert.equal(lic['Microsoft.Azure.Storage.Blob'].verdict.level, 'green', 'the .NET library licence URL is recognised');
  assert.equal(lic['Newtonsoft.Json'].license, 'MIT');
  assert.ok(p.nugetProjects.find((x) => x.path === 'src/Lib/Lib.csproj').notes.some((n) => /dotnet restore/.test(n)), 'an unrestored project says so');
});

test('packages: vulnerable transitive NuGet packages from the vulnerability database', () => {
  const p = json('packages.json');
  const v = p.transitiveVulns.find((x) => x.name === 'System.Text.Encodings.Web');
  assert.ok(v, 'found through obj/project.assets.json');
  assert.equal(v.verdict.level, 'red');
  assert.equal(v.severity, 'critical');
  assert.deepEqual(v.parents, ['umbraco.cms']);
  assert.equal(p.transitiveVulns.some((x) => x.name === 'Serilog'), false, 'out-of-range versions do not match');
});

test('licences: classification, policy and version ranges', async () => {
  const { classify, licenseVerdict, inNugetRange, normalizeLicense, licenseFromUrl } = await import('../licenses.mjs');
  assert.equal(classify('MIT').category, 'permissive');
  assert.equal(classify('(MIT OR GPL-3.0)').category, 'permissive');
  assert.equal(classify('MIT AND GPL-3.0').category, 'strong-copyleft');
  assert.equal(classify('GPL-2.0 WITH Classpath-exception-2.0').category, 'weak-copyleft');
  assert.equal(classify('SEE LICENSE IN LICENSE.md').category, 'unknown');
  assert.equal(classify('UNLICENSED').category, 'proprietary');
  assert.equal(classify('Unlicense').category, 'permissive');
  assert.equal(normalizeLicense('Apache License, Version 2.0'), 'Apache-2.0');
  assert.equal(normalizeLicense([{ type: 'MIT' }, { type: 'Apache-2.0' }]), '(MIT OR Apache-2.0)');
  assert.equal(licenseFromUrl('https://opensource.org/licenses/MIT'), 'MIT');
  const e = (license, extra = {}) => ({ ecosystem: 'npm', name: 'x', license, dev: false, ...extra });
  assert.equal(licenseVerdict(e('GPL-3.0')).level, 'amber');
  assert.equal(licenseVerdict(e('GPL-3.0'), { project: { id: 'GPL-3.0-or-later' } }).level, 'green', 'copyleft inside a copyleft solution');
  assert.equal(licenseVerdict(e('Apache-2.0'), { project: { id: 'GPL-2.0-only' } }).level, 'red', 'Apache-2.0 cannot go into GPL-2.0-only');
  assert.equal(licenseVerdict(e('GPL-2.0-only'), { project: { id: 'GPL-3.0-only' } }).level, 'red');
  assert.equal(licenseVerdict(e('MIT'), { policy: { deny: ['MIT'] } }).level, 'red', 'deny list wins');
  assert.equal(licenseVerdict(e('AGPL-3.0'), { policy: { accept: [{ name: 'x', reason: 'legal ok' }] } }).level, 'ignored');
  assert.equal(licenseVerdict(e('AGPL-3.0'), { policy: { accept: [{ name: 'x', reason: 'old', expires: '2020-01-01' }] } }).level, 'red', 'expired acceptance');
  assert.equal(licenseVerdict(e('PolyForm-Noncommercial-1.0.0', { dev: true })).level, 'amber', 'non-commercial stays amber even for dev tools');
  assert.ok(inNugetRange('4.5.0', '[4.0.0, 4.5.1)'));
  assert.ok(!inNugetRange('4.5.1', '[4.0.0, 4.5.1)'));
  assert.ok(inNugetRange('12.0.3', '(, 13.0.1)'));
  assert.ok(inNugetRange('8.0.4', '[8.0.0, 8.0.4]'));
  assert.ok(!inNugetRange('8.0.5-preview.1', '[8.0.0, 8.0.4]'));
  assert.ok(inNugetRange('1.2.0', '[1.2.0]'));
});

test('licences: vendor terms, Unicode/ICU and packages not on disk are not decisions', async () => {
  const { licenseVerdict, licenseFromUrl, licenseFromText } = await import('../licenses.mjs');
  const e = (license, extra = {}) => ({ ecosystem: 'nuget', name: 'x', license, dev: false, ...extra });
  assert.equal(licenseFromUrl('https://go.microsoft.com/fwlink/?linkid=869050'), 'LicenseRef-Microsoft-EULA');
  assert.equal(licenseFromUrl('https://umbraco.com/licensing/'), 'LicenseRef-Umbraco-Commercial');
  assert.equal(licenseFromText('UNICODE LICENSE V3\n\nCOPYRIGHT AND PERMISSION NOTICE'), 'Unicode-3.0');
  assert.equal(licenseFromText('MIT License\nCopyright (c) Umbraco\nPermission is hereby granted, free of charge'), 'MIT', 'an MIT licence that names Umbraco is still MIT');
  assert.equal(licenseVerdict(e('Unicode-3.0')).level, 'green');
  assert.equal(licenseVerdict(e('ICU')).level, 'green');
  assert.equal(licenseVerdict(e('LicenseRef-Umbraco-Commercial')).level, 'info');
  assert.equal(licenseVerdict(e('LicenseRef-Microsoft-EULA')).level, 'info');
  assert.equal(licenseVerdict(e(null, { unread: true })).level, 'info', 'no nuspec on disk is not "no licence"');
  assert.equal(licenseVerdict(e(null)).level, 'amber');
});

test('versions: comparing, the Node major the project pins, MSBuild properties', async () => {
  const { compareVersions, isNewer, nodeMajor, msbuildProperties, expandMsbuild } = await import('../versions.mjs');
  assert.ok(isNewer('1.10.0', '1.9.2'));
  assert.equal(isNewer('1.2.0', '1.2.0'), false);
  assert.equal(isNewer('72.1.0.3', '$(UmbracoAppLocalIcuVersion)'), false, 'an unresolved property is never "older"');
  assert.equal(compareVersions('2.0.0-rc.1', '2.0.0') < 0, true);
  const dir = mkdtempSync(join(tmpdir(), 'sh-versions-'));
  try {
    mkdirSync(join(dir, 'src', 'Web'), { recursive: true });
    writeFileSync(join(dir, '.nvmrc'), 'v24.11.0\n');
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:26-alpine\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=20' } }));
    assert.deepEqual(nodeMajor({ root: dir, runtimePins: ['.nvmrc', 'Dockerfile'], npmManifests: ['package.json'] }), { major: 24, source: '.nvmrc' }, 'exact pins win over engines; the lowest pin');
    assert.equal(nodeMajor({ root: dir, runtimePins: [], npmManifests: ['package.json'] }).major, 20);
    writeFileSync(join(dir, 'Directory.Build.props'), '<Project><PropertyGroup><IcuMajor>72.1</IcuMajor><UmbracoAppLocalIcuVersion>$(IcuMajor).0.3</UmbracoAppLocalIcuVersion></PropertyGroup></Project>');
    writeFileSync(join(dir, 'src', 'Web', 'Web.csproj'), '<Project><PropertyGroup Condition="\'$(X)\'==\'\'"><IcuMajor>1</IcuMajor></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.ICU.ICU4C.Runtime" Version="$(UmbracoAppLocalIcuVersion)" /></ItemGroup></Project>');
    const { props, files } = msbuildProperties(dir, 'src/Web/Web.csproj');
    assert.deepEqual(files, ['Directory.Build.props', 'src/Web/Web.csproj']);
    assert.equal(expandMsbuild('$(UmbracoAppLocalIcuVersion)', props, {}).value, '72.1.0.3', 'nested properties; a conditional group does not override');
    assert.deepEqual(expandMsbuild('$(Nope)', props, {}).unresolved, ['$(Nope)']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tasks: no upgrade task without a newer version; amber licences become one review task', async () => {
  const { buildTasks } = await import('../tasks.mjs');
  const pkg = (name, installed, latest, reasons, level = 'amber', extra = {}) => ({ key: `pkg:nuget:${name.toLowerCase()}`, area: 'package', level, title: name, reasons, where: ['a.csproj'], extra: { ecosystem: 'nuget', name, installed, facts: { latest, ...extra } } });
  const lic = (name) => ({ key: `lic:nuget:${name}`, area: 'licence', level: 'amber', title: name, reasons: ['licence not recognised'], where: ['a.csproj'], extra: { ecosystem: 'nuget', name, license: 'https://x.test/LICENSE', versions: ['1.0.0'], direct: true } });
  const { tasks } = buildTasks([
    pkg('Quiet', '1.2.0', '1.2.0', ['no release in 14 months']),
    pkg('Icu', null, '72.1.0.3', ['no release in 30 months']),
    pkg('Behind', '1.0.0', '3.1.0', ['2 major versions behind (1.0.0 → 3.1.0)']),
    lic('a'), lic('b'), lic('c'),
  ], { root: '/x/repo' });
  assert.deepEqual(tasks.map((t) => t.title), ['Upgrade Behind 1.0.0 to 3.1.0', 'Check 3 licences the scan could not clear']);
  assert.match(tasks[1].evidence, /nuget a .*nuget c/);
  const typed = buildTasks([{ key: 'pkg:npm:@types/node', area: 'package', level: 'amber', title: '@types/node', reasons: [], where: ['package.json'], extra: { ecosystem: 'npm', name: '@types/node', installed: '20.1.0', facts: { latest: '24.9.0', pinnedTo: { major: 24, source: '.nvmrc' } } } }], { root: '/x/repo' }).tasks[0];
  assert.match(typed.fix, /Stay on 24\.x/);
});

test('runtimes: end-of-life from .nvmrc, TargetFramework, packages and manifest extras', () => {
  assert.equal(run('runtimes').status, 0);
  const r = Object.fromEntries(json('runtimes.json').runtimes.map((x) => [`${x.product} ${x.cycle}`, x]));
  assert.equal(r['nodejs 16'].verdict.level, 'red');
  assert.equal(r['dotnet 6.0'].verdict.level, 'red');
  assert.ok(['amber', 'red'].includes(r['dotnet 8.0'].verdict.level), 'net8.0 from a multi-target Lib.csproj');
  assert.equal(r['umbraco 10'].verdict.level, 'red');
  assert.equal(r['nextjs 13'].verdict.level, 'red');
  assert.equal(r['react 18'].verdict.level, 'green');
  assert.equal(r['mssqlserver 2019'].verdict.level, 'green');
});

test('apis: deprecation headers, Danish shutdown banner, change file for Claude', () => {
  assert.equal(run('apis').status, 0);
  const a = json('apis.json');
  const dawa = a.apis.find((x) => x.name.startsWith('DAWA'));
  assert.equal(dawa.verdict.level, 'red');
  assert.equal(dawa.probe.deprecationDate, '2025-06-30T22:00:00.000Z', 'RFC 9745 @unix date parsed');
  assert.equal(dawa.probe.sunsetDate.slice(0, 10), '2026-07-01');
  assert.equal(dawa.probe.links['successor-version'], 'https://adressevaelger.dk');
  assert.equal(dawa.codeRefs, 1, 'host still referenced in frontend/src/address.ts');
  const page = dawa.pages[0];
  assert.equal(page.change, 'baseline');
  assert.ok(page.newKeywordHits.some((s) => /lukker den 1\. juli 2026/.test(s)), 'Danish keyword "lukker" matched');
  assert.ok(page.needsReview && existsSync(join(root, page.changeFile)), 'a change file was written for Claude to read');
  const psp = a.apis.find((x) => x.name.startsWith('Example'));
  assert.equal(psp.pages[0].keywordHits, 0, 'a plain changelog has no hits');
  assert.ok(a.untrackedHosts.some((h) => h.host === 'api.hubapi.com'));
});

test('finalize: report, state, and unassessed changes keep coming back until assessed', () => {
  assert.equal(run('finalize').status, 0);
  const report = readFileSync(join(sh, 'report.md'), 'utf8');
  assert.match(report, /## ⚠️ Changed pages not yet assessed/);
  assert.match(report, /### 🔴 DAWA/);
  assert.match(report, /nodejs 16 is end-of-life/);
  assert.match(report, /api\.hubapi\.com/);
  assert.match(report, /## Licences \(\d+ packages/);
  assert.match(report, /Solution licence: \*\*proprietary\*\* \(assumed/);
  assert.match(report, /## Vulnerable transitive packages/);
  assert.match(report, /System\.Text\.Encodings\.Web/);
  let state = JSON.parse(readFileSync(join(sh, 'state.json'), 'utf8'));
  const url = `http://127.0.0.1:${PORT}/docs`;
  assert.equal(state.apis['DAWA (Danmarks Adressers Web API)'].pages[url].hash, null, 'unassessed page is not accepted as baseline');

  // Second run, same page, still unassessed → flagged again
  assert.equal(run('apis').status, 0);
  assert.equal(json('apis.json').apis[0].pages[0].needsReview, true);

  // Claude assesses it → accepted, and a third run sees it unchanged
  writeJson(join(sh, 'run', 'assessments.json'), { [url]: { verdict: 'red', summary: 'DAWA closes 1 July 2026; migrate to Adressevælger.', action: 'Replace the call in frontend/src/address.ts.' } });
  assert.equal(run('finalize').status, 0);
  state = JSON.parse(readFileSync(join(sh, 'state.json'), 'utf8'));
  assert.ok(state.apis['DAWA (Danmarks Adressers Web API)'].pages[url].hash, 'assessed page accepted');
  assert.match(readFileSync(join(sh, 'report.md'), 'utf8'), /Suggested action: Replace the call/);
  assert.equal(run('apis').status, 0);
  const again = json('apis.json').apis.find((x) => x.name.startsWith('DAWA')).pages[0];
  assert.equal(again.change, 'unchanged');
  assert.equal(again.needsReview, undefined);
});

test('finalize: notes.md survives every run; a hand-edited report.md is saved before it is rewritten', async () => {
  writeFileSync(join(sh, 'notes.md'), '# DAWA\n\nMigration ticket SHOP-42, owner Anna.\n');
  await new Promise((r) => setTimeout(r, 2100));
  writeFileSync(join(sh, 'report.md'), `${readFileSync(join(sh, 'report.md'), 'utf8')}\nHand-written triage\n`);
  assert.equal(run('finalize').status, 0);
  const report = readFileSync(join(sh, 'report.md'), 'utf8');
  assert.match(report, /## Notes[\s\S]*### DAWA[\s\S]*SHOP-42/, 'notes.md included, headings moved down');
  assert.doesNotMatch(report, /Hand-written triage/);
  const saved = join(sh, `report.edited-${new Date().toISOString().slice(0, 10)}.md`);
  assert.match(readFileSync(saved, 'utf8'), /Hand-written triage/);
  assert.equal(readFileSync(join(sh, 'notes.md'), 'utf8'), '# DAWA\n\nMigration ticket SHOP-42, owner Anna.\n', 'finalize never writes notes.md');
});

test('finalize: tasks.json in the shape audit-all and audit-fix take', async () => {
  const t = JSON.parse(readFileSync(join(sh, 'tasks.json'), 'utf8'));
  assert.equal(t.subject, basename(root));
  assert.equal(t.repos[basename(root)], root);
  const by = (re) => t.tasks.find((x) => re.test(x.title));
  const blob = by(/^Replace Microsoft\.Azure\.Storage\.Blob/);
  assert.ok(blob && blob.owner === 'agent' && /Azure\.Storage\.Blobs/.test(blob.fix));
  assert.deepEqual(blob.files, ['src/Web/Web.csproj']);
  const lic = by(/licence of agpl-thing/);
  assert.equal(lic.owner, 'human');
  assert.equal(lic.severity, 'high');
  assert.ok(by(/transitive System\.Text\.Encodings\.Web/));
  assert.equal(by(/^Upgrade dotnet 6\.0/).model, 'opus');
  assert.equal(by(/Serilog/)?.files?.[0] ?? 'Directory.Packages.props', 'Directory.Packages.props', 'centrally versioned packages point at the props file');
  assert.ok(t.tasks.every((x) => x.sources[0] === 'health' && /^H\d+$/.test(x.id)));
  // The audit-all validator accepts it as it is, when that skill sits next to this one.
  const validator = join(scripts, '..', '..', 'audit-all', 'scripts', 'lib', 'tasks.mjs');
  if (existsSync(validator)) {
    const { validateTasks } = await import(validator);
    const { errors } = validateTasks(t);
    assert.deepEqual(errors, []);
  }
  const state = JSON.parse(readFileSync(join(sh, 'state.json'), 'utf8'));
  assert.equal(state.licenses['lic:npm:agpl-thing'].level, 'red', 'licence findings are tracked between runs');
  assert.equal(state.vulns['vuln:nuget:system.text.encodings.web'].level, 'red');
});

test('state folder: default is outside the repo under the report folder; --in-repo and --dir keep it in the solution', async () => {
  const { paths, defaultStateDir, reportsRoot } = await import('../lib.mjs');
  const reports = '/r';
  const p = paths({ root: '/code/shop-web' }, { reports, readFile: () => null });
  assert.equal(p.dir, '/r/solution-health/shop-web');
  assert.equal(p.manifest, '/r/solution-health/shop-web/manifest.json');
  assert.equal(p.inRepo, false);
  assert.equal(paths({ root: '/code/shop-web', 'in-repo': true }).dir, '/code/shop-web/.solution-health');
  assert.equal(paths({ root: '/code/shop-web', dir: 'health' }).dir, '/code/shop-web/health');
  // A folder of the same name owned by another solution gets a hash suffix.
  assert.equal(defaultStateDir('/code/shop-web', { reports, readFile: () => '/code/shop-web\n' }), '/r/solution-health/shop-web');
  assert.match(defaultStateDir('/other/shop-web', { reports, readFile: () => '/code/shop-web\n' }), /^\/r\/solution-health\/shop-web-[0-9a-f]{8}$/);
  assert.equal(reportsRoot({ env: { AUDIT_OUT_DIR: '/out' }, home: '/h' }), '/out');
  assert.equal(reportsRoot({ env: {}, home: '/h', isDir: (d) => d === '/h/Downloads', readFile: () => null }), '/h/Downloads');
  assert.equal(reportsRoot({ env: {}, home: '/h', isDir: () => false, readFile: () => null }), '/h/audit-reports');
});

test('state is never kept in an audit run folder; state an earlier run left there is copied back once', () => {
  const repo = mkdtempSync(join(tmpdir(), 'sh-run-'));
  const out = mkdtempSync(join(tmpdir(), 'sh-out-'));
  try {
    const runDir = join(out, 'audit-all', 'any-name-at-all', 'solution-health');
    mkdirSync(join(runDir, 'run'), { recursive: true });
    writeFileSync(join(out, 'audit-all', 'any-name-at-all', '.audit-run'), '{}');
    writeFileSync(join(runDir, 'manifest.json'), '{"apis":[{"name":"Loby"}]}');
    writeFileSync(join(runDir, 'state.json'), '{"version":1,"lastRun":"2026-10-30"}');
    writeJson(join(runDir, 'run', 'discovery.json'), { root: repo });
    const r = spawnSync(process.execPath, [join(scripts, 'check.mjs'), '--root', repo, '--offline', '--skip', 'discover,packages,runtimes,apis'], { encoding: 'utf8', env: { ...process.env, AUDIT_OUT_DIR: out } });
    const dir = join(out, 'solution-health', basename(repo));
    assert.match(r.stderr, /Copied the manifest and state from .*any-name-at-all/);
    assert.match(readFileSync(join(dir, 'manifest.json'), 'utf8'), /Loby/);
    // --dir pointing into a run folder is ignored in favour of the stable folder
    const r2 = spawnSync(process.execPath, [join(scripts, 'check.mjs'), '--root', repo, '--dir', runDir, '--offline', '--skip', 'discover,packages,runtimes,apis'], { encoding: 'utf8', env: { ...process.env, AUDIT_OUT_DIR: out } });
    assert.match(r2.stderr, /inside an audit run folder/);
    assert.match(r2.stderr, new RegExp(`State folder: ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('check.mjs copies an old in-repo .solution-health once and then uses the report folder', () => {
  const repo = mkdtempSync(join(tmpdir(), 'sh-legacy-'));
  const out = mkdtempSync(join(tmpdir(), 'sh-out-'));
  try {
    mkdirSync(join(repo, '.solution-health', 'run'), { recursive: true });
    writeFileSync(join(repo, '.solution-health', 'manifest.json'), '{"apis":[]}');
    writeFileSync(join(repo, '.solution-health', 'state.json'), '{"version":1}');
    writeFileSync(join(repo, '.solution-health', 'run', 'junk.json'), '{}');
    const r = spawnSync(process.execPath, [join(scripts, 'check.mjs'), '--root', repo, '--offline', '--skip', 'discover,packages,runtimes,apis'], { encoding: 'utf8', env: { ...process.env, AUDIT_OUT_DIR: out } });
    const dir = join(out, 'solution-health', basename(repo));
    assert.match(r.stderr, /Copied the manifest and state/);
    assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), '{"version":1}');
    assert.equal(existsSync(join(dir, 'run', 'junk.json')), false, 'run/ is not copied');
    assert.equal(readFileSync(join(dir, 'root.txt'), 'utf8').trim(), repo);
    assert.equal(existsSync(join(repo, '.solution-health', 'manifest.json')), true, 'the old folder is left alone');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
