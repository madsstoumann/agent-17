/**
 * Finds a project's memory layers: the instruction files Claude Code loads (CLAUDE.md and what it
 * imports, .claude/rules), AGENTS.md, the project's skills, its other markdown (docs, plans), the
 * memory store and the session transcripts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter } from './markdown.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'build', '.next', '.nuxt', 'coverage', 'vendor', '.venv', 'venv', '__pycache__', '.turbo', '.cache']);

export const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

/** Claude Code's folder name for a project: the absolute path with every non-alphanumeric character as '-'. */
export const projectSlug = (root) => path.resolve(root).replace(/[^A-Za-z0-9]/g, '-');

/** Files of the project, relative and with '/' separators. Git's view (tracked + untracked, not ignored) when root is a repo's top level. */
export function listFiles(root, { exclude = [] } = {}) {
  let files = null;
  let git = false;
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (path.resolve(top) === path.resolve(root)) {
      files = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean);
      git = true;
    }
  } catch { /* not a git repo */ }
  if (!files) {
    files = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); } else if (e.isFile()) files.push(rel(root, full));
      }
    };
    walk(root);
  }
  const ex = exclude.map(globToRegExp);
  files = files.filter((f) => !f.split('/').some((seg) => SKIP_DIRS.has(seg)) && !ex.some((r) => r.test(f)));
  return { files: files.sort(), git };
}

export function globToRegExp(glob) {
  const g = String(glob).replace(/\/$/, '/**');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** True when git ignores the path (so a file the docs name may exist locally without being in the repo). */
export function makeIgnored(root, git) {
  const cache = new Map();
  return (p) => {
    if (!git) return false;
    if (cache.has(p)) return cache.get(p);
    let ignored = false;
    try { execFileSync('git', ['-C', root, 'check-ignore', '-q', p], { stdio: 'ignore' }); ignored = true; } catch { ignored = false; }
    cache.set(p, ignored);
    return ignored;
  };
}

/** `@path` imports in a CLAUDE.md (outside code), resolved against the importing file. */
export function imports(text, fromFile) {
  const out = [];
  let inFence = false;
  for (const line of String(text ?? '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/(?:^|\s)@((?:~|\.{1,2})?\/?[\w./-]+\.\w+)/g)) {
      const p = m[1].startsWith('~') ? path.join(os.homedir(), m[1].slice(1)) : path.resolve(path.dirname(fromFile), m[1]);
      out.push(p);
    }
  }
  return out;
}

/**
 * The instruction layer as Claude Code loads it at session start: ./CLAUDE.md, ./.claude/CLAUDE.md,
 * ./CLAUDE.local.md, every @import (five levels deep), and .claude/rules/*.md without `paths:`.
 * AGENTS.md is listed on its own: Claude Code reads it only through an @AGENTS.md import.
 */
export function instructionFiles(root) {
  const loaded = [];
  const seen = new Set();
  const visit = (file, depth, via) => {
    const abs = path.resolve(file);
    if (seen.has(abs) || depth > 5 || !isFile(abs)) return;
    seen.add(abs);
    loaded.push({ file: abs, rel: rel(root, abs), via });
    for (const p of imports(readText(abs), abs)) visit(p, depth + 1, rel(root, abs));
  };
  for (const f of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) visit(path.join(root, f), 0, null);
  const rules = [];
  const rulesDir = path.join(root, '.claude', 'rules');
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) {
        const text = readText(full) || '';
        const scoped = Boolean(parseFrontmatter(text).data.paths);
        rules.push({ file: full, rel: rel(root, full), scoped });
      }
    }
  };
  walk(rulesDir);
  const agents = path.join(root, 'AGENTS.md');
  return {
    loaded,
    rules,
    agents: isFile(agents) ? { file: agents, rel: 'AGENTS.md', imported: seen.has(path.resolve(agents)) } : null,
  };
}

/** Memory folders that may belong to this project, best first. `explicit` wins. */
export function memoryCandidates(root, { explicit, home = os.homedir(), env = process.env } = {}) {
  if (explicit) return [path.resolve(explicit.replace(/^~(?=$|\/)/, home))];
  const out = [];
  for (const f of [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.json')]) {
    try {
      const dir = JSON.parse(readText(f) || '{}').autoMemoryDirectory;
      if (dir) out.push(path.resolve(path.dirname(f), dir.replace(/^~(?=$|\/)/, home)));
    } catch { /* not JSON */ }
  }
  const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  out.push(path.join(config, 'projects', projectSlug(root), 'memory'));
  out.push('/mnt/memory');
  return [...new Set(out)].filter(isDir);
}

/** Claude Code's transcript folder for this project (one .jsonl per session), or null. */
export function transcriptsDir(root, { explicit, home = os.homedir(), env = process.env } = {}) {
  if (explicit) return path.resolve(explicit.replace(/^~(?=$|\/)/, home));
  const dir = path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects', projectSlug(root));
  try { return fs.readdirSync(dir).some((f) => f.endsWith('.jsonl')) ? dir : null; } catch { return null; }
}

/** Every markdown file in the memory folder, relative to it. */
export function memoryFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(full); } else if (e.name.endsWith('.md')) out.push(rel(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/** The project's own skills: .claude/skills/<name>/SKILL.md. */
export function skillFiles(root) {
  const dir = path.join(root, '.claude', 'skills');
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isFile(path.join(dir, e.name, 'SKILL.md')))
      .map((e) => ({ name: e.name, file: path.join(dir, e.name, 'SKILL.md'), rel: `.claude/skills/${e.name}/SKILL.md` }));
  } catch { return []; }
}

/** Last commit date (YYYY-MM-DD) per file, from one `git log` pass. Empty when not a repo. */
export function lastChanged(root, git) {
  const out = new Map();
  if (!git) return out;
  try {
    const log = execFileSync('git', ['-C', root, 'log', '--format=@%ad', '--date=short', '--name-only', '--', '*.md'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    let date = null;
    for (const line of log.split('\n')) {
      if (line.startsWith('@')) date = line.slice(1);
      else if (line && date && !out.has(line)) out.set(line, date);
    }
  } catch { /* no history */ }
  return out;
}

export { isDir, isFile, rel };
