/**
 * Regex-based HTML tokenizer and extractors, deliberately approximate:
 * good enough to read a page's head, links and assets for an audit. DOM-accurate
 * work (Lighthouse, the W3C validator) happens later in the pipeline.
 *
 * Zero dependencies. Node >= 22. Pure functions; nothing here does I/O.
 */

// ---------------------------------------------------------------- entities

// The named references a head or a link text is likely to carry; anything else stays as written.
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', copy: '©', reg: '®', trade: '™',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±', times: '×',
  aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø', aelig: 'æ', AElig: 'Æ', eacute: 'é', Eacute: 'É', egrave: 'è',
  agrave: 'à', aacute: 'á', auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', szlig: 'ß', ccedil: 'ç', ntilde: 'ñ',
};

/**
 * Decodes named (a small table) and numeric (`&#NN;`, `&#xHH;`) character references.
 * Unknown references are left as written. Non-strings decode to ''.
 * @param {string} s
 * @returns {string}
 */
export function decodeEntities(s) {
  if (s == null) return '';
  return String(s).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.hasOwn(NAMED, ref) ? NAMED[ref] : m;
  });
}

/**
 * Tags removed, entities decoded, whitespace collapsed to single spaces, trimmed.
 * @param {string} html
 * @returns {string}
 */
export function stripTags(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- attributes and tokens

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/**
 * Parses the attribute part of a start tag. Keys lowercase; values entity-decoded;
 * a bare attribute (`disabled`, `crossorigin`) is ''. First occurrence of a key wins.
 * @param {string} attrString
 * @returns {Record<string, string>}
 */
export function parseAttrs(attrString) {
  const out = {};
  if (!attrString) return out;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(attrString))) {
    const key = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (!Object.hasOwn(out, key)) out[key] = decodeEntities(value);
  }
  return out;
}

const TAG_RE = /<!--[\s\S]*?-->|<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
const RAW_TEXT = new Set(['script', 'style', 'title']);

const LD_JSON = /^\s*application\/ld\+json\s*(;|$)/i;

/**
 * Start tags in document order. Comments are skipped, and so are the bodies of
 * `<script>` and `<style>` — except that a `<script type="application/ld+json">`
 * and a `<title>` carry their raw text in `content`. End tags are not reported.
 * @param {string} html
 * @returns {Array<{ tag: string, attrs: Record<string, string>, raw: string, index: number, content?: string }>}
 */
export function tokenize(html) {
  const src = String(html ?? '');
  const tokens = [];
  const re = new RegExp(TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === undefined) continue; // a comment
    const tag = m[1].toLowerCase();
    const token = { tag, attrs: parseAttrs(m[2]), raw: m[0], index: m.index };
    if (RAW_TEXT.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'ig');
      close.lastIndex = re.lastIndex;
      const c = close.exec(src);
      const end = c ? c.index : src.length;
      if (tag === 'title' || (tag === 'script' && LD_JSON.test(token.attrs.type || ''))) token.content = src.slice(re.lastIndex, end);
      re.lastIndex = c ? c.index + c[0].length : src.length;
    }
    tokens.push(token);
  }
  return tokens;
}

// ---------------------------------------------------------------- shared helpers

/** Resolve `href` against `base`; null when it is not an http(s) URL. */
function resolve(href, base) {
  const s = href == null ? '' : String(href).trim();
  if (!s) return null;
  try { const u = new URL(s, base); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; }
}

/** Effective base: `<base href>` when present and resolvable, else the page URL. */
function baseOf(tokens, baseUrl) {
  const b = tokens.find((t) => t.tag === 'base' && t.attrs.href);
  return (b && resolve(b.attrs.href, baseUrl)) || baseUrl;
}

function relTokens(attrs) {
  return String(attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Candidate URLs of a srcset, approximate: a URL containing a comma splits wrongly. */
function srcsetUrls(srcset) {
  return String(srcset || '').split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
}

/** Raw inner HTML from the end of a start token to its closing tag ('' when unclosed). */
function innerOf(html, token) {
  const from = token.index + token.raw.length;
  const close = new RegExp(`</${token.tag}\\s*>`, 'ig');
  close.lastIndex = from;
  const c = close.exec(html);
  return c ? html.slice(from, c.index) : '';
}

function collectTypes(node, out) {
  if (Array.isArray(node)) { for (const n of node) collectTypes(n, out); return; }
  if (!node || typeof node !== 'object') return;
  const t = node['@type'];
  for (const x of Array.isArray(t) ? t : (t == null ? [] : [t])) if (typeof x === 'string' && !out.includes(x)) out.push(x);
  for (const [k, v] of Object.entries(node)) if (k !== '@type' && v && typeof v === 'object') collectTypes(v, out);
}

// ---------------------------------------------------------------- extractors

/**
 * Head metadata of a page. Every href is absolute, resolved against `<base href>`
 * when present, else `baseUrl`; `og`/`twitter` values are the raw meta content. Missing
 * values are null, [] or {}; a present but empty content is ''. The title is the head's:
 * a `<title>` after `<body>` or inside an `<svg>` never counts.
 * `jsonLd[].types` is every `@type` found anywhere in the block (`@graph`, arrays and nested objects), unique.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {{
 *   title: string|null, description: string|null, robots: string|null, googlebot: string|null, canonical: string|null,
 *   lang: string|null, viewport: string|null, charset: string|null, base: string|null, themeColor: string|null,
 *   generator: string|null, h1Count: number, h1s: string[],
 *   hreflang: Array<{ lang: string, href: string }>,
 *   og: Record<string, string>, twitter: Record<string, string>,
 *   icons: Array<{ rel: string, href: string, sizes: string|null, type: string|null }>,
 *   manifest: string|null,
 *   jsonLd: Array<{ types: string[], raw: string, data: unknown, error: string|null }>
 * }}
 */
export function extractMeta(html, baseUrl) {
  const src = String(html ?? '');
  const tokens = tokenize(src);
  const baseTag = tokens.find((t) => t.tag === 'base' && t.attrs.href);
  const base = baseTag ? resolve(baseTag.attrs.href, baseUrl) : null;
  const root = base || baseUrl;
  const meta = {
    title: null, description: null, robots: null, googlebot: null, canonical: null, lang: null, viewport: null, charset: null,
    base, themeColor: null, generator: null, h1Count: 0, h1s: [], hreflang: [], og: {}, twitter: {}, icons: [], manifest: null, jsonLd: [],
  };
  const named = { description: 'description', robots: 'robots', googlebot: 'googlebot', viewport: 'viewport', 'theme-color': 'themeColor', generator: 'generator' };
  const setOnce = (obj, key, value) => { if (obj[key] == null) obj[key] = value; };
  let inHead = true;

  for (const t of tokens) {
    const a = t.attrs;
    switch (t.tag) {
      case 'html': if (a.lang) setOnce(meta, 'lang', a.lang.trim()); break;
      case 'body': case 'svg': inHead = false; break;
      case 'title': if (inHead) setOnce(meta, 'title', stripTags(t.content || '')); break;
      case 'meta': {
        if (a.charset) setOnce(meta, 'charset', a.charset.trim());
        if (/^content-type$/i.test(a['http-equiv'] || '')) {
          const cs = /charset=["']?([^\s;"']+)/i.exec(a.content || '');
          if (cs) setOnce(meta, 'charset', cs[1]);
        }
        const key = (a.name || a.property || '').trim().toLowerCase();
        if (!key || a.content == null) break;
        if (named[key]) setOnce(meta, named[key], a.content);
        else if (key.startsWith('og:')) setOnce(meta.og, key.slice(3), a.content);
        else if (key.startsWith('twitter:')) setOnce(meta.twitter, key.slice(8), a.content);
        break;
      }
      case 'link': {
        const rel = relTokens(a);
        const href = resolve(a.href, root);
        if (!href) break;
        if (rel.includes('canonical')) setOnce(meta, 'canonical', href);
        if (rel.includes('alternate') && a.hreflang) meta.hreflang.push({ lang: a.hreflang.trim(), href });
        if (rel.includes('manifest')) setOnce(meta, 'manifest', href);
        if (rel.some((r) => r === 'icon' || r.endsWith('-icon'))) {
          meta.icons.push({ rel: rel.join(' '), href, sizes: a.sizes || null, type: a.type || null });
        }
        break;
      }
      case 'h1':
        meta.h1Count++;
        if (meta.h1s.length < 3) meta.h1s.push(stripTags(innerOf(src, t)));
        break;
      case 'script': {
        if (t.content === undefined) break;
        const raw = t.content.trim();
        const block = { types: [], raw, data: null, error: null };
        try { block.data = JSON.parse(raw); collectTypes(block.data, block.types); } catch (e) { block.error = `JSON parse failed: ${e.message}`; }
        meta.jsonLd.push(block);
        break;
      }
      default: break;
    }
  }
  return meta;
}

/**
 * Every `<a href>` as an absolute http(s) URL with its fragment stripped, deduped by href
 * (first occurrence wins). mailto:, tel:, javascript:, data: and `#`-only links are dropped.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {Array<{ href: string, text: string, rel: string|null, nofollow: boolean }>}
 */
export function extractLinks(html, baseUrl) {
  const src = String(html ?? '');
  const tokens = tokenize(src);
  const root = baseOf(tokens, baseUrl);
  const seen = new Set();
  const links = [];
  for (const t of tokens) {
    if (t.tag !== 'a' || t.attrs.href == null) continue;
    const raw = t.attrs.href.trim();
    if (!raw || raw.startsWith('#')) continue;
    const abs = resolve(raw, root);
    if (!abs) continue;
    const u = new URL(abs); u.hash = '';
    const href = u.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    const rel = t.attrs.rel ? t.attrs.rel.trim() : null;
    links.push({ href, text: stripTags(innerOf(src, t)), rel, nofollow: relTokens(t.attrs).includes('nofollow') });
  }
  return links;
}

/**
 * Sub-resources the page loads, as absolute http(s) URLs, each list deduped in document order.
 * `all` carries every one of them once with the tag and attribute it came from.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {{
 *   scripts: string[], styles: string[], images: string[], iframes: string[], media: string[],
 *   preloads: Array<{ href: string, as: string|null }>,
 *   all: Array<{ url: string, tag: string, attr: string }>
 * }}
 */
export function extractAssets(html, baseUrl) {
  const tokens = tokenize(String(html ?? ''));
  const root = baseOf(tokens, baseUrl);
  const out = { scripts: [], styles: [], images: [], iframes: [], media: [], preloads: [], all: [] };
  const seenAll = new Set();
  const add = (list, tag, attr, value) => {
    const url = resolve(value, root);
    if (!url) return null;
    if (list && !list.includes(url)) list.push(url);
    if (!seenAll.has(url)) { seenAll.add(url); out.all.push({ url, tag, attr }); }
    return url;
  };
  for (const t of tokens) {
    const a = t.attrs;
    switch (t.tag) {
      case 'script': if (a.src) add(out.scripts, 'script', 'src', a.src); break;
      case 'link': {
        const rel = relTokens(a);
        if (rel.includes('stylesheet')) add(out.styles, 'link', 'href', a.href);
        if (rel.includes('preload')) {
          const href = add(null, 'link', 'href', a.href);
          if (href && !out.preloads.some((p) => p.href === href)) out.preloads.push({ href, as: a.as || null });
        }
        break;
      }
      case 'img':
        if (a.src) add(out.images, 'img', 'src', a.src);
        for (const c of srcsetUrls(a.srcset)) add(out.images, 'img', 'srcset', c);
        break;
      case 'source':
        for (const c of srcsetUrls(a.srcset)) add(out.images, 'source', 'srcset', c);
        if (a.src) add(out.media, 'source', 'src', a.src);
        break;
      case 'iframe': if (a.src) add(out.iframes, 'iframe', 'src', a.src); break;
      case 'video':
      case 'audio':
        if (a.src) add(out.media, t.tag, 'src', a.src);
        if (a.poster) add(out.media, t.tag, 'poster', a.poster);
        break;
      default: break;
    }
  }
  return out;
}

const MIXED_ATTRS = ['src', 'srcset', 'poster', 'data-src', 'action'];
const MIXED_LINK_RELS = ['stylesheet', 'preload', 'modulepreload', 'manifest', 'prefetch'];

/**
 * Resources an https page would load over plain http: `src`, `srcset`, `poster`, `data-src`,
 * `action` on any tag, and `href` on a `<link>` that loads something (stylesheet, icon, preload,
 * manifest) — never `<a href>`, never `rel="alternate"`, never an `xmlns`. Only an explicit
 * `http://` counts; a relative or protocol-relative URL inherits https. Empty unless `pageUrl` is https.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {Array<{ tag: string, attr: string, url: string }>}
 */
export function findMixedContent(html, pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return []; }
  if (page.protocol !== 'https:') return [];
  const tokens = tokenize(String(html ?? ''));
  const root = baseOf(tokens, pageUrl);
  const found = [];
  const seen = new Set();
  const check = (tag, attr, value) => {
    const url = resolve(value, root);
    if (!url || !url.startsWith('http:')) return;
    const key = `${tag}\u0000${attr}\u0000${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ tag, attr, url });
  };
  for (const t of tokens) {
    if (t.tag === 'a') continue;
    const a = t.attrs;
    for (const attr of MIXED_ATTRS) {
      if (a[attr] == null) continue;
      if (attr === 'srcset') for (const c of srcsetUrls(a.srcset)) check(t.tag, attr, c);
      else check(t.tag, attr, a[attr]);
    }
    if (t.tag === 'link' && a.href != null) {
      const rel = relTokens(a);
      if (rel.some((r) => MIXED_LINK_RELS.includes(r) || r === 'icon' || r.endsWith('-icon'))) check('link', 'href', a.href);
    }
  }
  return found;
}

const BARE_HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Host of one URL-ish token, or null. Accepts `https://*.x.com`, `*.x.com`, `x.com:443`, `//x.com/p`. */
function hostOfToken(token) {
  let s = token.replace(/^[(<"[]+|[)>"\].,;:]+$/g, '');
  if (!s || s.startsWith("'")) return null; // 'self', 'none', 'nonce-…', 'sha256-…'
  if (/^[a-z][a-z0-9+.-]*:$/i.test(s)) return null; // bare scheme: https: blob: data:
  const schemed = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('//');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '');
  s = s.split(/[/?#]/)[0];
  if (s.includes('@')) s = s.slice(s.lastIndexOf('@') + 1);
  let host;
  if (s.startsWith('[')) { const end = s.indexOf(']'); host = end > 0 ? s.slice(0, end + 1) : null; }
  else host = s.split(':')[0];
  if (!host) return null;
  host = host.toLowerCase();
  if (host.startsWith('[')) return schemed ? host : null;
  if (IPV4.test(host)) return host;
  if (BARE_HOST.test(host)) return host;
  if (schemed && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(host)) return host; // http://localhost:3000
  return null;
}

/**
 * Unique lowercase hostnames found in URL-ish strings — full URLs, protocol-relative URLs and
 * CSP source tokens (`https://*.example.com`, `*.example.com`, `example.com:443`). Quoted
 * keywords ('self', 'none', nonces, hashes), bare schemes (`https:`, `blob:`) and words with no
 * dot are ignored. Order is first-seen.
 * @param {Array<string|null|undefined>} strings
 * @returns {string[]}
 */
export function extractHosts(strings) {
  const hosts = [];
  for (const s of strings || []) {
    if (typeof s !== 'string' || !s) continue;
    for (const token of s.split(/[\s;,]+/)) {
      const host = token && hostOfToken(token);
      if (host && !hosts.includes(host)) hosts.push(host);
    }
  }
  return hosts;
}
