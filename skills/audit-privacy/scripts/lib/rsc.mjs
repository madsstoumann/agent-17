/**
 * Text a Next.js App Router page carries only in its React Server Components payload.
 *
 * A Next.js page streams its component tree as `self.__next_f.push([1, "…"])` script chunks. A
 * closed accordion, tab or dialog that mounts its content on open (Radix and most headless UI
 * kits do) has that content in the payload but not in the served HTML, and not in the DOM until a
 * visitor opens it. The text is the page's all the same: a visitor reads it after one click.
 *
 * rscBlocks(html) reads the payload back into text blocks; hiddenBlocks(html, visibleText) keeps
 * the blocks that the visible text does not already hold. Approximate on purpose: it reads the
 * tree's text children and a few text-like props, and ignores everything it cannot parse.
 *
 * Only the page's own components count. The payload also carries what every page has: the root
 * layout (header, mega menu, footer, promo teasers), the not-found and error boundaries, inline
 * script bodies. When the payload has its router tree (row 0, `f`), only the rows the page segment
 * (`__PAGE__`) reaches are read; nav elements, not-found / error props and code are skipped
 * everywhere.
 *
 * Zero dependencies. Node >= 22. Pure. Shared by audit-privacy and plan-geo (identical copies).
 */

const CHUNK = /self\.__next_f\.push\(\s*(\[[\s\S]*?\])\s*\)\s*;?\s*<\/script>/g;
const INLINE = new Set(['a', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'br', 'code', 'mark', 'abbr', 'time', 'q', 'cite', 'kbd', 'wbr', 'bdi', 'bdo', 'data', 'del', 'ins']);
const SKIP = new Set(['script', 'style', 'svg', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'iframe', 'img', 'picture', 'source', 'video', 'audio', 'path', 'nav', 'header', 'footer']);
/** Router props that hold the boundaries every page carries, not the page: not-found, error, loading. */
const BOUNDARY_PROPS = /^(notFound|notFoundStyles|error|errorStyles|errorScripts|forbidden|unauthorized|loading|loadingStyles|loadingScripts|globalError)$/;
/** Data keys for media: an image's alt text or a video's description is not text the page shows. */
const MEDIA_PROPS = /^(assets?|images?|media|video|featuredImage|thumbnail|poster|logo|icon)$/i;
const skipKey = (k) => BOUNDARY_PROPS.test(k) || MEDIA_PROPS.test(k);
const TEXT_PROPS = /^(title|text|label|heading|headline|question|answer|body|description|content|caption|summary|richtext|html|intro|teaser|subtitle)$/i;
const HEADING = /^h([1-6])$/;

const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
/** For comparing with the visible text: case and whitespace ignored (the payload joins inline runs without the spaces layout adds). */
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
const stripTags = (s) => squash(String(s).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<\/(p|div|li|h[1-6]|tr|td|th|dd|dt)\s*>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'"));
/** Words people read, not SVG path data, class lists, ids or URLs: mostly letters, no URL or class syntax. */
/** A script body: Plausible's or OneTrust's inline snippet, not words. */
const code = (t) => /[;{}()]/.test(t) && /\bfunction\b\s*[\w$]*\s*\(|=>|\b(?:window|document|self)\.[\w$]|\b(?:var|let|const)\s+[\w$]+\s*=|\|\|\s*(?:function|\[\]|\{\})/.test(t);
const prose = (t) => {
  if (!t || /^(https?:|\/|#|\$)/.test(t) || /^[\w-]+(?:\s+[\w:/[\]&>.-]+-[\w:/[\]&>.-]+)+$/.test(t) || code(t)) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  return letters >= 2 && letters / t.replace(/\s/g, '').length > 0.6;
};
const words = (s) => (s ? s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0);

/** The payload as one string: the text of every `[1, "…"]` chunk, in order. '' when the page has none. */
export function flightPayload(html) {
  let out = '';
  for (const m of String(html || '').matchAll(CHUNK)) {
    try { const a = JSON.parse(m[1]); if (a[0] === 1 && typeof a[1] === 'string') out += a[1]; } catch { /* not JSON: skip */ }
  }
  return out;
}

/** Payload rows: `<id>:<json>\n`, and `<id>:T<hex byte length>,<text>` for long strings. */
export function flightRows(payload) {
  const buf = Buffer.from(String(payload || ''), 'utf8');
  const rows = [];
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    const nl = buf.indexOf(0x0a, i);
    if (colon < 0) break;
    if (nl >= 0 && nl < colon) { i = nl + 1; continue; }
    const id = buf.toString('utf8', i, colon);
    if (!/^[0-9a-f]+$/i.test(id)) { i = nl < 0 ? buf.length : nl + 1; continue; }
    if (buf[colon + 1] === 0x54) { // T: a text row with its length in bytes
      const comma = buf.indexOf(0x2c, colon);
      const len = parseInt(buf.toString('utf8', colon + 2, comma), 16);
      if (comma < 0 || !Number.isFinite(len)) { i = nl < 0 ? buf.length : nl + 1; continue; }
      rows.push({ id, text: buf.toString('utf8', comma + 1, comma + 1 + len) });
      i = comma + 1 + len;
      continue;
    }
    const end = nl < 0 ? buf.length : nl;
    const raw = buf.toString('utf8', colon + 1, end);
    if (/^[[{]/.test(raw)) { try { rows.push({ id, json: JSON.parse(raw) }); } catch { /* partial or not JSON */ } }
    i = end + 1;
  }
  return rows;
}

/** A payload string: "$$x" is a literal "$x"; any other "$…" is a reference, not text. */
const literal = (s) => (s.startsWith('$$') ? s.slice(1) : s.startsWith('$') ? null : s);
const isElement = (n) => Array.isArray(n) && n[0] === '$' && typeof n[1] === 'string' && n.length >= 4;
/** The row a reference string points at: "$L5", "$@9", "$1f" → "5", "9", "1f". */
const refId = (s) => /^\$(?:L|@)?([0-9a-f]+)$/i.exec(s)?.[1] ?? null;

/**
 * The page segment's own content: the cache node of `__PAGE__` in the router tree row (`f`), the
 * leaf whose child segments are `{}`. Null when the payload has no tree this reads.
 */
export function pageNode(rows) {
  const tree = rows.find((r) => r.json && !Array.isArray(r.json) && Array.isArray(r.json.f))?.json;
  if (!tree) return null;
  let found = null;
  const isEmpty = (v) => v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length;
  const visit = (n, depth = 0) => {
    if (found || depth > 60 || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      // A cache node: [segment?, rsc, { children: node }, loading, partial]; the page's has {}.
      for (let i = 1; i < n.length; i++) if (isEmpty(n[i]) && isElement(n[i - 1])) { found = n[i - 1]; return; }
      for (const v of n) visit(v, depth + 1);
    } else for (const v of Object.values(n)) visit(v, depth + 1);
  };
  visit(tree.f);
  return found;
}

/**
 * Ids of the rows the `roots` reach through references, following the rows they reach in turn.
 * Nothing under a skipped element (nav, header, footer, script …) or a boundary prop counts: a
 * row only those point at is the site's chrome, not the page.
 */
function reachable(roots, byId) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (typeof n === 'string') { const id = refId(n); if (id && !seen.has(id) && byId.has(id)) { seen.add(id); stack.push(byId.get(id)); } continue; }
    if (Array.isArray(n)) { if (isElement(n) && SKIP.has(n[1].toLowerCase())) continue; for (const v of n) stack.push(v); continue; }
    if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) if (!skipKey(k)) stack.push(v);
  }
  return seen;
}

/** Ids of the rows some other row points at. */
function referenced(rows) {
  const out = new Set();
  const scan = (n) => {
    if (typeof n === 'string') { const id = refId(n); if (id) out.add(id); } else if (Array.isArray(n)) n.forEach(scan); else if (n && typeof n === 'object') Object.values(n).forEach(scan);
  };
  for (const r of rows) if (r.json) scan(r.json);
  return out;
}

/**
 * Text blocks from the payload, in order: [{ text, heading: 1–6 | 0 }]. A block is the inline text
 * under a block element (p, li, h2, a client component …), so a question and its answer come out
 * as two blocks. Long-string rows are read as HTML when they look like it.
 */
export function rscBlocks(html) {
  const payload = flightPayload(html);
  if (!payload) return [];
  const blocks = [];
  const push = (text, heading = 0) => { const t = squash(text); if (prose(t)) blocks.push({ text: t, heading }); };
  const pushHtml = (s) => { for (const line of stripTags(s).split('\n')) push(line); };

  const flush = (t, heading = 0) => { if (squash(t)) push(t, heading); };
  const textProp = (v) => { const s = literal(v); if (s) (/<[a-z][\s\S]*>/i.test(s) ? pushHtml(s) : push(s)); };
  // Children: returns their inline text and flushes block-level content into blocks as it goes.
  const walk = (node) => {
    if (typeof node === 'string') { const s = literal(node); return s == null ? '' : s; }
    if (Array.isArray(node)) return isElement(node) ? element(node) : node.map(walk).join('');
    if (node && typeof node === 'object') data(node);
    return '';
  };
  // Data that is not children (a client component's props, a row of JSON): only text-like keys
  // count as text; elements inside are walked as blocks.
  const data = (node) => {
    if (Array.isArray(node)) { if (isElement(node)) flush(element(node)); else for (const v of node) if (v && typeof v === 'object') data(v); return; }
    for (const [k, v] of Object.entries(node)) {
      if (skipKey(k)) continue;
      if (typeof v === 'string') { if (TEXT_PROPS.test(k)) textProp(v); }
      else if (k === 'children') flush(walk(v));
      else if (v && typeof v === 'object') data(v);
    }
  };
  const element = ([, type, , props]) => {
    const tag = type.toLowerCase();
    if (SKIP.has(tag) || !props || typeof props !== 'object') return '';
    if (typeof props.dangerouslySetInnerHTML?.__html === 'string') { pushHtml(props.dangerouslySetInnerHTML.__html); return ''; }
    // A client component ($L…) often gets its text as data props: { question, answer: "<p>…</p>" }.
    if (type.startsWith('$')) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'children' || skipKey(k)) continue;
        if (typeof v === 'string') { if (TEXT_PROPS.test(k)) textProp(v); } else if (v && typeof v === 'object') data(v);
      }
    }
    const inner = props.children === undefined ? '' : walk(props.children);
    // Fragments and inline tags pass their text up; everything else is a block of its own.
    // A client link component (next/link) is inline too.
    if (INLINE.has(tag) || /^\$\d/.test(type) || (type.startsWith('$') && typeof props.href === 'string')) return tag === 'br' ? ' ' : inner;
    const h = HEADING.exec(tag);
    flush(inner, h ? Number(h[1]) : 0);
    return '';
  };

  const rows = flightRows(payload);
  // The rows the page segment reaches when the router tree says which it is; otherwise the rows
  // that no other row points at and what they reach. Either way, not what only the site's chrome
  // (nav, header, footer) or the not-found and error boundaries point at.
  const byId = new Map(rows.map((r) => [r.id, r.json ?? r.text]));
  const page = pageNode(rows);
  const refs = page ? null : referenced(rows);
  const roots = page ? [page] : rows.filter((r) => !refs.has(r.id)).map((r) => '$' + r.id);
  const ids = reachable(roots, byId);
  if (page) data(page);
  for (const row of rows.filter((r) => ids.has(r.id))) {
    if (row.text != null) { if (/<[a-z][\s\S]*>/i.test(row.text)) pushHtml(row.text); else if (words(row.text) >= 3) push(row.text); continue; }
    data(row.json);
  }
  return blocks;
}

/** A short text block that ends in a question mark reads as a question (an accordion's toggle). */
export const isQuestion = (b) => b.heading > 0 ? /\?\s*$/.test(b.text) : /\?\s*$/.test(b.text) && words(b.text) <= 30;

/**
 * The payload's blocks that the visible text does not hold: what sits behind closed accordions,
 * tabs and dialogs. A question the page shows (the accordion's toggle) is kept, marked
 * `shown: true`, when hidden text follows it, so a question and its answer stay together.
 * Blocks are deduplicated; one-word labels are dropped.
 */
export function hiddenBlocks(html, visibleText) {
  const visible = norm(visibleText);
  const seen = new Set();
  const all = [];
  for (const b of rscBlocks(html)) {
    const key = norm(b.text);
    if (seen.has(key)) continue;
    seen.add(key);
    if (words(b.text) < 2 && !isQuestion(b)) continue;
    all.push({ ...b, shown: visible.includes(key) });
  }
  return all.filter((b, i) => !b.shown || (isQuestion(b) && all[i + 1] && !all[i + 1].shown && !isQuestion(all[i + 1])));
}

/** Blocks as Markdown: headings and questions as `###`, the rest as paragraphs. */
export function blocksMarkdown(blocks) {
  return blocks.map((b) => (b.heading ? `${'#'.repeat(b.heading)} ${b.text}` : isQuestion(b) ? `### ${b.text}` : b.text)).join('\n\n');
}

/** Words in the blocks the page does not show. */
export const blockWords = (blocks) => blocks.reduce((n, b) => n + (b.shown ? 0 : words(b.text)), 0);
