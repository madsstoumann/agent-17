// report.md and the stdout summary.
import { scLabel } from './wcag.mjs';
import { understandingUrl } from './findings.mjs';

const STATUS = { fail: 'Fails', review: 'Review', pass: 'No automated failures', manual: 'Manual check' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s) => (s ? `\`${String(s).replace(/`/g, "'")}\`` : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The one-line result audit-all reads: "**Result:** 3 criteria failed, 9 issues (…), 12 to review, 10 pages". */
export function resultLine(c) {
  const sev = ['blocker', 'high', 'medium', 'low'].filter((s) => c[s]).map((s) => `${c[s]} ${s}`).join(', ');
  return `${plural(c.criteriaFailed, 'criterion').replace('criterions', 'criteria')} failed, ${plural(c.issues, 'issue')}${sev ? ` (${sev})` : ''}, ${c.review} to review, ${plural(c.pages, 'page')}`;
}

export function verdict(c) {
  if (c.blocker) return 'Not conformant: a keyboard user can get stuck. Fix the blocker first.';
  if (c.criteriaFailed) return `Not conformant with WCAG 2.2 ${c.level || 'AA'}: ${plural(c.criteriaFailed, 'criterion').replace('criterions', 'criteria')} fail automated checks.`;
  if (c.review) return 'No automated failures. Some items need a person to look, and the manual checks below are still needed.';
  return 'No automated failures. Automated tools find only part of the problems, so do the manual checks below.';
}

export function buildMarkdown({ site, date, level, pages, agg, engines, version, manual, diff = null, notes = null, state = null }) {
  const c = { ...agg.counts, level };
  const L = [];
  L.push(`# Accessibility audit: ${new URL(site).host}`, '');
  L.push(`**Site:** ${site} · **Standard:** WCAG 2.2 ${level}, EN 301 549 v3.2.1 · **Date:** ${date.toISOString().slice(0, 10)} · **Engines:** ${engines.map((e) => `${e.name} ${e.version}${e.name === 'HTML_CodeSniffer' ? " (Pa11y's default engine)" : ''}`).join(', ')}, keyboard walk, reflow · a11y-audit ${version}`, '');
  L.push(`**Result:** ${resultLine(c)}`, '');
  L.push(`**Verdict:** ${verdict(c)}`, '');
  L.push('> Automated checks find roughly a third of WCAG problems. "No automated failures" is not conformance: the manual checks at the end decide that.', '');

  if (diff?.error) L.push('## Since last run', '', `Baseline not usable: ${diff.error}`, '');
  else if (diff) {
    L.push('## Since last run', '', `Compared with the run of ${diff.date ? diff.date.slice(0, 10) : 'an earlier date'} (\`${diff.from}\`): ${diff.fixed.length} fixed, ${diff.newIssues.length} new, ${diff.open.length} still open.`, '');
    const rows = [
      ...diff.fixed.map((i) => ['Fixed', i, '']),
      ...diff.newIssues.map((i) => ['New', i, `${i.pages} pages, ${i.count} elements`]),
      ...diff.open.map((i) => ['Still open', i, `${i.was.count} → ${i.count} elements`]),
    ];
    if (rows.length) {
      L.push('| Change | Issue | WCAG | Detail |', '|---|---|---|---|');
      for (const [what, i, d] of rows) L.push(`| ${what} | ${cell(i.title)} | ${(i.sc || []).join(', ')} | ${d} |`);
      L.push('');
    }
    if (diff.criteria.length) L.push(`Criteria that changed: ${diff.criteria.map((c) => `${c.sc} ${c.name} (${STATUS[c.from]} → ${STATUS[c.to]})`).join('; ')}.`, '');
  }
  if (notes) {
    L.push('## Notes', '', `_From \`notes.md\` in ${state ? `\`${state}\`` : 'the target folder'}, kept between runs._`, '');
    L.push(notes.trim().replace(/^(#{1,4}) /gm, (m, h) => `${'#'.repeat(Math.min(h.length + 2, 6))} `), '');
  }

  L.push('## Issues', '');
  if (!agg.issues.length) L.push('No automated failures.', '');
  else {
    L.push('| # | Severity | Issue | WCAG | EN 301 549 | Pages | Elements |', '|---|---|---|---|---|---|---|');
    for (const i of agg.issues) L.push(`| ${i.id} | ${cap(i.severity)} | ${cell(i.title)} | ${i.sc.join(', ')} | ${i.en.join(', ') || '–'} | ${i.pages.length} | ${i.count} |`);
    L.push('');
    for (const i of agg.issues) {
      L.push(`### ${i.id}. ${cell(i.title)}`, '');
      L.push(`**${cap(i.severity)}**${i.impact ? ` (axe impact: ${i.impact})` : ''} · ${i.sc.map(scLabel).join('; ') || 'no WCAG criterion'}${i.en.length ? ` · EN 301 549 ${i.en.join(', ')}` : ''} · found by ${i.engine}${i.rule ? ` (${code(i.rule)})` : ''}`, '');
      if (i.description && i.description !== i.title && i.description !== i.fix) L.push(i.description, '');
      L.push(`**Fix:** ${i.fix}${i.helpUrl && !i.fix.includes(i.helpUrl) ? ` ([rule](${i.helpUrl}))` : ''}`, '');
      L.push(`**Pages (${i.pages.length}):** ${i.pages.slice(0, 5).join(', ')}${i.pages.length > 5 ? `, and ${i.pages.length - 5} more` : ''}`, '');
      if (i.samples.length) {
        L.push('**Examples:**', '');
        for (const s of i.samples) L.push(`- ${code(s.target)}${s.summary ? `: ${cell(s.summary)}` : ''}${i.pages.length > 1 ? ` (${s.page})` : ''}${s.html ? `\n  ${code(s.html)}` : ''}`);
        L.push('');
      }
    }
  }

  L.push('## Keyboard', '');
  const walked = pages.filter((p) => p.keyboard);
  if (!walked.length) L.push('No keyboard walk was run (`--keyboard 0`).', '');
  else {
    L.push('| Page | Tab stops | Ends | Skip link | No focus style | Hidden | Covered |', '|---|---|---|---|---|---|---|');
    for (const p of walked) {
      const k = p.keyboard;
      const ends = k.trap ? { trap: '**Trapped**', 'modal-held': 'Held by a dialog', wraps: 'Wraps to the top', contained: 'Held, Escape releases' }[k.trap.verdict] : { 'left-document': 'Leaves the page', max: `Stopped after ${k.count}`, error: 'Walk failed' }[k.ended];
      L.push(`| ${p.url} | ${k.count}${k.expected ? ` of ~${k.expected}` : ''} | ${ends} | ${k.skipLink?.found ? 'Yes' : 'No'} | ${k.noIndicator.length} | ${k.hidden.length} | ${k.obscured.length} |`);
    }
    L.push('', 'The walk presses Tab from the top of the page with no mouse, like a keyboard user, and records every stop. "No focus style" compares each element focused and blurred; check those in a browser, since a style that only changes on `:focus-visible` for real keyboard input can be missed.', '');
  }

  L.push('## Reflow and text spacing', '');
  L.push('| Page | Width at 320 px | Clipped with text spacing |', '|---|---|---|');
  for (const p of pages.filter((x) => !x.error)) L.push(`| ${p.url} | ${p.reflow ? (p.reflow.overflow ? `**${p.reflow.scrollWidth}px** (scrolls sideways)` : 'Fits') : '–'} | ${p.textSpacing ? p.textSpacing.clipped : '–'} |`);
  L.push('');

  L.push('## Needs review', '');
  if (!agg.review.length) L.push('Nothing flagged for review.', '');
  else {
    L.push('| Item | WCAG | Pages | Why |', '|---|---|---|---|');
    for (const r of agg.review) L.push(`| ${cell(r.title)}${r.engine === 'axe-core' ? ` (${code(r.rule)})` : ''} | ${r.sc.join(', ') || '–'} | ${r.pages.length} | ${cell(r.why || '')} |`);
    L.push('');
  }
  if (agg.bestPractice.length) {
    L.push('## Best practice', '', 'Not WCAG failures, but they make the site harder to use with assistive technology.', '');
    L.push('| Rule | Severity | Pages | Elements |', '|---|---|---|---|');
    for (const b of agg.bestPractice) L.push(`| ${cell(b.title)} (${code(b.rule)}) | ${cap(b.severity)} | ${b.pages.length} | ${b.count} |`);
    L.push('');
  }

  L.push(`## WCAG 2.2 ${level} criteria`, '');
  L.push('EN 301 549 v3.2.1 clause 9 is WCAG 2.1 A and AA for web pages, so criteria new in 2.2 have no EN clause yet. "Manual check" means no automated rule covers the criterion.', '');
  L.push('| Criterion | Level | EN 301 549 | Status | Issues |', '|---|---|---|---|---|');
  for (const cr of agg.criteria) L.push(`| [${cr.sc} ${cr.name}](${understandingUrl(cr.sc)}) | ${cr.level} | ${cr.en || '–'} | ${cr.status === 'fail' ? `**${STATUS.fail}**` : STATUS[cr.status]} | ${cr.issues.join(', ')} |`);
  L.push('');

  L.push('## Manual checks', '', manual.trim(), '');

  L.push('## Pages', '');
  L.push('| Page | Status | axe | HTML_CodeSniffer errors |', '|---|---|---|---|');
  for (const p of pages) {
    const axe = p.axe ? `${p.axe.violations.reduce((n, v) => n + v.count, 0)} in ${p.axe.violations.length} rules` : '–';
    L.push(`| ${p.url} | ${p.error ? `Failed: ${cell(p.error)}` : p.status || 'ok'} | ${axe} | ${p.htmlcs ? p.htmlcs.errors.reduce((n, e) => n + e.count, 0) : '–'} |`);
  }
  L.push('');
  return L.join('\n');
}

/** The ~25 lines Claude reads. */
export function buildSummary({ site, agg, dir, level, state = null, diff = null, notes = null }) {
  const c = { ...agg.counts, level };
  const L = [`a11y-audit: ${site}`, `Result: ${resultLine(c)}`, `Verdict: ${verdict(c)}`, ''];
  if (agg.issues.length) {
    L.push('Issues:');
    for (const i of agg.issues.slice(0, 15)) L.push(`  ${i.id} [${i.severity}] ${i.title} · WCAG ${i.sc.join(', ') || '–'} · ${i.pages.length} pages, ${i.count} elements`);
    if (agg.issues.length > 15) L.push(`  … and ${agg.issues.length - 15} more in report.md`);
    L.push('');
  }
  if (agg.review.length) L.push(`Review: ${agg.review.slice(0, 6).map((r) => r.title).join(' · ')}${agg.review.length > 6 ? ' …' : ''}`, '');
  if (c.pagesFailed) L.push(`${plural(c.pagesFailed, 'page')} could not be audited (see the Pages table).`, '');
  if (diff && !diff.error) L.push(`Since last run: ${diff.fixed.length} fixed, ${diff.newIssues.length} new, ${diff.open.length} still open (compared with ${diff.from})`);
  else if (diff?.error) L.push(`Since last run: baseline not usable (${diff.error})`);
  else L.push('Since last run: nothing to compare with (first run for this host, or --no-baseline)');
  if (state) L.push(`State: ${state}${notes ? ' (notes.md included in the report)' : ''}`);
  L.push('');
  L.push(`report.md:  ${dir}/report.md`, `report.json: ${dir}/report.json`, `tasks.json: ${dir}/tasks.json`);
  return L.join('\n');
}
