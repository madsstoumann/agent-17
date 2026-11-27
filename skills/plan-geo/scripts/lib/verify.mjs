/**
 * Checks a JSON-LD draft against the page it was written for: every text value must be on the
 * page, every URL must be the page, its site, or a link or image the page carries, and every date
 * must be one the page shows. Anything else is reported as "not on the page", the guard against a
 * draft that invents a founding year, an award or an author.
 *
 * A masked secret from a page archive (`abcd…[masked <type>]`) is a placeholder, never a value:
 * a draft that carries one is flagged, whatever the page shows.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { hasMask } from './archive.mjs';
import { GUESSED_DATE } from './extract.mjs';

/** A schema.org enumeration member (https://schema.org/Tuesday, …/InStock): vocabulary, not a claim. */
const SCHEMA_ENUM = /^https?:\/\/schema\.org\/[A-Z][A-Za-z0-9]*$/;

// Keys whose values are vocabulary, identifiers or settings rather than claims about the page.
const SKIP_KEYS = new Set(['@context', '@type', '@id', '@language', 'inLanguage', 'encodingFormat', 'availability', 'itemCondition', 'eventStatus', 'eventAttendanceMode', 'employmentType', 'priceCurrency', 'applicationCategory', 'operatingSystem', 'contactType', 'areaServed', 'addressCountry', 'position', 'width', 'height', 'ratingValue', 'bestRating', 'worstRating']);
const PAGE_DATE_KEYS = /^(datePublished|dateModified)$/;

// Day names in the languages extract.mjs reads dates in (English, Danish, Norwegian, Swedish,
// German, Dutch, French, Spanish): a dayOfWeek "Monday" is on a page that says "mandag".
const DAY_NAMES = {
  monday: 'monday mandag måndag montag maandag lundi lunes',
  tuesday: 'tuesday tirsdag tisdag dienstag dinsdag mardi martes',
  wednesday: 'wednesday onsdag mittwoch woensdag mercredi miércoles miercoles',
  thursday: 'thursday torsdag donnerstag donderdag jeudi jueves',
  friday: 'friday fredag freitag vrijdag vendredi viernes',
  saturday: 'saturday lørdag lördag laurdag samstag sonnabend zaterdag samedi sábado sabado',
  sunday: 'sunday søndag söndag sonntag zondag dimanche domingo',
};

/** True when the page names the day `value` ("Monday", "schema.org/Monday") in one of DAY_NAMES' languages. */
export function dayOnPage(value, haystack) {
  const day = String(value).replace(/^https?:\/\/schema\.org\//i, '').toLowerCase();
  const names = DAY_NAMES[day];
  if (!names) return null;
  return names.split(' ').some((n) => new RegExp(`(?<![\\p{L}])${n}(?![\\p{L}])`, 'u').test(haystack));
}
// Short day names, read only as the ends of a range ("man.–fre.", "Mon-Fri", "Mo–Fr").
const DAY_SHORT = {
  monday: 'mon man mån mo', tuesday: 'tue tues tir tis di', wednesday: 'wed ons mi', thursday: 'thu thur thurs tor to do',
  friday: 'fri fre fr', saturday: 'sat lør lör lau sa', sunday: 'sun søn sön so',
};
const WEEK = Object.keys(DAY_NAMES);

/**
 * The days a page covers with a range ("Mandag - torsdag: kl. 8.00-16.00", "mandag til fredag",
 * "Monday to Friday", "Montag bis Freitag", "måndag–fredag", "Mon–Fri"), as English day keys.
 * Read from the raw text: norm() turns the dash into a space.
 */
export function daysInRanges(text) {
  const out = new Set();
  const t = String(text || '').toLowerCase().normalize('NFKC').replace(/[‐-―]/g, '-');
  const long = new Map(WEEK.flatMap((d) => DAY_NAMES[d].split(' ').map((n) => [n, d])));
  const short = new Map(WEEK.flatMap((d) => DAY_SHORT[d].split(' ').map((n) => [n, d])));
  const alt = (m) => [...m.keys()].sort((a, b) => b.length - a.length).join('|');
  const ranges = [
    new RegExp(`(?<![\\p{L}])(${alt(long)})\\s*(?:-|\\s(?:til|to|through|thru|bis|till|tot|t\\.o\\.m\\.|tom)\\s)\\s*(${alt(long)})(?![\\p{L}])`, 'gu'),
    new RegExp(`(?<![\\p{L}])(${alt(short)})\\.?\\s*-\\s*(${alt(short)})\\.?(?![\\p{L}])`, 'gu'),
  ];
  for (const [i, re] of ranges.entries()) {
    const map = i ? short : long;
    for (const m of t.matchAll(re)) {
      const a = WEEK.indexOf(map.get(m[1]));
      const b = WEEK.indexOf(map.get(m[2]));
      if (a < 0 || b < 0 || a === b) continue;
      for (let k = a; ; k = (k + 1) % 7) { out.add(WEEK[k]); if (k === b) break; }
    }
  }
  return out;
}

/**
 * Every number the text shows, as plain numbers: "7.120,-" and "7 120 kr." are 7120, "1,234.50"
 * is 1234.5, "99,95" is 99.95. A group of three digits after one separator ("1.160") is read both
 * ways (1160 and 1.16): the page's language decides, and either reading is on the page.
 */
export function numbersIn(text) {
  const out = new Set();
  const t = String(text || '').normalize('NFKC');
  for (const m of t.matchAll(/(?<![\d.,])\d{1,3}(?:([.,\u0020\u00a0\u202f'’])\d{3})(?:\1\d{3})*(?:[.,]\d+)?(?![\d])|(?<![\d.,])\d+(?:[.,]\d+)?(?![\d])/g)) {
    const raw = m[0];
    const sep = m[1];
    if (sep) {
      const [whole, dec] = raw.split(new RegExp(`[${sep === '.' ? ',' : sep === ',' ? '.' : '.,'}](?=\\d+$)`));
      const n = Number(`${whole.split(sep).join('')}${dec !== undefined && whole !== raw ? `.${dec}` : ''}`);
      if (Number.isFinite(n)) out.add(n);
      if (/^\d{1,3}[.,]\d{3}$/.test(raw)) out.add(Number(raw.replace(',', '.')));
    } else {
      out.add(Number(raw.replace(',', '.')));
    }
  }
  out.delete(NaN);
  return out;
}

/**
 * Every clock time the text shows, as "HH:MM": "kl. 8.00 -16.00", "08:00", "kl. 8", "10-17",
 * "9am", "5 pm". An opens/closes of "08:00" is on a page that says "kl. 8.00".
 */
export function timesIn(text) {
  const out = new Set();
  const t = String(text || '').normalize('NFKC').replace(/[‐-―]/g, '-');
  const add = (h, m = 0) => { if (h >= 0 && h <= 24 && m >= 0 && m < 60) out.add(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); };
  for (const x of t.matchAll(/(?<![\d.:])(\d{1,2})[.:](\d{2})(?![\d])/g)) add(+x[1], +x[2]);
  for (const x of t.matchAll(/\bkl\.?\s*(\d{1,2})(?![\d.:])/gi)) add(+x[1]);
  for (const x of t.matchAll(/(?<![\d.:,/-])(\d{1,2})\s*-\s*(\d{1,2})(?![\d.:/-]|,\d)/g)) if (+x[1] < +x[2]) { add(+x[1]); add(+x[2]); }
  for (const x of t.matchAll(/(?<![\d.:])(\d{1,2})(?:[.:](\d{2}))?\s*([ap])\.?m\.?(?![\p{L}])/giu)) {
    const h = +x[1] % 12 + (x[3].toLowerCase() === 'p' ? 12 : 0);
    add(h, +(x[2] || 0));
  }
  return out;
}

/** A draft value that is only a number ("7120", "7120.00", "99,95"): the number, else null. */
function draftNumber(value) {
  const v = String(value).trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(v)) return null;
  return Number(v.replace(',', '.'));
}

const DATE_KEYS = /^(datePublished|dateModified|dateCreated|uploadDate|startDate|endDate|validFrom|validThrough|datePosted|foundingDate|birthDate|expires)$/;

/** Lowercase, accents kept, quotes and dashes unified, punctuation to spaces, whitespace collapsed. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}'%$€£]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s) => norm(s).split(' ').filter(Boolean);

/** True when `value` is on the page: as a phrase, or for long text, at least 80 % of its five-word runs. */
export function onPage(value, haystack) {
  const v = norm(value);
  if (!v) return true;
  if (haystack.includes(v)) return true;
  const w = v.split(' ');
  if (w.length < 12) return false;
  const runs = [];
  for (let i = 0; i + 5 <= w.length; i++) runs.push(w.slice(i, i + 5).join(' '));
  return runs.filter((r) => haystack.includes(r)).length / runs.length >= 0.8;
}

const decode = (u) => { try { return decodeURI(u); } catch { return u; } };
const stripSlash = (u) => decode(String(u).replace(/[?#].*$/, '').replace(/\/$/, '')).toLowerCase();

/**
 * True when a URL is the page, its site root, or a link, image or meta URL the page carries.
 * The page's URLs are resolved against the page first, so a relative one ("/media/logo.png",
 * "media/logo.png") matches the draft's absolute URL; percent-encoding is compared decoded.
 */
export function knownUrl(value, page) {
  let u;
  try { u = new URL(value); } catch { return false; }
  const want = stripSlash(u.toString());
  const origin = new URL(page.url).origin.toLowerCase();
  if (want === stripSlash(page.url) || want === stripSlash(origin) || (page.canonical && want === stripSlash(page.canonical))) return true;
  const urls = (page.urls || []).map((x) => { try { return new URL(x, page.url).toString(); } catch { return x; } });
  if (urls.some((x) => stripSlash(x) === want)) return true;
  // A path on the same site counts when the page links to it (with or without a locale prefix or case change).
  if (u.origin.toLowerCase() === origin) return urls.some((x) => stripSlash(x).endsWith(stripSlash(u.pathname)));
  return false;
}

/** Walk every leaf value: yields [path, key, value]. Fragment ids ("#organization") and @id values are skipped. */
function* leaves(value, pathParts = [], key = '') {
  if (Array.isArray(value)) { for (const [i, v] of value.entries()) yield* leaves(v, [...pathParts, String(i)], key); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) yield* leaves(v, [...pathParts, k], k);
    return;
  }
  if (typeof value === 'string' || typeof value === 'number') yield [pathParts.join('.').replace(/\.(\d+)(?=\.|$)/g, '[$1]'), key, value];
}

/**
 * verifyDraft(data, page) -> [{ path, value, reason }]: values the page does not back up.
 * `page` is an extract record (pages/<slug>.json): text, title, description, og, urls, dates,
 * dayMonths, modifiedDates, url. A dayOfWeek is on the page when the page names that day in a
 * language it may be written in. A dateModified the page labels as its last change ("Last updated
 * 4 June 2024") may sit anywhere on it. An event date (startDate, endDate…) is on the page when the page shows that day
 * and month, with or without the year; datePublished and dateModified need the full date.
 */
export function verifyDraft(data, page) {
  const pageText = [page.text, page.title, page.description, ...Object.values(page.og || {}), ...(page.breadcrumbs || []).map((b) => b.name), ...(page.org?.phones || []), ...(page.org?.emails || [])].join(' \n ');
  const haystack = norm(pageText);
  let ranged = null;
  let numbers = null;
  let times = null;
  const dates = new Set(page.dates || []);
  // Day and month shown without a year ("torsdag den 5. november kl. 17-22"): an event's date.
  const dayMonths = new Set(page.dayMonths || []);
  const out = [];
  for (const [p, key, raw] of leaves(data)) {
    const value = String(raw).trim();
    if (!value) continue;
    if (typeof raw === 'number') continue;
    if (hasMask(value)) { out.push({ path: p, value: value.length > 90 ? `${value.slice(0, 87)}…` : value, reason: 'masked placeholder from the page archive, not a real value' }); continue; }
    if (SCHEMA_ENUM.test(value)) continue;
    if (/^https?:\/\//i.test(value)) {
      if (!knownUrl(value, page)) out.push({ path: p, value, reason: 'URL not linked from the page' });
      continue;
    }
    if (/^mailto:|^tel:/i.test(value)) { if (!haystack.includes(norm(value.replace(/^\w+:/, '')))) out.push({ path: p, value, reason: 'contact not on the page' }); continue; }
    if (DATE_KEYS.test(key)) {
      const d = value.slice(0, 10);
      const year = /^\d{4}$/.test(value);
      const shown = year ? haystack.includes(value) : dates.has(d) || (!PAGE_DATE_KEYS.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(d) && dayMonths.has(d.slice(5)));
      if (!shown) out.push({ path: p, value, reason: year ? 'year not on the page' : 'date not shown on the page' });
      // A change date the page labels as one ("Senest ændret 2025-03-11", "Last updated …"), wherever it sits.
      else if (key === 'dateModified' && !year && (page.modifiedDates || []).includes(d)) continue;
      // A publication date must be the date the page shows as its own, not a deadline in the text.
      else if (PAGE_DATE_KEYS.test(key) && !year && d !== page.leadDate) out.push({ path: p, value, reason: !page.leadDate ? 'the page states no date of its own near the top; this date is from the text' : ['dateline', 'press'].includes(page.leadDateSource) ? `the page does not label its own date; the date line by the title reads ${page.leadDate}` : `the page's own date is ${page.leadDate}` });
      // The page's own date read from an unlabelled line (a date line by the h1, a press dateline):
      // it may be the page date, but nothing on the page says so; a person confirms it first.
      else if (PAGE_DATE_KEYS.test(key) && !year && GUESSED_DATE.has(page.leadDateSource)) out.push({ path: p, value, reason: `the page does not label this date (${page.leadDateSource === 'press' ? 'a press release dateline' : 'a date line next to the h1'}); confirm it before using it as ${key}` });
      continue;
    }
    if ((key === 'opens' || key === 'closes') && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) {
      times ??= timesIn(pageText);
      const [h, m] = value.split(':').map(Number);
      if (!times.has(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)) out.push({ path: p, value, reason: 'time not shown on the page' });
      continue;
    }
    if (key === 'dayOfWeek' && dayOnPage(value, haystack) !== null) {
      // A day inside a range the page shows ("Mandag - torsdag") is on the page without being named.
      ranged ??= daysInRanges(pageText);
      if (!dayOnPage(value, haystack) && !ranged.has(String(value).replace(/^https?:\/\/schema\.org\//i, '').toLowerCase())) out.push({ path: p, value, reason: 'day not named on the page' });
      continue;
    }
    if (/^#|^_:/.test(value)) continue;
    if (words(value).length <= 1 && value.length <= 3) continue;
    // A number the page writes with thousands separators or a ",-" ("7.120,-" for a draft's "7120").
    const num = draftNumber(value);
    if (num !== null && !onPage(value, haystack)) { numbers ??= numbersIn(pageText); if (numbers.has(num)) continue; }
    if (!onPage(value, haystack)) out.push({ path: p, value: value.length > 90 ? `${value.slice(0, 87)}…` : value, reason: 'text not on the page' });
  }
  return out;
}

/** Every @type in a JSON-LD value. */
export function typesIn(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) typesIn(v, out); return out; }
  if (value && typeof value === 'object') {
    const t = value['@type'];
    for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string') out.add(x.replace(/^(https?:\/\/)?schema\.org\//, ''));
    for (const [k, v] of Object.entries(value)) if (k !== '@type') typesIn(v, out);
  }
  return out;
}
