// Public, read-only lookups: RDAP (domain registration), crt.sh (Certificate Transparency) and
// hstspreload.org. Each returns { ok, ... } or { ok: false, error } and never throws.

async function getJson(fetchImpl, url, timeout) {
  // rdap.org answers 403 to clients without a user agent.
  const res = await fetchImpl(url, { headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'Mozilla/5.0 (compatible; infra-audit)' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

/** rdap(domain) -> { ok, expires, created, updated, registrar, status: [], nameservers: [], source } */
export async function rdap(domain, { fetch: fetchImpl = globalThis.fetch, timeout = 15000 } = {}) {
  try {
    const j = await getJson(fetchImpl, `https://rdap.org/domain/${encodeURIComponent(domain)}`, timeout);
    return { ok: true, ...parseRdap(j) };
  } catch (e) {
    return { ok: false, error: e.status === 404 ? 'the registry publishes no RDAP data for this domain' : (e.cause?.code || e.message) };
  }
}

export function parseRdap(j) {
  const ev = (name) => (j.events || []).find((e) => e.eventAction === name)?.eventDate || null;
  const reg = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const vcardName = reg?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] || null;
  return {
    expires: ev('expiration'),
    created: ev('registration'),
    updated: ev('last changed'),
    registrar: vcardName || reg?.publicIds?.[0]?.identifier || null,
    status: (j.status || []).map((s) => s.toLowerCase()),
    nameservers: (j.nameservers || []).map((n) => String(n.ldhName || '').toLowerCase()).filter(Boolean),
    dnssec: j.secureDNS ? Boolean(j.secureDNS.delegationSigned) : null,
  };
}

/** crtSh(domain) -> { ok, names: [unique DNS names, wildcards kept], issuers: { name: count }, certs, serials: Set } (unexpired only). */
export async function crtSh(domain, { fetch: fetchImpl = globalThis.fetch, timeout = 30000, now = new Date() } = {}) {
  // crt.sh is often overloaded: one retry.
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rows = await getJson(fetchImpl, `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired`, timeout);
      return { ok: true, ...parseCrtSh(rows, domain, now) };
    } catch (e) {
      error = e.cause?.code || e.message;
    }
  }
  return { ok: false, error };
}

export function parseCrtSh(rows, domain, now = new Date()) {
  const names = new Set();
  const issuers = {};
  const serials = new Set();
  let certs = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.not_after && new Date(`${r.not_after}Z`) < now) continue;
    certs++;
    if (r.serial_number) serials.add(normSerial(r.serial_number));
    const issuer = /O=([^,]+)/.exec(r.issuer_name || '')?.[1]?.replace(/^"|"$/g, '') || r.issuer_name || 'unknown';
    issuers[issuer] = (issuers[issuer] || 0) + 1;
    for (const n of String(r.name_value || '').split(/\n/)) {
      const name = n.trim().toLowerCase();
      if (name && (name === domain || name.endsWith(`.${domain}`)) && !name.includes('@')) names.add(name);
    }
  }
  return { names: [...names].sort(), issuers, certs, serials };
}

export const normSerial = (s) => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '').replace(/^0+/, '');

/** hstspreload.org status: 'preloaded' | 'pending' | 'unknown' | 'rejected' … */
export async function preloadStatus(domain, { fetch: fetchImpl = globalThis.fetch, timeout = 15000 } = {}) {
  try {
    const j = await getJson(fetchImpl, `https://hstspreload.org/api/v2/status?domain=${encodeURIComponent(domain)}`, timeout);
    return { ok: true, status: j.status || 'unknown', includeSubDomains: j.include_subdomains ?? null };
  } catch (e) {
    return { ok: false, error: e.cause?.code || e.message };
  }
}
