import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAdminProbe } from '../lib/groups/05-exposed.mjs';

const umbraco = { path: '/umbraco', name: 'Umbraco backoffice', mark: /umbraco/i };
const admin = { path: '/admin', name: '/admin' };
const origin = 'https://www.example.com';

test('a locale redirect that ends in 404 is not a reachable backoffice (wpp.com)', () => {
  const v = classifyAdminProbe(umbraco, [
    { url: `${origin}/umbraco`, status: 307, location: '/en/umbraco' },
    { url: `${origin}/en/umbraco`, status: 404 },
  ], origin);
  assert.equal(v.reachable, false);
  assert.equal(v.sso, false);
});

test('a redirect to a real Umbraco login page is flagged', () => {
  const v = classifyAdminProbe(umbraco, [
    { url: `${origin}/umbraco`, status: 302, location: '/umbraco/login' },
    { url: `${origin}/umbraco/login`, status: 200, body: '<title>Umbraco</title><form><input name="username"><input type="password"></form>' },
  ], origin);
  assert.equal(v.reachable, true);
  assert.match(v.note, /\/umbraco → \/umbraco\/login: 302 → 200/);
});

test('the Umbraco SPA shell (no password field in raw HTML) still counts', () => {
  const v = classifyAdminProbe(umbraco, [
    { url: `${origin}/umbraco`, status: 200, body: '<umb-app></umb-app><script src="/umbraco/backoffice/x.js"></script><p>Log in</p>' },
  ], origin);
  assert.equal(v.reachable, true);
});

test('a 200 catch-all page without login markup is not flagged', () => {
  assert.equal(classifyAdminProbe(umbraco, [{ url: `${origin}/umbraco`, status: 200, body: '<h1>Welcome</h1>' }], origin).reachable, false);
  assert.equal(classifyAdminProbe(admin, [{ url: `${origin}/admin`, status: 200, body: '<a href="/login">Sign in</a>' }], origin).reachable, false);
});

test('a redirect to another host is an external sign-in, not a login on this site', () => {
  const v = classifyAdminProbe(umbraco, [
    { url: `${origin}/umbraco`, status: 302, location: 'https://login.microsoftonline.com/x' },
    { url: 'https://login.microsoftonline.com/x', status: 0 },
  ], origin);
  assert.equal(v.reachable, false);
  assert.equal(v.sso, true);
  assert.match(v.note, /login\.microsoftonline\.com/);
});
