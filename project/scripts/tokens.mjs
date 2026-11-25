#!/usr/bin/env node
/**
 * The tokens in a DESIGN.md's header, as CSS custom properties and as a design-tokens JSON file.
 * DESIGN.md stays the one place a token is decided; the exports are generated and never edited.
 * `--check` says whether exports on disk still match, which is what a CI step or a pull request asks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './lib/md.mjs';
import { args } from './lib/project.mjs';

const USAGE = `Usage: tokens.mjs --root DIR [--css PATH] [--json PATH] [--check] [--design PATH]
       With no --css or --json it prints the tokens and writes nothing.`;
/** Where a project's design file can be, first match wins. The project's own comes first. */
export const DESIGN_FILES = ['project/building-blocks/DESIGN.md', 'DESIGN.md', 'design.md', 'docs/DESIGN.md'];
/** Header keys that are not token groups. */
const NOT_TOKENS = new Set(['version', 'name', 'description', 'omitted', 'metadata', 'components']);
/** Group name in DESIGN.md → prefix of the custom property. */
const PREFIX = { colors: 'color', typography: 'type', spacing: 'space', rounded: 'rounded', motion: 'motion' };
const TYPE = { colors: 'color', spacing: 'dimension', rounded: 'dimension' };
const MARK = 'Generated from DESIGN.md by /project:tokens. Do not edit: change DESIGN.md and export again.';
const kebab = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

export function findDesign(root, given = null) {
  const rel = given ?? DESIGN_FILES.find((f) => fs.existsSync(path.join(root, f)));
  if (!rel || !fs.existsSync(path.join(root, rel))) return null;
  return rel.split(path.sep).join('/');
}

function flatten(group, value, trail, out) {
  if (value && typeof value === 'object' && !Array.isArray(value)) { for (const [k, v] of Object.entries(value)) flatten(group, v, [...trail, k], out); return; }
  if (!trail.length || value === '' || value == null) return;
  out.push({ group, path: trail, ref: `${group}.${trail.join('.')}`, name: `--${[PREFIX[group] ?? kebab(group), ...trail.map(kebab)].join('-')}`, value: Array.isArray(value) ? value.join(', ') : String(value) });
}

export function tokens(root, { design = null } = {}) {
  const rel = findDesign(root, design);
  if (!rel) return { root, design: null, tokens: [], groups: [], omitted: [], problems: ['no DESIGN.md here: looked for ' + DESIGN_FILES.join(', ')] };
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const { data, raw } = parseFrontmatter(text);
  const all = [];
  for (const [group, value] of Object.entries(data)) if (!NOT_TOKENS.has(group) && value && typeof value === 'object' && !Array.isArray(value)) flatten(group, value, [], all);
  const byRef = new Map(all.map((t) => [t.ref, t]));
  const problems = [];
  for (const t of all) {
    t.css = t.value.replace(/\{([A-Za-z0-9_.-]+)\}/g, (m, ref) => {
      const to = byRef.get(ref);
      if (!to) { problems.push(`${t.ref} refers to {${ref}}, which is not a token`); return m; }
      return `var(${to.name})`;
    });
    if (t.group === 'colors' && !/^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab|lab|lch|color|color-mix|light-dark)\(.*\)|\{.*\}|[a-z]+)$/i.test(t.value)) problems.push(`${t.ref}: "${t.value}" does not read as a colour`);
  }
  const names = new Map();
  for (const t of all) { if (names.has(t.name)) problems.push(`${t.ref} and ${names.get(t.name)} both export as ${t.name}`); names.set(t.name, t.ref); }
  const omitted = [...String(raw ?? '').matchAll(/^\s*-\s*section:\s*(\S+)/gm)].map((m) => m[1]);
  return { root, design: rel, tokens: all, groups: [...new Set(all.map((t) => t.group))], omitted, problems };
}

export function toCss(t) {
  const lines = [`/* ${MARK} */`, ':root {'];
  for (const g of t.groups) for (const x of t.tokens.filter((y) => y.group === g)) lines.push(`  ${x.name}: ${x.css};`);
  lines.push('}', '');
  return lines.join('\n');
}

/** Design Tokens Community Group shape: nested groups, each token a `$value`, references kept as `{group.name}`. */
export function toJson(t) {
  const out = { $description: MARK };
  for (const x of t.tokens) {
    let at = (out[x.group] ??= TYPE[x.group] ? { $type: TYPE[x.group] } : {});
    for (const k of x.path.slice(0, -1)) at = (at[k] ??= {});
    at[x.path.at(-1)] = { $value: x.value };
  }
  return JSON.stringify(out, null, 2) + '\n';
}

/** Writes the exports, or with `check` only compares them with what is on disk. */
export function exportTokens(root, { css = null, json = null, check = false, design = null } = {}) {
  const t = tokens(root, { design });
  const files = [];
  if (!t.design || t.problems.length) return { ...t, files, wrote: false, inSync: false };
  for (const [rel, text] of [[css, css && toCss(t)], [json, json && toJson(t)]]) {
    if (!rel) continue;
    const p = path.resolve(root, rel);
    if (path.relative(root, p).startsWith('..')) throw new Error(`${rel} is outside the project`);
    const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (old !== null && !old.includes(MARK)) throw new Error(`${rel} exists and was not generated here: it is not overwritten. Pick another path`);
    const state = old === null ? 'missing' : old === text ? 'same' : 'differs';
    if (!check && state !== 'same') { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
    files.push({ path: rel, state: check ? state : state === 'same' ? 'unchanged' : 'written' });
  }
  return { ...t, files, wrote: !check && files.some((f) => f.state === 'written'), inSync: files.every((f) => f.state === 'same' || f.state === 'unchanged' || f.state === 'written') };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool', check: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try {
    const r = exportTokens(path.resolve(a.root), { css: a.css, json: a.json, check: a.check, design: a.design });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.problems.length || (a.check && !r.inSync) ? 1 : 0);
  } catch (e) { console.error(e.message); process.exit(2); }
}
