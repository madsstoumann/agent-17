/**
 * Which files to scan. In a git repo: tracked + untracked-not-ignored (what would be committed),
 * and `tracked` separately so file-level secret checks only fire on committed files.
 * Outside git: a walk that skips the usual build and dependency folders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', '.astro', '.vercel',
  '.netlify', '.turbo', '.cache', '.parcel-cache', 'coverage', 'vendor', 'bower_components', 'jspm_packages',
  'bin', 'obj', '.vs', '.idea', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', 'target',
  'wwwroot/lib', 'umbraco/Data', 'App_Data', '.solution-health', '.security-audit',
]);

const SKIP_FILE = /(\.min\.(js|css)|\.map|\.bundle\.js|-lock\.json|\.lock|\.lockb|lock\.yaml|\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|pdb|nupkg|jar|class|wasm|psd|sketch|fig))$/i;
const MAX_BYTES = 1_000_000;

export const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|spec|specs|fixtures?|e2e|cypress|playwright|mocks?|examples?|samples?|docs?|stories|storybook)(\/|$)|\.(test|spec|stories)\.\w+$/i;

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

export function isGitRepo(root) {
  try { return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'; } catch { return false; }
}

// In git mode .gitignore already drops build output; a tracked bin/ is usually real source (bin/cli.js).
const GIT_KEEP = new Set(['bin']);

function skippedDir(rel) {
  const parts = rel.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (GIT_KEEP.has(parts[i])) continue;
    if (SKIP_DIRS.has(parts[i]) || SKIP_DIRS.has(parts.slice(i, i + 2).join('/'))) return true;
  }
  return false;
}

function walk(root, dir = '', out = []) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !SKIP_DIRS.has(rel)) walk(root, rel, out);
    } else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** → { git: bool, all: [rel], tracked: Set<rel> | null } */
export function listFiles(root) {
  if (isGitRepo(root)) {
    // -z keeps odd file names intact; paths are relative to root when -C root is a subfolder too
    const all = git(root, ['ls-files', '-co', '--exclude-standard', '-z', '--', '.']).split('\0').filter(Boolean);
    const tracked = new Set(git(root, ['ls-files', '-z', '--', '.']).split('\0').filter(Boolean));
    return { git: true, all: all.filter((f) => !skippedDir(f)), tracked };
  }
  return { git: false, all: walk(root), tracked: null };
}

/** Text content to scan, or null for binaries, huge files and generated bundles. */
export function readScannable(root, rel) {
  if (SKIP_FILE.test(rel)) return null;
  let buf;
  try {
    const st = fs.statSync(path.join(root, rel));
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    buf = fs.readFileSync(path.join(root, rel));
  } catch { return null; }
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  return buf.toString('utf8');
}

/** Added lines from git history: [{ commit, date, file, line, text }]. Skips the working tree (scanned separately). */
export function historyAddedLines(root, maxCommits) {
  let log;
  try {
    log = git(root, ['log', '--all', '-p', '--no-color', '--no-ext-diff', '-U0', `--max-count=${maxCommits}`, '--format=@@commit %H %cs', '--', '.']);
  } catch { return null; }
  const out = [];
  let commit = '', date = '', file = '', lineNo = 0;
  for (const l of log.split('\n')) {
    if (l.startsWith('@@commit ')) { [, commit, date] = l.split(' '); continue; }
    if (l.startsWith('+++ ')) { file = l.startsWith('+++ b/') ? l.slice(6) : ''; continue; }
    if (l.startsWith('@@ ')) { const m = /\+(\d+)/.exec(l); lineNo = m ? Number(m[1]) : 0; continue; }
    if (l.startsWith('+') && file && !l.startsWith('+++')) {
      if (l.length < 4000) out.push({ commit, date, file, line: lineNo, text: l.slice(1) });
      lineNo++;
    }
  }
  return out;
}
