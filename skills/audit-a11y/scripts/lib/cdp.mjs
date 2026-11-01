// A small Chrome DevTools Protocol client: launches headless Chrome, Chromium or Edge and drives
// one tab over the WebSocket Node 22 ships with. No npm dependencies, like audit-all's PDF step.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

/** First browser found: --chrome, CHROME_PATH, the macOS/Windows apps, PATH, then Playwright's Chromium. */
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

// No --user-data-dir: headless Chrome already uses a throw-away profile, and a fresh profile dir
// made it hang on first-run network calls in audit-all's testing.
export function launchArgs({ insecure = false, root = typeof process.getuid === 'function' && process.getuid() === 0 } = {}) {
  return [
    '--headless',
    '--remote-debugging-port=0',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-extensions',
    '--disable-background-networking',
    ...(insecure ? ['--ignore-certificate-errors'] : []),
    ...(root ? ['--no-sandbox'] : []),
    'about:blank',
  ];
}

/** Start the browser and resolve { proc, wsUrl } once it prints its DevTools endpoint. */
export function launch(chrome, opts = {}, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chrome, launchArgs(opts), { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    let err = '';
    const timer = setTimeout(() => { kill(proc); reject(new Error(`browser did not start within ${timeout / 1000}s: ${err.trim().split('\n').slice(-2).join(' ')}`)); }, timeout);
    proc.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve({ proc, wsUrl: m[1] }); }
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`browser exited (${code}): ${err.trim().split('\n').slice(-2).join(' ')}`)); });
  });
}

export function kill(proc) {
  try { if (process.platform !== 'win32') process.kill(-proc.pid, 'SIGKILL'); else proc.kill('SIGKILL'); } catch { /* gone */ }
}

/** One WebSocket to the browser; `session(id)` scopes calls to an attached target. */
export class Cdp {
  static open(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error(`could not connect to ${wsUrl}`)));
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
    ws.addEventListener('close', () => { for (const { reject } of this.pending.values()) reject(new Error('browser connection closed')); this.pending.clear(); });
  }

  send(method, params = {}, sessionId, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Resolve with the first event matching `method` (and `sessionId`) within `timeout`, else null. */
  waitFor(method, sessionId, timeout) {
    return new Promise((resolve) => {
      const off = this.on((m) => { if (m.method === method && m.sessionId === sessionId) { off(); clearTimeout(t); resolve(m.params); } });
      const t = setTimeout(() => { off(); resolve(null); }, timeout);
    });
  }

  close() { try { this.ws.close(); } catch { /* closed */ } }
}

/** A fresh tab with Page, Runtime and Network on. */
export async function newPage(cdp, { headers = {}, userAgent } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params, timeout) => cdp.send(method, params, sessionId, timeout);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  if (Object.keys(headers).length) await call('Network.setExtraHTTPHeaders', { headers });
  if (userAgent) await call('Network.setUserAgentOverride', { userAgent });

  const page = {
    targetId,
    sessionId,
    call,
    async viewport(width, height, mobile = false) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    },
    /** Navigate and wait for load plus a short settle; resolves { status, url, error? }. */
    async goto(url, { timeout = 30000, settle = 1500 } = {}) {
      let status = null; let finalUrl = url;
      const { frameTree } = await call('Page.getFrameTree');
      const off = cdp.on((m) => {
        if (m.sessionId === sessionId && m.method === 'Network.responseReceived' && m.params.type === 'Document' && m.params.frameId === frameTree.frame.id) {
          status = m.params.response.status; finalUrl = m.params.response.url;
        }
      });
      const loaded = cdp.waitFor('Page.loadEventFired', sessionId, timeout);
      try {
        const nav = await call('Page.navigate', { url }, timeout);
        if (nav.errorText) return { status, url: finalUrl, error: nav.errorText };
        if (!(await loaded)) return { status, url: finalUrl, error: `load did not finish within ${timeout / 1000}s` };
        await new Promise((r) => setTimeout(r, settle));
        const href = await page.eval('location.href');
        return { status, url: href || finalUrl };
      } finally { off(); }
    },
    /** Evaluate an expression in the page and return its JSON value (promises awaited). */
    async eval(expression, timeout = 60000) {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, timeout);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
      return r.result.value;
    },
    async key(key, { shift = false } = {}) {
      const codes = { Tab: 9, Escape: 27, Enter: 13 };
      const base = { key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 };
      await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async close() { try { await cdp.send('Target.closeTarget', { targetId }); } catch { /* closed */ } },
  };
  return page;
}
