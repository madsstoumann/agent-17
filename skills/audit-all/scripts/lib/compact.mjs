// The compact version of a sub-report: the same sections, with long URL, package and cookie lists
// cut to a few rows, passing and skipped check rows dropped, and reference sections left out.
// Runs on the parsed blocks before rendering, so the report's own Markdown and layout are unchanged.
import { plain } from './markdown.mjs';

export const KEEP = 5;
const DROP_SECTIONS = /^(\d+\.\s*)?(not covered|files|method|methodology|how this was checked|raw data|appendix|pages crawled|all pages|inventory|full inventory|manual checks)\b/i;
// In a check table, rows that need no action: kept out of the compact version and counted instead.
const QUIET = /(✅|⏭️|ℹ️|🟢|\bpass(ed|es)?\b|\bok\b|\bskip(ped)?\b|\binfo\b|\bgreen\b|\bnot checked\b|manual check|no automated failures|not applicable)/i;
const STATUS_HEAD = /^(status|result|)$/i;

const more = (n) => ({ type: 'para', lines: [`_…and ${n} more in the full report._`] });

/** Is this table a check list (a status column whose cells say pass, warn, fail and so on)? */
function statusColumn(table) {
  // A status column holds short labels only; a "Result" column of measurements is not one.
  const i = table.head.findIndex((h, n) => STATUS_HEAD.test(plain(h).trim()) && table.rows.every((r) => plain(r[n] || '').length <= 24));
  if (i < 0) return -1;
  return table.rows.some((r) => /(⚠️|❌|✅|ℹ️|🔴|🟠|🟢|fail|warn|pass|info)/i.test(r[i] || '')) ? i : -1;
}

/** A check table keeps every row that needs action and counts the rest; any other table (URLs,
 *  packages, cookies) is cut to KEEP rows. */
function compactTable(t) {
  const s = statusColumn(t);
  if (s >= 0) {
    const rows = t.rows.filter((r) => !QUIET.test(r[s] || ''));
    const quiet = t.rows.length - rows.length;
    const out = rows.length ? [{ ...t, rows }] : [];
    if (quiet) out.push({ type: 'para', quiet: true, lines: [`_${quiet} ${quiet === 1 ? 'check' : 'checks'} passed, skipped or for information only: see the full report._`] });
    return out;
  }
  if (t.rows.length <= KEEP) return [t];
  return [{ ...t, rows: t.rows.slice(0, KEEP) }, more(t.rows.length - KEEP)];
}

function compactList(l) {
  const items = l.items.slice(0, KEEP).map((it) => ({ ...it, children: compactBlocks(it.children) }));
  const out = [{ ...l, items }];
  if (l.items.length > KEEP) out.push(more(l.items.length - KEEP));
  return out;
}

/**
 * Detail subsections (### under a section). After a summary table they repeat it, so they are left
 * out; otherwise each keeps its heading and first paragraph (plus a **Fix:** line, if any).
 */
function compactDetails(blocks) {
  const first = blocks.findIndex((b) => b.type === 'heading' && b.level >= 3);
  if (first < 0) return blocks;
  const head = blocks.slice(0, first);
  if (head.some((b) => b.type === 'table')) return head;
  const out = [...head];
  let item = null;
  for (const b of blocks.slice(first)) {
    if (b.type === 'heading' && b.level >= 3) { item = { paras: 0, fix: false }; out.push(b); continue; }
    if (b.type === 'para' && /^\*\*Fix:?\*\*/.test(b.lines[0] || '') && !item.fix) { item.fix = true; out.push(b); continue; }
    if (b.type === 'para' && !item.paras) { item.paras++; out.push(b); continue; }
    if (b.type === 'list' && !item.paras) { item.paras++; out.push({ ...b, items: b.items.slice(0, 2), more: b.items.length > 2 }); }
  }
  return out;
}

/** Compact an array of blocks: long lists and tables cut, long code blocks dropped. */
export function compactBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'table') out.push(...compactTable(b));
    else if (b.type === 'list') out.push(...compactList(b));
    else if (b.type === 'code' && b.text.split('\n').length > 8) continue;
    else if (b.type === 'quote') out.push({ ...b, blocks: compactBlocks(b.blocks) });
    else out.push(b);
  }
  return out;
}

/** Compact a report split by splitReport: reference sections left out, the rest compacted, and
 *  sections with nothing left to act on named together in one "Nothing to fix" line at the end. */
export function compactReport({ title, intro, sections }) {
  const kept = [];
  const clean = [];
  for (const s of sections) {
    if (DROP_SECTIONS.test(plain(s.heading))) continue;
    const blocks = compactBlocks(compactDetails(s.blocks));
    // Only "N checks passed" left (an intro sentence aside): nothing to act on.
    const allQuiet = blocks.some((b) => b.quiet) && !blocks.some((b) => b.type === 'table' || b.type === 'list');
    if (!blocks.length || allQuiet) clean.push(plain(s.heading).replace(/^\d+\.\s*/, ''));
    else kept.push({ ...s, blocks });
  }
  if (clean.length) kept.push({ heading: 'Nothing to fix', blocks: [{ type: 'para', lines: [`${clean.join(', ')}: every check passed, was skipped or is for information only. Details in the full report.`] }] });
  return { title, intro, sections: kept };
}
