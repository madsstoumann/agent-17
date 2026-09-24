import { test } from 'node:test';
import assert from 'node:assert/strict';
import { result, GROUPS, groupOf, applyEnvPolicy, runGroups, filterGroups, countStatuses, STATUS_ORDER, isSkipped } from '../lib/registry.mjs';

test('result builds a CheckResult with the group derived from the id prefix', () => {
  const r = result('crawl.meta-robots', 'fail', 'Meta robots', 'noindex', { fix: 'remove it', beforeProduction: true });
  assert.deepEqual(r, { id: 'crawl.meta-robots', group: 'crawl', status: 'fail', title: 'Meta robots', evidence: 'noindex', fix: 'remove it', beforeProduction: true });
  assert.equal(result('dns.caa', 'pass', 'CAA', 'ok').group, 'tls');
  assert.equal(result('social.og', 'warn', 'OG', 'x').group, 'links');
  assert.throws(() => result('crawl.x', 'maybe', 'x', 'y'));
});

test('GROUPS are ordered 1..12 and every prefix resolves', () => {
  assert.equal(GROUPS.length, 12);
  assert.deepEqual(GROUPS.map((g) => g.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(groupOf('hsts.preload').id, 'tls');
  assert.equal(groupOf('icons.favicon').id, 'links');
  assert.equal(groupOf('nope.x'), null);
});

test('applyEnvPolicy demotes beforeProduction findings on dev and marks them blockers on production', () => {
  const rs = [
    result('crawl.meta-robots', 'fail', 'Meta robots', 'noindex', { beforeProduction: true }),
    result('crawl.robots-txt', 'warn', 'robots.txt', 'Disallow: /', { beforeProduction: true }),
    result('headers.grade', 'warn', 'Grade', 'B'),
    result('exposed.secret-files', 'fail', 'Secret files', '.env served', { blocker: true }),
    result('caching.compression', 'fail', 'Compression', 'none'),
  ];
  const dev = applyEnvPolicy(rs, { production: false, env: 'dev' });
  assert.equal(dev.results[0].status, 'info');
  assert.match(dev.results[0].evidence, /expected on dev — reverse before production/);
  assert.equal(dev.results[1].status, 'info');
  assert.equal(dev.results[2].status, 'warn', 'untouched');
  assert.equal(dev.results[3].status, 'fail', 'a real fail stays a fail on dev');
  assert.equal(dev.results[3].blocker, true, 'an explicit blocker stays a blocker on dev');
  assert.equal(dev.results[4].status, 'fail');
  assert.equal(dev.results[4].blocker, undefined, 'a plain fail is not a blocker');
  assert.deepEqual(dev.beforeProduction.map((b) => [b.id, b.originalStatus]), [['crawl.meta-robots', 'fail'], ['crawl.robots-txt', 'warn']]);
  assert.equal(rs[0].status, 'fail', 'input not mutated');

  const prod = applyEnvPolicy(rs, { production: true, env: 'production' });
  assert.equal(prod.results[0].status, 'fail');
  assert.equal(prod.results[0].blocker, true);
  assert.equal(prod.results[1].status, 'warn');
  assert.equal(prod.results[1].blocker, undefined);
  assert.deepEqual(prod.beforeProduction, []);
});

test('runGroups isolates failures and timeouts as skip rows', async () => {
  const groups = [
    { id: 'a', title: 'A', run: async () => [result('a.one', 'pass', 'one', 'ok')] },
    { id: 'b', title: 'B', run: async () => { throw new Error('boom'); } },
    { id: 'c', title: 'C', budget: 20, run: () => new Promise((r) => setTimeout(() => r([]), 200)) },
    { id: 'd', title: 'D', run: async () => 'not an array' },
  ];
  const { results, timings } = await runGroups(groups, {}, { log: () => {} });
  assert.deepEqual(results.map((r) => [r.id, r.status]), [['a.one', 'pass'], ['b.error', 'skip'], ['c.error', 'skip'], ['d.error', 'skip']]);
  assert.match(results[1].evidence, /boom/);
  assert.match(results[2].evidence, /timed out/);
  assert.ok(timings.a >= 0 && timings.c >= 0);
});

test('filterGroups honours --skip and --only on group ids, prefixes and check ids', () => {
  const groups = GROUPS;
  assert.deepEqual(filterGroups(groups, { skip: ['perf', 'a11y'], only: [] }).map((g) => g.id).includes('perf'), false);
  assert.deepEqual(filterGroups(groups, { skip: [], only: ['tls', 'headers'] }).map((g) => g.id), ['tls', 'headers']);
  assert.deepEqual(filterGroups(groups, { skip: [], only: ['dns'] }).map((g) => g.id), ['tls'], 'a prefix selects its group');
  assert.equal(isSkipped('crawl.sitemap', { skip: ['crawl.sitemap'], only: [] }), true);
  assert.equal(isSkipped('crawl.sitemap', { skip: ['crawl'], only: [] }), true);
  assert.equal(isSkipped('crawl.sitemap', { skip: [], only: ['crawl.title'] }), true);
  assert.equal(isSkipped('crawl.sitemap', { skip: [], only: ['crawl'] }), false);
});

test('countStatuses and STATUS_ORDER', () => {
  const rs = [result('a.b', 'pass', 't', 'e'), result('a.c', 'fail', 't', 'e'), result('a.d', 'fail', 't', 'e'), result('a.e', 'skip', 't', 'e')];
  assert.deepEqual(countStatuses(rs), { pass: 1, warn: 0, fail: 2, info: 0, skip: 1 });
  assert.ok(STATUS_ORDER.fail > STATUS_ORDER.warn && STATUS_ORDER.warn > STATUS_ORDER.info);
});
