#!/usr/bin/env node
// is-website-safe: is this the real site, a copy of a famous one, or a fake shop?
// Usage: node check.mjs <url or domain> [--brand <domain or name>] [--no-page] [--json]
// Prints a short summary (or the full JSON with --json). Read-only: GETs and DNS lookups only.
import { parseTarget, scriptsOf, registrableOf } from './lib/target.mjs';
import { BRANDS, officialBrand, lookalikes, lureWords, brandsNamed } from './lib/brands.mjs';
import { createResolver, protectiveDns, asnOf } from './lib/dns.mjs';
import { rdap, whoisLookup, crtSh, wayback, tranco, openPhish, urlscan, safeBrowsing, virusTotal, urlhaus, trustpilot, wikidataOfficialSite } from './lib/sources.mjs';
import { fetchChain, analyzePage, faviconHash, brandFaviconHash, cloaking } from './lib/page.mjs';
import { judge, decide } from './lib/verdict.mjs';

const log = (m) => process.stderr.write(`${m}\n`);

export function parseArgs(argv) {
  const a = { brand: null, page: true, json: false, input: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--brand') a.brand = argv[++i];
    else if (v.startsWith('--brand=')) a.brand = v.slice(8);
    else if (v === '--no-page') a.page = false;
    else if (v === '--json') a.json = true;
    else if (v === '-h' || v === '--help') a.help = true;
    else if (v.startsWith('--')) throw new Error(`unknown flag ${v}`);
    else if (!a.input) a.input = v;
    else throw new Error(`unexpected argument ${v}`);
  }
  return a;
}

/** --brand: a listed brand by name or domain, a domain the user says is the real one, or a name looked up on Wikidata. */
export async function resolveBrand(value, deps = {}) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const listed = BRANDS.find((b) => b.name.toLowerCase() === v || b.labels.includes(v) || b.domains.includes(v.replace(/^www\./, '')));
  if (listed) return { brand: listed, source: 'list' };
  if (/\.[a-z]{2,}$/.test(v)) {
    const domain = registrableOf(v.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, ''));
    return { brand: { name: domain, domains: [domain], labels: [domain.split('.')[0]] }, source: 'user' };
  }
  const wd = await (deps.wikidata || wikidataOfficialSite)(value, deps);
  if (wd.ok && wd.sites.length) {
    const domains = [...new Set(wd.sites.map(registrableOf))];
    return { brand: { name: wd.label || value, domains, labels: [...new Set(domains.map((d) => d.split('.')[0]))] }, source: 'wikidata' };
  }
  return { brand: null, source: 'unknown', error: wd.error || `no official website found for "${value}"` };
}

export async function run(args, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const env = deps.env || process.env;
  const now = deps.now || new Date();
  const resolver = deps.resolver || createResolver({ fetch: f });
  const target = parseTarget(args.input);
  const extra = await resolveBrand(args.brand, { fetch: f, wikidata: deps.wikidata });
  const brands = extra?.brand && !BRANDS.includes(extra.brand) ? [extra.brand, ...BRANDS] : BRANDS;
  const skipped = [];

  // 1. The page first: where the link really lands decides what the domain checks look at.
  let pageRaw = null;
  if (args.page) {
    log(`Loading ${target.url}`);
    pageRaw = await fetchChain(target.url, { fetch: f });
    if (!pageRaw.ok && !/^https?:\/\//i.test(target.input)) {
      const http = await fetchChain(target.url.replace(/^https:/, 'http:'), { fetch: f });
      if (http.ok) pageRaw = { ...http, httpOnly: true };
    }
  }
  let landing = null;
  if (pageRaw?.ok) {
    try { const l = parseTarget(pageRaw.final); if (l.host !== target.host) landing = l; } catch { /* stay on target */ }
  }
  const main = landing && landing.domain !== target.domain ? landing : target;
  const shared = Boolean(main.sharedHost || main.sharedPage);

  // 2. Everything else in parallel.
  log('Checking registration, certificates, blocklists and reviews');
  const hosts = [...new Set([target.host, landing?.host].filter(Boolean))];
  const optional = (p) => p.then((r) => { if (r.skipped) skipped.push(r.skipped); return r; });
  const [protective, openphish, registration, ct, wb, rank, scans, gsb, vt, uh, tp, ip] = await Promise.all([
    Promise.all(hosts.map((h) => protectiveDns(h, resolver))).then((rs) => ({ ok: rs.some((r) => r.ok), checked: [...new Set(rs.flatMap((r) => r.checked))], blockedBy: [...new Set(rs.flatMap((r) => r.blockedBy))], resolves: rs[0].resolves, nxdomain: rs[0].nxdomain, errors: rs.flatMap((r) => r.errors) })),
    Promise.all([target, landing].filter(Boolean).map((t) => (deps.openPhish || openPhish)(t, { fetch: f }))).then((rs) => ({ ok: rs.some((r) => r.ok), hits: rs.flatMap((r) => r.hits || []), error: rs.find((r) => !r.ok)?.error })),
    shared || main.ip ? Promise.resolve(null) : rdap(main.domain, { fetch: f, now }).then(async (r) => (r.ok && r.created ? r : { ...(await whoisLookup(main.domain, { now, exec: deps.exec, ...(deps.whoisQuery ? { query: deps.whoisQuery } : {}) })), rdapError: r.error, status: r.status || [] })),
    shared || main.ip ? Promise.resolve(null) : crtSh(main.domain, { fetch: f, now }),
    wayback(shared ? main.host : main.domain, { fetch: f, now }),
    shared || main.ip ? Promise.resolve(null) : tranco(main.domain, { fetch: f }),
    urlscan(main, { fetch: f, env }),
    optional(safeBrowsing(main, { fetch: f, env })),
    optional(virusTotal(main, { fetch: f, env })),
    optional(urlhaus(main, { fetch: f, env })),
    main.ip ? Promise.resolve(null) : trustpilot(shared ? main.host : main.domain, { fetch: f }),
    resolver.records(main.host, 'A').then((a) => (a[0] ? asnOf(a[0], resolver) : null)).catch(() => null),
  ]);

  // 3. The page's claims, and whether it wears another brand's clothes.
  let page = null; let pageBrands = []; let brandAssets = {}; let faviconMatch = null; let cloak = null;
  if (pageRaw?.ok && pageRaw.html) {
    page = { ok: true, status: pageRaw.status, final: pageRaw.final, chain: pageRaw.chain, httpOnly: Boolean(pageRaw.httpOnly), ...analyzePage(pageRaw.html, pageRaw.final) };
    pageBrands = brandsNamed(`${page.title} | ${page.siteName || ''}`, brands).filter((b) => !b.domains.some((d) => main.domain === d || main.host.endsWith(`.${d}`)));
    for (const b of brands) {
      const n = b.domains.reduce((sum, d) => sum + (page.resourceHosts[registrableOf(d)] || 0), 0);
      if (n) brandAssets[b.name] = n;
    }
    const suspects = [...new Map([...lookalikes(main, brands).map((l) => brands.find((b) => b.name === l.brand)), ...pageBrands, extra?.brand].filter(Boolean).map((b) => [b.name, b])).values()].slice(0, 3);
    if (suspects.length) {
      const own = await faviconHash(page.favicon, { fetch: f });
      if (own) {
        for (const b of suspects) {
          if (b.domains.includes(main.domain)) continue;
          if ((await brandFaviconHash(b.domains[0], { fetch: f })) === own) { faviconMatch = b.name; break; }
        }
      }
    }
    cloak = await cloaking(target.url, pageRaw, { fetch: f });
  } else if (pageRaw) {
    page = { ok: false, error: pageRaw.error || `HTTP ${pageRaw.status}`, chain: pageRaw.chain };
  }

  const official = officialBrand(main, brands);
  const looks = official?.how === 'listed' ? [] : lookalikes(main, brands);
  const looksFromLink = landing && landing.domain !== target.domain ? lookalikes(target, brands).filter((l) => !looks.some((m) => m.brand === l.brand)) : [];
  const facts = {
    now: now.toISOString(), target, landing: main === target ? null : main,
    official, lookalikes: [...looks, ...looksFromLink], lures: lureWords(main), scripts: main.punycode ? scriptsOf(main.unicodeHost.split('.')[0]) : [],
    registration, ct, wayback: wb, tranco: rank, protective, openphish, safeBrowsing: gsb, virusTotal: vt, urlhaus: uh, urlscan: scans,
    page, pageBrands, brandAssets, faviconMatch, cloaking: cloak, trustpilot: tp, trustpilotDomain: shared ? main.host : main.domain, asn: ip,
    expectedBrand: extra ? { name: extra.brand?.name || args.brand, domains: extra.brand?.domains || [], source: extra.source, error: extra.error } : null,
  };
  if (extra?.brand && !official && extra.brand.domains.length && !extra.brand.domains.includes(main.domain)) {
    facts.notExpected = `you expected ${extra.brand.name} (${extra.brand.domains.join(', ')}), but this is ${main.domain}`;
  }
  const result = judge(facts);
  if (facts.notExpected) {
    result.signals.unshift({ id: 'brand.expected', level: 'danger', title: `Not ${extra.brand.name}'s site`, evidence: facts.notExpected, weight: 50 });
    Object.assign(result, decide(result.signals));
  }
  const unavailable = [
    registration && !registration.ok && `registration (${registration.rdapError || registration.error})`,
    ct && !ct.ok && `certificate history (${ct.error})`,
    !wb.ok && `Wayback Machine (${wb.error})`,
    rank && !rank.ok && `Tranco (${rank.error})`,
    !openphish.ok && `OpenPhish (${openphish.error})`,
    !protective.ok && `filtering DNS (${protective.errors.join('; ')})`,
    !scans.ok && `urlscan.io (${scans.error})`,
    tp && !tp.ok && `Trustpilot (${tp.error}; open ${tp.url} instead)`,
    gsb.error && `Google Safe Browsing (${gsb.error})`,
    vt.error && `VirusTotal (${vt.error})`,
    uh.error && `URLhaus (${uh.error})`,
    extra?.error && `brand lookup (${extra.error})`,
  ].filter(Boolean);
  return { tool: 'is-website-safe', version: '2.0.1', checkedAt: now.toISOString(), input: args.input, ...result, facts, unavailable, keysMissing: skipped };
}

const MARK = { danger: '✖', warn: '!', good: '✓', info: '·' };

export function summary(r) {
  const f = r.facts;
  const main = f.landing || f.target;
  const out = [`${main.host}${f.landing ? ` (reached from ${f.target.host})` : ''}`, `Verdict: ${r.label} (score ${r.score}/100)`, ''];
  for (const s of r.signals) out.push(`${MARK[s.level]} ${s.title}: ${s.evidence}`);
  out.push('');
  const facts = [];
  if (f.registration?.created) facts.push(`Registered ${f.registration.created.slice(0, 10)}${f.registration.registrar ? ` at ${f.registration.registrar}` : ''}${f.registration.expires ? `, expires ${f.registration.expires.slice(0, 10)}` : ''}`);
  if (f.ct?.firstSeen) facts.push(`First certificate ${f.ct.firstSeen.slice(0, 10)} (${f.ct.certs} logged)`);
  if (f.wayback?.firstSnapshot) facts.push(`Archived since ${f.wayback.firstSnapshot.slice(0, 10)}`);
  if (f.urlscan?.ok) facts.push(`urlscan.io: ${f.urlscan.total} public scans`);
  if (f.page?.ok) facts.push(`Page: "${f.page.title || 'no title'}"${f.page.chain.length > 1 ? `, ${f.page.chain.length - 1} redirect(s)` : ''}${f.page.httpOnly ? ', HTTP only (no HTTPS)' : ''}${f.page.shop ? ', webshop' : ''}${f.page.password ? ', password field' : ''}${f.page.card ? ', card fields' : ''}`);
  if (f.trustpilot?.ok) facts.push(f.trustpilot.found ? `Trustpilot: ${f.trustpilot.rating}/5 (${f.trustpilot.reviews} reviews) ${f.trustpilot.url}` : `Trustpilot: no page at ${f.trustpilot.url}`);
  if (facts.length) out.push('Facts', ...facts.map((x) => `  ${x}`), '');
  if (r.unavailable.length) out.push('Not available this run', ...r.unavailable.map((x) => `  ${x}`), '');
  if (r.keysMissing.length) out.push(`Optional lookups skipped: ${r.keysMissing.join(', ')}`);
  return out.join('\n').trimEnd();
}

const HELP = `Usage: node check.mjs <url or domain> [--brand <domain or name>] [--no-page] [--json]

  --brand    the site the user expects ("paypal.com", "PostNord"); flags anything else as not theirs
  --no-page  skip loading the page (registration, DNS and blocklists only)
  --json     print every fact as JSON instead of the summary

Optional keys (environment): GOOGLE_SAFE_BROWSING_KEY, VIRUSTOTAL_API_KEY, URLSCAN_API_KEY, URLHAUS_AUTH_KEY`;

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check.mjs');
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.input) { console.log(HELP); process.exit(args.help ? 0 : 2); }
    const r = await run(args);
    console.log(args.json ? JSON.stringify(r, null, 2) : summary(r));
  } catch (e) {
    console.error(`is-website-safe: ${e.message}`);
    process.exit(1);
  }
}
