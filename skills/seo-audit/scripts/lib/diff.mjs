/**
 * "Since last run": compare this run's rows with the previous report.json's.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
const BAD = new Set(['fail', 'warn']);

/** diffRows(prevRows, rows) -> { fixed, regressed, changed } (each [{ id, title, was, now }]). */
export function diffRows(prevRows = [], rows = []) {
  const before = new Map(prevRows.map((r) => [r.id, r]));
  const fixed = []; const regressed = []; const changed = [];
  for (const r of rows) {
    const p = before.get(r.id);
    const was = p?.status || null;
    if (was === r.status || r.status === 'skip' || was === 'skip') continue;
    const row = { id: r.id, title: r.title, was, now: r.status, evidence: r.evidence };
    if (BAD.has(was) && !BAD.has(r.status)) fixed.push(row);
    else if (BAD.has(r.status) && (!was || !BAD.has(was) || (was === 'warn' && r.status === 'fail'))) regressed.push(row);
    else if (BAD.has(was) && BAD.has(r.status)) changed.push(row);
  }
  for (const p of prevRows) if (BAD.has(p.status) && !rows.some((r) => r.id === p.id)) fixed.push({ id: p.id, title: p.title, was: p.status, now: null });
  return { fixed, regressed, changed };
}

/** Markdown lines for the section; `extra` are lead lines (eco-audit puts the CO2e change there). */
export function diffMarkdown(diff, { from, date, extra = [] } = {}) {
  const out = ['## Since last run', '', `Compared with \`${from}\`${date ? ` (${date})` : ''}.`, ''];
  for (const l of extra) out.push(l);
  if (extra.length) out.push('');
  const list = (title, rows) => {
    if (!rows.length) return;
    out.push(`**${title}**`, '');
    for (const r of rows) out.push(`- ${r.title}: ${r.was || 'new'} → ${r.now || 'no longer checked'}${r.now && r.evidence ? ` (${r.evidence})` : ''}`);
    out.push('');
  };
  list('Fixed', diff.fixed);
  list('New or worse', diff.regressed);
  list('Still open, status changed', diff.changed);
  if (!diff.fixed.length && !diff.regressed.length && !diff.changed.length) out.push('No check changed status.', '');
  return out;
}
