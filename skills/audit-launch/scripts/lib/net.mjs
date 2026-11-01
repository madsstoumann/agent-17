/**
 * Network probes for a launch audit: the TLS certificate, DNS through the system
 * resolver with DNS-over-HTTPS as fallback, DNSSEC, SPF / DMARC / DKIM, and HSTS
 * preload eligibility.
 *
 * Zero dependencies. Node >= 22. Async functions never throw. The async probes take
 * an injectable `connect` / `fetch` / `resolver` / `doh` so tests can run offline.
 */
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { describeError } from './http.mjs';

const DAY = 86400000;
const RCODES = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };
const TYPE_NAMES = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 35: 'NAPTR',
  43: 'DS', 46: 'RRSIG', 47: 'NSEC', 48: 'DNSKEY', 50: 'NSEC3', 52: 'TLSA', 64: 'SVCB', 65: 'HTTPS', 99: 'SPF', 257: 'CAA',
};
/** Resolver codes that mean "no such record" (an empty list), and those where a public DoH resolver is worth asking. */
const EMPTY_CODES = new Set(['ENODATA', 'ENOTFOUND']);
const FALLBACK_CODES = new Set(['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EREFUSED']);

const undot = (s) => String(s || '').replace(/\.$/, '');
const dnsErrorText = (e) => (e?.code ? `${e.code}: ${e.message}` : (e?.message || String(e)));

// ---------------------------------------------------------------- TLS

/**
 * tlsInfo(host, { port = 443, timeout = 10000, connect = tls.connect })
 *   -> { ok: true, authorized, authorizationError, protocol, alpn, cipher: { name, version },
 *        cert: { subject, issuer, validFrom, validTo, subjectAltName, serialNumber, fingerprint256 },
 *        chain: [{ subject, issuer, validTo }] }
 *    | { ok: false, error }
 *
 * Connects with rejectUnauthorized: false so the certificate can be read even when the
 * chain is invalid; `authorized` and `authorizationError` say what Node's verifier thought.
 * The chain follows issuerCertificate until a certificate references itself.
 */
export function tlsInfo(host, { port = 443, timeout = 10000, connect = tls.connect } = {}) {
  return new Promise((resolve) => {
    let socket; let done = false;
    const finish = (result) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { socket?.destroy(); } catch { /* already gone */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `TLS handshake timed out after ${timeout} ms` }), timeout);
    try {
      socket = connect({ host, port, servername: host, ALPNProtocols: ['h2', 'http/1.1'], rejectUnauthorized: false }, () => {
        const peer = socket.getPeerCertificate(true);
        if (!peer || !Object.keys(peer).length) { finish({ ok: false, error: 'no peer certificate' }); return; }
        const chain = [];
        const seen = new Set();
        for (let c = peer; c && typeof c === 'object' && !seen.has(c) && chain.length < 10; c = c.issuerCertificate) {
          seen.add(c);
          chain.push({ subject: c.subject, issuer: c.issuer, validTo: c.valid_to });
          if (!c.issuerCertificate || c.issuerCertificate === c) break;
        }
        const cipher = socket.getCipher() || {};
        const authErr = socket.authorizationError;
        finish({
          ok: true,
          authorized: Boolean(socket.authorized),
          authorizationError: authErr == null ? null : String(authErr.code || authErr.message || authErr),
          protocol: socket.getProtocol() || null,
          alpn: socket.alpnProtocol || null,
          cipher: { name: cipher.name ?? null, version: cipher.version ?? null },
          cert: {
            subject: peer.subject, issuer: peer.issuer, validFrom: peer.valid_from, validTo: peer.valid_to,
            subjectAltName: peer.subjectaltname, serialNumber: peer.serialNumber, fingerprint256: peer.fingerprint256,
          },
          chain,
        });
      });
      socket.on('error', (e) => finish({ ok: false, error: describeError(e) }));
    } catch (e) {
      finish({ ok: false, error: describeError(e) });
    }
  });
}

/** Wildcard-aware SAN match: *.example.com covers exactly one extra label. */
function sanMatches(pattern, host) {
  const p = String(pattern).toLowerCase();
  if (p === host) return true;
  if (!p.startsWith('*.')) return false;
  const suffix = p.slice(1);
  return host.endsWith(suffix) && host.length > suffix.length && !host.slice(0, -suffix.length).includes('.');
}

/**
 * certSummary(info, { host, altHost = null, now = new Date() })
 *   -> { issuer, validTo (ISO), daysLeft, sans: string[], coversHost, coversAlt (null without altHost),
 *        wildcard, chainLength, status: 'pass'|'warn'|'fail', text }
 *
 * fail: unreachable, not trusted, not covering the host, or fewer than 14 days left;
 * warn: fewer than 30 days, or an altHost the certificate does not cover.
 */
export function certSummary(info, { host, altHost = null, now = new Date() } = {}) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const alt = altHost ? String(altHost).toLowerCase().replace(/\.$/, '') : null;
  if (!info || !info.ok) {
    return { issuer: null, validTo: null, daysLeft: null, sans: [], coversHost: false, coversAlt: alt ? false : null, wildcard: false, chainLength: 0, status: 'fail', text: `TLS: ${info?.error || 'no certificate'}` };
  }
  const cert = info.cert || {};
  const issuer = cert.issuer?.O || cert.issuer?.CN || null;
  const validToDate = new Date(cert.validTo);
  const validTo = Number.isNaN(validToDate.getTime()) ? null : validToDate.toISOString();
  const daysLeft = validTo ? Math.floor((validToDate.getTime() - now.getTime()) / DAY) : null;
  const sans = String(cert.subjectAltName || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => s.replace(/^(DNS|IP Address):/i, ''));
  const names = sans.length ? sans : [cert.subject?.CN].filter(Boolean);
  const coversHost = names.some((n) => sanMatches(n, h));
  const coversAlt = alt ? names.some((n) => sanMatches(n, alt)) : null;
  const wildcard = sans.some((s) => s.startsWith('*.'));
  const chainLength = Array.isArray(info.chain) ? info.chain.length : 0;

  let status = 'pass';
  const parts = [];
  parts.push(issuer || 'unknown issuer');
  if (daysLeft == null) { parts.push('expiry unreadable'); status = 'fail'; }
  else if (daysLeft < 0) { parts.push(`expired ${-daysLeft} days ago (${validTo.slice(0, 10)})`); status = 'fail'; }
  else {
    parts.push(`expires in ${daysLeft} days (${validTo.slice(0, 10)})`);
    if (daysLeft < 14) status = 'fail'; else if (daysLeft < 30) status = 'warn';
  }
  if (coversHost) parts.push(`covers ${h}`); else { parts.push(`does not cover ${h}`); status = 'fail'; }
  if (alt) {
    if (coversAlt) parts.push(`also ${alt}`);
    else { parts.push(`not ${alt}`); if (status === 'pass') status = 'warn'; }
  }
  if (info.authorized === false) { parts.push(`not trusted: ${info.authorizationError || 'unknown reason'}`); status = 'fail'; }
  parts.push(`chain of ${chainLength}`);
  return { issuer, validTo, daysLeft, sans, coversHost, coversAlt, wildcard, chainLength, status, text: parts.join(', ') };
}

// ---------------------------------------------------------------- DNS over HTTPS

/** `"abc" "def"` -> abcdef, with \" and \\ unescaped; anything not starting with a quote is returned as is. */
function unquoteTxt(s) {
  if (!s.startsWith('"')) return s;
  const parts = [];
  for (const m of s.matchAll(/"((?:[^"\\]|\\.)*)"/g)) parts.push(m[1].replace(/\\(.)/g, '$1'));
  return parts.length ? parts.join('') : s;
}

/**
 * parseDohAnswer(json) -> { ok, status (RCODE), ad, answers: [{ name, type, ttl, data }], error? }
 *
 * ok is true for NOERROR and NXDOMAIN (a complete answer); SERVFAIL and friends are ok: false.
 * Types are named where known ('A', 'TXT', 'CAA' …); TXT data is unquoted and its chunks joined.
 */
export function parseDohAnswer(json) {
  if (!json || typeof json !== 'object' || typeof json.Status !== 'number') return { ok: false, status: null, ad: false, answers: [], error: 'not a DoH JSON answer' };
  const status = json.Status;
  const answers = (Array.isArray(json.Answer) ? json.Answer : []).map((a) => {
    const type = TYPE_NAMES[a.type] ?? a.type;
    let data = a.data == null ? '' : String(a.data);
    if (type === 'TXT' || type === 'SPF') data = unquoteTxt(data);
    return { name: undot(a.name), type, ttl: a.TTL ?? null, data };
  });
  const ok = status === 0 || status === 3;
  const out = { ok, status, ad: Boolean(json.AD), answers };
  if (!ok) out.error = RCODES[status] || `RCODE ${status}`;
  return out;
}

/**
 * doh(name, type = 'A', { provider = 'cloudflare'|'google', timeout = 8000, fetch = globalThis.fetch })
 *   -> { ok, status (RCODE or null), ad, answers, provider, error? }
 */
export async function doh(name, type = 'A', { provider = 'cloudflare', timeout = 8000, fetch: fetchImpl = globalThis.fetch } = {}) {
  const p = provider === 'google' ? 'google' : 'cloudflare';
  const q = `name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const url = p === 'google' ? `https://dns.google/resolve?${q}` : `https://cloudflare-dns.com/dns-query?${q}`;
  const failed = (error) => ({ ok: false, status: null, ad: false, answers: [], provider: p, error });
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return failed(`HTTP ${res.status}`);
    let json;
    try { json = await res.json(); } catch (e) { return failed(`not JSON: ${describeError(e)}`); }
    return { ...parseDohAnswer(json), provider: p };
  } catch (e) {
    return failed(describeError(e));
  }
}

// ---------------------------------------------------------------- DNS records

const parseCaaData = (data) => {
  const m = /^(\d+)\s+(\S+)\s+"?([^"]*)"?\s*$/.exec(data) || [];
  return { flags: Number(m[1] ?? 0), tag: m[2] ?? '', value: m[3] ?? data };
};
// Node's records carry a `type` key beside the payload ({ critical, type: 'CAA', issue }, { exchange, priority, type: 'MX' }).
const nodeCaa = (records) => records.map((r) => {
  const [tag, value] = Object.entries(r).find(([k]) => k !== 'critical' && k !== 'type') || ['', ''];
  return { flags: Number(r.critical ?? 0), tag, value: String(value) };
});
const byPriority = (mx) => mx.map((m) => ({ exchange: undot(m.exchange), priority: Number(m.priority) })).sort((a, b) => a.priority - b.priority);
const dohMx = (answers) => byPriority(answers.map((a) => {
  const [priority, ...rest] = String(a.data).split(/\s+/);
  return { exchange: rest.join(' '), priority };
}));

/**
 * dnsRecords(name, { resolver = node:dns/promises, doh = doh })
 *   -> { a: string[], aaaa: string[], ns: string[], caa: [{ flags, tag, value }],
 *        mx: [{ exchange, priority }] (by priority), txt: string[] (chunks joined), errors: { <type>: message } }
 *
 * Every type is queried in parallel. ENODATA / ENOTFOUND are empty lists; on SERVFAIL,
 * timeout or a refused query the type is asked again over DoH; any other failure is recorded.
 */
export async function dnsRecords(name, { resolver = dns, doh: dohImpl = doh } = {}) {
  const out = { a: [], aaaa: [], ns: [], caa: [], mx: [], txt: [], errors: {} };
  const identity = (x) => x;
  const jobs = [
    ['a', 'A', () => resolver.resolve4(name), identity, (ans) => ans.map((r) => r.data)],
    ['aaaa', 'AAAA', () => resolver.resolve6(name), identity, (ans) => ans.map((r) => r.data)],
    ['ns', 'NS', () => resolver.resolveNs(name), (x) => x.map(undot), (ans) => ans.map((r) => undot(r.data))],
    ['caa', 'CAA', () => resolver.resolveCaa(name), nodeCaa, (ans) => ans.map((r) => parseCaaData(r.data))],
    ['mx', 'MX', () => resolver.resolveMx(name), byPriority, dohMx],
    ['txt', 'TXT', () => resolver.resolveTxt(name), (x) => x.map((chunks) => chunks.join('')), (ans) => ans.map((r) => r.data)],
  ];
  await Promise.all(jobs.map(async ([key, type, query, fromNode, fromDoh]) => {
    try {
      out[key] = fromNode(await query());
    } catch (e) {
      const code = e?.code || '';
      if (EMPTY_CODES.has(code)) return;
      const local = dnsErrorText(e);
      if (!FALLBACK_CODES.has(code)) { out.errors[key] = local; return; }
      const r = await dohImpl(name, type, {});
      if (r.ok) { out[key] = fromDoh(r.answers.filter((a) => a.type === type)); return; }
      out.errors[key] = `${local}; DoH: ${r.error || 'failed'}`;
    }
  }));
  return out;
}

/**
 * dnssecStatus(name, { doh = doh }) -> { validated: boolean|null, provider, error? }
 *
 * The AD flag of an A query at Cloudflare, then Google: both validate, so AD false means
 * the zone is unsigned. A local resolver never sets AD, which is why DoH is used.
 */
export async function dnssecStatus(name, { doh: dohImpl = doh } = {}) {
  const cf = await dohImpl(name, 'A', { provider: 'cloudflare' });
  if (cf.ok) return { validated: cf.ad, provider: 'cloudflare' };
  const g = await dohImpl(name, 'A', { provider: 'google' });
  if (g.ok) return { validated: g.ad, provider: 'google' };
  const error = cf.status === 2 && g.status === 2
    ? 'SERVFAIL from Cloudflare and Google (a broken DNSSEC chain answers this way)'
    : (g.error || cf.error || 'no answer');
  return { validated: null, provider: 'google', error };
}

// ---------------------------------------------------------------- SPF / DMARC / DKIM

const LOOKUP_TERM = /^[-~?+]?(include|a|mx|ptr|exists)(?=[:/]|$)/i;

/**
 * evaluateSpf(txtRecords, { hasMx = false })
 *   -> { status: 'pass'|'warn'|'fail'|'info', records: string[], count, terminal: '-all'|'~all'|'?all'|'+all'|null,
 *        lookups (include/a/mx/ptr/exists/redirect terms), text, fix (null when nothing to do) }
 */
export function evaluateSpf(txtRecords, { hasMx = false } = {}) {
  const records = (txtRecords || []).map((t) => String(t).trim()).filter((t) => /^v=spf1(\s|$)/i.test(t));
  const count = records.length;
  if (count === 0) {
    return hasMx
      ? { status: 'warn', records, count, terminal: null, lookups: 0, text: 'No SPF record, but the domain receives mail', fix: 'Publish a TXT record `v=spf1 <your senders> -all` so receivers can tell your mail from forgeries' }
      : { status: 'info', records, count, terminal: null, lookups: 0, text: 'No SPF record', fix: 'No mail from this domain? Publish `v=spf1 -all` so nobody can send as it' };
  }
  if (count > 1) {
    return { status: 'fail', records, count, terminal: null, lookups: 0, text: `${count} SPF records; RFC 7208 makes several a permanent error, so none applies`, fix: 'Merge them into one v=spf1 record' };
  }
  const record = records[0];
  const terms = record.split(/\s+/).slice(1);
  let terminal = null; let redirect = null; let lookups = 0;
  for (const term of terms) {
    const all = /^([-~?+]?)all$/i.exec(term);
    if (all) { terminal = `${all[1] || '+'}all`; continue; }
    if (/^redirect=/i.test(term)) { redirect = term.slice(9); lookups++; continue; }
    if (LOOKUP_TERM.test(term)) lookups++;
  }
  let status = 'pass'; let fix = null;
  if (terminal === '-all' || terminal === '~all') { /* strict or soft fail: fine */ }
  else if (terminal === null && redirect) { /* delegated to another record */ }
  else if (terminal === null) { status = 'warn'; fix = 'End the record with -all (or ~all): without it anything not listed is neutral, which is no protection'; }
  else { status = 'warn'; fix = `End the record with -all instead of ${terminal}: ${terminal} lets any host send as this domain`; }
  if (lookups > 10) { status = 'warn'; fix = `${fix ? `${fix}; ` : ''}reduce to 10 DNS lookups or fewer (RFC 7208 §4.6.4): receivers stop evaluating past the limit`; }
  const text = `${record} (${terminal || (redirect ? `redirect=${redirect}` : 'no all')}, ${lookups} DNS lookup${lookups === 1 ? '' : 's'})`;
  return { status, records, count, terminal, lookups, text, fix };
}

/**
 * evaluateDmarc(txtRecords, { hasMx = false })
 *   -> { status, record, policy, subdomainPolicy, rua: string[], pct, text, fix (null when nothing to do) }
 *
 * The records are the TXT set at _dmarc.<domain>. Missing: fail when the domain receives
 * mail, warn otherwise. p=none warns; quarantine and reject pass.
 */
export function evaluateDmarc(txtRecords, { hasMx = false } = {}) {
  const records = (txtRecords || []).map((t) => String(t).trim()).filter((t) => /^v\s*=\s*dmarc1\b/i.test(t));
  const base = { record: null, policy: null, subdomainPolicy: null, rua: [], pct: null };
  if (records.length === 0) {
    return { status: hasMx ? 'fail' : 'warn', ...base, text: hasMx ? 'No DMARC record, and the domain receives mail' : 'No DMARC record', fix: 'Publish a TXT at _dmarc.<domain>: `v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>` (p=reject once the reports are clean)' };
  }
  if (records.length > 1) {
    return { status: 'fail', ...base, text: `${records.length} DMARC records; receivers treat that as none`, fix: 'Keep one v=DMARC1 record at _dmarc.<domain>' };
  }
  const record = records[0];
  const tags = {};
  for (const part of record.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  const policy = tags.p ? tags.p.toLowerCase() : null;
  const subdomainPolicy = tags.sp ? tags.sp.toLowerCase() : policy;
  const rua = tags.rua ? tags.rua.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const pct = tags.pct != null && tags.pct !== '' && Number.isFinite(Number(tags.pct)) ? Number(tags.pct) : 100;
  const out = { record, policy, subdomainPolicy, rua, pct };
  if (!policy || !['none', 'quarantine', 'reject'].includes(policy)) {
    return { status: 'fail', ...out, text: `DMARC record without a valid p= policy: ${record}`, fix: 'Add p=quarantine or p=reject; a record without p= is ignored' };
  }
  const notes = [`p=${policy}`];
  if (subdomainPolicy !== policy) notes.push(`sp=${subdomainPolicy}`);
  if (pct !== 100) notes.push(`pct=${pct}`);
  notes.push(rua.length ? `reports to ${rua.join(', ')}` : 'no rua');
  const fixes = [];
  let status = 'pass';
  if (policy === 'none') { status = 'warn'; fixes.push('p=none only monitors: move to p=quarantine, then p=reject once the reports are clean'); }
  if (!rua.length) fixes.push('Add rua=mailto:… to receive aggregate reports');
  if (pct !== 100) fixes.push('pct below 100 leaves part of the forged mail unfiltered');
  return { status, ...out, text: notes.join(', '), fix: fixes.length ? fixes.join('; ') : null };
}

const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'k1', 'mail', 'dkim', 's1', 's2'];

/**
 * dkimProbe(domain, { selectors = common nine, resolver = node:dns/promises })
 *   -> { found: [{ selector, record }], errors: { <selector>: message } }
 *
 * A TXT lookup at <selector>._domainkey.<domain> per selector; ENODATA / ENOTFOUND are silent.
 */
export async function dkimProbe(domain, { selectors = DKIM_SELECTORS, resolver = dns } = {}) {
  const errors = {};
  const results = await Promise.all(selectors.map(async (selector) => {
    try {
      const records = (await resolver.resolveTxt(`${selector}._domainkey.${domain}`)).map((chunks) => chunks.join(''));
      const record = records.find((r) => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(r)) || records[0];
      return record ? { selector, record } : null;
    } catch (e) {
      if (!EMPTY_CODES.has(e?.code)) errors[selector] = dnsErrorText(e);
      return null;
    }
  }));
  return { found: results.filter(Boolean), errors };
}

// ---------------------------------------------------------------- HSTS

function parseHstsHeader(header) {
  const out = { maxAge: null, includeSubDomains: false, preload: false };
  for (const part of String(header).split(';')) {
    const [k, v = ''] = part.split('=');
    const key = k.trim().toLowerCase();
    if (key === 'max-age') { const n = Number(v.trim().replace(/^"|"$/g, '')); if (Number.isFinite(n)) out.maxAge = n; }
    else if (key === 'includesubdomains') out.includeSubDomains = true;
    else if (key === 'preload') out.preload = true;
  }
  return out;
}

/**
 * hstsPreloadEligibility({ maxAge, includeSubDomains, preload } | rawHeader) -> { eligible, issues: string[] }
 *
 * hstspreload.org's requirements: max-age of at least a year, includeSubDomains, preload.
 */
export function hstsPreloadEligibility(hsts) {
  if (typeof hsts === 'string' && !hsts.trim()) return { eligible: false, issues: ['no Strict-Transport-Security header'] };
  const { maxAge, includeSubDomains, preload } = typeof hsts === 'string' ? parseHstsHeader(hsts) : (hsts || {});
  const issues = [];
  if (maxAge == null || !Number.isFinite(Number(maxAge))) issues.push('no max-age');
  else if (Number(maxAge) < 31536000) issues.push(`max-age ${maxAge} is below 31536000 (one year)`);
  if (!includeSubDomains) issues.push('missing includeSubDomains');
  if (!preload) issues.push('missing preload');
  return { eligible: issues.length === 0, issues };
}
