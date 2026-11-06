/**
 * report.md, findings.json (the fix list in the shape audit-all's tasks.json uses), pages.csv
 * and the short stdout summary.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { AREAS, STATUS_ORDER, countStatuses } from './checks.mjs';
import { diffMarkdown } from './diff.mjs';
import { shows, levelNote, levelOf } from './levels.mjs';
import { isGeoRow } from './geo.mjs';

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

/** " Pages per language section: en 21, es-es 19, …" when the crawl saw more than one. */
function localeNote(locales) {
  const named = Object.entries(locales || {}).filter(([l]) => l);
  if (named.length < 2) return '';
  return ` Pages per language section: ${Object.entries(locales).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l || '(none)'} ${n}`).join(', ')}.`;
}

/** " · 72/100 over 18 checks" etc.: the GEO readiness line, or null without a score. */
export function geoLine(score) {
  if (!score) return null;
  const c = score.counts;
  return `${score.score}/100 over ${score.counted} AI search checks (${c.fail} fail, ${c.warn} warn, ${c.pass} pass, ${c.info} info${c.skip ? `, ${c.skip} skipped` : ''})`;
}

export function renderMarkdown(report, { levels, geo = false } = {}) {
  const { site, stats, env } = report;
  // --geo: the AI search rows and the rows that decide what AI crawlers reach, nothing else.
  const scope = geo ? report.rows.filter(isGeoRow) : report.rows;
  const counts = countStatuses(scope);
  const filtered = Boolean(levels && !levels.all);
  // --level: only rows at the chosen levels; the counts and report.json keep everything.
  const rows = scope.filter((r) => shows(levels, r));
  const out = [];
  out.push(`# ${geo ? 'GEO audit' : 'SEO audit'} — ${site.host}`, '');
  out.push(`**Site:** ${site.finalUrl} · **Date:** ${report.date} · **Tool:** audit-seo ${report.version}${geo ? ' (--geo)' : ''}`, '');
  out.push(`**Result:** ${resultLine(counts)}`, '');
  const gl = report.mode === 'schema' ? null : geoLine(report.geo?.score);
  if (gl) out.push(`**GEO readiness:** ${gl}. A summary of the checks below, not a measure of how often AI engines cite the site.`, '');
  if (geo) out.push('**Scope:** AI search (GEO) only: AI crawler access in robots.txt and at the edge, text and JSON-LD without JavaScript, llms.txt, entity and article markup, dates and authors, answer structure, plus the indexing rows that decide what any crawler can reach. Run without --geo for the full SEO audit.', '');
  if (filtered) out.push(levelNote(levels, { hidden: report.rows.length - rows.length }), '');
  if (report.mode === 'schema') out.push(`**Checked:** structured data on this one page only (${/^file:|^\//.test(site.finalUrl) || !/^https?:/.test(site.finalUrl) ? 'a local file' : '--schema-only'}); nothing was crawled. Run without --schema-only for the full SEO audit.`, '');
  else out.push(`**Crawled:** ${stats.html} HTML pages and ${stats.other} other URLs (${stats.redirects} redirects, ${stats.errors} errors) by following links${stats.truncated ? ` (stopped at the --pages cap of ${stats.maxPages}; the site has more)` : ''}${stats.sitemapMissing ? `, plus ${stats.sitemapSampled} of ${stats.sitemapMissing} sitemap URLs the links did not reach` : ''}. ${stats.indexable} pages are indexable.${localeNote(stats.locales)}${stats.linksChecked ? ` ${stats.linksChecked} more link targets past the cap were checked for a status only${stats.linksUnchecked ? ` (${stats.linksUnchecked} not checked)` : ''}.` : ''}`, '');
  if (env.note) out.push(`> ${env.note}`, '');
  if (report.notes) out.push('## Notes', '', report.notes.trim(), '');
  if (report.diff && !report.diff.error) out.push(...diffMarkdown(report.diff, { from: report.diff.from, date: report.diff.date }));

  const issues = sorted(rows.filter((r) => r.status === 'fail' || r.status === 'warn'));
  out.push('## Fix list', '');
  if (!issues.length && filtered) out.push(`No ${levels.label.replace(/ only$/, '')}.`, '');
  else if (!issues.length) out.push('Nothing failed and nothing needs a warning. The info rows below are worth a look.', '');
  else {
    out.push('| # | Status | Check | Finding | Pages |', '|---|---|---|---|---|');
    issues.forEach((r, i) => out.push(`| ${i + 1} | ${GLYPH[r.status]} ${LABEL[r.status]} | ${cell(r.title)} | ${cell(r.evidence)} | ${r.urls.length || ''} |`));
    out.push('');
  }

  const areas = geo ? [...AREAS.filter(([a]) => a === 'geo'), ...AREAS.filter(([a]) => a !== 'geo')] : AREAS;
  areas.filter(([area]) => rows.some((r) => r.area === area)).forEach(([area, title], n) => {
    const list = sorted(rows.filter((r) => r.area === area));
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
  out.push('- Speed, Core Web Vitals and the start page\'s launch basics are in audit-launch; accessibility in audit-a11y.');
  out.push('- Pages are read as served, as most crawlers first see them. Only the start page and one page per section are rendered in Chrome (--render-pages), to find JSON-LD and text that JavaScript adds; the other pages are judged on their served HTML.');
  out.push('- The AI crawler test sends each crawler\'s user agent from this machine, not from the crawler\'s own addresses. An edge that checks crawlers by IP answers differently to the real ones; the report says so when a Googlebot user agent is refused too. IndexNow and Bing Webmaster Tools cannot be seen from outside.');
  out.push('- Google\'s Rich Results Test itself (it has no public API): its required and recommended properties are checked locally for the common result types; the Search Console enhancement reports show what Google actually picked up.');
  out.push('- Whether AI engines actually cite the site: that needs prompts run against each engine over time, not a crawl.');
  out.push('');
  out.push('Files: `report.json` (every row and page), `findings.json` (the fix list with every affected URL), `pages.csv` (one row per crawled URL).', '');
  return out.join('\n');
}

export function findings(report) {
  const rows = sorted(report.rows.filter((r) => r.status === 'fail' || r.status === 'warn'));
  return {
    tool: 'audit-seo',
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
      verify: `audit-seo check ${r.id} passes on the next run`,
      geo: isGeoRow(r),
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
  const cols = ['url', 'status', 'location', 'noindex', 'canonical', 'title', 'title_length', 'description_length', 'h1_count', 'words', 'rendered_words', 'lang', 'hreflang', 'jsonld_types', 'og_image', 'date_published', 'date_modified', 'author', 'question_headings', 'inlinks'];
  const lines = [cols.join(',')];
  for (const p of pages) {
    lines.push([
      p.url, p.status || p.error, p.location, p.noindex ? 'yes' : (p.title !== undefined ? 'no' : ''), p.canonical, p.title, p.title?.length, p.description?.length,
      p.h1Count, p.words, p.renderedWords, p.lang, (p.hreflang || []).map((a) => a.lang).join(' '), [...new Set((p.jsonLd || []).flatMap((j) => j.types))].join(' '), p.og?.image,
      p.sig?.published, p.sig?.modified, p.sig ? (p.sig.author ? 'yes' : 'no') : '', p.sig?.questionHeadings, inlinks.get(p.url)?.size || 0,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function renderStdout(report, paths, { levels, geo = false } = {}) {
  const all = geo ? report.rows.filter(isGeoRow) : report.rows;
  const counts = countStatuses(all);
  const rows = all.filter((r) => shows(levels, r));
  const scope = report.mode === 'schema' ? 'Structured data on one page only' : `Crawled ${report.stats.html} pages (${report.stats.indexable} indexable)${report.stats.truncated ? ', capped' : ''}; ${report.stats.sitemapSampled} extra sitemap URLs${geo ? '; GEO rows only (--geo)' : ''}`;
  const gl = report.mode === 'schema' ? null : geoLine(report.geo?.score);
  const out = [`audit-seo ${report.version} — ${report.site.finalUrl}`, `Result: ${resultLine(counts)}`, ...(gl ? [`GEO readiness: ${gl}`] : []), scope, ''];
  for (const r of sorted(rows.filter((x) => x.status === 'fail' || x.status === 'warn'))) out.push(`${r.status.toUpperCase().padEnd(4)} ${r.title}: ${r.evidence}`);
  for (const r of rows.filter((x) => x.status === 'skip')) out.push(`SKIP ${r.title}: ${r.evidence}`);
  out.push('', `report.md     ${paths.md}`, `findings.json ${paths.findings}`);
  return out.join('\n');
}

/**
 * The --console items: one per row with a level (fail, warn, info). For --schema-only and a local
 * file, one per validator error and warning instead, so the list reads like the validator's.
 */
export function consoleItems(report, { geo = false } = {}) {
  if (report.mode === 'schema') {
    return sorted(report.rows).flatMap((r) => {
      const each = r.urls.filter((u) => /^(ERROR|WARN|INFO) /.test(u.note || ''));
      if (!each.length) return [{ level: levelOf(r), source: r.area, id: r.id.replace(/^seo\./, ''), title: r.title, where: cell(r.evidence, 140) }];
      return each.map((u) => ({ level: { ERROR: 'error', WARN: 'warn', INFO: 'info' }[u.note.split(' ')[0]], source: r.area, id: r.id.replace(/^seo\./, ''), title: u.note.replace(/^(ERROR|WARN|INFO) /, '') }));
    });
  }
  return sorted(geo ? report.rows.filter(isGeoRow) : report.rows).map((r) => ({ level: levelOf(r), source: r.area, id: r.id.replace(/^seo\./, ''), title: r.title, where: `${cell(r.evidence, 140)}${r.urls.length ? ` (${r.urls.length} page${r.urls.length === 1 ? '' : 's'})` : ''}` }));
}
