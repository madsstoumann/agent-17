/**
 * report.md, findings.json (the fix list in the shape audit-all's tasks.json uses), pages.csv
 * and the short stdout summary.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { AREAS, STATUS_ORDER, countStatuses } from './checks.mjs';
import { diffMarkdown } from './diff.mjs';

export const GLYPH = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️', skip: '⏭️' };
const LABEL = { pass: 'Pass', warn: 'Warn', fail: 'Fail', info: 'Info', skip: 'Skipped' };
const BLOCKERS = new Set(['seo.start', 'seo.noindex', 'seo.robots-txt', 'seo.canonical-host']);
const SHOW_URLS = 10;

export function cell(s, max = 240) {
  const t = String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** pass/warn/fail/info -> blocker/high/medium/low, the severity words audit-all uses. */
export function severityOf(row) {
  if (row.status === 'fail') return BLOCKERS.has(row.id) ? 'blocker' : 'high';
  if (row.status === 'warn') return 'medium';
  return 'low';
}

const sorted = (rows) => [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.urls.length - a.urls.length || a.id.localeCompare(b.id));

export function resultLine(counts) {
  return ['fail', 'warn', 'pass', 'info', 'skipped'].map((k) => `${counts[k === 'skipped' ? 'skip' : k]} ${k}`).join(', ');
}

export function renderMarkdown(report) {
  const { site, rows, stats, env } = report;
  const counts = countStatuses(rows);
  const out = [];
  out.push(`# SEO audit — ${site.host}`, '');
  out.push(`**Site:** ${site.finalUrl} · **Date:** ${report.date} · **Tool:** seo-audit ${report.version}`, '');
  out.push(`**Result:** ${resultLine(counts)}`, '');
  out.push(`**Crawled:** ${stats.html} HTML pages and ${stats.other} other URLs (${stats.redirects} redirects, ${stats.errors} errors) by following links${stats.truncated ? ` (stopped at the --pages cap of ${stats.maxPages}; the site has more)` : ''}${stats.sitemapMissing ? `, plus ${stats.sitemapSampled} of ${stats.sitemapMissing} sitemap URLs the links did not reach` : ''}. ${stats.indexable} pages are indexable.`, '');
  if (env.note) out.push(`> ${env.note}`, '');
  if (report.notes) out.push('## Notes', '', report.notes.trim(), '');
  if (report.diff && !report.diff.error) out.push(...diffMarkdown(report.diff, { from: report.diff.from, date: report.diff.date }));

  const issues = sorted(rows.filter((r) => r.status === 'fail' || r.status === 'warn'));
  out.push('## Fix list', '');
  if (!issues.length) out.push('Nothing failed and nothing needs a warning. The info rows below are worth a look.', '');
  else {
    out.push('| # | Status | Check | Finding | Pages |', '|---|---|---|---|---|');
    issues.forEach((r, i) => out.push(`| ${i + 1} | ${GLYPH[r.status]} ${LABEL[r.status]} | ${cell(r.title)} | ${cell(r.evidence)} | ${r.urls.length || ''} |`));
    out.push('');
  }

  AREAS.forEach(([area, title], n) => {
    const list = sorted(rows.filter((r) => r.area === area));
    if (!list.length) return;
    out.push(`## ${n + 1}. ${title}`, '');
    out.push('| Status | Check | Evidence |', '|---|---|---|');
    for (const r of list) out.push(`| ${GLYPH[r.status]} ${LABEL[r.status]} | ${cell(r.title)} | ${cell(r.evidence)} |`);
    out.push('');
    for (const r of list.filter((x) => x.status !== 'pass' && x.status !== 'skip' && (x.fix || x.urls.length))) {
      out.push(`### ${r.title}`, '');
      if (r.fix) out.push(`**Fix:** ${r.fix}`, '');
      if (r.urls.length) {
        for (const u of r.urls.slice(0, SHOW_URLS)) out.push(`- \`${u.url}\`${u.note ? ` — ${cell(u.note, 200)}` : ''}`);
        if (r.urls.length > SHOW_URLS) out.push(`- …and ${r.urls.length - SHOW_URLS} more (all in \`findings.json\`)`);
        out.push('');
      }
    }
  });

  out.push('## Not covered', '');
  out.push('- Rankings, search volume, backlinks and Search Console data: none of that is visible from outside. Check Search Console for coverage and Core Web Vitals field data.');
  out.push('- Speed, Core Web Vitals and the start page\'s launch basics are in launch-audit; accessibility in a11y-audit.');
  out.push('- Pages that build their content with JavaScript are read as served (no rendering), as most crawlers first see them.');
  out.push('');
  out.push('Files: `report.json` (every row and page), `findings.json` (the fix list with every affected URL), `pages.csv` (one row per crawled URL).', '');
  return out.join('\n');
}

export function findings(report) {
  const rows = sorted(report.rows.filter((r) => r.status === 'fail' || r.status === 'warn'));
  return {
    tool: 'seo-audit',
    version: report.version,
    site: report.site.finalUrl,
    date: report.date,
    findings: rows.map((r, i) => ({
      id: `S${i + 1}`,
      check: r.id,
      title: r.title,
      severity: severityOf(r),
      status: r.status,
      area: r.area,
      sources: ['seo'],
      evidence: r.evidence,
      fix: r.fix,
      verify: `seo-audit check ${r.id} passes on the next run`,
      count: r.urls.length,
      urls: r.urls.slice(0, 200),
    })),
  };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function pagesCsv(pages, inlinks) {
  const cols = ['url', 'status', 'location', 'noindex', 'canonical', 'title', 'title_length', 'description_length', 'h1_count', 'words', 'lang', 'hreflang', 'jsonld_types', 'og_image', 'inlinks'];
  const lines = [cols.join(',')];
  for (const p of pages) {
    lines.push([
      p.url, p.status || p.error, p.location, p.noindex ? 'yes' : (p.title !== undefined ? 'no' : ''), p.canonical, p.title, p.title?.length, p.description?.length,
      p.h1Count, p.words, p.lang, (p.hreflang || []).map((a) => a.lang).join(' '), [...new Set((p.jsonLd || []).flatMap((j) => j.types))].join(' '), p.og?.image, inlinks.get(p.url)?.size || 0,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function renderStdout(report, paths) {
  const counts = countStatuses(report.rows);
  const out = [`seo-audit ${report.version} — ${report.site.finalUrl}`, `Result: ${resultLine(counts)}`, `Crawled ${report.stats.html} pages (${report.stats.indexable} indexable)${report.stats.truncated ? ', capped' : ''}; ${report.stats.sitemapSampled} extra sitemap URLs`, ''];
  for (const r of sorted(report.rows.filter((x) => x.status === 'fail' || x.status === 'warn'))) out.push(`${r.status.toUpperCase().padEnd(4)} ${r.title}: ${r.evidence}`);
  for (const r of report.rows.filter((x) => x.status === 'skip')) out.push(`SKIP ${r.title}: ${r.evidence}`);
  out.push('', `report.md     ${paths.md}`, `findings.json ${paths.findings}`);
  return out.join('\n');
}
