// DNS over HTTPS (Cloudflare, then Google). DoH first rather than the system resolver: it gives
// the same answer on every machine, reports the DNSSEC AD flag, and works where port 53 is
// filtered or a local resolver answers only A records (VPNs, corporate networks, sandboxes).
import { promises as sysdns } from 'node:dns';

export const TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 43: 'DS', 48: 'DNSKEY', 64: 'SVCB', 65: 'HTTPS', 257: 'CAA' };
const RCODES = { 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };
const PROVIDERS = {
  cloudflare: (q) => `https://cloudflare-dns.com/dns-query?${q}`,
  google: (q) => `https://dns.google/resolve?${q}`,
};

export const undot = (s) => String(s || '').replace(/\.$/, '').toLowerCase();

/** "\"v=spf1 \" \"-all\"" -> "v=spf1 -all" */
export function unquoteTxt(data) {
  const parts = String(data).match(/"((?:[^"\\]|\\.)*)"/g);
  return parts ? parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, '$1')).join('') : String(data);
}

/** DoH JSON -> { ok, rcode, nxdomain, ad, answers: [{ name, type, ttl, data }] } */
export function parseDoh(json) {
  if (!json || typeof json.Status !== 'number') return { ok: false, rcode: null, nxdomain: false, ad: false, answers: [], error: 'not a DoH answer' };
  const answers = (json.Answer || []).map((a) => {
    const type = TYPES[a.type] || String(a.type);
    const data = type === 'TXT' ? unquoteTxt(a.data) : String(a.data ?? '');
    return { name: undot(a.name), type, ttl: a.TTL ?? null, data };
  });
  const ok = json.Status === 0 || json.Status === 3;
  return { ok, rcode: RCODES[json.Status] || (json.Status ? `RCODE ${json.Status}` : 'NOERROR'), nxdomain: json.Status === 3, ad: Boolean(json.AD), answers, ...(ok ? {} : { error: RCODES[json.Status] || `RCODE ${json.Status}` }) };
}

/**
 * createResolver({ fetch, timeout }) -> { query(name, type), records(name, type), cache }
 * query returns the parsed answer (answers of every type, so CNAME chains show); records returns
 * the data strings of the asked type only, [] for none or NXDOMAIN, and throws on SERVFAIL.
 */
export function createResolver({ fetch: fetchImpl = globalThis.fetch, timeout = 8000, system = sysdns } = {}) {
  const cache = new Map();
  async function ask(provider, name, type) {
    const url = PROVIDERS[provider](`name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}&do=1`);
    const res = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
    return { ...parseDoh(await res.json()), provider };
  }
  async function query(name, type = 'A') {
    const key = `${undot(name)} ${type}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const errors = [];
        for (const p of Object.keys(PROVIDERS)) {
          try {
            const r = await ask(p, name, type);
            if (r.ok) return r;
            errors.push(`${p}: ${r.error}`);
          } catch (e) { errors.push(`${p}: ${e.cause?.code || e.message}`); }
        }
        // Both SERVFAIL is an answer (a broken DNSSEC chain looks like this); a network failure falls back to the system resolver.
        if (errors.every((e) => /SERVFAIL/.test(e))) return { ok: false, rcode: 'SERVFAIL', nxdomain: false, ad: false, answers: [], error: errors.join('; ') };
        return systemQuery(system, name, type, errors.join('; '));
      })());
    }
    return cache.get(key);
  }
  async function records(name, type) {
    const r = await query(name, type);
    if (!r.ok) throw new Error(`${type} ${name}: ${r.error}`);
    return r.answers.filter((a) => a.type === type).map((a) => a.data);
  }
  return { query, records, cache };
}

const SYS = {
  A: (d, n) => d.resolve4(n), AAAA: (d, n) => d.resolve6(n), NS: (d, n) => d.resolveNs(n), CNAME: (d, n) => d.resolveCname(n),
  MX: async (d, n) => (await d.resolveMx(n)).map((m) => `${m.priority} ${m.exchange}`),
  TXT: async (d, n) => (await d.resolveTxt(n)).map((c) => c.join('')),
  CAA: async (d, n) => (await d.resolveCaa(n)).map((r) => { const [tag, v] = Object.entries(r).find(([k]) => k !== 'critical' && k !== 'type') || ['', '']; return `${r.critical ? 128 : 0} ${tag} "${v}"`; }),
  SOA: async (d, n) => { const s = await d.resolveSoa(n); return [`${s.nsname} ${s.hostmaster} ${s.serial} ${s.refresh} ${s.retry} ${s.expire} ${s.minttl}`]; },
};

async function systemQuery(system, name, type, dohError) {
  const fn = SYS[type];
  if (!fn) return { ok: false, rcode: null, nxdomain: false, ad: false, answers: [], error: `DoH failed (${dohError}); ${type} has no system fallback` };
  try {
    const data = await fn(system, name);
    return { ok: true, rcode: 'NOERROR', nxdomain: false, ad: false, provider: 'system', answers: data.map((d) => ({ name: undot(name), type, ttl: null, data: String(d) })) };
  } catch (e) {
    if (e.code === 'ENOTFOUND') return { ok: true, rcode: 'NXDOMAIN', nxdomain: true, ad: false, provider: 'system', answers: [] };
    if (e.code === 'ENODATA') return { ok: true, rcode: 'NOERROR', nxdomain: false, ad: false, provider: 'system', answers: [] };
    return { ok: false, rcode: null, nxdomain: false, ad: false, answers: [], error: `DoH failed (${dohError}); system: ${e.code || e.message}` };
  }
}

/** "10 mx1.example.com." -> { priority: 10, exchange: 'mx1.example.com' } */
export const parseMx = (d) => { const [p, ...rest] = String(d).split(/\s+/); return { priority: Number(p), exchange: undot(rest.join(' ')) }; };

/** "0 issue \"letsencrypt.org\"" -> { flags: 0, tag: 'issue', value: 'letsencrypt.org' } */
export function parseCaa(d) {
  const m = /^(\d+)\s+(\S+)\s+"?([^"]*)"?\s*$/.exec(String(d).trim());
  return m ? { flags: Number(m[1]), tag: m[2].toLowerCase(), value: m[3].trim() } : { flags: 0, tag: '', value: String(d) };
}

/** "ns1.x. hostmaster.x. 2024010101 7200 3600 1209600 300" -> { mname, rname, serial, refresh, retry, expire, minimum } */
export function parseSoa(d) {
  const [mname, rname, serial, refresh, retry, expire, minimum] = String(d).trim().split(/\s+/);
  return { mname: undot(mname), rname: undot(rname), serial: Number(serial), refresh: Number(refresh), retry: Number(retry), expire: Number(expire), minimum: Number(minimum) };
}

/** The registrable domain, good enough for the common cases (two-label public suffixes like co.uk). */
export function apexOf(host) {
  const labels = undot(host).split('.');
  if (labels.length <= 2) return labels.join('.');
  const two = labels.slice(-2).join('.');
  const SECOND_LEVEL = /^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/;
  return SECOND_LEVEL.test(two) ? labels.slice(-3).join('.') : two;
}
