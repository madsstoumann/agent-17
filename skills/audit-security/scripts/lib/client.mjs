/**
 * Site mode --deep: the `client` group. What a visitor's browser is handed, read from outside:
 *
 *   client.sri            third-party scripts and styles without Subresource Integrity
 *   client.source-maps    source maps the site serves publicly (and whether they hold the source)
 *   client.bundle-secrets secrets in the JavaScript the pages load
 *   client.libraries      front-end libraries with known vulnerabilities (version banners -> OSV)
 *   client.messages       message listeners in the site's own bundles with no origin check nearby
 *   client.api-docs       public API descriptions: OpenAPI/Swagger JSON, Swagger UI, GraphQL IDEs
 *
 * Passive, like the rest of site mode: GET requests for the pages, the files they reference and a
 * short list of well-known paths, each once, with a size cap. Nothing is sent to an API, no query
 * is run, nothing is guessed beyond the listed paths. The client-side attack classes are adapted
 * from cloudflare/security-audit-skill (MIT); see references/THIRD-PARTY-NOTICES.md.
 */
import { RULES, scanText } from './patterns.mjs';
import { queryOsv } from './deps.mjs';
import { notChecked } from './levels.mjs';
import { registrableDomain } from './hosts.mjs';

const UA = 'Mozilla/5.0 (compatible; audit-security site mode)';
const MAX_PAGES = 5;
const MAX_SCRIPTS = 30;
const MAX_MAPS = 10;
const MAX_BYTES = 5_000_000;

const row = (id, status, title, evidence, extra = {}) => ({ id, group: 'client', status, title, evidence, fix: '', ...extra });
const short = (u, n = 70) => { const s = String(u); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** Hosts that serve pinned, versioned library files: SRI is expected there. */
export const LIBRARY_CDNS = /(^|\.)(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|code\.jquery\.com|ajax\.googleapis\.com|stackpath\.bootstrapcdn\.com|maxcdn\.bootstrapcdn\.com|cdn\.datatables\.net|ajax\.aspnetcdn\.com|cdn\.rawgit\.com|esm\.sh|ga\.jspm\.io|cdn\.skypack\.dev)$/i;

/** Version banners of common front-end libraries -> the npm package OSV knows them by. */
export const LIBRARIES = [
  { pkg: 'jquery', re: [/\bjQuery (?:JavaScript Library )?v(\d+\.\d+\.\d+)/, /\/jquery[@/-](\d+\.\d+\.\d+)(?:\.slim)?(?:\.min)?\.js/i] },
  { pkg: 'jquery-ui', re: [/\bjQuery UI - v(\d+\.\d+\.\d+)/, /\/jqueryui\/(\d+\.\d+\.\d+)\//i, /\/jquery-ui[@/-](\d+\.\d+\.\d+)/i] },
  { pkg: 'bootstrap', re: [/\bBootstrap v(\d+\.\d+\.\d+)/, /\/bootstrap[@/](\d+\.\d+\.\d+)\//i] },
  { pkg: 'angular', re: [/\bAngularJS v(\d+\.\d+\.\d+)/, /\/angular(?:js|\.js)?\/(\d+\.\d+\.\d+)\/angular/i] },
  { pkg: 'lodash', re: [/\blodash(?:\.min\.js)? v?(\d+\.\d+\.\d+)\b/i, /\/lodash(?:\.js)?[@/](\d+\.\d+\.\d+)\//i] },
  { pkg: 'underscore', re: [/\bUnderscore\.js (\d+\.\d+\.\d+)/] },
  { pkg: 'moment', re: [/moment\.js\s*\n?\s*\/\/! version : (\d+\.\d+\.\d+)/, /\/moment(?:\.js)?[@/](\d+\.\d+\.\d+)\//i] },
  { pkg: 'handlebars', re: [/@license handlebars v(\d+\.\d+\.\d+)/i, /\/handlebars(?:\.js)?[@/](\d+\.\d+\.\d+)\//i] },
  { pkg: 'dompurify', re: [/@license DOMPurify (\d+\.\d+\.\d+)/, /\/dompurify[@/](\d+\.\d+\.\d+)\//i] },
  { pkg: 'vue', re: [/\bVue\.js v(\d+\.\d+\.\d+)/, /\/vue[@/](\d+\.\d+\.\d+)\//i] },
  { pkg: 'knockout', re: [/\bKnockout JavaScript library v(\d+\.\d+\.\d+)/] },
  { pkg: 'react-dom', re: [/@license React(?: v(\d+\.\d+\.\d+))?\s*\n?\s*\*?\s*react-dom\.production(?:\.min)?\.js/, /\/react-dom[@/](\d+\.\d+\.\d+)\//i] },
  { pkg: 'swiper', re: [/\bSwiper (\d+\.\d+\.\d+)\b/] },
  { pkg: 'select2', re: [/\bSelect2 (\d+\.\d+\.\d+)\b/] },
  { pkg: 'video.js', re: [/@license\s+Video\.js (\d+\.\d+\.\d+)/] },
];

/** <script src>, <link rel=stylesheet href>, inline scripts and same-site links of one HTML page. */
export function parsePage(html, base) {
  const scripts = [];
  const styles = [];
  const inline = [];
  const links = [];
  const abs = (u) => { try { return new URL(u.replace(/&amp;/g, '&'), base).href; } catch { return null; } };
  const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || []).slice(1).find((x) => x != null);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const tag = m[1];
    const src = attr(tag, 'src');
    const type = (attr(tag, 'type') || '').toLowerCase();
    if (type && !/javascript|module|^text\/babel$/.test(type)) continue;
    if (src) { const u = abs(src); if (u && /^https?:/.test(u)) scripts.push({ url: u, integrity: Boolean(attr(tag, 'integrity')) }); }
    else if (m[2].trim()) inline.push(m[2]);
  }
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = (attr(m[1], 'rel') || '').toLowerCase();
    const href = attr(m[1], 'href');
    if (!href) continue;
    const u = abs(href);
    if (!u || !/^https?:/.test(u)) continue;
    if (rel.split(/\s+/).includes('stylesheet')) styles.push({ url: u, integrity: Boolean(attr(m[1], 'integrity')) });
    else if (rel === 'modulepreload' || (rel === 'preload' && /\bas\s*=\s*["']?script/i.test(m[1]))) scripts.push({ url: u, integrity: Boolean(attr(m[1], 'integrity')), preload: true });
  }
  for (const m of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"'#]+)/gi)) { const u = abs(m[1]); if (u) links.push(u); }
  return { scripts, styles, inline, links };
}

const site = (host) => registrableDomain(host) || host;
export const sameSite = (a, b) => { try { return site(new URL(a).hostname) === site(new URL(b).hostname); } catch { return false; } };

/** Up to `n` same-site pages from the start page's links, one per first path segment. */
export function pickPages(start, links, n = MAX_PAGES - 1) {
  const seen = new Set(['']);
  const out = [];
  for (const l of links) {
    let u;
    try { u = new URL(l); } catch { continue; }
    if (!sameSite(u.href, start) || !/^https?:$/.test(u.protocol)) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)$/i.test(u.pathname)) continue;
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    if (seen.has(seg)) continue;
    seen.add(seg);
    u.hash = '';
    out.push(u.href);
    if (out.length >= n) break;
  }
  return out;
}

/** Library versions named in a script's URL or its first comment banners. */
export function detectLibraries(url, text = '') {
  const head = `${url}\n${String(text).slice(0, 3000)}`;
  const out = [];
  for (const lib of LIBRARIES) {
    for (const re of lib.re) {
      const m = head.match(re);
      if (m?.[1]) { out.push({ pkg: lib.pkg, version: m[1], url }); break; }
    }
  }
  return out;
}

/** Minified bundles are one long line; break them at statement and object boundaries for the line rules. */
export function bundleLines(text) {
  return String(text).replace(/([;{}])/g, '$1\n').replace(/,(?=\s*["'`]?[A-Za-z_$][\w$-]*["'`]?\s*:)/g, ',\n');
}

const PUBLIC_BY_DESIGN = new Set(['secrets.google-api-key']);
const WARN_ONLY = new Set(['secrets.generic', 'secrets.jwt', 'secrets.config-token', 'secrets.connection-string']);

/** Secret hits in one script: { id, severity, match, url }. Public-by-design keys come back as info. */
export function bundleSecrets(url, text) {
  const rules = RULES.filter((r) => r.secret);
  return scanText('bundle.js', bundleLines(text), rules).map((h) => ({ id: h.id, match: h.match, url, level: PUBLIC_BY_DESIGN.has(h.id) ? 'info' : WARN_ONLY.has(h.id) ? 'warn' : 'fail' }));
}

/** Message listeners whose next ~400 characters never mention origin. */
export function messageListeners(text) {
  const s = String(text);
  let total = 0;
  let unchecked = 0;
  for (const m of s.matchAll(/addEventListener\s*\(\s*["'`]message["'`]|\bonmessage\s*=/g)) {
    total++;
    const around = s.slice(m.index, m.index + 400);
    if (!/\borigin\b/.test(around)) unchecked++;
  }
  return { total, unchecked };
}

/** sourceMappingURL at the end of a script, or the SourceMap header. */
export function mapUrl(scriptUrl, text, headers = {}) {
  const h = headers.sourcemap || headers['x-sourcemap'];
  const tail = String(text).slice(-600);
  const m = tail.match(/[#@]\s*sourceMappingURL=([^\s'"*]+)/);
  const ref = h || m?.[1];
  if (!ref) return null;
  if (ref.startsWith('data:')) return { inline: true };
  try { return { url: new URL(ref, scriptUrl).href }; } catch { return null; }
}

export const API_PATHS = [
  { path: '/swagger.json', kind: 'json' },
  { path: '/swagger/v1/swagger.json', kind: 'json' },
  { path: '/openapi.json', kind: 'json' },
  { path: '/v3/api-docs', kind: 'json' },
  { path: '/api-docs', kind: 'json' },
  { path: '/swagger-ui.html', kind: 'ui' },
  { path: '/swagger/index.html', kind: 'ui' },
  { path: '/graphql', kind: 'ide' },
  { path: '/graphiql', kind: 'ide' },
];

/** What a well-known API path served: { found, what } — judged on the body, so an SPA's catch-all page is not a hit. */
export function apiDescription(kind, status, body = '') {
  if (status !== 200) return { found: false };
  const b = String(body).slice(0, 200000);
  if (kind === 'json') {
    try { const j = JSON.parse(b); if (j && (j.openapi || j.swagger) && (j.paths || j.components)) return { found: true, what: `${j.openapi ? `OpenAPI ${j.openapi}` : `Swagger ${j.swagger}`}, ${Object.keys(j.paths || {}).length} path(s)` }; } catch { /* not JSON */ }
    return { found: false };
  }
  if (kind === 'ui') return /swagger-ui|SwaggerUIBundle/i.test(b) ? { found: true, what: 'Swagger UI' } : { found: false };
  if (/graphiql|graphql-playground|GraphQLPlayground|apollo-sandbox|embeddable-sandbox|altair/i.test(b) && /<html|<!doctype/i.test(b)) return { found: true, what: 'GraphQL IDE (GraphiQL, Playground or Apollo Sandbox)' };
  return { found: false };
}

async function get(f, url, headers, { maxBytes = MAX_BYTES } = {}) {
  try {
    const res = await f(url, { redirect: 'follow', headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(20000) });
    const h = {};
    res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    const len = Number(h['content-length'] || 0);
    if (len > maxBytes) { try { await res.body?.cancel(); } catch { /* ignore */ } return { status: res.status, headers: h, text: '', tooBig: true, url: res.url || url }; }
    const text = await res.text();
    return { status: res.status, headers: h, text: text.length > maxBytes ? text.slice(0, maxBytes) : text, url: res.url || url };
  } catch (e) { return { status: 0, error: e.message, headers: {}, text: '', url }; }
}

/**
 * The client group. `deps.fetch` and `deps.queryOsv` let tests replace the network.
 * Returns rows in site mode's shape.
 */
export async function clientChecks(startUrl, { headers = {}, offline = false, log = () => {}, deps = {} } = {}) {
  const f = deps.fetch || globalThis.fetch;
  const osv = deps.queryOsv || queryOsv;
  const rows = [];
  const first = await get(f, startUrl, headers);
  if (first.status !== 200 || !/<html|<!doctype|<script/i.test(first.text)) {
    rows.push(row('client.pages', 'skip', 'Client-side code', `not checked: the start page answered ${first.status || first.error || 'nothing'}${first.status === 200 ? ' without HTML' : ''}`));
    return rows;
  }
  const base = first.url || startUrl;
  const pages = [{ url: base, ...parsePage(first.text, base) }];
  for (const u of pickPages(base, pages[0].links)) {
    const p = await get(f, u, headers);
    if (p.status === 200 && /<html|<!doctype/i.test(p.text)) pages.push({ url: p.url || u, ...parsePage(p.text, p.url || u) });
  }
  log(`client: ${pages.length} page(s)`);

  // ---- scripts and styles across the pages
  const scripts = new Map();
  const styles = new Map();
  for (const p of pages) {
    for (const s of p.scripts) if (!scripts.has(s.url)) scripts.set(s.url, { ...s, page: p.url });
    for (const s of p.styles) if (!styles.has(s.url)) styles.set(s.url, { ...s, page: p.url });
  }
  const third = [...scripts.values(), ...styles.values()].filter((s) => !sameSite(s.url, base));
  const cdnNoSri = third.filter((s) => !s.integrity && LIBRARY_CDNS.test(new URL(s.url).hostname));
  const otherNoSri = third.filter((s) => !s.integrity && !LIBRARY_CDNS.test(new URL(s.url).hostname));
  const origins = [...new Set(third.map((s) => new URL(s.url).host))];
  if (!third.length) rows.push(row('client.sri', 'pass', 'Third-party scripts and Subresource Integrity', `no third-party scripts or styles on ${pages.length} page(s)`));
  else if (cdnNoSri.length) rows.push(row('client.sri', 'warn', 'Third-party scripts and Subresource Integrity', `${cdnNoSri.length} file(s) from a library CDN without integrity: ${cdnNoSri.slice(0, 3).map((s) => short(s.url)).join(', ')}; ${origins.length} third-party origin(s) in all`, { fix: 'Add integrity="sha384-…" crossorigin="anonymous" to pinned CDN files, or serve them from your own origin. A compromised CDN file then fails to load instead of running on every page.' }));
  else rows.push(row('client.sri', 'info', 'Third-party scripts and Subresource Integrity', `${origins.length} third-party origin(s) can run code on the pages (${origins.slice(0, 6).join(', ')}${origins.length > 6 ? ', …' : ''})${otherNoSri.length ? `; ${otherNoSri.length} without integrity, normal for tag managers, analytics and widgets that change in place` : '; all pinned files have integrity'}`, { fix: otherNoSri.length ? 'Review the list: each origin is a supplier with full access to the page. Load what you can from your own origin; keep a CSP script-src allowlist.' : '' }));

  // ---- download the site's own scripts (and library CDN files, for versions)
  const own = [...scripts.values()].filter((s) => sameSite(s.url, base)).slice(0, MAX_SCRIPTS);
  const cdn = [...scripts.values()].filter((s) => !sameSite(s.url, base) && LIBRARY_CDNS.test(new URL(s.url).hostname)).slice(0, 15);
  const bodies = [];
  for (const s of [...own, ...cdn]) {
    const r = await get(f, s.url, headers);
    if (r.status === 200 && r.text) bodies.push({ url: s.url, own: sameSite(s.url, base), text: r.text, headers: r.headers });
  }
  const inlineAll = pages.flatMap((p) => p.inline.map((text) => ({ url: `${p.url} (inline)`, own: true, text, headers: {} })));
  log(`client: ${bodies.length} script(s) downloaded, ${inlineAll.length} inline`);

  // ---- source maps
  const maps = [];
  let inlineMaps = 0;
  for (const b of bodies.filter((x) => x.own)) {
    if (maps.length >= MAX_MAPS) break;
    const ref = mapUrl(b.url, b.text, b.headers);
    if (!ref) continue;
    if (ref.inline) { inlineMaps++; continue; }
    const r = await get(f, ref.url, headers, { maxBytes: 20_000_000 });
    if (r.status !== 200) continue;
    try {
      const j = JSON.parse(r.text);
      if (j && (j.mappings != null || j.sections) && (j.sources || j.sections)) maps.push({ url: ref.url, sources: (j.sources || []).length, content: Array.isArray(j.sourcesContent) && j.sourcesContent.some(Boolean) });
    } catch { /* not a map */ }
  }
  const withSource = maps.filter((m) => m.content);
  if (!own.length) rows.push(row('client.source-maps', 'info', 'Public source maps', 'the pages load no scripts from the site itself'));
  else if (maps.length || inlineMaps) rows.push(row('client.source-maps', withSource.length || inlineMaps ? 'warn' : 'info', 'Public source maps', `${maps.length} map(s) served${withSource.length ? `, ${withSource.length} with the original source (sourcesContent)` : ''}${inlineMaps ? `; ${inlineMaps} script(s) carry an inline map` : ''}: ${maps.slice(0, 3).map((m) => `${short(m.url)} (${m.sources} sources)`).join(', ')}`, { fix: 'Build hidden source maps and upload them to the error tracker only; do not deploy .map files (or block *.map at the CDN). The original source shows internal routes, comments and feature flags.' }));
  else rows.push(row('client.source-maps', 'pass', 'Public source maps', `none referenced by ${own.length} script(s) of the site`));

  // ---- secrets in bundles
  const secrets = [];
  for (const b of [...bodies.filter((x) => x.own), ...inlineAll]) secrets.push(...bundleSecrets(b.url, b.text));
  const worst = secrets.some((s) => s.level === 'fail') ? 'fail' : secrets.some((s) => s.level === 'warn') ? 'warn' : secrets.length ? 'info' : 'pass';
  rows.push(row('client.bundle-secrets', worst, 'Secrets in the JavaScript', secrets.length
    ? `${secrets.length} hit(s): ${secrets.slice(0, 4).map((s) => `${s.id.replace('secrets.', '')} ${s.match} in ${short(s.url, 50)}`).join('; ')}${worst === 'info' ? ' (browser keys are public by design; check their API and referrer restrictions)' : worst === 'warn' ? ' (pattern matches: check whether each is a search-only, publishable or browser key before calling it a leak)' : ''}`
    : `none in ${bodies.filter((x) => x.own).length} script(s) and ${inlineAll.length} inline block(s)`, worst === 'pass' ? {} : { fix: worst === 'info' ? 'Restrict browser API keys by HTTP referrer and API in the provider console.' : 'Everything in a bundle is public: rotate the key, then move the call behind a server route that holds it.', ...(worst === 'fail' ? { blocker: true } : {}) }));

  // ---- front-end libraries
  const libs = new Map();
  for (const b of [...bodies, ...inlineAll]) for (const l of detectLibraries(b.url, b.text)) libs.set(`${l.pkg}@${l.version}`, l);
  for (const s of scripts.values()) for (const l of detectLibraries(s.url, '')) if (!libs.has(`${l.pkg}@${l.version}`)) libs.set(`${l.pkg}@${l.version}`, l);
  if (!libs.size) rows.push(row('client.libraries', 'info', 'Known-vulnerable front-end libraries', 'no library version banners found (bundled libraries usually lose them; code mode reads the lockfile)'));
  else if (offline) rows.push(notChecked(row('client.libraries', 'info', 'Known-vulnerable front-end libraries', [...libs.keys()].join(', ')), '--offline: no OSV lookup'));
  else {
    try {
      const pkgs = [...libs.values()].map((l) => ({ ecosystem: 'npm', name: l.pkg, version: l.version, files: [l.url] }));
      const { vulnerable } = await osv(pkgs);
      const sevOf = (p) => p.vulns[0]?.severity || 'UNKNOWN';
      const bad = vulnerable.filter((p) => p.vulns.length);
      const status = bad.some((p) => ['CRITICAL', 'HIGH'].includes(sevOf(p))) ? 'fail' : bad.length ? 'warn' : 'pass';
      rows.push(row('client.libraries', status, 'Known-vulnerable front-end libraries', bad.length
        ? bad.slice(0, 5).map((p) => `${p.name} ${p.version}: ${p.vulns[0].id} ${sevOf(p).toLowerCase()}${p.vulns.length > 1 ? ` +${p.vulns.length - 1}` : ''}${p.vulns[0].fixed?.length ? `, fixed in ${p.vulns[0].fixed.join('/')}` : ''}`).join('; ')
        : `${[...libs.keys()].join(', ')}: no known advisories`, status === 'pass' ? {} : { fix: 'Upgrade to a fixed version; for jQuery 1.x/2.x and AngularJS 1.x (end of life) plan the replacement.', link: `https://osv.dev/vulnerability/${bad[0].vulns[0].id}` }));
    } catch (e) { rows.push(notChecked(row('client.libraries', 'info', 'Known-vulnerable front-end libraries', [...libs.keys()].join(', ')), `OSV lookup failed: ${e.message}`)); }
  }

  // ---- message listeners
  let total = 0;
  let unchecked = 0;
  for (const b of [...bodies.filter((x) => x.own), ...inlineAll]) { const m = messageListeners(b.text); total += m.total; unchecked += m.unchecked; }
  rows.push(row('client.messages', 'info', 'Cross-window message listeners', total
    ? `${total} listener(s) in the site's own scripts, ${unchecked} with no origin check within reach${unchecked ? ': read them in code mode (rule xss.message-no-origin)' : ''}`
    : 'none in the site\'s own scripts', unchecked ? { fix: 'Each handler should return early unless event.origin is an expected origin.' } : {}));

  // ---- API descriptions
  const origin = new URL(base).origin;
  const found = [];
  for (const a of API_PATHS) {
    const r = await get(f, `${origin}${a.path}`, { accept: a.kind === 'json' ? 'application/json' : 'text/html', ...headers }, { maxBytes: 2_000_000 });
    const d = apiDescription(a.kind, r.status, r.text);
    if (d.found) found.push(`${a.path} (${d.what})`);
  }
  rows.push(found.length
    ? row('client.api-docs', 'warn', 'Public API description', found.join('; '), { fix: 'If the API is not public by design, serve the description and IDE only in development or behind sign-in; turn off GraphQL introspection in production. Every listed operation still needs its own authorisation.' })
    : row('client.api-docs', 'pass', 'Public API description', `none at ${API_PATHS.length} well-known path(s)`));
  return rows;
}
