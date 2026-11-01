/**
 * The check registry: what a CheckResult looks like, the twelve report groups,
 * the environment policy (dev/staging vs production) and the group runner that
 * turns a crashed or hung group into one skip row instead of a dead audit.
 */
import { withTimeout } from './http.mjs';

export const STATUSES = ['pass', 'warn', 'fail', 'info', 'skip'];
/** Higher = worse; used by the baseline diff to decide "regressed" vs "fixed". */
export const STATUS_ORDER = { pass: 0, info: 1, skip: 2, warn: 3, fail: 4 };

/** Report sections in order. `prefixes` are the check-id prefixes that belong to the section. */
export const GROUPS = [
  { id: 'crawl', order: 1, title: 'Crawlability & staging leftovers', prefixes: ['crawl'] },
  { id: 'redirects', order: 2, title: 'Redirects', prefixes: ['redirects'] },
  { id: 'notfound', order: 3, title: 'Real 404s', prefixes: ['notfound'] },
  { id: 'tls', order: 4, title: 'TLS, DNS & email', prefixes: ['tls', 'dns', 'email', 'hsts'] },
  { id: 'exposed', order: 5, title: 'Exposed files & admin paths', prefixes: ['exposed'] },
  { id: 'headers', order: 6, title: 'Security headers & CSP', prefixes: ['headers'] },
  { id: 'caching', order: 7, title: 'Caching, compression & protocol', prefixes: ['caching'] },
  { id: 'perf', order: 8, title: 'Performance', prefixes: ['perf'] },
  { id: 'a11y', order: 9, title: 'Accessibility', prefixes: ['a11y'] },
  { id: 'privacy', order: 10, title: 'Privacy & cookies', prefixes: ['privacy'] },
  { id: 'links', order: 11, title: 'Links, mixed content, social previews & icons', prefixes: ['links', 'social', 'icons'] },
  { id: 'ops', order: 12, title: 'Operational readiness', prefixes: ['ops'] },
];

export function groupOf(id) {
  const prefix = String(id).split('.')[0];
  return GROUPS.find((g) => g.prefixes.includes(prefix)) || null;
}

/**
 * result(id, status, title, evidence, extra) -> CheckResult
 *   { id, group, status, title, evidence, fix, link?, subject?, blocker?, beforeProduction?, data? }
 * `beforeProduction: true` marks a finding that is normal on dev/staging but must be reversed at launch.
 */
export function result(id, status, title, evidence, extra = {}) {
  if (!STATUSES.includes(status)) throw new Error(`bad status "${status}" for ${id}`);
  const g = groupOf(id);
  return { id, group: g ? g.id : String(id).split('.')[0], status, title, evidence: String(evidence ?? ''), fix: '', ...extra };
}

/**
 * applyEnvPolicy(results, { production, env }) -> { results, beforeProduction }
 * dev/staging: beforeProduction findings become info and are collected as the launch-day checklist.
 * production: a beforeProduction fail is a blocker. Other blockers are set explicitly by the check (`blocker: true`).
 */
export function applyEnvPolicy(results, { production, env = production ? 'production' : 'dev' }) {
  const beforeProduction = [];
  const out = results.map((r) => {
    const c = { ...r };
    if (c.beforeProduction && !production && (c.status === 'fail' || c.status === 'warn')) {
      beforeProduction.push({ id: c.id, title: c.title, originalStatus: c.status, evidence: c.evidence, fix: c.fix });
      c.status = 'info';
      c.evidence = `${c.evidence} (expected on ${env} — reverse before production)`;
      return c;
    }
    if (c.beforeProduction && production && c.status === 'fail') c.blocker = true;
    if (c.status !== 'fail') delete c.blocker;
    return c;
  });
  return { results: out, beforeProduction };
}

export function countStatuses(results) {
  const counts = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

function matches(selector, id) {
  if (selector === id) return true;
  const g = GROUPS.find((x) => x.id === selector || x.prefixes.includes(selector));
  if (!g) return false;
  return g.prefixes.includes(String(id).split('.')[0]);
}

/** --skip / --only on a single check id: a selector is the id itself, its prefix or its group. */
export function isSkipped(id, { skip = [], only = [] }) {
  if (skip.some((s) => matches(s, id))) return true;
  if (only.length) return !only.some((s) => matches(s, id));
  return false;
}

/** --skip / --only on whole groups (a check id inside --only keeps its group). */
export function filterGroups(groups, { skip = [], only = [] }) {
  const groupHit = (g, s) => s === g.id || g.prefixes.includes(s) || g.prefixes.includes(String(s).split('.')[0]);
  return groups.filter((g) => {
    if (skip.some((s) => s === g.id || g.prefixes.includes(s))) return false;
    if (only.length && !only.some((s) => groupHit(g, s))) return false;
    return true;
  });
}

/**
 * runGroups(groups, ctx, { log, defaultBudget }) -> { results, timings }
 * Every group runs concurrently under its own budget; a throw, a timeout or a
 * non-array return becomes a single `<group>.error` skip row.
 */
export async function runGroups(groups, ctx, { log = () => {}, defaultBudget = 60000 } = {}) {
  const timings = {};
  const settled = await Promise.allSettled(groups.map(async (g) => {
    const started = Date.now();
    try {
      const rows = await withTimeout(Promise.resolve().then(() => g.run(ctx)), g.budget || defaultBudget, g.title || g.id);
      if (!Array.isArray(rows)) throw new Error(`${g.id} returned ${typeof rows}, not an array`);
      return rows;
    } finally {
      timings[g.id] = Date.now() - started;
      log(`${g.id}: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  }));
  const results = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') results.push(...s.value);
    else results.push(result(`${groups[i].id}.error`, 'skip', `${groups[i].title || groups[i].id} could not run`, s.reason?.message || String(s.reason), { fix: 'Re-run; if it repeats, run with --skip for this group and report the error.' }));
  });
  return { results, timings };
}
