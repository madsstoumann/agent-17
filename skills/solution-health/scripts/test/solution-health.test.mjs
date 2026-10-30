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
  assert.equal(by['request'].health.maintainedCheck, 0, 'Scorecard Maintained read from deps.dev project');
  assert.equal(by['Umbraco.Cms'].facts.latest, '16.3.1');
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
