// Public lookups. Each returns { ok: true, ... } or { ok: false, error } (or { ok: false, skipped })
// and never throws, so one slow or blocked service never stops the check.
//
// Keyless: RDAP, crt.sh, Wayback Machine, Tranco, OpenPhish, urlscan.io search, Trustpilot page.
// With a key from the environment (all optional, all free tiers):
//   GOOGLE_SAFE_BROWSING_KEY (or GSB_API_KEY)   Google Safe Browsing Lookup API v4
//   VIRUSTOTAL_API_KEY (or VT_API_KEY)          VirusTotal domain report
//   URLSCAN_API_KEY                             urlscan.io search with a higher quota
//   URLHAUS_AUTH_KEY (or ABUSE_CH_AUTH_KEY)     abuse.ch URLhaus host lookup

const UA = 'Mozilla/5.0 (compatible; is-website-safe/2.0; +https://github.com/madsstoumann/agent-17)';

async function get(fetchImpl, url, { timeout = 15000, headers = {}, method = 'GET', body } = {}) {
  const res = await fetchImpl(url, { method, body, headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res;
}
const why = (e) => e.cause?.code || e.message;
const days = (from, now) => (from ? Math.floor((now - new Date(from)) / 86400000) : null);

// ---------------------------------------------------------------- Registration

/** rdap(domain) -> { ok, created, expires, updated, registrar, status, ageDays, abuse } */
export async function rdap(domain, { fetch: f = globalThis.fetch, now = new Date() } = {}) {
  try {
    const j = await (await get(f, `https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: 'application/rdap+json, application/json' } })).json();
    const r = parseRdap(j);
    return { ok: true, ...r, ageDays: days(r.created, now) };
  } catch (e) {
    return { ok: false, error: e.status === 404 ? 'the registry publishes no RDAP data for this TLD (ask whois)' : why(e) };
  }
}

export function parseRdap(j) {
  const ev = (name) => (j.events || []).find((e) => e.eventAction === name)?.eventDate || null;
  const reg = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const vcard = (ent, field) => ent?.vcardArray?.[1]?.find((v) => v[0] === field)?.[3] || null;
  const abuse = (reg?.entities || []).find((e) => (e.roles || []).includes('abuse'));
  return {
    created: ev('registration'),
    expires: ev('expiration'),
    updated: ev('last changed'),
    registrar: vcard(reg, 'fn') || reg?.publicIds?.[0]?.identifier || null,
    status: (j.status || []).map((s) => s.toLowerCase()),
    abuse: vcard(abuse, 'email') || null,
  };
}

/** Creation date from `whois` output, for TLDs without RDAP (.dk answers "Registered: 1998-01-21"). */
export function whoisCreated(text) {
  const m = String(text || '').match(/^\s*(?:Creation Date|Created(?: On)?|Registered(?: on)?|Registration Time|created|Domain Registration Date|Record created)\s*[:.]+\s*(.+)$/im);
  if (!m) return null;
  const d = new Date(m[1].trim().replace(/^(\d{2})\.(\d{2})\.(\d{4})/, '$3-$2-$1'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Ask a whois server on port 43 (no `whois` binary needed). */
export function whoisQuery(server, query, { timeout = 12000, connect } = {}) {
  return new Promise(async (resolve, reject) => {
    const net = connect ? { connect } : await import('node:net');
    let data = '';
    const sock = net.connect({ host: server, port: 43 });
    sock.setTimeout(timeout, () => { sock.destroy(); reject(new Error(`${server} timed out`)); });
    sock.on('connect', () => sock.write(`${query}\r\n`));
    sock.on('data', (d) => { data += d.toString('utf8'); });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

const WHOIS_SERVERS = { dk: 'whois.punktum.dk', se: 'whois.iis.se', nu: 'whois.iis.nu', no: 'whois.norid.no', de: 'whois.denic.de', eu: 'whois.eu', fi: 'whois.fi', uk: 'whois.nic.uk', nl: 'whois.domain-registry.nl' };

/** Creation date for TLDs without RDAP: port-43 whois (IANA referral for unknown TLDs), then the `whois` binary. */
export async function whoisLookup(domain, { now = new Date(), exec, query = whoisQuery } = {}) {
  const tld = domain.split('.').pop();
  const errors = [];
  try {
    let server = WHOIS_SERVERS[tld];
    if (!server) server = (/^refer:\s*(\S+)/im.exec(await query('whois.iana.org', tld)) || [])[1];
    if (server) {
      const created = whoisCreated(await query(server, domain));
      if (created) return { ok: true, created, ageDays: days(created, now), source: `whois ${server}` };
      errors.push(`${server} gave no creation date`);
    }
  } catch (e) { errors.push(why(e)); }
  try {
    const run = exec || (async (cmd, args) => {
      const { execFile } = await import('node:child_process');
      return new Promise((res, rej) => execFile(cmd, args, { timeout: 20000 }, (err, out) => (err && !out ? rej(err) : res(out))));
    });
    const created = whoisCreated(await run('whois', [domain]));
    if (created) return { ok: true, created, ageDays: days(created, now), source: 'whois' };
    errors.push('whois gave no creation date');
  } catch (e) { errors.push(e.code === 'ENOENT' ? 'whois is not installed' : why(e)); }
  return { ok: false, error: errors.join('; ') };
}

// ---------------------------------------------------------------- History

/** crtSh(domain) -> { ok, firstSeen, certs, firstDays, recentNames } from every logged certificate (expired too). */
export async function crtSh(domain, { fetch: f = globalThis.fetch, now = new Date() } = {}) {
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rows = await (await get(f, `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, { timeout: 30000 })).json();
      return { ok: true, ...parseCrtSh(rows, now) };
    } catch (e) { error = why(e); }
  }
  return { ok: false, error: `${error} (crt.sh is often overloaded)` };
}

export function parseCrtSh(rows, now = new Date()) {
  let first = null; let certs = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    certs++;
    const nb = r.not_before ? new Date(`${r.not_before}Z`) : null;
    if (nb && (!first || nb < first)) first = nb;
  }
  return { certs, firstSeen: first ? first.toISOString() : null, firstDays: first ? days(first, now) : null };
}

/** wayback(host) -> { ok, firstSnapshot, firstDays } (the earliest archived copy). */
export async function wayback(host, { fetch: f = globalThis.fetch, now = new Date() } = {}) {
  try {
    const j = await (await get(f, `https://archive.org/wayback/available?url=${encodeURIComponent(host)}&timestamp=1996`)).json();
    const ts = j?.archived_snapshots?.closest?.timestamp;
    if (!ts) return { ok: true, firstSnapshot: null, firstDays: null };
    const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T00:00:00Z`;
    return { ok: true, firstSnapshot: iso, firstDays: days(iso, now) };
  } catch (e) { return { ok: false, error: why(e) }; }
}

/** tranco(domain) -> { ok, rank } (best rank in the latest Tranco list, null when not in the top million). */
export async function tranco(domain, { fetch: f = globalThis.fetch } = {}) {
  try {
    const j = await (await get(f, `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`)).json();
    const ranks = (j?.ranks || []).map((r) => r.rank).filter(Number.isFinite);
    return { ok: true, rank: ranks.length ? ranks.sort((a, b) => a - b)[0] : null, latest: j?.ranks?.[0]?.rank ?? null };
  } catch (e) { return { ok: false, error: why(e) }; }
}

// ---------------------------------------------------------------- Blocklists

/** openPhish(target) -> { ok, hits: [urls] } from the free community feed (refreshed every 12 hours). */
export async function openPhish(t, { fetch: f = globalThis.fetch } = {}) {
  try {
    const text = await (await get(f, 'https://openphish.com/feed.txt', { headers: { accept: 'text/plain' } })).text();
    return { ok: true, hits: matchFeed(text, t) };
  } catch (e) { return { ok: false, error: why(e) }; }
}

export function matchFeed(text, t) {
  const hits = [];
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let h;
    try { h = new URL(s).hostname.toLowerCase(); } catch { continue; }
    // Same host, or the same registrable domain when the target is not on a shared host.
    if (h === t.host || h === t.bareHost || h === `www.${t.bareHost}` || (!t.sharedHost && !t.sharedPage && (h === t.domain || h.endsWith(`.${t.domain}`)))) hits.push(s);
  }
  return hits.slice(0, 10);
}

/** urlscan(domain) -> { ok, total, malicious, first, latest } from public scans (key optional). */
export async function urlscan(t, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const key = env.URLSCAN_API_KEY;
  const q = t.sharedHost || t.sharedPage ? `page.domain:"${t.host}"` : `page.domain:"${t.domain}" OR domain:"${t.domain}"`;
  try {
    const j = await (await get(f, `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(q)}&size=50`, { headers: key ? { 'API-Key': key } : {} })).json();
    const res = j?.results || [];
    const times = res.map((r) => r.task?.time).filter(Boolean).sort();
    const malicious = res.filter((r) => r.verdicts?.malicious || r.verdicts?.overall?.malicious).length;
    return { ok: true, total: j?.total ?? res.length, malicious, first: times[0] || null, latest: times.at(-1) || null, link: `https://urlscan.io/search/#${encodeURIComponent(q)}` };
  } catch (e) { return { ok: false, error: why(e) }; }
}

/** safeBrowsing(url) -> { ok, threats: [types] } — needs GOOGLE_SAFE_BROWSING_KEY. */
export async function safeBrowsing(t, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const key = env.GOOGLE_SAFE_BROWSING_KEY || env.GSB_API_KEY;
  if (!key) return { ok: false, skipped: 'no GOOGLE_SAFE_BROWSING_KEY' };
  const urls = [...new Set([t.url, `https://${t.host}/`, `http://${t.host}/`])];
  const body = JSON.stringify({
    client: { clientId: 'is-website-safe', clientVersion: '2.0.0' },
    threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: urls.map((url) => ({ url })) },
  });
  try {
    const j = await (await get(f, `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })).json();
    return { ok: true, threats: [...new Set((j.matches || []).map((m) => m.threatType))] };
  } catch (e) { return { ok: false, error: why(e) }; }
}

/** virusTotal(domain) -> { ok, malicious, suspicious, harmless, engines: [names], reputation } — needs VIRUSTOTAL_API_KEY. */
export async function virusTotal(t, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const key = env.VIRUSTOTAL_API_KEY || env.VT_API_KEY;
  if (!key) return { ok: false, skipped: 'no VIRUSTOTAL_API_KEY' };
  const name = t.sharedHost || t.sharedPage ? t.host : t.domain;
  try {
    const j = await (await get(f, `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(name)}`, { headers: { 'x-apikey': key } })).json();
    const a = j?.data?.attributes || {};
    const stats = a.last_analysis_stats || {};
    const engines = Object.entries(a.last_analysis_results || {}).filter(([, v]) => ['malicious', 'suspicious'].includes(v.category)).map(([k, v]) => `${k}: ${v.result}`);
    return { ok: true, malicious: stats.malicious || 0, suspicious: stats.suspicious || 0, harmless: stats.harmless || 0, engines: engines.slice(0, 8), reputation: a.reputation ?? null, link: `https://www.virustotal.com/gui/domain/${name}` };
  } catch (e) { return { ok: false, error: e.status === 404 ? 'VirusTotal has no report for this domain' : why(e) }; }
}

/** urlhaus(host) -> { ok, listed, online, urls, tags } — needs URLHAUS_AUTH_KEY (free at auth.abuse.ch). */
export async function urlhaus(t, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const key = env.URLHAUS_AUTH_KEY || env.ABUSE_CH_AUTH_KEY;
  if (!key) return { ok: false, skipped: 'no URLHAUS_AUTH_KEY' };
  try {
    const j = await (await get(f, 'https://urlhaus-api.abuse.ch/v1/host/', { method: 'POST', body: new URLSearchParams({ host: t.host }), headers: { 'Auth-Key': key, 'content-type': 'application/x-www-form-urlencoded' } })).json();
    if (j.query_status === 'no_results') return { ok: true, listed: false };
    if (j.query_status !== 'ok') return { ok: false, error: j.query_status };
    const urls = j.urls || [];
    return { ok: true, listed: true, online: urls.filter((u) => u.url_status === 'online').length, urls: urls.length, tags: [...new Set(urls.flatMap((u) => u.tags || []))].slice(0, 8), link: j.urlhaus_reference };
  } catch (e) { return { ok: false, error: why(e) }; }
}

// ---------------------------------------------------------------- Reviews

/**
 * trustpilot(domain) -> { ok, found, name, rating, reviews, url, claimed } for the exact domain's page.
 * Trustpilot often answers 403 to scripts; Claude then opens the same URL with WebFetch.
 */
export async function trustpilot(domain, { fetch: f = globalThis.fetch } = {}) {
  const url = `https://www.trustpilot.com/review/${domain}`;
  try {
    const res = await f(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return { ok: true, found: false, url };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url };
    const html = await res.text();
    const finalDomain = new URL(res.url || url).pathname.split('/').pop();
    return { ok: true, url, ...parseTrustpilot(html), redirectedTo: finalDomain && finalDomain !== domain ? finalDomain : null };
  } catch (e) { return { ok: false, error: why(e), url }; }
}

export function parseTrustpilot(html) {
  const blocks = [...String(html).matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
  const all = blocks.flatMap((b) => (Array.isArray(b['@graph']) ? b['@graph'] : [b]));
  const org = all.find((n) => n.aggregateRating) || null;
  if (!org) return { found: false };
  return {
    found: true,
    name: org.name || null,
    rating: Number(org.aggregateRating.ratingValue) || null,
    reviews: Number(org.aggregateRating.reviewCount) || 0,
  };
}

// ---------------------------------------------------------------- Official site of a brand not in the list

/** wikidataOfficialSite(name) -> { ok, label, sites: [registrable hosts] } from Wikidata P856. */
export async function wikidataOfficialSite(name, { fetch: f = globalThis.fetch } = {}) {
  try {
    const s = await (await get(f, `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=1&format=json`)).json();
    const id = s?.search?.[0]?.id;
    if (!id) return { ok: true, label: null, sites: [] };
    const e = await (await get(f, `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`)).json();
    const claims = e?.entities?.[id]?.claims?.P856 || [];
    const sites = claims.map((c) => c.mainsnak?.datavalue?.value).filter(Boolean).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean);
    return { ok: true, id, label: s.search[0].label, sites: [...new Set(sites)] };
  } catch (e) { return { ok: false, error: why(e) }; }
}
