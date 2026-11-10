/**
 * Groups an audit-seo crawl into page templates, guesses what kind of page each template is, and
 * picks the pages plan-geo reads in full.
 *
 * A template is the URL section a page sits in: the first two folders of its parent path, with a
 * locale prefix (/en/, /da-DK/) left out, so /resources/insights/articles/2025/x and
 * /en/resources/insights/y are one template, "resources/insights". The guess is a starting point:
 * Claude confirms or corrects it after reading the sample pages.
 *
 * Zero dependencies. Node >= 22. Pure.
 */

import { visibleDates } from './extract.mjs';

const LOCALE = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;

/** Indexable HTML pages in an audit-seo report. */
export const indexable = (p) => p && p.status === 200 && !p.noindex && (!p.contentType || /html/i.test(p.contentType));

/** The template key for a URL: "home", "about-us", "resources/insights", … */
export function templateKey(url) {
  let segs;
  try { segs = new URL(url).pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase()); } catch { return 'other'; }
  if (segs.length && LOCALE.test(segs[0]) && !/^(faq|api|app|blog|news|jobs|shop|help|cases)$/i.test(segs[0])) segs = segs.slice(1);
  if (!segs.length) return 'home';
  const parent = segs.slice(0, -1);
  if (!parent.length) return segs.length === 1 ? (LEAF_SECTIONS.test(segs[0]) ? segs[0] : 'top-level') : segs[0];
  return parent.slice(0, 2).filter((s) => !/^\d{4}$/.test(s)).join('/') || 'top-level';
}
// One-segment pages that are their own template rather than "a top-level page".
const LEAF_SECTIONS = /^(contact|about|about-us|faq|faqs|glossary|careers|jobs|pricing|blog|news|press|events|team|people|legal|privacy|terms|search|sitemap)$/i;

/**
 * The page-type guesses, first match wins. `types` are the schema.org types the template usually
 * carries; `modules` the content modules worth considering. Claude has the final word.
 */
export const PAGE_TYPES = [
  { type: 'home', test: (k) => k === 'home', types: ['Organization', 'WebSite'], modules: ['key facts', 'FAQ'] },
  { type: 'legal', test: (k) => /(^|\/)(legal|privacy|cookie|cookies|terms|imprint|impressum|disclaimer|trademark|accessibility-statement)/.test(k), types: ['WebPage'], modules: [] },
  { type: 'news', test: (k) => /(^|\/)(news|press|press-releases?|newsroom|media)(\/|$)/.test(k), types: ['NewsArticle', 'BreadcrumbList'], modules: [] },
  { type: 'case-study', test: (k) => /(case-stud\w*|success-stor\w*|customer-stor\w*|(^|\/)references?|(^|\/)cases)(\/|$)/.test(k), types: ['Article', 'BreadcrumbList'], modules: ['key facts', 'quote'] },
  { type: 'article', test: (k) => /(^|\/)(blog|insights?|articles?|commentary|market-commentary|perspectives|thought-leadership|stories|magazine|knowledge|white-papers?|reports?|guides?|resources\/[\w-]+)(\/|$)/.test(k), types: ['Article', 'BreadcrumbList'], modules: ['FAQ', 'key takeaways'] },
  { type: 'event', test: (k) => /(^|\/)(events?|webinars?|conferences?)(\/|$)/.test(k), types: ['Event', 'BreadcrumbList'], modules: [] },
  { type: 'job', test: (k) => /(^|\/)(careers?|jobs?|vacanc|join-us|positions?)(\/|$)/.test(k), types: ['JobPosting', 'BreadcrumbList'], modules: ['FAQ'] },
  { type: 'person', test: (k) => /(^|\/)(team|people|leadership|management|board|experts?|authors?)(\/|$)/.test(k), types: ['Person', 'ProfilePage'], modules: [] },
  { type: 'contact', test: (k) => /(^|\/)(contact|offices?|locations?)(\/|$|-)/.test(k), types: ['ContactPage', 'Organization'], modules: [] },
  { type: 'about', test: (k) => /(^|\/)(about|about-us|who-we-are|company|our-story)(\/|$)/.test(k), types: ['AboutPage', 'Organization'], modules: ['key facts'] },
  { type: 'faq', test: (k) => /(^|\/)(faqs?|help|support|questions)(\/|$)/.test(k), types: ['FAQPage'], modules: ['FAQ'] },
  { type: 'glossary', test: (k) => /(^|\/)(glossary|dictionary|terms-explained|what-is)(\/|$)/.test(k), types: ['DefinedTermSet', 'DefinedTerm'], modules: ['glossary'] },
  { type: 'product', test: (k) => /(^|\/)(products?|solutions?|platform|software|features?|modules?|apps?|shop|store)(\/|$)/.test(k), types: ['SoftwareApplication|Product|Service', 'BreadcrumbList'], modules: ['FAQ', 'comparison table', 'key facts'] },
  { type: 'service', test: (k) => /(^|\/)(services?|consulting|training|training-services|academy|managed-[\w-]+)(\/|$)/.test(k), types: ['Service', 'BreadcrumbList'], modules: ['FAQ', 'comparison table'] },
  { type: 'audience', test: (k) => /(^|\/)(industr(y|ies)|your-industry|sectors?|segments?|who-we-serve|clients?|for-[\w-]+)(\/|$)/.test(k), types: ['WebPage', 'Service', 'BreadcrumbList'], modules: ['FAQ', 'comparison table'] },
];

/** The first guess for a template, from its key and what audit-seo saw on its pages. */
export function guessType(key, pages = []) {
  const hit = PAGE_TYPES.find((t) => t.test(key));
  if (hit) return hit;
  const articles = pages.filter((p) => p.sig?.articleLike || p.sig?.visibleDate).length;
  if (articles && articles >= pages.length / 2) return PAGE_TYPES.find((t) => t.type === 'article');
  return { type: 'page', types: ['WebPage', 'BreadcrumbList'], modules: [] };
}

const jsonLdTypes = (p) => [...new Set((p.jsonLd || []).flatMap((j) => j.types || []))];
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };

/**
 * groupTemplates(pages) -> [{ key, slug, type, types, modules, pages: n, urls: [...], markup: {type: n},
 *   questionPages: n, articleLike: n, words: median }], biggest first, home first.
 * Duplicate URLs that differ only in case are counted once.
 */
export function groupTemplates(pages) {
  const seen = new Set();
  const groups = new Map();
  for (const p of pages.filter(indexable)) {
    const id = p.url.toLowerCase().replace(/\/$/, '');
    if (seen.has(id)) continue;
    seen.add(id);
    const key = templateKey(p.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const out = [];
  for (const [key, ps] of groups) {
    const g = guessType(key, ps);
    const markup = {};
    for (const p of ps) for (const t of jsonLdTypes(p)) markup[t] = (markup[t] || 0) + 1;
    const words = ps.map((p) => p.words || 0).sort((a, b) => a - b);
    out.push({
      key,
      slug: key.replace(/\//g, '--').replace(/[^\w-]+/g, '-') || 'page',
      type: g.type,
      types: g.types,
      modules: g.modules,
      pages: ps.length,
      urls: ps.map((p) => p.url),
      markup,
      questionPages: ps.filter((p) => (p.sig?.questionHeadings || 0) > 0).length,
      articleLike: ps.filter((p) => p.sig?.articleLike || p.sig?.visibleDate).length,
      words: words[Math.floor(words.length / 2)] || 0,
    });
  }
  return out.sort((a, b) => (a.key === 'home' ? -1 : b.key === 'home' ? 1 : b.pages - a.pages || a.key.localeCompare(b.key)));
}

// Separators between a page's own title and the site name: "Annual pass | Example Museum".
const TITLE_SEP = /\s+[|–—·-]\s+|\s*\|\s*/;

/** The site name most titles end with ("Example Museum"), or the start page's title. */
export function siteName(pages) {
  const counts = new Map();
  const titled = pages.filter((p) => p?.title);
  for (const p of titled) {
    const parts = p.title.split(TITLE_SEP).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) counts.set(parts.at(-1).toLowerCase(), (counts.get(parts.at(-1).toLowerCase()) || 0) + 1);
  }
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
  if (top && n >= titled.length * 0.3) return top;
  const home = titled.find((p) => pathOf(p.url) === '/');
  return home ? home.title.split(TITLE_SEP)[0].trim().toLowerCase() : null;
}

/** A title of its own: not empty and not just the site name ("Example" on a news item). */
export function properTitle(title, brand) {
  const own = String(title || '').split(TITLE_SEP).map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== brand);
  return own.length > 0;
}

const DATED_TYPES = new Set(['news', 'article', 'case-study']);

/** The page's date for "most recent": its published date, the date it shows, or a year in its path. */
export function pageDate(p) {
  const d = /^\d{4}-\d{2}-\d{2}/.exec(String(p?.sig?.published || ''))?.[0] || visibleDates(String(p?.sig?.visibleDate || ''))[0];
  if (d) return d;
  const y = /\/((?:19|20)\d{2})\//.exec(pathOf(p?.url || ''))?.[1];
  return y ? `${y}-00-00` : '';
}

// Legal pages inside another section (/about/privacy-policy) are never that section's example.
const LEGAL_LEAF = /^(privacy|privacy-policy|privacy-notice|privatlivspolitik|persondatapolitik|privatlivserklaering|privatlivserklæring|cookies?|cookie-policy|cookiepolitik|terms|terms-of-use|terms-and-conditions|handelsbetingelser|vilkaar|vilkår|betingelser|legal|imprint|impressum|datenschutz|disclaimer|accessibility-statement|tilgaengelighedserklaering|was|whistleblower)$/i;

// A listing or search page (calendar, archive, search) inside a section lists the section's pages:
// it stands for none of them.
const LISTING_LEAF = /^(kalender|calendar|events?|arrangementer|veranstaltungen|agenda|program|arkiv|archive|search|soeg|sog|søg|sok|sök|suche|zoeken|recherche|buscar)$/i;

/** The URL's path segments with a locale prefix left out, lowercased (as templateKey() reads them). */
function segments(url) {
  let segs;
  try { segs = new URL(url).pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x).toLowerCase(); } catch { return x.toLowerCase(); } }); } catch { return []; }
  if (segs.length && LOCALE.test(segs[0]) && !/^(faq|api|app|blog|news|jobs|shop|help|cases)$/i.test(segs[0])) segs = segs.slice(1);
  return segs;
}

/** A URL without its hash and trailing slash, lowercased: for "the same page". */
export const sameKey = (u) => { try { const x = new URL(u); x.hash = ''; return x.toString().replace(/\/(?=$|\?)/, '').toLowerCase(); } catch { return String(u || '').toLowerCase(); } };

/** The page's canonical URL when it names another page on the same site, else null. */
function otherCanonical(p) {
  if (!p?.canonical) return null;
  try {
    const c = new URL(p.canonical, p.url);
    if (c.host.toLowerCase() !== new URL(p.url).host.toLowerCase()) return null;
    return sameKey(c.toString()) === sameKey(p.url) ? null : c.toString();
  } catch { return null; }
}

/**
 * pickSample(templates, pages, { max, urls }) -> [{ url, template, why }]
 * The pages named with `urls` (--urls), each the example of its template, then the start page,
 * then one example page per other template, then a second page for the biggest templates, then
 * pages with three or more question headings, until `max`. No page is read twice: a URL whose
 * canonical names a page already picked, or that differs from one only by a trailing slash, is
 * the same page.
 *
 * The example is a representative page, not simply the longest: its own canonical (not a variant
 * whose canonical points elsewhere, such as /?panel=…), without a query string, with a title of its
 * own (not just the site name), not a legal page that sits in another section (/about/privacy),
 * not thin for its template (at least half the median word count), not the landing page of a
 * sub-section that is a template of its own, the most recent in a template named as news,
 * articles or case studies, then the longest. The longest page of a news section was often a
 * statement titled only with the site name.
 */
export function pickSample(templates, pages, { max = 24, urls = [] } = {}) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const brand = siteName(pages);
  const out = [];
  const taken = new Set();
  const named = new Set();
  const add = (url, template, why) => {
    if (out.length >= max || !url) return false;
    const p = byUrl.get(url);
    const ids = [sameKey(url), ...(otherCanonical(p) ? [sameKey(otherCanonical(p))] : [])];
    if (ids.some((id) => taken.has(id))) return false;
    for (const id of ids) taken.add(id);
    out.push({ url, template, why });
    return true;
  };
  const ranked = (t) => {
    const ps = t.urls.map((u) => byUrl.get(u)).filter(Boolean);
    const words = ps.map((p) => p.words || 0).sort((a, b) => a - b);
    const median = words[Math.floor(words.length / 2)] || 0;
    const legalLeaf = (p) => t.type !== 'legal' && LEGAL_LEAF.test(segments(p.url).at(-1) || '');
    const listing = (p) => { const s = segments(p.url); return s.length > 0 && LISTING_LEAF.test(s.at(-1)) && s.join('/') !== t.key; };
    // A URL with a query string (a filtered or paged listing) or a canonical elsewhere is a variant,
    // not the template's page.
    const key = (p) => [(properTitle(p.title, brand) ? 0 : 1) + (/\?/.test(p.url) ? 2 : 0) + (otherCanonical(p) ? 2 : 0) + (legalLeaf(p) ? 4 : 0), ((p.words || 0) >= median / 2 ? 0 : 2) + (listing(p) ? 1 : 0)];
    // Recency counts where pages are dated publications (news, articles, case studies); on other
    // templates a date on the page is an event or a deadline, not the page's age.
    // Only a template named as one (/news/, /blog/, /cases/): a mixed section that is mostly dated
    // pages is guessed as articles too, but its newest page says nothing about the section.
    const dated = DATED_TYPES.has(PAGE_TYPES.find((x) => x.test(t.key))?.type) ? pageDate : () => '';
    return ps.sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      return ka[0] - kb[0] || ka[1] - kb[1] || dated(b).localeCompare(dated(a))
        || (b.words || 0) - (a.words || 0) || pathOf(a.url).length - pathOf(b.url).length;
    });
  };
  for (const u of urls) {
    const key = templateKey(u);
    if (add(u, key, 'named with --urls')) named.add(key);
  }
  const skip = (t) => t.type === 'legal';
  for (const t of templates) {
    if (skip(t) || named.has(t.key)) continue;
    // The first of the ranked pages that is not a page already picked.
    for (const p of ranked(t)) if (add(p.url, t.key, t.key === 'home' ? 'start page' : 'representative page of the template')) break;
  }
  for (const t of templates.filter((x) => !skip(x) && x.pages >= 5)) {
    for (const p of ranked(t).slice(1)) if (add(p.url, t.key, 'second page of a large template')) break;
  }
  const qs = pages.filter(indexable).filter((p) => (p.sig?.questionHeadings || 0) >= 3).sort((a, b) => b.sig.questionHeadings - a.sig.questionHeadings);
  for (const p of qs) add(p.url, templateKey(p.url), `${p.sig.questionHeadings} question headings`);
  return out;
}

/** A file name for a page: its path, flattened. */
export function pageSlug(url) {
  const p = pathOf(url).replace(/^\/+|\/+$/g, '').toLowerCase();
  return (p.replace(/[^\w-]+/g, '-').replace(/-{2,}/g, '-').slice(0, 80) || 'home').replace(/-+$/, '');
}
