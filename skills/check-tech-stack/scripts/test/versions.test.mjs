import { test } from 'node:test';
import assert from 'node:assert/strict';
import { behind, packageFor, addLatest } from '../lib/versions.mjs';

test('behind compares as precisely as the detected version allows', () => {
  assert.equal(behind('1.12.4', '3.7.1'), 'major');
  assert.equal(behind('3.5.1', '3.7.1'), 'minor');
  assert.equal(behind('3.7.0', '3.7.1'), 'patch');
  assert.equal(behind('3.7.1', '3.7.1'), 'current');
  assert.equal(behind('4.0.0-beta.1', '3.7.1'), 'current');
  assert.equal(behind('3', '3.7.1'), 'current');
  assert.equal(behind('2', '3.7.1'), 'major');
  assert.equal(behind('abc', '3.7.1'), null);
});

test('packageFor uses the signature npm name, else a known package', () => {
  assert.equal(packageFor({ name: 'jQuery', npm: 'jquery' }), 'jquery');
  assert.equal(packageFor({ name: 'Next.js' }), 'next');
  assert.equal(packageFor({ name: 'WordPress' }), null);
});

test('addLatest looks each package up once and marks how far behind', async () => {
  const calls = [];
  const lookup = async (p) => { calls.push(p); return { jquery: '3.7.1', next: '15.0.0' }[p] || null; };
  const results = [
    { technologies: [{ name: 'jQuery', npm: 'jquery', version: '1.12.4' }, { name: 'Next.js', version: '15.0.0' }, { name: 'Nginx', version: '1.25' }] },
    { technologies: [{ name: 'jQuery', npm: 'jquery', version: '3.7.1' }, { name: 'React', npm: 'react-dom' }] },
    { error: 'x', technologies: [] },
  ];
  assert.equal(await addLatest(results, { lookup }), 2);
  assert.deepEqual(calls.sort(), ['jquery', 'next']);
  assert.deepEqual([results[0].technologies[0].latest, results[0].technologies[0].behind], ['3.7.1', 'major']);
  assert.equal(results[0].technologies[1].behind, 'current');
  assert.equal(results[1].technologies[0].behind, 'current');
  assert.equal(results[0].technologies[2].latest, undefined);
});
