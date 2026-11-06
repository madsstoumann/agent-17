/**
 * What a page offers an answer engine, read from its served HTML: dates and authorship, how the
 * text is structured (question headings, lists, tables, paragraph length) and the hints that
 * suggest structured data it could carry (article pages, Q&A sections, breadcrumbs).
 *
 * Deliberately approximate, like html.mjs: regexes over the HTML, no DOM. Navigation, header,
 * footer and aside elements are dropped before the structure counts, so a menu is not a list.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { stripTags, tokenize } from './html.mjs';

const ARTICLE_TYPES = /^(Article|NewsArticle|BlogPosting|TechArticle|ScholarlyArticle|Report|LiveBlogPosting|AnalysisNewsArticle|OpinionNewsArticle|ReviewNewsArticle)$/;
const LONG_PARAGRAPH = 120;

const words = (s) => { const t = stripTags(s); return t ? t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0; };

/** Every object with an @type in a JSON-LD value, walked like rich.mjs does. */
function* ldNodes(value, seen = new Set()) {
  if (Array.isArray(value)) { for (const v of value) yield* ldNodes(v, seen); return; }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  yield value;
  for (const v of Object.values(value)) if (v && typeof v === 'object') yield* ldNodes(v, seen);
}
const ldTypes = (node) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).filter((t) => typeof t === 'string').map((t) => t.replace(/^(https?:\/\/)?schema\.org\//, ''));
const firstString = (v) => (Array.isArray(v) ? v.find((x) => typeof x === 'string') : typeof v === 'string' ? v : null);

/** A date string as YYYY-MM-DD, or null when it does not parse. */
export function isoDate(s) {
  if (!s) return null;
  const d = new Date(String(s).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** The body without scripts, styles, templates, SVG and the page chrome (nav, header, footer, aside). */
function contentHtml(html) {
  const body = String(html || '').replace(/^[\s\S]*?<body[^>]*>/i, '');
  return body
    .replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

/**
 * pageSignals(html, jsonLd) -> {
 *   headings, headingsAll, questionHeadings, lists, tables, paragraphs, longParagraphs,
 *   published, modified, dateSource, timeTags, author, articleLike, breadcrumbNav, bingVerify
 * }
 * `jsonLd` is html.mjs's parsed blocks (`{ types, data, error }`).
 */
export function pageSignals(html, jsonLd = []) {
  const src = String(html || '');
  const main = contentHtml(src);
  const tokens = tokenize(src);
  const metas = {};
  for (const t of tokens) {
    if (t.tag !== 'meta') continue;
    const key = (t.attrs.property || t.attrs.name || t.attrs.itemprop || '').trim().toLowerCase();
    if (key && t.attrs.content != null && metas[key] == null) metas[key] = t.attrs.content;
  }

  const heads = [...main.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map((m) => stripTags(m[2])).filter(Boolean);
  const questionHeadings = heads.filter((h) => /[?？]\s*$/.test(h)).length;
  const summaries = [...main.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi)].map((m) => stripTags(m[1])).filter((s) => /[?？]\s*$/.test(s)).length;
  const lists = [...main.matchAll(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].filter((m) => (m[2].match(/<li\b/gi) || []).length >= 2).length;
  const tables = (main.match(/<table\b/gi) || []).length;
  const paras = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map((m) => words(m[1])).filter((n) => n > 0);

  let published = null; let modified = null; let dateSource = null; let author = false; let articleLike = false;
  for (const block of jsonLd) {
    if (block.error || block.data == null) continue;
    for (const node of ldNodes(block.data)) {
      const types = ldTypes(node);
      if (types.some((t) => ARTICLE_TYPES.test(t))) articleLike = true;
      const p = isoDate(firstString(node.datePublished));
      const m = isoDate(firstString(node.dateModified));
      if (p && !published) { published = p; dateSource = 'JSON-LD'; }
      if (m && !modified) { modified = m; dateSource = 'JSON-LD'; }
      if (node.author != null && (typeof node.author === 'string' ? node.author.trim() : true)) author = true;
    }
  }
  const metaPub = isoDate(metas['article:published_time'] || metas.datepublished || metas['date']);
  const metaMod = isoDate(metas['article:modified_time'] || metas['og:updated_time'] || metas.datemodified || metas['last-modified']);
  if (!published && metaPub) { published = metaPub; dateSource = dateSource || 'meta'; }
  if (!modified && metaMod) { modified = metaMod; dateSource = dateSource || 'meta'; }
  if (metas['article:published_time'] || /^article$/i.test(metas['og:type'] || '')) articleLike = true;
  if (metas.author || metas['article:author'] || tokens.some((t) => t.tag === 'link' && /(^|\s)author(\s|$)/i.test(t.attrs.rel || '')) || /\brel=["']?author\b/i.test(main)) author = true;

  const timeTags = tokens.filter((t) => t.tag === 'time' && t.attrs.datetime && isoDate(t.attrs.datetime));
  if (/<article\b/i.test(main) && timeTags.length) articleLike = true;
  // On an article, a visible <time datetime> is its date when the markup gives none.
  if (articleLike && !published && !modified && timeTags.length) {
    published = isoDate(timeTags[0].attrs.datetime);
    dateSource = '<time>';
  }

  const bodyAll = src.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  return {
    headings: heads.length,
    headingsAll: (bodyAll.match(/<h[1-6]\b/gi) || []).length,
    questionHeadings: questionHeadings + summaries,
    lists,
    tables,
    paragraphs: paras.length,
    longParagraphs: paras.filter((n) => n > LONG_PARAGRAPH).length,
    published,
    modified,
    dateSource,
    timeTags: timeTags.length,
    author,
    articleLike,
    breadcrumbNav: /aria-label=["'][^"']*breadcrumb/i.test(src) || /\b(class|id)=["'][^"']*breadcrumb/i.test(src),
    bingVerify: Boolean(metas['msvalidate.01']),
  };
}

export { LONG_PARAGRAPH };
