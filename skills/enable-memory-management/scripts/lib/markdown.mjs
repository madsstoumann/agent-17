/**
 * Reading markdown the way the checks need it: frontmatter, [[wiki links]], markdown links and
 * paths written in backticks. Pure functions, no file access.
 */

/**
 * The frontmatter between the first two `---` lines, as a plain object. Handles the subset memory
 * files use: `key: value`, one level of nesting by indentation, `[a, b]` lists and quoted strings.
 * Returns { data, body, raw } where raw is null when there is no frontmatter.
 */
export function parseFrontmatter(text) {
  const t = String(text ?? '');
  const m = t.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: t, raw: null };
  const data = {};
  let parent = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, indent, key, value] = kv;
    if (indent.length && parent) { parent[key] = scalar(value); continue; }
    if (value === '') { data[key] = {}; parent = data[key]; continue; }
    data[key] = scalar(value);
    parent = null;
  }
  return { data, body: t.slice(m[0].length), raw: m[1] };
}

function scalar(v) {
  const s = v.trim();
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
  return unquote(s);
}
const unquote = (s) => s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

/** A frontmatter key from the top level or from `metadata:` (the Agent Skills spec keeps extra keys there). */
export const meta = (data, key) => data?.[key] ?? data?.metadata?.[key];

/** [[name]] links, in order, without duplicates. `[[name|label]]` gives name. */
export function wikiLinks(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g)) out.add(m[1].trim());
  return [...out];
}

/** Text with fenced code blocks blanked (same line count), so links inside examples are not read. */
export function withoutFences(text) {
  let inFence = false;
  return String(text ?? '').split('\n').map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return ''; }
    return inFence ? '' : l;
  }).join('\n');
}

/** Targets of [label](target) links that point at local files: no scheme, no pure #anchor. */
export function mdLinks(text) {
  const out = new Set();
  for (const m of withoutFences(text).matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    out.add(decodeURI(target.split('#')[0]));
  }
  return [...out].filter(Boolean);
}

const PATH_EXT = /\.(md|mdx|txt|json|jsonc|ya?ml|toml|js|mjs|cjs|ts|tsx|jsx|py|sh|cs|cshtml|csproj|css|scss|html|svg|sql|rb|go|rs|java|kt|php|vue|svelte)$/i;

/**
 * Paths written in backticks: `scripts/build.py`, `docs/PLAN.md`, `src/app.ts:12`. A span counts
 * when it has no spaces and either contains a slash or ends in a known extension. Globs and
 * placeholders (`*`, `<id>`, `{name}`, `$VAR`, `…`) are skipped: they name a pattern, not a file.
 */
export function codePaths(text) {
  const out = new Set();
  for (const m of withoutFences(text).matchAll(/`([^`\n]{2,200})`/g)) {
    let s = m[1].trim().replace(/^\.\//, '');
    s = s.replace(/[:#]L?\d+(?:[-–]\d+)?$/, '').replace(/[),.;]+$/, '');
    if (/\s/.test(s) || /[*<>{}$…|"'=]/.test(s) || /\(\.?[a-z]+\)/.test(s)) continue;
    if (/^(https?:|[a-z]+:\/\/|@|~|-)/i.test(s)) continue;
    if (!PATH_EXT.test(s)) continue;
    if (!s.includes('/') && !/^[A-Z][A-Z0-9_-]+\.md$/.test(s)) continue;
    out.add(s);
  }
  return [...out];
}

/** Headings with their line number and the number of lines and bytes until the next heading of the same or higher level. */
export function sections(text, maxLevel = 3) {
  const lines = withoutFences(text).split('\n');
  const raw = String(text ?? '').split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(#{1,6})\s+(.*)$/);
    if (m && m[1].length <= maxLevel) heads.push({ level: m[1].length, title: m[2].trim(), line: i + 1 });
  });
  return heads.map((h, k) => {
    const next = heads.slice(k + 1).find((x) => x.level <= h.level);
    const end = next ? next.line - 1 : raw.length;
    const body = raw.slice(h.line - 1, end).join('\n');
    return { ...h, lines: end - h.line + 1, bytes: Buffer.byteLength(body) };
  });
}

/** Top-level bullets that start with bold text (`- **Rule.** …`), each with its continuation lines. */
export function boldBullets(text) {
  const raw = String(text ?? '').split('\n');
  const out = [];
  let cur = null;
  raw.forEach((l, i) => {
    if (/^[-*] \*\*/.test(l)) {
      if (cur) out.push(cur);
      cur = { line: i + 1, title: l.replace(/^[-*] \*\*/, '').replace(/\*\*.*$/, '').trim(), text: l };
    } else if (cur && (/^\s{2,}\S/.test(l) || l.trim() === '') && !/^#/.test(l)) {
      cur.text += `\n${l}`;
    } else if (cur) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out.map((b) => ({ ...b, text: b.text.replace(/\n+$/, ''), bytes: Buffer.byteLength(b.text.replace(/\n+$/, '')) }));
}

/** Fenced shell blocks: { line, heading, commands[] } — a block of commands someone is meant to run. */
export function shellBlocks(text) {
  const raw = String(text ?? '').split('\n');
  const out = [];
  let heading = '';
  for (let i = 0; i < raw.length; i++) {
    const h = raw[i].match(/^#{1,6}\s+(.*)$/);
    if (h) heading = h[1].trim();
    const f = raw[i].match(/^\s*```\s*(sh|bash|shell|zsh|console|powershell|ps1)?\s*$/i);
    if (!f) continue;
    const lang = (f[1] || '').toLowerCase();
    const cmds = [];
    let j = i + 1;
    for (; j < raw.length && !/^\s*```/.test(raw[j]); j++) {
      const c = raw[j].replace(/^\s*\$\s+/, '').replace(/\s+#.*$/, '').trim();
      if (c && !c.startsWith('#')) cmds.push(c);
    }
    const looksShell = lang || cmds.some((c) => /^(npm|npx|node|python3?|dotnet|git|pnpm|yarn|bun|make|docker|curl|bash|sh|\.\/)\b/.test(c));
    if (looksShell && cmds.length) out.push({ line: i + 1, heading, commands: cmds });
    i = j;
  }
  return out;
}

/** Word 3-shingles of a text, for near-duplicate checks. */
export function shingles(text, n = 3) {
  const words = String(text ?? '').toLowerCase().replace(/`[^`]*`/g, ' ').match(/[\p{L}\p{N}]+/gu) || [];
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Rough token count: bytes / 4, the usual estimate for English prose and code. */
export const tokens = (bytes) => Math.round(bytes / 4);
