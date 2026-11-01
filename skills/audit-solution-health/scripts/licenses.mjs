// Licence inventory and policy for npm and NuGet packages, direct and transitive. Zero dependencies.
// The inventory comes from what is installed or locked (package-lock.json, node_modules, obj/project.assets.json
// and the .nuspec files in the package folders it names), so it covers the whole tree without a network call.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ---------- Classification ----------
// Categories, least to most restrictive. An OR expression takes the least restrictive choice, AND the most.
export const CATEGORIES = ['permissive', 'vendor', 'weak-copyleft', 'strong-copyleft', 'network-copyleft', 'restricted', 'proprietary', 'unknown'];
const IDS = {
  permissive: ['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'BSD-4-Clause', 'BSD', '0BSD', 'Apache-2.0', 'Apache-1.1', 'Zlib', 'Unlicense', 'CC0-1.0', 'WTFPL',
    'BlueOak-1.0.0', 'Python-2.0', 'PSF-2.0', 'BSL-1.0', 'Artistic-2.0', 'CC-BY-3.0', 'CC-BY-4.0', 'X11', 'PostgreSQL', 'MS-PL', 'NCSA', 'AFL-2.1', 'AFL-3.0', 'UPL-1.0',
    'Unicode-DFS-2015', 'Unicode-DFS-2016', 'Unicode-3.0', 'Unicode-TOU', 'ICU', 'OFL-1.1', 'Public-Domain', 'LicenseRef-MS-NET-Library'],
  'weak-copyleft': ['LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'LGPL', 'MPL-1.0', 'MPL-1.1', 'MPL-2.0', 'EPL-1.0', 'EPL-2.0', 'CDDL-1.0', 'CDDL-1.1', 'MS-RL', 'CPL-1.0'],
  'strong-copyleft': ['GPL-2.0', 'GPL-3.0', 'GPL', 'EUPL-1.1', 'EUPL-1.2', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'Sleepycat'],
  'network-copyleft': ['AGPL-1.0', 'AGPL-3.0', 'AGPL', 'OSL-3.0', 'RPL-1.5'],
  restricted: ['SSPL-1.0', 'BUSL-1.1', 'Elastic-2.0', 'PolyForm-Noncommercial-1.0.0', 'PolyForm-Small-Business-1.0.0', 'PolyForm-Shield-1.0.0', 'Commons-Clause',
    'CC-BY-NC-3.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-3.0', 'CC-BY-NC-SA-4.0', 'CC-BY-NC-ND-3.0', 'CC-BY-NC-ND-4.0', 'CC-BY-ND-3.0', 'CC-BY-ND-4.0', 'JSON'],
  proprietary: ['UNLICENSED'],
};
// Vendor terms that are not open source but are the normal, paid-for or free-with-the-platform case:
// worth a line in the report, not a decision. Recognised from licence URLs and licence file text.
export const VENDOR_TERMS = {
  'LicenseRef-Microsoft-EULA': 'Microsoft licence terms (free to use with the platform; not open source)',
  'LicenseRef-Umbraco-Commercial': "Umbraco's commercial licence: make sure the site has a valid licence key for it",
};
const CATEGORY_OF = new Map(Object.entries(IDS).flatMap(([cat, ids]) => ids.map((id) => [id.toLowerCase(), cat])));
// GPL with a linking exception behaves like a weak copyleft licence.
const LINKING_EXCEPTIONS = /classpath-exception|gcc-exception|llvm-exception|font-exception|universal-foss-exception|autoconf-exception/i;

// Common non-SPDX spellings seen in package.json and old nuspecs.
const ALIASES = [
  [/^(the )?mit( license)?$|^expat$/i, 'MIT'],
  [/^apache[\s-]*(license)?[\s,-]*(version )?2(\.0)?$|^apache2$|^asl 2\.0$/i, 'Apache-2.0'],
  [/^bsd$|^bsd license$/i, 'BSD'],
  [/^(new |revised |modified )?bsd[\s-]*3([\s-]*clause)?( license)?$/i, 'BSD-3-Clause'],
  [/^(simplified |freebsd )?bsd[\s-]*2([\s-]*clause)?( license)?$/i, 'BSD-2-Clause'],
  [/^isc license$/i, 'ISC'],
  [/^gpl[\s-]*v?2(\.0)?$/i, 'GPL-2.0'], [/^gpl[\s-]*v?3(\.0)?$/i, 'GPL-3.0'], [/^gnu gpl$|^gpl$/i, 'GPL'],
  [/^lgpl[\s-]*v?2(\.1)?$/i, 'LGPL-2.1'], [/^lgpl[\s-]*v?3(\.0)?$/i, 'LGPL-3.0'], [/^lgpl$/i, 'LGPL'],
  [/^agpl[\s-]*v?3(\.0)?$|^agpl$/i, 'AGPL-3.0'],
  [/^mpl[\s-]*2(\.0)?$|^mozilla public license 2\.0$/i, 'MPL-2.0'],
  [/^public[\s-]*domain$/i, 'Public-Domain'], [/^cc0$/i, 'CC0-1.0'], [/^wtfpl$/i, 'WTFPL'],
];

/** One SPDX-ish id, stripped of -only/-or-later/+ for classification. */
const baseId = (id) => id.replace(/\+$/, '').replace(/-(only|or-later)$/i, '');

/** Turn whatever a package declares into an expression string, or null when it declares nothing. */
export function normalizeLicense(raw) {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) { const parts = raw.map(normalizeLicense).filter(Boolean); return parts.length ? (parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`) : null; }
  if (typeof raw === 'object') return normalizeLicense(raw.type || raw.name || null);
  const s = String(raw).trim();
  if (!s || /^(unknown|none|n\/a|license|licence)$/i.test(s)) return null;
  for (const [re, id] of ALIASES) if (re.test(s)) return id;
  return s;
}

/** Map a nuspec/NuGet licenseUrl to an id when the URL says which licence it is. */
export function licenseFromUrl(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  let m;
  if ((m = u.match(/licenses\.nuget\.org\/(.+)$/i))) return decodeURIComponent(m[1]);
  if ((m = u.match(/opensource\.org\/licenses?\/([\w.+-]+?)(?:\.php|\.html|-license)?\/?$/i))) return normalizeLicense(m[1].replace(/^mit$/i, 'MIT'));
  if (/apache\.org\/licenses\/LICENSE-2\.0/i.test(u)) return 'Apache-2.0';
  if (/gnu\.org\/licenses\/agpl/i.test(u)) return 'AGPL-3.0';
  if (/gnu\.org\/licenses\/lgpl/i.test(u)) return 'LGPL';
  if (/gnu\.org\/licenses\/(old-licenses\/)?gpl-2/i.test(u)) return 'GPL-2.0';
  if (/gnu\.org\/licenses\/gpl/i.test(u)) return 'GPL-3.0';
  if (/mozilla\.org\/MPL\/2\.0/i.test(u)) return 'MPL-2.0';
  if (/go\.microsoft\.com\/fwlink\/\?LinkId=(329770|529443)|dotnet_library_license/i.test(u)) return 'LicenseRef-MS-NET-Library';
  if (/(go\.microsoft\.com\/fwlink\/|microsoft\.com\/.*eula|aka\.ms\/.*(eula|licen[cs]e))/i.test(u)) return 'LicenseRef-Microsoft-EULA';
  if (/(^|\/\/|\.)umbraco\.com\//i.test(u)) return 'LicenseRef-Umbraco-Commercial';
  if (/unicode\.org\/(copyright|license)|unicode-org\/icu\/.*LICENSE/i.test(u)) return 'Unicode-3.0';
  return null;
}

/** Guess the licence from the text of a LICENSE file. Only well-known headings, nothing clever. */
export function licenseFromText(text) {
  const t = String(text || '').slice(0, 6000);
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return /Version 3/i.test(t) ? 'LGPL-3.0' : 'LGPL-2.1';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return /Version 3/i.test(t) ? 'GPL-3.0' : 'GPL-2.0';
  if (/Server Side Public License/i.test(t)) return 'SSPL-1.0';
  if (/Business Source License/i.test(t)) return 'BUSL-1.1';
  if (/Elastic License 2\.0/i.test(t)) return 'Elastic-2.0';
  if (/PolyForm Noncommercial/i.test(t)) return 'PolyForm-Noncommercial-1.0.0';
  if (/Commons Clause/i.test(t)) return 'Commons-Clause';
  if (/Mozilla Public License,? (Version )?2\.0/i.test(t)) return 'MPL-2.0';
  if (/Apache License,?\s+Version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose/i.test(t)) return 'ISC';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/MICROSOFT SOFTWARE LICENSE TERMS[\s\S]*\.NET LIBRARY/i.test(t)) return 'LicenseRef-MS-NET-Library';
  if (/MICROSOFT SOFTWARE (SUPPLEMENTAL )?LICENSE TERMS/i.test(t)) return 'LicenseRef-Microsoft-EULA';
  if (/UNICODE LICENSE V3|UNICODE,? INC\. LICENSE AGREEMENT|COPYRIGHT AND PERMISSION NOTICE \(ICU/i.test(t)) return 'Unicode-3.0';
  if (/Umbraco/i.test(t) && /(licen[cs]e (agreement|terms)|EULA|commercial)/i.test(t)) return 'LicenseRef-Umbraco-Commercial';
  return null;
}

/**
 * Classify an expression. Returns { category, ids } where ids are the licences that decided it.
 * `MIT OR GPL-3.0` is permissive (you may pick MIT); `MIT AND GPL-3.0` is strong copyleft.
 */
export function classify(expr) {
  if (!expr) return { category: 'unknown', ids: [] };
  const s = String(expr).trim();
  if (VENDOR_TERMS[s]) return { category: 'vendor', ids: [s] };
  if (/^SEE LICEN[CS]E IN\b/i.test(s) || /^https?:\/\//i.test(s) || /^LicenseRef-(?!MS-NET-Library)/i.test(s) || /^custom/i.test(s)) return { category: 'unknown', ids: [s] };
  const rank = (c) => CATEGORIES.indexOf(c);
  const orParts = splitTop(s, 'OR');
  if (orParts.length > 1) return orParts.map(classify).reduce((a, b) => (rank(b.category) < rank(a.category) ? b : a));
  const andParts = splitTop(s, 'AND');
  if (andParts.length > 1) return andParts.map(classify).reduce((a, b) => (rank(b.category) > rank(a.category) ? b : a));
  const inner = s.replace(/^\((.*)\)$/s, '$1').trim();
  if (inner !== s) return classify(inner);
  const [id, exception] = inner.split(/\s+WITH\s+/i);
  const norm = normalizeLicense(id) || id;
  let category = CATEGORY_OF.get(baseId(norm).toLowerCase()) || (/^CC-BY-NC/i.test(norm) ? 'restricted' : 'unknown');
  if (exception && LINKING_EXCEPTIONS.test(exception) && category === 'strong-copyleft') category = 'weak-copyleft';
  return { category, ids: [exception ? `${norm} WITH ${exception}` : norm] };
}

function splitTop(s, op) {
  const parts = []; let depth = 0; let cur = '';
  const tokens = s.split(/(\(|\)|\s+)/).filter((t) => t !== '');
  for (const t of tokens) {
    if (t === '(') depth++;
    if (t === ')') depth--;
    if (depth === 0 && t.toUpperCase() === op) { parts.push(cur.trim()); cur = ''; continue; }
    cur += t;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
}

// ---------- Policy ----------
const COPYLEFT_PROJECT = /^(A?GPL|LGPL)-/i;

/**
 * The solution's own licence decides what counts as compatible. Manifest `licenses.projectLicense` wins,
 * then the root package.json `license`, then a csproj `PackageLicenseExpression`; otherwise the solution
 * is treated as proprietary (closed source), which is what most client solutions are.
 */
export function projectLicense({ manifest, root, npmManifests = [], nugetManifests = [] }) {
  const set = manifest?.licenses?.projectLicense;
  if (set) return { id: normalizeLicense(set), from: 'manifest' };
  for (const rel of npmManifests) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, rel), 'utf8'));
      if (pkg.license && !/^UNLICENSED$/i.test(pkg.license)) return { id: normalizeLicense(pkg.license), from: rel };
    } catch { /* unreadable package.json: skip */ }
  }
  for (const rel of nugetManifests) {
    try {
      const m = readFileSync(join(root, rel), 'utf8').match(/<PackageLicenseExpression>([^<]+)</i);
      if (m) return { id: normalizeLicense(m[1]), from: rel };
    } catch { /* skip */ }
  }
  return { id: 'proprietary', from: 'assumed' };
}

const WHY = {
  'weak-copyleft': (id) => `${id} is weak copyleft: fine to use, but changes to the package's own files must be published and its notice kept`,
  'strong-copyleft': (id) => `${id} is strong copyleft: shipping it (a browser bundle, a desktop or mobile app, an installer, a package you publish) obliges you to release the combined work under the same licence; server-side use without distribution is usually fine, so check how it is used`,
  'network-copyleft': (id) => `${id} is network copyleft: running it in a site or service other people use can oblige you to publish the source of the whole service`,
  restricted: (id) => `${id} is source-available or non-commercial, not open source: commercial or production use may be forbidden or need a paid licence`,
  proprietary: () => 'marked UNLICENSED (all rights reserved): fine if it is your own private package, otherwise you need a licence from the author',
  unknown: (id) => (id ? `licence not recognised (${id}): read it before relying on the package` : 'no licence declared: by default nobody may use, copy or ship it; ask the author or replace it'),
};

/**
 * Verdict for one package's licence. `entry` = { ecosystem, name, license, dev, direct }.
 * Policy (manifest `licenses`): allow/review/deny lists of ids, accept: [{ name, ecosystem?, reason, expires? }].
 */
export function licenseVerdict(entry, { policy = {}, project = { id: 'proprietary' }, today = new Date() } = {}) {
  const { category, ids } = classify(entry.license);
  const id = ids.join(' + ') || entry.license || null;
  const inList = (list) => (list || []).some((x) => ids.some((i) => baseId(i).toLowerCase() === baseId(String(x)).toLowerCase()));
  const accepted = (policy.accept || []).find((a) => a.name?.toLowerCase() === entry.name.toLowerCase() && (!a.ecosystem || a.ecosystem === entry.ecosystem));
  if (accepted && !(accepted.expires && new Date(accepted.expires) < today)) return { level: 'ignored', category, reasons: [`licence accepted: ${accepted.reason}${accepted.expires ? ` (until ${accepted.expires})` : ''}`] };
  const reasons = [];
  if (accepted) reasons.push(`licence acceptance expired ${accepted.expires}: re-evaluate`);
  let level;
  if (inList(policy.deny)) { level = 'red'; reasons.push(`${id} is on the deny list in the manifest`); }
  else if (inList(policy.review)) { level = 'amber'; reasons.push(`${id} is on the review list in the manifest`); }
  else if (inList(policy.allow)) return { level: 'green', category, reasons: [] };
  else if (category === 'vendor') return { level: 'info', category, reasons: [VENDOR_TERMS[ids[0]]] };
  else if (!entry.license && entry.unread) return { level: 'info', category, reasons: ['licence not read: the package is not on disk here (install or restore, then run again)'] };
  else {
    level = { permissive: 'green', 'weak-copyleft': 'info', 'strong-copyleft': 'amber', 'network-copyleft': 'red', restricted: 'red', proprietary: 'amber', unknown: 'amber' }[category];
    const incompatible = incompatibleWith(project.id, ids, category);
    if (incompatible) { level = 'red'; reasons.push(incompatible); }
    else if (COPYLEFT_PROJECT.test(project.id || '') && /copyleft/.test(category)) level = 'green'; // copyleft inside a copyleft solution is the normal case
    else if (level !== 'green') reasons.push(WHY[category](id));
    // Build and test tools are not shipped, so copyleft there does not reach the product. A non-commercial
    // licence still matters: using the tool at work is the commercial use it forbids.
    if (entry.dev && level !== 'green') {
      const before = level;
      level = category === 'restricted' ? 'amber' : 'info';
      if (before !== level) reasons.push('dev dependency only (not shipped), so it matters less');
    }
  }
  return { level, category, reasons };
}

// The best-known one-way incompatibilities when the solution itself is GPL: Apache-2.0 and the v3 family
// cannot go into a GPL-2.0-only work, and GPL-2.0-only code cannot go into a GPL-3.0 or AGPL-3.0 work.
function incompatibleWith(projectId, ids, category) {
  const p = String(projectId || '');
  const gpl2only = /^GPL-2\.0(-only)?$/i.test(p);
  const v3 = /^A?GPL-3\.0/i.test(p);
  for (const id of ids) {
    if (gpl2only && (/^Apache-2\.0$/i.test(id) || /^(A|L)?GPL-3\.0/i.test(id) || category === 'network-copyleft')) return `${id} cannot be combined with this solution's ${p} licence`;
    if (v3 && /^(L?GPL)-2\.(0|1)(-only)?$/i.test(id) && !/^LGPL/i.test(id)) return `${id} (no "or later") cannot be combined with this solution's ${p} licence`;
  }
  return null;
}

// ---------- Inventory ----------

/**
 * Every package an npm project has locked or installed: { name, version, license, dev, direct, from }.
 * package-lock.json v2/v3 records each package's licence; node_modules fills in when there is no lockfile
 * (yarn, pnpm) or an entry lacks one.
 */
export function npmInventory(dir, { lock = null, directNames = new Set() } = {}) {
  const out = new Map();
  // Reverse graph by name (close enough: two versions of one package rarely have different parents that matter).
  const dependents = {};
  for (const [path, v] of Object.entries(lock?.packages || {})) {
    if (!path.includes('node_modules/')) continue;
    const from = v.name || path.replace(/^.*node_modules\//, '');
    for (const to of Object.keys({ ...v.dependencies, ...v.optionalDependencies, ...v.peerDependencies })) (dependents[to] ||= new Set()).add(from);
  }
  const parentsOf = (name) => {
    const seen = new Set(); const found = new Set(); const queue = [name];
    while (queue.length) for (const d of dependents[queue.shift()] || []) { if (seen.has(d)) continue; seen.add(d); if (directNames.has(d)) found.add(d); else queue.push(d); }
    return [...found];
  };
  const add = (path, rec) => {
    const name = rec.name || path.replace(/^.*node_modules\//, '');
    const key = `${name}@${rec.version}`;
    const direct = directNames.has(name) && !path.includes('/node_modules/', 13);
    if (!out.has(key) || (!out.get(key).license && rec.license)) out.set(key, { name, version: rec.version || null, license: rec.license ?? null, dev: !!rec.dev, direct, parents: direct ? [] : parentsOf(name), from: rec.from });
  };
  if (lock?.packages) {
    for (const [path, v] of Object.entries(lock.packages)) {
      if (!path || !path.includes('node_modules/') || v.link) continue;
      let license = normalizeLicense(v.license ?? v.licenses);
      if (!license) license = installedLicense(join(dir, path));
      add(path, { version: v.version, license, dev: v.dev || v.devOptional, from: license ? 'lockfile' : null }); // a lockfile entry with no licence: the package declares none
    }
  } else if (existsSync(join(dir, 'node_modules'))) {
    for (const path of walkNodeModules(join(dir, 'node_modules'))) {
      let pkg; try { pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')); } catch { continue; }
      if (!pkg.name || !pkg.version) continue;
      add(path.slice(dir.length + 1).replace(/\\/g, '/'), { name: pkg.name, version: pkg.version, license: normalizeLicense(pkg.license ?? pkg.licenses) || installedLicense(path), dev: false, from: 'node_modules' });
    }
  }
  return [...out.values()];
}

function installedLicense(pkgDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const lic = normalizeLicense(pkg.license ?? pkg.licenses);
    if (lic && !/^SEE LICEN[CS]E IN/i.test(lic)) return lic;
  } catch { return null; }
  return sniffFolder(pkgDir);
}

function sniffFolder(dir) {
  try {
    const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
    return f ? licenseFromText(readFileSync(join(dir, f), 'utf8')) : null;
  } catch { return null; }
}

function* walkNodeModules(nm, depth = 0) {
  if (depth > 6) return;
  let names; try { names = readdirSync(nm); } catch { return; }
  for (const n of names) {
    if (n.startsWith('.')) continue;
    if (n.startsWith('@')) { for (const s of (() => { try { return readdirSync(join(nm, n)); } catch { return []; } })()) yield* pkgAt(join(nm, n, s), depth); }
    else yield* pkgAt(join(nm, n), depth);
  }
}
function* pkgAt(dir, depth) {
  if (existsSync(join(dir, 'package.json'))) yield dir;
  if (existsSync(join(dir, 'node_modules'))) yield* walkNodeModules(join(dir, 'node_modules'), depth + 1);
}

/**
 * Every package a NuGet project restored, from obj/project.assets.json: { name, version, license, direct,
 * parents, from }. Licences come from the .nuspec in the package folders the assets file itself names
 * (the real global packages folder and fallback folders, not an assumed ~/.nuget/packages).
 * Returns null when the project has not been restored.
 */
export function nugetInventory(projectFile) {
  const assetsFile = join(dirname(projectFile), 'obj', 'project.assets.json');
  let assets; try { assets = JSON.parse(readFileSync(assetsFile, 'utf8')); } catch { return null; }
  const folders = Object.keys(assets.packageFolders || {});
  const direct = new Set(Object.values(assets.project?.frameworks || {}).flatMap((fw) => Object.keys(fw.dependencies || {})).map((n) => n.toLowerCase()));
  // Reverse graph, so a transitive package can say which direct packages pull it in.
  const deps = {};
  for (const target of Object.values(assets.targets || {})) for (const [key, v] of Object.entries(target)) {
    if (v.type !== 'package') continue;
    const from = key.split('/')[0].toLowerCase();
    for (const to of Object.keys(v.dependencies || {})) ((deps[to.toLowerCase()] ||= new Set())).add(from);
  }
  const parentsOf = (id) => {
    const seen = new Set(); const found = new Set(); const queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      for (const p of deps[cur] || []) { if (seen.has(p)) continue; seen.add(p); if (direct.has(p)) found.add(p); else queue.push(p); }
    }
    return [...found];
  };
  const packages = [];
  for (const [key, lib] of Object.entries(assets.libraries || {})) {
    if (lib.type !== 'package') continue;
    const [name, version] = key.split('/');
    const id = name.toLowerCase();
    let license = null; let from = 'not on disk';
    for (const folder of folders) {
      const dir = join(folder, lib.path || `${id}/${version.toLowerCase()}`);
      const nuspec = join(dir, `${id}.nuspec`);
      if (!existsSync(nuspec)) continue;
      const r = nuspecLicense(readFileSync(nuspec, 'utf8'), dir);
      license = r.license; from = r.from;
      break;
    }
    packages.push({ name, version, license, direct: direct.has(id), parents: direct.has(id) ? [] : parentsOf(id), from });
  }
  return { assetsFile, folders, packages };
}

export function nuspecLicense(xml, dir) {
  const lic = xml.match(/<license\s+type="(expression|file)"[^>]*>([^<]+)<\/license>/i);
  if (lic && lic[1].toLowerCase() === 'expression') return { license: lic[2].trim(), from: 'nuspec' };
  if (lic) {
    let text = null; try { text = readFileSync(join(dir, lic[2].trim()), 'utf8'); } catch { /* not extracted */ }
    const guess = licenseFromText(text);
    return { license: guess || `SEE LICENSE IN ${lic[2].trim()}`, from: guess ? 'licence file' : 'nuspec' };
  }
  const url = (xml.match(/<licenseUrl>([^<]+)<\/licenseUrl>/i) || [])[1];
  if (url) {
    const known = licenseFromUrl(url);
    if (known) return { license: known, from: 'licenseUrl' };
    // An unknown URL (often a LICENSE on GitHub): a licence file shipped in the package says more.
    const sniffed = dir ? sniffFolder(dir) : null;
    return sniffed ? { license: sniffed, from: 'licence file' } : { license: url.trim(), from: 'licenseUrl' };
  }
  return { license: null, from: 'nuspec' };
}

// ---------- NuGet versions (for the vulnerability database's ranges) ----------
export function compareNuget(a, b) {
  const split = (v) => { const [main, pre = ''] = String(v).replace(/\+.*$/, '').split('-', 2); return { nums: main.split('.').map(Number), pre }; };
  const x = split(a); const y = split(b);
  for (let i = 0; i < 4; i++) { const d = (x.nums[i] || 0) - (y.nums[i] || 0); if (d) return d; }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

/** NuGet version range: "1.0" (>=), "[1.0]", "[1.0, 2.0)", "(, 2.0]". */
export function inNugetRange(version, range) {
  const r = String(range).trim();
  if (!/^[[(]/.test(r)) return compareNuget(version, r) >= 0;
  const m = r.match(/^([[(])\s*([^,\]\)]*?)\s*(?:,\s*([^\]\)]*?)\s*)?([\])])$/);
  if (!m) return false;
  const [, lo, min, max, hi] = m;
  if (max === undefined) return compareNuget(version, min) === 0;
  if (min && (lo === '[' ? compareNuget(version, min) < 0 : compareNuget(version, min) <= 0)) return false;
  if (max && (hi === ']' ? compareNuget(version, max) > 0 : compareNuget(version, max) >= 0)) return false;
  return true;
}
