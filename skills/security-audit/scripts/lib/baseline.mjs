/**
 * Compare a scan with the last one, and carry triage verdicts over.
 *
 * Every hit and every dependency advisory gets a fingerprint (`fp`) that leaves out the line
 * number, so moving code does not make a finding "new". The last scan's findings.json is the
 * baseline; triage.json in the target folder holds the verdicts Claude wrote, keyed by fp:
 *
 *   { "version": 1, "findings": { "<fp>": { "verdict": "confirmed|needs-look|false-positive|accepted",
 *       "severity": "high|medium|low", "title": "…", "note": "…", "reason": "…", "expires": "YYYY-MM-DD", "at": "YYYY-MM-DD" } } }
 *
 * `accepted` (a known risk the team lives with) needs a reason and an expiry; until then the hit is
 * listed as accepted instead of open. An expired or reason-less acceptance counts as untriaged.
 */
import crypto from 'node:crypto';

export const VERDICTS = ['confirmed', 'needs-look', 'false-positive', 'accepted'];

const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
/** A secret is identified by its (redacted) value, other hits by the line without trailing punctuation. */
export const hitFp = (id, file, text, match) => h(`${id}|${file}|${match || String(text).replace(/\s+/g, ' ').trim().replace(/[\s,;{]+$/, '')}`);
export const depFp = (ecosystem, name, version, vulnId) => h(`dep|${ecosystem}|${name}|${version}|${vulnId}`);

/** Every item in a findings.json, flat: { fp, kind: code|history|dep, id, file, line, text, severity }. */
export function items(report) {
  const out = [];
  for (const r of report?.rules || []) for (const x of r.hits) out.push({ fp: x.fp || hitFp(r.id, x.file, x.text, x.match), kind: 'code', id: r.id, file: x.file, line: x.line, text: x.text, match: x.match, severity: r.severity, ref: x });
  for (const x of report?.history?.hits || []) out.push({ fp: x.fp || hitFp(x.id, x.file, x.text, x.match), kind: 'history', id: x.id, file: x.file, line: x.line, text: x.text, severity: 'high', ref: x });
  for (const p of report?.deps?.vulnerable || []) for (const v of p.vulns || []) out.push({ fp: v.fp || depFp(p.ecosystem, p.name, p.version, v.id), kind: 'dep', id: v.id, file: (p.files || [])[0] || null, line: 0, text: `${p.ecosystem} ${p.name}@${p.version}: ${v.summary || ''}`.trim(), severity: String(v.severity || '').toLowerCase(), ref: v });
  return out;
}

/** The triage entry that applies today, or null (unknown fp, expired or reason-less acceptance). */
export function activeTriage(entry, today = new Date().toISOString().slice(0, 10)) {
  if (!entry || !VERDICTS.includes(entry.verdict)) return null;
  if (entry.verdict === 'accepted' && (!entry.reason || !entry.expires || entry.expires < today)) return null;
  return entry;
}

/**
 * annotate(report, { baseline, triage, from, today }) — mutates `report`:
 * each hit/advisory gets `fp`, `status` ('new' | 'open', only when there is a baseline) and
 * `triage` (the verdict that applies). report.baseline summarises new / still open / fixed.
 * "Fixed" leaves out baseline items whose verdict was false-positive: they were never problems.
 * A secret now reported under another rule (same file, same redacted value; say a generic hit in
 * umbraco-cloud.json that the platform rule took over) is not "fixed" or "new": it is open, and an
 * accepted or false-positive verdict on the old fingerprint carries over to it.
 */
export function annotate(report, { baseline = null, triage = null, from = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const tri = triage?.findings || {};
  const now = items(report);
  const before = baseline ? new Map(items(baseline).map((x) => [x.fp, x])) : null;
  const counts = { new: 0, open: 0, fixed: 0, falsePositive: 0, accepted: 0, untriaged: 0, expired: 0 };
  const secretKey = (x) => (x.kind === 'code' && x.match ? `${x.file}|${x.match}` : null);
  const moved = new Map(); // secretKey → baseline item under another rule id
  if (before) for (const b of before.values()) if (secretKey(b) && !moved.has(secretKey(b))) moved.set(secretKey(b), b);
  const movedFrom = (x) => { const b = secretKey(x) && moved.get(secretKey(x)); return b && b.id !== x.id && !before.has(x.fp) ? b : null; };
  for (const x of now) {
    x.ref.fp = x.fp;
    const prev = before ? movedFrom(x) : null;
    if (prev) x.ref.movedFrom = { id: prev.id, fp: prev.fp };
    let t = activeTriage(tri[x.fp], today);
    if (!t && prev && ['accepted', 'false-positive'].includes(tri[prev.fp]?.verdict)) t = activeTriage(tri[prev.fp], today);
    if (t) x.ref.triage = { verdict: t.verdict, severity: t.severity || null, note: t.note || t.reason || null, ...(t.expires ? { expires: t.expires } : {}) };
    else if (tri[x.fp]?.verdict === 'accepted') { x.ref.triage = { verdict: 'expired', note: `acceptance ${tri[x.fp].expires ? `expired ${tri[x.fp].expires}` : 'has no reason or expiry'}: re-triage` }; counts.expired++; }
    if (t?.verdict === 'false-positive') counts.falsePositive++;
    else if (t?.verdict === 'accepted') counts.accepted++;
    else if (!t) counts.untriaged++;
    if (before) {
      x.ref.status = before.has(x.fp) || x.ref.movedFrom ? 'open' : 'new';
      if (t?.verdict !== 'false-positive' && t?.verdict !== 'accepted') counts[x.ref.status]++;
    }
  }
  if (!before) { report.baseline = { from: null, counts }; return report; }
  const present = new Set(now.map((x) => x.fp));
  for (const x of now) if (x.ref.movedFrom) present.add(x.ref.movedFrom.fp);
  const fixed = [];
  for (const [fp, x] of before) {
    if (present.has(fp)) continue;
    const v = tri[fp]?.verdict || x.ref.triage?.verdict;
    if (v === 'false-positive') continue;
    fixed.push({ fp, kind: x.kind, id: x.id, file: x.file, line: x.line, text: x.text, severity: tri[fp]?.severity || x.severity, verdict: v || null });
  }
  counts.fixed = fixed.length;
  report.baseline = { from, at: baseline.startedAt || null, counts, fixed };
  return report;
}

/** Lines for the stdout summary. */
export function baselineLines(b) {
  if (!b) return [];
  const c = b.counts;
  const tri = `triage carried over: ${c.falsePositive} false positive, ${c.accepted} accepted${c.expired ? `, ${c.expired} acceptance(s) expired` : ''}; ${c.untriaged} to triage`;
  if (!b.from) return [`BASELINE  none (first run for this target). ${tri}`];
  const L = [`BASELINE  ${b.from}${b.at ? ` (${b.at.slice(0, 10)})` : ''}: ${c.new} new, ${c.open} still open, ${c.fixed} fixed. ${tri}`];
  for (const f of b.fixed.slice(0, 15)) L.push(`  fixed  ${f.id}  ${f.file || ''}${f.line ? `:${f.line}` : ''}${f.verdict ? ` (was ${f.verdict})` : ''}  ${String(f.text).slice(0, 90)}`);
  if (b.fixed.length > 15) L.push(`  … ${b.fixed.length - 15} more in findings.json`);
  return L;
}

/** Short tag for a hit in the summary: [new], [fp], [confirmed], … */
export function tag(x) {
  const t = [];
  if (x.status === 'new') t.push('new');
  if (x.triage) t.push(x.triage.verdict === 'false-positive' ? 'fp' : x.triage.verdict);
  return t.length ? ` [${t.join(', ')}]` : '';
}
