/**
 * Pulls what the detector needs out of raw HTML: meta tags, the title, and every
 * URL the page loads (scripts, stylesheets, preloads, iframes). Regex-based on
 * purpose: no DOM dependency, and good enough for tags the server wrote.
 */

const ATTR = (name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
const attr = (tag, name) => { const m = tag.match(ATTR(name)); return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : null; };

export function decode(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function resolveUrl(href, base) {
  if (!href || /^(?:data|blob|javascript|mailto|tel|about):/i.test(href)) return null;
  try { return new URL(href, base).href; } catch { return null; }
}

/** { name(lowercase): [content, …] } for <meta name|property|http-equiv=… content=…>. */
export function metaTags(html) {
  const out = {};
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (attr(tag, 'name') || attr(tag, 'property') || attr(tag, 'http-equiv') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (name && content !== null) (out[name] ||= []).push(content);
  }
  return out;
}

export function title(html) {
  const m = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : null;
}

/**
 * URLs the page references for loading, absolute, in document order.
 * scripts and styles are kept apart because only those are worth fetching.
 */
export function pageUrls(html, base) {
  const scripts = []; const styles = []; const other = [];
  const push = (list, href) => { const u = resolveUrl(href, base); if (u && !list.includes(u)) list.push(u); };
  for (const m of String(html).matchAll(/<script\b[^>]*>/gi)) { const src = attr(m[0], 'src'); if (src) push(scripts, src); }
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]; const rel = (attr(tag, 'rel') || '').toLowerCase(); const href = attr(tag, 'href');
    if (!href) continue;
    const as = (attr(tag, 'as') || '').toLowerCase();
    if (/\bstylesheet\b/.test(rel) || (rel.includes('preload') && as === 'style')) push(styles, href);
    else if (rel.includes('modulepreload') || (rel.includes('preload') && as === 'script')) push(scripts, href);
    else if (/preload|prefetch|preconnect|dns-prefetch|manifest|icon/.test(rel)) push(other, href);
  }
  for (const m of String(html).matchAll(/<(?:iframe|img|source|video|embed)\b[^>]*>/gi)) {
    const src = attr(m[0], 'src') || attr(m[0], 'data-src');
    if (src) push(other, src);
  }
  return { scripts, styles, other };
}

/** Registrable-ish site of a host: the last two labels, or three for second-level ccTLDs (co.uk, com.au). */
export function siteOf(host) {
  const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  const n = /^(?:co|com|net|org|gov|ac|edu)$/.test(sld) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}

export const sameSite = (a, b) => { try { return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname); } catch { return false; } };

/**
 * A bot-protection interstitial instead of the real page (Cloudflare "Just a moment…",
 * Fastly "Client Challenge", Akamai "Access Denied", or a bare 403/429). Detection on
 * such a page only sees the protection layer, so the report says so instead of
 * presenting a near-empty stack as the site's.
 */
export function challengeReason(status, html, headers = []) {
  const t = (title(html) || '').toLowerCase();
  if (headers.some(([k, v]) => k === 'cf-mitigated' && /challenge/i.test(v))) return 'Cloudflare challenge';
  if (/^(just a moment|attention required|client challenge|access denied|request rejected|pardon our interruption|are you a robot)/.test(t)) return `challenge page ("${title(html)}")`;
  if (/\/_fs-ch-[\w-]+\/|\/cdn-cgi\/challenge-platform\/|captcha-delivery\.com|_Incapsula_Resource/.test(html)) return 'bot-protection challenge page';
  if (status === 403 || status === 429) return `HTTP ${status}, likely bot protection`;
  return null;
}

const NOT_A_PAGE = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|docx?|xlsx?|pptx?|mp4|webm|mp3|css|js|json|xml|txt|woff2?)$/i;

/**
 * Up to `n` same-site pages linked from the page, chosen to cover different parts of the
 * site: other hosts first (shop.example.com often runs another platform), then a different
 * first path segment each (/shop/, /blog/, /careers/). Query strings and fragments are dropped.
 */
export function pickLinks(html, base, n) {
  if (!n) return [];
  const start = new URL(base);
  const seen = new Set([start.origin + start.pathname]);
  const candidates = [];
  for (const m of String(html).matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href');
    const abs = resolveUrl(href, base);
    if (!abs) continue;
    const u = new URL(abs);
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.href, base) || NOT_A_PAGE.test(u.pathname)) continue;
    u.search = ''; u.hash = '';
    if (seen.has(u.origin + u.pathname)) continue;
    seen.add(u.origin + u.pathname);
    candidates.push(u);
  }
  const section = (u) => `${u.host}/${u.pathname.split('/').filter(Boolean)[0] || ''}`;
  const startSection = section(start);
  const picked = []; const sections = new Set([startSection]);
  // Other hosts, then new sections, then anything left.
  const passes = [(u) => u.host !== start.host, (u) => !sections.has(section(u)), () => true];
  for (const ok of passes) {
    for (const u of candidates) {
      if (picked.length >= n) break;
      if (picked.includes(u.href) || !ok(u)) continue;
      if (ok !== passes[2] && sections.has(section(u))) continue;
      picked.push(u.href); sections.add(section(u));
    }
  }
  return picked;
}

/** Text a reader would see, roughly: markup, scripts and styles removed. */
export function visibleText(html) {
  return String(html)
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Why the raw HTML is probably not enough and a browser render would show more, or null.
 * An empty app shell, a page with almost no text, or no CMS or framework recognised.
 */
export function thinReason({ status, challenge, html = '', scripts = 0 }, technologies = []) {
  if (challenge || status >= 400 || !html) return null;
  if (/<(div|main)\b[^>]*\bid=["'](?:root|app|__next|__nuxt|svelte)["'][^>]*>\s*<\/\1>|<app-root\b[^>]*>\s*<\/app-root>/i.test(html)) return 'the page is an empty app shell';
  if (scripts > 0 && visibleText(html).length < 200) return 'the HTML has almost no text';
  const core = ['cms', 'ecommerce', 'headless-cms', 'meta-framework', 'js-framework'];
  if (!technologies.some((t) => t.confidence === 'detected' && core.includes(t.category))) return 'nothing in the HTML shows the CMS or framework';
  return null;
}
