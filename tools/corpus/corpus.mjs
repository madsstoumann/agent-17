#!/usr/bin/env node
// Golden corpus for the page-reading skills.
//
// Runs audit-seo and plan-geo from this checkout over saved page archives (the format
// `audit-seo --save-html` writes) and writes one digest per site: the row verdicts, the
// page dates, bylines and example pages the skills read. Comparing two digest folders
// shows what a skill change moves on every archived site before anything runs live.
//
//   node tools/corpus/corpus.mjs run   --archives ROOT --out DIR
//   node tools/corpus/corpus.mjs diff  OLD_DIR NEW_DIR [--md FILE]
//   node tools/corpus/corpus.mjs check --archives ROOT --golden DIR [--md FILE] [--update]
//
// ROOT holds <host>/pages/<date>/index.json (the newest <date> per host is used), or pass
// --archive DIR (repeatable) for single archives. No site names live in this repo: the
// archives and the golden digests stay in the private reports repo.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEO = join(REPO, 'skills/audit-seo/scripts/seo.mjs');
const GEO = join(REPO, 'skills/plan-geo/scripts/plan.mjs');
export const DIGEST_VERSION = 1;

const USAGE = `corpus: run the page-reading skills over saved site archives and compare digests

  corpus.mjs run   --archives ROOT | --archive DIR ...  --out DIR
  corpus.mjs diff  OLD_DIR NEW_DIR [--md FILE]
  corpus.mjs check --archives ROOT | --archive DIR ...  --golden DIR [--md FILE] [--update]

  --archives ROOT  Folder of <host>/pages/<date>/index.json archives; the newest date per host is used.
  --archive DIR    One archive folder (repeatable).
  --only HOSTS     Comma list of hosts to run.
  --out DIR        Where run writes <host>.json digests.
  --golden DIR     The committed digests check compares with.
  --update         check: write the new digests over the golden ones after the diff.
  --md FILE        Also write the diff as Markdown (for a PR body).
  --keep           Keep the skills' run folders (printed) instead of deleting them.

check exits 0 when nothing changed and 1 when a digest differs, so a script can tell.`;

// ---------- arguments ----------

export function parseArgs(argv) {
  const o = { cmd: argv[0], archives: null, archive: [], only: null, out: null, golden: null, md: null, update: false, keep: false, positional: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--archives') o.archives = next();
    else if (a === '--archive') o.archive.push(next());
    else if (a === '--only') o.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') o.out = next();
    else if (a === '--golden') o.golden = next();
    else if (a === '--md') o.md = next();
    else if (a === '--update') o.update = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--help' || a === '-h') o.cmd = 'help';
    else o.positional.push(a);
  }
  return o;
}

// ---------- archives ----------

export function findArchives(root) {
  const out = [];
  if (!root || !existsSync(root)) return out;
  for (const host of readdirSync(root).sort()) {
    const pages = join(root, host, 'pages');
    if (!existsSync(pages) || !statSync(pages).isDirectory()) continue;
    const dates = readdirSync(pages).filter((d) => existsSync(join(pages, d, 'index.json'))).sort();
    if (dates.length) out.push({ host, dir: join(pages, dates.at(-1)), date: dates.at(-1) });
  }
  return out;
}

function archiveInfo(dir) {
  const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const first = (idx.pages || idx.entries || idx).find?.((p) => p && p.url) || {};
  let host = idx.host || null;
  if (!host && first.url) host = new URL(first.url).host;
  return { host: host || dir.split('/').filter(Boolean).at(-3), dir, date: dir.split('/').filter(Boolean).at(-1) };
}

// ---------- digest ----------

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function digestSeo(report, findings) {
  const counts = {};
  for (const f of findings?.findings || []) if (f.check && f.count != null) counts[f.check] = f.count;
  const rows = {};
  for (const r of report.rows || []) {
    rows[r.id] = counts[r.id] != null ? `${r.status} (${counts[r.id]})` : r.status;
  }
  const s = report.stats || {};
  return {
    version: report.version,
    pages: { html: s.html ?? null, indexable: s.indexable ?? null, redirects: s.redirects ?? null, errors: s.errors ?? null },
    geoScore: report.geo?.score?.score ?? null,
    rows: sortObj(rows),
  };
}

export function digestPage(p) {
  const bylines = (p.bylines || []).map((b) => (typeof b === 'string' ? b : b.name || b.text || JSON.stringify(b)));
  return {
    template: p.template ?? null,
    how: p.how ?? null,
    words: p.words ?? null,
    hiddenWords: p.hidden?.words ?? 0,
    questions: (p.questions || []).length,
    tables: (p.tables || []).length,
    leadDate: p.leadDate ?? null,
    publishedMeta: p.publishedMeta ?? null,
    dates: (p.dates || []).length,
    bylines,
  };
}

export function digestGeo(inventory, pages) {
  const templates = {};
  for (const t of inventory.templates || []) {
    templates[t.key] = { pages: t.pages, example: t.example?.url || t.example || null };
  }
  const read = {};
  for (const p of pages) read[p.url] = digestPage(p);
  return { version: inventory.version, templates: sortObj(templates), pages: sortObj(read) };
}

function run(cmd, args, env) {
  const r = spawnSync(process.execPath, [cmd, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

export function digestArchive(a, { keep = false } = {}) {
  const work = mkdtempSync(join(tmpdir(), `corpus-${a.host}-`));
  const env = { AUDIT_OUT_DIR: join(work, 'reports'), AUDIT_HEADERS: '' };
  const seoOut = join(work, 'seo');
  const geoOut = join(work, 'geo');
  const digest = { digest: DIGEST_VERSION, host: a.host, archive: a.date, seo: null, geo: null, errors: [] };
  const s = run(SEO, ['--from-archive', a.dir, '--out', seoOut, '--no-validate', '--no-baseline', '--quiet'], env);
  if (existsSync(join(seoOut, 'report.json'))) {
    const report = JSON.parse(readFileSync(join(seoOut, 'report.json'), 'utf8'));
    const findings = existsSync(join(seoOut, 'findings.json')) ? JSON.parse(readFileSync(join(seoOut, 'findings.json'), 'utf8')) : null;
    digest.seo = digestSeo(report, findings);
  } else digest.errors.push(`audit-seo exited ${s.code}: ${s.out.trim().split('\n').slice(-3).join(' | ')}`);
  if (digest.seo) {
    const g = run(GEO, ['extract', seoOut, '--from-archive', a.dir, '--out', geoOut, '--no-validate'], env);
    if (existsSync(join(geoOut, 'inventory.json'))) {
      const inventory = JSON.parse(readFileSync(join(geoOut, 'inventory.json'), 'utf8'));
      const pdir = join(geoOut, 'pages');
      const pages = existsSync(pdir)
        ? readdirSync(pdir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(pdir, f), 'utf8')))
        : [];
      digest.geo = digestGeo(inventory, pages);
    } else digest.errors.push(`plan-geo extract exited ${g.code}: ${g.out.trim().split('\n').slice(-3).join(' | ')}`);
  }
  if (keep) digest.work = work;
  else rmSync(work, { recursive: true, force: true });
  if (!digest.errors.length) delete digest.errors;
  return digest;
}

// ---------- diff ----------

const show = (v) => (v === undefined ? '(none)' : v === null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v));

function flatten(o, prefix = '', out = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}\u0000${k}` : k, out);
  } else out[prefix] = o;
  return out;
}

// What changed between two digests of one site, grouped for reading: rows, templates, pages.
export function diffDigest(oldD, newD) {
  const ignore = (k) => k === 'seo\u0000version' || k === 'geo\u0000version' || k === 'work' || k === 'digest';
  const a = flatten(oldD || {});
  const b = flatten(newD || {});
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !ignore(k)).sort();
  const changes = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    const parts = k.split('\u0000');
    changes.push({ path: parts, from: a[k], to: b[k] });
  }
  return changes;
}

function group(change) {
  const [top, sub] = change.path;
  if (top === 'seo' && sub === 'rows') return 'audit-seo rows';
  if (top === 'seo') return 'audit-seo totals';
  if (top === 'geo' && sub === 'templates') return 'plan-geo templates';
  if (top === 'geo' && sub === 'pages') return 'plan-geo pages';
  return 'other';
}

export function diffDirs(oldDir, newDir) {
  const load = (d) => Object.fromEntries(
    (existsSync(d) ? readdirSync(d) : []).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(d, f), 'utf8'))]),
  );
  const A = load(oldDir);
  const B = load(newDir);
  const hosts = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  return hosts.map((host) => ({ host, added: !A[host], removed: !B[host], changes: A[host] && B[host] ? diffDigest(A[host], B[host]) : [] }));
}

export function formatDiff(result) {
  const changed = result.filter((r) => r.added || r.removed || r.changes.length);
  const lines = [];
  lines.push(`Corpus: ${result.length} site${result.length === 1 ? '' : 's'}, ${changed.length} changed.`);
  for (const r of changed) {
    lines.push('', `### ${r.host}`);
    if (r.added) { lines.push('New in this run (no golden digest).'); continue; }
    if (r.removed) { lines.push('Missing from this run.'); continue; }
    const groups = {};
    for (const c of r.changes) (groups[group(c)] ||= []).push(c);
    for (const [g, cs] of Object.entries(groups)) {
      lines.push('', `${g} (${cs.length}):`);
      for (const c of cs.slice(0, 40)) {
        const where = c.path.slice(2).join(' → ') || c.path.join(' → ');
        lines.push(`- ${where}: ${show(c.from)} → ${show(c.to)}`);
      }
      if (cs.length > 40) lines.push(`- … and ${cs.length - 40} more`);
    }
  }
  return lines.join('\n');
}

// ---------- commands ----------

function targets(o) {
  let list = [...findArchives(o.archives), ...o.archive.map(archiveInfo)];
  if (o.only) list = list.filter((a) => o.only.includes(a.host));
  return list;
}

function runAll(o, outDir) {
  mkdirSync(outDir, { recursive: true });
  const list = targets(o);
  if (!list.length) throw new Error('no archives found (expected <ROOT>/<host>/pages/<date>/index.json, or --archive DIR)');
  for (const a of list) {
    const t0 = Date.now();
    const d = digestArchive(a, { keep: o.keep });
    writeFileSync(join(outDir, `${a.host}.json`), JSON.stringify(d, null, 2) + '\n');
    const pages = d.geo ? Object.keys(d.geo.pages).length : 0;
    process.stderr.write(`${a.host} (${a.date}): ${d.seo ? Object.keys(d.seo.rows).length : 0} rows, ${pages} pages read, ${((Date.now() - t0) / 1000).toFixed(1)} s${d.errors ? ' — ' + d.errors.join('; ') : ''}${d.work ? ' — ' + d.work : ''}\n`);
  }
  return list;
}

function main(argv) {
  const o = parseArgs(argv);
  if (!o.cmd || o.cmd === 'help') { console.log(USAGE); return 0; }
  if (o.cmd === 'run') {
    if (!o.out) throw new Error('run needs --out DIR');
    runAll(o, o.out);
    return 0;
  }
  if (o.cmd === 'diff') {
    const [a, b] = o.positional;
    if (!a || !b) throw new Error('diff needs OLD_DIR NEW_DIR');
    const text = formatDiff(diffDirs(a, b));
    console.log(text);
    if (o.md) writeFileSync(o.md, text + '\n');
    return 0;
  }
  if (o.cmd === 'check') {
    if (!o.golden) throw new Error('check needs --golden DIR');
    const out = mkdtempSync(join(tmpdir(), 'corpus-digests-'));
    runAll(o, out);
    const result = diffDirs(o.golden, out).filter((r) => !o.only || o.only.includes(r.host));
    const text = formatDiff(result);
    console.log(text);
    if (o.md) writeFileSync(o.md, text + '\n');
    const changed = result.some((r) => r.added || r.removed || r.changes.length);
    if (o.update) {
      mkdirSync(o.golden, { recursive: true });
      for (const f of readdirSync(out)) writeFileSync(join(o.golden, f), readFileSync(join(out, f)));
      console.log(`\nGolden digests updated in ${o.golden}.`);
    }
    rmSync(out, { recursive: true, force: true });
    return changed && !o.update ? 1 : 0;
  }
  throw new Error(`unknown command "${o.cmd}"\n\n${USAGE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(`corpus: ${e.message}`); process.exitCode = 2; }
}
