// TLS per endpoint: one handshake per host and IP address, so a stale certificate on one
// load-balancer node or on IPv6 shows up. All handshakes are ordinary client hellos.
import tls from 'node:tls';
import crypto from 'node:crypto';

/**
 * handshake({ host, ip, port, timeout, minVersion, maxVersion, ciphers, connect })
 *   -> { ok, protocol, alpn, authorized, authorizationError, ocsp, chain: [cert], error? }
 */
export function handshake({ host, ip, port = 443, timeout = 8000, minVersion, maxVersion, ciphers, connect = tls.connect } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let ocsp = null;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch { /* closed */ } resolve(v); };
    const opts = { host: ip || host, port, servername: host, rejectUnauthorized: false, ALPNProtocols: ['h2', 'http/1.1'], requestOCSP: true };
    if (minVersion) opts.minVersion = minVersion;
    if (maxVersion) opts.maxVersion = maxVersion;
    if (ciphers) opts.ciphers = ciphers;
    let sock;
    try { sock = connect(opts); } catch (e) { resolve({ ok: false, error: e.code || e.message }); return; }
    const timer = setTimeout(() => finish({ ok: false, error: `timeout after ${timeout / 1000}s` }), timeout);
    sock.on('OCSPResponse', (r) => { ocsp = r && r.length ? r.length : 0; });
    sock.once('secureConnect', () => {
      const chain = [];
      let c = sock.getPeerCertificate(true);
      const seen = new Set();
      while (c && c.raw && !seen.has(c.fingerprint256)) {
        seen.add(c.fingerprint256);
        chain.push(certInfo(c));
        c = c.issuerCertificate;
      }
      finish({ ok: true, protocol: sock.getProtocol(), alpn: sock.alpnProtocol || null, authorized: sock.authorized, authorizationError: sock.authorizationError ? String(sock.authorizationError) : null, ocsp: Boolean(ocsp), chain });
    });
    sock.once('error', (e) => finish({ ok: false, error: e.code || e.message }));
  });
}

/** The fields a report needs from a Node peer certificate. */
export function certInfo(c) {
  let keyType = c.asn1Curve ? 'EC' : (c.bits ? 'RSA' : null);
  let signature = null;
  try {
    const x = new crypto.X509Certificate(c.raw);
    keyType = x.publicKey.asymmetricKeyType?.toUpperCase() || keyType;
    signature = sigAlg(c.raw);
  } catch { /* old Node or odd cert */ }
  return {
    subject: c.subject?.CN || null,
    issuer: c.issuer?.O || c.issuer?.CN || null,
    issuerCN: c.issuer?.CN || null,
    san: String(c.subjectaltname || '').split(/,\s*/).filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4).toLowerCase()),
    validFrom: c.valid_from ? new Date(c.valid_from).toISOString() : null,
    validTo: c.valid_to ? new Date(c.valid_to).toISOString() : null,
    serial: c.serialNumber || null,
    fingerprint: c.fingerprint256 || null,
    keyType,
    bits: c.bits || null,
    curve: c.asn1Curve || null,
    signature,
    selfSigned: Boolean(c.issuer && c.subject && JSON.stringify(c.issuer) === JSON.stringify(c.subject)),
  };
}

// signatureAlgorithm OIDs as DER bytes: enough to tell SHA-1 from SHA-256+ without an ASN.1 parser.
const SIG_OIDS = [
  ['sha1WithRSA', '2a864886f70d010105'], ['sha256WithRSA', '2a864886f70d01010b'], ['sha384WithRSA', '2a864886f70d01010c'],
  ['sha512WithRSA', '2a864886f70d01010d'], ['ecdsaWithSHA256', '2a8648ce3d040302'], ['ecdsaWithSHA384', '2a8648ce3d040303'],
  ['ecdsaWithSHA1', '2a8648ce3d0401'], ['rsassaPss', '2a864886f70d01010a'], ['ed25519', '2b6570'],
];
function sigAlg(raw) {
  const hex = Buffer.from(raw).toString('hex');
  // The outer signatureAlgorithm follows the TBSCertificate; the last OID match in the DER is it.
  let best = null;
  let at = -1;
  for (const [name, oid] of SIG_OIDS) {
    const i = hex.lastIndexOf(`06${(oid.length / 2).toString(16).padStart(2, '0')}${oid}`);
    if (i > at) { at = i; best = name; }
  }
  return best;
}

/** Does `name` match a SAN entry (one-label wildcards only)? */
export function sanCovers(san, name) {
  const n = String(name).toLowerCase();
  return san.some((s) => s === n || (s.startsWith('*.') && n.split('.').slice(1).join('.') === s.slice(2)));
}

export const daysLeft = (iso, now = new Date()) => (iso ? Math.floor((new Date(iso) - now) / 86400000) : null);

/** Which CAA issuer values allow a certificate from this CA (by issuer O / CN). */
const CA_DOMAINS = [
  [/let'?s encrypt|^r\d+$|^e\d+$/i, ['letsencrypt.org']],
  [/google trust services|^wr\d|^we\d|^gts/i, ['pki.goog', 'google.com']],
  [/digicert|geotrust|rapidssl|thawte/i, ['digicert.com', 'symantec.com', 'geotrust.com', 'rapidssl.com', 'thawte.com']],
  [/sectigo|comodo|zerossl|usertrust/i, ['sectigo.com', 'comodoca.com', 'usertrust.com', 'trust-provider.com', 'zerossl.com']],
  [/globalsign/i, ['globalsign.com']],
  [/amazon/i, ['amazon.com', 'amazontrust.com', 'awstrust.com', 'amazonaws.com']],
  [/microsoft|azure/i, ['microsoft.com', 'digicert.com']],
  [/cloudflare/i, ['digicert.com', 'letsencrypt.org', 'pki.goog', 'sectigo.com', 'comodoca.com', 'ssl.com']],
  [/ssl\.com/i, ['ssl.com']],
  [/entrust/i, ['entrust.net', 'affirmtrust.com']],
  [/buypass/i, ['buypass.com', 'buypass.no']],
  [/harica/i, ['harica.gr']],
];

/** caaAllows(caaRecords, issuer) -> { allowed: true|false|null, allowedCas } (null: no issue tags or unknown CA). */
export function caaAllows(caa, issuer) {
  const issue = caa.filter((r) => r.tag === 'issue' || r.tag === 'issuewild').map((r) => r.value.split(';')[0].trim().toLowerCase()).filter(Boolean);
  if (!issue.length) return { allowed: null, allowedCas: [] };
  const hit = CA_DOMAINS.find(([re]) => re.test(issuer || ''));
  if (!hit) return { allowed: null, allowedCas: issue };
  return { allowed: hit[1].some((d) => issue.includes(d)), allowedCas: issue };
}
