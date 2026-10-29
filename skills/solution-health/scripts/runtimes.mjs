#!/usr/bin/env node
// Phase 2: runtimes and frameworks against endoflife.date (Node, .NET, Umbraco, Next.js, React, Angular, Vue, Nuxt…).
// Usage: node runtimes.mjs [--root <dir>]
// Reads run/discovery.json and run/packages.json. Writes run/runtimes.json.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs, paths, readJson, writeJson, cachedJson, daysUntil, loadManifest, ensureDirs, log, nowIso } from './lib.mjs';

const args = parseArgs();
const p = paths(args);
ensureDirs(p);
const discovery = readJson(join(p.runDir, 'discovery.json'));
const packages = readJson(join(p.runDir, 'packages.json'));
if (!discovery) { log('Run discover.mjs first.'); process.exit(2); }
const manifest = loadManifest(p) || {};
const warnDays = manifest.runtimes?.warnDays ?? 180;

const found = []; // { product, version, source }
const add = (product, version, source) => { if (version) found.push({ product, version: String(version).trim(), source }); };
const read = (rel) => { try { return readFileSync(join(p.root, rel), 'utf8'); } catch { return ''; } };

// Node
for (const rel of discovery.runtimePins) {
  const txt = read(rel);
  if (/(^|\/)\.(nvmrc|node-version)$/.test(rel)) add('nodejs', txt.replace(/^v/, '').split(/\s/)[0], rel);
  if (rel.endsWith('.tool-versions')) { const m = txt.match(/^nodejs\s+(\S+)/m); if (m) add('nodejs', m[1], rel); }
  if (/Dockerfile$/.test(rel)) for (const m of txt.matchAll(/^FROM\s+(?:\S+\/)?node:(\d+(?:\.\d+)*)/gim)) add('nodejs', m[1], rel);
  if (/Dockerfile$/.test(rel)) for (const m of txt.matchAll(/^FROM\s+mcr\.microsoft\.com\/dotnet\/(?:aspnet|sdk|runtime)[^:]*:(\d+\.\d+)/gim)) add('dotnet', m[1], rel);
  if (/\.ya?ml$/.test(rel)) {
    for (const m of txt.matchAll(/node-version:\s*['"]?(\d+(?:\.\d+)*)/g)) add('nodejs', m[1], rel);
    for (const m of txt.matchAll(/dotnet-version:\s*['"]?(\d+\.\d+)/g)) add('dotnet', m[1], rel);
  }
  if (rel.endsWith('global.json')) { const j = readJson(join(p.root, rel)); if (j?.sdk?.version) add('dotnet', j.sdk.version.split('.').slice(0, 2).join('.'), rel); }
}
for (const rel of discovery.manifests.npm) {
  const j = readJson(join(p.root, rel)) || {};
  const eng = j.engines?.node; if (eng) { const m = String(eng).match(/(\d+)(?:\.(\d+))?/); if (m) add('nodejs', m[1], `${rel} (engines.node "${eng}")`); }
  if (j.volta?.node) add('nodejs', j.volta.node, `${rel} (volta)`);
}
// .NET target frameworks
for (const proj of packages?.nugetProjects || []) for (const tfm of proj.targetFrameworks || []) {
  let m;
  if ((m = tfm.match(/^net(\d+)\.(\d+)/))) add('dotnet', `${m[1]}.${m[2]}`, `${proj.path} (${tfm})`);
  else if ((m = tfm.match(/^netcoreapp(\d+\.\d+)/))) add('dotnet', m[1], `${proj.path} (${tfm})`);
  else if ((m = tfm.match(/^net(4)(\d)(\d)?$/))) add('dotnetfx', `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`, `${proj.path} (${tfm})`);
}
// Frameworks from packages
const FRAMEWORK_PACKAGES = {
  npm: { next: 'nextjs', react: 'react', '@angular/core': 'angular', vue: 'vue', nuxt: 'nuxt', svelte: 'svelte', typescript: 'typescript', 'gatsby': 'gatsby', electron: 'electron', 'astro': 'astro', jquery: 'jquery', bootstrap: 'bootstrap', 'tailwindcss': 'tailwind-css' },
  nuget: { 'umbraco.cms': 'umbraco', 'umbraco.cms.core': 'umbraco', umbracocms: 'umbraco', 'sitecore.kernel': 'sitecore', 'episerver.cms': 'optimizely-cms', 'microsoft.aspnetcore.app': 'dotnet' },
};
for (const pkg of packages?.packages || []) {
  const product = FRAMEWORK_PACKAGES[pkg.ecosystem]?.[pkg.name.toLowerCase()];
  const v = pkg.installed || String(pkg.ranges?.[0] || '').replace(/^[^\d]*/, '');
  if (product && v) add(product, v, `${pkg.ecosystem} package ${pkg.name}`);
}
// Manual entries from the manifest (e.g. SQL Server, Elasticsearch, Azure Functions runtime, PHP on a legacy box)
for (const r of manifest.runtimes?.extra || []) add(r.product, r.version, `manifest (${r.note || 'manual'})`);

// Dedupe product+cycle
const products = [...new Set(found.map((f) => f.product))];
const results = [];
let reachable = false;
for (const product of products) {
  const res = await cachedJson(`https://endoflife.date/api/${product}.json`, p.cacheDir, { ttlHours: 72 });
  if (res.status > 0) reachable = true;
  const cycles = Array.isArray(res.json) ? res.json : null;
  const seen = new Set();
  for (const f of found.filter((x) => x.product === product)) {
    const parts = f.version.replace(/^[^\d]*/, '').split('.');
    const candidates = [parts.slice(0, 2).join('.'), parts[0], `core-${parts.slice(0, 2).join('.')}`];
    const cycle = cycles?.find((c) => candidates.includes(String(c.cycle)));
    const key = `${product}:${cycle?.cycle || candidates[1]}`;
    if (seen.has(key)) { results.find((r) => r.key === key)?.sources.push(f.source); continue; }
    seen.add(key);
    const r = { key, product, version: f.version, cycle: cycle?.cycle ?? null, sources: [f.source], eol: cycle?.eol ?? null, support: cycle?.support ?? null, latestInCycle: cycle?.latest ?? null, lts: cycle?.lts ?? null, newestCycle: cycles?.[0]?.cycle ?? null, link: `https://endoflife.date/${product}` };
    const eolDays = typeof r.eol === 'string' ? daysUntil(r.eol) : null;
    if (!cycles) r.verdict = { level: 'unknown', reasons: [res.status === 404 ? `endoflife.date has no "${product}" product` : 'endoflife.date unreachable'] };
    else if (!cycle) r.verdict = { level: 'amber', reasons: [`version ${f.version} not matched to a known ${product} release cycle — check manually`] };
    else if (r.eol === true || (eolDays !== null && eolDays < 0)) r.verdict = { level: 'red', reasons: [`${product} ${r.cycle} is end-of-life${typeof r.eol === 'string' ? ` since ${r.eol}` : ''}`] };
    else if (eolDays !== null && eolDays <= warnDays) r.verdict = { level: 'amber', reasons: [`${product} ${r.cycle} reaches end-of-life on ${r.eol} (${eolDays} days)`] };
    else r.verdict = { level: 'green', reasons: [typeof r.eol === 'string' ? `supported until ${r.eol}` : 'supported'] };
    results.push(r);
  }
}

const order = { red: 0, amber: 1, unknown: 2, green: 3 };
results.sort((a, b) => order[a.verdict.level] - order[b.verdict.level]);
writeJson(join(p.runDir, 'runtimes.json'), { generatedAt: nowIso(), reachable, runtimes: results });
log(`Runtimes/frameworks found: ${results.length}${reachable ? '' : ' (endoflife.date UNREACHABLE — verdicts unknown)'}`);
for (const r of results) log(`  [${r.verdict.level}] ${r.product} ${r.cycle ?? r.version} — ${r.verdict.reasons.join('; ')}  (${r.sources[0]})`);
log(`→ ${relative(p.root, p.runDir)}/runtimes.json`);
