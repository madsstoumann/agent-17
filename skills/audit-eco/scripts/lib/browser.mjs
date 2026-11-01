/**
 * Loads a page in headless Chrome over the DevTools protocol and records every request the
 * way Lighthouse's network records do: bytes on the wire (encodedDataLength), decoded size,
 * resource type, status, content-encoding and cache headers. Cache disabled, so each load is
 * a first visit. Then it scrolls to the bottom to see what lazy loading saves.
 *
 * Zero dependencies (Node 22's built-in WebSocket). Never throws from measure(); a failed
 * load comes back as { ok: false, error }.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// ---------------------------------------------------------------- finding a browser
// Same search order as audit-all/scripts/lib/pdf.mjs; keep them in step.

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

// Runs in the page: every <img> with its natural and rendered size, before any scrolling.
const IMAGE_PROBE = `(() => {
  const vh = innerHeight;
  return { dpr: devicePixelRatio, vw: innerWidth, vh, height: document.documentElement.scrollHeight,
    images: [...document.images].map((i) => { const r = i.getBoundingClientRect();
      return { src: i.currentSrc || i.src, nw: i.naturalWidth, nh: i.naturalHeight, w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top + scrollY), loading: i.getAttribute('loading'), complete: i.complete, offscreen: r.top > vh * 1.5 }; }) };
})()`;
const SCROLL = `(async () => { const step = innerHeight * 0.8; for (let y = 0; y < document.documentElement.scrollHeight && y < 40000; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); return document.documentElement.scrollHeight; })()`;

/**
 * measure(browser, url, { headers, viewport, timeout }) ->
 *   { ok, url, finalUrl, status, requests: [Request], initialBytes, afterScrollBytes, images, viewport, error? }
 * Request: { url, type, status, mimeType, transfer, size, encoding, cacheControl, protocol, failed, lazy }
 * `lazy` marks requests that started only after scrolling.
 */
export async function measure(browser, url, { headers = {}, viewport = { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, timeout = 45000, idleMs = 1500 } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  const reqs = new Map();
  let phase = 'load';
  let inflight = 0;
  let lastActivity = Date.now();
  let loaded = false;
  let docStatus = null;
  let finalUrl = url;
  const off = browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params || {};
    switch (msg.method) {
      case 'Network.requestWillBeSent': {
        if (/^(data|blob|chrome-extension):/.test(p.request.url)) return;
        const prev = reqs.get(p.requestId);
        if (prev && !p.redirectResponse) return;
        if (prev) {
          // A redirect reuses the request id: close the hop and keep it under its own key.
          Object.assign(prev, { status: p.redirectResponse.status, transfer: p.redirectResponse.encodedDataLength || 0, done: true });
          inflight--;
          reqs.set(`${p.requestId}:${reqs.size}`, prev);
        }
        inflight++;
        reqs.set(p.requestId, { url: p.request.url, type: p.type || 'Other', status: null, mimeType: '', transfer: 0, size: 0, encoding: null, cacheControl: null, protocol: null, failed: false, lazy: phase === 'scroll', done: false });
        lastActivity = Date.now();
        break;
      }
      case 'Network.responseReceived': {
        const r = reqs.get(p.requestId);
        if (!r) return;
        const h = Object.fromEntries(Object.entries(p.response.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        Object.assign(r, { status: p.response.status, mimeType: p.response.mimeType, encoding: h['content-encoding'] || null, cacheControl: h['cache-control'] || null, protocol: p.response.protocol || null, type: p.type || r.type });
        if (p.type === 'Document' && docStatus === null) { docStatus = p.response.status; finalUrl = p.response.url; }
        lastActivity = Date.now();
        break;
      }
      case 'Network.dataReceived': {
        const r = reqs.get(p.requestId);
        if (r) { r.size += p.dataLength || 0; r.streamed = (r.streamed || 0) + (p.encodedDataLength || 0); }
        lastActivity = Date.now();
        break;
      }
      case 'Network.loadingFinished': {
        const r = reqs.get(p.requestId);
        if (r && !r.done) { r.transfer = p.encodedDataLength; r.done = true; inflight--; }
        lastActivity = Date.now();
        break;
      }
      case 'Network.loadingFailed': {
        const r = reqs.get(p.requestId);
        if (r && !r.done) { r.failed = p.errorText || true; r.done = true; inflight--; }
        lastActivity = Date.now();
        break;
      }
      case 'Page.loadEventFired': loaded = true; break;
      default: break;
    }
  });

  const waitFor = async (cond, ms) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await sleep(100); return cond(); };
  // Like Puppeteer's networkidle2: beacons, long polls and streaming video can keep a request or two open for good.
  const idle = () => inflight <= 2 && Date.now() - lastActivity > idleMs;
  const total = (filter = () => true) => [...reqs.values()].filter(filter).reduce((n, r) => n + (r.done ? r.transfer : (r.streamed || 0)), 0);

  try {
    await send('Network.enable', { maxPostDataSize: 0 });
    await send('Page.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Emulation.setDeviceMetricsOverride', viewport);
    if (Object.keys(headers).length) await send('Network.setExtraHTTPHeaders', { headers });
    const nav = await send('Page.navigate', { url });
    if (nav.errorText) return { ok: false, url, error: nav.errorText };
    if (!await waitFor(() => loaded, timeout)) return { ok: false, url, error: `no load event within ${timeout / 1000}s` };
    await waitFor(idle, 8000);
    const probe = (await send('Runtime.evaluate', { expression: IMAGE_PROBE, returnByValue: true })).result?.value || { images: [] };
    const initialBytes = total();
    phase = 'scroll';
    await send('Runtime.evaluate', { expression: SCROLL, awaitPromise: true, returnByValue: true }).catch(() => null);
    await waitFor(idle, 6000);
    const requests = [...reqs.values()].map((r) => ({ ...r, transfer: r.done ? r.transfer : (r.streamed || 0) }));
    return { ok: true, url, finalUrl, status: docStatus, requests, initialBytes, afterScrollBytes: total(), images: probe.images, viewport: { ...viewport, dpr: probe.dpr, pageHeight: probe.height } };
  } catch (e) {
    return { ok: false, url, error: e.message };
  } finally {
    off();
    await browser.send('Target.closeTarget', { targetId }).catch(() => null);
  }
}
