/**
 * Checks a JSON-LD draft against the page it was written for: every text value must be on the
 * page, every URL must be the page, its site, or a link or image the page carries, and every date
 * must be one the page shows. Anything else is reported as "not on the page", the guard against a
 * draft that invents a founding year, an award or an author.
 *
 * Zero dependencies. Node >= 22. Pure.
 */

// Keys whose values are vocabulary, identifiers or settings rather than claims about the page.
const SKIP_KEYS = new Set(['@context', '@type', '@id', '@language', 'inLanguage', 'encodingFormat', 'availability', 'itemCondition', 'eventStatus', 'eventAttendanceMode', 'employmentType', 'priceCurrency', 'applicationCategory', 'operatingSystem', 'contactType', 'areaServed', 'addressCountry', 'position', 'width', 'height', 'ratingValue', 'bestRating', 'worstRating']);
const PAGE_DATE_KEYS = /^(datePublished|dateModified)$/;
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

const stripSlash = (u) => String(u).replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();

/** True when a URL is the page, its site root, or a link, image or meta URL the page carries. */
export function knownUrl(value, page) {
  let u;
  try { u = new URL(value); } catch { return false; }
  const want = stripSlash(u.toString());
  const origin = new URL(page.url).origin.toLowerCase();
  if (want === stripSlash(page.url) || want === origin || (page.canonical && want === stripSlash(page.canonical))) return true;
  if ((page.urls || []).some((x) => stripSlash(x) === want)) return true;
  // A path on the same site counts when the page links to it (with or without a locale prefix or case change).
  if (u.origin.toLowerCase() === origin) return (page.urls || []).some((x) => stripSlash(x).endsWith(stripSlash(u.pathname)));
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
 * `page` is an extract record (pages/<slug>.json): text, title, description, og, urls, dates, url.
 */
export function verifyDraft(data, page) {
  const haystack = norm([page.text, page.title, page.description, ...Object.values(page.og || {}), ...(page.breadcrumbs || []).map((b) => b.name), ...(page.org?.phones || []), ...(page.org?.emails || [])].join(' \n '));
  const dates = new Set(page.dates || []);
  const out = [];
  for (const [p, key, raw] of leaves(data)) {
    const value = String(raw).trim();
    if (!value) continue;
    if (typeof raw === 'number') continue;
    if (/^https?:\/\//i.test(value)) {
      if (!knownUrl(value, page)) out.push({ path: p, value, reason: 'URL not linked from the page' });
      continue;
    }
    if (/^mailto:|^tel:/i.test(value)) { if (!haystack.includes(norm(value.replace(/^\w+:/, '')))) out.push({ path: p, value, reason: 'contact not on the page' }); continue; }
    if (DATE_KEYS.test(key)) {
      const d = value.slice(0, 10);
      const year = /^\d{4}$/.test(value);
      if (year ? !haystack.includes(value) : !dates.has(d)) out.push({ path: p, value, reason: year ? 'year not on the page' : 'date not shown on the page' });
      // A publication date must be the date the page shows as its own, not a deadline in the text.
      else if (PAGE_DATE_KEYS.test(key) && !year && d !== page.leadDate) out.push({ path: p, value, reason: page.leadDate ? `the page's own date is ${page.leadDate}` : 'the page shows no date of its own near the top; this date is from the text' });
      continue;
    }
    if (/^#|^_:/.test(value)) continue;
    if (words(value).length <= 1 && value.length <= 3) continue;
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
