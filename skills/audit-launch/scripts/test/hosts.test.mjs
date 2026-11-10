import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicSuffix, registrableDomain, subLabels, isPublicSuffix, platformOf, stagingLabel, isPreviewPlatform } from '../lib/hosts.mjs';

const lib = (skill, f) => new URL(`../../../${skill}/scripts/lib/${f}`, import.meta.url);

test('hosts.mjs, hosts.json and psl.dat.gz are identical in audit-launch, audit-security and audit-infra', () => {
  for (const f of ['hosts.mjs', 'hosts.json', 'psl.dat.gz']) {
    const mine = readFileSync(lib('audit-launch', f));
    for (const other of ['audit-security', 'audit-infra']) assert.ok(mine.equals(readFileSync(lib(other, f))), `${other}/scripts/lib/${f} differs`);
  }
});

test('publicSuffix and registrableDomain follow the Public Suffix List', () => {
  assert.deepEqual(publicSuffix('a.b.example.co.uk'), { suffix: 'co.uk', private: false });
  assert.deepEqual(publicSuffix('x.vercel.app'), { suffix: 'vercel.app', private: true });
  assert.deepEqual(publicSuffix('x.vercel.app', { icann: true }), { suffix: 'app', private: false });
  assert.equal(registrableDomain('www.example.com.au'), 'example.com.au');
  assert.equal(registrableDomain('example.com.'), 'example.com');
  assert.equal(registrableDomain('co.uk'), null);
  assert.equal(registrableDomain('x.vercel.app', { icann: true }), 'vercel.app');
  assert.deepEqual(subLabels('a.b.example.co.uk'), ['a', 'b']);
  assert.equal(publicSuffix('192.0.2.1'), null);
});

test('isPublicSuffix: anyone can register or deploy below it', () => {
  for (const s of ['vercel.app', 'github.io', 'co.uk', 'com', 'pages.dev']) assert.equal(isPublicSuffix(s), true, s);
  for (const s of ['example.com', 'cms.example.com', 'x.vercel.app']) assert.equal(isPublicSuffix(s), false, s);
});

test('platformOf: PSL private section first, then hosts.json', () => {
  assert.equal(platformOf('x.vercel.app'), 'vercel.app');
  assert.equal(platformOf('example-live.euwest01.umbraco.io'), 'umbraco.io');
  assert.equal(platformOf('notumbraco.io'), null);
  assert.equal(platformOf('www.example.com'), null);
});

test('stagingLabel reads only labels below the registrable domain', () => {
  assert.equal(stagingLabel('dev.example.com'), 'dev');
  assert.equal(stagingLabel('site-stage.example.co.uk'), 'site-stage');
  assert.equal(stagingLabel('stage-x.euwest01.umbraco.io'), 'stage-x');
  assert.equal(stagingLabel('devices.example.com'), null);
  assert.equal(stagingLabel('dev.tld'), null);
  assert.equal(stagingLabel('demo-shop.tld'), null);
  assert.equal(stagingLabel('www.example.com'), null);
  assert.equal(isPreviewPlatform('example-test.vercel.app'), true);
  assert.equal(isPreviewPlatform('example.com'), false);
});
