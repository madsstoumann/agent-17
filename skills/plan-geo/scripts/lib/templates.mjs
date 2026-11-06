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

/**
 * pickSample(templates, pages, { max }) -> [{ url, template, why }]
 * The start page, then one page per template (the one with most words), then a second page for
 * the biggest templates, then pages with three or more question headings, until `max`.
 */
export function pickSample(templates, pages, { max = 24 } = {}) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const out = [];
  const taken = new Set();
  const add = (url, template, why) => { if (out.length < max && url && !taken.has(url)) { taken.add(url); out.push({ url, template, why }); } };
  const ranked = (t) => t.urls.map((u) => byUrl.get(u)).filter(Boolean).sort((a, b) => (b.words || 0) - (a.words || 0) || pathOf(a.url).length - pathOf(b.url).length);
  const skip = (t) => t.type === 'legal';
  for (const t of templates) if (!skip(t)) add(ranked(t)[0]?.url, t.key, t.key === 'home' ? 'start page' : 'longest page in the template');
  for (const t of templates.filter((x) => !skip(x) && x.pages >= 5)) add(ranked(t)[1]?.url, t.key, 'second page of a large template');
  const qs = pages.filter(indexable).filter((p) => (p.sig?.questionHeadings || 0) >= 3).sort((a, b) => b.sig.questionHeadings - a.sig.questionHeadings);
  for (const p of qs) add(p.url, templateKey(p.url), `${p.sig.questionHeadings} question headings`);
  return out;
}

/** A file name for a page: its path, flattened. */
export function pageSlug(url) {
  const p = pathOf(url).replace(/^\/+|\/+$/g, '').toLowerCase();
  return (p.replace(/[^\w-]+/g, '-').replace(/-{2,}/g, '-').slice(0, 80) || 'home').replace(/-+$/, '');
}
