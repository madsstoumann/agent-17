#!/usr/bin/env node
/**
 * Adds one written file to a project, with the header every project file carries. The starting set
 * is small on purpose; a file is added when something calls for it (a section outgrew its parent,
 * a subject got its own owner, a topic came up that has no home). The body is written by the skill;
 * the change record that adds the file bumps it with `<name>:new`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, args, AUDIENCES, BUDGET } from './lib/project.mjs';
import { build } from './build.mjs';

const USAGE = `Usage: file.mjs --root DIR --path project/<folder>/<name>.md --description "One line" --owner ROLE
                [--parent KEY] [--depends-on a,b] [--audience people|agents|people-and-agents] [--title "Heading"] [--date YYYY-MM-DD]
       file.mjs --root DIR --sizes`;
const csv = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

export function addFile(root, { path: rel, description, owner, parent = '', dependsOn = [], audience = 'people-and-agents', title = '', date = new Date().toISOString().slice(0, 10) }) {
  rel = String(rel ?? '').split(path.sep).join('/');
  if (!/^project\/(?:[a-z0-9-]+\/)+[a-z0-9-]+\.md$/.test(rel)) throw new Error('--path is project/<folder>/<name>.md, lowercase letters, digits and hyphens');
  if (rel.startsWith('project/memory/')) throw new Error('project/memory/ is kept by the skills: a written file goes in another folder');
  if (!description || /[{}\n"\\]/.test(description)) throw new Error('--description is required, on one line, without quotes or braces');
  if (!/^[a-z0-9-]+$/.test(owner ?? '')) throw new Error('--owner is one role, as a word (pm, designer, tech-lead)');
  if (!AUDIENCES.includes(audience)) throw new Error(`--audience is one of ${AUDIENCES.join(', ')}`);
  const name = path.basename(rel, '.md');
  const { written } = load(root);
  const keys = new Map(written.map((f) => [f.key, f.rel]));
  if (keys.has(name)) throw new Error(`a file named "${name}" exists (${keys.get(name)}): names are unique, links use them`);
  const deps = [...new Set([...(parent ? [parent] : []), ...dependsOn].map((d) => d.replace(/\.md$/i, '').toLowerCase()))]; // DESIGN.md is `design`
  for (const d of deps) if (!keys.has(d)) throw new Error(`"${d}" is not a project file (${[...keys.keys()].join(', ')})`);
  const target = path.join(root, rel);
  if (fs.existsSync(target)) throw new Error(`${rel} exists`);
  const heading = title || name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const text = `---\nname: ${name}\ndescription: "${description}"\nmetadata:\n  type: project\n  version: "0.1.0"\n  status: active\n  audience: ${audience}\n  owner: ${owner}\n  contributors: []\n  depends_on: [${deps.join(', ')}]\n  open: []\n  changelog: memory/changelog/${name}.md\n  updated: ${date}\n---\n\n# ${heading}\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  build(root); // the index lists it at once
  return { name, path: rel, owner, depends_on: deps, bump: `${name}:new` };
}

/** Every written file with its size against its budget, largest share first: what to split next. */
export function sizes(root) {
  const rows = load(root).written.map((f) => { const bytes = Buffer.byteLength(f.text), budget = BUDGET[f.key] ?? BUDGET.default; return { file: f.rel, key: f.key, bytes, budget, used: Math.round((bytes / budget) * 100) }; });
  const agents = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agents)) { const bytes = fs.statSync(agents).size; rows.push({ file: 'AGENTS.md', key: 'agents', bytes, budget: BUDGET['AGENTS.md'], used: Math.round((bytes / BUDGET['AGENTS.md']) * 100) }); }
  return rows.sort((a, b) => b.used - a.used);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool', sizes: 'bool' });
  if (a.help || !a.root) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try {
    const root = path.resolve(a.root);
    console.log(JSON.stringify(a.sizes ? sizes(root) : addFile(root, { path: a.path, description: a.description, owner: a.owner, parent: a.parent, dependsOn: csv(a['depends-on']), audience: a.audience, title: a.title, date: a.date }), null, 2));
  } catch (e) { console.error(e.message); process.exit(2); }
}
