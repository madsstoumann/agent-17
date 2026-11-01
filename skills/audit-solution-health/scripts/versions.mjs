// Small version helpers shared by packages.mjs and tasks.mjs: comparing versions, the Node major a project
// runs on (for @types/node), and MSBuild properties ($(Name)) that csproj and props files put versions in.
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const numsOf = (v) => { const s = String(v || '').trim().replace(/^v/i, '').replace(/\+.*$/, '').split('-')[0]; return /^\d+(\.\d+)*$/.test(s) ? s.split('.').map(Number) : []; };
/** Plain x.y.z[-pre] versions; null when either side is not a version (an MSBuild property, "*", a range). */
export function compareVersions(a, b) {
  const x = numsOf(a); const y = numsOf(b);
  if (!x.length || !y.length) return null;
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  const pa = String(a).split('-')[1] || ''; const pb = String(b).split('-')[1] || '';
  if (pa === pb) return 0;
  return !pa ? 1 : !pb ? -1 : pa.localeCompare(pb, 'en', { numeric: true });
}
/** True only when `latest` is known to be newer than `installed`. */
export const isNewer = (latest, installed) => (compareVersions(latest, installed) ?? 0) > 0;

/**
 * The Node major the project runs on, from the files that pin it: { major, source } or null.
 * Exact pins (.nvmrc, .node-version, .tool-versions, volta, Dockerfile FROM node:) win over engines.node,
 * which wins over CI workflow versions. With several, the lowest: types must not promise APIs a runtime lacks.
 */
export function nodeMajor({ root, runtimePins = [], npmManifests = [] }) {
  const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return ''; } };
  const tiers = [[], [], []];
  const add = (tier, v, source) => { const m = String(v || '').match(/(\d+)/); if (m && !/^(lts|latest|current|node)/i.test(String(v).trim().replace(/^v/, ''))) tiers[tier].push({ major: Number(m[1]), source }); };
  for (const rel of runtimePins) {
    const txt = read(rel);
    if (/(^|\/)\.(nvmrc|node-version)$/.test(rel)) add(0, txt.trim().replace(/^v/, '').split(/\s/)[0], rel);
    else if (rel.endsWith('.tool-versions')) { const m = txt.match(/^nodejs\s+(\S+)/m); if (m) add(0, m[1], rel); }
    else if (/Dockerfile$/.test(rel)) for (const m of txt.matchAll(/^FROM\s+(?:\S+\/)?node:(\d+)/gim)) add(0, m[1], rel);
    else if (/\.ya?ml$/.test(rel)) for (const m of txt.matchAll(/node-version:\s*['"]?(\d+)/g)) add(2, m[1], rel);
  }
  for (const rel of npmManifests) {
    let j = {}; try { j = JSON.parse(read(rel) || '{}'); } catch { /* unreadable */ }
    if (j.volta?.node) add(0, j.volta.node, `${rel} (volta)`);
    if (j.engines?.node) add(1, j.engines.node, `${rel} (engines.node "${j.engines.node}")`);
  }
  const tier = tiers.find((t) => t.length);
  return tier ? tier.reduce((a, b) => (b.major < a.major ? b : a)) : null;
}

// ---------- MSBuild properties ----------
const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const unxml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Properties a file sets in its PropertyGroups, split into unconditional and conditional ones. */
function propsIn(text) {
  const plain = {}; const conditional = {};
  for (const g of stripComments(text).matchAll(/<PropertyGroup\b([^>]*)>([\s\S]*?)<\/PropertyGroup>/gi)) {
    const groupCond = /\bCondition\s*=/.test(g[1]);
    for (const m of g[2].matchAll(/<([A-Za-z_][\w.-]*)(\s[^>]*)?>([^<]*)<\/\1>/g)) {
      const into = groupCond || /\bCondition\s*=/.test(m[2] || '') ? conditional : plain;
      into[m[1].toLowerCase()] = unxml(m[3].trim());
    }
  }
  return { plain, conditional };
}

/**
 * The MSBuild properties a project sees, in evaluation order: every Directory.Build.props from the
 * solution root down to the project, Directory.Packages.props, then the project file (later wins).
 * Returns { props, files } with root-relative file names.
 */
export function msbuildProperties(root, projectRel) {
  const projectFile = resolve(root, projectRel);
  const files = [];
  const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
  const dirs = [];
  for (let d = dirname(projectFile); ; d = dirname(d)) { dirs.unshift(d); if (resolve(d) === resolve(root) || dirname(d) === d) break; }
  for (const name of ['Directory.Build.props', 'Directory.Packages.props']) for (const d of dirs) if (read(join(d, name)) !== null) files.push(join(d, name));
  if (!/Directory\.(Build|Packages)\.props$/.test(projectFile)) files.push(projectFile);
  // Conditions are not evaluated: a conditional value only fills a gap no unconditional one sets.
  const plain = {}; const conditional = {};
  for (const f of files) { const r = propsIn(read(f) || ''); Object.assign(plain, r.plain); Object.assign(conditional, r.conditional); }
  const props = { ...conditional, ...plain };
  return { props, files: files.map((f) => relative(root, f).split('\\').join('/')) };
}

/** Expand $(Name) against the properties (and the environment, as MSBuild does). Returns { value, unresolved[] }. */
export function expandMsbuild(value, props, env = process.env) {
  const unresolved = [];
  let v = String(value ?? '');
  for (let i = 0; i < 8 && /\$\(/.test(v); i++) {
    const before = v;
    v = v.replace(/\$\(([\w.-]+)\)/g, (all, n) => props[n.toLowerCase()] ?? env[n] ?? all);
    if (v === before) break;
  }
  for (const m of v.matchAll(/\$\(([^)]+)\)/g)) unresolved.push(m[0]);
  return { value: v, unresolved };
}
