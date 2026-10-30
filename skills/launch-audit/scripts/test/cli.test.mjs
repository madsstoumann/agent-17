import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parseCli, detectEnv, normaliseEnv, isStagingHost, resolveOut, reportsRoot, usage, DEFAULTS } from '../lib/cli.mjs';

test('parseCli applies defaults and normalises the URL', () => {
  const r = parseCli(['example.com/a'], {});
  assert.equal(r.ok, true);
  assert.equal(r.opts.url, 'https://example.com/a');
  assert.equal(r.opts.host, 'example.com');
  assert.equal(r.opts.pages, DEFAULTS.pages);
  assert.equal(r.opts.maxPages, DEFAULTS.maxPages);
  assert.equal(r.opts.lighthouse, 'local');
  assert.deepEqual(r.opts.skip, []);
  assert.equal(r.opts.env, 'production');
  assert.equal(r.opts.envSource, 'auto');
  assert.equal(r.opts.production, true);
  assert.equal(r.opts.productionHost, 'example.com');
  assert.equal(r.opts.emailDomain, 'example.com');
});

test('parseCli parses lists, numbers, env aliases and keys from the environment', () => {
  const r = parseCli(['https://www.example.com/', '--skip', 'perf,links', '--pages', '0', '--env', 'stage', '--production-host', 'www.live.com', '--out', './x', '--insecure'], { PSI_API_KEY: 'k' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.opts.skip, ['perf', 'links']);
  assert.equal(r.opts.pages, 0);
  assert.equal(r.opts.env, 'staging');
  assert.equal(r.opts.envSource, 'flag');
  assert.equal(r.opts.production, false);
  assert.equal(r.opts.productionHost, 'www.live.com');
  assert.equal(r.opts.lighthouse, 'psi');
  assert.equal(r.opts.psiKey, 'k');
  assert.equal(r.opts.insecure, true);
  assert.equal(r.opts.emailDomain, 'example.com', 'www. stripped');
});

test('parseCli rejects unknown flags, bad env values and missing URL', () => {
  assert.equal(parseCli(['--bogus'], {}).ok, false);
  assert.equal(parseCli(['example.com', '--env', 'moon'], {}).ok, false);
  assert.equal(parseCli([], {}).ok, false);
  assert.equal(parseCli(['ftp://x'], {}).ok, false);
  assert.equal(parseCli(['--help'], {}).help, true);
});

test('normaliseEnv maps aliases to the three labels', () => {
  assert.deepEqual(normaliseEnv('dev'), { env: 'dev', production: false });
  assert.deepEqual(normaliseEnv('DEVELOPMENT'), { env: 'dev', production: false });
  assert.deepEqual(normaliseEnv('stg'), { env: 'staging', production: false });
  assert.deepEqual(normaliseEnv('uat'), { env: 'staging', production: false });
  assert.deepEqual(normaliseEnv('live'), { env: 'production', production: true });
  assert.equal(normaliseEnv('moon'), null);
});

test('isStagingHost and detectEnv', () => {
  assert.equal(isStagingHost('akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app'), true);
  assert.equal(isStagingHost('stage.example.com'), true);
  assert.equal(isStagingHost('www.example.com'), false);
  assert.equal(isStagingHost('browser.style'), false);
  assert.equal(isStagingHost('devices.example.com'), false, 'dev inside a word is not staging');
  assert.equal(isStagingHost('example-test.vercel.app'), true);
  assert.deepEqual(detectEnv('akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app'), { env: 'staging', production: false, source: 'auto', reason: 'hostname looks like a non-production host' });
  assert.deepEqual(detectEnv('localhost:44380'), { env: 'dev', production: false, source: 'auto', reason: 'private host' });
  assert.deepEqual(detectEnv('browser.style'), { env: 'production', production: true, source: 'auto', reason: 'no staging marker in hostname' });
});

test('resolveOut: default folder under Downloads, explicit folder, explicit .md file', () => {
  const now = new Date('2026-09-24T08:05:00');
  const d = resolveOut({ out: null, host: 'localhost:44380' }, { now, home: '/Users/me', cwd: '/tmp', root: '/Users/me/Downloads' });
  assert.equal(d.dir, '/Users/me/Downloads/launch-audit/localhost-44380-20260924-0805');
  assert.equal(d.reportMd, path.join(d.dir, 'report.md'));
  assert.equal(d.reportJson, path.join(d.dir, 'report.json'));
  assert.equal(d.rawDir, d.dir);
  const f = resolveOut({ out: './docs/audits', host: 'x.com' }, { now, home: '/Users/me', cwd: '/proj' });
  assert.equal(f.dir, '/proj/docs/audits');
  const m = resolveOut({ out: '~/Downloads/IOI.launch-audit.md', host: 'x.com' }, { now, home: '/Users/me', cwd: '/proj' });
  assert.equal(m.reportMd, '/Users/me/Downloads/IOI.launch-audit.md');
  assert.equal(m.reportJson, '/Users/me/Downloads/IOI.launch-audit.json');
  assert.equal(m.rawDir, '/Users/me/Downloads/IOI.launch-audit-raw');
  assert.equal(m.dir, '/Users/me/Downloads');
});

test('usage mentions every flag', () => {
  const u = usage();
  for (const f of ['--env', '--production-host', '--pages', '--max-pages', '--skip', '--only', '--lighthouse', '--out', '--baseline', '--insecure', '--email-domain', '--ssllabs', '--no-remote', '--strict', '--json', '--quiet']) {
    assert.ok(u.includes(f), f);
  }
});

test('reportsRoot: AUDIT_OUT_DIR, then XDG download dir, then ~/Downloads, then ~/audit-reports', () => {
  const home = '/home/me';
  const has = (...dirs) => (p) => dirs.includes(p);
  assert.equal(reportsRoot({ env: { AUDIT_OUT_DIR: '~/reports' }, home, isDir: has() }), '/home/me/reports');
  assert.equal(reportsRoot({ env: {}, home, isDir: has('/home/me/Downloads') , readFile: () => null }), '/home/me/Downloads');
  assert.equal(reportsRoot({ env: {}, home, isDir: has('/home/me/Hentet', '/home/me/Downloads'), readFile: () => 'XDG_DOWNLOAD_DIR="$HOME/Hentet"\n' }), '/home/me/Hentet');
  assert.equal(reportsRoot({ env: { XDG_DOWNLOAD_DIR: '/data/dl' }, home, isDir: has('/data/dl'), readFile: () => null }), '/data/dl');
  assert.equal(reportsRoot({ env: {}, home, isDir: has(), readFile: () => null }), '/home/me/audit-reports');
});
