#!/usr/bin/env node
/**
 * The facts a report is written from, for a period and an audience: what changed, what was decided,
 * what is waiting and on whom. It selects; the skill writes the prose. Nothing here is a judgement:
 * a change is "for the client" when it touches a file the client reads, and that is all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, section } from './lib/md.mjs';
import { load, args, bumps } from './lib/project.mjs';
import { status } from './status.mjs';

export const AUDIENCES = ['client', 'pm', 'tech'];
const USAGE = `Usage: report.mjs --root DIR --for client|pm|tech[,...] [--since YYYY-MM-DD|Nd] [--until YYYY-MM-DD] [--today YYYY-MM-DD]`;
/** Which files each audience reads. `null` is all of them. A file outside the starting set follows its folder. */
const READS = {
  client: (f) => /^project\/(foundation\/(?!technical-context)|intent\/|building-blocks\/)/.test(f.rel),
  pm: null,
  tech: (f) => /^project\/(foundation\/technical-context|tech\/|building-blocks\/)/.test(f.rel) || f.key === 'boundaries',
};
const iso = (d) => d.toISOString().slice(0, 10);

export function period(since, until, today) {
  const end = until ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('--until is YYYY-MM-DD');
  let start = null;
  if (since) {
    const n = String(since).match(/^(\d+)d$/);
    if (n) start = iso(new Date(Date.parse(end) - Number(n[1]) * 86400000));
    else if (/^\d{4}-\d{2}-\d{2}$/.test(since)) start = since;
    else throw new Error('--since is YYYY-MM-DD or a number of days, such as 7d');
    if (start > end) throw new Error('--since is after --until');
  }
  return { since: start, until: end };
}

export function report(root, { audience, since = null, until = null, today = iso(new Date()) } = {}) {
  if (!AUDIENCES.includes(audience)) throw new Error(`--for is one of ${AUDIENCES.join(', ')}`);
  const s = status(root, { today });
  if (!s.setUp) throw new Error('no project here: run /project:new');
  const p = period(since, until, today);
  const { changes, written } = load(root);
  const reads = READS[audience];
  const mine = new Set(written.filter((f) => !reads || reads(f)).map((f) => f.key));
  const inPeriod = (c) => (!p.since || String(c.meta.date) >= p.since) && String(c.meta.date) <= p.until;
  const touches = (c) => bumps(c.meta).some((b) => mine.has(b.file));
  const isDecision = (c) => c.meta.decision && c.meta.decision !== 'none';
  const row = (c) => ({
    name: c.key, date: c.meta.date, title: c.data.description, asked_by: c.meta.asked_by,
    files: bumps(c.meta).filter((b) => mine.has(b.file)).map((b) => `${b.file} (${b.level})`),
    decision: c.meta.decision ?? 'none', supersedes: list(c.meta.supersedes),
    why: section(c.body, 'Why'), deltas: section(c.body, 'Deltas'), decided: section(c.body, 'Decision'), hooks: section(c.body, 'Hooks'),
  });
  // A decision is everyone's business; a plain change is reported to those who read the file it changed.
  const applied = changes.filter((c) => c.meta.status === 'applied' && inPeriod(c) && (isDecision(c) || touches(c)));
  const supersededNow = new Set(applied.flatMap((c) => list(c.meta.supersedes)));
  const forMe = (q) => !reads || mine.has(q.file) || (audience === 'client' && /^client/.test(q.role));
  const versions = written.filter((f) => mine.has(f.key)).map((f) => ({ file: f.rel, version: f.meta.version, status: f.meta.status, updated: f.meta.updated }));
  const out = `project/memory/reports/${p.until}-${audience}.md`;
  return {
    root, audience, period: p, phase: s.phase, size: s.size, kind: s.kind,
    progress: { answered: s.questions.answered, total: s.questions.total, files: versions },
    decisions: applied.filter(isDecision).map(row),
    reversed: changes.filter((c) => supersededNow.has(c.key)).map((c) => ({ name: c.key, title: c.data.description, date: c.meta.date })),
    changes: applied.filter((c) => !isDecision(c)).map(row),
    waiting: {
      proposed: s.waiting.proposed,
      onClient: [...s.waiting.parked, ...s.waiting.skipped].filter((q) => /^client/.test(q.role) || /\bclient\b/i.test(q.note)),
      parked: s.waiting.parked.filter(forMe),
      skipped: s.waiting.skipped.filter(forMe),
    },
    attention: audience === 'client' ? {} : { stale: s.stale, nearBudget: s.nearBudget, ...(audience === 'tech' ? { missingPaths: s.drift.missingPaths } : {}), errors: s.findings.filter((f) => f.level === 'error') },
    empty: !applied.length,
    saveAs: out,
    exists: fs.existsSync(path.join(root, out)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const a = args(process.argv.slice(2), { help: 'bool' });
  if (a.help || !a.root || !a.for) { console.log(USAGE); process.exit(a.help ? 0 : 2); }
  try {
    const root = path.resolve(a.root);
    const r = String(a.for).split(',').map((x) => x.trim()).filter(Boolean).map((audience) => report(root, { audience, since: a.since, until: a.until, today: a.today }));
    console.log(JSON.stringify(r.length === 1 ? r[0] : r, null, 2));
  } catch (e) { console.error(e.message); process.exit(2); }
}
