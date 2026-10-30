// The two rule engines, injected into each page: axe-core (Deque) and HTML_CodeSniffer, the engine
// Pa11y runs by default. Pinned versions, fetched once from a CDN, checked against a SHA-256 and
// cached, so no npm install is needed and a tampered download is refused.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const ENGINES = {
  axe: {
    name: 'axe-core',
    version: '4.14.0',
    file: 'axe.min.js',
    sha256: '20c09fe157a8a34a30e241aaa1fcdade657734f08ab379ecfbeb7d45cc46e878',
    urls: ['https://cdn.jsdelivr.net/npm/axe-core@4.14.0/axe.min.js', 'https://unpkg.com/axe-core@4.14.0/axe.min.js'],
  },
  htmlcs: {
    name: 'HTML_CodeSniffer',
    version: '2.5.1',
    file: 'HTMLCS.js',
    sha256: 'bc9501382a35bff6acfc255945b1ed732fcec544cfcaeec17b5ac8d79a6c7967',
    urls: ['https://cdn.jsdelivr.net/npm/html_codesniffer@2.5.1/build/HTMLCS.js', 'https://unpkg.com/html_codesniffer@2.5.1/build/HTMLCS.js'],
  },
};

export function cacheDir(env = process.env, home = os.homedir()) {
  if (env.A11Y_AUDIT_CACHE) return env.A11Y_AUDIT_CACHE;
  const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Caches') : env.XDG_CACHE_HOME || (env.LOCALAPPDATA && process.platform === 'win32' ? env.LOCALAPPDATA : path.join(home, '.cache'));
  return path.join(base, 'a11y-audit');
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** The engine's source: from the cache if its hash matches, else downloaded and verified. Throws when no copy verifies. */
export async function loadEngine(key, { dir = cacheDir(), fetchImpl = fetch } = {}) {
  const e = ENGINES[key];
  const file = path.join(dir, `${e.name}-${e.version}-${e.file}`);
  try {
    const cached = fs.readFileSync(file, 'utf8');
    if (sha(cached) === e.sha256) return cached;
  } catch { /* not cached */ }
  const errors = [];
  for (const url of e.urls) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) { errors.push(`${url}: HTTP ${res.status}`); continue; }
      const text = await res.text();
      if (sha(text) !== e.sha256) { errors.push(`${url}: checksum mismatch`); continue; }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, text);
      return text;
    } catch (err) { errors.push(`${url}: ${err.message}`); }
  }
  throw new Error(`could not load ${e.name} ${e.version} (${errors.join('; ')}). Put a verified copy at ${file} to run offline.`);
}
