// Turns red and amber findings into fix tasks in the shape audit-all's tasks.json uses (see audit-all's
// SKILL.md, "Write tasks.json"), so audit-all and audit-fix can take them as they are. Claude may refine
// them (a replacement it found, a better model tier) before they are used; the script writes a first draft.
import { basename } from 'node:path';
import { isNewer } from './versions.mjs';

const SEVERITY = { red: 'high', amber: 'medium' };
// Frameworks whose major upgrade is a project, not a version bump.
const FRAMEWORK = /^(umbraco\.|next$|nuxt$|react$|react-dom$|@angular\/core$|vue$|svelte$|@sveltejs\/kit$|gatsby$|astro$|microsoft\.aspnetcore\.|microsoft\.entityframeworkcore|episerver\.|optimizely\.|sitecore\.)/i;
const fileOf = (source) => String(source).split(' (')[0];
const majorOf = (v) => Number(String(v || '').replace(/^[^\d]*/, '').split('.')[0]);

function packageTask(f, repo) {
  const x = f.extra; const r = f.reasons.join(' ');
  const eco = x.ecosystem;
  // A deprecated *installed* version only means "upgrade"; the package itself is gone or dying when the
  // latest is deprecated too, the repo is archived, it is unpublished, or nobody has touched it in years.
  const replace = !!x.facts?.deprecatedLatest || /package deprecated|archived|not found on the public registry|no release in .* no commits|ecosyste\.ms status/.test(r);
  const vuln = (x.vulnerabilities || []).length > 0;
  const latest = x.facts?.latest;
  const major = latest && x.installed && majorOf(latest) > majorOf(x.installed);
  let title; let fix; let model;
  if (replace) {
    title = `Replace ${x.name}`;
    fix = x.facts?.alternative ? `Move from ${x.name} to ${x.facts.alternative}, the replacement the registry names, and remove ${x.name}.` : `Move to a maintained alternative to ${x.name} (check the deprecation message and the repo README for a successor) and remove it.`;
    model = 'sonnet';
  } else if (vuln) {
    // npm audit names the smallest fixing version, which is often a minor inside the current major.
    const fa = x.vulnerabilities.map((v) => v.fixAvailable).find((v) => v && typeof v === 'object' && v.name === x.name);
    title = `Fix the vulnerable ${x.name} ${x.installed || ''}`.trim();
    fix = fa ? `Upgrade ${x.name} to ${fa.version} or later${fa.isSemVerMajor ? ' (a major upgrade: follow its migration notes)' : ''}; \`npm audit fix\` (never \`--force\`) may do it.`
      : `Upgrade ${x.name} to a version without the advisories${latest ? ` (latest is ${latest})` : ''}${eco === 'npm' ? '; try `npm audit fix` (never `--force`) first' : ''}.`;
    model = (fa ? fa.isSemVerMajor : major) ? 'sonnet' : 'haiku';
  } else {
    // Amber for being quiet (no release in a year, a low Scorecard) is a watch item, not a task: there is
    // nothing to upgrade to unless the registry has a newer version than the one installed.
    if (!isNewer(latest, x.installed)) return null;
    title = `Upgrade ${x.name} ${x.installed} to ${latest}`;
    fix = `Upgrade ${x.name} to ${latest}, following its migration notes for each major version in between.${x.facts?.pinnedTo ? ` Stay on ${x.facts.pinnedTo.major}.x: it matches Node ${x.facts.pinnedTo.major}, which the project runs on (${x.facts.pinnedTo.source}).` : ''}`;
    model = FRAMEWORK.test(x.name) ? 'opus' : 'sonnet';
  }
  return {
    title, owner: 'agent', model, area: 'dependencies', repo, files: x.files || x.projects || f.where || [],
    evidence: `${f.title}: ${f.reasons.join('; ')}`, fix,
    verify: eco === 'npm'
      ? `\`npm ls ${x.name}\` shows the new version (or nothing, if replaced); \`npm audit\` lists nothing for it; the build and tests pass.`
      : `\`dotnet build\` passes; \`dotnet list package --vulnerable --deprecated --include-transitive\` no longer lists ${x.name}.`,
  };
}

function transitiveTask(f, repo) {
  const x = f.extra;
  const easy = x.fixes.some((s) => /npm audit fix|^upgrade .*\d$/.test(s));
  return {
    title: `Fix the vulnerable transitive ${x.name}`, owner: 'agent', model: easy ? 'haiku' : 'sonnet', area: 'dependencies', repo,
    files: x.ecosystem === 'npm' ? x.projects.flatMap((p) => [p, p.replace(/package\.json$/, 'package-lock.json')]) : x.projects,
    evidence: `${f.title}: ${f.reasons.join('; ')}`,
    fix: x.ecosystem === 'npm'
      ? `${x.fixes.join('; ') || 'Upgrade the package that pulls it in'}. If no parent release fixes it, add an \`overrides\` entry for a fixed ${x.name} and check the parent still works.`
      : `Upgrade ${x.parents.join(', ') || 'the package that pulls it in'} to a version that depends on a fixed ${x.name}, or add a direct PackageReference to a fixed ${x.name}.`,
    verify: x.ecosystem === 'npm' ? `\`npm audit\` no longer lists ${x.name}; the build and tests pass.` : `\`dotnet list package --vulnerable --include-transitive\` no longer lists ${x.name}; \`dotnet build\` passes.`,
  };
}

function licenceTask(f) {
  const x = f.extra;
  return {
    title: `Decide on the ${x.license || 'missing'} licence of ${x.name}`, owner: 'human', area: 'licences',
    evidence: `${x.ecosystem} ${x.name} ${x.versions.join(', ')} (${x.direct ? 'direct' : 'transitive'}, ${x.dev ? 'dev only' : 'shipped'}): ${f.reasons.join('; ')}`,
    fix: `Confirm how ${x.name} is used. If it is shipped or served to users, replace it with a permissively licensed alternative (an agent can do that once you pick one), buy a commercial licence, or record the decision as a \`licenses.accept\` entry in the solution-health manifest.`,
  };
}

function runtimeTask(f, repo, pkgs) {
  const x = f.extra;
  // Frameworks found through a package ("npm package next") point at that package's files, and take over its task.
  const fromPkg = (x.sources || []).map((s) => String(s).match(/^(npm|nuget) package (.+)$/)).filter(Boolean).map((m) => pkgs.get(`pkg:${m[1]}:${m[2].toLowerCase()}`)).filter(Boolean);
  return {
    title: `Upgrade ${x.product} ${x.cycle ?? x.version}${x.newestCycle ? ` to ${x.newestCycle}` : ''}`, owner: 'agent', model: 'opus', area: 'runtime', repo,
    files: [...new Set([...(x.sources || []).filter((s) => !/^(npm|nuget) package /.test(s)).map(fileOf), ...fromPkg.flatMap((p) => p.extra.files || p.where || [])])],
    evidence: [`${f.title}: ${f.reasons.join('; ')}`, ...fromPkg.map((p) => `${p.title}: ${p.reasons.join('; ')}`)].join('. '),
    absorbs: fromPkg.map((p) => p.key),
    fix: `Move ${x.product} to a supported release${x.newestCycle ? ` (newest is ${x.newestCycle})` : ''}, everywhere it is pinned, and follow the upgrade guide for each major in between.`,
    verify: 'The build, tests and app start pass on the new version; the next solution-health run shows it green.',
  };
}

function apiTask(f, repo) {
  const x = f.extra;
  const action = (x.pages || []).map((pg) => pg.assessment?.action).find(Boolean);
  const known = x.replacement || action;
  return {
    title: known ? `Migrate off ${x.name}` : `Decide what replaces ${x.name}`, owner: known ? 'agent' : 'human', model: known ? 'opus' : undefined, area: 'external-api',
    repo: known ? repo : undefined, files: known ? x.codeFiles || [] : undefined,
    evidence: `${f.title}: ${f.reasons.join('; ')}`,
    fix: action || (x.replacement ? `Move the calls to ${x.replacement}.` : `Find the provider's replacement (see the watched pages) and plan the migration${x.sunset ? ` before ${x.sunset}` : ''}.`),
    verify: known ? `No code references ${(x.hosts || []).join(', ')}; the feature that used it still works.` : undefined,
  };
}

// Amber licences are mostly a licence the scan could not name (a URL, a licence file, none declared) that
// turns out fine once read. One review task lists them all instead of one task per package.
function licenceReviewTask(list) {
  const lines = list.map((f) => `${f.extra.ecosystem} ${f.extra.name} (${f.extra.license || 'none'}${f.extra.direct ? '' : ', transitive'})`);
  return {
    title: `Check ${list.length} licence${list.length === 1 ? '' : 's'} the scan could not clear`, owner: 'human', area: 'licences',
    evidence: lines.join('; '),
    fix: 'Read each licence (the package folder, its repo, or the URL given). Record the fine ones in the solution-health manifest (`licenses.allow` for a licence id, `licenses.accept` with a reason for a package) so they stop coming back; replace or buy a licence for any that are not.',
  };
}

const nugetTask = (f) => ({
  title: `Fix the NuGet source: ${f.title}`, owner: 'human', area: 'nuget',
  evidence: `${f.title}: ${f.reasons.join('; ')}`,
  fix: 'Correct the NuGet.config or feed so restore works on every machine and in CI (missing folders, dead or plain-http feeds, unset variables, package source mapping).',
});

function mergeTarget(f, byKey, absorbed) {
  const x = f.extra;
  const parents = x.fixes.map((s) => (s.match(/^upgrade (\S+) to \S+/) || [])[1]).filter(Boolean);
  if (!parents.length || parents.length !== x.fixes.length) return null;
  const targets = [...new Set(parents.map((n) => { const k = `pkg:${x.ecosystem}:${n.toLowerCase()}`; return byKey.get(absorbed.get(k) || k); }))];
  return targets.length === 1 && targets[0] ? targets[0] : null;
}

/** Build { subject, repos, tasks } from finalize's findings. Only red and amber, never ignored. */
export function buildTasks(findings, { root }) {
  const repo = basename(root);
  const pkgs = new Map(findings.filter((f) => f.area === 'package').map((f) => [f.key, f]));
  const absorbed = new Map(); // package finding key -> runtime finding key that takes over its task
  for (const f of findings) if (f.area === 'runtime' && SEVERITY[f.level]) for (const k of runtimeTask(f, repo, pkgs).absorbs) absorbed.set(k, f.key);
  const tasks = [];
  const byKey = new Map();
  const licenceReview = findings.filter((f) => f.area === 'licence' && f.level === 'amber');
  for (const f of findings) {
    if (!SEVERITY[f.level]) continue;
    if (f.area === 'licence' && f.level === 'amber') {
      if (f !== licenceReview[0]) continue;
      const t = licenceReviewTask(licenceReview);
      tasks.push({ id: null, ...t, severity: 'medium', sources: ['health'], refs: [`solution-health-${repo}/report.md`], key: 'lic:review' });
      continue;
    }
    let t = null;
    if (f.area === 'package') { if (!absorbed.has(f.key)) t = packageTask(f, repo); }
    else if (f.area === 'vulnerability') {
      // "upgrade express to 4.22.3" when express already has a task: one upgrade, one task.
      const into = mergeTarget(f, byKey, absorbed);
      if (into) {
        into.evidence += ` Also fixes the vulnerable transitive ${f.extra.name}${f.extra.versions.length ? `@${f.extra.versions.join(', ')}` : ''} (${f.extra.severity}).`;
        if (f.level === 'red') into.severity = 'high';
        continue;
      }
      t = transitiveTask(f, repo);
    }
    else if (f.area === 'licence') t = licenceTask(f);
    else if (f.area === 'runtime') { const { absorbs, ...rt } = runtimeTask(f, repo, pkgs); t = rt; }
    else if (f.area === 'api') t = apiTask(f, repo);
    else if (f.area === 'nuget') t = nugetTask(f);
    if (!t) continue;
    const task = Object.fromEntries(Object.entries({ id: null, ...t, severity: SEVERITY[f.level], sources: ['health'], refs: [`solution-health-${repo}/report.md`], key: f.key }).filter(([, v]) => v !== undefined));
    tasks.push(task);
    byKey.set(f.key, task);
  }
  // Most severe first, then by area so related work sits together.
  tasks.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
  tasks.forEach((t, i) => { t.id = `H${i + 1}`; });
  return { subject: repo, repos: { [repo]: root }, tasks };
}
