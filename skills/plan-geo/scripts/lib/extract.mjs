/**
 * What a page says, in a shape Claude can read and the check step can verify against: the page
 * as plain Markdown (headings, paragraphs, lists, tables), its question-and-answer pairs, the
 * dates and bylines it shows, its breadcrumb trail, the organisation details in its header and
 * footer (logo, social profiles, phone, email), and every link and image URL it carries.
 *
 * Approximate on purpose, like html.mjs: regexes over the HTML, no DOM. Good enough to read a
 * CMS template; the check step only needs to know whether a value appears on the page.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { decodeEntities, extractMeta, tokenize } from './html.mjs';
import { hiddenBlocks, blocksMarkdown, blockWords } from './rsc.mjs';

/**
 * Month names by number, in the languages sites are most often written in here: English, Danish,
 * Norwegian, Swedish, German, Dutch, French and Spanish, with their usual abbreviations.
 */
const MONTH_NAMES = [
  'january jan januar januari janvier enero jänner',
  'february feb februar februari février fevrier febrero',
  'march mar marts mars märz maerz maart marzo mrt',
  'april apr avril abril',
  'may maj mai mei mayo',
  'june jun juni juin junio',
  'july jul juli juillet julio',
  'august aug augusti augustus août aout agosto',
  'september sep sept septembre septiembre setiembre',
  'october oct okt oktober octobre octubre',
  'november nov novembre noviembre',
  'december dec desember dezember dez décembre decembre diciembre',
];
const MONTH = new Map(MONTH_NAMES.flatMap((names, i) => names.split(' ').map((n) => [n, i + 1])));
const MONTH_RE = [...MONTH.keys()].sort((a, b) => b.length - a.length).join('|');
const SOCIAL = /^(?:[\w-]+\.)?(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|tiktok\.com|vimeo\.com|xing\.com|glassdoor\.[a-z.]+|crunchbase\.com|wikipedia\.org|wikidata\.org)$/i;

const clean = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const resolve = (href, base) => { try { const u = new URL(String(href).trim(), base); return /^https?:$/.test(u.protocol) ? (u.hash = '', u.toString()) : null; } catch { return null; } };
const countWords = (s) => (s ? s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0);

/** The body without scripts, styles, SVG, templates and comments. */
function bodyHtml(html) {
  const src = String(html || '');
  const body = /<body[^>]*>/i.test(src) ? src.replace(/^[\s\S]*?<body[^>]*>/i, '') : src;
  return body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

/** Cookie banners and dialogs say nothing about the page. */
const dropConsent = (html) => html.replace(/<(div|section|aside)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:onetrust|cookiebot|usercentrics|didomi|cookie-?consent|cookie-?banner)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');

/** The main content: <main> when there is one, else the body without nav, header, footer and aside. */
function mainHtml(body) {
  const m = body.match(/<main\b[^>]*>([\s\S]*)<\/main\s*>/i);
  if (m && countWords(clean(m[1])) >= 40) return m[1];
  return body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

/**
 * HTML to Markdown-ish lines: `#` headings, `- ` list items, `| a | b |` table rows, paragraphs.
 * Nested blocks are flattened; a line is whatever text sits between two block boundaries.
 */
export function toMarkdown(html) {
  let s = String(html || '');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, n, inner) => `\n\n${'#'.repeat(Number(n))} ${clean(inner)}\n\n`);
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (_, inner) => {
    const cells = [...inner.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((c) => clean(c[2]).replace(/\|/g, '/'));
    return cells.length ? `\n| ${cells.join(' | ')} |\n` : '\n';
  });
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li\s*>/gi, '\n');
  s = s.replace(/<dt\b[^>]*>/gi, '\n- **').replace(/<\/dt\s*>/gi, '**\n').replace(/<dd\b[^>]*>/gi, '\n  ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(p|div|section|article|table|thead|tbody|ul|ol|dl|blockquote|figure|figcaption|header|footer|main|nav|aside|form|fieldset|details|summary|button)\b[^>]*>/gi, '\n\n');
  s = decodeEntities(s.replace(/<[^>]*>/g, ' '));
  const lines = s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim());
  const out = [];
  for (const l of lines) {
    if (!l || l === '-' || l === '- **' || l === '****') { if (out.length && out.at(-1) !== '') out.push(''); continue; }
    // Short runs of text inside one paragraph (spans, links) end up on their own lines: join them.
    const prev = out.at(-1);
    if (prev && !/^(#|- |\| )/.test(l) && !/^(#|\| )/.test(prev) && prev !== '') out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Headings in order: [{ level, text }]. */
export function outline(markdown) {
  return markdown.split('\n').map((l) => /^(#{1,6}) (.+)$/.exec(l)).filter(Boolean).map((m) => ({ level: m[1].length, text: m[2].trim() }));
}

/** A heading that asks something ("What is an IBOR?") and the text under it, up to the next heading. */
export function questionPairs(markdown, { maxWords = 120 } = {}) {
  const lines = markdown.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6} (.+\?)\s*$/.exec(lines[i]);
    if (!h) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && !/^#{1,6} /.test(lines[j]); j++) if (lines[j]) body.push(lines[j]);
    const answer = body.join(' ').split(/\s+/).slice(0, maxWords).join(' ');
    out.push({ question: h[1].trim(), answer, words: countWords(body.join(' ')) });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null);

/**
 * Dates written on the page, as YYYY-MM-DD: "12 March 2025", "March 12, 2025", "2025-03-12",
 * "12.03.2025", "12/03/2025" (day first), and day-month-year in the languages MONTH_NAMES covers:
 * "1. oktober 2026", "d. 9. november 2026", "1er octobre 2026", "1 de octubre de 2026". In a range
 * ("1. oktober – 29. marts 2027", "3.–5. juni 2026") the first date takes the year from the second.
 * A date without a year ("torsdag den 5. november") is not a date the page shows in full.
 */
export function visibleDates(text) {
  const out = new Set();
  const t = String(text || '');
  const month = (w) => MONTH.get(w.toLowerCase().replace(/\.$/, '')) || 0;
  const L = '(?<![\\p{L}\\d])';
  const R = '(?![\\p{L}])';
  const day = '(\\d{1,2})(?:st|nd|rd|th|er|e)?\\.?';
  const mon = `(${MONTH_RE})\\.?`;
  const dmy = new RegExp(`${L}${day}\\s+(?:de\\s+)?${mon}${R},?\\s+(?:de\\s+)?(\\d{4})(?!\\d)`, 'giu');
  const mdy = new RegExp(`${L}${mon}${R}\\s+${day},?\\s+(\\d{4})(?!\\d)`, 'giu');
  // Ranges whose first part has no year: "1. oktober – 29. marts 2027", "3.–5. juni 2026".
  const rangeMonths = new RegExp(`${L}${day}\\s+${mon}${R}\\s*[-–—]\\s*(?:til\\s+|to\\s+|bis\\s+|au\\s+)?${day}\\s+${mon}${R},?\\s+(\\d{4})(?!\\d)`, 'giu');
  const rangeDays = new RegExp(`${L}(\\d{1,2})\\.?\\s*[-–—]\\s*${day}\\s+${mon}${R},?\\s+(\\d{4})(?!\\d)`, 'giu');
  for (const m of t.matchAll(dmy)) out.add(iso(+m[3], month(m[2]), +m[1]));
  for (const m of t.matchAll(mdy)) out.add(iso(+m[3], month(m[1]), +m[2]));
  for (const m of t.matchAll(rangeMonths)) {
    const [m1, m2, y] = [month(m[2]), month(m[4]), +m[5]];
    out.add(iso(m1 > m2 ? y - 1 : y, m1, +m[1]));
  }
  for (const m of t.matchAll(rangeDays)) out.add(iso(+m[4], month(m[3]), +m[1]));
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(iso(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) out.add(iso(+m[3], +m[2], +m[1]));
  out.delete(null);
  return [...out].sort();
}

/**
 * The page's own date, when it shows one: the first date in the opening of the main content
 * (above or just under the h1, before the body text starts). null when the page shows none there;
 * dates further down are usually about something else (a deadline, an event, a quoted report).
 */
export function leadDate(markdown) {
  const lines = String(markdown || '').split('\n').filter(Boolean);
  const h1 = lines.findIndex((l) => /^# /.test(l));
  let words = 0;
  const head = [];
  for (const l of lines.slice(0, Math.max(0, h1) + 40)) {
    head.push(l);
    if (!/^(#|- )/.test(l)) words += l.split(/\s+/).length;
    if (words > 120) break;
  }
  return visibleDates(head.join('\n'))[0] || null;
}

/** "By Jane Doe", "Author: Jane Doe", "Written by …": the names a byline shows. */
export function bylines(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\b(?:[Bb]y|[Aa]uthors?:|[Ww]ritten by|af|[Ss]krevet af)\s+((?:[A-ZÆØÅÄÖÜ][\p{L}'-]+\s?){2,4})/gu)) out.add(m[1].trim());
  return [...out].slice(0, 5);
}

/** The breadcrumb trail: a nav or list labelled or classed "breadcrumb". [{ name, url }] */
export function breadcrumbs(html, base) {
  const m = String(html || '').match(/<(nav|ol|ul|div)\b[^>]*(?:aria-label|class|id)\s*=\s*["'][^"']*breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/i);
  if (!m) return [];
  const items = [];
  for (const a of m[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(a[1]);
    const name = clean(a[2]);
    if (name) items.push({ name, url: href ? resolve(href[1], base) : null });
  }
  const last = clean(m[2].replace(/<a\b[\s\S]*?<\/a\s*>/gi, ' ')).replace(/[›»>/|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (last && !items.some((i) => i.name === last) && countWords(last) <= 12) items.push({ name: last, url: null });
  return items;
}

/** Logo, social profiles, phone and email from the whole page (header and footer included). */
export function organisation(html, base, meta) {
  const tokens = tokenize(html);
  // The site's own logo sits in the header (or the first part of the page), not in a client-logo grid.
  const head = /<header\b[\s\S]*?<\/header\s*>/i.exec(html)?.[0] || String(html).slice(0, Math.max(20000, Math.floor(String(html).length / 5)));
  const logoTok = tokenize(head).find((t) => t.tag === 'img' && /logo/i.test(`${t.attrs.src || ''} ${t.attrs.alt || ''} ${t.attrs.class || ''} ${t.attrs.id || ''}`) && !/client|customer|partner/i.test(t.attrs.src || ''));
  const social = new Set();
  const phones = new Set();
  const emails = new Set();
  const logo = logoTok ? resolve(logoTok.attrs.src || logoTok.attrs['data-src'] || '', base) : null;
  for (const t of tokens) {
    if (t.tag === 'a' && t.attrs.href) {
      const h = t.attrs.href.trim();
      if (/^tel:/i.test(h)) phones.add(decodeURIComponent(h.slice(4)).trim());
      else if (/^mailto:/i.test(h)) emails.add(decodeURIComponent(h.slice(7).split('?')[0]).trim());
      else { const u = resolve(h, base); if (u && SOCIAL.test(new URL(u).hostname) && new URL(u).pathname.length > 1) social.add(u.replace(/\/$/, '')); }
    }
  }
  const icon = (meta.icons || []).find((i) => /apple-touch-icon/.test(i.rel))?.href || (meta.icons || [])[0]?.href || null;
  return { name: meta.og?.site_name || null, logo, icon, social: [...social].sort(), phones: [...phones], emails: [...emails] };
}

/** Every link and image URL on the page, for checking the URLs a JSON-LD draft uses. */
export function pageUrls(html, base) {
  const out = new Set();
  for (const t of tokenize(html)) {
    const v = t.tag === 'a' || t.tag === 'link' ? t.attrs.href : t.tag === 'img' || t.tag === 'source' || t.tag === 'video' ? (t.attrs.src || t.attrs['data-src'] || (t.attrs.srcset || '').split(/[\s,]+/)[0]) : t.tag === 'meta' && /^(og:|twitter:)/i.test(t.attrs.property || t.attrs.name || '') ? t.attrs.content : null;
    const u = v && resolve(v, base);
    if (u) out.add(u);
  }
  return [...out];
}

/**
 * extractPage(html, url) -> the page record plan-geo keeps in pages/<slug>.json:
 * { url, title, description, lang, canonical, h1, words, markdown, outline, questions, dates,
 *   bylines, breadcrumbs, org, og, urls, jsonLd: [data], text }
 * `text` is the whole visible text (main content plus header and footer), for the check step.
 * `hidden` is text the page carries only in its Next.js payload (closed accordions and tabs that
 * mount their content on open): { source, words, markdown }, or null. A visitor reads it after a
 * click, so it counts for `text`, `dates` and `questions` (marked `hidden: true`), but it is not in
 * the served HTML, and crawlers that do not run JavaScript never see it.
 */
export function extractPage(html, url) {
  const meta = extractMeta(html, url);
  const body = dropConsent(bodyHtml(html));
  const mainMd = toMarkdown(mainHtml(body));
  const shownText = clean(body);
  const hidden = hiddenBlocks(html, shownText);
  const hiddenMd = blocksMarkdown(hidden);
  const hiddenText = hidden.filter((b) => !b.shown).map((b) => b.text).join(' ');
  const fullText = hiddenText ? `${shownText} ${hiddenText}` : shownText;
  return {
    url,
    title: meta.title,
    description: meta.description,
    lang: meta.lang,
    canonical: meta.canonical,
    h1: meta.h1s[0] || null,
    words: countWords(mainMd.replace(/[#|*-]/g, ' ')),
    markdown: mainMd,
    outline: outline(mainMd),
    questions: mergeQuestions(questionPairs(mainMd), hidden.length ? questionPairs(hiddenMd) : []),
    tables: mainMd.split('\n').filter((l) => l.startsWith('| ')).length,
    dates: visibleDates(fullText),
    leadDate: leadDate(mainMd),
    bylines: bylines(fullText),
    breadcrumbs: breadcrumbs(body, url),
    org: organisation(html, url, meta),
    og: meta.og,
    urls: pageUrls(html, url),
    jsonLd: meta.jsonLd.filter((j) => !j.error).map((j) => j.data),
    hidden: hiddenText ? { source: 'Next.js payload', words: blockWords(hidden), markdown: hiddenMd } : null,
    text: fullText,
  };
}

/** The page's question headings plus the payload's questions: an answer from the payload fills an empty one. */
function mergeQuestions(shown, fromPayload) {
  const out = shown.map((q) => ({ ...q }));
  for (const q of fromPayload) {
    if (!q.answer) continue;
    const same = out.find((x) => x.question === q.question);
    if (same && !same.answer) Object.assign(same, { answer: q.answer, words: q.words, hidden: true });
    else if (!same) out.push({ ...q, hidden: true });
  }
  return out;
}

/** A readable digest of a page record for Claude: metadata, then the content as Markdown (capped). */
export function pageDigest(p, { maxChars = 14000 } = {}) {
  const lines = [`# ${p.title || p.url}`, '', `URL: ${p.url}`];
  if (p.description) lines.push(`Meta description: ${p.description}`);
  if (p.lang) lines.push(`Language: ${p.lang}`);
  lines.push(`Words in main content: ${p.words} · question headings: ${p.questions.length} · table rows: ${p.tables}${p.hidden ? ` · words only in the Next.js payload: ${p.hidden.words}` : ''}`);
  lines.push(`Page date: ${p.leadDate || 'none shown near the top'}${p.dates.length ? ` · other dates in the text: ${p.dates.filter((d) => d !== p.leadDate).join(', ') || 'none'}` : ''}`);
  if (p.bylines.length) lines.push(`Bylines: ${p.bylines.join(', ')}`);
  if (p.breadcrumbs.length) lines.push(`Breadcrumb: ${p.breadcrumbs.map((b) => b.name).join(' › ')}`);
  const o = p.org;
  if (o.name || o.logo || o.social.length || o.phones.length || o.emails.length) {
    lines.push(`Organisation details: ${[o.name && `name ${o.name}`, o.logo && `logo ${o.logo}`, o.social.length && `social ${o.social.join(', ')}`, o.phones.length && `phone ${o.phones.join(', ')}`, o.emails.length && `email ${o.emails.join(', ')}`].filter(Boolean).join(' · ')}`);
  }
  if (p.og?.image) lines.push(`og:image: ${p.og.image}`);
  lines.push(`Existing JSON-LD: ${p.jsonLd.length ? JSON.stringify(p.jsonLd).slice(0, 1500) : 'none'}`, '', '## Content', '');
  const md = p.markdown.length > maxChars ? `${p.markdown.slice(0, maxChars)}\n\n[… cut at ${maxChars} characters; the full text is in the .json file]` : p.markdown;
  lines.push(md, '');
  if (p.hidden) {
    const cap = Math.max(2000, maxChars - md.length);
    lines.push('## Only in the Next.js payload', '', `${p.hidden.words} words the page carries only in its script payload: behind accordions or tabs that mount their content when opened. Visitors read it after a click; it is not in the served HTML, so crawlers that do not run JavaScript miss it, and Google sees it only if it renders the page with the accordion open.`, '');
    lines.push(p.hidden.markdown.length > cap ? `${p.hidden.markdown.slice(0, cap)}\n\n[… cut at ${cap} characters; the full text is in the .json file under hidden.markdown]` : p.hidden.markdown, '');
  }
  return lines.join('\n');
}
