// NuGet configuration as the solution itself sees it: which NuGet.config files apply, which package sources
// and folders they resolve to, and whether those actually exist. Used by packages.mjs; no default is assumed
// unless nothing in the solution, the environment or the user config says otherwise.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { safeFetch } from './lib.mjs';

const isWin = process.platform === 'win32';
const NUGET_ORG = /^https?:\/\/(api|www)\.nuget\.org\//i;
const isUrl = (v) => /^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^file:/i.test(v);
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const isDir = (d) => { try { return statSync(d).isDirectory(); } catch { return false; } };
const unxml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')); return m ? unxml(m[1]) : null; };
const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const section = (text, name) => { const m = text.match(new RegExp(`<${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${name}>)`, 'i')); return m ? (m[1] ?? '') : null; };
const items = (body) => [...body.matchAll(/<(add|clear|remove)\b([^>]*?)\/?>/gi)].map((m) => ({ op: m[1].toLowerCase(), key: attr(m[2], 'key'), value: attr(m[2], 'value'), protocolVersion: attr(m[2], 'protocolVersion') }));

// %VAR% (NuGet.config) and $(VAR) (MSBuild, env vars are visible as properties). Returns { value, unresolved[] }.
function expand(value, env, msbuild = {}) {
  const unresolved = [];
  const envGet = (n) => env[n] ?? (isWin ? Object.entries(env).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] : undefined);
  let v = String(value).replace(/%([^%\s]+)%/g, (all, n) => envGet(n) ?? (unresolved.push(`%${n}%`), all));
  v = v.replace(/\$\(([^)]+)\)/g, (all, n) => msbuild[n.toLowerCase()] ?? envGet(n) ?? (unresolved.push(`$(${n})`), all));
  return { value: v, unresolved };
}

// Turns a config value into { url } or { path }, resolving relative paths against the file that set them.
function locate(raw, baseDir, env, msbuild) {
  const { value, unresolved } = expand(raw.trim(), env, msbuild);
  if (isUrl(value)) return { raw, url: value, unresolved };
  let v = value.replace(/^file:\/\/\/?/i, isWin ? '' : '/');
  const winOnly = !isWin && (/^[a-z]:[\\/]/i.test(v) || /^\\\\/.test(v));
  if (!isWin && !winOnly) v = v.replace(/\\/g, '/');
  if (!isWin && v.startsWith('~/')) v = join(homedir(), v.slice(2));
  return { raw, path: winOnly ? v : isAbsolute(v) ? v : resolve(baseDir, v), unresolved, winOnly };
}

// NuGet.config files that apply to a directory, furthest first: user config, then every folder from the drive root down.
function configChain(dir, env) {
  const chain = [];
  const user = isWin ? join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'NuGet', 'NuGet.Config') : join(homedir(), '.nuget', 'NuGet', 'NuGet.Config');
  if (read(user) !== null) chain.push({ file: user, scope: 'user' });
  const tree = [];
  for (let d = resolve(dir); ; d = dirname(d)) {
    let names = [];
    try { names = readdirSync(d); } catch { /* unreadable */ }
    const hit = names.find((n) => n.toLowerCase() === 'nuget.config');
    if (hit) tree.unshift({ file: join(d, hit), scope: 'solution' });
    if (dirname(d) === d) break;
  }
  return [...chain, ...tree];
}

function parseConfig(file) {
  const text = stripComments(read(file) || '');
  const pick = (name) => { const s = section(text, name); return s === null ? null : items(s); };
  const mapping = [];
  const ms = section(text, 'packageSourceMapping');
  if (ms !== null) {
    if (/<clear\b/i.test(ms)) mapping.push({ clear: true });
    for (const m of ms.matchAll(/<packageSource\b([^>]*)>([\s\S]*?)<\/packageSource>/gi)) {
      const key = attr(m[1], 'key');
      for (const pm of m[2].matchAll(/<package\b([^>]*?)\/?>/gi)) { const pattern = attr(pm[1], 'pattern'); if (key && pattern) mapping.push({ source: key, pattern }); }
    }
  }
  const creds = section(text, 'packageSourceCredentials') || '';
  return { sources: pick('packageSources'), disabled: pick('disabledPackageSources'), config: pick('config'), fallback: pick('fallbackPackageFolders'), mapping, creds };
}

// MSBuild restore properties from the nearest Directory.Build.props and the project file (project wins).
function msbuildRestore(projectFile, solutionDir, env) {
  const files = [];
  for (let d = dirname(projectFile); ; d = dirname(d)) {
    const f = join(d, 'Directory.Build.props');
    if (read(f) !== null) { files.push(f); break; }
    if (dirname(d) === d) break;
  }
  if (/proj$/i.test(projectFile)) files.push(projectFile);
  const props = {};
  for (const f of files) {
    const text = stripComments(read(f) || '');
    const vars = { msbuildthisfiledirectory: dirname(f) + '/', msbuildprojectdirectory: dirname(projectFile), solutiondir: solutionDir ? solutionDir + '/' : undefined };
    for (const name of ['RestorePackagesPath', 'RestoreSources', 'RestoreAdditionalProjectSources', 'RestoreFallbackFolders', 'RestoreConfigFile']) {
      const m = text.match(new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`, 'i'));
      if (m && m[1].trim()) props[name] = { raw: unxml(m[1].trim()), file: f, vars };
    }
  }
  return props;
}

function findSolutionDir(dir, root) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    let names = [];
    try { names = readdirSync(d); } catch { /* unreadable */ }
    if (names.some((n) => /\.slnx?$/i.test(n))) return d;
    if (d === root || dirname(d) === d) return null;
  }
}

// Package source mapping: exact pattern beats prefix (Foo.*), longer prefix beats shorter, '*' matches all.
function mappedSources(mapping, id) {
  const lid = id.toLowerCase(); let best = -1; let hits = [];
  for (const m of mapping) {
    const pat = m.pattern.toLowerCase();
    const score = pat === lid ? 100000 : pat.endsWith('*') && lid.startsWith(pat.slice(0, -1)) ? pat.length : -1;
    if (score > best) { best = score; hits = [m.source]; } else if (score === best && score >= 0) hits.push(m.source);
  }
  return best < 0 ? [] : [...new Set(hits)];
}

// Resolves the effective NuGet settings for one project (a *.csproj or a packages.config).
export function resolveProject({ root, rel, env = process.env, dotnet = null }) {
  const projectFile = join(root, rel);
  const projectDir = dirname(projectFile);
  const style = /packages\.config$/i.test(rel) ? 'packages.config' : 'PackageReference';
  const solutionDir = findSolutionDir(projectDir, root);
  const props = msbuildRestore(projectFile, solutionDir, env);
  const at = (p) => locate(p.raw, dirname(p.file), env, p.vars);
  const issues = [];

  let chain;
  if (props.RestoreConfigFile) {
    const loc = at(props.RestoreConfigFile);
    chain = loc.path && read(loc.path) !== null ? [{ file: loc.path, scope: 'RestoreConfigFile' }] : [];
    if (!chain.length) issues.push({ level: 'red', subject: 'RestoreConfigFile', reason: `RestoreConfigFile points to a file that does not exist: ${loc.path || loc.raw} (set in ${relative(root, props.RestoreConfigFile.file)})` });
  } else chain = configChain(projectDir, env);

  // Merge, furthest first; a <clear/> drops everything inherited so far.
  const sources = new Map(); const disabled = new Set(); const config = {}; let fallback = []; let mapping = []; let cleared = false;
  for (const { file, scope } of chain) {
    const c = parseConfig(file); const base = dirname(file);
    for (const it of c.sources || []) {
      if (it.op === 'clear') { sources.clear(); cleared = true; }
      else if (it.op === 'remove' && it.key) sources.delete(it.key.toLowerCase());
      else if (it.op === 'add' && it.key && it.value) sources.set(it.key.toLowerCase(), { name: it.key, ...locate(it.value, base, env), protocolVersion: it.protocolVersion, from: file, scope, credentials: new RegExp(`<${it.key.replace(/ /g, '_x0020_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(c.creds) });
    }
    for (const it of c.disabled || []) {
      if (it.op === 'clear') disabled.clear();
      else if (it.key && String(it.value).toLowerCase() === 'true') disabled.add(it.key.toLowerCase());
      else if (it.key) disabled.delete(it.key.toLowerCase());
    }
    for (const it of c.config || []) if (it.op === 'add' && it.key && it.value !== null) config[it.key.toLowerCase()] = { value: it.value, from: file, scope, base };
    for (const it of c.fallback || []) {
      if (it.op === 'clear') fallback = [];
      else if (it.op === 'add' && it.value) fallback.push({ name: it.key, ...locate(it.value, base, env), from: `fallbackPackageFolders in ${display(root, file)}`, scope });
    }
    for (const m of c.mapping) { if (m.clear) mapping = []; else mapping.push(m); }
  }

  let sourceList = [...sources.values()].map((s) => ({ ...s, enabled: !disabled.has(s.name.toLowerCase()) }));
  let sourcesFrom = 'NuGet.config';
  if (props.RestoreSources) {
    sourceList = props.RestoreSources.raw.split(';').map((s) => s.trim()).filter(Boolean).map((s) => ({ name: s, ...at({ ...props.RestoreSources, raw: s }), from: props.RestoreSources.file, scope: 'msbuild', enabled: true }));
    sourcesFrom = 'RestoreSources';
  }
  if (props.RestoreAdditionalProjectSources) {
    for (const s of props.RestoreAdditionalProjectSources.raw.split(';').map((x) => x.trim()).filter(Boolean)) sourceList.push({ name: s, ...at({ ...props.RestoreAdditionalProjectSources, raw: s }), from: props.RestoreAdditionalProjectSources.file, scope: 'msbuild', enabled: true });
  }
  if (!sourceList.length && !cleared && !props.RestoreSources && !chain.some((c) => c.scope === 'user')) {
    // No config anywhere: the SDK writes a user config with nuget.org on first use, so that is what restore gets.
    sourceList.push({ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', unresolved: [], from: null, scope: 'implicit', enabled: true, protocolVersion: '3' });
    sourcesFrom = 'implicit default';
  }

  // Global packages folder: RestorePackagesPath > NUGET_PACKAGES > globalPackagesFolder > default.
  let gpf;
  if (props.RestorePackagesPath) gpf = { ...at(props.RestorePackagesPath), from: `RestorePackagesPath in ${relative(root, props.RestorePackagesPath.file)}`, configured: true };
  else if (env.NUGET_PACKAGES) gpf = { ...locate(env.NUGET_PACKAGES, process.cwd(), env), from: 'NUGET_PACKAGES environment variable', configured: true };
  else if (config.globalpackagesfolder) gpf = { ...locate(config.globalpackagesfolder.value, config.globalpackagesfolder.base, env), from: `globalPackagesFolder in ${display(root, config.globalpackagesfolder.from)}`, configured: true };
  else gpf = { path: join(isWin ? env.USERPROFILE || homedir() : homedir(), '.nuget', 'packages'), unresolved: [], from: 'NuGet default', configured: false };
  if (dotnet && !props.RestorePackagesPath) {
    const r = dotnet(['nuget', 'locals', 'global-packages', '--list'], projectDir);
    const m = (r.stdout || '').match(/global-packages:\s*(.+)/i);
    if (m) {
      const cli = m[1].trim().replace(/[\\/]+$/, '');
      if (gpf.path && resolve(cli) !== resolve(gpf.path.replace(/[\\/]+$/, ''))) issues.push({ level: 'info', subject: 'global packages folder', reason: `dotnet reports ${cli}, config files suggest ${gpf.path}; using dotnet's answer` });
      gpf = { ...gpf, path: cli, from: `${gpf.from} (confirmed by \`dotnet nuget locals\`)` };
    }
  }

  if (props.RestoreFallbackFolders) fallback = props.RestoreFallbackFolders.raw.split(';').map((s) => s.trim()).filter(Boolean).map((s) => ({ ...at({ ...props.RestoreFallbackFolders, raw: s }), from: `RestoreFallbackFolders in ${relative(root, props.RestoreFallbackFolders.file)}`, scope: 'msbuild' }));

  // packages.config projects restore into repositoryPath, by default <solution dir>/packages.
  let repositoryPath = null;
  if (style === 'packages.config') {
    if (config.repositorypath) repositoryPath = { ...locate(config.repositorypath.value, config.repositorypath.base, env), from: `repositoryPath in ${display(root, config.repositorypath.from)}`, configured: true };
    else repositoryPath = { path: join(solutionDir || dirname(projectDir), 'packages'), unresolved: [], from: solutionDir ? 'NuGet default (<solution dir>/packages)' : 'NuGet default (no .sln found; assumed parent folder)', configured: false };
  }

  if (dotnet && !props.RestoreSources) {
    const r = dotnet(['nuget', 'list', 'source', '--format', 'detailed'], projectDir);
    const cliNames = [...(r.stdout || '').matchAll(/^\s*\d+\.\s+(.+?)\s+\[(Enabled|Disabled)\]/gim)].filter((m) => m[2] === 'Enabled').map((m) => m[1].trim().toLowerCase());
    const ours = sourceList.filter((s) => s.enabled && s.scope !== 'msbuild' && s.scope !== 'implicit').map((s) => s.name.toLowerCase());
    if (cliNames.length && (cliNames.length !== ours.length || cliNames.some((n) => !ours.includes(n)))) issues.push({ level: 'info', subject: 'package sources', reason: `\`dotnet nuget list source\` reports ${cliNames.join(', ')}; config files resolve to ${ours.join(', ') || 'none'}` });
  }

  return {
    project: rel, style, solutionDir: solutionDir ? relative(root, solutionDir) || '.' : null,
    configFiles: chain.map((c) => ({ file: display(root, c.file), scope: c.scope })),
    sourcesFrom, sources: sourceList, globalPackagesFolder: style === 'PackageReference' ? gpf : null, fallbackFolders: fallback, repositoryPath, mapping, issues,
  };
}

// Paths inside the solution are shown relative to it, others with ~ for the home folder.
const display = (root, f) => { if (!f) return null; const r = relative(root, f); return r.startsWith('..') || isAbsolute(r) ? f.replace(homedir(), '~') : r || '.'; };

// Feeds a package can be restored from, honouring source mapping when the solution uses it.
export function candidateSources(ctx, id) {
  const enabled = ctx.sources.filter((s) => s.enabled);
  if (!ctx.mapping.length) return enabled;
  const keys = mappedSources(ctx.mapping, id).map((k) => k.toLowerCase());
  return enabled.filter((s) => keys.includes(s.name.toLowerCase()));
}
export const isNugetOrg = (s) => !!s.url && NUGET_ORG.test(s.url);

// Probes each distinct source and folder once, then turns everything into findings with stable keys.
export async function checkNuget(contexts, { root, offline = false, depsByProject = {} } = {}) {
  const findings = [];
  const add = (key, level, title, reasons, where) => {
    const f = findings.find((x) => x.key === key);
    if (f) { for (const w of where) if (!f.where.includes(w)) f.where.push(w); return; }
    findings.push({ key, level, title, reasons, where: [...where] });
  };
  const probes = new Map();
  async function probe(url) {
    if (!probes.has(url)) probes.set(url, safeFetch(url, { json: /index\.json$/i.test(url), timeoutMs: 15_000 }));
    return probes.get(url);
  }

  for (const ctx of contexts) {
    const where = [ctx.project];
    for (const i of ctx.issues) add(`nuget:${i.subject}:${i.reason}`, i.level, i.subject, [i.reason], where);
    const enabled = ctx.sources.filter((s) => s.enabled);
    if (!enabled.length) add(`nuget:no-sources:${ctx.project}`, 'red', 'No NuGet package sources', [`every source is cleared or disabled for this project (${ctx.configFiles.map((c) => c.file).join(', ') || 'no NuGet.config'}); restore cannot download anything`], where);

    for (const s of ctx.sources) {
      const label = s.url || display(root, s.path);
      const key = `nuget:source:${label.toLowerCase()}`;
      const title = `NuGet source ${s.name}`;
      const from = s.scope === 'implicit' ? 'implicit default: no NuGet.config sets any source' : `from ${display(root, s.from)}`;
      if (!s.enabled) { add(key, 'info', title, [`${label} is disabled (${from})`], where); continue; }
      const reasons = [`${label} (${from})`]; let level = 'green';
      const bump = (l) => { const o = { green: 0, info: 1, unknown: 1, amber: 2, red: 3 }; if (o[l] > o[level]) level = l; };
      if (s.unresolved?.length) { bump('amber'); reasons.push(`uses ${s.unresolved.join(', ')}, which is not set on this machine`); }
      if (s.scope === 'user') { bump('info'); reasons.push('only in the user-level NuGet.Config on this machine, not in the repo: other devs and CI may not have it'); }
      if (s.unresolved?.length) reasons.push('cannot be checked until the variable is set');
      else if (s.path) {
        if (s.winOnly) { bump('amber'); reasons.push('absolute Windows path; cannot exist on this OS, so the solution only restores on Windows'); }
        else if (!isDir(s.path)) { bump('red'); reasons.push('local folder does not exist (restore fails with NU1301)'); }
        else reasons.push('local folder exists');
      } else if (s.url) {
        if (/^http:/i.test(s.url)) { bump('amber'); reasons.push('plain http source (NU1803 warning; newer SDKs refuse it)'); }
        if (offline) { bump('unknown'); reasons.push('not probed (--offline)'); }
        else {
          const r = await probe(s.url);
          if (r.status >= 200 && r.status < 300) {
            if (/index\.json$/i.test(s.url) && !Array.isArray(r.json?.resources)) { bump('amber'); reasons.push(`responds ${r.status} but is not a NuGet v3 service index`); }
            else reasons.push(`reachable (${r.status})`);
          } else if (r.status === 401 || r.status === 403) { bump('info'); reasons.push(`requires authentication (${r.status})${s.credentials ? '; credentials are configured in NuGet.config' : '; relies on a credential provider or user-level credentials'}`); }
          else if (r.status === 404 || r.status === 410) { bump('red'); reasons.push(`returns ${r.status}: the feed URL is wrong or the feed was removed`); }
          else if (r.status === 0) { bump('amber'); reasons.push(`unreachable from this machine (${r.error})`); }
          else { bump('amber'); reasons.push(`returns ${r.status}`); }
        }
      }
      add(key, level, title, reasons, where);
    }

    const folder = (kind, f, restoreCheck) => {
      if (!f) return;
      const key = `nuget:${kind}:${String(f.path).toLowerCase()}`;
      const reasons = [`${f.winOnly ? f.path : display(root, f.path)} (${f.from})`]; let level = 'green';
      if (f.unresolved?.length) { level = 'amber'; reasons.push(`uses ${f.unresolved.join(', ')}, which is not set on this machine`); }
      if (f.unresolved?.length) reasons.push('cannot be checked until the variable is set');
      else if (f.winOnly) { level = 'amber'; reasons.push('absolute Windows path; cannot exist on this OS'); }
      else if (!isDir(f.path)) {
        if (kind === 'fallback') { level = 'amber'; reasons.push('folder does not exist, so NuGet cannot use it (restore does not create fallback folders)'); }
        else if (f.configured) { level = 'amber'; reasons.push('configured folder does not exist yet: run `dotnet restore`, or fix the path if it is wrong'); }
        else { level = 'info'; reasons.push('does not exist on this machine (nothing restored yet)'); }
      } else if (restoreCheck) {
        const deps = depsByProject[ctx.project] || [];
        const missing = deps.filter((d) => d.installed && !restoreCheck(f.path, d));
        if (deps.length) reasons.push(`${deps.length - missing.length}/${deps.length} direct packages restored there`);
        if (missing.length) { level = level === 'green' ? 'info' : level; reasons.push(`not restored: ${missing.slice(0, 5).map((d) => `${d.name} ${d.installed}`).join(', ')}${missing.length > 5 ? ` +${missing.length - 5} more` : ''}`); }
      }
      add(key, level, kind === 'gpf' ? 'NuGet global packages folder' : kind === 'repo' ? 'NuGet packages folder (packages.config)' : 'NuGet fallback folder', reasons, where);
    };
    const exact = /^\d+(\.\d+){1,3}(-[\w.]+)?$/;
    folder('gpf', ctx.globalPackagesFolder, (dir, d) => !exact.test(d.installed) || isDir(join(dir, d.name.toLowerCase(), d.installed.toLowerCase())));
    folder('repo', ctx.repositoryPath, (dir, d) => !exact.test(d.installed) || isDir(join(dir, `${d.name}.${d.installed}`)));
    for (const fb of ctx.fallbackFolders) folder('fallback', { ...fb, configured: true });

    if (ctx.mapping.length) {
      for (const d of depsByProject[ctx.project] || []) {
        if (!candidateSources(ctx, d.name).length) add(`nuget:unmapped:${d.name.toLowerCase()}`, 'red', `${d.name} has no package source`, ['packageSourceMapping matches no enabled source for this package; restore fails with NU1100'], where);
      }
    }
    if (enabled.length && !enabled.some(isNugetOrg)) add('nuget:no-nugetorg', 'info', 'nuget.org is not a package source', ['packages are restored from private feeds only; registry checks use nuget.org metadata for packages that also exist there (normal for feeds that mirror nuget.org)'], where);
  }
  return findings;
}
