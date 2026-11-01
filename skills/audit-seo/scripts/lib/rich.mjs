/**
 * Google rich-result eligibility, checked locally. validator.schema.org checks schema.org itself;
 * Google asks for more before it shows a rich result (a product snippet, an event listing,
 * breadcrumbs in the result). Google has no public API for its Rich Results Test, so the
 * required and recommended properties from its structured-data docs
 * (https://developers.google.com/search/docs/appearance/structured-data/search-gallery) are
 * kept here, for the result types most sites use.
 *
 * Zero dependencies. Node >= 22. Pure.
 */

export const RICH_TEST = (url) => `https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}`;
export const DOCS = 'https://developers.google.com/search/docs/appearance/structured-data/search-gallery';

const has = (v) => {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.some(has);
  return true;
};
const first = (v) => (Array.isArray(v) ? v.find(has) : v);
const get = (node, dotted) => dotted.split('.').reduce((v, k) => { const x = first(v); return x && typeof x === 'object' ? x[k] : undefined; }, node);
// `gtin` stands for any GTIN length, as Google's docs allow.
const ALIASES = { gtin: ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14'] };
const any = (node, list) => list.flatMap((p) => ALIASES[p] || [p]).some((p) => has(get(node, p)));
const typesOf = (node) => { const t = node?.['@type']; return (Array.isArray(t) ? t : [t]).filter((x) => typeof x === 'string').map((x) => x.replace(/^(https?:\/\/)?schema\.org\//, '')); };
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * Each rule: required and recommended property paths. An entry `a|b|c` is met by any of them.
 * `extra(node)` returns more missing-required messages that a path list cannot say.
 * `note` is shown once per type (a result type Google limits or retired). `topOnly`: checked only
 * as a block's own entity or an @graph member.
 */
const ARTICLE = { recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'author.name'] };
const LOCAL = { required: ['name', 'address'], recommended: ['telephone', 'url', 'geo', 'openingHoursSpecification|openingHours', 'priceRange', 'image'] };
const RATING = (node) => (has(node.ratingValue) ? [] : ['ratingValue']).concat(any(node, ['ratingCount', 'reviewCount']) ? [] : ['ratingCount|reviewCount']);
const offerPrice = (o) => any(o, ['price', 'priceSpecification.price', 'lowPrice']);

export const RULES = {
  Article: ARTICLE, NewsArticle: ARTICLE, BlogPosting: ARTICLE,
  BreadcrumbList: {
    required: ['itemListElement'],
    extra: (node) => {
      const items = list(node.itemListElement);
      const out = [];
      items.forEach((it, i) => {
        if (!has(it?.position)) out.push(`itemListElement[${i}].position`);
        if (!has(it?.name) && !has(get(it, 'item.name'))) out.push(`itemListElement[${i}].name`);
        if (i < items.length - 1 && !has(it?.item)) out.push(`itemListElement[${i}].item`);
      });
      return out;
    },
  },
  Event: { required: ['name', 'startDate', 'location'], recommended: ['description', 'endDate', 'eventStatus', 'eventAttendanceMode', 'image', 'offers', 'organizer', 'performer'] },
  FAQPage: {
    required: ['mainEntity'],
    extra: (node) => list(node.mainEntity).flatMap((q, i) => [!has(q?.name) && `mainEntity[${i}].name`, !has(get(q, 'acceptedAnswer.text')) && `mainEntity[${i}].acceptedAnswer.text`].filter(Boolean)),
    note: 'Google shows FAQ rich results only for well-known government and health sites (since 2023).',
  },
  HowTo: { note: 'Google no longer shows HowTo rich results (since 2023); the markup does no harm.' },
  JobPosting: {
    required: ['title', 'description', 'datePosted', 'hiringOrganization'],
    recommended: ['validThrough', 'employmentType', 'baseSalary', 'identifier'],
    extra: (node) => (has(node.jobLocation) || (/telecommute/i.test(String(first(node.jobLocationType) || '')) && has(node.applicantLocationRequirements)) ? [] : ['jobLocation (or jobLocationType TELECOMMUTE + applicantLocationRequirements)']),
  },
  LocalBusiness: LOCAL, Restaurant: LOCAL, Store: LOCAL, Hotel: LOCAL, Dentist: LOCAL, MedicalClinic: LOCAL, AutoDealer: LOCAL, LodgingBusiness: LOCAL, FoodEstablishment: LOCAL, ProfessionalService: LOCAL,
  // Only as the page's own entity: an Organization nested as an author or publisher is not one.
  Organization: { recommended: ['name', 'url', 'logo'], topOnly: true },
  Product: {
    required: ['name', 'offers|review|aggregateRating'],
    recommended: ['image', 'description', 'brand', 'sku|gtin|mpn', 'offers.availability', 'offers.priceCurrency|offers.priceSpecification.priceCurrency'],
    extra: (node) => list(node.offers).flatMap((o, i) => {
      if (!o || typeof o !== 'object') return [];
      if (typesOf(o).includes('AggregateOffer')) return has(o.lowPrice) ? [] : [`offers${list(node.offers).length > 1 ? `[${i}]` : ''}.lowPrice`];
      return offerPrice(o) ? [] : [`offers${list(node.offers).length > 1 ? `[${i}]` : ''}.price`];
    }),
  },
  Recipe: { required: ['name', 'image'], recommended: ['author', 'datePublished', 'description', 'recipeIngredient', 'recipeInstructions', 'totalTime', 'recipeYield', 'nutrition.calories', 'aggregateRating'] },
  Review: { required: ['author', 'reviewRating.ratingValue'], recommended: ['datePublished'] },
  AggregateRating: { extra: RATING },
  SoftwareApplication: { required: ['name', 'offers.price|offers.priceSpecification.price', 'aggregateRating|review'], recommended: ['applicationCategory', 'operatingSystem'] },
  VideoObject: { required: ['name', 'thumbnailUrl', 'uploadDate'], recommended: ['description', 'contentUrl|embedUrl', 'duration'] },
  Course: { required: ['name', 'description'], recommended: ['provider'] },
};

function missing(node, paths = []) {
  return paths.filter((p) => !any(node, p.split('|')));
}

/**
 * Every object with an @type in a JSON-LD value (@graph, arrays and nested objects), as
 * [node, top]: `top` is a block's own entity or an @graph member, not a nested value.
 */
function* nodes(value, seen = new Set(), top = true) {
  if (Array.isArray(value)) { for (const v of value) yield* nodes(v, seen, top); return; }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (value['@type'] != null) yield [value, top];
  for (const [k, v] of Object.entries(value)) if (k !== '@type' && v && typeof v === 'object') yield* nodes(v, seen, k === '@graph');
}

/**
 * richIssues(blocks) -> [{ type, required: string[], recommended: string[], note: string|null }]
 * One entry per typed node a rule knows, nodes with nothing to say left out. `blocks` are the
 * parsed JSON-LD values (html.mjs's jsonLd[].data).
 */
export function richIssues(blocks) {
  const out = [];
  const noted = new Set();
  for (const block of blocks) {
    for (const [node, top] of nodes(block)) {
      // A bare reference ({ "@id", "@type" } and nothing else) is described elsewhere in the graph.
      if (Object.keys(node).every((k) => k.startsWith('@'))) continue;
      for (const type of typesOf(node)) {
        const rule = RULES[type];
        if (!rule || (rule.topOnly && !top)) continue;
        const required = [...missing(node, rule.required), ...(rule.extra ? rule.extra(node) : [])];
        const recommended = missing(node, rule.recommended);
        const note = rule.note && !noted.has(type) ? rule.note : null;
        if (note) noted.add(type);
        if (required.length || recommended.length || note) out.push({ type, required, recommended, note });
        break;
      }
    }
  }
  return out;
}

/** The rich-result types the blocks carry that a rule knows (for the "eligible" evidence). */
export function richTypes(blocks) {
  const out = new Set();
  for (const block of blocks) for (const [node, top] of nodes(block)) for (const t of typesOf(node)) if (RULES[t] && !RULES[t].note && (top || !RULES[t].topOnly)) out.add(t);
  return [...out];
}

/** richOf(jsonLd) -> { rich, richTypes } for a page record, from html.mjs's parsed jsonLd blocks. */
export function richOf(jsonLd = []) {
  const blocks = jsonLd.filter((j) => !j.error).map((j) => j.data);
  return { rich: richIssues(blocks), richTypes: richTypes(blocks) };
}

/** "sku|gtin" -> "sku or gtin", for the report. */
export const prop = (p) => p.split('|').join(' or ');
