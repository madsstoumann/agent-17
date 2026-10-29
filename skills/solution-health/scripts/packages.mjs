#!/usr/bin/env node
// Phase 1: npm + NuGet packages — outdated, vulnerable, deprecated, and "is anyone still maintaining this?".
// Usage: node packages.mjs [--root <dir>] [--transitive] [--no-enrich] [--offline]
// Reads .solution-health/run/discovery.json (run discover.mjs first). Writes run/packages.json.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { parseArgs, paths, readJson, writeJson, cachedJson, mapLimit, daysSince, loadManifest, ensureDirs, log, nowIso } from './lib.mjs';
import { resolveProject, checkNuget, candidateSources, isNugetOrg } from './nuget.mjs';

const args = parseArgs();
const p = paths(args);
ensureDirs(p);
const discovery = readJson(join(p.runDir, 'discovery.json'));
if (!discovery) { log('Run discover.mjs first.'); process.exit(2); }
const manifest = loadManifest(p) || { packages: { ignore: [] } };
const thresholds = { staleMonths: 24, quietMonths: 12, ...(manifest.packages?.thresholds || {}) };
const enrich = !args['no-enrich'] && !args.offline;
const errors = [];

function run(cmd, cmdArgs, cwd, timeout = 180_000) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', timeout, shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? String(r.error.message || r.error) : null };
}
const has = (cmd) => !run(cmd, ['--version'], p.root, 20_000).error;
const tryJson = (s) => { try { return JSON.parse(s); } catch { const i = s.indexOf('{'); try { return i >= 0 ? JSON.parse(s.slice(i)) : null; } catch { return null; } } };

// ---------- npm ----------
const npmProjects = [];
const npmAvailable = has('npm');
for (const rel of discovery.manifests.npm) {
  const pkgFile = join(p.root, rel);
  const pkg = readJson(pkgFile);
  if (!pkg) continue;
  const dir = dirname(pkgFile);
  const lock = readJson(join(dir, 'package-lock.json'));
  const deps = [];
  for (const [kind, block] of [['prod', pkg.dependencies], ['dev', pkg.devDependencies], ['optional', pkg.optionalDependencies]]) {
    for (const [name, range] of Object.entries(block || {})) {
      if (/^(file|link|workspace|git\+|github:|https?:)/.test(String(range))) continue; // local or git deps: not on the registry
      const installed = readJson(join(dir, 'node_modules', name, 'package.json'))?.version
        || lock?.packages?.[`node_modules/${name}`]?.version || lock?.dependencies?.[name]?.version || null;
      deps.push({ name, range, installed, kind });
    }
  }
  const project = { path: rel, name: pkg.name || rel, hasLockfile: !!lock || existsSync(join(dir, 'yarn.lock')) || existsSync(join(dir, 'pnpm-lock.yaml')), deps, outdated: null, audit: null, notes: [] };
  if (npmAvailable && deps.length) {
    const o = run('npm', ['outdated', '--json', ...(args.transitive ? ['--all'] : [])], dir);
    project.outdated = tryJson(o.stdout) || {};
    if (existsSync(join(dir, 'package-lock.json')) || existsSync(join(dir, 'npm-shrinkwrap.json'))) {
      const a = run('npm', ['audit', '--json', ...(args.transitive ? [] : [])], dir);
      const aj = tryJson(a.stdout);
      if (aj?.vulnerabilities || aj?.metadata) {
        project.audit = {
          counts: aj.metadata?.vulnerabilities || null,
          vulnerabilities: Object.values(aj.vulnerabilities || {}).map((v) => ({
            name: v.name, severity: v.severity, isDirect: v.isDirect, range: v.range, fixAvailable: v.fixAvailable,
            via: (v.via || []).map((x) => (typeof x === 'string' ? x : { title: x.title, url: x.url, severity: x.severity })),
          })),
        };
      } else project.notes.push(`npm audit failed: ${(aj?.error?.summary || a.stderr || a.error || '').split('\n')[0]}`);
    } else project.notes.push('No package-lock.json: npm audit skipped (yarn/pnpm users: run `yarn npm audit` / `pnpm audit`).');
  } else if (!npmAvailable) project.notes.push('npm not on PATH: outdated/audit skipped.');
  npmProjects.push(project);
}

// ---------- NuGet ----------
function parseNuget(rel) {
  const text = readFileSync(join(p.root, rel), 'utf8');
  const refs = [];
  const tag = /<(PackageReference|PackageVersion|GlobalPackageReference)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi;
  let m;
  while ((m = tag.exec(text))) {
    const attrs = m[2];
    const name = (attrs.match(/\b(?:Include|Update)\s*=\s*"([^"]+)"/i) || [])[1];
    let version = (attrs.match(/\bVersion(?:Override)?\s*=\s*"([^"]+)"/i) || [])[1] || (m[4]?.match(/<Version>([^<]+)<\/Version>/i) || [])[1] || null;
    if (name) refs.push({ name, version, central: m[1] !== 'PackageReference' });
  }
  const cfg = /<package\s+[^>]*id\s*=\s*"([^"]+)"[^>]*version\s*=\s*"([^"]+)"/gi;
  while ((m = cfg.exec(text))) refs.push({ name: m[1], version: m[2], central: false });
  const tfm = [...text.matchAll(/<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/gi)].flatMap((x) => x[1].split(';')).map((s) => s.trim()).filter(Boolean);
  const tfmLegacy = (text.match(/<TargetFrameworkVersion>v?([^<]+)<\/TargetFrameworkVersion>/i) || [])[1];
  return { refs, targetFrameworks: tfm.length ? tfm : tfmLegacy ? [`net${tfmLegacy.replace(/\./g, '')}`] : [] };
}

const dotnetAvailable = has('dotnet');
const nugetProjects = [];
const centralVersions = {};
for (const rel of discovery.manifests.nuget.filter((r) => r.endsWith('Directory.Packages.props'))) {
  for (const r of parseNuget(rel).refs) if (r.version) centralVersions[r.name.toLowerCase()] = r.version;
}
for (const rel of discovery.manifests.nuget.filter((r) => !r.endsWith('Directory.Packages.props'))) {
  const { refs, targetFrameworks } = parseNuget(rel);
  const project = { path: rel, targetFrameworks, deps: refs.map((r) => ({ name: r.name, installed: r.version || centralVersions[r.name.toLowerCase()] || null, kind: 'prod' })), cli: {}, notes: [] };
  if (dotnetAvailable && rel.endsWith('proj')) {
    for (const flag of ['--outdated', '--deprecated', '--vulnerable']) {
      const r = run('dotnet', ['list', join(p.root, rel), 'package', flag, '--format', 'json', ...(args.transitive ? ['--include-transitive'] : [])], p.root);
      const j = tryJson(r.stdout);
      if (j) project.cli[flag.slice(2)] = j;
      else project.notes.push(`dotnet list package ${flag} failed (try \`dotnet restore\` first): ${(r.stderr || r.stdout || r.error || '').split('\n').find(Boolean) || ''}`);
    }
  } else if (!dotnetAvailable) project.notes.push('dotnet not on PATH: using the NuGet API only (no transitive or local-feed data).');
  nugetProjects.push(project);
}

// Where each project actually restores from: NuGet.config chain, MSBuild restore properties, env, dotnet CLI.
const nugetContexts = nugetProjects.map((proj) => resolveProject({ root: p.root, rel: proj.path, dotnet: dotnetAvailable ? (a, cwd) => run('dotnet', a, cwd, 60_000) : null }));
const nugetFindings = await checkNuget(nugetContexts, { root: p.root, offline: !!args.offline, depsByProject: Object.fromEntries(nugetProjects.map((pr) => [pr.path, pr.deps])) });
const contextOf = Object.fromEntries(nugetContexts.map((c) => [c.project, c]));

// Flatten the dotnet CLI JSON into { name -> {latest, deprecation, vulnerabilities} }
const cliFacts = {};
for (const proj of nugetProjects) {
  for (const [flag, j] of Object.entries(proj.cli)) {
    for (const pr of j.projects || []) for (const fw of pr.frameworks || []) for (const pkg of [...(fw.topLevelPackages || []), ...(args.transitive ? fw.transitivePackages || [] : [])]) {
      const f = (cliFacts[pkg.id.toLowerCase()] ||= {});
      if (flag === 'outdated' && pkg.latestVersion) f.latest = pkg.latestVersion;
      if (flag === 'deprecated') f.deprecation = { reasons: pkg.deprecationReasons || [], alternative: pkg.alternativePackage || null };
      if (flag === 'vulnerable' && pkg.vulnerabilities) f.vulnerabilities = pkg.vulnerabilities;
    }
  }
}

// ---------- Registry + health enrichment ----------
const ghRepo = (url) => { const m = String(url || '').match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?]|$)/i); return m ? `github.com/${m[1]}/${m[2]}` : null; };

async function npmFacts(name, installed) {
  const enc = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const latest = await cachedJson(`https://registry.npmjs.org/${enc}/latest`, p.cacheDir);
  const facts = { registryReachable: latest.status > 0 };
  if (latest.status === 404) { facts.missing = true; return facts; }
  const lj = latest.json || {};
  facts.latest = lj.version || null;
  facts.deprecatedLatest = lj.deprecated || null;
  facts.repo = ghRepo(lj.repository?.url || lj.repository || lj.homepage);
  if (installed && installed !== facts.latest) {
    const v = await cachedJson(`https://registry.npmjs.org/${enc}/${encodeURIComponent(installed)}`, p.cacheDir, { ttlHours: 24 * 7 });
    facts.deprecatedInstalled = v.json?.deprecated || null;
  } else facts.deprecatedInstalled = facts.deprecatedLatest;
  return facts;
}

async function nugetFacts(name, installed) {
  const id = name.toLowerCase();
  const idx = await cachedJson(`https://api.nuget.org/v3/registration5-gz-semver2/${id}/index.json`, p.cacheDir);
  const facts = { registryReachable: idx.status > 0 };
  if (idx.status === 404) { facts.missing = true; return facts; }
  if (!idx.json) return facts;
  const pages = idx.json.items || [];
  const norm = (v) => String(v || '').toLowerCase().replace(/^(\d+\.\d+)$/, '$1.0').replace(/\+.*$/, '');
  const want = norm(installed);
  let latestEntry = null; let installedEntry = null;
  for (let i = 0; i < pages.length; i++) {
    // Big packages split versions across pages; fetch them (cached) so both installed and latest are found.
    if (!pages[i].items) {
      const pg = await cachedJson(pages[i]['@id'], p.cacheDir);
      pages[i].items = pg.json?.items || [];
    }
    for (const leaf of pages[i].items || []) {
      const ce = leaf.catalogEntry || {};
      if (ce.listed !== false && !/-/.test(ce.version || '')) latestEntry = ce;
      if (want && norm(ce.version) === want) installedEntry = ce;
    }
  }
  facts.latest = latestEntry?.version || null;
  facts.latestPublished = latestEntry?.published && !latestEntry.published.startsWith('1900') ? latestEntry.published : null;
  facts.deprecatedInstalled = installedEntry?.deprecation ? [installedEntry.deprecation.reasons?.join(', '), installedEntry.deprecation.message].filter(Boolean).join(': ') || 'deprecated' : null;
  facts.deprecatedLatest = latestEntry?.deprecation ? [latestEntry.deprecation.reasons?.join(', '), latestEntry.deprecation.message].filter(Boolean).join(': ') || 'deprecated' : null;
  facts.alternative = (installedEntry || latestEntry)?.deprecation?.alternatePackage?.id || null;
  facts.vulnerabilities = (installedEntry?.vulnerabilities || []).map((v) => ({ severity: ['low', 'moderate', 'high', 'critical'][Number(v.severity)] || v.severity, url: v.advisoryUrl }));
  facts.repo = ghRepo(latestEntry?.projectUrl || installedEntry?.projectUrl);
  return facts;
}

async function healthFacts(ecosystem, name, version, repo) {
  const out = {};
  const reg = ecosystem === 'npm' ? 'npmjs.org' : 'nuget.org';
  const eco = await cachedJson(`https://packages.ecosyste.ms/api/v1/registries/${reg}/packages/${encodeURIComponent(name)}`, p.cacheDir);
  if (eco.json) {
    const j = eco.json;
    out.ecosystemsStatus = j.status || null; // e.g. "deprecated", "removed", "unpublished"
    out.latestRelease = j.latest_release_published_at || null;
    out.maintainers = Array.isArray(j.maintainers) ? j.maintainers.length : j.maintainers_count ?? null;
    out.dependentRepos = j.dependent_repos_count ?? null;
    out.downloads = j.downloads ?? null;
    out.archived = j.repo_metadata?.archived ?? null;
    out.pushedAt = j.repo_metadata?.pushed_at || null;
    out.repo ||= ghRepo(j.repository_url);
  }
  out.ecosystemsReachable = eco.status > 0;
  const sys = ecosystem === 'npm' ? 'npm' : 'nuget';
  let projectKey = repo || out.repo;
  if (version) {
    const dv = await cachedJson(`https://api.deps.dev/v3/systems/${sys}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`, p.cacheDir, { ttlHours: 24 * 7 });
    if (dv.json) {
      out.publishedAt = dv.json.publishedAt || null;
      const src = (dv.json.relatedProjects || []).find((r) => r.relationType === 'SOURCE_REPO');
      if (src?.projectKey?.id) projectKey = src.projectKey.id;
    }
    out.depsDevReachable = dv.status > 0;
  }
  if (projectKey) {
    const pj = await cachedJson(`https://api.deps.dev/v3/projects/${encodeURIComponent(projectKey)}`, p.cacheDir);
    const sc = pj.json?.scorecard;
    if (sc) {
      out.scorecard = sc.overallScore ?? null;
      out.scorecardDate = sc.date || null;
      out.maintainedCheck = (sc.checks || []).find((c) => c.name === 'Maintained')?.score ?? null;
    }
    if (pj.json?.openIssuesCount !== undefined) out.openIssues = Number(pj.json.openIssuesCount);
  }
  out.repo = projectKey || null;
  return out;
}

// ---------- Verdict ----------
const ignoreList = manifest.packages?.ignore || [];
function ignoreFor(eco, name) {
  const e = ignoreList.find((i) => i.name?.toLowerCase() === name.toLowerCase() && (!i.ecosystem || i.ecosystem === eco));
  if (!e) return null;
  const expired = e.expires && new Date(e.expires) < new Date();
  return { ...e, expired };
}
const majorOf = (v) => Number(String(v || '').replace(/^[^\d]*/, '').split('.')[0]);

function verdict(pkg) {
  const reasons = []; let level = 'green';
  const bump = (l) => { const order = { green: 0, info: 1, amber: 2, red: 3 }; if (order[l] > order[level]) level = l; };
  const f = pkg.facts || {}; const h = pkg.health || {};
  let privateFeed = false;
  if (f.missing && pkg.privateFeeds?.length) { privateFeed = true; reasons.push(`not on nuget.org; restored from ${pkg.privateFeeds.join(', ')}, which registry and health checks do not cover`); }
  else if (f.missing) { bump('red'); reasons.push('not found on the public registry (unpublished, renamed or private feed)'); }
  if (f.deprecatedInstalled) { bump('red'); reasons.push(`installed version deprecated: ${f.deprecatedInstalled}`); }
  else if (f.deprecatedLatest) { bump('red'); reasons.push(`package deprecated: ${f.deprecatedLatest}`); }
  if (f.alternative) reasons.push(`suggested replacement: ${f.alternative}`);
  if (['deprecated', 'removed', 'unpublished', 'archived'].includes(String(h.ecosystemsStatus))) { bump('red'); reasons.push(`ecosyste.ms status: ${h.ecosystemsStatus}`); }
  if (h.archived === true) { bump('red'); reasons.push(`source repo archived (${h.repo || 'unknown repo'})`); }
  const lastRelease = f.latestPublished || h.latestRelease || null;
  const relDays = daysSince(lastRelease); const pushDays = daysSince(h.pushedAt);
  if (relDays !== null && relDays > thresholds.staleMonths * 30 && (pushDays === null || pushDays > thresholds.staleMonths * 30)) {
    bump('red'); reasons.push(`no release in ${Math.round(relDays / 30)} months${pushDays !== null ? `, no commits in ${Math.round(pushDays / 30)} months` : ''}`);
  } else if (relDays !== null && relDays > thresholds.quietMonths * 30) {
    bump('amber'); reasons.push(`no release in ${Math.round(relDays / 30)} months${pushDays !== null ? ` (last commit ${Math.round(pushDays / 30)} months ago)` : ''}`);
  }
  if (h.maintainedCheck !== null && h.maintainedCheck !== undefined && h.maintainedCheck >= 0 && h.maintainedCheck <= 2) { bump('amber'); reasons.push(`OpenSSF Scorecard "Maintained" = ${h.maintainedCheck}/10`); }
  if (h.maintainers === 1) reasons.push('single maintainer (bus factor 1)');
  for (const v of pkg.vulnerabilities || []) {
    if (['high', 'critical'].includes(v.severity)) bump('red'); else bump('amber');
  }
  if (pkg.vulnerabilities?.length) reasons.push(`${pkg.vulnerabilities.length} known vulnerabilit${pkg.vulnerabilities.length === 1 ? 'y' : 'ies'} (${[...new Set(pkg.vulnerabilities.map((v) => v.severity))].join(', ')})`);
  const behind = f.latest && pkg.installed ? majorOf(f.latest) - majorOf(pkg.installed) : 0;
  if (behind >= 2) { bump('amber'); reasons.push(`${behind} major versions behind (${pkg.installed} → ${f.latest})`); }
  else if (behind === 1) { bump('info'); reasons.push(`1 major behind (${pkg.installed} → ${f.latest})`); }
  else if (f.latest && pkg.installed && f.latest !== pkg.installed) { bump('info'); reasons.push(`update available (${pkg.installed} → ${f.latest})`); }
  if (privateFeed && level === 'green') level = 'unknown';
  if (!f.registryReachable && !h.ecosystemsReachable) { if (level === 'green') level = 'unknown'; reasons.push('registry and health APIs unreachable from this machine'); }
  const ig = ignoreFor(pkg.ecosystem, pkg.name);
  if (ig && !ig.expired && level !== 'red') return { level: 'ignored', reasons: [`ignored: ${ig.reason}${ig.expires ? ` (until ${ig.expires})` : ''}`, ...reasons] };
  if (ig && !ig.expired && level === 'red') reasons.unshift(`on ignore list (${ig.reason}), but ignores never hide red findings — re-evaluate`);
  if (ig?.expired) reasons.unshift(`ignore entry expired ${ig.expires} — re-evaluate`);
  return { level, reasons };
}

// ---------- Assemble ----------
const unique = new Map(); // key eco:name -> package record
for (const proj of npmProjects) for (const d of proj.deps) {
  const key = `npm:${d.name}`;
  const rec = unique.get(key) || { ecosystem: 'npm', name: d.name, installed: d.installed, ranges: [], kinds: [], projects: [], vulnerabilities: [] };
  rec.projects.push(proj.path); if (!rec.ranges.includes(d.range)) rec.ranges.push(d.range); if (!rec.kinds.includes(d.kind)) rec.kinds.push(d.kind);
  rec.installed ||= d.installed;
  const vul = proj.audit?.vulnerabilities?.find((v) => v.name === d.name);
  if (vul) rec.vulnerabilities.push({ severity: vul.severity, fixAvailable: vul.fixAvailable, via: vul.via });
  const od = proj.outdated?.[d.name];
  if (od) rec.npmOutdated = { current: od.current, wanted: od.wanted, latest: od.latest };
  unique.set(key, rec);
}
for (const proj of nugetProjects) for (const d of proj.deps) {
  const key = `nuget:${d.name.toLowerCase()}`;
  const rec = unique.get(key) || { ecosystem: 'nuget', name: d.name, installed: d.installed, ranges: [], kinds: ['prod'], projects: [], vulnerabilities: [] };
  rec.projects.push(proj.path);
  if (d.installed && !rec.ranges.includes(d.installed)) rec.ranges.push(d.installed);
  const cf = cliFacts[d.name.toLowerCase()];
  if (cf?.vulnerabilities) rec.vulnerabilities.push(...cf.vulnerabilities.map((v) => ({ severity: String(v.severity).toLowerCase(), url: v.advisoryurl })));
  rec.cli = cf || null;
  // Feeds this package can come from, per the project's own NuGet config (not an assumed nuget.org).
  const feeds = contextOf[proj.path] ? candidateSources(contextOf[proj.path], d.name) : [];
  rec.privateFeeds = [...new Set([...(rec.privateFeeds || []), ...feeds.filter((s) => !isNugetOrg(s)).map((s) => s.name)])];
  unique.set(key, rec);
}

const list = [...unique.values()];
log(`Checking ${list.length} direct packages (${list.filter((x) => x.ecosystem === 'npm').length} npm, ${list.filter((x) => x.ecosystem === 'nuget').length} NuGet)${enrich ? ' with health enrichment' : ''}…`);
await mapLimit(list, 8, async (pkg) => {
  try {
    if (!args.offline) pkg.facts = pkg.ecosystem === 'npm' ? await npmFacts(pkg.name, pkg.installed) : await nugetFacts(pkg.name, pkg.installed);
    else pkg.facts = {};
    if (pkg.cli?.latest) pkg.facts.latest ||= pkg.cli.latest;
    if (pkg.cli?.deprecation && !pkg.facts.deprecatedInstalled) pkg.facts.deprecatedInstalled = pkg.cli.deprecation.reasons.join(', ') || 'deprecated';
    if (pkg.cli?.deprecation?.alternative) pkg.facts.alternative ||= pkg.cli.deprecation.alternative.id || String(pkg.cli.deprecation.alternative);
    if (pkg.npmOutdated?.latest) pkg.facts.latest ||= pkg.npmOutdated.latest;
    if (pkg.ecosystem === 'nuget' && pkg.facts.vulnerabilities?.length && !pkg.vulnerabilities.length) pkg.vulnerabilities.push(...pkg.facts.vulnerabilities);
    pkg.health = enrich ? await healthFacts(pkg.ecosystem, pkg.name, pkg.installed, pkg.facts.repo) : {};
  } catch (err) { errors.push(`${pkg.ecosystem}:${pkg.name}: ${err.message}`); pkg.facts ||= {}; pkg.health ||= {}; }
  Object.assign(pkg, { verdict: verdict(pkg) });
});

const order = { red: 0, amber: 1, unknown: 2, info: 3, ignored: 4, green: 5 };
list.sort((a, b) => order[a.verdict.level] - order[b.verdict.level] || a.name.localeCompare(b.name));
const reachability = {
  npmRegistry: list.some((x) => x.ecosystem === 'npm' && x.facts?.registryReachable),
  nugetApi: list.some((x) => x.ecosystem === 'nuget' && x.facts?.registryReachable),
  ecosystems: list.some((x) => x.health?.ecosystemsReachable),
  depsDev: list.some((x) => x.health?.depsDevReachable),
};

const out = {
  generatedAt: nowIso(),
  tools: { npm: npmAvailable, dotnet: dotnetAvailable },
  reachability,
  npmProjects: npmProjects.map(({ deps, outdated, ...rest }) => ({ ...rest, depCount: deps.length })),
  nugetProjects: nugetProjects.map(({ deps, cli, ...rest }) => ({ ...rest, depCount: deps.length })),
  packages: list.map(({ cli, ...rest }) => rest),
  nuget: { contexts: nugetContexts, findings: nugetFindings },
  errors,
};
writeJson(join(p.runDir, 'packages.json'), out);

const count = (l) => list.filter((x) => x.verdict.level === l).length;
log(`Done: ${count('red')} red, ${count('amber')} amber, ${count('unknown')} unknown, ${count('info')} info, ${count('green')} green, ${count('ignored')} ignored.`);
log(`Reachability: ${Object.entries(reachability).map(([k, v]) => `${k}=${v ? 'ok' : 'NO'}`).join(', ')}`);
for (const x of list.filter((x) => x.verdict.level === 'red' || x.verdict.level === 'amber').slice(0, 30)) log(`  [${x.verdict.level}] ${x.ecosystem} ${x.name}@${x.installed || '?'} — ${x.verdict.reasons.join('; ')}`);
if (nugetFindings.length) log(`NuGet sources and folders: ${['red', 'amber', 'unknown', 'info', 'green'].map((l) => `${nugetFindings.filter((x) => x.level === l).length} ${l}`).join(', ')}`);
for (const x of nugetFindings.filter((x) => x.level === 'red' || x.level === 'amber')) log(`  [${x.level}] ${x.title} — ${x.reasons.join('; ')}`);
for (const pr of [...npmProjects, ...nugetProjects]) for (const n of pr.notes) log(`  note (${pr.path}): ${n}`);
log(`→ ${relative(p.root, p.runDir)}/packages.json`);
