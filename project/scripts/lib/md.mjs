/**
 * Reading and rewriting the frontmatter of project files. Pure functions, no file access.
 * Handles the subset these files use: `key: value`, nesting by indentation, `[a, b]` lists,
 * quoted strings, and block lists of scalars or `key: value` items (DESIGN.md's `omitted:`).
 */

const FM = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(text) {
  const t = String(text ?? '');
  const m = t.match(FM);
  if (!m) return { data: {}, body: t, raw: null };
  const data = {};
  const stack = [{ indent: -1, obj: data }];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || /^\s*-\s/.test(line)) continue;
    const kv = line.match(/^(\s*)([A-Za-z0-9_.$-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, sp, key, value] = kv;
    while (stack.length > 1 && sp.length <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).obj;
    if (value === '') { parent[key] = {}; stack.push({ indent: sp.length, obj: parent[key] }); } else parent[key] = scalar(value);
  }
  return { data, body: t.slice(m[0].length), raw: m[1] };
}

function scalar(v) {
  const s = v.replace(/\s+#.*$/, '').trim();
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
  return unquote(s);
}
const unquote = (s) => s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

/** A list value, whatever the parser made of it (an empty `key:` parses as {}). */
export const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);

/** Set one key under `metadata:` in a file's text, keeping every other line as it is. */
export function setMeta(text, key, value) {
  const m = String(text).match(FM);
  if (!m) throw new Error('no frontmatter');
  const lines = m[1].split(/\r?\n/);
  const start = lines.findIndex((l) => /^metadata:\s*$/.test(l));
  if (start < 0) throw new Error('no metadata block');
  let end = start + 1;
  while (end < lines.length && (/^\s+/.test(lines[end]) || !lines[end].trim())) end++;
  const out = `  ${key}: ${format(value)}`;
  const at = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^  ${key}:`).test(l));
  if (at >= 0) lines[at] = out; else lines.splice(end, 0, out);
  return text.replace(m[1], () => lines.join('\n'));
}

const format = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : /^\d+\.\d+\.\d+$/.test(String(v)) ? `"${v}"` : String(v));

/** The text under a `## Heading`, up to the next heading of the same or a higher level. */
export function section(body, heading) {
  const lines = String(body).split('\n');
  const i = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !/^#{1,2}\s/.test(lines[j])) j++;
  return lines.slice(i + 1, j).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
}

/** Rows of the first markdown table after a `## Heading`, as objects keyed by the header cells. */
export function table(body, heading) {
  const lines = String(body).split('\n');
  let i = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (i < 0) return [];
  while (i < lines.length && !lines[i].startsWith('|')) i++;
  const cells = (l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|'));
  const head = cells(lines[i] ?? '');
  const rows = [];
  for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
    const c = cells(lines[j]);
    rows.push(Object.fromEntries(head.map((h, k) => [h, c[k] ?? ''])));
  }
  return rows;
}

export const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
