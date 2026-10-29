/**
 * Optional --browser pass: loads the page in headless Chromium through
 * Playwright so client-rendered markup, tags injected by a tag manager, cookies
 * set from JavaScript and window globals (jQuery.fn.jquery, next.version…)
 * become evidence too. This is a first visit with no consent given, the same
 * view a regulator's scanner gets.
 *
 * Playwright is not a dependency of the skill. It is loaded from wherever Node
 * can resolve it (the current project, a global install, NODE_PATH).
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { UA, VERSION } from './fetch.mjs';

export async function loadPlaywright() {
  const tries = [path.join(process.cwd(), 'noop.js')];
  try { tries.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'noop.js')); } catch { /* npm missing */ }
  for (const from of tries) {
    try { return createRequire(from)('playwright'); } catch { /* next */ }
  }
  try { return await import('playwright'); } catch { return null; }
}

/** Reads each window path; a primitive value is returned as is, an object or function as true. */
function probe(paths) {
  const out = {};
  for (const p of paths) {
    try {
      let v = window;
      for (const k of p.split('.')) { if (v === null || v === undefined) break; v = v[k]; }
      if (v === null || v === undefined) continue;
      out[p] = typeof v === 'string' || typeof v === 'number' ? v : true;
    } catch { /* getter threw */ }
  }
  // React and Vue 3 leave no global in production builds, only expando keys on DOM nodes.
  const nodes = [document.getElementById('root'), document.getElementById('__next'), document.getElementById('app'), document.body, ...document.querySelectorAll('body > *')].filter(Boolean).slice(0, 40);
  for (const n of nodes) {
    const keys = Object.keys(n);
    if (keys.some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer') || k === '_reactRootContainer')) out.__reactFiber = true;
    if (n.__vue_app__) out.__vue_app__ = n.__vue_app__.version || true;
  }
  return out;
}

export async function render(pw, url, { timeout = 30000, settle = 3000, paths = [], insecure = false } = {}) {
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ userAgent: UA, ignoreHTTPSErrors: insecure, extraHTTPHeaders: { 'x-audit': `tech-stack/${VERSION}` } });
    const page = await context.newPage();
    const requests = new Set();
    page.on('request', (r) => { if (requests.size < 2000) requests.add(r.url()); });
    await page.goto(url, { waitUntil: 'load', timeout });
    // Tag managers fire after load; give them a moment, but never wait for a quiet network on chatty sites.
    await Promise.race([page.waitForLoadState('networkidle').catch(() => {}), page.waitForTimeout(settle)]);
    const globals = await page.evaluate(probe, paths);
    const renderedHtml = await page.content();
    const cookies = (await context.cookies()).map((c) => c.name);
    return { globals, renderedHtml, requests: [...requests].filter((u) => /^https?:/.test(u)), cookies };
  } finally {
    await browser.close();
  }
}
