#!/usr/bin/env node
// Phase 4: merge results + Claude's page assessments, compare with the previous run, write report.md and update state.json.
// Usage: node finalize.mjs [--root <dir>] [--dry-run]
// Optional input: run/assessments.json  { "<watched url>": { "verdict": "red|amber|info|benign", "summary": "...", "action": "..." } }
// Snapshots of changed pages are only accepted once assessed, so an unread change keeps showing up until someone reads it.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs, paths, readJson, writeJson, loadState, loadManifest, ensureDirs, log, nowIso, daysSince, showPath } from './lib.mjs';

const args = parseArgs();
const p = paths(args);
ensureDirs(p);
const R = (f) => readJson(join(p.runDir, f));
const discovery = R('discovery.json');
const packages = R('packages.json');
const runtimes = R('runtimes.json');
const apis = R('apis.json');
const assessments = R('assessments.json') || {};
const manifest = loadManifest(p) || {};
const prev = loadState(p);
const today = new Date().toISOString().slice(0, 10);
const ICON = { red: '🔴', amber: '🟠', unknown: '⚪', info: '🔵', green: '🟢', ignored: '⚫' };
const RANK = { green: 0, ignored: 0, info: 1, unknown: 1, amber: 2, red: 3 };

// Apply assessments to API verdicts
for (const api of apis?.apis || []) {
  for (const pg of api.pages) {
    const a = assessments[pg.url];
    if (!a) continue;
    pg.assessment = a;
    const lvl = a.verdict === 'benign' ? 'info' : a.verdict;
    if (RANK[lvl] > RANK[api.verdict.level]) api.verdict.level = lvl;
    // A page Claude read and judged benign should not keep the API amber on keyword hits alone
    if (a.verdict === 'benign' && api.verdict.level === 'amber' && api.verdict.reasons.every((r) => /keyword|page changed/.test(r))) api.verdict.level = 'info';
    api.verdict.reasons.push(`assessed ${pg.url}: ${a.summary}`);
  }
}

// Build a flat list of findings with stable keys
const findings = [];
for (const x of packages?.packages || []) findings.push({ key: `pkg:${x.ecosystem}:${x.name.toLowerCase()}`, area: 'package', title: `${x.name}@${x.installed || x.ranges?.[0] || '?'}`, ecosystem: x.ecosystem, level: x.verdict.level, reasons: x.verdict.reasons, where: x.projects, extra: x });
for (const x of runtimes?.runtimes || []) findings.push({ key: `rt:${x.key}`, area: 'runtime', title: `${x.product} ${x.cycle ?? x.version}`, level: x.verdict.level, reasons: x.verdict.reasons, where: x.sources, extra: x });
for (const x of packages?.nuget?.findings || []) findings.push({ key: x.key, area: 'nuget', title: x.title, level: x.level, reasons: x.reasons, where: x.where, extra: x });
for (const x of apis?.apis || []) findings.push({ key: `api:${x.name}`, area: 'api', title: x.name, level: x.verdict.level, reasons: x.verdict.reasons, where: x.codeFiles, extra: x });

for (const f of findings) {
  const before = prev.packages?.[f.key] || prev.runtimes?.[f.key] || prev.nuget?.[f.key] || prev.apis?.[f.key.replace(/^api:/, '')] || null;
  f.previous = before?.level || null;
  f.since = before && before.level === f.level ? before.since : today;
  f.isNew = !prev.lastRun ? RANK[f.level] >= 2 : (RANK[f.level] >= 2 && (f.previous === null || RANK[f.level] > RANK[f.previous]));
  f.improved = f.previous && RANK[f.level] < RANK[f.previous];
}

const by = (lvl) => findings.filter((f) => f.level === lvl);
const reds = by('red'); const ambers = by('amber');
const changedUnassessed = (apis?.apis || []).flatMap((a) => a.pages.filter((pg) => pg.needsReview && !pg.assessment).map((pg) => ({ api: a.name, ...pg })));
const untracked = (apis?.untrackedHosts || discovery?.hosts?.filter((h) => h.status === 'untracked') || []);

// ---------- Report ----------
const L = [];
const line = (s = '') => L.push(s);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fmtReasons = (r) => esc(r.join('; '));
line(`# Solution health report — ${today}`);
line();
line(`Solution: \`${relative(process.cwd(), p.root) || '.'}\` · Previous run: ${prev.lastRun ? prev.lastRun.slice(0, 10) : 'none (first run — everything is new)'}`);
line();
line(`**${reds.length} red · ${ambers.length} amber · ${by('unknown').length} unknown · ${by('info').length} info · ${by('green').length} green${by('ignored').length ? ` · ${by('ignored').length} ignored` : ''}**`);
line();
const news = findings.filter((f) => f.isNew); const better = findings.filter((f) => f.improved);
if (prev.lastRun) {
  line(`## New since ${prev.lastRun.slice(0, 10)}`);
  line();
  if (!news.length && !better.length) line('Nothing got worse since the last run.');
  for (const f of news) line(`- ${ICON[f.level]} **${esc(f.title)}** (${f.area}) — ${fmtReasons(f.reasons)}${f.previous ? ` _(was ${f.previous})_` : ''}`);
  for (const f of better) line(`- ✅ ${esc(f.title)} improved: ${f.previous} → ${f.level}`);
  line();
}
if (changedUnassessed.length) {
  line('## ⚠️ Changed pages not yet assessed');
  line();
  line('These pages changed (or mention deprecation on first sight) and nobody has read the change yet. They will be flagged again on the next run until assessed.');
  line();
  for (const c of changedUnassessed) line(`- **${esc(c.api)}** — ${c.url} → \`${c.changeFile}\``);
  line();
}
line('## Action needed');
line();
if (!reds.length) line('No red findings.');
for (const f of reds) {
  line(`### ${ICON.red} ${esc(f.title)} _(${f.area}${f.ecosystem ? `, ${f.ecosystem}` : ''})_`);
  for (const r of f.reasons) line(`- ${r}`);
  if (f.area === 'api') {
    const a = f.extra;
    if (a.replacement) line(`- Replacement: ${a.replacement}`);
    if (a.owner) line(`- Owner: ${a.owner}`);
    for (const pg of a.pages) if (pg.assessment?.action) line(`- Suggested action: ${pg.assessment.action}`);
  }
  if (f.where?.length) line(`- Where: ${f.where.slice(0, 6).map((w) => `\`${w}\``).join(', ')}${f.where.length > 6 ? ` +${f.where.length - 6} more` : ''}`);
  line(`- Red since: ${f.since}`);
  line();
}
line('## Watch');
line();
if (!ambers.length) line('No amber findings.');
else {
  line('| | Item | Area | Why | Since |');
  line('|---|---|---|---|---|');
  for (const f of ambers) line(`| ${ICON.amber} | ${esc(f.title)} | ${f.area} | ${fmtReasons(f.reasons)} | ${f.since} |`);
}
line();

// External APIs
line('## External APIs');
line();
if (!(apis?.apis || []).length) line('_No external APIs in the manifest yet._');
else {
  line('| | API | Probe | Watched pages | Code refs | Notes |');
  line('|---|---|---|---|---|---|');
  for (const a of apis.apis) {
    const pr = a.probe ? `${a.probe.status || 'ERR'}${a.probe.deprecation ? ' · Deprecation' : ''}${a.probe.sunsetDate ? ` · Sunset ${a.probe.sunsetDate.slice(0, 10)}` : ''}` : '—';
    const pages = a.pages.map((pg) => `${pg.change}${pg.assessment ? ` (${pg.assessment.verdict})` : ''}`).join(', ') || '—';
    line(`| ${ICON[a.verdict.level]} | ${esc(a.name)} | ${pr} | ${pages} | ${a.codeRefs} | ${fmtReasons(a.verdict.reasons)} |`);
  }
}
line();

// Packages
const pk = packages?.packages || [];
line(`## Packages (${pk.length} direct)`);
line();
const notable = pk.filter((x) => ['red', 'amber', 'unknown'].includes(x.verdict.level));
if (notable.length) {
  line('| | Package | Eco | Installed | Latest | Last release | Maintained* | Why |');
  line('|---|---|---|---|---|---|---|---|');
  for (const x of notable) {
    const rel = x.facts?.latestPublished || x.health?.latestRelease;
    line(`| ${ICON[x.verdict.level]} | ${esc(x.name)} | ${x.ecosystem} | ${esc(x.installed || x.ranges?.[0])} | ${esc(x.facts?.latest || '?')} | ${rel ? `${rel.slice(0, 10)} (${Math.round(daysSince(rel) / 30)} mo)` : '?'} | ${x.health?.maintainedCheck ?? '?'} | ${fmtReasons(x.verdict.reasons)} |`);
  }
  line();
  line('_*OpenSSF Scorecard "Maintained" check, 0–10, via deps.dev. ? = not assessed._');
  line();
}
const infos = pk.filter((x) => x.verdict.level === 'info');
if (infos.length) {
  line(`<details><summary>${infos.length} packages with updates available</summary>`);
  line();
  for (const x of infos) line(`- ${x.ecosystem} ${x.name}: ${esc(x.verdict.reasons.join('; '))}`);
  line();
  line('</details>');
  line();
}
const ign = pk.filter((x) => x.verdict.level === 'ignored');
if (ign.length) { line(`Ignored by manifest: ${ign.map((x) => `${x.name}`).join(', ')}`); line(); }
const vulnProjects = (packages?.npmProjects || []).filter((pr) => pr.audit?.counts);
for (const pr of vulnProjects) {
  const c = pr.audit.counts;
  const total = (c.critical || 0) + (c.high || 0) + (c.moderate || 0) + (c.low || 0);
  if (total) line(`npm audit \`${pr.path}\`: ${c.critical || 0} critical, ${c.high || 0} high, ${c.moderate || 0} moderate, ${c.low || 0} low (incl. transitive). Run \`npm audit fix\` (no \`--force\`) for semver-compatible fixes.`);
}
if (vulnProjects.length) line();

// NuGet sources and folders, as resolved from the solution's own config
const ng = packages?.nuget;
if (ng?.contexts?.length) {
  line('## NuGet sources and folders');
  line();
  const files = [...new Set(ng.contexts.flatMap((c) => c.configFiles.map((x) => `\`${x.file}\`${x.scope === 'user' ? ' (user)' : ''}`)))];
  line(`Config: ${files.join(', ') || '_no NuGet.config found; NuGet defaults apply_'}${ng.contexts.some((c) => c.sourcesFrom === 'RestoreSources') ? ' · some projects override sources with `RestoreSources`' : ''}`);
  line();
  line('| | Item | Details | Projects |');
  line('|---|---|---|---|');
  for (const x of ng.findings) line(`| ${ICON[x.level]} | ${esc(x.title)} | ${fmtReasons(x.reasons)} | ${x.where.length > 2 ? `${x.where.length} projects` : esc(x.where.join(', '))} |`);
  line();
}

// Runtimes
line('## Runtimes & frameworks');
line();
if (!(runtimes?.runtimes || []).length) line('_None detected._');
else {
  line('| | Product | Cycle | EOL | Newest cycle | Found in |');
  line('|---|---|---|---|---|---|');
  for (const r of runtimes.runtimes) line(`| ${ICON[r.verdict.level]} | ${r.product} | ${esc(r.cycle ?? r.version)} | ${esc(r.eol === false ? 'not set' : r.eol ?? '?')} | ${esc(r.newestCycle ?? '?')} | ${esc(r.sources.slice(0, 2).join(', '))} |`);
}
line();

// Untracked hosts
const hi = untracked.filter((h) => h.priority === 'high');
line(`## Hosts in code that nobody is watching (${untracked.length})`);
line();
if (!untracked.length) line('Every outbound host found in code is either tracked or ignored in the manifest.');
else {
  line('Add each real integration to `manifest.json` → `apis` (with a watch page), or to `hostsIgnore` if it is not an integration.');
  line();
  for (const h of [...hi, ...untracked.filter((h) => h.priority !== 'high')].slice(0, 40)) line(`- ${h.priority === 'high' ? '**' : ''}${h.host}${h.priority === 'high' ? '**' : ''} — ${h.fileCount} file(s), e.g. \`${h.files[0]}\``);
  if (untracked.length > 40) line(`- …and ${untracked.length - 40} more (see run/discovery.json)`);
}
line();

// Coverage
line('## Coverage and gaps');
line();
const gaps = [];
if (packages) {
  const rch = packages.reachability || {};
  if (pk.some((x) => x.ecosystem === 'npm') && !rch.npmRegistry) gaps.push('npm registry unreachable — npm deprecation not checked');
  if (pk.some((x) => x.ecosystem === 'nuget') && !rch.nugetApi) gaps.push('api.nuget.org unreachable — NuGet deprecation/vulnerabilities only from `dotnet` CLI (if present)');
  if (pk.length && !rch.ecosystems) gaps.push('packages.ecosyste.ms unreachable — archived-repo and last-commit signals missing');
  if (pk.length && !rch.depsDev) gaps.push('api.deps.dev unreachable — OpenSSF Scorecard "Maintained" missing');
  if (!packages.tools?.npm && (packages.npmProjects || []).length) gaps.push('npm not installed — `npm outdated`/`npm audit` skipped');
  if (!packages.tools?.dotnet && (packages.nugetProjects || []).length) gaps.push('dotnet SDK not installed — NuGet transitive/vulnerability data from CLI skipped');
  for (const pr of [...(packages.npmProjects || []), ...(packages.nugetProjects || [])]) for (const n of pr.notes || []) if (!/not on PATH/.test(n)) gaps.push(`${pr.path}: ${n}`);
  for (const e of packages.errors || []) gaps.push(`error: ${e}`);
} else gaps.push('packages.mjs did not run');
if (runtimes && !runtimes.reachable && runtimes.runtimes.length) gaps.push('endoflife.date unreachable — runtime EOL not checked');
if (!apis) gaps.push('apis.mjs did not run');
if (discovery?.manifests?.other?.length) gaps.push(`other ecosystems present but not checked by scripts: ${discovery.manifests.other.join(', ')}`);
if (!gaps.length) line('All sources reachable; all checks ran.');
for (const g of gaps) line(`- ${g}`);
line();
line('---');
line(`Generated by the \`solution-health\` skill. Re-run: ask Claude "run the solution health check". Config: \`${showPath(p, p.manifest)}\`.`);

if (!args['dry-run']) {
  writeFileSync(p.report, L.join('\n') + '\n');
  // State
  const state = { version: 1, lastRun: nowIso(), packages: {}, runtimes: {}, nuget: {}, apis: {} };
  for (const f of findings) {
    const entry = { level: f.level, since: f.since };
    if (f.area === 'package') state.packages[f.key] = entry;
    if (f.area === 'runtime') state.runtimes[f.key] = entry;
    if (f.area === 'nuget') state.nuget[f.key] = entry;
  }
  for (const a of apis?.apis || []) {
    const prevApi = prev.apis?.[a.name] || {};
    const f = findings.find((x) => x.key === `api:${a.name}`);
    const pages = {};
    for (const pg of a.pages) {
      const old = prevApi.pages?.[pg.url];
      const accept = pg.hash && (!pg.needsReview || pg.assessment);
      if (accept) {
        const src = join(p.runDir, 'pending-snapshots', `${pg.snapshotName}.txt`);
        if (existsSync(src)) copyFileSync(src, join(p.snapshotDir, `${pg.snapshotName}.txt`));
        pages[pg.url] = { hash: pg.hash, checkedAt: nowIso(), changedAt: pg.change === 'changed' || !old ? today : old?.changedAt, lastAssessment: pg.assessment || old?.lastAssessment || null };
      } else if (old) pages[pg.url] = { ...old, checkedAt: nowIso(), pendingReview: !!pg.needsReview };
      else pages[pg.url] = { hash: null, checkedAt: nowIso(), pendingReview: !!pg.needsReview };
    }
    state.apis[a.name] = { level: f?.level, since: f?.since, pages };
  }
  writeJson(p.state, state);
}
log(`${reds.length} red, ${ambers.length} amber, ${news.length} new since last run, ${changedUnassessed.length} changed page(s) unassessed, ${untracked.length} untracked host(s).`);
log(args['dry-run'] ? '(dry run: report and state not written)' : `→ ${showPath(p, p.report)} and ${showPath(p, p.state)}`);
void manifest;
