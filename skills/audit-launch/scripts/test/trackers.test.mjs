import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHost, CONSENT_CATEGORIES } from '../lib/trackers.mjs';

test('classifyHost matches known vendors by host suffix', () => {
  assert.deepEqual(classifyHost('www.googletagmanager.com'), { vendor: 'Google Tag Manager', category: 'tag-manager' });
  assert.deepEqual(classifyHost('connect.facebook.net'), { vendor: 'Meta Pixel', category: 'ads' });
  assert.equal(classifyHost('cdn.example.com'), null);
  assert.equal(classifyHost('notfacebook.net'), null);
  assert.ok(CONSENT_CATEGORIES.has('analytics'));
});
