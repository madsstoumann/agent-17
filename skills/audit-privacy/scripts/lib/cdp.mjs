// A small Chrome DevTools Protocol client over --remote-debugging-pipe: no npm dependencies,
// no port to pick, and no --user-data-dir (headless Chrome uses a throw-away profile, and each
// scenario gets its own browser context on top of that).
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

export function chromeArgs({ root = typeof process.getuid === 'function' && process.getuid() === 0, lang = 'da-DK,da,en' } = {}) {
  return [
    '--headless',
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--mute-audio',
    '--hide-scrollbars',
    '--window-size=1366,900',
    `--lang=${lang.split(',')[0]}`,
    ...(root ? ['--no-sandbox'] : []),
    'about:blank',
  ];
}

/**
 * launch({ chromePath, lang }) -> { send(method, params, sessionId), on(method, fn), close(), version }
 * Events reach every `on(method)` handler as (params, sessionId).
 */
export async function launch({ chromePath, lang, timeout = 30000 } = {}) {
  const chrome = findChrome({ chromePath });
  if (!chrome) throw new Error('no Chrome, Chromium or Edge found (install one or set CHROME_PATH)');
  const proc = spawn(chrome, chromeArgs({ lang }), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const writer = proc.stdio[3];
  const reader = proc.stdio[4];
  const pending = new Map();
  const handlers = new Map();
  let nextId = 1;
  let buf = '';
  let closed = false;
  reader.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ''}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of handlers.get(msg.method) || []) { try { fn(msg.params || {}, msg.sessionId); } catch { /* a handler bug must not kill the run */ } }
      }
    }
  });
  const fail = (why) => { closed = true; for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(why)); } pending.clear(); };
  proc.on('exit', (code) => fail(`Chrome exited (${code})${stderr ? `: ${stderr.trim().split('\n').slice(-2).join(' ')}` : ''}`));
  proc.on('error', (e) => fail(`Chrome failed to start: ${e.message}`));

  function send(method, params = {}, sessionId, ms = timeout) {
    if (closed) return Promise.reject(new Error('Chrome is not running'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, ms);
      pending.set(id, { resolve, reject, timer });
      writer.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }
  const on = (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); return () => handlers.set(method, handlers.get(method).filter((f) => f !== fn)); };
  async function close() {
    if (closed) return;
    try { await send('Browser.close', {}, undefined, 5000); } catch { /* already gone */ }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 2000).unref();
  }
  const version = await send('Browser.getVersion');
  return { send, on, close, version: version.product, chrome };
}
