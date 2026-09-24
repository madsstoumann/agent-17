import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  tlsInfo, certSummary, doh, parseDohAnswer, dnsRecords, dnssecStatus,
  evaluateSpf, evaluateDmarc, dkimProbe, hstsPreloadEligibility,
} from '../lib/net.mjs';

// ---------------------------------------------------------------- certSummary

const info = {
  ok: true, authorized: true, authorizationError: null, protocol: 'TLSv1.3', alpn: 'h2',
  cipher: { name: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
  cert: {
    subject: { CN: 'example.com' }, issuer: { C: 'US', O: "Let's Encrypt", CN: 'R11' },
    validFrom: 'Sep  8 09:58:27 2026 GMT', validTo: 'Dec  7 09:58:27 2026 GMT',
    subjectAltName: 'DNS:example.com, DNS:*.example.com', serialNumber: '04AB', fingerprint256: 'AA:BB',
  },
  chain: [
    { subject: { CN: 'example.com' }, issuer: { CN: 'R11' }, validTo: 'Dec  7 09:58:27 2026 GMT' },
    { subject: { CN: 'R11' }, issuer: { CN: 'ISRG Root X1' }, validTo: 'Mar 12 23:59:59 2027 GMT' },
    { subject: { CN: 'ISRG Root X1' }, issuer: { CN: 'ISRG Root X1' }, validTo: 'Jun  4 11:04:38 2035 GMT' },
  ],
};
const sep24 = new Date('2026-09-24T00:00:00Z');

test('certSummary: a healthy certificate', () => {
  const s = certSummary(info, { host: 'example.com', altHost: 'www.example.com', now: sep24 });
  assert.equal(s.issuer, "Let's Encrypt");
  assert.equal(s.validTo, '2026-12-07T09:58:27.000Z');
  assert.equal(s.daysLeft, 74);
  assert.deepEqual(s.sans, ['example.com', '*.example.com']);
  assert.equal(s.coversHost, true);
  assert.equal(s.coversAlt, true, 'the wildcard covers www');
  assert.equal(s.wildcard, true);
  assert.equal(s.chainLength, 3);
  assert.equal(s.status, 'pass');
  assert.match(s.text, /Let's Encrypt/);
  assert.match(s.text, /74 days/);
});

test('certSummary: wildcard matches exactly one label; no altHost means coversAlt null', () => {
  assert.equal(certSummary(info, { host: 'deep.a.example.com', now: sep24 }).coversHost, false);
  assert.equal(certSummary(info, { host: 'a.example.com', now: sep24 }).coversHost, true);
  assert.equal(certSummary(info, { host: 'EXAMPLE.COM', now: sep24 }).coversHost, true, 'case-insensitive');
  assert.equal(certSummary(info, { host: 'example.com', now: sep24 }).coversAlt, null);
  const wrong = certSummary(info, { host: 'other.org', now: sep24 });
  assert.equal(wrong.coversHost, false);
  assert.equal(wrong.status, 'fail');
  assert.match(wrong.text, /does not cover other\.org/);
});

test('certSummary: expiry thresholds', () => {
  assert.equal(certSummary(info, { host: 'example.com', now: new Date('2026-11-20T00:00:00Z') }).status, 'warn', '17 days');
  assert.equal(certSummary(info, { host: 'example.com', now: new Date('2026-11-30T00:00:00Z') }).status, 'fail', '7 days');
  const expired = certSummary(info, { host: 'example.com', now: new Date('2026-12-10T00:00:00Z') });
  assert.equal(expired.status, 'fail');
  assert.ok(expired.daysLeft < 0);
  assert.match(expired.text, /expired/i);
});

test('certSummary: an unauthorized chain fails and names the reason; an unreachable host fails with its error', () => {
  const selfSigned = { ...info, authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
  const s = certSummary(selfSigned, { host: 'example.com', now: sep24 });
  assert.equal(s.status, 'fail');
  assert.match(s.text, /DEPTH_ZERO_SELF_SIGNED_CERT/);
  const down = certSummary({ ok: false, error: 'ECONNREFUSED: connect' }, { host: 'example.com', altHost: 'www.example.com', now: sep24 });
  assert.equal(down.status, 'fail');
  assert.equal(down.daysLeft, null);
  assert.deepEqual(down.sans, []);
  assert.equal(down.coversAlt, false);
  assert.match(down.text, /ECONNREFUSED/);
});

test('certSummary: no SAN falls back to the subject CN; altHost not covered is a warning', () => {
  const cnOnly = { ...info, cert: { ...info.cert, subjectAltName: undefined, subject: { CN: 'example.com' } } };
  const s = certSummary(cnOnly, { host: 'example.com', altHost: 'www.example.com', now: sep24 });
  assert.deepEqual(s.sans, []);
  assert.equal(s.coversHost, true);
  assert.equal(s.coversAlt, false);
  assert.equal(s.wildcard, false);
  assert.equal(s.status, 'warn');
  assert.match(s.text, /www\.example\.com/);
});

// ---------------------------------------------------------------- tlsInfo (fake tls.connect)

function certChain() {
  const root = { subject: { CN: 'ISRG Root X1' }, issuer: { CN: 'ISRG Root X1' }, valid_from: 'Jun  4 11:04:38 2015 GMT', valid_to: 'Jun  4 11:04:38 2035 GMT' };
  root.issuerCertificate = root;
  const inter = { subject: { CN: 'R11' }, issuer: { CN: 'ISRG Root X1' }, valid_from: 'Mar 13 00:00:00 2024 GMT', valid_to: 'Mar 12 23:59:59 2027 GMT', issuerCertificate: root };
  return {
    subject: { CN: 'example.com' }, issuer: { O: "Let's Encrypt", CN: 'R11' }, valid_from: 'Sep  8 09:58:27 2026 GMT', valid_to: 'Dec  7 09:58:27 2026 GMT',
    subjectaltname: 'DNS:example.com, DNS:www.example.com', serialNumber: '04AB', fingerprint256: 'AA:BB', issuerCertificate: inter,
  };
}

function fakeConnect({ cert = certChain(), authorized = true, authorizationError, error, hang = false } = {}) {
  const seen = { opts: null };
  const connect = (opts, cb) => {
    seen.opts = opts;
    const s = new EventEmitter();
    Object.assign(s, {
      authorized, authorizationError, alpnProtocol: 'h2',
      getPeerCertificate: () => cert, getProtocol: () => 'TLSv1.3', getCipher: () => ({ name: 'TLS_AES_128_GCM_SHA256', version: 'TLSv1.3' }),
      destroy() { s.destroyed = true; }, end() {}, setTimeout() {}, setNoDelay() {},
    });
    if (error) setImmediate(() => s.emit('error', error));
    else if (!hang) setImmediate(cb);
    return s;
  };
  return { connect, seen };
}

test('tlsInfo: reads the certificate, walks the chain to the self-signed root and reports negotiation', async () => {
  const { connect, seen } = fakeConnect();
  const r = await tlsInfo('example.com', { connect });
  assert.equal(r.ok, true);
  assert.equal(r.authorized, true);
  assert.equal(r.authorizationError, null);
  assert.equal(r.protocol, 'TLSv1.3');
  assert.equal(r.alpn, 'h2');
  assert.deepEqual(r.cipher, { name: 'TLS_AES_128_GCM_SHA256', version: 'TLSv1.3' });
  assert.equal(r.cert.subjectAltName, 'DNS:example.com, DNS:www.example.com');
  assert.equal(r.cert.validTo, 'Dec  7 09:58:27 2026 GMT');
  assert.equal(r.cert.validFrom, 'Sep  8 09:58:27 2026 GMT');
  assert.equal(r.cert.serialNumber, '04AB');
  assert.equal(r.cert.fingerprint256, 'AA:BB');
  assert.deepEqual(r.cert.issuer, { O: "Let's Encrypt", CN: 'R11' });
  assert.equal(r.chain.length, 3);
  assert.deepEqual(r.chain.map((c) => c.subject.CN), ['example.com', 'R11', 'ISRG Root X1']);
  assert.equal(r.chain[2].validTo, 'Jun  4 11:04:38 2035 GMT');
  assert.equal(seen.opts.servername, 'example.com');
  assert.equal(seen.opts.port, 443);
  assert.equal(seen.opts.rejectUnauthorized, false);
  assert.deepEqual(seen.opts.ALPNProtocols, ['h2', 'http/1.1']);
});

test('tlsInfo: an unauthorized chain is still read; errors and timeouts are results', async () => {
  const bad = fakeConnect({ authorized: false, authorizationError: 'CERT_HAS_EXPIRED' });
  const r = await tlsInfo('example.com', { port: 8443, connect: bad.connect });
  assert.equal(r.ok, true);
  assert.equal(r.authorized, false);
  assert.equal(r.authorizationError, 'CERT_HAS_EXPIRED');
  assert.equal(bad.seen.opts.port, 8443);

  const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
  const down = await tlsInfo('example.com', { connect: fakeConnect({ error: err }).connect });
  assert.equal(down.ok, false);
  assert.match(down.error, /ECONNREFUSED/);

  const slow = await tlsInfo('example.com', { timeout: 30, connect: fakeConnect({ hang: true }).connect });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /timeout|timed out/i);

  const throwing = await tlsInfo('example.com', { connect: () => { throw new Error('boom'); } });
  assert.equal(throwing.ok, false);
  assert.match(throwing.error, /boom/);
});

// ---------------------------------------------------------------- DoH

const cfTxt = {
  Status: 0, TC: false, RD: true, RA: true, AD: true, CD: false,
  Question: [{ name: 'example.com', type: 16 }],
  Answer: [
    { name: 'example.com', type: 16, TTL: 300, data: '"v=spf1 include:_spf.google.com ~all"' },
    { name: 'example.com', type: 16, TTL: 300, data: '"google-site-verification=abc" "def"' },
    { name: 'example.com', type: 16, TTL: 300, data: '"say \\"hi\\""' },
  ],
};

test('parseDohAnswer: unquotes and joins TXT chunks, maps types, strips trailing dots, reads AD', () => {
  const r = parseDohAnswer(cfTxt);
  assert.equal(r.ok, true);
  assert.equal(r.status, 0);
  assert.equal(r.ad, true);
  assert.equal(r.answers.length, 3);
  assert.deepEqual(r.answers[0], { name: 'example.com', type: 'TXT', ttl: 300, data: 'v=spf1 include:_spf.google.com ~all' });
  assert.equal(r.answers[1].data, 'google-site-verification=abcdef', 'several quoted strings back to back are one record');
  assert.equal(r.answers[2].data, 'say "hi"');

  const google = parseDohAnswer({ Status: 0, AD: false, Answer: [{ name: '_dmarc.example.com.', type: 16, TTL: 300, data: 'v=DMARC1; p=reject' }, { name: 'example.com.', type: 15, TTL: 35, data: '10 smtp.example.com.' }] });
  assert.equal(google.answers[0].name, '_dmarc.example.com');
  assert.equal(google.answers[0].data, 'v=DMARC1; p=reject', 'bare data is left alone');
  assert.equal(google.answers[1].type, 'MX');
  assert.equal(parseDohAnswer({ Status: 0, Answer: [{ name: 'x', type: 65000, TTL: 1, data: '' }] }).answers[0].type, 65000, 'an unknown type keeps its number');
});

test('parseDohAnswer: NXDOMAIN is a complete answer, SERVFAIL is not, garbage is not', () => {
  const nx = parseDohAnswer({ Status: 3, AD: true, Authority: [{ name: '', type: 6, TTL: 86400, data: 'a.root-servers.net. ...' }] });
  assert.equal(nx.ok, true);
  assert.equal(nx.status, 3);
  assert.deepEqual(nx.answers, []);
  const sf = parseDohAnswer({ Status: 2, AD: false });
  assert.equal(sf.ok, false);
  assert.equal(sf.status, 2);
  assert.match(sf.error, /SERVFAIL/);
  assert.equal(parseDohAnswer(null).ok, false);
  assert.equal(parseDohAnswer({ hello: 1 }).ok, false);
});

function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { fetch, calls };
}
const jsonResponse = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });

test('doh: builds the provider URL and headers, parses the answer, never throws', async () => {
  const cf = fakeFetch(() => jsonResponse(200, cfTxt));
  const r = await doh('example.com', 'TXT', { fetch: cf.fetch });
  assert.equal(cf.calls[0].url, 'https://cloudflare-dns.com/dns-query?name=example.com&type=TXT');
  assert.equal(cf.calls[0].init.headers.accept, 'application/dns-json');
  assert.ok(cf.calls[0].init.signal, 'an abort signal carries the timeout');
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'cloudflare');
  assert.equal(r.answers[0].data, 'v=spf1 include:_spf.google.com ~all');

  const g = fakeFetch(() => jsonResponse(200, { Status: 0, AD: false, Answer: [] }));
  const rg = await doh('example.com', 'A', { provider: 'google', fetch: g.fetch });
  assert.equal(g.calls[0].url, 'https://dns.google/resolve?name=example.com&type=A');
  assert.equal(rg.provider, 'google');
  assert.deepEqual(rg.answers, []);

  const http503 = await doh('example.com', 'A', { fetch: fakeFetch(() => jsonResponse(503, {})).fetch });
  assert.equal(http503.ok, false);
  assert.match(http503.error, /503/);
  const boom = await doh('example.com', 'A', { fetch: fakeFetch(() => { throw new TypeError('fetch failed'); }).fetch });
  assert.equal(boom.ok, false);
  assert.match(boom.error, /fetch failed/);
  assert.deepEqual(boom.answers, []);
  const notJson = await doh('example.com', 'A', { fetch: fakeFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })).fetch });
  assert.equal(notJson.ok, false);
});

// ---------------------------------------------------------------- dnsRecords

const dnsErr = (code) => Object.assign(new Error(`query failed: ${code}`), { code });

function fakeResolver(impl) {
  const base = {
    resolve4: async () => { throw dnsErr('ENODATA'); },
    resolve6: async () => { throw dnsErr('ENODATA'); },
    resolveNs: async () => { throw dnsErr('ENODATA'); },
    resolveCaa: async () => { throw dnsErr('ENODATA'); },
    resolveMx: async () => { throw dnsErr('ENODATA'); },
    resolveTxt: async () => { throw dnsErr('ENODATA'); },
  };
  return { ...base, ...impl };
}

test('dnsRecords: every type in parallel, Node shapes normalised, ENODATA/ENOTFOUND are empty lists', async () => {
  const resolver = fakeResolver({
    resolve4: async () => ['93.184.215.14'],
    resolve6: async () => { throw dnsErr('ENOTFOUND'); },
    resolveNs: async () => ['a.iana-servers.net', 'b.iana-servers.net'],
    // the shapes Node 22+ really returns: a `type` key beside the payload
    resolveCaa: async () => [{ critical: 0, type: 'CAA', issue: 'letsencrypt.org' }, { critical: 128, type: 'CAA', iodef: 'mailto:sec@example.com' }],
    resolveMx: async () => [{ exchange: 'mx2.example.com', priority: 20, type: 'MX' }, { exchange: 'mx1.example.com', priority: 10, type: 'MX' }],
    resolveTxt: async () => [['v=spf1 ', '-all'], ['google-site-verification=abc']],
  });
  const r = await dnsRecords('example.com', { resolver });
  assert.deepEqual(r.a, ['93.184.215.14']);
  assert.deepEqual(r.aaaa, []);
  assert.deepEqual(r.ns, ['a.iana-servers.net', 'b.iana-servers.net']);
  assert.deepEqual(r.caa, [{ flags: 0, tag: 'issue', value: 'letsencrypt.org' }, { flags: 128, tag: 'iodef', value: 'mailto:sec@example.com' }]);
  assert.deepEqual(r.mx, [{ exchange: 'mx1.example.com', priority: 10 }, { exchange: 'mx2.example.com', priority: 20 }], 'sorted by priority');
  assert.deepEqual(r.txt, ['v=spf1 -all', 'google-site-verification=abc'], 'chunks joined');
  assert.deepEqual(r.errors, {});
});

test('dnsRecords: SERVFAIL/timeout/refused fall back to DoH for that type; other errors are recorded', async () => {
  const dohCalls = [];
  const dohImpl = async (name, type) => {
    dohCalls.push(type);
    if (type === 'TXT') return { ok: true, status: 0, ad: false, answers: [{ name, type: 'TXT', ttl: 1, data: 'v=spf1 -all' }, { name, type: 'CNAME', ttl: 1, data: 'ignored.' }], provider: 'cloudflare' };
    if (type === 'MX') return { ok: true, status: 0, ad: false, answers: [{ name, type: 'MX', ttl: 1, data: '10 mail.example.com.' }], provider: 'cloudflare' };
    if (type === 'CAA') return { ok: true, status: 0, ad: false, answers: [{ name, type: 'CAA', ttl: 1, data: '0 issue "letsencrypt.org"' }], provider: 'cloudflare' };
    if (type === 'NS') return { ok: true, status: 0, ad: false, answers: [{ name, type: 'NS', ttl: 1, data: 'ns1.example.com.' }], provider: 'cloudflare' };
    return { ok: false, status: null, ad: false, answers: [], provider: 'cloudflare', error: 'HTTP 503' };
  };
  const resolver = fakeResolver({
    resolveTxt: async () => { throw dnsErr('ESERVFAIL'); },
    resolveMx: async () => { throw dnsErr('ETIMEOUT'); },
    resolveCaa: async () => { throw dnsErr('ECONNREFUSED'); },
    resolveNs: async () => { throw dnsErr('EREFUSED'); },
    resolve6: async () => { throw dnsErr('ETIMEOUT'); },
    resolve4: async () => { throw dnsErr('EBADRESP'); },
  });
  const r = await dnsRecords('example.com', { resolver, doh: dohImpl });
  assert.deepEqual(r.txt, ['v=spf1 -all'], 'only the asked-for type is taken from a DoH answer');
  assert.deepEqual(r.mx, [{ exchange: 'mail.example.com', priority: 10 }]);
  assert.deepEqual(r.caa, [{ flags: 0, tag: 'issue', value: 'letsencrypt.org' }]);
  assert.deepEqual(r.ns, ['ns1.example.com']);
  assert.deepEqual(r.aaaa, []);
  assert.match(r.errors.aaaa, /ETIMEOUT/, 'the local error is kept when DoH fails too');
  assert.match(r.errors.aaaa, /503/);
  assert.match(r.errors.a, /EBADRESP/, 'not a fallback code: recorded, DoH not asked');
  assert.deepEqual(r.a, []);
  assert.ok(!dohCalls.includes('A'));
  assert.deepEqual(dohCalls.sort(), ['AAAA', 'CAA', 'MX', 'NS', 'TXT']);
});

// ---------------------------------------------------------------- dnssecStatus

test('dnssecStatus: the AD flag from Cloudflare, Google as fallback, null when neither answers', async () => {
  const ok = async () => ({ ok: true, status: 0, ad: true, answers: [], provider: 'cloudflare' });
  assert.deepEqual(await dnssecStatus('example.com', { doh: ok }), { validated: true, provider: 'cloudflare' });

  const calls = [];
  const cfDown = async (name, type, { provider }) => {
    calls.push(provider);
    if (provider === 'cloudflare') return { ok: false, status: null, ad: false, answers: [], provider, error: 'timeout' };
    return { ok: true, status: 0, ad: false, answers: [], provider };
  };
  assert.deepEqual(await dnssecStatus('example.com', { doh: cfDown }), { validated: false, provider: 'google' });
  assert.deepEqual(calls, ['cloudflare', 'google']);

  const allDown = async (name, type, { provider }) => ({ ok: false, status: 2, ad: false, answers: [], provider, error: 'SERVFAIL' });
  const r = await dnssecStatus('example.com', { doh: allDown });
  assert.equal(r.validated, null);
  assert.equal(r.provider, 'google');
  assert.match(r.error, /SERVFAIL/);
});

// ---------------------------------------------------------------- SPF

test('evaluateSpf: none, one, several', () => {
  const none = evaluateSpf([]);
  assert.equal(none.status, 'info');
  assert.equal(none.count, 0);
  assert.equal(none.terminal, null);
  assert.match(none.fix, /v=spf1 -all/);
  assert.equal(evaluateSpf(['google-site-verification=abc'], { hasMx: true }).status, 'warn', 'mail is received, so mail is probably sent');

  const one = evaluateSpf(['google-site-verification=abc', 'v=spf1 include:_spf.google.com ~all']);
  assert.equal(one.status, 'pass');
  assert.equal(one.count, 1);
  assert.deepEqual(one.records, ['v=spf1 include:_spf.google.com ~all']);
  assert.equal(one.terminal, '~all');
  assert.equal(one.lookups, 1);
  assert.match(one.text, /~all/);

  const two = evaluateSpf(['v=spf1 -all', 'v=spf1 include:x.com -all']);
  assert.equal(two.status, 'fail');
  assert.equal(two.count, 2);
  assert.match(two.text, /2 SPF records/);
});

test('evaluateSpf: terminal qualifiers and lookup counting', () => {
  assert.equal(evaluateSpf(['v=spf1 -all']).status, 'pass');
  assert.equal(evaluateSpf(['V=SPF1 -ALL']).terminal, '-all', 'case-insensitive');
  const soft = evaluateSpf(['v=spf1 a mx include:x.com ?all']);
  assert.equal(soft.status, 'warn');
  assert.equal(soft.terminal, '?all');
  assert.equal(soft.lookups, 3);
  assert.equal(evaluateSpf(['v=spf1 +all']).status, 'warn');
  assert.equal(evaluateSpf(['v=spf1 all']).terminal, '+all', 'no qualifier means +');
  const open = evaluateSpf(['v=spf1 include:x.com']);
  assert.equal(open.status, 'warn');
  assert.equal(open.terminal, null);
  const redirect = evaluateSpf(['v=spf1 redirect=_spf.example.com']);
  assert.equal(redirect.status, 'pass', 'redirect= is a valid terminal');
  assert.equal(redirect.lookups, 1);
  const lookups = evaluateSpf(['v=spf1 a:h.example.com mx/24 ptr exists:%{i}.x.com include:a include:b include:c include:d include:e include:f include:g -all']);
  assert.equal(lookups.lookups, 11);
  assert.equal(lookups.status, 'warn');
  assert.match(lookups.text, /11 .*lookups/);
  assert.match(lookups.fix, /10/);
  assert.equal(evaluateSpf(['v=spf1 ip4:1.2.3.0/24 ip6:2001:db8::/32 -all']).lookups, 0, 'ip4/ip6 cost nothing');
});

// ---------------------------------------------------------------- DMARC

test('evaluateDmarc: missing, none, quarantine/reject, several, invalid', () => {
  const missing = evaluateDmarc([]);
  assert.equal(missing.status, 'warn');
  assert.equal(missing.record, null);
  assert.equal(missing.policy, null);
  assert.deepEqual(missing.rua, []);
  assert.equal(evaluateDmarc(['unrelated'], { hasMx: true }).status, 'fail');
  assert.match(missing.fix, /p=reject|p=quarantine/);

  const none = evaluateDmarc(['v=DMARC1; p=none; rua=mailto:dmarc@example.com']);
  assert.equal(none.status, 'warn');
  assert.equal(none.policy, 'none');
  assert.equal(none.subdomainPolicy, 'none', 'sp defaults to p');
  assert.deepEqual(none.rua, ['mailto:dmarc@example.com']);
  assert.equal(none.pct, 100);
  assert.equal(none.record, 'v=DMARC1; p=none; rua=mailto:dmarc@example.com');

  const reject = evaluateDmarc(['v=DMARC1; p=reject; sp=quarantine; pct=50; rua=mailto:a@x.com, mailto:b@y.com']);
  assert.equal(reject.status, 'pass');
  assert.equal(reject.policy, 'reject');
  assert.equal(reject.subdomainPolicy, 'quarantine');
  assert.equal(reject.pct, 50);
  assert.deepEqual(reject.rua, ['mailto:a@x.com', 'mailto:b@y.com']);
  assert.match(reject.text, /pct=50/);

  const q = evaluateDmarc(['V=DMARC1;P=QUARANTINE']);
  assert.equal(q.status, 'pass');
  assert.equal(q.policy, 'quarantine');
  assert.deepEqual(q.rua, []);
  assert.match(q.fix, /rua/);

  assert.equal(evaluateDmarc(['v=DMARC1; p=reject', 'v=DMARC1; p=none']).status, 'fail');
  assert.equal(evaluateDmarc(['v=DMARC1']).status, 'fail', 'no p= tag is not a valid record');
});

// ---------------------------------------------------------------- DKIM

test('dkimProbe: TXT at <selector>._domainkey.<domain>, absent selectors ignored, other errors kept', async () => {
  const asked = [];
  const resolver = {
    resolveTxt: async (name) => {
      asked.push(name);
      if (name === 'google._domainkey.example.com') return [['v=DKIM1; k=rsa; p=MIGfMA0GCSq', 'GSIb3DQEBAQUAA4GNADCBiQKBgQ']];
      if (name === 'selector1._domainkey.example.com') throw dnsErr('ESERVFAIL');
      throw dnsErr(name.startsWith('k1.') ? 'ENODATA' : 'ENOTFOUND');
    },
  };
  const r = await dkimProbe('example.com', { resolver });
  assert.deepEqual(r.found, [{ selector: 'google', record: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ' }]);
  assert.equal(asked.length, 9, 'the default selector list');
  assert.ok(asked.includes('selector2._domainkey.example.com'));
  assert.deepEqual(Object.keys(r.errors), ['selector1']);
  const custom = await dkimProbe('example.com', { selectors: ['google'], resolver });
  assert.equal(custom.found.length, 1);
});

// ---------------------------------------------------------------- HSTS preload eligibility

test('hstsPreloadEligibility: the three preload requirements, from a parsed object or a raw header', () => {
  assert.deepEqual(hstsPreloadEligibility({ maxAge: 31536000, includeSubDomains: true, preload: true }), { eligible: true, issues: [] });
  const weak = hstsPreloadEligibility({ maxAge: 300, includeSubDomains: false, preload: false });
  assert.equal(weak.eligible, false);
  assert.equal(weak.issues.length, 3);
  assert.match(weak.issues[0], /max-age/);
  assert.match(weak.issues[1], /includeSubDomains/);
  assert.match(weak.issues[2], /preload/);
  assert.deepEqual(hstsPreloadEligibility('max-age=63072000; includeSubDomains; preload'), { eligible: true, issues: [] });
  assert.match(hstsPreloadEligibility({}).issues[0], /max-age/);
  assert.match(hstsPreloadEligibility('').issues[0], /no strict-transport-security|max-age/i);
});
