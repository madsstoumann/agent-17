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
import { dropConsentHtml } from './consent.mjs';

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

/** Cookie banners and dialogs say nothing about the page (the tools are listed in lib/consent.mjs). */
const dropConsent = dropConsentHtml;

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

/** Weekday names in the languages MONTH_NAMES covers, for telling a dateline ("Thursday 5 November 2026") from prose. */
const WEEKDAYS = new Set('monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun mandag tirsdag onsdag torsdag fredag lørdag søndag måndag tisdag fredag lördag söndag montag dienstag mittwoch donnerstag freitag samstag sonntag maandag dinsdag woensdag donderdag vrijdag zaterdag zondag lundi mardi mercredi jeudi vendredi samedi dimanche lunes martes miércoles jueves viernes sábado domingo'.split(' '));

/**
 * Dates written on the page, as YYYY-MM-DD: "12 March 2025", "March 12, 2025", "2025-03-12",
 * "12.03.2025", "12/03/2025" (day first), and day-month-year in the languages MONTH_NAMES covers:
 * "1. oktober 2026", "d. 9. november 2026", "1er octobre 2026", "1 de octubre de 2026". In a range
 * ("1. oktober – 29. marts 2027", "3.–5. juni 2026") the first date takes the year from the second;
 * in a list ("5., 12. og 19. december 2026", "5, 12 and 19 December 2026") every day counts.
 * A date without a year ("torsdag den 5. november") is not a full date: see dayMonths().
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
  // Lists of days in one month: "5., 12. og 19. december 2026", "5, 12 and 19 December 2026".
  for (const m of t.matchAll(dayList(true))) {
    const [mo, y] = [month(m[2]), +m[3]];
    for (const d of m[1].match(/\d{1,2}/g)) out.add(iso(y, mo, +d));
  }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(iso(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) out.add(iso(+m[3], +m[2], +m[1]));
  out.delete(null);
  return [...out].sort();
}

/** "5., 12. og 19. december[ 2026]": the days (group 1), the month (2) and, with `year`, the year (3). */
function dayList(year) {
  const d = '\\d{1,2}(?:st|nd|rd|th|er|e)?\\.?';
  const and = '(?:og|and|und|en|et|y|och|&)';
  return new RegExp(`(?<![\\p{L}\\d.])((?:${d}\\s*,\\s*)*${d}\\s*,?\\s+${and}\\s+${d})\\s+(${MONTH_RE})\\.?(?![\\p{L}])${year ? ',?\\s+(\\d{4})(?!\\d)' : '(?!,?\\s+\\d{4})'}`, 'giu');
}

/**
 * Day and month shown without a year, as MM-DD: "torsdag den 5. november kl. 17-22", "5 November",
 * "5., 12. og 19. december". A draft date on such a day is on the page (an event page that leaves
 * the year to its context); a date that carries a year is left to visibleDates().
 */
export function dayMonths(text) {
  const out = new Set();
  const t = String(text || '');
  const month = (w) => MONTH.get(w.toLowerCase().replace(/\.$/, '')) || 0;
  const add = (mo, d) => { if (mo && d >= 1 && d <= 31) out.add(`${pad(mo)}-${pad(d)}`); };
  const dm = new RegExp(`(?<![\\p{L}\\d.])(\\d{1,2})(?:st|nd|rd|th|er|e)?\\.?\\s+(?:de\\s+)?(${MONTH_RE})\\.?(?![\\p{L}])(?!,?\\s+(?:de\\s+)?\\d{4})`, 'giu');
  const md = new RegExp(`(?<![\\p{L}\\d])(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d\\p{L}])(?!,?\\s+\\d{4})(?!\\s*:)`, 'giu');
  for (const m of t.matchAll(dm)) add(month(m[2]), +m[1]);
  for (const m of t.matchAll(md)) add(month(m[1]), +m[2]);
  for (const m of t.matchAll(dayList(false))) for (const d of m[1].match(/\d{1,2}/g)) add(month(m[2]), +d);
  return [...out].sort();
}

// Labels that put a page's own date next to it: "Opdateret 9. november 2026", "Published: 4 June 2024".
const DATE_LABEL = /(?:^|[\s(|·•,–—-])(?:sidst\s+|last\s+|zuletzt\s+|senast\s+)?(?:opdateret|publiceret|udgivet|offentliggjort|redigeret|revideret|ændret|updated|published|posted|revised|edited|oppdatert|publisert|uppdaterad|publicerad|aktualisiert|veröffentlicht|bijgewerkt|gepubliceerd|mis\s+à\s+jour|publié|actualizado|publicado)(?:\s+(?:d\.|den|on|le|am|op|el|the))?\s*:?\s*/giu;
// Marks the start of a <time> element or an element classed as a date or byline (see markDated()).
const DATE_MARK = '⁣';
const DATE_CLASS = /^(?:[\w-]*[-_])?(?:date|dateline|byline|by-line|author|authors|writer|published|pubdate|posted|timestamp|datetime|meta-?date|post-?meta|article-?meta)(?:[-_][\w-]*)?$/i;
const NOT_PAGE_DATE_CLASS = /event|start|end|range|deadline|opening|calendar|schedule|expir|birth/i;

/**
 * The HTML with DATE_MARK in front of each <time> element (and its datetime value) and the text of
 * each element whose class, id or itemprop names a date or byline, so leadDate() can tell a
 * dateline from a date in the prose.
 */
export function markDated(html) {
  return String(html || '')
    .replace(/<time\b([^>]*)>([\s\S]{0,200}?)<\/time\s*>/gi, (m, attrs, inner) => {
      // The datetime value counts only when the element shows a day too: a teaser's
      // <time datetime="2026-07-20">2026</time> says the year of a card, not the page's date.
      const dt = /\bdatetime\s*=\s*["']\s*(\d{4}-\d{2}-\d{2})/i.exec(attrs)?.[1];
      const text = clean(inner);
      const shown = visibleDates(text).length || dayMonths(text).length || /\b\d+\s+\w+\s+ago\b|\bsiden\b/i.test(text);
      return `<time${attrs}>${DATE_MARK}${dt && shown ? `${dt} ` : ''}${inner}</time>`;
    })
    .replace(/<([a-z][\w-]*)\b([^>]*)>/gi, (m, tag, attrs) => {
      if (/^(time|script|style|a|html|body|main|article|section)$/i.test(tag)) return m;
      const values = [...attrs.matchAll(/\b(?:class|id|itemprop)\s*=\s*["']([^"']*)["']/gi)].flatMap((x) => x[1].split(/\s+/)).filter(Boolean);
      return values.some((v) => DATE_CLASS.test(v) && !NOT_PAGE_DATE_CLASS.test(v)) ? `${m}${DATE_MARK}` : m;
    });
}

// Words before a date that make it something other than the page's date: an event's start, a
// deadline, a release, an appointment ("Fra torsdag den 5. februar 2026", "Appointed 16 September 2024").
const NOT_PAGE_DATE_WORD = /^(?:fra|from|til|to|until|indtil|siden|since|ab|bis|seit|du|au|vanaf|tot|sinds|desde|hasta|från|frå|appointed|joined|born|founded|died|udnævnt|udpeget|født|død|ansat|tiltrådt|grundlagt|etableret|deadline|frist|ansøgningsfrist|opens?|opening|åbner|åbning|closes?|lukker|ends?|slutter|starts?|starter|begins?|release[sd]?|udkommer|udgives|premiere|valid|gyldig|expires?|udløber|event|arrangement)$/i;

/**
 * True when a line is a date with at most a short label before it: "June 7, 2023", "Torsdag 7. juni
 * 2023", "News November 5, 2026", "Patch Notes July 24, 2026". Not a list or range of dates, and
 * not a date after "Fra", "Appointed", "Deadline" and the like.
 */
function dateline(line) {
  const t = String(line || '').replace(new RegExp(DATE_MARK, 'g'), '').trim();
  if (visibleDates(t).length !== 1) return false;
  const rest = t.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g, ' ').toLowerCase().split(/[\s,.]+/).filter(Boolean);
  const label = rest.filter((w) => !(/^\d{1,4}(?:st|nd|rd|th|er|e)?$/.test(w) || MONTH.has(w) || WEEKDAYS.has(w) || /^(den|d|de|the|of|le|am|el)$/.test(w)));
  return label.length <= 3 && label.every((w) => /^[\p{L}&|·•:-]+$/u.test(w) && !NOT_PAGE_DATE_WORD.test(w.replace(/:$/, '')));
}

/**
 * The date of a press release's dateline at the start of a line: up to seven capitalised place
 * words, then the date, then a dash ("New York, June 5, 2024 – Example has won", "NASHVILLE,
 * Tenn., February 17, 2026 - …"). null when the line does not open that way.
 */
export function pressDateline(line) {
  const words = String(line || '').split(/\s+/);
  for (let k = 1; k <= Math.min(7, words.length - 2); k++) {
    const place = words.slice(0, k);
    if (!place.every((w) => /^(?:\p{Lu}[\p{L}.'’]*,?|[–—-])$/u.test(w)) || place.some((w) => NOT_PAGE_DATE_WORD.test(w.replace(/[,.]$/, '')))) break;
    if (/^[–—-]$/.test(place[0])) break;
    const rest = words.slice(k).join(' ');
    if (!new RegExp(`^(?:\\d|(?:${MONTH_RE})(?![\\p{L}]))`, 'iu').test(rest)) continue;
    const m = /^(.{6,30}?)\s[–—-]\s/u.exec(rest);
    const d = m && visibleDates(m[1]);
    if (d && d.length === 1) return d[0];
  }
  return null;
}

/**
 * The page's own date, when it shows one near the title: a <time> element or an element classed as
 * a date or byline, a date after a label ("Opdateret 9. november 2026", "Published: 4 June 2024"),
 * a dateline right above or below the h1 ("June 7, 2023", "News November 5, 2026"), or a press
 * release's dateline opening the first paragraph ("New York, June 5, 2024 – Example has won"). Never a date in the
 * prose, an FAQ answer, an event's dates or a label such as "Appointed" or "Born", and never a
 * date after `today`: a page is not published in the future, an event is. null when there is none.
 * `markdown` is toMarkdown() of the main content, with markDated() applied for the element rule.
 */
export function leadDate(markdown, opts = {}) {
  return leadDateSource(markdown, opts)?.date || null;
}

// Where a page date was read. The first two are the page labelling its own date; the last two are
// read from how a line looks (a date alone next to the h1, a press release's opening), so a page
// date from them is a reading, not a statement, and extractPage() (ownDate) prefers the head's
// article:published_time or the page's own JSON-LD datePublished over them when the page shows that date.
export const DATE_SOURCES = {
  element: 'a <time> or date element by the h1',
  label: 'a published/updated label',
  meta: 'article:published_time, shown on the page',
  jsonld: 'the page\'s JSON-LD datePublished, shown on the page',
  dateline: 'a date line next to the h1 (no label)',
  press: 'a press release dateline (no label)',
};
export const GUESSED_DATE = new Set(['dateline', 'press']);

/** leadDate() with where the date came from: { date, source } (a DATE_SOURCES key), or null. */
export function leadDateSource(markdown, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const lines = String(markdown || '').split('\n').filter(Boolean);
  const h1 = lines.findIndex((l) => /^# /.test(l));
  let words = 0;
  const head = [];
  for (const [i, l] of lines.slice(0, Math.max(0, h1) + 40).entries()) {
    head.push([i, l]);
    if (!/^(#|- )/.test(l)) words += l.split(/\s+/).length;
    if (words > 120) break;
  }
  const ok = (d) => (d && d <= today ? d : null);
  // The lines next to the h1 (list items, a breadcrumb trail, skipped): `near` is the one right
  // above and the one right below, `close` up to three either side (where a date or byline
  // element sits; further down it is a teaser's).
  const near = new Set();
  const close = new Set();
  const around = (from, step) => {
    let n = 0;
    for (let i = from; i >= 0 && i < lines.length && n < 3; i += step) {
      if (/^- /.test(lines[i])) continue;
      if (!n) near.add(i);
      close.add(i); n++;
    }
  };
  if (h1 >= 0) { around(h1 - 1, -1); around(h1 + 1, 1); } else around(0, 1);
  // In reading order: the first line that shows the page's date by one of the rules wins.
  for (const [i, l] of head) {
    if (/^# /.test(l)) continue;
    const mark = l.indexOf(DATE_MARK);
    if (mark >= 0 && close.has(i)) {
      const d = ok(visibleDates(l.slice(mark, mark + 80))[0]);
      if (d) return { date: d, source: 'element' };
    }
    DATE_LABEL.lastIndex = 0;
    for (const m of l.matchAll(DATE_LABEL)) {
      const d = ok(visibleDates(l.slice(m.index + m[0].length, m.index + m[0].length + 40))[0]);
      if (d) return { date: d, source: 'label' };
    }
    if (near.has(i) && dateline(l)) {
      const d = ok(visibleDates(l)[0]);
      if (d) return { date: d, source: 'dateline' };
    }
    // A press release's dateline: "Copenhagen, New York – 23 April 2024 – Example today announced".
    const d = !/^#/.test(l) && ok(pressDateline(l));
    if (d) return { date: d, source: 'press' };
  }
  return null;
}

/** article:published_time (or og:published_time) from the head, as YYYY-MM-DD, or null. */
export function publishedMeta(html) {
  const m = /<meta\b[^>]*(?:property|name)\s*=\s*["'](?:article|og):published_time["'][^>]*>/i.exec(String(html || ''));
  const c = m && /\bcontent\s*=\s*["']\s*(\d{4}-\d{2}-\d{2})/i.exec(m[0]);
  return c ? c[1] : null;
}

// Job-title words that end a name in a byline ("Jane Doe Head of Data", "Ole Hansen, Senior Partner").
const ROLE_WORD = /^(?:head|chief|senior|junior|director|global|principal|manager|partner|ceo|cto|cfo|coo|cmo|vp|svp|evp|vice|president|lead|leder|direktør|chef|professor|lektor|specialist|analyst|editor|redaktør|journalist|founder|co-founder|medstifter|stifter|consultant|konsulent|associate|fellow|researcher|forsker|economist|økonom|strategist|engineer|officer|advisor|rådgiver|team|research|product|marketing|sales|executive|managing|general|group|portfolio|investment|business|head-of)$/i;
const NAME_WORD = /^(?:\p{Lu}[\p{L}'’.-]*|van|von|de|der|den|la|le|du|da|af)$/u;
const BYLINE_LABEL = /^(?:(?:intro|text|tekst|words|interview|article|artikel|essay|blog|post|story|historie|foto|photo|photos|video|illustration|indlæg|report|rapport)\s+(?:by|af)|by|af|skrevet af|written by|authors?:?|forfattere?:?|tekst(?: og foto)?:|text:|von|door|par|por|av|autor(?:en)?:?|auteur:?)\s*/i;
const AND = /^(?:og|and|und|en|et|y|och|&)$/i;

/** The name a line opens with: two to four capitalised words, ended by a role word, a comma or the line. */
function nameAt(text) {
  const words = String(text || '').trim().split(/\s+/);
  const name = [];
  let sep = false; // the name ended on a separator ("Doe," or "Doe |")
  for (const w of words) {
    const bare = w.replace(/[,|·•–—(/:]+$/, '');
    if (!bare || ROLE_WORD.test(bare) || !NAME_WORD.test(bare) || /^\p{Lu}{2,}$/u.test(bare)) break;
    name.push(bare);
    if (bare !== w) { sep = true; break; }
    if (name.length === 4) break;
  }
  while (name.length && /^(van|von|de|der|den|la|le|du|da|af)$/.test(name.at(-1))) name.pop();
  if (name.length < 2 || name.filter((w) => /^\p{Lu}/u.test(w)).length < 2 || visibleDates(name.join(' ')).length) return null;
  const rest = words.slice(name.length).join(' ').replace(/^[,|·•–—(/:]+/, '').trim();
  // After the name: nothing, a separator, a job title, or "og/and" and a second name.
  const next = rest.split(/\s+/)[0] || '';
  if (rest && !sep && !/^[,|·•–—(/]/.test(words.slice(name.length).join(' ')) && !ROLE_WORD.test(next) && !AND.test(next)) return null;
  return { name: name.join(' '), rest };
}

/**
 * The names a byline shows: a line that starts with a byline label and names one or two people
 * ("By Jane Doe, Head of Data", "Af Mette Hansen og Ole Jensen"), the name lines under a label of
 * their own ("Authors:" then "Jane Doe" / "Head of Data" / "Ole Hansen"), or the text of an element
 * classed as a byline or author (`markdown` with markDated() applied). A name in the prose ("made
 * by Example AG", "Udpeget af …"), a teaser label or a staff list is not a byline.
 */
export function bylines(markdown) {
  const out = new Set();
  const lines = String(markdown || '').split('\n').map((raw) => ({
    marked: raw.includes(DATE_MARK),
    text: raw.replace(new RegExp(DATE_MARK, 'g'), ' ').replace(/^#{1,6}\s+|^-\s+/, '').replace(/\s+/g, ' ').trim(),
  })).filter((l) => l.text);
  const take = (text) => {
    const a = nameAt(text);
    if (!a) return false;
    out.add(a.name);
    const and = /^(?:og|and|und|en|et|y|och|&)\s+(.*)$/i.exec(a.rest);
    const b = and && nameAt(and[1]);
    if (b) out.add(b.name);
    return true;
  };
  for (const [i, { marked, text }] of lines.entries()) {
    if (text.split(' ').length > 14) continue;
    const label = BYLINE_LABEL.exec(text);
    if (label && label[0].length === text.length) {
      // "Authors:" on its own line: the name lines under it (job titles in between are skipped).
      for (const next of lines.slice(i + 1, i + 7)) {
        if (next.text.split(' ').length > 12) break;
        take(next.text);
      }
      continue;
    }
    if (label && /^[A-ZÆØÅÄÖÜÉ]/.test(text.slice(label[0].length))) {
      take(text.slice(label[0].length));
      continue;
    }
    DATE_LABEL.lastIndex = 0;
    if (marked && !DATE_LABEL.test(text)) take(text);
  }
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

/** The head's own text: title, meta description and the og: and twitter: values, one string. */
export function headText(meta) {
  const values = [meta.title, meta.description, ...Object.values(meta.og || {}), ...Object.values(meta.twitter || {})];
  return values.filter((v) => typeof v === 'string' && v.trim()).join(' \n ');
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
  const main = mainHtml(body);
  const mainMd = toMarkdown(main);
  // The same content with <time>, date and byline elements marked: where the page's own date and
  // byline are read from.
  const markedMd = toMarkdown(markDated(main));
  const shownText = clean(body);
  // Text the served HTML already has in its head (meta description, og: and twitter: tags, the title)
  // is not hidden: Next.js repeats its metadata in the payload, and crawlers read the tags.
  const hidden = hiddenBlocks(html, `${shownText} ${headText(meta)}`);
  const hiddenMd = blocksMarkdown(hidden);
  const hiddenText = hidden.filter((b) => !b.shown).map((b) => b.text).join(' ');
  const fullText = hiddenText ? `${shownText} ${hiddenText}` : shownText;
  const dates = visibleDates(fullText);
  const days = dayMonths(fullText);
  const published = publishedMeta(html);
  const own = ownDate(leadDateSource(markedMd), { published, jsonLd: meta.jsonLd, dates });
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
    dates,
    // The page's own date and where it was read (DATE_SOURCES), or null: see ownDate().
    leadDate: own?.date || null,
    leadDateSource: own?.source || null,
    publishedMeta: published,
    dayMonths: days,
    bylines: bylines(markedMd),
    breadcrumbs: breadcrumbs(body, url),
    org: organisation(html, url, meta),
    og: meta.og,
    urls: pageUrls(html, url),
    jsonLd: meta.jsonLd.filter((j) => !j.error).map((j) => j.data),
    hidden: hiddenText ? { source: 'Next.js payload', words: blockWords(hidden), markdown: hiddenMd } : null,
    text: fullText,
  };
}

/** datePublished (YYYY-MM-DD) from the page's own JSON-LD: an Article, NewsArticle, BlogPosting or WebPage node. */
function jsonLdPublished(blocks) {
  const seen = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (typeof v.datePublished === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.datePublished)) seen.push(v.datePublished.slice(0, 10));
    for (const [k, x] of Object.entries(v)) if (k !== 'datePublished') walk(x);
  };
  for (const b of blocks || []) if (!b.error) walk(b.data);
  return [...new Set(seen)].length === 1 ? seen[0] : null;
}

/**
 * The page's own date, from what states it: a date element or a published/updated label near the h1
 * first; then article:published_time or the page's JSON-LD datePublished, when the page shows that
 * date; then a reading of the lines (an unlabelled date line by the h1, a press dateline). A page
 * that states none has no page date: "unknown" is a correct answer, a wrong date is not.
 */
export function ownDate(lead, { published = null, jsonLd = [], dates = [] } = {}) {
  if (lead && !GUESSED_DATE.has(lead.source)) return lead;
  if (published && dates.includes(published)) return { date: published, source: 'meta' };
  const fromLd = jsonLdPublished(jsonLd);
  if (fromLd && dates.includes(fromLd)) return { date: fromLd, source: 'jsonld' };
  return lead || null;
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
  lines.push(`Page date: ${p.leadDate ? `${p.leadDate} (from ${DATE_SOURCES[p.leadDateSource] || 'the top of the page'}${GUESSED_DATE.has(p.leadDateSource) ? '; the page does not label it, so confirm it before using it as datePublished' : ''})` : 'none stated near the top (unknown)'}${p.publishedMeta ? ` · article:published_time ${p.publishedMeta}${p.dates.includes(p.publishedMeta) ? '' : ' (not shown on the page)'}` : ''}${p.dates.length ? ` · other dates in the text: ${p.dates.filter((d) => d !== p.leadDate).join(', ') || 'none'}` : ''}`);
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
