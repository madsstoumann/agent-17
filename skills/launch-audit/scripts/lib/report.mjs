/**
 * Renders report.md (for people) and the stdout summary (for Claude) from the
 * report object that audit.mjs assembles. Pure: no I/O.
 */
import { GROUPS } from './registry.mjs';

export const STATUS_GLYPH = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️', skip: '⏭️' };
const STATUS_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO', skip: 'SKIP' };

/** One table cell: pipes escaped, newlines to <br>, at most 240 characters. */
export function escapeCell(s, max = 240) {
  if (s == null) return '';
  let t = String(s).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
  if (t.length > max) t = `${t.slice(0, max)}…`;
  return t;
}

const enc = encodeURIComponent;

/** Services with no API, with the URL prefilled so a manual check is one click. */
export function buildManualLinks({ url, host }) {
  const bare = String(host || '').replace(/:\d+$/, '');
  return [
    { title: 'securityheaders.com', url: `https://securityheaders.com/?q=${enc(url)}&followRedirects=on`, why: 'The official grade; the report\'s grade is an estimate unless the scrape succeeded.' },
    { title: 'Google CSP Evaluator', url: 'https://csp-evaluator.withgoogle.com/', why: 'Paste the CSP header; finds bypassable policies that look fine at a glance.' },
    { title: 'PageSpeed Insights', url: `https://pagespeed.web.dev/analysis?url=${enc(url)}`, why: 'Field data (CrUX) and the same Lighthouse run on Google\'s infrastructure.' },
    { title: 'Google Rich Results Test', url: `https://search.google.com/test/rich-results?url=${enc(url)}`, why: 'What Google will actually render as a rich result.' },
    { title: 'validator.w3.org/nu', url: `https://validator.w3.org/nu/?doc=${enc(url)}`, why: 'The full message list behind the counts in the scoreboard.' },
    { title: 'validator.schema.org', url: `https://validator.schema.org/#url=${enc(url)}`, why: 'Structured data as the validator renders it.' },
    { title: 'MDN HTTP Observatory', url: `https://developer.mozilla.org/en-US/observatory/analyze?host=${enc(bare)}`, why: 'Per-test explanations and recommendations.' },
    { title: 'Qualys SSL Labs', url: `https://www.ssllabs.com/ssltest/analyze.html?d=${enc(bare)}&hideResults=on`, why: 'Protocol, cipher and chain grading (or run with --ssllabs).' },
    { title: 'hstspreload.org', url: `https://hstspreload.org/?domain=${enc(bare)}`, why: 'Preload eligibility and submission.' },
    { title: 'Webbkoll', url: `https://webbkoll.dataskydd.net/en/check?url=${enc(url)}`, why: 'Third-party requests and cookies set before consent (GDPR).' },
    { title: 'Blacklight (The Markup)', url: `https://themarkup.org/blacklight?url=${enc(url)}`, why: 'Second opinion on trackers, session recording and fingerprinting.' },
    { title: 'LinkedIn Post Inspector', url: `https://www.linkedin.com/post-inspector/inspect/${enc(url)}`, why: 'Share preview; also clears LinkedIn\'s cached preview from staging.' },
    { title: 'Facebook Sharing Debugger', url: `https://developers.facebook.com/tools/debug/?q=${enc(url)}`, why: 'Share preview; "Scrape again" clears the stale cache.' },
    { title: 'RealFaviconGenerator checker', url: `https://realfavicongenerator.net/favicon_checker?protocol=https&site=${enc(bare)}`, why: 'Favicons, touch icons and the web manifest across platforms.' },
    { title: 'WAVE', url: `https://wave.webaim.org/report#/${enc(url)}`, why: 'Accessibility issues Lighthouse does not catch; then a keyboard-only pass by hand.' },
  ];
}

function envLabel(input) {
  if (!input) return '';
  return input.envSource === 'flag' ? `${input.env} (from --env)` : `${input.env} (auto from hostname — pass --env to override)`;
}

function lhLine(lh, { annotateSeo }) {
  if (!lh) return null;
  const n = (v) => (v == null ? 'n/a' : String(v));
  let seo = n(lh.seo);
  if (annotateSeo && lh.seoNoindexAffected) seo += ' (depressed by noindex — expected on dev; re-run on production)';
  else if (lh.seoNoindexAffected) seo += ' (page is noindex)';
  const parts = [`Perf ${n(lh.performance)}`, `A11y ${n(lh.accessibility)}`, `Best practices ${n(lh.bestPractices)}`, `SEO ${seo}`];
  if (lh.agentic) parts.push(`Agentic ${lh.agentic}`);
  return parts.join(' · ');
}

function cwvLine(cwv) {
  if (!cwv) return null;
  const parts = [];
  for (const [k, v] of Object.entries(cwv)) {
    if (!v || v.display == null) continue;
    parts.push(`${k} ${v.display}${v.rating ? ` ${STATUS_GLYPH[v.rating] || ''}` : ''}`.trim());
  }
  return parts.length ? parts.join(' · ') : null;
}

/** The scoreboard as rows: [{ label, value, link? }]. */
export function scoreboardRows(report) {
  const sb = report.scoreboard || {};
  const dev = !report.input?.production;
  const rows = [];
  const lh = sb.lighthouse || {};
  const runnerNote = lh.runner ? ` (${lh.runner === 'psi' ? 'PageSpeed Insights API' : lh.runner === 'local' ? `local Lighthouse ${lh.version || ''}`.trim() : 'not run'})` : '';
  rows.push({ label: 'Lighthouse (mobile)', value: lhLine(lh.mobile, { annotateSeo: dev }) || `not run${runnerNote}`, note: runnerNote });
  rows.push({ label: 'Lighthouse (desktop)', value: lhLine(lh.desktop, { annotateSeo: dev }) || 'not run' });
  rows.push({ label: 'Core Web Vitals (lab, mobile)', value: cwvLine(sb.cwvLab) || 'n/a' });
  rows.push({ label: 'Core Web Vitals (field, CrUX)', value: sb.cwvField ? `${cwvLine(sb.cwvField.metrics) || ''}${sb.cwvField.overall ? ` — overall ${sb.cwvField.overall}` : ''}` : 'n/a (no PSI_API_KEY — field data needs the PageSpeed Insights API)' });
  if (sb.headersScraped?.grade) rows.push({ label: 'Security headers (securityheaders.com)', value: sb.headersScraped.grade, link: sb.headersGrade?.link });
  if (sb.headersGrade) rows.push({ label: `Security headers (securityheaders.com-style${sb.headersGrade.estimated ? ', estimated' : ''})`, value: `${sb.headersGrade.grade}${sb.headersGrade.estimated ? ' — confirm on securityheaders.com' : ''}`, link: sb.headersGrade.link });
  if (sb.observatory) rows.push({ label: 'MDN HTTP Observatory', value: sb.observatory.grade ? `${sb.observatory.grade} (${sb.observatory.score}) — ${sb.observatory.passed}/${sb.observatory.total} tests passed` : (sb.observatory.error || 'n/a'), link: sb.observatory.link });
  if (sb.w3c) rows.push({ label: 'W3C validator', value: sb.w3c.errors == null ? (sb.w3c.error || 'n/a') : `${sb.w3c.errors} errors · ${sb.w3c.warnings} warnings (${sb.w3c.distinct} distinct)`, link: sb.w3c.link });
  if (sb.schema) rows.push({ label: 'schema.org', value: sb.schema.objects == null ? (sb.schema.error || 'n/a') : `${sb.schema.objects} object${sb.schema.objects === 1 ? '' : 's'}${sb.schema.types?.length ? ` (${sb.schema.types.join(', ')})` : ''} · ${sb.schema.errors} errors · ${sb.schema.warnings} warnings`, link: sb.schema.link });
  if (sb.tls) rows.push({ label: 'TLS', value: [sb.tls.protocol, sb.tls.issuer, sb.tls.daysLeft != null ? `expires in ${sb.tls.daysLeft} days` : null].filter(Boolean).join(' · ') || 'n/a' });
  return rows;
}

function fmtDate(iso) {
  try { return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; } catch { return String(iso); }
}

function row(r) {
  const subject = r.subject ? ` (page: ${r.subject})` : '';
  const link = r.link ? ` [↗](${r.link})` : '';
  return `| ${STATUS_GLYPH[r.status]} | ${escapeCell(r.title)}${escapeCell(subject)} | ${escapeCell(r.evidence)}${link} | ${escapeCell(r.fix)} |`;
}

/** report -> Markdown. */
export function renderMarkdown(report) {
  const { input = {}, site = {}, counts = {}, results = [] } = report;
  const out = [];
  out.push(`# Launch audit — ${site.host || input.host || ''}`, '');
  out.push(`**Site:** ${input.url}${site.finalUrl && site.finalUrl !== input.url ? ` → ${site.finalUrl}` : ''}  ·  **Environment:** ${envLabel(input)}  ·  **Date:** ${fmtDate(report.generatedAt)}  ·  **Tool:** launch-audit ${report.version || ''}${site.lighthouse?.runner ? ` · Lighthouse ${site.lighthouse.runner}${site.lighthouse.version ? ` ${site.lighthouse.version}` : ''}` : ''}${report.partial ? '  ·  **PARTIAL RUN**' : ''}`);
  if (input.productionHost && input.productionHost !== (site.host || '').replace(/:\d+$/, '')) out.push(`**Production host:** ${input.productionHost}`);
  out.push('', `**Result:** ${counts.pass || 0} pass · ${counts.warn || 0} warn · ${counts.fail || 0} fail · ${counts.info || 0} info · ${counts.skip || 0} skipped`, '');

  const blockers = results.filter((r) => r.blocker && r.status === 'fail');
  if (blockers.length) {
    out.push('## Launch blockers', '');
    for (const b of blockers) out.push(`- ❌ **${b.title}**${b.subject ? ` (${b.subject})` : ''} — ${b.evidence}${b.fix ? ` → ${b.fix}` : ''}`);
    out.push('');
  }
  if (report.beforeProduction?.length) {
    out.push('## Before production', '', `Expected on ${input.env}; each must be reversed on the live site.`, '');
    for (const b of report.beforeProduction) out.push(`- [ ] **${b.title}** — ${b.evidence}${b.fix ? ` → ${b.fix}` : ''}`);
    out.push('');
  }

  out.push('## Scoreboard', '', '| Measure | Result |', '|---|---|');
  for (const r of scoreboardRows(report)) out.push(`| ${r.label} | ${escapeCell(r.value, 400)}${r.link ? ` [↗](${r.link})` : ''} |`);
  out.push('');

  for (const g of GROUPS) {
    const rows = results.filter((r) => r.group === g.id);
    out.push(`## ${g.order}. ${g.title}`, '');
    if (!rows.length) { out.push('_Not run._', ''); continue; }
    if (g.id === 'ops') {
      for (const r of rows) out.push(`- [ ] ${r.title}${r.evidence ? ` — ${r.evidence}` : ''}`);
      out.push('');
      continue;
    }
    out.push('| | Check | Evidence | Fix |', '|---|---|---|---|');
    for (const r of rows) out.push(row(r));
    out.push('');
  }

  if (report.manual?.length) {
    out.push('## Manual checks', '', 'No API for these; the links carry the URL.', '');
    for (const m of report.manual) out.push(`- [${m.title}](${m.url}) — ${m.why}`);
    out.push('');
  }

  if (report.diff && !report.diff.error) {
    const d = report.diff;
    out.push(`## Since last run${d.prevGeneratedAt ? ` (vs ${fmtDate(d.prevGeneratedAt)})` : ''}`, '');
    if (d.envChanged) out.push(`Environment changed: ${d.envChanged.from} → ${d.envChanged.to}.`, '');
    const list = (title, items, f) => { if (!items.length) return; out.push(`**${title}**`, ''); for (const i of items) out.push(`- ${f(i)}`); out.push(''); };
    list('Fixed', d.fixed, (i) => `${i.title} (${i.from} → ${i.to})${i.subject ? ` — ${i.subject}` : ''}`);
    list('Regressed', d.regressed, (i) => `${i.title} (${i.from} → ${i.to})${i.subject ? ` — ${i.subject}` : ''}`);
    list('New', d.newFindings, (i) => `${i.title} (${i.to})${i.subject ? ` — ${i.subject}` : ''}`);
    list('No longer reported', d.removed, (i) => `${i.title} (was ${i.from})${i.subject ? ` — ${i.subject}` : ''}`);
    if (d.scores.length) out.push(`Scores: ${d.scores.map((s) => `${s.key} ${s.from} → ${s.to} (${s.delta > 0 ? '+' : ''}${s.delta})`).join('; ')}`, '');
    if (!d.fixed.length && !d.regressed.length && !d.newFindings.length && !d.removed.length) out.push('No status changes.', '');
  } else if (report.diff?.error) {
    out.push('## Since last run', '', `Baseline not usable: ${report.diff.error}`, '');
  }

  if (report.notes) {
    out.push('## Notes', '', `_From \`notes.md\` in ${report.state ? `\`${report.state}\`` : 'the target folder'}, kept between runs._`, '');
    out.push(report.notes.trim().replace(/^(#{1,4}) /gm, (m, h) => `${'#'.repeat(Math.min(h.length + 2, 6))} `), '');
  }

  out.push('<details>', '<summary>Appendix — pages crawled, raw files</summary>', '');
  if (report.pages?.length) {
    out.push('| Page | Status | Title | H1 | Images without alt | Mixed content |', '|---|---|---|---|---|---|');
    for (const p of report.pages.slice(0, 200)) out.push(`| ${escapeCell(p.url, 120)} | ${p.status} | ${escapeCell(p.title, 80)} | ${p.h1Count ?? ''} | ${p.imgNoAlt ?? ''} | ${p.mixedContent ?? ''} |`);
    if (report.pages.length > 200) out.push(`| … ${report.pages.length - 200} more in report.json | | | | | |`);
    out.push('');
  }
  if (report.raw) {
    const files = Object.values(report.raw).flat().filter(Boolean);
    if (files.length) out.push(`Raw files: ${files.map((f) => `\`${f}\``).join(', ')}`, '');
  }
  out.push('</details>', '');
  return out.join('\n');
}

/** The compact stdout summary Claude reads instead of the whole report. */
export function renderStdout(report, { reportMd, reportJson, maxWarns = 40 } = {}) {
  const { input = {}, site = {}, counts = {}, results = [] } = report;
  const lines = [];
  lines.push(`launch-audit ${site.host || ''} — env: ${envLabel(input)} — ${fmtDate(report.generatedAt)}${report.partial ? ' — PARTIAL RUN' : ''}`);
  for (const r of scoreboardRows(report)) lines.push(`${r.label}: ${r.value}`);
  const blockers = results.filter((r) => r.blocker && r.status === 'fail');
  if (blockers.length) {
    lines.push('Launch blockers:');
    for (const b of blockers) lines.push(`  FAIL ${b.id}${b.subject ? ` @ ${b.subject}` : ''} — ${b.title}: ${b.evidence}${b.fix ? ` → ${b.fix}` : ''}`);
  }
  if (report.beforeProduction?.length) lines.push(`Before production (${report.beforeProduction.length}): ${report.beforeProduction.map((b) => b.id).join(', ')}`);
  const fails = results.filter((r) => r.status === 'fail' && !r.blocker);
  for (const f of fails) lines.push(`FAIL ${f.id}${f.subject ? ` @ ${f.subject}` : ''} — ${f.title}: ${f.evidence}${f.fix ? ` → ${f.fix}` : ''}`);
  const warns = results.filter((r) => r.status === 'warn');
  for (const w of warns.slice(0, maxWarns)) lines.push(`WARN ${w.id}${w.subject ? ` @ ${w.subject}` : ''} — ${w.title}: ${w.evidence}${w.fix ? ` → ${w.fix}` : ''}`);
  if (warns.length > maxWarns) lines.push(`  +${warns.length - maxWarns} more warnings in report.md`);
  const skips = results.filter((r) => r.status === 'skip');
  if (skips.length) lines.push(`Skipped: ${skips.map((s) => `${s.id} (${s.evidence})`).join('; ')}`);
  lines.push(`Counts: pass ${counts.pass || 0} · warn ${counts.warn || 0} · fail ${counts.fail || 0} · info ${counts.info || 0} · skip ${counts.skip || 0}`);
  lines.push(`Report: ${reportMd || ''}`);
  lines.push(`JSON: ${reportJson || ''}`);
  return lines.join('\n');
}

export { STATUS_LABEL };
