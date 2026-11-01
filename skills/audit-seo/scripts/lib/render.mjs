/**
 * Renders pages in headless Chrome over the DevTools protocol and returns the DOM after
 * JavaScript has run, so JSON-LD that a framework injects on the client is seen too.
 *
 * Headers from --header (a WAF bypass rule) are added only to requests for the audited
 * hosts, through the Fetch domain, never to third-party requests the page makes.
 *
 * Zero dependencies (Node 22's built-in WebSocket). render() never throws: a failed load is
 * { ok: false, error }.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// ---------------------------------------------------------------- finding a browser
// Copied from audit-eco/scripts/lib/browser.mjs (same search order as audit-all's pdf.mjs); keep them in step.

const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const WIN_APPS = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome'];
const listDir = (p) => { try { return fs.readdirSync(p); } catch { return []; } };

function playwrightChromes(env, home, list) {
  const roots = [env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(home, '.cache', 'ms-playwright'), path.join(home, 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  const out = [];
  for (const root of roots) {
    for (const dir of list(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      out.push(
        path.join(root, dir, 'chrome-linux64', 'chrome'),
        path.join(root, dir, 'chrome-linux', 'chrome'),
        path.join(root, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      );
    }
  }
  return out;
}

export function findChrome({ chromePath, env = process.env, home = os.homedir(), exists = fs.existsSync, list = listDir } = {}) {
  if (chromePath) return chromePath;
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH;
  for (const app of MAC_APPS) for (const p of [app, home + app]) if (exists(p)) return p;
  for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
    for (const app of WIN_APPS) { const p = path.join(base, app); if (exists(p)) return p; }
  }
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of PATH_NAMES) { const p = path.join(dir, name); if (exists(p)) return p; }
  }
  return playwrightChromes(env, home, list).find((p) => exists(p)) || null;
}

// ---------------------------------------------------------------- the browser

const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;

/**
 * launch({ chromePath, insecure, timeout }) -> { send, on, close, chrome }
 * No --user-data-dir: headless Chrome already uses a throw-away profile, and a fresh profile
 * dir made it hang on first-run network calls in testing (see audit-all's pdf.mjs).
 */
export async function launch({ chromePath, insecure = false, timeout = 20000 } = {}) {
  const chrome = findChrome({ chromePath });
  if (!chrome) throw new Error('no Chrome, Chromium or Edge found (install one or set CHROME_PATH)');
  if (typeof WebSocket !== 'function') throw new Error('this Node has no built-in WebSocket (use Node 22 or newer)');
  const args = [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--mute-audio',
    ...(insecure ? ['--ignore-certificate-errors'] : []), ...(isRoot() ? ['--no-sandbox'] : []), 'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start within ${timeout / 1000}s`)), timeout);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}): ${buf.trim().split('\n').slice(-2).join(' ')}`)); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  proc.stderr.resume();

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('cannot connect to Chrome')); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    chrome,
    send,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    async close() {
      try { await Promise.race([send('Browser.close'), new Promise((r) => setTimeout(r, 2000))]); } catch { /* already gone */ }
      try { ws.close(); } catch { /* ignore */ }
      if (proc.exitCode === null) proc.kill('SIGKILL');
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };

// Runs in the page: the JSON-LD block count, to wait until a framework has stopped adding them.
const LD_COUNT = 'document.querySelectorAll(\'script[type="application/ld+json" i]\').length';
const DOM = '(document.doctype ? new XMLSerializer().serializeToString(document.doctype) + "\\n" : "") + document.documentElement.outerHTML';

/**
 * render(browser, url, { headers, hosts, timeout, settleMs }) -> { ok, url, finalUrl, status, html, error? }
 * Waits for the load event, then until the JSON-LD count has been steady for `settleMs`
 * (at most 8 s more), and returns the serialised DOM.
 */
export async function render(browser, url, { headers = {}, hosts = [], timeout = 30000, settleMs = 1200 } = {}) {
  let targetId;
  let off = () => {};
  try {
    ({ targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => browser.send(m, p, sessionId);
    let loaded = false; let status = null; let finalUrl = url;
    const extra = Object.entries(headers);
    off = browser.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      const p = msg.params || {};
      if (msg.method === 'Page.loadEventFired') loaded = true;
      else if (msg.method === 'Network.responseReceived' && p.type === 'Document' && status === null) { status = p.response.status; finalUrl = p.response.url; }
      else if (msg.method === 'Fetch.requestPaused') {
        const own = hosts.includes(hostOf(p.request.url));
        const h = own ? [...Object.entries(p.request.headers || {}), ...extra].map(([name, value]) => ({ name, value: String(value) })) : undefined;
        send('Fetch.continueRequest', { requestId: p.requestId, ...(h ? { headers: h } : {}) }).catch(() => null);
      }
    });
    await send('Page.enable');
    await send('Network.enable', { maxPostDataSize: 0 });
    if (extra.length) await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const nav = await send('Page.navigate', { url });
    if (nav.errorText) return { ok: false, url, error: nav.errorText };
    const end = Date.now() + timeout;
    while (!loaded && Date.now() < end) await sleep(100);
    if (!loaded) return { ok: false, url, error: `no load event within ${timeout / 1000}s` };
    const count = async () => (await send('Runtime.evaluate', { expression: LD_COUNT, returnByValue: true })).result?.value ?? 0;
    let last = await count(); let steadySince = Date.now();
    for (const stop = Date.now() + 8000; Date.now() < stop && Date.now() - steadySince < settleMs;) {
      await sleep(200);
      const n = await count();
      if (n !== last) { last = n; steadySince = Date.now(); }
    }
    const html = (await send('Runtime.evaluate', { expression: DOM, returnByValue: true })).result?.value;
    if (typeof html !== 'string') return { ok: false, url, error: 'could not read the rendered DOM' };
    return { ok: true, url, finalUrl, status, html };
  } catch (e) {
    return { ok: false, url, error: e.message };
  } finally {
    off();
    if (targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => null);
  }
}
