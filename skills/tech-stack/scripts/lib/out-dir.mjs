/**
 * Where reports go when no --out is given. Same order as launch-audit, security-audit and
 * audit-all, so every skill's reports end up side by side.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The folder reports go under. First match wins:
 * 1. AUDIT_OUT_DIR, 2. the Downloads folder if it exists and is writable (on Linux the XDG
 * download folder from XDG_DOWNLOAD_DIR or ~/.config/user-dirs.dirs, then ~/Downloads),
 * 3. ~/audit-reports. Works the same on macOS, Windows and Linux.
 */
export function reportsRoot({ env = process.env, home = os.homedir(), isDir = writableDir, readFile = readText } = {}) {
  if (env.AUDIT_OUT_DIR) return path.resolve(expandHome(env.AUDIT_OUT_DIR, home));
  const xdg = env.XDG_DOWNLOAD_DIR || xdgDownloadDir(readFile(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'user-dirs.dirs')));
  const candidates = [xdg && path.resolve(expandHome(xdg.replace(/^\$HOME(?=$|\/)/, home), home)), path.join(home, 'Downloads')].filter(Boolean);
  return candidates.find((p) => isDir(p)) || path.join(home, 'audit-reports');
}

function xdgDownloadDir(text) {
  const m = String(text || '').match(/^\s*XDG_DOWNLOAD_DIR\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : null;
}

function writableDir(p) {
  try { fs.accessSync(p, fs.constants.W_OK); return fs.statSync(p).isDirectory(); } catch { return false; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

export const expandHome = (p, home = os.homedir()) => p.replace(/^~(?=$|[\\/])/, home);

/** `--out` (a leading ~ is expanded) or <reportsRoot>/tech-stack/<name>-<stamp>/. */
export function resolveOutDir(out, name, { home = os.homedir(), now, base } = {}) {
  if (!out) return path.join(base || reportsRoot({ home }), 'tech-stack', `${name}-${now}`);
  return path.resolve(expandHome(out, home));
}
