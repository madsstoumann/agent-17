// DNS over HTTPS in wire format (RFC 8484), so the same code can ask an ordinary resolver and the
// filtering ones (Quad9, Cloudflare for Families security) over port 443, which works on networks
// where port 53 or 5053 is blocked. Also Team Cymru's DNS service for the hosting network (ASN).

export const TYPES = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };
const NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
const RCODES = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'];

export const RESOLVERS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  // Filtering resolvers: they refuse names on their threat feeds.
  quad9: 'https://dns.quad9.net/dns-query', // blocked -> NXDOMAIN with no authority
  quad9Unfiltered: 'https://dns10.quad9.net/dns-query',
  cloudflareSecurity: 'https://security.cloudflare-dns.com/dns-query', // blocked -> 0.0.0.0
};

/** A DNS query message for name/type, recursion desired. */
export function buildQuery(name, type = 'A', id = 0) {
  const qtype = typeof type === 'number' ? type : TYPES[type];
  if (!qtype) throw new Error(`unsupported type ${type}`);
  const labels = String(name).replace(/\.$/, '').split('.').map((l) => Buffer.from(l, 'ascii'));
  const len = 12 + labels.reduce((n, l) => n + l.length + 1, 0) + 1 + 4;
  const b = Buffer.alloc(len);
  b.writeUInt16BE(id, 0);
  b.writeUInt16BE(0x0100, 2); // RD
  b.writeUInt16BE(1, 4);
  let o = 12;
  for (const l of labels) { b[o++] = l.length; l.copy(b, o); o += l.length; }
  b[o++] = 0;
  b.writeUInt16BE(qtype, o); b.writeUInt16BE(1, o + 2);
  return b;
}

function readName(buf, offset) {
  const labels = [];
  let o = offset; let jumped = false; let end = offset; let guard = 0;
  while (guard++ < 128) {
    const len = buf[o];
    if (len === undefined) throw new Error('truncated name');
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) end = o + 2;
      o = ((len & 0x3f) << 8) | buf[o + 1];
      jumped = true;
      continue;
    }
    if (len === 0) { if (!jumped) end = o + 1; break; }
    labels.push(buf.toString('latin1', o + 1, o + 1 + len));
    o += len + 1;
  }
  return { name: labels.join('.').toLowerCase(), end };
}

/** Parse a DNS response -> { rcode, answers: [{ name, type, ttl, data }], authority: n } */
export function parseResponse(buf) {
  buf = Buffer.from(buf);
  if (buf.length < 12) throw new Error('short DNS response');
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4); const an = buf.readUInt16BE(6); const ns = buf.readUInt16BE(8);
  let o = 12;
  for (let i = 0; i < qd; i++) o = readName(buf, o).end + 4;
  const answers = [];
  for (let i = 0; i < an; i++) {
    const { name, end } = readName(buf, o);
    const type = buf.readUInt16BE(end); const ttl = buf.readUInt32BE(end + 4); const rdlen = buf.readUInt16BE(end + 8);
    const rd = end + 10;
    let data;
    const t = NAMES[type] || String(type);
    if (t === 'A') data = [...buf.subarray(rd, rd + 4)].join('.');
    else if (t === 'AAAA') data = [...Array(8)].map((_, k) => buf.readUInt16BE(rd + k * 2).toString(16)).join(':');
    else if (t === 'CNAME' || t === 'NS') data = readName(buf, rd).name;
    else if (t === 'MX') data = `${buf.readUInt16BE(rd)} ${readName(buf, rd + 2).name}`;
    else if (t === 'TXT') {
      const parts = []; let p = rd;
      while (p < rd + rdlen) { const l = buf[p]; parts.push(buf.toString('utf8', p + 1, p + 1 + l)); p += l + 1; }
      data = parts.join('');
    } else data = buf.subarray(rd, rd + rdlen).toString('hex');
    answers.push({ name, type: t, ttl, data });
    o = rd + rdlen;
  }
  return { rcode: RCODES[flags & 0xf] || `RCODE ${flags & 0xf}`, answers, authority: ns };
}

/** createResolver({ fetch }) -> { query(name, type, resolver = 'cloudflare'), records(name, type) } */
export function createResolver({ fetch: fetchImpl = globalThis.fetch, timeout = 8000 } = {}) {
  const cache = new Map();
  async function ask(resolver, name, type) {
    const q = buildQuery(name, type).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetchImpl(`${RESOLVERS[resolver]}?dns=${q}`, { headers: { accept: 'application/dns-message' }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`${resolver} HTTP ${res.status}`);
    return { ...parseResponse(Buffer.from(await res.arrayBuffer())), resolver };
  }
  function query(name, type = 'A', resolver = 'cloudflare') {
    const key = `${resolver} ${name} ${type}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        try { return await ask(resolver, name, type); } catch (e) {
          if (resolver !== 'cloudflare') return { rcode: 'ERROR', answers: [], error: e.cause?.code || e.message, resolver };
          try { return await ask('google', name, type); } catch (e2) { return { rcode: 'ERROR', answers: [], error: `${e.cause?.code || e.message}; google: ${e2.cause?.code || e2.message}`, resolver }; }
        }
      })());
    }
    return cache.get(key);
  }
  async function records(name, type) {
    const r = await query(name, type);
    return r.answers.filter((a) => a.type === type).map((a) => a.data);
  }
  return { query, records };
}

/**
 * protectiveDns(host) -> { ok, blockedBy: [names], checked: [names], resolves, notes }
 * Quad9 refuses names on its threat feeds with NXDOMAIN while its unfiltered twin resolves them;
 * Cloudflare's security resolver answers 0.0.0.0. A name that does not exist anywhere is not "blocked".
 */
export async function protectiveDns(host, resolver) {
  const [plain, q9, q9u, cfs] = await Promise.all([
    resolver.query(host, 'A', 'cloudflare'),
    resolver.query(host, 'A', 'quad9'),
    resolver.query(host, 'A', 'quad9Unfiltered'),
    resolver.query(host, 'A', 'cloudflareSecurity'),
  ]);
  const hasA = (r) => r.answers.some((a) => a.type === 'A');
  const checked = []; const blockedBy = []; const errors = [];
  if (q9.rcode !== 'ERROR' && q9u.rcode !== 'ERROR') {
    checked.push('Quad9');
    if (q9.rcode === 'NXDOMAIN' && hasA(q9u)) blockedBy.push('Quad9');
  } else errors.push(`Quad9: ${q9.error || q9u.error}`);
  if (cfs.rcode !== 'ERROR') {
    checked.push('Cloudflare Security DNS');
    if (cfs.answers.some((a) => a.type === 'A' && a.data === '0.0.0.0') && !plain.answers.some((a) => a.data === '0.0.0.0')) blockedBy.push('Cloudflare Security DNS');
  } else errors.push(`Cloudflare Security DNS: ${cfs.error}`);
  return { ok: checked.length > 0, checked, blockedBy, resolves: hasA(plain) || hasA(q9u), nxdomain: plain.rcode === 'NXDOMAIN', errors };
}

/** asnOf(ip) -> { asn, prefix, country, name } via Team Cymru (origin.asn.cymru.com TXT). */
export async function asnOf(ip, resolver) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const rev = ip.split('.').reverse().join('.');
  const [origin] = await resolver.records(`${rev}.origin.asn.cymru.com`, 'TXT');
  if (!origin) return null;
  const [asn, prefix, country] = origin.split('|').map((s) => s.trim());
  const firstAsn = asn.split(' ')[0];
  const [info] = await resolver.records(`AS${firstAsn}.asn.cymru.com`, 'TXT');
  const name = info ? info.split('|').pop().trim() : null;
  return { asn: Number(firstAsn), prefix, country, name };
}
