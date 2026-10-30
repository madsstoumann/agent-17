// Finds the per-audit reports in a run folder, pulls the headline numbers out of each, and
// builds the combined report as Markdown and as print-ready HTML.
import fs from 'node:fs';
import path from 'node:path';
import { parseBlocks, renderBlocks, inline, joinLines, escapeHtml, plain } from './markdown.mjs';

export const KINDS = {
  'launch-audit': {
    title: 'Launch audit',
    standfirst: 'The site checked the way a launch reviewer would: PageSpeed, headers, TLS, crawlability and every page the crawler could reach.',
  },
  'a11y-audit': {
    title: 'Accessibility audit',
    standfirst: 'A sample of pages checked against WCAG 2.2 AA and EN 301 549 with axe-core and HTML_CodeSniffer, a keyboard-only walk, and reflow at 320 px.',
  },
  'security-audit': {
    title: 'Security audit',
    standfirst: 'The repository and its git history, scanned for secrets, injection, unsafe request handling and vulnerable dependencies, then triaged by hand.',
  },
  'solution-health': {
    title: 'Solution health',
    standfirst: 'Packages, runtimes and the external APIs the code calls, compared with the previous run.',
  },
};
const ORDER = Object.keys(KINDS);

/** Sub-folders named `<kind>` or `<kind>-<target>` that hold a report.md, in kind order then name order. */
export function discoverReports(runDir) {
  const found = [];
  for (const name of fs.readdirSync(runDir).sort()) {
    const dir = path.join(runDir, name);
    const file = path.join(dir, 'report.md');
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(file)) continue;
    const kind = ORDER.find((k) => name === k || name.startsWith(`${k}-`));
    if (!kind) continue;
    const target = name === kind ? null : name.slice(kind.length + 1);
    found.push({ kind, target, folder: name, file, md: fs.readFileSync(file, 'utf8') });
  }
  return found.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.folder.localeCompare(b.folder));
}

/** Split a report into its H1, the intro blocks before the first H2, and one section per H2. */
export function splitReport(md) {
  const blocks = parseBlocks(md);
  let title = null;
  const intro = [];
  const sections = [];
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 1 && title === null && !sections.length) { title = b.text; continue; }
    if (b.type === 'heading' && b.level === 2) { sections.push({ heading: b.text, blocks: [] }); continue; }
    (sections.length ? sections[sections.length - 1].blocks : intro).push(b);
  }
  return { title, intro, sections };
}

const countsIn = (text, words) => {
  const out = {};
  for (const w of words) {
    const m = text.match(new RegExp(`(\\d[\\d,]*)\\s+${w}\\b`, 'i'));
    if (m) out[w] = Number(m[1].replace(/,/g, ''));
  }
  return out;
};

/** Headline figures for the cover and the at-a-glance table. Missing values stay undefined. */
export function headline(report) {
  const { md, kind } = report;
  const { title, sections } = splitReport(md);
  const section = (re) => sections.find((s) => re.test(plain(s.heading)));
  const titleTarget = title && plain(title).split(/\s+[—–:-]\s+|:\s+/).slice(1).join(' ').trim();
  const h = { kind, target: report.target || titleTarget || null };

  if (kind === 'launch-audit') {
    const line = md.match(/\*\*Result:\*\*\s*(.+)/);
    h.counts = line ? countsIn(line[1], ['pass', 'warn', 'fail', 'info', 'skipped']) : {};
    h.figures = [[h.counts.fail, 'fail'], [h.counts.warn, 'warn']];
    h.result = line ? plain(line[1]) : null;
    const site = md.match(/\*\*Site:\*\*\s*(\S+)/);
    h.what = h.counts.pass !== undefined ? `${h.counts.pass} checks passed${site ? ` on ${plain(site[1])}` : ''}.` : null;
  } else if (kind === 'a11y-audit') {
    const line = md.match(/\*\*Result:\*\*\s*(.+)/);
    const text = line ? line[1] : '';
    const n = (re) => { const m = text.match(re); return m ? Number(m[1]) : undefined; };
    h.counts = { criteria: n(/(\d+)\s+criteri(?:on|a)\s+failed/i), issues: n(/(\d+)\s+issues?\b/i), review: n(/(\d+)\s+to review/i), pages: n(/(\d+)\s+pages?\b/i) };
    h.figures = [[h.counts.criteria, h.counts.criteria === 1 ? 'criterion failed' : 'criteria failed'], [h.counts.issues, h.counts.issues === 1 ? 'issue' : 'issues']];
    h.result = line ? plain(line[1]) : null;
    const verdict = md.match(/\*\*Verdict:\*\*\s*(.+)/);
    h.what = verdict ? plain(verdict[1]) : null;
  } else if (kind === 'security-audit') {
    const verdict = md.match(/\*\*Verdict:\*\*\s*(.+)/);
    const blockers = section(/^blockers?$/i);
    const findings = section(/^findings$/i);
    const nBlockers = blockers ? blockers.blocks.filter((b) => b.type === 'list').reduce((n, b) => n + b.items.length, 0) : 0;
    const table = findings && findings.blocks.find((b) => b.type === 'table');
    const nFindings = table ? table.rows.length : 0;
    h.counts = { blockers: nBlockers, findings: nFindings };
    h.figures = [[nBlockers, nBlockers === 1 ? 'blocker' : 'blockers'], [nFindings, nFindings === 1 ? 'finding' : 'findings']];
    h.result = verdict ? plain(verdict[1]) : `${nBlockers} blockers, ${nFindings} findings`;
    h.what = verdict ? plain(verdict[1]) : null;
  } else if (kind === 'solution-health') {
    const line = md.match(/\*\*(\d+\s+red\b[^*]*)\*\*/i);
    h.counts = line ? countsIn(line[1], ['red', 'amber', 'unknown', 'info', 'green']) : {};
    h.figures = [[h.counts.red, 'red'], [h.counts.amber, 'amber']];
    h.result = line ? plain(line[1]) : null;
    const action = section(/^action needed/i);
    const items = action ? action.blocks.filter((b) => b.type === 'heading' && b.level === 3).map((b) => plain(b.text).replace(/\s*\(.*\)\s*$/, '')) : [];
    h.what = items.length ? `Action needed: ${items.slice(0, 2).join(', ')}${items.length > 2 ? `, and ${items.length - 2} more` : ''}.` : 'Nothing needs action.';
  }
  return h;
}

/** summary.md: optional `---` front matter (title, subject, deck, prepared-for), then Markdown. */
export function parseSummary(md) {
  const meta = {};
  let body = String(md || '');
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    body = body.slice(fm[0].length);
  }
  return { meta, ...splitReport(body) };
}

const STATUS_CLASS = [
  [/block|fail|critical|high|red|urgent/i, 'fail'],
  [/warn|medium|amber|moderate/i, 'warn'],
  [/pass|green|ok/i, 'pass'],
];
export const statusClass = (word) => (STATUS_CLASS.find(([re]) => re.test(word)) || [null, 'info'])[1];

/** "**Title** — detail [Blocker · Security]" -> { title, detail, status, sources } */
export function parseAction(text) {
  let t = text.trim();
  let status = null, sources = [];
  const tag = t.match(/\s*\[([^\]]+)\]\s*$/);
  if (tag && !/\]\(/.test(t.slice(tag.index))) {
    const parts = tag[1].split(/\s*[·|]\s*/);
    status = parts.shift() || null;
    sources = parts.join(', ').split(/\s*,\s*/).filter(Boolean);
    t = t.slice(0, tag.index);
  }
  const m = t.match(/^\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?([\s\S]*)$/);
  return m ? { title: m[1], detail: m[2].trim(), status, sources } : { title: t, detail: '', status, sources };
}

const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The combined report as Markdown: summary, at-a-glance table, then every report with headings demoted one level. */
export function combinedMarkdown({ summary, reports, heads, date, version }) {
  const subject = summary.meta.subject || heads.find((h) => h.target)?.target || 'Audit';
  const out = [`# ${summary.meta.title || `Audit report: ${subject}`}`, ''];
  out.push(`${subject} · ${fmtDate(date)} · audit-all ${version}`, '');
  if (summary.meta.deck) out.push(`_${summary.meta.deck}_`, '');
  const body = summary.raw ? summary.raw.trim() : '';
  if (body) out.push(body, '');
  out.push('## At a glance', '', '| Audit | Target | Result | Report |', '|---|---|---|---|');
  reports.forEach((r, i) => out.push(`| ${KINDS[r.kind].title} | ${heads[i].target || ''} | ${(heads[i].result || '').replace(/\|/g, '\\|')} | \`${r.folder}/report.md\` |`));
  out.push('');
  for (const r of reports) {
    out.push(demote(r.md).trim(), '');
  }
  return out.join('\n');
}

function demote(md) {
  let fence = false;
  return md.split('\n').map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (!fence && /^#{1,5}\s/.test(l)) return `#${l}`;
    return l;
  }).join('\n');
}

// ---- HTML ---------------------------------------------------------------------------------

const row = (label, body, cls = '') => `<div class="row${cls ? ` ${cls}` : ''}"><div class="margin"><div class="label">${label}</div></div><div class="body">${body}</div></div>`;

function renderSection(sec) {
  const label = inline(sec.heading.replace(/^\d+\.\s*/, ''));
  return row(label, renderBlocks(sec.blocks));
}

function renderSummary(summary) {
  const parts = [];
  for (const sec of summary.sections) {
    const name = plain(sec.heading);
    if (/^verdict$/i.test(name)) {
      const paras = sec.blocks.filter((b) => b.type === 'para');
      const rest = sec.blocks.filter((b) => b.type !== 'para' || b !== paras[0]);
      parts.push(row(inline(sec.heading), (paras[0] ? `<p class="verdict">${joinLines(paras[0].lines)}</p>` : '') + renderBlocks(rest.filter((b) => b !== paras[0]))));
    } else if (/^(fix first|top actions|actions)$/i.test(name) && sec.blocks.some((b) => b.type === 'list' && b.ordered)) {
      const list = sec.blocks.find((b) => b.type === 'list' && b.ordered);
      const notes = sec.blocks.filter((b) => b !== list);
      const items = list.items.map((it) => {
        const a = parseAction(it.text.join(' '));
        const src = [a.status ? `<span class="st ${statusClass(a.status)}">${escapeHtml(a.status)}</span>` : '', a.sources.length ? `<span class="src-tag">${escapeHtml(a.sources.join(', '))}</span>` : ''].join('');
        return `<li><div><div class="t">${inline(a.title)}</div>${a.detail ? `<div class="d">${inline(a.detail)}</div>` : ''}${it.children.length ? renderBlocks(it.children) : ''}</div><div class="src">${src}</div></li>`;
      }).join('\n');
      const margin = `<div class="label">${inline(sec.heading)}</div>${notes.length ? `<div class="note">${renderBlocks(notes)}</div>` : ''}`;
      parts.push(`<div class="row"><div class="margin">${margin}</div><div class="body"><ol class="actions">${items}</ol></div></div>`);
    } else {
      parts.push(renderSection(sec));
    }
  }
  if (summary.intro.length) parts.unshift(row('Summary', renderBlocks(summary.intro)));
  return parts.join('\n');
}

function glanceTable(reports, heads) {
  const rows = reports.map((r, i) => {
    const h = heads[i];
    return `<tr><td>${KINDS[r.kind].title}${h.target ? `<span class="sub mono">${escapeHtml(h.target)}</span>` : ''}</td><td>${escapeHtml(h.result || '')}</td><td class="mono">${escapeHtml(r.folder)}/report.md</td></tr>`;
  }).join('\n');
  return `<div class="tbl-wrap"><table class="glance"><thead><tr><th>Audit</th><th>Result</th><th>Full report</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function coverMeta(reports, heads) {
  return reports.map((r, i) => {
    const h = heads[i];
    const figs = (h.figures || []).filter(([n]) => n !== undefined).map(([n, w]) => `${n} <small>${w}</small>`).join(' ');
    const label = `${KINDS[r.kind].title}${reports.filter((x) => x.kind === r.kind).length > 1 && h.target ? ` · <span class="mono">${escapeHtml(h.target)}</span>` : ''}`;
    return `<div><div class="label">${label}</div>${figs ? `<div class="n">${figs}</div>` : ''}${h.what ? `<div class="what">${escapeHtml(h.what)}</div>` : ''}</div>`;
  }).join('\n');
}

/** Full HTML document. `css` is the stylesheet text (fonts included); `style` is serif or sans. */
export function combinedHtml({ summary, reports, heads, date, version, css, style, toolVersions = {} }) {
  const subject = summary.meta.subject || heads.find((h) => h.target)?.target || 'Audit';
  const title = summary.meta.title || `Audit report: ${subject}`;
  const names = [...new Set(reports.map((r) => KINDS[r.kind].title))].map((t, i) => (i ? t.toLowerCase() : t));
  const deck = summary.meta.deck || `${names.join(', ').replace(/, ([^,]*)$/, ' and $1')}, checked on ${fmtDate(date)}.`;
  const tools = [`audit-all ${version}`, ...Object.entries(toolVersions).map(([k, v]) => `${k} ${v}`)].join(' · ');

  const audits = reports.map((r, i) => {
    const { intro, sections } = splitReport(r.md);
    const kind = KINDS[r.kind];
    const target = heads[i].target;
    const meta = intro.length ? `<div class="result-line">${renderBlocks(intro)}</div>` : '';
    const opener = `<div class="row opener"><div class="margin"><div class="sec-no">${i + 1}</div></div><div class="body"><h2>${kind.title}${target ? ` <span class="target mono">${escapeHtml(target)}</span>` : ''}</h2><p class="standfirst">${kind.standfirst}</p>${meta}</div></div>`;
    return `<section class="audit" data-kind="${r.kind}">\n${opener}\n${sections.map(renderSection).join('\n')}\n</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(subject)}</title>
<style>
${css}
@page { @top-left { content: "${cssString(subject)}"; } @top-right { content: "Combined audit · ${cssString(fmtDate(date))}"; } }
</style>
</head>
<body class="style-${style}">
<article class="report">
<section class="cover">
  <div class="label kicker">Audit report</div>
  <h1>${inline(title)}<span class="host mono">${escapeHtml(subject)}</span></h1>
  <p class="deck">${inline(deck)}</p>
  <div class="meta cols-${Math.min(reports.length, 3)}">${coverMeta(reports, heads)}</div>
  <div class="colophon"><span>${summary.meta['prepared-for'] ? `Prepared for ${escapeHtml(summary.meta['prepared-for'])}` : fmtDate(date)}</span><span>${escapeHtml(tools)}</span></div>
</section>
<section class="summary">
${renderSummary(summary)}
${row('At a glance', glanceTable(reports, heads))}
</section>
${audits}
</article>
</body>
</html>
`;
}

const cssString = (s) => String(s).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ');
