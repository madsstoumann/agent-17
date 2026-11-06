// Public, read-only lookups: RDAP (domain registration) and crt.sh / Cert Spotter (Certificate Transparency);
// hstspreload.org is in hsts-preload.mjs. Each returns { ok, ... } or { ok: false, error } and never throws.

async function getJson(fetchImpl, url, timeout) {
  // rdap.org answers 403 to clients without a user agent.
  const res = await fetchImpl(url, { headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'Mozilla/5.0 (compatible; audit-infra)' }, signal: AbortSignal.timeout(timeout) });
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

/**
 * crtSh(domain) -> { ok, source, names: [unique DNS names, wildcards kept], issuers: { name: count }, certs,
 *   serials: Set, fingerprints: Set, partial? } (unexpired only).
 * crt.sh is often overloaded (502/timeouts): two tries a few seconds apart, then Cert Spotter's free
 * API (sslmate.com, no key, unexpired issuances only) as the second source.
 */
export async function crtSh(domain, { fetch: fetchImpl = globalThis.fetch, timeout = 30000, now = new Date(), pause = 3000 } = {}) {
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt && pause) await new Promise((r) => setTimeout(r, pause));
    try {
      const rows = await getJson(fetchImpl, `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired`, timeout);
      return { ok: true, source: 'crt.sh', fingerprints: new Set(), ...parseCrtSh(rows, domain, now) };
    } catch (e) {
      error = e.cause?.code || e.message;
    }
  }
  const spot = await certSpotter(domain, { fetch: fetchImpl, timeout, now });
  if (spot.ok) return { ...spot, fallbackFrom: `crt.sh ${error}` };
  return { ok: false, error: `crt.sh: ${error}; Cert Spotter: ${spot.error}` };
}

/** Cert Spotter issuances for the domain and its subdomains, up to `pages` pages (about 100 certs each). */
export async function certSpotter(domain, { fetch: fetchImpl = globalThis.fetch, timeout = 30000, now = new Date(), pages = 5 } = {}) {
  const rows = [];
  let after = null;
  let partial = false;
  try {
    for (let i = 0; i < pages; i++) {
      const page = await getJson(fetchImpl, `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names&expand=issuer${after ? `&after=${after}` : ''}`, timeout);
      if (!Array.isArray(page) || !page.length) break;
      rows.push(...page);
      after = page[page.length - 1].id;
      if (i === pages - 1) partial = true;
    }
  } catch (e) {
    if (!rows.length) return { ok: false, error: e.cause?.code || e.message };
    partial = true;
  }
  return { ok: true, source: 'Cert Spotter', partial, ...parseCertSpotter(rows, domain, now) };
}

export function parseCertSpotter(rows, domain, now = new Date()) {
  const names = new Set();
  const issuers = {};
  const fingerprints = new Set();
  let certs = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.not_after && new Date(r.not_after) < now) continue;
    certs++;
    if (r.cert_sha256) fingerprints.add(normSerial(r.cert_sha256));
    const issuer = /O=([^,]+)/.exec(r.issuer?.name || '')?.[1]?.replace(/^"|"$/g, '') || r.issuer?.friendly_name || 'unknown';
    issuers[issuer] = (issuers[issuer] || 0) + 1;
    for (const n of r.dns_names || []) {
      const name = String(n).trim().toLowerCase();
      if (name && (name === domain || name.endsWith(`.${domain}`))) names.add(name);
    }
  }
  return { names: [...names].sort(), issuers, certs, serials: new Set(), fingerprints };
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

