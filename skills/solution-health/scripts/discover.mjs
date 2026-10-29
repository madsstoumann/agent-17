#!/usr/bin/env node
// Phase 0: find dependency manifests, runtime pins and outbound hostnames in the solution.
// Usage: node discover.mjs [--root <solution root>]
// Writes .solution-health/run/discovery.json and prints a short summary.
import { readFileSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';
import { parseArgs, paths, walk, ext, fileSize, writeJson, loadManifest, ensureDirs, log, nowIso } from './lib.mjs';

const args = parseArgs();
const p = paths(args);
ensureDirs(p);
const manifest = loadManifest(p) || { apis: [], hostsIgnore: [] };

const SCAN_EXT = new Set(['.json', '.config', '.cs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro',
  '.razor', '.cshtml', '.yml', '.yaml', '.xml', '.ps1', '.php', '.py', '.toml', '.ini', '.properties', '.html', '.liquid', '.twig']);
const SKIP_FILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|.*\.min\.(js|css)|.*\.map|.*\.d\.ts|.*\.designer\.cs|.*\.g\.cs|launchSettings\.json|nuget\.config|tsconfig.*\.json|.*\.snap)$/i;

// Hosts that are documentation, schema namespaces, package registries or local. Not runtime integrations.
const NOISE_HOSTS = [
  /^localhost$/, /^127\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/, /(^|\.)example\.(com|org|net)$/, /(^|\.)test$/, /(^|\.)local$/, /(^|\.)internal$/,
  /(^|\.)w3\.org$/, /(^|\.)schema\.org$/, /(^|\.)schemas\.(microsoft|openxmlformats|xmlsoap|android)\.(com|org)$/, /(^|\.)xmlsoap\.org$/,
  /(^|\.)json-schema\.org$/, /(^|\.)schemastore\.org$/, /(^|\.)purl\.org$/, /(^|\.)ietf\.org$/, /(^|\.)rfc-editor\.org$/,
  /(^|\.)npmjs\.(com|org)$/, /(^|\.)nuget\.org$/, /(^|\.)yarnpkg\.com$/, /(^|\.)github\.com$/, /(^|\.)githubusercontent\.com$/,
  /(^|\.)gitlab\.com$/, /(^|\.)bitbucket\.org$/, /(^|\.)stackoverflow\.com$/, /(^|\.)developer\.mozilla\.org$/, /(^|\.)mdn\.io$/,
  /(^|\.)learn\.microsoft\.com$/, /(^|\.)docs\.microsoft\.com$/, /(^|\.)go\.microsoft\.com$/, /(^|\.)aka\.ms$/, /(^|\.)msdn\.microsoft\.com$/,
  /(^|\.)opensource\.org$/, /(^|\.)apache\.org$/, /(^|\.)creativecommons\.org$/, /(^|\.)mit-license\.org$/, /(^|\.)semver\.org$/,
  /(^|\.)typescriptlang\.org$/, /(^|\.)nextjs\.org$/, /(^|\.)reactjs\.org$/, /(^|\.)react\.dev$/, /(^|\.)vuejs\.org$/, /(^|\.)eslint\.org$/,
  /(^|\.)prettier\.io$/, /(^|\.)jestjs\.io$/, /(^|\.)vitest\.dev$/, /(^|\.)webpack\.js\.org$/, /(^|\.)babeljs\.io$/, /(^|\.)tailwindcss\.com$/,
  /(^|\.)our\.umbraco\.com$/, /(^|\.)docs\.umbraco\.com$/, /(^|\.)wikipedia\.org$/, /(^|\.)shields\.io$/,
];

const isNoise = (host) => NOISE_HOSTS.some((re) => re.test(host));
const ignoreHosts = new Set((manifest.hostsIgnore || []).map((h) => h.toLowerCase()));
const trackedHosts = new Map();
for (const api of manifest.apis || []) for (const h of api.hosts || []) trackedHosts.set(h.toLowerCase(), api.name);

const URL_RE = /\bhttps?:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::\d+)?(\/[^\s"'`<>)\]{}\\,;]*)?/gi;
const API_HINT = /(^|\.)(api|apis|gateway|services?|ws|rest|graphql|auth|login|sso|oauth|token|cdn|assets|media|search|geo)[.-]|\/(api|v\d+|graphql|rest|services?|oauth|token)(\/|$)/i;
const KEY_HINT = /(base_?url|baseaddress|endpoint|api_?url|host|uri|url|domain|webhook|callback|authority|issuer)/i;

const out = {
  generatedAt: nowIso(),
  root: p.root,
  manifests: { npm: [], nuget: [], nugetConfig: [], other: [] },
  runtimePins: [],
  hosts: {},
};

let scanned = 0;
for (const file of walk(p.root)) {
  const rel = relative(p.root, file).split('\\').join('/');
  const name = basename(file);
  const e = ext(file);

  // Dependency manifests
  if (name === 'package.json') out.manifests.npm.push(rel);
  else if (e === '.csproj' || e === '.fsproj' || e === '.vbproj') out.manifests.nuget.push(rel);
  else if (name === 'Directory.Packages.props' || name === 'packages.config') out.manifests.nuget.push(rel);
  else if (name.toLowerCase() === 'nuget.config') out.manifests.nugetConfig.push(rel); // feeds are checked by packages.mjs, not as API hosts
  else if (['composer.json', 'requirements.txt', 'pyproject.toml', 'Gemfile', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'bower.json'].includes(name)) out.manifests.other.push(rel);

  // Runtime pins
  if (['.nvmrc', '.node-version', 'global.json', '.tool-versions', 'Dockerfile', 'docker-compose.yml', 'azure-pipelines.yml', 'vercel.json', 'netlify.toml'].includes(name) || /\.github\/workflows\/.+\.ya?ml$/.test(rel)) {
    out.runtimePins.push(rel);
  }

  // Hostname scan
  const isEnv = name.startsWith('.env') || name.startsWith('appsettings') || name === 'web.config';
  if (!(isEnv || SCAN_EXT.has(e)) || SKIP_FILES.test(rel) || fileSize(file) > 1_000_000) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  scanned++;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue; // minified or data blobs
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(line))) {
      const host = m[1].toLowerCase().replace(/\.$/, '');
      if (!/\.[a-z]{2,}$/.test(host) || isNoise(host)) continue;
      const h = (out.hosts[host] ||= { host, refs: 0, files: [], samples: [], likelyApi: false, configKey: false, tracked: trackedHosts.get(host) || null, ignored: ignoreHosts.has(host) });
      h.refs++;
      if (!h.files.includes(rel)) h.files.push(rel);
      const url = m[0].replace(/[.)]+$/, '');
      if (h.samples.length < 5 && !h.samples.includes(url)) h.samples.push(url);
      if (API_HINT.test(url)) h.likelyApi = true;
      if (isEnv || KEY_HINT.test(line.slice(0, m.index))) h.configKey = true;
    }
  }
}

// Classify hosts
const hosts = Object.values(out.hosts).map((h) => ({ ...h, files: h.files.slice(0, 20), fileCount: h.files.length }));
for (const h of hosts) {
  h.status = h.tracked ? 'tracked' : h.ignored ? 'ignored' : 'untracked';
  h.priority = h.likelyApi || h.configKey ? 'high' : 'low';
}
hosts.sort((a, b) => (a.status === 'untracked' ? 0 : 1) - (b.status === 'untracked' ? 0 : 1) || (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || b.fileCount - a.fileCount);
out.hosts = hosts;
out.filesScanned = scanned;

// Tracked APIs whose hosts no longer appear anywhere in code
out.trackedApisNotSeen = (manifest.apis || []).filter((api) => !(api.hosts || []).some((h) => hosts.find((x) => x.host === h.toLowerCase()))).map((a) => a.name);

writeJson(`${p.runDir}/discovery.json`, out);

const untracked = hosts.filter((h) => h.status === 'untracked');
log(`Scanned ${scanned} files under ${p.root}`);
log(`npm manifests: ${out.manifests.npm.length}, NuGet manifests: ${out.manifests.nuget.length}${out.manifests.nugetConfig.length ? ` (config: ${out.manifests.nugetConfig.join(', ')})` : ''}, other: ${out.manifests.other.join(', ') || 'none'}`);
log(`Runtime pins: ${out.runtimePins.join(', ') || 'none'}`);
log(`Hosts: ${hosts.length} total, ${hosts.filter((h) => h.status === 'tracked').length} tracked, ${untracked.length} untracked (${untracked.filter((h) => h.priority === 'high').length} look like APIs/config)`);
for (const h of untracked.slice(0, 25)) log(`  [${h.priority}] ${h.host}  (${h.fileCount} files, e.g. ${h.files[0]})`);
if (out.trackedApisNotSeen.length) log(`Tracked APIs no longer referenced in code: ${out.trackedApisNotSeen.join(', ')}`);
log(`→ ${relative(p.root, p.runDir)}/discovery.json`);
void dirname;
