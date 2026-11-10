// Finds the per-audit reports in a run folder, pulls the headline numbers out of each, and
// builds the combined report as Markdown and as print-ready HTML.
import fs from 'node:fs';
import path from 'node:path';
import { parseBlocks, renderBlocks, inline, joinLines, escapeHtml, plain } from './markdown.mjs';
import { compactReport } from './compact.mjs';
import { stackLines } from './stack.mjs';

export const KINDS = {
  'audit-launch': {
    title: 'Launch audit',
    standfirst: 'The site checked the way a launch reviewer would: PageSpeed, headers, TLS, crawlability and every page the crawler could reach.',
  },
  'audit-a11y': {
    title: 'Accessibility audit',
    standfirst: 'A sample of pages checked against WCAG 2.2 AA and EN 301 549 with axe-core and HTML_CodeSniffer, a keyboard-only walk, and reflow at 320 px.',
  },
  'audit-seo': {
    title: 'SEO / GEO audit',
    standfirst: 'The whole site crawled the way a search engine sees it: indexing, sitemap and robots.txt, links and redirects, titles, canonical and hreflang, share previews and structured data.',
  },
  'audit-eco': {
    title: 'Sustainability audit',
    standfirst: 'Real page loads weighed byte by byte and turned into CO2e per page view with the Sustainable Web Design model, plus a green hosting check.',
  },
  'audit-privacy': {
    title: 'Privacy audit',
    standfirst: 'Three new visitors in a real browser: one makes no choice, one rejects, one accepts. Every cookie, tracker and third country they reach, the consent banner itself, and the privacy policy.',
  },
  'audit-infra': {
    title: 'Infrastructure audit',
    standfirst: 'Everything below the page: domain registration, DNS and DNSSEC, mail authentication, the certificate on every address, the edge, and every subdomain in Certificate Transparency logs.',
  },
  'audit-security': {
    title: 'Security audit',
    standfirst: 'The repository and its git history, scanned for secrets, injection, unsafe request handling and vulnerable dependencies, then triaged by hand.',
  },
  'audit-solution-health': {
    title: 'Solution health',
    standfirst: 'Packages, runtimes and the external APIs the code calls, compared with the previous run.',
  },
};
const ORDER = Object.keys(KINDS);

// audit-seo run with --geo writes a GEO audit: same folder and data, its own title.
const GEO_KIND = {
  title: 'GEO audit',
  standfirst: 'The site seen the way AI search and answer engines see it: which AI crawlers robots.txt and the edge let in, what text and structured data a crawler gets without JavaScript, llms.txt, entity and article markup, dates and authors, and how quotable the pages are.',
};
// audit-security run on a URL (site mode) writes its own report: the live site, not a repository.
const SECURITY_SITE_KIND = {
  title: 'Security audit (site)',
  standfirst: 'The live site checked from outside, passively: security headers including CSP, frame-ancestors, Permissions-Policy, HSTS and Referrer-Policy, cookie flags and CORS, HTTPS redirects, exposed files and admin paths, security.txt, and phishing and malware blocklists.',
};
/** Is this audit-security's site-mode report (a URL was scanned, not a repository)? */
export const isSecuritySite = (r) => r.kind === 'audit-security' && /^#\s+Security audit \(site\)/m.test(r.md || '');
/** The section title and standfirst for a report: KINDS, the GEO ones for audit-seo --geo, the site ones for audit-security on a URL. */
export function kindOf(r) {
  if (r.kind === 'audit-seo' && /^#\s+GEO audit\b/m.test(r.md || '')) return GEO_KIND;
  if (isSecuritySite(r)) return SECURITY_SITE_KIND;
  return KINDS[r.kind];
}

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

// --expect keys -> report folder prefixes.
export const EXPECT_KEYS = { launch: 'audit-launch', a11y: 'audit-a11y', seo: 'audit-seo', eco: 'audit-eco', privacy: 'audit-privacy', infra: 'audit-infra', security: 'audit-security', health: 'audit-solution-health' };

/** The last `n` non-empty lines of a stderr log, or null. */
function tail(file, n = 12) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
    return lines.length ? lines.slice(-n).join('\n') : null;
  } catch { return null; }
}

/**
 * Audits that were started (--expect) but left no report: no `<kind>` or `<kind>-<target>` folder, or
 * a folder without report.md. -> [{ key, kind, title, folder, reason, log, stderr }]. The stderr the
 * audit printed, when it was kept in `<run>/logs/<folder>.stderr`, comes along (last lines).
 */
export function failedAudits(runDir, expect = [], reports = []) {
  const out = [];
  const names = fs.existsSync(runDir) ? fs.readdirSync(runDir) : [];
  for (const key of expect) {
    const kind = EXPECT_KEYS[key];
    if (!kind || reports.some((r) => r.kind === kind)) continue;
    const folder = names.find((n) => (n === kind || n.startsWith(`${kind}-`)) && fs.statSync(path.join(runDir, n)).isDirectory()) || null;
    const logs = path.join(runDir, 'logs');
    const logName = (fs.existsSync(logs) ? fs.readdirSync(logs) : []).find((n) => n === `${folder || kind}.stderr` || (n.startsWith(`${kind}`) && n.endsWith('.stderr'))) || null;
    const log = logName ? `logs/${logName}` : null;
    out.push({
      key, kind, title: KINDS[kind].title, folder,
      reason: folder ? `${folder}/ has no report.md` : `no ${kind}/ folder was written`,
      log, stderr: log ? tail(path.join(runDir, log)) : null,
    });
  }
  return out;
}

const failedText = (f) => `Failed: ${f.reason}${f.log ? ` (stderr in ${f.log})` : ''}`;

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

  if (kind === 'audit-launch' || kind === 'audit-privacy' || kind === 'audit-infra' || isSecuritySite(report)) {
    const line = md.match(/\*\*Result:\*\*\s*(.+)/);
    h.counts = line ? countsIn(line[1], ['pass', 'warn', 'fail', 'info', 'skipped']) : {};
    h.figures = [[h.counts.fail, 'fail'], [h.counts.warn, 'warn']];
    h.result = line ? plain(line[1]) : null;
    const site = md.match(/\*\*Site:\*\*\s*(\S+)/);
    const verdict = isSecuritySite(report) && md.match(/\*\*Verdict:\*\*\s*(.+)/);
    h.what = verdict ? plain(verdict[1]) : h.counts.pass !== undefined ? `${h.counts.pass} checks passed${site ? ` on ${plain(site[1])}` : ''}.` : null;
  } else if (kind === 'audit-a11y') {
    const line = md.match(/\*\*Result:\*\*\s*(.+)/);
    const text = line ? line[1] : '';
    const n = (re) => { const m = text.match(re); return m ? Number(m[1]) : undefined; };
    h.counts = { criteria: n(/(\d+)\s+criteri(?:on|a)\s+failed/i), issues: n(/(\d+)\s+issues?\b/i), review: n(/(\d+)\s+to review/i), pages: n(/(\d+)\s+pages?\b/i) };
    h.figures = [[h.counts.criteria, h.counts.criteria === 1 ? 'criterion failed' : 'criteria failed'], [h.counts.issues, h.counts.issues === 1 ? 'issue' : 'issues']];
    h.result = line ? plain(line[1]) : null;
    const verdict = md.match(/\*\*Verdict:\*\*\s*(.+)/);
    h.what = verdict ? plain(verdict[1]) : null;
  } else if (kind === 'audit-security') {
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
  } else if (kind === 'audit-seo' || kind === 'audit-eco') {
    const line = md.match(/\*\*Result:\*\*\s*(.+)/);
    h.counts = line ? countsIn(line[1], ['fail', 'warn', 'pass', 'info', 'skipped']) : {};
    h.figures = [[h.counts.fail, 'fail'], [h.counts.warn, 'warn']];
    if (kind === 'audit-seo') {
      const crawled = md.match(/\*\*Crawled:\*\*\s*(\d+) HTML pages/);
      const geo = md.match(/\*\*GEO readiness:\*\*\s*(\d+)\/100/);
      h.result = line ? plain(line[1]) : null;
      h.geo = geo ? Number(geo[1]) : undefined;
      h.what = crawled ? `${crawled[1]} pages crawled.${geo ? ` GEO readiness ${geo[1]}/100.` : ''}` : null;
    } else {
      const start = line && line[1].match(/start page ([\d.]+) g CO2e per view \(rating ([A-F]\+?)\)/);
      h.result = start ? `${start[1]} g CO2e per view (${start[2]}) · ${plain(line[1]).split(' · ')[0]}` : (line ? plain(line[1]) : null);
      h.what = start ? `Start page ${start[1]} g CO2e per view, rating ${start[2]}.` : null;
    }
  } else if (kind === 'audit-solution-health') {
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

const SITE_KINDS = new Set(['audit-launch', 'audit-a11y', 'audit-seo', 'audit-eco', 'audit-privacy', 'audit-infra']);
const hostOf = (s) => { const m = String(s || '').trim().toLowerCase().match(/^(?:[a-z]+:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:[:/]|$)/); return m ? m[1].replace(/^www\./, '') : null; };
const baseDomain = (host) => { const l = host.split('.'); return l.slice(/^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(l.slice(-2).join('.')) ? -3 : -2).join('.'); };

/**
 * Site audits that checked another domain than the report's subject (the confirmed live site): a
 * staging or platform address detected from a repo, say. [{ kind, title, target, subject }]
 */
export function siteMismatches(reports, heads, subject) {
  const want = hostOf(subject);
  if (!want) return [];
  return reports.map((r, i) => ({ r, host: hostOf(heads[i].target) }))
    .filter(({ r, host }) => (SITE_KINDS.has(r.kind) || isSecuritySite(r)) && host && baseDomain(host) !== baseDomain(want))
    .map(({ r, host }) => ({ kind: r.kind, title: kindOf(r).title, target: host, subject: want }));
}
const mismatchNote = (m) => `${m.title} checked ${m.target}, not ${m.subject}: its findings may belong to another site or a hosting platform. Run it again on ${m.subject}.`;

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
export function combinedMarkdown({ summary, reports, heads, date, version, stack = [], failed = [] }) {
  const subject = summary.meta.subject || heads.find((h) => h.target)?.target || 'Audit';
  const out = [`# ${summary.meta.title || `Audit report: ${subject}`}`, ''];
  out.push(`${subject} · ${fmtDate(date)} · audit-all ${version}`, '');
  if (summary.meta.deck) out.push(`_${summary.meta.deck}_`, '');
  for (const line of stackLines(stack)) out.push(`Built with: ${line}`, '');
  const body = summary.raw ? summary.raw.trim() : '';
  if (body) out.push(body, '');
  out.push('## At a glance', '', '| Audit | Target | Result | Report |', '|---|---|---|---|');
  reports.forEach((r, i) => out.push(`| ${kindOf(r).title} | ${heads[i].target || ''} | ${(heads[i].result || '').replace(/\|/g, '\\|')} | \`${r.folder}/report.md\` |`));
  for (const f of failed) out.push(`| ${f.title} | | **${failedText(f).replace(/\|/g, '\\|')}** | — |`);
  out.push('');
  for (const f of failed) if (f.stderr) out.push(`${f.title} stderr (last lines):`, '', '```', f.stderr, '```', '');
  for (const m of siteMismatches(reports, heads, summary.meta.subject)) out.push(`> ⚠️ ${mismatchNote(m)}`, '');
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

function glanceTable(reports, heads, failed = []) {
  const rows = [...reports.map((r, i) => {
    const h = heads[i];
    return `<tr><td>${kindOf(r).title}${h.target ? `<span class="sub mono">${escapeHtml(h.target)}</span>` : ''}</td><td>${escapeHtml(h.result || '')}</td><td class="mono">${escapeHtml(r.folder)}/report.md</td></tr>`;
  }), ...failed.map((f) => `<tr class="failed"><td>${escapeHtml(f.title)}</td><td><span class="mk fail"></span><strong>${escapeHtml(failedText(f))}</strong></td><td class="mono">—</td></tr>`)].join('\n');
  return `<div class="tbl-wrap"><table class="glance"><thead><tr><th>Audit</th><th>Result</th><th>Full report</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/**
 * Cover tile text: whole sentences up to `max` characters, so a tile never ends mid-sentence. A first
 * sentence that is already too long ends at a clause or word and gets an ellipsis.
 */
export function clipSentences(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let out = '';
  for (const s of t.split(/(?<=[.!?])\s+/)) { const next = out ? `${out} ${s}` : s; if (next.length > max) break; out = next; }
  if (out) return out;
  // No whole sentence fits: end at the last clause (a comma, colon or semicolon), else at a word.
  const cut = t.slice(0, max - 1);
  const clause = Math.max(...[', ', ': ', '; ', ' – ', ' — '].map((c) => cut.lastIndexOf(c)));
  const end = clause > max / 2 ? clause : Math.max(cut.lastIndexOf(' '), max / 2);
  return `${cut.slice(0, end).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** Contents page: the summary, then every audit with its section number. `pages` maps an id to its page. */
function tocPage(reports, heads, pages = {}) {
  const entry = (id, no, title, target) => `<li><a href="#${id}"><span class="no">${no}</span><span class="t">${title}${target ? ` <span class="sub mono">${escapeHtml(target)}</span>` : ''}</span><span class="pg">${pages[id] ?? ''}</span></a></li>`;
  const items = [entry('summary', '', 'Summary'), ...reports.map((r, i) => entry(`audit-${i + 1}`, i + 1, kindOf(r).title, reports.filter((x) => x.kind === r.kind).length > 1 ? heads[i].target : null))];
  return `<section class="toc" id="contents">${row('Contents', `<ol class="toc-list">${items.join('\n')}</ol>`)}</section>`;
}

function coverMeta(reports, heads) {
  return reports.map((r, i) => {
    const h = heads[i];
    const figs = (h.figures || []).filter(([n]) => n !== undefined).map(([n, w]) => `${n} <small>${w}</small>`).join(' ');
    const label = `${kindOf(r).title}${reports.filter((x) => x.kind === r.kind).length > 1 && h.target ? ` · <span class="mono">${escapeHtml(h.target)}</span>` : ''}`;
    return `<div><div class="label">${label}</div>${figs ? `<div class="n">${figs}</div>` : ''}${h.what ? `<div class="what">${escapeHtml(clipSentences(h.what, reports.length > 6 ? 110 : 140))}</div>` : ''}</div>`;
  }).join('\n');
}

// Page margin boxes do not inherit the body's style class, so their typeface is set per style here.
const PAGE_FONT = { serif: '"AA Newsreader", "Iowan Old Style", Charter, Georgia, serif', sans: '"AA Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif' };

/**
 * Full HTML document. `css` is the stylesheet text (fonts included); `style` is serif or sans;
 * `compact` shortens every sub-report (see compact.mjs).
 * With more than one report a contents page follows the cover; `pages` ({ summary, 'audit-1', … })
 * fills in its page numbers once a first print has shown where each section starts.
 */
export function combinedHtml({ summary, reports, heads, date, version, css, style, toolVersions = {}, compact = false, pages = {}, stack = [], failed = [] }) {
  const subject = summary.meta.subject || heads.find((h) => h.target)?.target || 'Audit';
  const title = summary.meta.title || `Audit report: ${subject}`;
  const names = [...new Set(reports.map((r) => kindOf(r).title))].map((t, i) => (i ? t.toLowerCase() : t));
  const deck = summary.meta.deck || `${names.join(', ').replace(/, ([^,]*)$/, ' and $1')}, checked on ${fmtDate(date)}.`;
  const tools = [`audit-all ${version}`, ...Object.entries(toolVersions).map(([k, v]) => `${k} ${v}`)].join(' · ');

  const audits = reports.map((r, i) => {
    const split = splitReport(r.md);
    const { intro, sections } = compact ? compactReport(split) : split;
    const kind = kindOf(r);
    const target = heads[i].target;
    const meta = intro.length ? `<div class="result-line">${renderBlocks(intro)}</div>` : '';
    const opener = `<div class="row opener"><div class="margin"><div class="sec-no">${i + 1}</div></div><div class="body"><h2>${kind.title}${target ? ` <span class="target mono">${escapeHtml(target)}</span>` : ''}</h2><p class="standfirst">${kind.standfirst}</p>${meta}</div></div>`;
    return `<section class="audit" id="audit-${i + 1}" data-kind="${r.kind}">\n${opener}\n${sections.map(renderSection).join('\n')}\n</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en" class="style-${style}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(subject)}</title>
<style>
${css}
@page { @top-left { content: "${cssString(subject)}"; } @top-right { content: "Combined audit · ${cssString(fmtDate(date))}"; font-family: ${PAGE_FONT[style] || PAGE_FONT.serif}; } @bottom-right { font-family: ${PAGE_FONT[style] || PAGE_FONT.serif}; } }
</style>
</head>
<body class="style-${style}">
<article class="report">
<section class="cover${reports.length > 6 || plain(title).length > 40 ? ' dense' : ''}">
  <div class="label kicker">Audit report</div>
  <h1>${inline(title)}<span class="host mono">${escapeHtml(subject)}</span></h1>
  <p class="deck">${inline(deck)}</p>
  ${stack.length ? `<p class="stack"><span class="label">Built with</span>${stackLines(stack).map((l) => `<span class="line">${escapeHtml(l)}</span>`).join('')}</p>` : ''}
  <div class="meta cols-${Math.min(reports.length, 3)}">${coverMeta(reports, heads)}</div>
  <div class="colophon"><span>${summary.meta['prepared-for'] ? `Prepared for ${escapeHtml(summary.meta['prepared-for'])}` : fmtDate(date)}</span><span>${escapeHtml(tools)}</span></div>
</section>
${reports.length > 1 ? tocPage(reports, heads, pages) : ''}
<section class="summary" id="summary">
${renderSummary(summary)}
${row('At a glance', glanceTable(reports, heads, failed) + siteMismatches(reports, heads, summary.meta.subject).map((m) => `<p class="mismatch"><span class="mk warn"></span>${escapeHtml(mismatchNote(m))}</p>`).join(''))}
</section>
${audits}
</article>
</body>
</html>
`;
}

const cssString = (s) => String(s).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ');
