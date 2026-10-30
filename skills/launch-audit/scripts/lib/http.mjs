/**
 * HTTP helpers shared by every check: a fetch wrapper with timeouts and capped
 * bodies, a curl probe for what Node's fetch cannot see (HTTP version, timings),
 * and small pure URL/host utilities.
 *
 * Zero dependencies. Node >= 22.
 */
import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const VERSION = '1.1.0';
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const AUDIT_HEADER = `launch-audit/${VERSION}`;

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.example', '.invalid', '.home.arpa', '.lan'];

// ---------------------------------------------------------------- pure helpers

/** RFC1918 / loopback / link-local / CGNAT / ULA literal? Non-IP strings are false. */
export function isPrivateAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
    if (/^f[cd][0-9a-f]{2}:/.test(l) || /^f[cd]/.test(l)) return true; // fc00::/7
    if (/^fe[89ab]/.test(l)) return true; // fe80::/10
    return false;
  }
  return false;
}

/** A host that public services (W3C, Observatory, PSI) can never reach. */
export function isPrivateHost(host) {
  let h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return false;
  if (net.isIP(h)) return isPrivateAddress(h);
  if (h === 'localhost') return true;
  if (PRIVATE_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (!h.includes('.')) return true; // single-label intranet name
  return false;
}

/** "example.com/x" -> "https://example.com/x"; strips credentials and #hash; http(s) only. */
export function normaliseUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('empty URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new Error(`not a URL: ${input}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`unsupported scheme: ${u.protocol}`);
  u.username = ''; u.password = ''; u.hash = '';
  return u.toString();
}

function canonKey(u) {
  const x = new URL(u);
  const path = x.pathname.replace(/\/+$/, '');
  return `${x.protocol}//${x.host}${path}${x.search}`;
}

/** Same URL ignoring a trailing slash, host case, default port and fragment. Invalid input -> false. */
export function sameUrlModuloSlash(a, b) {
  try { return canonKey(a) === canonKey(b); } catch { return false; }
}

export function hostOf(u) {
  try { return new URL(u).host.toLowerCase(); } catch { return ''; }
}

export function sameHost(a, b) {
  const ha = hostOf(a); const hb = hostOf(b);
  return Boolean(ha) && ha === hb;
}

export function stripWww(host) {
  return String(host || '').replace(/^www\./i, '');
}

/** www.example.com -> example.com, example.com -> www.example.com, anything deeper -> null. */
export function siblingHost(host) {
  const h = String(host || '').toLowerCase();
  if (/^www\./.test(h)) return h.slice(4);
  const dots = (h.match(/\./g) || []).length;
  if (dots === 1) return `www.${h}`;
  return null;
}

/** Minimal concurrency limiter: const limit = pLimit(4); await limit(() => job()). */
export function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Headers -> { headers: lowercase map (repeats joined by ", "), setCookie: string[] } */
export function headersToObject(h) {
  const headers = {};
  const setCookie = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
  h.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie') return;
    headers[k] = headers[k] ? `${headers[k]}, ${value}` : value;
  });
  return { headers, setCookie };
}

export function describeError(e) {
  if (!e) return 'unknown error';
  const cause = e.cause || e;
  const code = cause.code || e.code;
  if (e.name === 'AbortError' || e.name === 'TimeoutError' || /timeout/i.test(String(e.message))) return 'timeout';
  const msg = cause.message || e.message || String(e);
  return code ? `${code}: ${msg}` : msg;
}

// ---------------------------------------------------------------- fetch wrapper

async function readCapped(res, maxBytes, as) {
  if (!res.body) return { body: as === 'buffer' ? Buffer.alloc(0) : '', bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); bytes += value.byteLength;
    if (bytes >= maxBytes) { truncated = true; try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  return { body: as === 'buffer' ? buf : buf.toString('utf8'), bytes, truncated };
}

/**
 * createHttp({ timeout, ua, from, concurrency, log }) -> { request, get, head, limit }
 *
 * request(url, { method, headers, redirect ('follow' | 'manual'), maxBytes, timeout, as ('text' | 'buffer'), retry, body })
 *   -> { url, finalUrl, status, ok, headers, setCookie, body, bytes, truncated, contentType, ms, redirected, error? }
 * A network failure never throws: status 0 and `error` is set. HTTP errors are ordinary responses.
 */
export function createHttp({ timeout = 15000, ua = UA, from = '', concurrency = 6, log = () => {} } = {}) {
  const limit = pLimit(concurrency);
  const baseHeaders = {
    'user-agent': ua,
    'x-audit': AUDIT_HEADER,
    'accept-language': 'en,da;q=0.8',
    'accept-encoding': 'br, gzip',
    ...(from ? { from } : {}),
  };

  async function once(url, { method, headers, redirect, maxBytes, timeout: t, as, body: reqBody }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), t);
    const started = Date.now();
    try {
      const res = await fetch(url, { method, redirect, headers: { ...baseHeaders, ...headers }, signal: ctrl.signal, ...(reqBody != null ? { body: reqBody } : {}) });
      const { headers: hobj, setCookie } = headersToObject(res.headers);
      let body = null; let bytes = 0; let truncated = false;
      if (method !== 'HEAD' && maxBytes > 0) {
        ({ body, bytes, truncated } = await readCapped(res, maxBytes, as));
      } else {
        try { await res.body?.cancel(); } catch { /* ignore */ }
      }
      return {
        url, finalUrl: res.url || url, status: res.status, ok: res.ok, headers: hobj, setCookie,
        body, bytes, truncated, contentType: hobj['content-type'] || '', ms: Date.now() - started, redirected: res.redirected,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(url, opts = {}) {
    const o = {
      method: (opts.method || 'GET').toUpperCase(),
      headers: opts.headers || {},
      redirect: opts.redirect || 'follow',
      maxBytes: opts.maxBytes ?? 2 * 1024 * 1024,
      timeout: opts.timeout ?? timeout,
      as: opts.as || 'text',
      body: opts.body ?? null,
    };
    const retries = opts.retry ?? ((o.method === 'GET' || o.method === 'HEAD') ? 1 : 0);
    const started = Date.now();
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        return await limit(() => once(url, o));
      } catch (e) {
        lastErr = e;
        const desc = describeError(e);
        const transient = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET|fetch failed|timeout/i.test(desc);
        log(`http ${o.method} ${url} -> ${desc}${transient && i < retries ? ' (retrying)' : ''}`);
        if (!transient) break;
      }
    }
    return {
      url, finalUrl: url, status: 0, ok: false, headers: {}, setCookie: [], body: null, bytes: 0, truncated: false,
      contentType: '', ms: Date.now() - started, redirected: false, error: describeError(lastErr),
    };
  }

  return {
    request,
    get: (url, opts = {}) => request(url, { ...opts, method: 'GET' }),
    head: (url, opts = {}) => request(url, { ...opts, method: 'HEAD' }),
    post: (url, opts = {}) => request(url, { ...opts, method: 'POST', retry: 0 }),
    limit,
  };
}

// ---------------------------------------------------------------- curl probe

/**
 * What fetch cannot tell us: negotiated HTTP version, DNS/TLS/TTFB timings, remote IP.
 * Uses curl's -w '%{json}'. Never asks for brotli (this curl cannot decode it).
 */
export async function curlProbe(url, { insecure = false, timeout = 20000, ua = UA, follow = false } = {}) {
  const args = [
    '-s', '-o', '/dev/null', '-w', '%{json}', '--max-time', String(Math.ceil(timeout / 1000)),
    '-A', ua, '-H', `X-Audit: ${AUDIT_HEADER}`, '-H', 'Accept-Encoding: gzip',
    ...(insecure ? ['-k'] : []), ...(follow ? ['-L'] : []), url,
  ];
  try {
    const { stdout } = await execFileAsync('curl', args, { timeout: timeout + 5000, maxBuffer: 1024 * 1024 });
    const j = JSON.parse(stdout);
    return {
      httpVersion: String(j.http_version || ''),
      status: Number(j.response_code || 0),
      remoteIp: j.remote_ip || '',
      redirects: Number(j.num_redirects || 0),
      timings: {
        dns: Number(j.time_namelookup || 0),
        connect: Number(j.time_connect || 0),
        tls: Number(j.time_appconnect || 0),
        ttfb: Number(j.time_starttransfer || 0),
        total: Number(j.time_total || 0),
      },
      sizeDownload: Number(j.size_download || 0),
      scheme: j.scheme || '',
      raw: j,
    };
  } catch (e) {
    return { error: describeError(e) };
  }
}
