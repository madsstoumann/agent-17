import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHost, detectCmp, CONSENT_CATEGORIES } from '../lib/trackers.mjs';

test('classifyHost matches known vendors by host suffix', () => {
  assert.deepEqual(classifyHost('www.googletagmanager.com'), { vendor: 'Google Tag Manager', category: 'tag-manager' });
  assert.deepEqual(classifyHost('connect.facebook.net'), { vendor: 'Meta Pixel', category: 'ads' });
  assert.equal(classifyHost('cdn.example.com'), null);
  assert.equal(classifyHost('notfacebook.net'), null);
  assert.ok(CONSENT_CATEGORIES.has('analytics'));
});

test('detectCmp finds a consent tool in markup or hosts', () => {
  assert.equal(detectCmp('<script src="https://consent.cookiebot.com/uc.js">'), 'Cookiebot');
  assert.equal(detectCmp('', ['cdn.cookielaw.org', 'optanon.blob.core.windows.net']), 'OneTrust');
  assert.equal(detectCmp('<p>hello</p>', ['x.com']), null);
});
