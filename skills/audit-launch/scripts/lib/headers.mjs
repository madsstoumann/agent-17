/**
 * Pure analysis of response headers: CSP parse and lint, the securityheaders.com
 * grade, cookies, information leaks, asset caching, HSTS, CORS and the cross-origin
 * policies. Nothing here touches the network or the console.
 *
 * "headers" is always the lowercase map createHttp() returns (repeated headers joined
 * by ", "); Set-Cookie values arrive apart, as strings.
 *
 * Zero dependencies. Node >= 22.
 */

/** Grade rows keyed by how many of the six headers are present: { clean, warned }. */
export const GRADE_TABLE = Object.freeze({
  6: Object.freeze({ clean: 'A+', warned: 'A' }),
  5: Object.freeze({ clean: 'B', warned: 'B' }),
  4: Object.freeze({ clean: 'C', warned: 'C' }),
  3: Object.freeze({ clean: 'D', warned: 'D' }),
  2: Object.freeze({ clean: 'E', warned: 'E' }),
  1: Object.freeze({ clean: 'F', warned: 'F' }),
  0: Object.freeze({ clean: 'F', warned: 'F' }),
});

export const GRADE_NOTE = 'estimated locally with securityheaders.com\'s rules; confirm on securityheaders.com';

// The six headers securityheaders.com grades, in its order.
const SECURITY_HEADERS = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];
// The CSP lint warnings that cost the A+; the rest are notes.
const GRADE_WARN_CODES = new Set(['unsafe-inline-script', 'unsafe-eval', 'wildcard-script-src']);
const HSTS_MIN_AGE = 15552000; // 180 days
const WEEK = 604800;

const WILDCARD_SOURCES = new Set(['*', 'https:', 'http:', 'data:']);
// Hosts Google's CSP Evaluator flags: they serve JSONP endpoints or Angular, which run code inside the policy.
const BYPASS_HOSTS = ['ajax.googleapis.com', 'www.google.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];
const REFERRER_POLICIES = new Set(['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url']);
const SENSITIVE_COOKIE = /sess|auth|token|csrf|xsrf|login|\.aspnetcore\.|umb_|jwt/i;
const CDN_COOKIE = /^(__cf_bm|__cfduid)$|^(AWSALB|ARRAffinity|incap_ses|visid_incap)/i;
const LEAK_HEADERS = ['x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator', 'x-umbraco-version'];
const HASHED_PATH = /[.\-_][a-f0-9]{8,}\.(m?js|css|woff2?|png|jpe?g|webp|avif|svg)(\?|$)/i;
const TEXT_TYPE = /^text\/|javascript|ecmascript|json|xml|svg/;

/** Trimmed header value, '' when absent. */
const value = (headers, name) => String(headers?.[name] ?? '').trim();

// ---------------------------------------------------------------- CSP

/**
 * parseCsp(value) -> Array<Record<directive, string[]>>: one object per policy (several
 * policies arrive joined by ", "), directive names lowercased, source tokens verbatim.
 * A directive repeated within a policy keeps its first occurrence, as browsers do.
 */
export function parseCsp(value) {
  if (value == null) return [];
  const policies = [];
  for (const policyText of String(value).split(',')) {
    const policy = {};
    let any = false;
    for (const directive of policyText.split(';')) {
      const tokens = directive.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const name = tokens[0].toLowerCase();
      if (Object.hasOwn(policy, name)) continue;
      policy[name] = tokens.slice(1);
      any = true;
    }
    if (any) policies.push(policy);
  }
  return policies;
}

const isNonceOrHash = (t) => /^'(nonce-|sha(256|384|512)-)/i.test(t);

/** The bypass host a source token allows, or null (keywords, schemes, other hosts, a path-pinned source). */
function bypassHost(token) {
  const t = token.toLowerCase();
  if (t.startsWith("'") || /^[a-z][a-z0-9+.-]*:$/.test(t)) return null;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/:]+)(?::[0-9*]+)?(\/.*)?$/.exec(t);
  if (!m) return null;
  const [, host, path] = m;
  if (path && path !== '/') return null;
  if (host.startsWith('*.')) return BYPASS_HOSTS.some((h) => h.endsWith(host.slice(1))) ? host : null;
  return BYPASS_HOSTS.includes(host) ? host : null;
}

/** Findings for one effective script source list (script-src, else default-src). */
function lintScriptSources(tokens) {
  const out = [];
  const low = tokens.map((t) => t.toLowerCase());
  const nonced = low.some(isNonceOrHash);
  const strictDynamic = nonced && low.includes("'strict-dynamic'");
  if (low.includes("'unsafe-inline'")) {
    out.push(nonced
      ? { severity: 'info', code: 'unsafe-inline-script', text: "'unsafe-inline' in the script list is ignored because a nonce/hash is present; it only serves browsers without CSP 2." }
      : { severity: 'warn', code: 'unsafe-inline-script', text: "'unsafe-inline' in the script list lets any injected inline script run; move inline scripts to files or mark them with a nonce or hash." });
  }
  if (low.includes("'unsafe-eval'")) {
    out.push({ severity: 'warn', code: 'unsafe-eval', text: "'unsafe-eval' lets eval() and new Function() run injected strings; remove it and fix the library that needs it." });
  }
  const wild = tokens.filter((t) => WILDCARD_SOURCES.has(t.toLowerCase()));
  if (wild.length) {
    out.push(strictDynamic
      ? { severity: 'info', code: 'wildcard-script-src', text: `${wild.join(' ')} in the script list is ignored because 'strict-dynamic' is present; it only serves browsers without CSP 3.` }
      : { severity: 'warn', code: 'wildcard-script-src', text: `${wild.join(' ')} in the script list allows scripts from anywhere; name the hosts you load from, or use a nonce with 'strict-dynamic'.` });
  }
  const bypass = tokens.map(bypassHost).filter(Boolean);
  if (bypass.length) {
    out.push(strictDynamic
      ? { severity: 'info', code: 'known-bypass-host', text: `${bypass.join(', ')} in the script list is ignored because 'strict-dynamic' is present; drop it once no CSP 2 browser matters.` }
      : { severity: 'warn', code: 'known-bypass-host', text: `${bypass.join(', ')} hosts JSONP endpoints or Angular that let an attacker run code inside this policy (Google's CSP Evaluator flags it); pin the source to the exact path you need, or switch to a nonce with 'strict-dynamic'.` });
  }
  return out;
}

/**
 * lintCsp(policies, { reportOnly = false } = {}) -> [{ severity: 'warn'|'info', code, text }].
 * `policies` is parseCsp()'s output (a raw header string is accepted too). With several
 * policies a weakness in any script list is reported; a directive counts as present when
 * any policy carries it. Pass reportOnly when the policies came from
 * content-security-policy-report-only and nothing is enforced.
 */
export function lintCsp(policies, { reportOnly = false } = {}) {
  const list = typeof policies === 'string' ? parseCsp(policies) : (policies || []);
  if (!list.length) {
    return [{ severity: 'warn', code: 'no-csp', text: 'No Content-Security-Policy: add one that at least restricts where scripts may load from and who may frame the page.' }];
  }
  const out = [];
  const push = (severity, code, text) => out.push({ severity, code, text });
  const has = (name) => list.some((p) => Object.hasOwn(p, name));
  const scriptLists = list.map((p) => p['script-src'] ?? p['default-src'] ?? null).filter(Boolean);

  if (reportOnly) push('warn', 'report-only-only', 'The only policy is Content-Security-Policy-Report-Only, which reports violations but blocks nothing; move it to Content-Security-Policy once the reports are clean.');
  if (!scriptLists.length) push('warn', 'no-script-restriction', 'CSP present but does not restrict scripts: add a script-src (or default-src) so an injected script cannot run.');
  const seen = new Set();
  for (const tokens of scriptLists) {
    for (const f of lintScriptSources(tokens)) {
      if (!seen.has(f.code)) { seen.add(f.code); out.push(f); }
    }
  }
  const defaultNone = list.some((p) => p['default-src']?.length === 1 && p['default-src'][0].toLowerCase() === "'none'");
  if (!has('object-src') && !defaultNone) push('info', 'missing-object-src', "No object-src: add object-src 'none' so a plugin loaded through <object> or <embed> cannot run script.");
  if (!has('base-uri')) push('info', 'missing-base-uri', "No base-uri: add base-uri 'self' (or 'none') so an injected <base> tag cannot redirect relative script URLs to another host.");
  if (!has('frame-ancestors')) push('warn', 'missing-frame-ancestors', "No frame-ancestors: add frame-ancestors 'self' (or 'none') so the page cannot be framed for clickjacking; it replaces X-Frame-Options.");
  if (has('upgrade-insecure-requests')) push('info', 'upgrade-insecure-requests', 'upgrade-insecure-requests is set: http:// subresources are fetched over https, so mixed content cannot break the page.');
  const reportTo = has('report-to'); const reportUri = has('report-uri');
  if (reportTo && reportUri) push('info', 'reporting', 'Violations are reported through report-to; report-uri is also set, which is deprecated but still serves older browsers.');
  else if (reportTo) push('info', 'reporting', 'Violations are reported through report-to; make sure the Reporting-Endpoints header names that group.');
  else if (reportUri) push('info', 'reporting', 'Violations are reported through report-uri, which is deprecated; add a report-to directive with a Reporting-Endpoints header.');
  return out;
}

// ---------------------------------------------------------------- grade

/** The referrer policy browsers apply from a comma-separated list: the last recognised token. */
function effectiveReferrerPolicy(v) {
  const known = v.split(',').map((t) => t.trim().toLowerCase()).filter((t) => REFERRER_POLICIES.has(t));
  return known.length ? known[known.length - 1] : null;
}

/**
 * gradeSecurityHeaders(headers) -> { grade, present: string[], missing: string[], warnings: string[], notes: string[], xfoViaCsp: boolean }.
 * securityheaders.com's rules: six headers (GRADE_TABLE), an empty value is absent,
 * x-content-type-options must be nosniff, a CSP frame-ancestors directive stands in for
 * x-frame-options (xfoViaCsp), report-only does not count. `warnings` are what cost the
 * plus: 'unsafe-inline'/'unsafe-eval'/wildcards in the script list, a short HSTS, and
 * referrer-policy unsafe-url. Everything else worth knowing is a note.
 */
export function gradeSecurityHeaders(headers) {
  const present = []; const missing = []; const warnings = []; const notes = [];
  const csp = value(headers, 'content-security-policy');
  const policies = parseCsp(csp);
  const xfoViaCsp = !value(headers, 'x-frame-options') && policies.some((p) => Object.hasOwn(p, 'frame-ancestors'));

  for (const name of SECURITY_HEADERS) {
    const v = value(headers, name);
    let ok = Boolean(v);
    if (name === 'x-content-type-options' && v && v.toLowerCase() !== 'nosniff') {
      ok = false;
      notes.push(`x-content-type-options is "${v}"; only "nosniff" counts.`);
    }
    if (name === 'x-frame-options' && !v && xfoViaCsp) {
      ok = true;
      notes.push('x-frame-options: satisfied by the CSP frame-ancestors directive.');
    }
    (ok ? present : missing).push(name);
  }
  if (!csp && value(headers, 'content-security-policy-report-only')) {
    notes.push('content-security-policy-report-only is set, but only an enforced Content-Security-Policy counts.');
  }
  if (csp) {
    for (const f of lintCsp(policies)) {
      if (f.severity !== 'warn') continue;
      (GRADE_WARN_CODES.has(f.code) ? warnings : notes).push(`content-security-policy: ${f.text}`);
    }
  }
  const hstsValue = value(headers, 'strict-transport-security');
  if (hstsValue) {
    const hsts = parseHsts(hstsValue);
    if (hsts.maxAge == null) warnings.push(`strict-transport-security has no valid max-age ("${hstsValue}"); set max-age=31536000 or more.`);
    else if (hsts.maxAge < HSTS_MIN_AGE) warnings.push(`strict-transport-security max-age is ${hsts.maxAge}, under ${HSTS_MIN_AGE} (180 days); raise it to 31536000 or more.`);
  }
  if (effectiveReferrerPolicy(value(headers, 'referrer-policy')) === 'unsafe-url') {
    warnings.push('referrer-policy: unsafe-url sends the full URL, query included, to every third party; use strict-origin-when-cross-origin.');
  }
  const row = GRADE_TABLE[present.length];
  return { grade: warnings.length ? row.warned : row.clean, present, missing, warnings, notes, xfoViaCsp };
}

// ---------------------------------------------------------------- cookies

/**
 * parseSetCookie(str) -> { name, value, secure, httpOnly, sameSite: 'strict'|'lax'|'none'|null,
 * domain, path, expires, maxAge, session: boolean, raw }. domain is lowercased without its
 * leading dot; expires is the string as sent; maxAge a number; each null when absent.
 * session is true when neither Expires nor Max-Age is set.
 */
export function parseSetCookie(str) {
  const raw = String(str ?? '');
  const [pair, ...attrs] = raw.split(';');
  const eq = pair.indexOf('=');
  const c = {
    name: eq < 0 ? '' : pair.slice(0, eq).trim(),
    value: (eq < 0 ? pair : pair.slice(eq + 1)).trim(),
    secure: false, httpOnly: false, sameSite: null, domain: null, path: null, expires: null, maxAge: null, session: true, raw,
  };
  for (const attr of attrs) {
    const i = attr.indexOf('=');
    const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? '' : attr.slice(i + 1).trim();
    if (key === 'secure') c.secure = true;
    else if (key === 'httponly') c.httpOnly = true;
    else if (key === 'samesite') c.sameSite = ['strict', 'lax', 'none'].includes(val.toLowerCase()) ? val.toLowerCase() : null;
    else if (key === 'domain') c.domain = val.replace(/^\./, '').toLowerCase() || null;
    else if (key === 'path') c.path = val || null;
    else if (key === 'expires') c.expires = val || null;
    else if (key === 'max-age') c.maxAge = /^-?\d+$/.test(val) ? Number(val) : null;
  }
  c.session = c.maxAge == null && c.expires == null;
  return c;
}

/**
 * lintCookies(cookies, { https = true, host }) -> [{ name, severity: 'fail'|'warn'|'info', code, text }].
 * `cookies` are parseSetCookie() objects (raw strings are parsed). A CDN or load-balancer
 * cookie, or one whose Domain is neither `host` nor a parent of it, gets a single
 * cdn-cookie note and no other findings: it is not the site's to fix.
 */
export function lintCookies(cookies, { https = true, host = '' } = {}) {
  const out = [];
  const h = String(host || '').toLowerCase();
  for (const item of cookies || []) {
    const c = typeof item === 'string' ? parseSetCookie(item) : item;
    const push = (severity, code, text) => out.push({ name: c.name, severity, code, text });
    const foreign = Boolean(c.domain && h) && !(h === c.domain || h.endsWith(`.${c.domain}`));
    if (CDN_COOKIE.test(c.name) || foreign) {
      push('info', 'cdn-cookie', foreign
        ? `Domain=${c.domain} is neither ${h} nor a parent of it; this cookie belongs to another service, not the site.`
        : `${c.name} is set by the CDN or load balancer, not the site; nothing to fix here.`);
      continue;
    }
    if (c.sameSite === 'none' && !c.secure) push('fail', 'samesite-none-insecure', 'SameSite=None without Secure is rejected by browsers, so the cookie is never stored; add Secure.');
    if (https && !c.secure) push('warn', 'no-secure', 'No Secure attribute: the cookie would also be sent over plain http; add Secure.');
    if (!c.httpOnly) {
      push(SENSITIVE_COOKIE.test(c.name) ? 'warn' : 'info', 'no-httponly', SENSITIVE_COOKIE.test(c.name)
        ? 'A session-like cookie without HttpOnly can be read by any injected script; add HttpOnly.'
        : 'No HttpOnly: script can read this cookie; add HttpOnly unless JavaScript needs it.');
    }
    if (c.sameSite === null) push('info', 'no-samesite', 'No SameSite attribute: browsers default to Lax; say so explicitly (SameSite=Lax) so the intent is clear.');
  }
  return out;
}

// ---------------------------------------------------------------- information leaks

/**
 * infoLeakHeaders(headers) -> [{ header, value, text }]: a server header carrying a version
 * number, and x-powered-by, x-aspnet-version, x-aspnetmvc-version, x-generator,
 * x-umbraco-version when non-empty. A bare product name (server: cloudflare) is not a leak.
 */
export function infoLeakHeaders(headers) {
  const out = [];
  const server = value(headers, 'server');
  if (server && /\d+\.\d+|\/\d/.test(server)) {
    out.push({ header: 'server', value: server, text: `server reveals a version ("${server}"), which tells an attacker which exploits to try; send only the product name, or nothing.` });
  }
  for (const name of LEAK_HEADERS) {
    const v = value(headers, name);
    if (v) out.push({ header: name, value: v, text: `${name} reveals the stack ("${v}"); remove the header, nothing on the site needs it.` });
  }
  return out;
}

// ---------------------------------------------------------------- caching

/**
 * parseCacheControl(value) -> { directives: Record<string, string|true>, maxAge, sMaxAge,
 * staleWhileRevalidate (numbers or null), noStore, noCache, private, public, immutable (booleans) }.
 */
export function parseCacheControl(value) {
  const directives = {};
  for (const part of String(value ?? '').split(',')) {
    const i = part.indexOf('=');
    const key = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
    if (!key) continue;
    directives[key] = i < 0 ? true : part.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  const num = (k) => (typeof directives[k] === 'string' && /^\d+$/.test(directives[k]) ? Number(directives[k]) : null);
  return {
    directives,
    maxAge: num('max-age'),
    sMaxAge: num('s-maxage'),
    noStore: 'no-store' in directives,
    noCache: 'no-cache' in directives,
    private: 'private' in directives,
    public: 'public' in directives,
    immutable: 'immutable' in directives,
    staleWhileRevalidate: num('stale-while-revalidate'),
  };
}

/**
 * lintAssetCaching({ url, headers }) -> { ok, maxAge, immutable, hashed, compressed, contentType, issues: string[] }.
 * ok when cacheable for a week or more (max-age or s-maxage >= 604800) or immutable, and
 * neither no-store nor no-cache. maxAge is max-age, else s-maxage, else null. hashed:
 * a content hash in the file name or a ?v=/?h= query. compressed: content-encoding
 * gzip/br/zstd. A text-like type served uncompressed is an issue; an image is not.
 */
export function lintAssetCaching({ url = '', headers = {} } = {}) {
  const ccValue = value(headers, 'cache-control');
  const cc = parseCacheControl(ccValue);
  const maxAge = cc.maxAge ?? cc.sMaxAge;
  const longest = Math.max(cc.maxAge ?? -1, cc.sMaxAge ?? -1);
  const ok = !cc.noStore && !cc.noCache && (cc.immutable || longest >= WEEK);
  let hashed;
  try {
    const u = new URL(url, 'https://placeholder.invalid/');
    hashed = HASHED_PATH.test(u.pathname) || u.searchParams.has('v') || u.searchParams.has('h');
  } catch {
    hashed = HASHED_PATH.test(String(url));
  }
  const compressed = /\b(gzip|br|zstd)\b/i.test(value(headers, 'content-encoding'));
  const contentType = value(headers, 'content-type').split(';')[0].trim().toLowerCase();
  const issues = [];
  if (!ccValue) issues.push('no cache-control header: browsers guess a lifetime; send public, max-age=31536000, immutable on hashed assets, max-age=604800 on the rest.');
  else if (cc.noStore || cc.noCache) issues.push(`cache-control "${ccValue}" makes every load go back to the server; a static asset should be cacheable.`);
  else if (!ok) issues.push(`max-age ${maxAge ?? 'missing'} is under a week (${WEEK}) and not immutable; a hashed asset can carry max-age=31536000, immutable.`);
  if (TEXT_TYPE.test(contentType) && !compressed) issues.push(`${contentType} is served uncompressed; enable brotli or gzip for text-like assets.`);
  return { ok, maxAge, immutable: cc.immutable, hashed, compressed, contentType, issues };
}

// ---------------------------------------------------------------- hsts, cors, cross-origin

/**
 * parseHsts(value) -> { maxAge: number|null, includeSubDomains: boolean, preload: boolean },
 * or null when the header is absent or empty.
 */
export function parseHsts(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const out = { maxAge: null, includeSubDomains: false, preload: false };
  for (const part of v.split(';')) {
    const i = part.indexOf('=');
    const key = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? '' : part.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key === 'max-age' && /^\d+$/.test(val)) out.maxAge = Number(val);
    else if (key === 'includesubdomains') out.includeSubDomains = true;
    else if (key === 'preload') out.preload = true;
  }
  return out;
}

/**
 * corsVerdict(headers) -> { status: 'pass'|'info'|'fail', text }. No header: pass. `*`: info,
 * fail with access-control-allow-credentials: true. `null`: fail. An explicit origin: info.
 */
export function corsVerdict(headers) {
  const origin = value(headers, 'access-control-allow-origin');
  const credentials = value(headers, 'access-control-allow-credentials').toLowerCase() === 'true';
  if (!origin) return { status: 'pass', text: 'no CORS header' };
  if (origin === '*') {
    return credentials
      ? { status: 'fail', text: 'access-control-allow-origin: * together with access-control-allow-credentials: true; browsers reject the pair, and it says credentials are meant to cross origins. Name the origin instead.' }
      : { status: 'info', text: 'access-control-allow-origin: * lets any site read this response; fine for public assets, not for anything personalised.' };
  }
  if (origin.toLowerCase() === 'null') {
    return { status: 'fail', text: 'access-control-allow-origin: null also matches sandboxed iframes and file: pages, so it is as open as *; name the origin instead.' };
  }
  return { status: 'info', text: `access-control-allow-origin: ${origin}${credentials ? ' with credentials' : ''}; check that this is the origin you intend.` };
}

/** crossOriginPolicies(headers) -> { coop, coep, corp }: the header values, or null when absent. */
export function crossOriginPolicies(headers) {
  return {
    coop: value(headers, 'cross-origin-opener-policy') || null,
    coep: value(headers, 'cross-origin-embedder-policy') || null,
    corp: value(headers, 'cross-origin-resource-policy') || null,
  };
}
