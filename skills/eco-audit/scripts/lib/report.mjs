/**
 * report.md, findings.json (the fix list in the shape audit-all's tasks.json uses) and the
 * short stdout summary.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { AREAS, STATUS_ORDER, countStatuses, fmtBytes } from './checks.mjs';
import { formatMass, SWDM4, GRID_SOURCE, fmtG } from './co2.mjs';
import { diffMarkdown } from './diff.mjs';

export const GLYPH = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️', skip: '⏭️' };
const LABEL = { pass: 'Pass', warn: 'Warn', fail: 'Fail', info: 'Info', skip: 'Skipped' };
const SHOW = 10;

export function cell(s, max = 240) {
  const t = String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
export const severityOf = (row) => (row.status === 'fail' ? 'high' : row.status === 'warn' ? 'medium' : 'low');
const sorted = (rows) => [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.items.reduce((n, x) => n + (x.bytes || 0), 0) - a.items.reduce((n, x) => n + (x.bytes || 0), 0)));
const shortUrl = (u) => { try { const x = new URL(u); return x.pathname === '/' ? x.host : x.pathname; } catch { return u; } };

export function resultLine(report) {
  const c = countStatuses(report.rows);
  const counts = `${c.fail} fail, ${c.warn} warn, ${c.pass} pass, ${c.info} info, ${c.skip} skipped`;
  const st = report.pages[0];
  return `${counts} · start page ${fmtG(st.grams)} g CO2e per view (rating ${st.rating}), ${fmtBytes(st.bytes)} · median of ${report.pages.length} ${report.pages.length === 1 ? 'page' : 'pages'} ${fmtG(report.median.grams)} g (${report.median.rating}), ${fmtBytes(report.median.bytes)}`;
}

export function method(report) {
  const g = report.grid;
  const grid = g.code ? `${g.code} grid ${g.value} g/kWh for the visitor's device and network, global ${SWDM4.globalGrid} g/kWh for the data centre` : `global grid intensity ${SWDM4.globalGrid} g/kWh`;
  const how = report.estimate ? 'HTML and the files it references fetched without a browser (an estimate: anything JavaScript loads is missed)' : `a first visit with an empty cache in headless Chrome, ${report.viewport}`;
  return `Sustainable Web Design model v4 (as CO2.js 0.19), ${grid}, ${report.green?.green ? 'green hosting counted for the data centre' : 'no green-hosting discount'}; bytes from ${how}.`;
}

export function renderMarkdown(report) {
  const out = [];
  out.push(`# Eco audit — ${report.site.host}`, '');
  out.push(`**Site:** ${report.site.finalUrl} · **Date:** ${report.date} · **Tool:** eco-audit ${report.version}`, '');
  out.push(`**Result:** ${resultLine(report)}`, '');
  out.push(`**Method:** ${method(report)}`, '');
  if (report.notes) out.push('## Notes', '', report.notes.trim(), '');
  if (report.diff && !report.diff.error) {
    const p = report.diff.prev; const s = report.pages[0];
    const extra = p ? [`Start page: ${fmtG(p.grams)} g → ${fmtG(s.grams)} g CO2e per view, ${fmtBytes(p.bytes)} → ${fmtBytes(s.bytes)}.${p.medianGrams != null ? ` Median: ${fmtG(p.medianGrams)} g → ${fmtG(report.median.grams)} g.` : ''}`] : [];
    out.push(...diffMarkdown(report.diff, { from: report.diff.from, date: report.diff.date, extra }));
  }

  out.push('## Pages', '');
  out.push('| Page | Weight | CO2e / view | Rating | Images | Video | JS | Fonts | CSS | Third party | Requests |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of report.pages) out.push(`| ${cell(shortUrl(s.url), 60)} | ${fmtBytes(s.bytes)} | ${fmtG(s.grams)} g | ${s.rating} | ${fmtBytes(s.by.image)} | ${fmtBytes(s.by.media)} | ${fmtBytes(s.by.js)} | ${fmtBytes(s.by.font)} | ${fmtBytes(s.by.css)} | ${s.bytes ? Math.round((s.third / s.bytes) * 100) : 0}% | ${s.requests} |`);
  for (const f of report.failed) out.push(`| ${cell(shortUrl(f.url), 60)} | not measured: ${cell(f.error, 80)} | | | | | | | | | |`);
  out.push('');
  out.push('Ratings follow the Sustainable Web Design digital carbon rating: A+ up to 0.040 g, A 0.079, B 0.145, C 0.209, D 0.278, E 0.359, F above.', '');
  if (report.views) {
    const mean = report.pages.reduce((a, s) => a + s.grams, 0) / report.pages.length;
    out.push(`At ${report.views.toLocaleString('en-GB')} page views a month and the average of the pages above (${fmtG(mean)} g), that is about **${formatMass(mean * report.views * 12)} CO2e a year**. Halving page weight halves it.`, '');
  }

  const issues = sorted(report.rows.filter((r) => r.status === 'fail' || r.status === 'warn'));
  out.push('## Fix list', '');
  if (!issues.length) out.push('Nothing failed and nothing needs a warning.', '');
  else {
    out.push('| # | Status | Check | Finding |', '|---|---|---|---|');
    issues.forEach((r, i) => out.push(`| ${i + 1} | ${GLYPH[r.status]} ${LABEL[r.status]} | ${cell(r.title)} | ${cell(r.evidence)} |`));
    out.push('');
  }

  AREAS.forEach(([area, title], n) => {
    const list = sorted(report.rows.filter((r) => r.area === area));
    if (!list.length) return;
    out.push(`## ${n + 1}. ${title}`, '');
    out.push('| Status | Check | Evidence |', '|---|---|---|');
    for (const r of list) out.push(`| ${GLYPH[r.status]} ${LABEL[r.status]} | ${cell(r.title)} | ${cell(r.evidence)} |`);
    out.push('');
    for (const r of list.filter((x) => (x.status === 'fail' || x.status === 'warn' || x.status === 'info') && (x.fix || x.items.length))) {
      out.push(`### ${r.title}`, '');
      if (r.fix) out.push(`**Fix:** ${r.fix}`, '');
      for (const it of r.items.slice(0, SHOW)) out.push(`- \`${cell(it.url, 160)}\`${it.note ? ` — ${cell(it.note, 200)}` : ''}`);
      if (r.items.length > SHOW) out.push(`- …and ${r.items.length - SHOW} more (all in \`findings.json\`)`);
      if (r.items.length) out.push('');
    }
  });

  out.push('## Method and limits', '');
  out.push(`- ${method(report)}`);
  out.push('- The model turns bytes into energy (data centre, network, device; operational and embodied) and energy into CO2e. It is an estimate for comparing pages and tracking change, not a measurement of this site\'s real footprint.');
  out.push(`- Grid intensity: ${GRID_SOURCE}.`);
  out.push(`- Green hosting from the Green Web Foundation (${report.green?.green ? 'verified green' : report.green?.error ? 'lookup failed' : 'not verified'}); it covers the site host only, not third parties.`);
  out.push('- Video and other streams download for as long as the page is open. The audit stops once the network goes quiet (at most about 15 seconds after load), so video bytes can vary between runs.');
  out.push('- Speed and caching in detail are in launch-audit; this audit looks at weight.');
  out.push('');
  out.push('Files: `report.json` (every request of every page), `findings.json` (the fix list).', '');
  return out.join('\n');
}

export function findings(report) {
  const rows = sorted(report.rows.filter((r) => r.status === 'fail' || r.status === 'warn'));
  return {
    tool: 'eco-audit',
    version: report.version,
    site: report.site.finalUrl,
    date: report.date,
    findings: rows.map((r, i) => ({
      id: `E${i + 1}`, check: r.id, title: r.title, severity: severityOf(r), status: r.status, area: r.area, sources: ['eco'],
      owner: r.id === 'eco.green-hosting' ? 'human' : undefined,
      evidence: r.evidence, fix: r.fix, verify: `eco-audit check ${r.id} passes on the next run`, count: r.items.length, items: r.items.slice(0, 100),
    })),
  };
}

export function renderStdout(report, paths) {
  const out = [`eco-audit ${report.version} — ${report.site.finalUrl}`, `Result: ${resultLine(report)}`, ''];
  for (const s of report.pages) out.push(`${s.rating.padEnd(2)} ${fmtG(s.grams)} g  ${fmtBytes(s.bytes).padStart(7)}  ${s.url}`);
  for (const f of report.failed) out.push(`-- not measured: ${f.url} (${f.error})`);
  out.push('');
  for (const r of sorted(report.rows.filter((x) => x.status === 'fail' || x.status === 'warn'))) out.push(`${r.status.toUpperCase().padEnd(4)} ${r.title}: ${r.evidence}`);
  for (const r of report.rows.filter((x) => x.status === 'skip')) out.push(`SKIP ${r.title}: ${r.evidence}`);
  out.push('', `report.md     ${paths.md}`, `findings.json ${paths.findings}`);
  return out.join('\n');
}
