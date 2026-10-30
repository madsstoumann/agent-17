// HTML -> PDF with headless Chrome or Chromium, the same browser launch-audit already uses.
// No npm dependencies: it finds a browser on disk and runs it with --print-to-pdf.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const WIN_APPS = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
];
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome'];

/** Playwright's own Chromium, when installed (common in cloud sessions and on dev machines). */
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

const listDir = (p) => { try { return fs.readdirSync(p); } catch { return []; } };

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
// made it hang on first-run network calls in testing.
export function buildPrintArgs(htmlFile, pdfFile, { root = typeof process.getuid === 'function' && process.getuid() === 0 } = {}) {
  return [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=10000',
    '--no-pdf-header-footer',
    ...(root ? ['--no-sandbox'] : []),
    `--print-to-pdf=${pdfFile}`,
    pathToFileURL(htmlFile).href,
  ];
}

/** Print htmlFile to pdfFile. Resolves { ok, chrome, error? }; never throws. */
export async function printPdf(htmlFile, pdfFile, { chromePath, timeout = 120000 } = {}) {
  const chrome = findChrome({ chromePath });
  if (!chrome) return { ok: false, chrome: null, error: 'no Chrome, Chromium or Edge found (install one or set CHROME_PATH)' };
  try {
    fs.rmSync(pdfFile, { force: true });
    await new Promise((resolve, reject) => {
      execFile(chrome, buildPrintArgs(htmlFile, pdfFile), { timeout }, (err, _stdout, stderr) => {
        if (err && !fs.existsSync(pdfFile)) reject(new Error(String(stderr || err.message).trim().split('\n').slice(-3).join(' ')));
        else resolve();
      });
    });
    if (!fs.existsSync(pdfFile) || fs.statSync(pdfFile).size === 0) return { ok: false, chrome, error: 'Chrome ran but wrote no PDF' };
    return { ok: true, chrome };
  } catch (e) {
    return { ok: false, chrome, error: e.message };
  }
}

/**
 * Page numbers (1-based) of the named destinations Chrome writes for in-document links (`<a href="#x">`
 * to an element with id x): { x: 3, … }. Reads the uncompressed object structure Chrome's PDF writer
 * uses (catalog /Dests, the /Pages tree). Returns {} when the PDF is laid out some other way.
 */
export function pdfDestPages(pdfFile) {
  let text;
  try { text = fs.readFileSync(pdfFile).toString('latin1'); } catch { return {}; }
  const objs = new Map();
  for (const m of text.matchAll(/(?:^|[\r\n])(\d+) 0 obj\b([\s\S]*?)endobj/g)) objs.set(m[1], m[2]);
  const catalog = [...objs.values()].find((b) => /\/Type\s*\/Catalog\b/.test(b));
  const ref = (body, key) => (body?.match(new RegExp(`/${key}\\s+(\\d+) 0 R`)) || [])[1];
  if (!catalog) return {};
  const order = [];
  const walk = (id, depth = 0) => {
    const body = objs.get(id);
    if (!body || depth > 32) return;
    if (/\/Type\s*\/Pages\b/.test(body)) {
      const kids = (body.match(/\/Kids\s*\[([^\]]*)\]/) || [])[1] || '';
      for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(k[1], depth + 1);
    } else order.push(id);
  };
  walk(ref(catalog, 'Pages'));
  const dests = objs.get(ref(catalog, 'Dests')) || '';
  const out = {};
  for (const m of dests.matchAll(/\/([^\s/[\]()<>]+)\s*\[\s*(\d+) 0 R/g)) {
    const name = m[1].replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const i = order.indexOf(m[2]);
    if (i >= 0) out[name] = i + 1;
  }
  return out;
}
