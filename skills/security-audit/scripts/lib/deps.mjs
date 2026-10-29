/**
 * Lockfiles → exact package versions → OSV (api.osv.dev) known vulnerabilities.
 * Lockfiles, not manifests: transitive packages are where most advisories land, and a
 * lockfile pins the version that actually ships. One OSV batch call covers every ecosystem.
 */
import fs from 'node:fs';
import path from 'node:path';

const OSV = 'https://api.osv.dev/v1';

// ------------------------------------------------------------------ parsers: text → [{ name, version, dev? }]

export function parsePackageLock(text) {
  const j = JSON.parse(text);
  const out = [];
  if (j.packages) {
    for (const [key, p] of Object.entries(j.packages)) {
      if (!key || p.link || !p.version) continue;
      const name = p.name || key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      out.push({ name, version: p.version, dev: !!p.dev });
    }
    return out;
  }
  const walkV1 = (deps) => {
    for (const [name, p] of Object.entries(deps || {})) {
      if (/^\d/.test(p.version || '')) out.push({ name, version: p.version, dev: !!p.dev });
      walkV1(p.dependencies);
    }
  };
  walkV1(j.dependencies);
  return out;
}

/** yarn v1 and berry. */
export function parseYarnLock(text) {
  const out = [];
  let names = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(line) && line.endsWith(':')) {
      names = line.slice(0, -1).split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      continue;
    }
    const m = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line);
    if (m && names) {
      const spec = names[0];
      const at = spec.indexOf('@', 1);
      const name = at > 0 ? spec.slice(0, at) : spec;
      if (name !== '__metadata' && !/@(?:workspace|link|portal|file|patch):/.test(spec)) out.push({ name, version: m[1] });
      names = null;
    }
  }
  return out;
}

/** pnpm-lock.yaml v5 (/name/1.0.0), v6 (/name@1.0.0) and v9 (name@1.0.0). */
export function parsePnpmLock(text) {
  const out = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inPackages = /^packages:\s*$/.test(line); continue; }
    if (!inPackages) continue;
    const m = /^ {2}['"]?([^\s'"][^'"]*?)['"]?:\s*$/.exec(line);
    if (!m) continue;
    const key = m[1].replace(/^\//, '').replace(/\(.*$/, '').replace(/(\/\d[^/_]*)_.*$/, '$1');
    let name, version;
    const at = key.lastIndexOf('@');
    if (at > 0) { name = key.slice(0, at); version = key.slice(at + 1); }
    else { const sl = key.lastIndexOf('/'); name = key.slice(0, sl); version = key.slice(sl + 1); }
    if (name && /^\d/.test(version)) out.push({ name, version });
  }
  return out;
}

export function parseComposerLock(text) {
  const j = JSON.parse(text);
  return [
    ...(j.packages || []).map((p) => ({ name: p.name, version: String(p.version).replace(/^v/, '') })),
    ...(j['packages-dev'] || []).map((p) => ({ name: p.name, version: String(p.version).replace(/^v/, ''), dev: true })),
  ].filter((p) => /^\d/.test(p.version));
}

export function parseNugetLock(text) {
  const j = JSON.parse(text);
  const out = [];
  for (const fw of Object.values(j.dependencies || {})) {
    for (const [name, p] of Object.entries(fw)) if (p.resolved && p.type !== 'Project') out.push({ name, version: p.resolved });
  }
  return out;
}

/** .csproj / Directory.Packages.props / packages.config: exact versions only. */
export function parseMsbuild(text) {
  const out = [];
  const re = /<(?:PackageReference|PackageVersion|package)\b([^>]*?)\/?>(?:\s*<Version>([^<]+)<\/Version>)?/gi;
  for (const m of text.matchAll(re)) {
    const attrs = m[1];
    const name = /\b(?:Include|Update|id)\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
    const version = /\bVersion\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? m[2];
    if (name && version && /^\d[\w.-]*$/.test(version.trim())) out.push({ name, version: version.trim() });
  }
  return out;
}

export function parseRequirements(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([0-9][^\s;#]*)/.exec(line);
    if (m) out.push({ name: m[1], version: m[2] });
  }
  return out;
}

/** poetry.lock and uv.lock: [[package]] name = "…" version = "…". */
export function parseTomlLock(text) {
  const out = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name && version) out.push({ name, version });
  }
  return out;
}

export function parseGemfileLock(text) {
  const out = [];
  let inSpecs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s{2}specs:\s*$/.test(line)) { inSpecs = true; continue; }
    if (/^\S/.test(line)) inSpecs = false;
    const m = inSpecs && /^ {4}([^\s(]+) \(([^)]+)\)\s*$/.exec(line);
    if (m) out.push({ name: m[1], version: m[2].replace(/-[a-z].*$/, '') });
  }
  return out;
}

export function parseGoMod(text) {
  const out = [];
  for (const m of text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+(v[0-9][^\s]*)/gm)) {
    out.push({ name: m[1], version: m[2] });
  }
  return out;
}

export const LOCKFILES = [
  { test: /(^|\/)(package-lock|npm-shrinkwrap)\.json$/, ecosystem: 'npm', parse: parsePackageLock },
  { test: /(^|\/)yarn\.lock$/, ecosystem: 'npm', parse: parseYarnLock },
  { test: /(^|\/)pnpm-lock\.yaml$/, ecosystem: 'npm', parse: parsePnpmLock },
  { test: /(^|\/)composer\.lock$/, ecosystem: 'Packagist', parse: parseComposerLock },
  { test: /(^|\/)packages\.lock\.json$/, ecosystem: 'NuGet', parse: parseNugetLock },
  { test: /\.(cs|vb|fs)proj$|(^|\/)Directory\.Packages\.props$|(^|\/)packages\.config$/, ecosystem: 'NuGet', parse: parseMsbuild },
  { test: /(^|\/)requirements[\w.-]*\.txt$/, ecosystem: 'PyPI', parse: parseRequirements },
  { test: /(^|\/)(poetry|uv)\.lock$/, ecosystem: 'PyPI', parse: parseTomlLock },
  { test: /(^|\/)Gemfile\.lock$/, ecosystem: 'RubyGems', parse: parseGemfileLock },
  { test: /(^|\/)go\.mod$/, ecosystem: 'Go', parse: parseGoMod },
];

/** → { sources: [{ file, ecosystem, count, error? }], packages: [{ ecosystem, name, version, dev, files: [] }] } */
export function collectPackages(root, files) {
  const sources = [];
  const byKey = new Map();
  for (const rel of files) {
    if (/(^|\/)node_modules\//.test(rel)) continue;
    const lf = LOCKFILES.find((l) => l.test.test(rel));
    if (!lf) continue;
    let list;
    try { list = lf.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
    catch (e) { sources.push({ file: rel, ecosystem: lf.ecosystem, count: 0, error: e.message }); continue; }
    sources.push({ file: rel, ecosystem: lf.ecosystem, count: list.length });
    for (const p of list) {
      const key = `${lf.ecosystem}|${p.name}|${p.version}`;
      const cur = byKey.get(key);
      if (cur) { cur.dev = cur.dev && !!p.dev; if (!cur.files.includes(rel)) cur.files.push(rel); }
      else byKey.set(key, { ecosystem: lf.ecosystem, name: p.name, version: p.version, dev: !!p.dev, files: [rel] });
    }
  }
  // A .csproj next to a packages.lock.json duplicates it: keep both, the key dedupes.
  return { sources, packages: [...byKey.values()] };
}

// ------------------------------------------------------------------ OSV

async function postJson(url, body, timeoutMs = 30000) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function getJson(url, timeoutMs = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const SEV_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1 };

/** Severity word from an OSV record: GHSA's database_specific.severity, else the CVSS base score. */
export function osvSeverity(v) {
  const word = (v.database_specific?.severity || v.affected?.find((a) => a.ecosystem_specific?.severity)?.ecosystem_specific.severity || '').toUpperCase();
  if (SEV_RANK[word]) return word === 'MEDIUM' ? 'MODERATE' : word;
  const score = v.severity?.find((s) => /^\d+(\.\d+)?$/.test(s.score))?.score;
  if (score) { const n = Number(score); return n >= 9 ? 'CRITICAL' : n >= 7 ? 'HIGH' : n >= 4 ? 'MODERATE' : 'LOW'; }
  return 'UNKNOWN';
}

export function osvFixed(v, ecosystem, name) {
  const fixed = new Set();
  for (const a of v.affected || []) {
    if (a.package?.ecosystem !== ecosystem || a.package?.name.toLowerCase() !== name.toLowerCase()) continue;
    for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed) fixed.add(e.fixed);
  }
  return [...fixed];
}

/**
 * → { queried, vulnerable: [{ ecosystem, name, version, dev, files, vulns: [{ id, aliases, severity, summary, fixed, url }] }] }
 */
export async function queryOsv(packages, { log = () => {} } = {}) {
  const hits = new Map(); // index → [ids]
  for (let start = 0; start < packages.length; start += 1000) {
    const batch = packages.slice(start, start + 1000);
    let queries = batch.map((p) => ({ package: { ecosystem: p.ecosystem, name: p.name }, version: p.version }));
    let pending = batch.map((_, i) => start + i);
    // Follow next_page_token for packages with many advisories.
    while (queries.length) {
      const res = await postJson(`${OSV}/querybatch`, { queries });
      const nextQ = [], nextIdx = [];
      res.results.forEach((r, i) => {
        if (r.vulns?.length) hits.set(pending[i], [...(hits.get(pending[i]) || []), ...r.vulns.map((v) => v.id)]);
        if (r.next_page_token) { nextQ.push({ ...queries[i], page_token: r.next_page_token }); nextIdx.push(pending[i]); }
      });
      queries = nextQ; pending = nextIdx;
    }
    log(`osv: ${Math.min(start + 1000, packages.length)}/${packages.length} packages queried`);
  }
  const ids = [...new Set([...hits.values()].flat())];
  const details = new Map();
  await pool(ids, 8, async (id) => {
    try { details.set(id, await getJson(`${OSV}/vulns/${encodeURIComponent(id)}`)); } catch { details.set(id, { id }); }
  });
  const vulnerable = [];
  for (const [idx, vids] of hits) {
    const p = packages[idx];
    const seen = new Set();
    const vulns = [];
    for (const id of vids) {
      const v = details.get(id) || { id };
      // GHSA and CVE records for the same issue: keep one, list the others as aliases.
      if (seen.has(id) || (v.aliases || []).some((a) => seen.has(a))) continue;
      seen.add(id); (v.aliases || []).forEach((a) => seen.add(a));
      vulns.push({ id, aliases: v.aliases || [], severity: osvSeverity(v), summary: v.summary || (v.details || '').split('\n')[0].slice(0, 200), fixed: osvFixed(v, p.ecosystem, p.name), url: `https://osv.dev/vulnerability/${id}` });
    }
    vulns.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
    vulnerable.push({ ...p, vulns });
  }
  vulnerable.sort((a, b) => (SEV_RANK[b.vulns[0]?.severity] || 0) - (SEV_RANK[a.vulns[0]?.severity] || 0) || a.name.localeCompare(b.name));
  return { queried: packages.length, vulnerable };
}
