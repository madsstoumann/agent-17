/**
 * Page archives: read one with --from-archive, write one with --save-html.
 *
 * An archive is a folder (`<reports>/<host>/pages/<YYYY-MM-DD>/` in the audits layout) with an
 * `index.json` and one gzip file per fetched URL:
 *
 *   index.json  { host, date, source, redaction, count, pages: [{ url, status, content_type,
 *                 fetched_at, bytes, sha256, title, files: [...], redactions, location? }] }
 *   <slug>.html.gz         the body as served, redirects not followed (a 301's body too)
 *   <slug>.txt.gz          visible text, where plan-geo or audit-privacy read the page
 *   <slug>.hidden.txt.gz   accordion and payload text, where plan-geo read it
 *
 * The slug is the path with `/` written as `--` (`home` for the root), a `--<sha1 of the query>`
 * suffix when there is a query, and `-x` added until it is unique. Secrets may be masked as
 * `abcd…[masked <type>]` (or `abcd…[masked]`): those are placeholders, never real values.
 *
 * Identical copy in audit-seo and plan-geo (a test in each checks it). Zero dependencies. Node >= 22.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

/** A masked secret: up to 16 characters of the value, an ellipsis, `[masked]` or `[masked <type>]`. */
export const MASK = /[A-Za-z0-9._~+/=%-]{0,16}(?:…|\.\.\.)\[masked(?: [^\]\n]{1,60})?\]/g;

/** True when `s` holds a masked placeholder anywhere, also percent-encoded inside a URL. */
export function hasMask(s) {
  const str = String(s ?? '');
  const test = (x) => { MASK.lastIndex = 0; const hit = MASK.test(x); MASK.lastIndex = 0; return hit; };
  return test(str) || (str.includes('%') && test(decodeSafe(str)));
}

/** How many masked placeholders `s` holds. */
export function countMasks(s) {
  return (String(s ?? '').match(MASK) || []).length;
}

/** `s` with every masked placeholder removed (for text that is compared with drafts). */
export function stripMasks(s) {
  return String(s ?? '').replace(MASK, '');
}

/** robots.txt, llms.txt, llms-full.txt, ai.txt and XML sitemaps: archived beside the pages, never crawled as one. */
export function isSiteFile(url) {
  let p;
  try { p = new URL(url).pathname; } catch { return false; }
  return /^\/(robots|llms|llms-full|ai)\.txt$/i.test(p) || /\.xml(\.gz)?$/i.test(p);
}

/** Lookup key for a URL: parsed, hash dropped; the string as given when it does not parse. */
export function archiveKey(u) {
  try { const x = new URL(u); x.hash = ''; return x.toString(); } catch { return String(u || ''); }
}

/** The archive slug of `url`; `used` (a Set) makes it unique and records it. */
export function archiveSlug(url, used = null) {
  let base;
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } })
      .map((s) => s.replace(/[^\p{L}\p{N}._-]+/gu, '-'));
    base = segs.join('--') || 'home';
    const q = u.search.replace(/^\?/, '');
    if (q) base += `--${crypto.createHash('sha1').update(q).digest('hex').slice(0, 8)}`;
  } catch { base = 'page'; }
  base = base.slice(0, 200);
  let slug = base;
  if (used) { while (used.has(slug.toLowerCase())) slug += '-x'; used.add(slug.toLowerCase()); }
  return slug;
}

const fileOf = (files, kind) => (files || []).find((f) => (kind === 'hidden' ? /\.hidden\.txt\.gz$/ : kind === 'txt' ? /(?<!\.hidden)\.txt\.gz$/ : /\.html\.gz$/).test(f)) || null;

/**
 * openArchive(dir) -> archive. Throws when there is no readable index.json.
 *   archive.date, .host, .dir, .size, .urls()
 *   archive.entry(url)            the index entry or null
 *   archive.body(url) / .text(url) / .hidden(url)   the gunzipped file as text, or null when it is not there
 *   archive.bytes(url)            the body as a Buffer
 *   archive.notArchived           Set of URLs asked for that the archive does not hold
 *   archive.live                  Set of URLs fetched from the live site instead (--allow-live)
 *   archive.masked                Set of URLs that hold a masked placeholder (never fetched)
 *   archive.maskedValues          masked placeholders in the bodies served so far
 */
export function openArchive(dir) {
  const abs = path.resolve(dir);
  const indexFile = fs.existsSync(path.join(abs, 'index.json')) ? path.join(abs, 'index.json') : null;
  if (!indexFile) throw new Error(`--from-archive: no index.json in ${abs}`);
  let index;
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch (e) { throw new Error(`--from-archive: ${indexFile} is not valid JSON (${e.message})`); }
  const list = Array.isArray(index) ? index : index.pages;
  if (!Array.isArray(list)) throw new Error(`--from-archive: ${indexFile} has no pages list`);
  const map = new Map();
  for (const p of list) if (p && p.url) { const k = archiveKey(p.url); if (!map.has(k)) map.set(k, p); }
  const date = index.date || (list.map((p) => String(p.fetched_at || '').slice(0, 10)).filter(Boolean).sort()[0]) || path.basename(abs);
  const read = (entry, kind) => {
    const f = entry && fileOf(entry.files, kind);
    if (!f) return null;
    try { return zlib.gunzipSync(fs.readFileSync(path.join(abs, f))); } catch { return null; }
  };
  return {
    dir: abs,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : String(date),
    host: index.host || null,
    size: map.size,
    urls: () => [...map.keys()],
    entry: (url) => map.get(archiveKey(url)) || null,
    bytes: (url) => read(map.get(archiveKey(url)), 'html'),
    body: (url) => read(map.get(archiveKey(url)), 'html')?.toString('utf8') ?? null,
    text: (url) => read(map.get(archiveKey(url)), 'txt')?.toString('utf8') ?? null,
    hidden: (url) => read(map.get(archiveKey(url)), 'hidden')?.toString('utf8') ?? null,
    notArchived: new Set(),
    live: new Set(),
    masked: new Set(),
    maskedValues: 0,
  };
}

/**
 * archiveHttp(archive, { live, allowLive }) -> the http shape the audit skills use (get, head,
 * post, request, limit), answering from the archive. `redirect: 'follow'` follows archived
 * Location headers (10 hops at most). A URL the archive does not hold answers status 0 with
 * `error: 'not archived'`, unless `allowLive`: then `live` fetches it and the URL is recorded in
 * archive.live. A URL holding a masked placeholder is never fetched. POST (validator.schema.org)
 * always goes to `live`.
 */
export function archiveHttp(archive, { live = null, allowLive = false } = {}) {
  const counted = new Set();
  const none = (url, error) => ({ url, finalUrl: url, status: 0, ok: false, headers: {}, setCookie: [], body: null, bytes: 0, truncated: false, contentType: '', ms: null, redirected: false, error });
  const one = async (url, opts) => {
    if (hasMask(url)) { archive.masked.add(url); return none(url, 'masked placeholder'); }
    const e = archive.entry(url);
    if (!e) {
      if (allowLive && live) { archive.live.add(archiveKey(url)); return live.request(url, { ...opts, redirect: 'manual' }); }
      archive.notArchived.add(archiveKey(url));
      return none(url, 'not archived');
    }
    const status = Number(e.status) || 0;
    const ct = e.content_type || '';
    const headers = { 'content-type': ct };
    if (e.location) headers.location = e.location;
    const raw = opts.method === 'HEAD' || opts.maxBytes === 0 ? null : (archive.bytes(url) ?? Buffer.alloc(0));
    const body = raw == null ? null : opts.as === 'buffer' ? raw : raw.toString('utf8');
    if (raw && !counted.has(e.url)) { counted.add(e.url); archive.maskedValues += countMasks(raw.toString('utf8')); }
    return { url, finalUrl: url, status, ok: status >= 200 && status < 300, headers, setCookie: [], body, bytes: raw ? raw.length : Number(e.bytes) || 0, truncated: false, contentType: ct, ms: null, redirected: false, archived: true };
  };
  async function request(url, opts = {}) {
    const o = { method: (opts.method || 'GET').toUpperCase(), redirect: opts.redirect || 'follow', maxBytes: opts.maxBytes ?? 2 * 1024 * 1024, headers: opts.headers || {}, timeout: opts.timeout, as: opts.as, body: opts.body };
    if (o.method === 'POST') return live ? live.request(url, opts) : none(url, 'no network in archive mode');
    let res = await one(url, o);
    if (o.redirect !== 'follow') return res;
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.headers.location && hops < 10) {
      let next;
      try { next = new URL(res.headers.location, res.url).toString(); } catch { break; }
      hops++;
      const r = await one(next, o);
      res = { ...r, url, finalUrl: r.finalUrl || next, redirected: true };
    }
    return res;
  }
  return {
    request,
    get: (url, opts = {}) => request(url, { ...opts, method: 'GET' }),
    head: (url, opts = {}) => request(url, { ...opts, method: 'HEAD' }),
    post: (url, opts = {}) => request(url, { ...opts, method: 'POST' }),
    limit: live?.limit || ((fn) => fn()),
    archive,
  };
}

function decodeSafe(u) { try { return decodeURIComponent(u); } catch { return u; } }

/** The archive's own words for the report cover. */
export function archiveCover(archive) {
  return `Built from the archive of ${archive.date}, not the live site`;
}

/**
 * createArchiveWriter(dir, { host, source }) -> { add(page), finish() -> { dir, count } }
 * add({ url, status, contentType, location, body, title, fetchedAt }) writes <slug>.html.gz and
 * keeps the index entry; finish() writes index.json. Nothing is masked: redact before sharing.
 */
export function createArchiveWriter(dir, { host = null, source = '', date = new Date().toISOString().slice(0, 10) } = {}) {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  const used = new Set();
  const pages = [];
  const seen = new Set();
  return {
    dir: abs,
    add({ url, status, contentType = '', location = null, body = '', title = null, fetchedAt = new Date() }) {
      const key = archiveKey(url);
      if (seen.has(key)) return null;
      seen.add(key);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || '', 'utf8');
      const slug = archiveSlug(url, used);
      const file = `${slug}.html.gz`;
      fs.writeFileSync(path.join(abs, file), zlib.gzipSync(buf));
      const entry = {
        url: key, status, content_type: contentType || '', fetched_at: new Date(fetchedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), title: title ?? null, files: [file], redactions: 0,
      };
      if (location) entry.location = location;
      pages.push(entry);
      return entry;
    },
    finish() {
      const index = { host, date, source, redaction: 'none: secrets are not masked; redact before sharing', count: pages.length, pages };
      fs.writeFileSync(path.join(abs, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
      return { dir: abs, count: pages.length };
    },
  };
}
