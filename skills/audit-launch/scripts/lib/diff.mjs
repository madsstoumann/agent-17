/**
 * "Since last run": compare a previous report.json with the current one.
 */
import { STATUS_ORDER } from './registry.mjs';

const BAD = new Set(['warn', 'fail']);
const keyOf = (r) => (r.subject ? `${r.id}@${r.subject}` : r.id);

/** Nested object -> { 'a.b.c': number } for every finite numeric leaf (arrays ignored). */
export function flattenNumbers(obj, prefix = '') {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenNumbers(v, key));
  }
  return out;
}

/**
 * diffReports(prev, cur) -> { fixed, regressed, newFindings, removed, unchanged, scores, envChanged, prevGeneratedAt, error? }
 * Each entry: { key, id, subject, title, from, to }. Scores: { key, from, to, delta } for numbers present in both scoreboards.
 */
export function diffReports(prev, cur) {
  if (!prev || !Array.isArray(prev.results)) return { error: 'baseline has no results', fixed: [], regressed: [], newFindings: [], removed: [], unchanged: 0, scores: [], envChanged: null, prevGeneratedAt: null };
  const before = new Map(prev.results.map((r) => [keyOf(r), r]));
  const after = new Map((cur.results || []).map((r) => [keyOf(r), r]));
  const entry = (key, a, b) => ({ key, id: (b || a).id, subject: (b || a).subject || null, title: (b || a).title, from: a ? a.status : null, to: b ? b.status : null });
  const fixed = []; const regressed = []; const newFindings = []; const removed = []; let unchanged = 0;
  for (const [key, b] of after) {
    const a = before.get(key);
    if (!a) { if (BAD.has(b.status)) newFindings.push(entry(key, null, b)); continue; }
    if (a.status === b.status) { unchanged++; continue; }
    const rose = STATUS_ORDER[b.status] > STATUS_ORDER[a.status];
    if (rose && BAD.has(b.status)) regressed.push(entry(key, a, b));
    else if (!rose && BAD.has(a.status) && !BAD.has(b.status)) fixed.push(entry(key, a, b));
    else unchanged++;
  }
  for (const [key, a] of before) if (!after.has(key) && BAD.has(a.status)) removed.push(entry(key, a, null));
  const pn = flattenNumbers(prev.scoreboard || {}); const cn = flattenNumbers(cur.scoreboard || {});
  const scores = Object.keys(cn).filter((k) => k in pn && pn[k] !== cn[k]).map((k) => ({ key: k, from: pn[k], to: cn[k], delta: Math.round((cn[k] - pn[k]) * 1000) / 1000 }));
  const envFrom = prev.input?.env || null; const envTo = cur.input?.env || null;
  return {
    fixed, regressed, newFindings, removed, unchanged, scores,
    envChanged: envFrom && envTo && envFrom !== envTo ? { from: envFrom, to: envTo } : null,
    prevGeneratedAt: prev.generatedAt || null,
  };
}
