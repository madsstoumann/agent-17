#!/usr/bin/env node
// Phase 1: npm + NuGet packages — outdated, vulnerable, deprecated, "is anyone still maintaining this?",
// plus the whole installed tree: vulnerable transitive packages and every package's licence.
// Usage: node packages.mjs [--root <dir>] [--transitive] [--no-enrich] [--offline]
// Reads .solution-health/run/discovery.json (run discover.mjs first). Writes run/packages.json.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { parseArgs, paths, readJson, writeJson, cachedJson, mapLimit, daysSince, loadManifest, ensureDirs, log, nowIso, showPath } from './lib.mjs';
import { resolveProject, checkNuget, candidateSources, isNugetOrg } from './nuget.mjs';
import { npmInventory, nugetInventory, normalizeLicense, licenseFromUrl, licenseVerdict, projectLicense, classify, inNugetRange, CATEGORIES } from './licenses.mjs';
import { msbuildProperties, expandMsbuild, nodeMajor, isNewer } from './versions.mjs';

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
  project.inventory = npmInventory(dir, { lock, directNames: new Set(deps.map((d) => d.name)) });
  project.lockPkgs = Object.fromEntries(Object.entries(lock?.packages || {}).filter(([k]) => k).map(([k, v]) => [k, { version: v.version, dev: !!(v.dev || v.devOptional) }]));
  if (!project.inventory.length && deps.length) project.notes.push('No package-lock.json and no node_modules: transitive licences not checked (run `npm install`, or `npm ci`, first).');
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
            name: v.name, severity: v.severity, isDirect: v.isDirect, range: v.range, fixAvailable: v.fixAvailable, effects: v.effects || [], nodes: v.nodes || [],
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
const centralFile = {};
// Versions can come from MSBuild properties (Version="$(UmbracoAppLocalIcuVersion)"): resolve them from the
// Directory.Build.props chain, Directory.Packages.props and the project, as MSBuild would.
const resolveVersion = (version, rel) => {
  if (!version || !/\$\(/.test(version)) return { version };
  const { props } = msbuildProperties(p.root, rel);
  const { value, unresolved } = expandMsbuild(version, props);
  return unresolved.length ? { version: null, expr: version } : { version: value, expr: version };
};
const centralExpr = {};
for (const rel of discovery.manifests.nuget.filter((r) => r.endsWith('Directory.Packages.props'))) {
  for (const r of parseNuget(rel).refs) if (r.version) {
    const v = resolveVersion(r.version, rel); const k = r.name.toLowerCase();
    centralVersions[k] = v.version; centralFile[k] = rel; if (v.expr) centralExpr[k] = v.expr;
  }
}
for (const rel of discovery.manifests.nuget.filter((r) => !r.endsWith('Directory.Packages.props'))) {
  const { refs, targetFrameworks } = parseNuget(rel);
  const project = { path: rel, targetFrameworks, deps: refs.map((r) => {
    const k = r.name.toLowerCase(); const v = resolveVersion(r.version, rel);
    return { name: r.name, installed: r.version ? v.version : centralVersions[k] || null, versionExpr: r.version ? v.expr : centralExpr[k], kind: 'prod', centralFile: r.version ? null : centralFile[k] || null };
  }), cli: {}, notes: [] };
  if (dotnetAvailable && rel.endsWith('proj')) {
    for (const flag of ['--outdated', '--deprecated', '--vulnerable']) {
      // Vulnerabilities are checked through the whole tree: a vulnerable transitive package ships just the same.
      const r = run('dotnet', ['list', join(p.root, rel), 'package', flag, '--format', 'json', ...(args.transitive || flag === '--vulnerable' ? ['--include-transitive'] : [])], p.root);
      const j = tryJson(r.stdout);
      if (j) project.cli[flag.slice(2)] = j;
      else project.notes.push(`dotnet list package ${flag} failed (try \`dotnet restore\` first): ${(r.stderr || r.stdout || r.error || '').split('\n').find(Boolean) || ''}`);
    }
  } else if (!dotnetAvailable) project.notes.push('dotnet not on PATH: using the NuGet API only (no transitive or local-feed data).');
  if (rel.endsWith('proj')) {
    const inv = nugetInventory(join(p.root, rel));
    if (inv) {
      project.inventory = inv.packages; project.packageFolders = inv.folders;
      // A version MSBuild could not resolve here (a property set inside a package's build files) is still
      // in what restore recorded.
      for (const d of project.deps) if (!d.installed && d.versionExpr) {
        const hit = inv.packages.find((x) => x.direct && x.name.toLowerCase() === d.name.toLowerCase());
        if (hit) { d.installed = hit.version; d.versionFrom = 'obj/project.assets.json'; }
      }
    }
    else project.notes.push('Not restored (no obj/project.assets.json): transitive packages and licences not checked; run `dotnet restore` first.');
  }
  nugetProjects.push(project);
}

// Where each project actually restores from: NuGet.config chain, MSBuild restore properties, env, dotnet CLI.
const nugetContexts = nugetProjects.map((proj) => resolveProject({ root: p.root, rel: proj.path, dotnet: dotnetAvailable ? (a, cwd) => run('dotnet', a, cwd, 60_000) : null }));
const nugetFindings = await checkNuget(nugetContexts, { root: p.root, offline: !!args.offline, depsByProject: Object.fromEntries(nugetProjects.map((pr) => [pr.path, pr.deps])) });
const contextOf = Object.fromEntries(nugetContexts.map((c) => [c.project, c]));

// Flatten the dotnet CLI JSON into { name -> {latest, deprecation, vulnerabilities} }
const cliFacts = {};
const cliTransitiveVulns = []; // { project, name, version, vulnerabilities }
for (const proj of nugetProjects) {
  for (const [flag, j] of Object.entries(proj.cli)) {
    for (const pr of j.projects || []) for (const fw of pr.frameworks || []) {
      if (flag === 'vulnerable') for (const pkg of fw.transitivePackages || []) if (pkg.vulnerabilities?.length) cliTransitiveVulns.push({ project: proj.path, name: pkg.id, version: pkg.resolvedVersion, vulnerabilities: pkg.vulnerabilities });
    }
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
  facts.license = normalizeLicense(lj.license ?? lj.licenses);
  if (installed && installed !== facts.latest) {
    const v = await cachedJson(`https://registry.npmjs.org/${enc}/${encodeURIComponent(installed)}`, p.cacheDir, { ttlHours: 24 * 7 });
    facts.deprecatedInstalled = v.json?.deprecated || null;
    if (v.json) facts.license = normalizeLicense(v.json.license ?? v.json.licenses);
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
  const le = installedEntry || latestEntry;
  facts.license = le?.licenseExpression || licenseFromUrl(le?.licenseUrl) || (le?.licenseUrl && !/nuget\.org\/packages\/.*\/license/i.test(le.licenseUrl) ? le.licenseUrl : null);
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
      if (dv.json.licenses?.length) out.licenses = dv.json.licenses;
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
  const redWhy = []; // what made it red: 'stale' (no release and no commits) or 'other'
  const bump = (l, why = 'other') => { const order = { green: 0, info: 1, amber: 2, red: 3 }; if (l === 'red') redWhy.push(why); if (order[l] > order[level]) level = l; };
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
    bump('red', 'stale'); reasons.push(`no release in ${Math.round(relDays / 30)} months${pushDays !== null ? `, no commits in ${Math.round(pushDays / 30)} months` : ''}`);
  } else if (relDays !== null && relDays > thresholds.quietMonths * 30) {
    // Quiet on its own is nothing to act on when the newest release is what is installed: a watch item.
    bump(isNewer(f.latest, pkg.installed) ? 'amber' : 'info');
    reasons.push(`no release in ${Math.round(relDays / 30)} months${pushDays !== null ? ` (last commit ${Math.round(pushDays / 30)} months ago)` : ''}`);
  }
  if (h.maintainedCheck !== null && h.maintainedCheck !== undefined && h.maintainedCheck >= 0 && h.maintainedCheck <= 2) { bump('amber'); reasons.push(`OpenSSF Scorecard "Maintained" = ${h.maintainedCheck}/10`); }
  if (h.maintainers === 1) reasons.push('single maintainer (bus factor 1)');
  for (const v of pkg.vulnerabilities || []) {
    if (['high', 'critical'].includes(v.severity)) bump('red'); else bump('amber');
  }
  if (pkg.vulnerabilities?.length) reasons.push(`${pkg.vulnerabilities.length} known vulnerabilit${pkg.vulnerabilities.length === 1 ? 'y' : 'ies'} (${[...new Set(pkg.vulnerabilities.map((v) => v.severity))].join(', ')})`);
  if (pkg.versionExpr && !pkg.installed) reasons.push(`version is ${pkg.versionExpr}, an MSBuild property not set in the solution's own files (likely set by a package's build props); restore the project so the restored version can be read`);
  else if (pkg.versionExpr) reasons.push(`version ${pkg.installed} from ${pkg.versionExpr}${pkg.versionFrom ? ` (read from ${pkg.versionFrom})` : ''}`);
  if (f.pinnedTo) {
    reasons.push(`kept to Node ${f.pinnedTo.major}, the runtime the project pins (${f.pinnedTo.source})${f.latestOverall ? `; ${f.latestOverall} is for a newer Node` : ''}`);
    if (majorOf(pkg.installed) > f.pinnedTo.major) { bump('info'); reasons.push(`installed ${pkg.installed} describes a newer Node than ${f.pinnedTo.major}: APIs it types may not exist at runtime`); }
  }
  const behind = f.latest && pkg.installed ? majorOf(f.latest) - majorOf(pkg.installed) : 0;
  if (behind >= 2) { bump('amber'); reasons.push(`${behind} major versions behind (${pkg.installed} → ${f.latest})`); }
  else if (behind === 1) { bump('info'); reasons.push(`1 major behind (${pkg.installed} → ${f.latest})`); }
  else if (isNewer(f.latest, pkg.installed)) { bump('info'); reasons.push(`update available (${pkg.installed} → ${f.latest})`); }
  if (privateFeed && level === 'green') level = 'unknown';
  if (!f.registryReachable && !h.ecosystemsReachable) { if (level === 'green') level = 'unknown'; reasons.push('registry and health APIs unreachable from this machine'); }
  const ig = ignoreFor(pkg.ecosystem, pkg.name);
  // A finished, small package is red only because nobody releases it. An ignore entry with a reason
  // and an expiry may hide that; it never hides deprecation, archiving, vulnerabilities or a missing package.
  const staleOnly = level === 'red' && redWhy.length > 0 && redWhy.every((w) => w === 'stale');
  if (ig && !ig.expired && staleOnly && ig.reason && ig.expires) return { level: 'ignored', reasons: [`ignored: ${ig.reason} (until ${ig.expires}); red only for staleness`, ...reasons] };
  if (ig && !ig.expired && staleOnly) reasons.unshift(`on ignore list, but hiding a stale red needs both a reason and an expiry date`);
  if (ig && !ig.expired && level !== 'red') return { level: 'ignored', reasons: [`ignored: ${ig.reason}${ig.expires ? ` (until ${ig.expires})` : ''}`, ...reasons] };
  if (ig && !ig.expired && level === 'red' && !staleOnly) reasons.unshift(`on ignore list (${ig.reason}), but ignores never hide deprecated, archived, missing or vulnerable packages — re-evaluate`);
  if (ig?.expired) reasons.unshift(`ignore entry expired ${ig.expires} — re-evaluate`);
  return { level, reasons };
}

// ---------- Assemble ----------
const unique = new Map(); // key eco:name -> package record
for (const proj of npmProjects) for (const d of proj.deps) {
  const key = `npm:${d.name}`;
  const rec = unique.get(key) || { ecosystem: 'npm', name: d.name, installed: d.installed, ranges: [], kinds: [], projects: [], vulnerabilities: [] };
  rec.projects.push(proj.path); if (!rec.ranges.includes(d.range)) rec.ranges.push(d.range); if (!rec.kinds.includes(d.kind)) rec.kinds.push(d.kind);
  rec.files = [...new Set([...(rec.files || []), proj.path, ...(proj.hasLockfile && existsSync(join(p.root, dirname(proj.path), 'package-lock.json')) ? [join(dirname(proj.path), 'package-lock.json').replace(/\\/g, '/')] : [])])];
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
  rec.installed ||= d.installed;
  if (d.versionExpr) rec.versionExpr ||= d.versionExpr;
  if (d.versionFrom) rec.versionFrom ||= d.versionFrom;
  rec.projects.push(proj.path);
  rec.files = [...new Set([...(rec.files || []), d.centralFile || proj.path])];
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
// @types/node follows the Node the project runs on, not the newest Node.
const runtimeNode = nodeMajor({ root: p.root, runtimePins: discovery.runtimePins, npmManifests: discovery.manifests.npm });
function pinTypesNode(pkg) {
  if (pkg.ecosystem !== 'npm' || pkg.name !== '@types/node' || !runtimeNode) return;
  const f = pkg.facts;
  f.pinnedTo = runtimeNode;
  if (!f.latest || majorOf(f.latest) <= runtimeNode.major) return;
  f.latestOverall = f.latest;
  f.latest = null;
  if (npmAvailable && !args.offline) {
    const r = run('npm', ['view', `@types/node@${runtimeNode.major}`, 'version', '--json'], p.root, 60_000);
    const v = tryJson(r.stdout) ?? (r.stdout.trim().replace(/^"|"$/g, '') || null);
    f.latest = (Array.isArray(v) ? v[v.length - 1] : v) || null;
  }
  if (!f.latest && majorOf(pkg.installed) === runtimeNode.major) f.latest = pkg.installed;
}
log(`Checking ${list.length} direct packages (${list.filter((x) => x.ecosystem === 'npm').length} npm, ${list.filter((x) => x.ecosystem === 'nuget').length} NuGet)${enrich ? ' with health enrichment' : ''}…`);
await mapLimit(list, 8, async (pkg) => {
  try {
    if (!args.offline) pkg.facts = pkg.ecosystem === 'npm' ? await npmFacts(pkg.name, pkg.installed) : await nugetFacts(pkg.name, pkg.installed);
    else pkg.facts = {};
    if (pkg.cli?.latest) pkg.facts.latest ||= pkg.cli.latest;
    if (pkg.cli?.deprecation && !pkg.facts.deprecatedInstalled) pkg.facts.deprecatedInstalled = pkg.cli.deprecation.reasons.join(', ') || 'deprecated';
    if (pkg.cli?.deprecation?.alternative) pkg.facts.alternative ||= pkg.cli.deprecation.alternative.id || String(pkg.cli.deprecation.alternative);
    if (pkg.npmOutdated?.latest) pkg.facts.latest ||= pkg.npmOutdated.latest;
    pinTypesNode(pkg);
    if (pkg.ecosystem === 'nuget' && pkg.facts.vulnerabilities?.length && !pkg.vulnerabilities.length) pkg.vulnerabilities.push(...pkg.facts.vulnerabilities);
    pkg.health = enrich ? await healthFacts(pkg.ecosystem, pkg.name, pkg.installed, pkg.facts.repo) : {};
  } catch (err) { errors.push(`${pkg.ecosystem}:${pkg.name}: ${err.message}`); pkg.facts ||= {}; pkg.health ||= {}; }
  Object.assign(pkg, { verdict: verdict(pkg) });
});

const order = { red: 0, amber: 1, unknown: 2, info: 3, ignored: 4, green: 5 };
list.sort((a, b) => order[a.verdict.level] - order[b.verdict.level] || a.name.localeCompare(b.name));

// ---------- Vulnerable transitive packages ----------
// Direct packages carry their own vulnerabilities above. These are the ones further down the tree, which
// ship just the same: npm audit (whole tree), `dotnet list package --vulnerable --include-transitive`,
// and, when the SDK is missing, NuGet's own vulnerability database matched against obj/project.assets.json.
const SEV = ['low', 'moderate', 'high', 'critical'];
const directKeys = new Set(list.map((x) => `${x.ecosystem}:${x.name.toLowerCase()}`));
const transitive = new Map();
const addTransitive = (eco, name, rec) => {
  const key = `${eco}:${name.toLowerCase()}`;
  if (directKeys.has(key)) return;
  const t = transitive.get(key) || { ecosystem: eco, name, versions: [], severity: 'low', advisories: [], parents: [], projects: [], fixes: [], devOnly: true };
  for (const v of rec.versions || []) if (v && !t.versions.includes(v)) t.versions.push(v);
  if (SEV.indexOf(rec.severity) > SEV.indexOf(t.severity)) t.severity = rec.severity;
  for (const a of rec.advisories || []) if (!t.advisories.some((x) => x.url === a.url)) t.advisories.push(a);
  for (const x of rec.parents || []) if (!t.parents.includes(x)) t.parents.push(x);
  if (!t.projects.includes(rec.project)) t.projects.push(rec.project);
  if (rec.fix && !t.fixes.includes(rec.fix)) t.fixes.push(rec.fix);
  t.devOnly &&= !!rec.dev;
  transitive.set(key, t);
};
for (const proj of npmProjects) {
  const vulns = Object.fromEntries((proj.audit?.vulnerabilities || []).map((v) => [v.name, v]));
  const directParents = (v) => {
    const seen = new Set(); const found = new Set(); const queue = [...(v.effects || [])];
    while (queue.length) { const n = queue.shift(); if (seen.has(n)) continue; seen.add(n); const e = vulns[n]; if (!e || e.isDirect) found.add(n); if (e && !e.isDirect) queue.push(...(e.effects || [])); }
    return [...found];
  };
  for (const v of Object.values(vulns)) {
    if (v.isDirect) continue;
    const fa = v.fixAvailable;
    const fix = fa === true ? '`npm audit fix` resolves it' : fa && typeof fa === 'object' ? `upgrade ${fa.name} to ${fa.version}${fa.isSemVerMajor ? ' (semver major)' : ''}` : 'no fix released yet: add an `overrides` entry once one is, or replace the package that pulls it in';
    addTransitive('npm', v.name, {
      project: proj.path, severity: v.severity, parents: directParents(v), fix,
      versions: (v.nodes || []).map((n) => proj.lockPkgs?.[n]?.version).filter(Boolean),
      advisories: (v.via || []).filter((x) => typeof x === 'object').map((x) => ({ title: x.title, url: x.url, severity: x.severity })),
      dev: (v.nodes || []).length > 0 && v.nodes.every((n) => proj.lockPkgs?.[n]?.dev),
    });
  }
}
const nugetParents = (proj, name) => proj.inventory?.find((i) => i.name.toLowerCase() === name.toLowerCase())?.parents || [];
for (const t of cliTransitiveVulns) {
  const proj = nugetProjects.find((x) => x.path === t.project);
  addTransitive('nuget', t.name, {
    project: t.project, versions: [t.version], parents: nugetParents(proj, t.name),
    severity: t.vulnerabilities.map((v) => String(v.severity).toLowerCase()).reduce((a, b) => (SEV.indexOf(b) > SEV.indexOf(a) ? b : a), 'low'),
    advisories: t.vulnerabilities.map((v) => ({ url: v.advisoryurl, severity: String(v.severity).toLowerCase() })),
    fix: 'add a direct PackageReference to a fixed version, or upgrade the package that pulls it in',
  });
}
let nugetVulnDb = null;
const restored = nugetProjects.filter((x) => x.inventory && !Object.keys(x.cli).includes('vulnerable'));
if (restored.length && !args.offline) {
  // NuGet's vulnerability database: an index naming a base file and an update file, both { id: [{ url, severity, versions }] }.
  const idx = await cachedJson('https://api.nuget.org/v3/vulnerabilities/index.json', p.cacheDir, { ttlHours: 12 });
  if (Array.isArray(idx.json)) {
    nugetVulnDb = {};
    for (const part of idx.json) {
      const r = await cachedJson(part['@id'], p.cacheDir, { ttlHours: 24 * 30, timeoutMs: 60_000 });
      for (const [id, list] of Object.entries(r.json || {})) (nugetVulnDb[id.toLowerCase()] ||= []).push(...list);
    }
  }
  for (const proj of restored) for (const pkg of proj.inventory) {
    if (pkg.direct) continue;
    const hits = (nugetVulnDb?.[pkg.name.toLowerCase()] || []).filter((v) => inNugetRange(pkg.version, v.versions));
    if (!hits.length) continue;
    addTransitive('nuget', pkg.name, {
      project: proj.path, versions: [pkg.version], parents: pkg.parents,
      severity: hits.map((v) => SEV[Number(v.severity)] || 'low').reduce((a, b) => (SEV.indexOf(b) > SEV.indexOf(a) ? b : a), 'low'),
      advisories: hits.map((v) => ({ url: v.url, severity: SEV[Number(v.severity)] || String(v.severity), range: v.versions })),
      fix: 'add a direct PackageReference to a fixed version, or upgrade the package that pulls it in',
    });
  }
}
for (const t of transitive.values()) {
  let level = ['high', 'critical'].includes(t.severity) ? 'red' : t.severity === 'moderate' ? 'amber' : 'info';
  const reasons = [`${t.advisories.length || 1} known vulnerabilit${t.advisories.length === 1 ? 'y' : 'ies'} (${t.severity})${t.versions.length ? ` in ${t.versions.join(', ')}` : ''}`];
  reasons.push(t.parents.length ? `pulled in by ${t.parents.join(', ')}` : 'pulled in transitively');
  if (t.ecosystem === 'npm' && t.devOnly) { level = level === 'red' ? 'amber' : 'info'; reasons.push('dev dependency only (build tooling, not shipped)'); }
  if (t.fixes.length) reasons.push(`fix: ${t.fixes.join('; ')}`);
  t.verdict = { level, reasons };
}
const transitiveVulns = [...transitive.values()].sort((a, b) => ({ red: 0, amber: 1, info: 2 })[a.verdict.level] - ({ red: 0, amber: 1, info: 2 })[b.verdict.level] || a.name.localeCompare(b.name));

// ---------- Licences ----------
// Every installed or locked package, direct and transitive, judged against the solution's own licence.
const licensePolicy = manifest.licenses || {};
const ownLicense = projectLicense({ manifest, root: p.root, npmManifests: discovery.manifests.npm, nugetManifests: discovery.manifests.nuget.filter((r) => r.endsWith('proj')) });
const lic = new Map();
const addLicense = (eco, rec, proj) => {
  const key = `${eco}:${rec.name.toLowerCase()}`;
  const l = lic.get(key) || { ecosystem: eco, name: rec.name, versions: [], licenses: [], direct: false, dev: true, projects: [], from: [], parents: [] };
  if (rec.version && !l.versions.includes(rec.version)) l.versions.push(rec.version);
  const norm = normalizeLicense(rec.license);
  if (!l.licenses.includes(norm)) l.licenses.push(norm);
  l.direct ||= !!rec.direct; l.dev &&= !!rec.dev;
  if (!l.projects.includes(proj)) l.projects.push(proj);
  if (rec.from && !l.from.includes(rec.from)) l.from.push(rec.from);
  for (const x of rec.parents || []) if (!l.parents.includes(x)) l.parents.push(x);
  lic.set(key, l);
};
for (const proj of npmProjects) for (const i of proj.inventory || []) addLicense('npm', i, proj.path);
for (const proj of nugetProjects) for (const i of proj.inventory || []) addLicense('nuget', i, proj.path);
// Direct packages that are not installed or restored here: fall back to the registry's answer.
for (const x of list) {
  const key = `${x.ecosystem}:${x.name.toLowerCase()}`;
  const have = lic.get(key);
  const fromRegistry = x.facts?.license || (x.health?.licenses?.length ? x.health.licenses.join(' AND ') : null);
  if (have && have.licenses.some(Boolean)) { have.direct = true; have.dev = have.dev && !x.kinds?.includes('prod') && !x.kinds?.includes('optional'); continue; }
  if (have) { have.licenses = [normalizeLicense(fromRegistry)]; if (fromRegistry || x.facts?.registryReachable) have.from.push('registry'); have.direct = true; continue; }
  addLicense(x.ecosystem, { name: x.name, version: x.installed, license: fromRegistry, direct: true, dev: x.kinds?.length && x.kinds.every((k) => k === 'dev'), from: fromRegistry ? 'registry' : null }, x.projects[0]);
  if (x.projects.length > 1) lic.get(key).projects.push(...x.projects.slice(1));
}
const licenseList = [...lic.values()];
for (const l of licenseList) {
  // Versions with different licences: judge the most restrictive one.
  const worst = l.licenses.map((x) => ({ x, c: classify(x).category })).sort((a, b) => CATEGORIES.indexOf(b.c) - CATEGORIES.indexOf(a.c))[0];
  l.license = worst?.x ?? null;
  l.verdict = licenseVerdict({ ecosystem: l.ecosystem, name: l.name, license: l.license, dev: l.dev, direct: l.direct, unread: l.from.length > 0 && l.from.every((x) => x === 'not on disk') }, { policy: licensePolicy, project: ownLicense });
  if (l.licenses.length > 1) l.verdict.reasons.push(`licence differs between versions: ${l.licenses.map((x) => x || 'none').join(', ')}`);
  if (!l.direct && l.parents.length) l.verdict.reasons.push(`pulled in by ${l.parents.join(', ')}`);
}
const licLevel = { red: 0, amber: 1, info: 2, ignored: 3, green: 4 };
licenseList.sort((a, b) => licLevel[a.verdict.level] - licLevel[b.verdict.level] || a.name.localeCompare(b.name));
const licenseCounts = {};
for (const l of licenseList) { const k = l.license || 'none'; licenseCounts[k] = (licenseCounts[k] || 0) + 1; }
const reachability = {
  npmRegistry: list.some((x) => x.ecosystem === 'npm' && x.facts?.registryReachable),
  nugetApi: list.some((x) => x.ecosystem === 'nuget' && x.facts?.registryReachable),
  ecosystems: list.some((x) => x.health?.ecosystemsReachable),
  depsDev: list.some((x) => x.health?.depsDevReachable),
  nugetVulnDb: nugetVulnDb ? true : restored.length && !args.offline ? false : null,
};

const out = {
  generatedAt: nowIso(),
  tools: { npm: npmAvailable, dotnet: dotnetAvailable },
  reachability,
  npmProjects: npmProjects.map(({ deps, outdated, inventory, lockPkgs, ...rest }) => ({ ...rest, depCount: deps.length, installedCount: inventory?.length ?? null })),
  nugetProjects: nugetProjects.map(({ deps, cli, inventory, ...rest }) => ({ ...rest, depCount: deps.length, installedCount: inventory?.length ?? null })),
  packages: list.map(({ cli, ...rest }) => rest),
  transitiveVulns,
  licenses: { project: ownLicense, policy: licensePolicy, counts: licenseCounts, packages: licenseList },
  nuget: { contexts: nugetContexts, findings: nugetFindings },
  errors,
};
writeJson(join(p.runDir, 'packages.json'), out);

const count = (l) => list.filter((x) => x.verdict.level === l).length;
log(`Done: ${count('red')} red, ${count('amber')} amber, ${count('unknown')} unknown, ${count('info')} info, ${count('green')} green, ${count('ignored')} ignored.`);
log(`Reachability: ${Object.entries(reachability).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v ? 'ok' : 'NO'}`).join(', ')}`);
for (const x of list.filter((x) => x.verdict.level === 'red' || x.verdict.level === 'amber').slice(0, 30)) log(`  [${x.verdict.level}] ${x.ecosystem} ${x.name}@${x.installed || '?'} — ${x.verdict.reasons.join('; ')}`);
if (nugetFindings.length) log(`NuGet sources and folders: ${['red', 'amber', 'unknown', 'info', 'green'].map((l) => `${nugetFindings.filter((x) => x.level === l).length} ${l}`).join(', ')}`);
for (const x of nugetFindings.filter((x) => x.level === 'red' || x.level === 'amber')) log(`  [${x.level}] ${x.title} — ${x.reasons.join('; ')}`);
if (transitiveVulns.length) log(`Vulnerable transitive packages: ${transitiveVulns.length} (${transitiveVulns.filter((x) => x.verdict.level === 'red').length} red)`);
for (const x of transitiveVulns.filter((x) => x.verdict.level !== 'info').slice(0, 20)) log(`  [${x.verdict.level}] ${x.ecosystem} ${x.name} — ${x.verdict.reasons.join('; ')}`);
const licFlag = licenseList.filter((x) => ['red', 'amber'].includes(x.verdict.level));
log(`Licences: ${licenseList.length} packages (${licenseList.filter((x) => x.direct).length} direct), project licence ${ownLicense.id} (${ownLicense.from}); ${licFlag.length} flagged.`);
for (const x of licFlag.slice(0, 20)) log(`  [${x.verdict.level}] ${x.ecosystem} ${x.name} (${x.license || 'none'}) — ${x.verdict.reasons.join('; ')}`);
for (const pr of [...npmProjects, ...nugetProjects]) for (const n of pr.notes) log(`  note (${pr.path}): ${n}`);
log(`→ ${showPath(p, p.runDir)}/packages.json`);
