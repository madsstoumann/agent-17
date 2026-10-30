// The five check groups. Each takes the run context and returns result rows; scan.mjs runs
// them, turns a crash into one skip row, and writes the report.
import { result, pLimit, settle } from './common.mjs';
import { parseMx, parseCaa, parseSoa, undot } from './dns.mjs';
import { handshake, sanCovers, daysLeft, caaAllows } from './tls.mjs';
import { spfTree, judgeSpf, dmarc, dkim, mtaSts, stsCovers } from './email.mjs';
import { rdap, crtSh, preloadStatus, normSerial } from './services.mjs';

export const SECTIONS = [
  { id: 'domain', title: 'Domain & DNS', prefixes: ['domain', 'dns'] },
  { id: 'email', title: 'Email authentication', prefixes: ['email'] },
  { id: 'tls', title: 'TLS certificates & protocols', prefixes: ['tls'] },
  { id: 'edge', title: 'Edge, HTTP/3 & HSTS preload', prefixes: ['edge', 'hsts'] },
  { id: 'ct', title: 'Subdomains (Certificate Transparency)', prefixes: ['ct'] },
];

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '?');

// ------------------------------------------------------------------ domain & DNS

export async function domainChecks(ctx) {
  const { resolver: r, host, apex } = ctx;
  const out = [];

  const reg = await rdap(apex, { fetch: ctx.fetch });
  if (!reg.ok) {
    out.push(result('domain.registration', 'skip', 'Registration', `RDAP: ${reg.error}`, { fix: `Check the expiry date with the registrar or \`whois ${apex}\`.` }));
  } else {
    const left = daysLeft(reg.expires, ctx.now);
    const locks = reg.status.filter((s) => /transfer ?prohibited|update ?prohibited|delete ?prohibited/.test(s));
    const ev = `${reg.registrar || 'registrar unknown'}; expires ${fmtDate(reg.expires)}${left !== null ? ` (${left} days)` : ''}; status ${reg.status.join(', ') || 'none'}`;
    if (left !== null && left < 30) out.push(result('domain.registration', 'fail', 'Registration expiry', ev, { fix: 'Renew now and turn on auto-renew; an expired domain takes the site and its mail down.', blocker: left < 7 }));
    else if (left !== null && left < 60) out.push(result('domain.registration', 'warn', 'Registration expiry', ev, { fix: 'Renew, or confirm auto-renew is on with a valid card.' }));
    else out.push(result('domain.registration', 'pass', 'Registration expiry', ev));
    if (!reg.status.some((s) => /transfer ?prohibited/.test(s))) out.push(result('domain.transfer-lock', 'warn', 'Transfer lock', `no clientTransferProhibited on ${apex} (${locks.join(', ') || 'no locks'})`, { fix: 'Turn on the registrar lock so the domain cannot be moved away by a hijacked account or a social-engineered support desk.' }));
    else out.push(result('domain.transfer-lock', 'pass', 'Transfer lock', locks.join(', ')));
  }

  const ns = await r.query(apex, 'NS');
  const nsHosts = ns.answers.filter((a) => a.type === 'NS').map((a) => undot(a.data)).sort();
  ctx.shared.ns = nsHosts;
  if (!ns.ok) out.push(result('dns.nameservers', 'skip', 'Name servers', ns.error));
  else if (nsHosts.length < 2) out.push(result('dns.nameservers', 'fail', 'Name servers', `${plural(nsHosts.length, 'name server')}: ${nsHosts.join(', ') || 'none'}`, { fix: 'Use at least two name servers (RFC 1034); one outage otherwise takes the domain offline.' }));
  else {
    const providers = [...new Set(nsHosts.map((n) => n.split('.').slice(-2).join('.')))];
    out.push(result('dns.nameservers', 'pass', 'Name servers', `${nsHosts.join(', ')} (${providers.length === 1 ? `one provider: ${providers[0]}` : `${providers.length} providers`})`));
  }

  const soa = await r.query(apex, 'SOA');
  const soaRec = soa.answers.find((a) => a.type === 'SOA');
  if (soaRec) {
    const s = parseSoa(soaRec.data);
    const notes = [];
    if (s.expire && s.expire < 604800) notes.push(`expire ${s.expire}s is under a week (RFC 1912 suggests 2–4 weeks)`);
    if (s.minimum > 86400) notes.push(`negative-cache TTL ${s.minimum}s: a new record can stay "not found" for over a day`);
    out.push(result('dns.soa', notes.length ? 'warn' : 'info', 'SOA', `primary ${s.mname}, serial ${s.serial}, refresh ${s.refresh}s, retry ${s.retry}s, expire ${s.expire}s, negative TTL ${s.minimum}s${notes.length ? `; ${notes.join('; ')}` : ''}`, { fix: notes.length ? 'Adjust the SOA timers at the DNS provider.' : '' }));
  }

  // DNSSEC: a DS at the parent means the zone claims to be signed; SERVFAIL then means it is broken.
  const [ds, hostA] = await Promise.all([r.query(apex, 'DS'), r.query(host, 'A')]);
  const hasDs = ds.answers.some((a) => a.type === 'DS');
  if (hasDs && !hostA.ok && hostA.rcode === 'SERVFAIL') out.push(result('dns.dnssec', 'fail', 'DNSSEC', `DS published for ${apex} but validating resolvers answer SERVFAIL`, { fix: 'The signing chain is broken (expired signatures or a stale DS). Fix it at the DNS provider or remove the DS at the registrar; validating resolvers cannot reach the site.', blocker: true }));
  else if (hasDs) out.push(result('dns.dnssec', hostA.ad ? 'pass' : 'warn', 'DNSSEC', hostA.ad ? `signed and validating (DS at the parent, AD set on ${host})` : `DS published but ${host} does not validate`, { fix: hostA.ad ? '' : 'Check the zone signing at the DNS provider.' }));
  else out.push(result('dns.dnssec', 'info', 'DNSSEC', `${apex} is not signed (no DS at the parent)`, { fix: 'Optional. Most managed DNS providers sign with one click; the registrar then needs the DS record.' }));

  // The host itself: CNAME chain, addresses, TTL, a dangling alias.
  const [cname, a, aaaa] = await Promise.all([r.query(host, 'CNAME'), Promise.resolve(hostA), r.query(host, 'AAAA')]);
  const alias = cname.answers.find((x) => x.type === 'CNAME' && x.name === host)?.data;
  const v4 = a.answers.filter((x) => x.type === 'A').map((x) => x.data);
  const v6 = aaaa.answers.filter((x) => x.type === 'AAAA').map((x) => x.data);
  ctx.shared.ips = { [host]: { v4, v6 } };
  if (alias && !v4.length && !v6.length) {
    const target = await r.query(undot(alias), 'A');
    out.push(result('dns.dangling', 'fail', 'Dangling CNAME', `${host} is an alias for ${undot(alias)}, which ${target.nxdomain ? 'does not exist (NXDOMAIN)' : 'has no address'}`, { fix: 'Remove the CNAME or recreate the target; whoever claims that name on the service can serve content on your domain.', blocker: true }));
  }
  const ttl = a.answers.find((x) => x.type === 'A')?.ttl;
  out.push(result('dns.addresses', v4.length ? 'info' : 'fail', 'Addresses', `${host}${alias ? ` → ${undot(alias)}` : ''}: ${v4.join(', ') || 'no A record'}${v6.length ? `; IPv6 ${v6.join(', ')}` : '; no IPv6'}${ttl != null ? `; TTL ${ttl}s` : ''}`, { fix: v4.length ? (v6.length ? '' : 'IPv6 is optional; most CDNs add AAAA records with a toggle.') : `Publish an A record for ${host}.`, blocker: !v4.length && !v6.length }));

  // CAA: the closest set to the host wins (RFC 8659 tree climbing).
  let caa = [];
  let caaAt = null;
  for (let name = host; name && name.includes('.'); name = name.split('.').slice(1).join('.')) {
    const c = await r.query(name, 'CAA');
    const recs = c.answers.filter((x) => x.type === 'CAA' && x.name === name).map((x) => parseCaa(x.data));
    if (recs.length) { caa = recs; caaAt = name; break; }
    if (name === apex) break;
  }
  ctx.shared.caa = caa;
  ctx.shared.caaAt = caaAt;
  if (!caa.length) out.push(result('dns.caa', 'warn', 'CAA', `no CAA record on ${host === apex ? apex : `${host} or ${apex}`}: any CA may issue certificates for the domain`, { fix: `Add CAA on ${apex} for the CA you use, e.g. \`0 issue "letsencrypt.org"\`, plus \`0 iodef "mailto:security@${apex}"\`.` }));
  else {
    const iodef = caa.some((c) => c.tag === 'iodef');
    out.push(result('dns.caa', 'pass', 'CAA', `${caaAt}: ${caa.map((c) => `${c.tag} ${c.value}`).join('; ')}${iodef ? '' : '; no iodef contact'}`));
  }
  return out;
}

// ------------------------------------------------------------------ email

export async function emailChecks(ctx) {
  const { resolver: r } = ctx;
  const d = ctx.emailDomain;
  const out = [];
  const mxq = await r.query(d, 'MX');
  const mx = mxq.answers.filter((a) => a.type === 'MX').map((a) => parseMx(a.data)).sort((a, b) => a.priority - b.priority);
  const nullMx = mx.length === 1 && (mx[0].exchange === '' || mx[0].exchange === '.');
  const hasMx = mx.length > 0 && !nullMx;
  if (!mxq.ok) out.push(result('email.mx', 'skip', 'MX', mxq.error));
  else if (nullMx) out.push(result('email.mx', 'pass', 'MX', `null MX (RFC 7505): ${d} accepts no mail`));
  else if (!mx.length) out.push(result('email.mx', 'info', 'MX', `${d} has no MX record`, { fix: 'If the domain never receives mail, publish a null MX (`0 .`) so senders fail fast.' }));
  else {
    const problems = [];
    await Promise.all(mx.map(async (m) => {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(m.exchange)) { problems.push(`${m.exchange} is an IP address, not a host name`); return; }
      const [c, a4, a6] = await Promise.all([r.query(m.exchange, 'CNAME'), r.query(m.exchange, 'A'), r.query(m.exchange, 'AAAA')]);
      if (c.answers.some((x) => x.type === 'CNAME' && x.name === m.exchange)) problems.push(`${m.exchange} is a CNAME (RFC 2181 §10.3)`);
      if (!a4.answers.some((x) => x.type === 'A') && !a6.answers.some((x) => x.type === 'AAAA')) problems.push(`${m.exchange} has no address`);
    }));
    const provider = mailProvider(mx.map((m) => m.exchange));
    out.push(result('email.mx', problems.length ? (problems.some((p) => /no address/.test(p)) ? 'fail' : 'warn') : 'pass', 'MX', `${mx.map((m) => `${m.priority} ${m.exchange}`).join(', ')}${provider ? ` (${provider})` : ''}${problems.length ? `; ${problems.join('; ')}` : ''}`, { fix: problems.length ? 'Point every MX at a host name with an A/AAAA record.' : '' }));
  }
  ctx.shared.mx = mx.map((m) => m.exchange);

  const spf = await spfTree(d, r);
  const sj = judgeSpf(spf, { hasMx });
  out.push(result('email.spf', sj.status, 'SPF', sj.evidence, { fix: sj.fix, data: { includes: spf.includes.map((i) => i.domain) } }));

  const dm = await dmarc(d, r, { hasMx });
  out.push(result('email.dmarc', dm.status, 'DMARC', dm.evidence, { fix: dm.fix || '' }));

  const keys = await dkim(d, r, { selectors: ctx.dkimSelectors });
  if (!keys.length) out.push(result('email.dkim', 'info', 'DKIM', `no key at ${ctx.dkimSelectors.length} common selectors${ctx.customSelectors ? '' : ' (pass --dkim-selector NAME for your provider\'s)'}`, { fix: 'Confirm the mail provider signs with DKIM; the selector is in the DKIM-Signature header (s=) of a sent mail.' }));
  else {
    const weak = keys.filter((k) => k.type === 'rsa' && k.bits && k.bits < 2048);
    const ev = keys.map((k) => `${k.selector} (${k.revoked ? 'revoked' : `${k.type} ${k.bits ?? '?'} bit`})`).join(', ');
    out.push(result('email.dkim', weak.length ? 'warn' : 'pass', 'DKIM', ev, { fix: weak.length ? `Rotate ${weak.map((k) => k.selector).join(', ')} to a 2048-bit key; 1024-bit RSA is below current guidance (RFC 8301 minimum, NIST deprecates it).` : '' }));
  }

  if (hasMx) {
    const sts = await mtaSts(d, r, { fetch: ctx.fetch });
    if (!sts.present) out.push(result('email.mta-sts', 'info', 'MTA-STS', `no _mta-sts.${d} record: senders deliver over TLS only opportunistically`, { fix: 'Optional hardening: publish an MTA-STS policy (start with mode: testing) and a TLS-RPT record.' }));
    else if (sts.error) out.push(result('email.mta-sts', 'fail', 'MTA-STS', `TXT published but ${sts.url}: ${sts.error}`, { fix: 'Serve the policy file over https at that URL, or remove the TXT record.' }));
    else {
      const uncovered = ctx.shared.mx.filter((h) => !stsCovers(sts.mx, h));
      const st = uncovered.length ? 'fail' : sts.mode === 'enforce' ? 'pass' : 'info';
      out.push(result('email.mta-sts', st, 'MTA-STS', `mode ${sts.mode || '?'}, max_age ${sts.maxAge ?? '?'}, mx ${sts.mx.join(', ')}${uncovered.length ? `; does not cover ${uncovered.join(', ')}` : ''}`, { fix: uncovered.length ? 'Add the missing MX hosts to the policy, or mail to them fails under enforce.' : sts.mode === 'enforce' ? '' : 'Move to mode: enforce once TLS-RPT reports are clean.' }));
    }
    const rpt = await r.query(`_smtp._tls.${d}`, 'TXT');
    const rptRec = rpt.answers.find((a) => a.type === 'TXT' && /^v=TLSRPTv1/i.test(a.data));
    out.push(result('email.tls-rpt', 'info', 'TLS-RPT', rptRec ? rptRec.data : 'none', { fix: rptRec ? '' : `Optional: \`_smtp._tls.${d}\` TXT \`v=TLSRPTv1; rua=mailto:tls-reports@${d}\`.` }));
  }
  const bimi = await r.query(`default._bimi.${d}`, 'TXT');
  const bimiRec = bimi.answers.find((a) => a.type === 'TXT' && /^v=BIMI1/i.test(a.data));
  if (bimiRec) out.push(result('email.bimi', dm.tags && ['quarantine', 'reject'].includes((dm.tags.p || '').toLowerCase()) ? 'info' : 'warn', 'BIMI', bimiRec.data, { fix: dm.tags && ['quarantine', 'reject'].includes((dm.tags.p || '').toLowerCase()) ? '' : 'BIMI logos only show with DMARC at quarantine or reject.' }));
  return out;
}

function mailProvider(hosts) {
  const h = hosts.join(' ');
  if (/google\.com|googlemail/.test(h)) return 'Google Workspace';
  if (/outlook\.com|protection\.outlook/.test(h)) return 'Microsoft 365';
  if (/one\.com/.test(h)) return 'one.com';
  if (/simply\.com|unoeuro/.test(h)) return 'Simply.com';
  if (/protonmail|proton\.me/.test(h)) return 'Proton';
  if (/mimecast/.test(h)) return 'Mimecast';
  if (/pphosted|proofpoint/.test(h)) return 'Proofpoint';
  if (/zoho/.test(h)) return 'Zoho';
  return null;
}

// ------------------------------------------------------------------ TLS

export async function tlsChecks(ctx) {
  const { resolver: r, host, sibling } = ctx;
  const out = [];
  const names = [host];
  if (sibling) {
    const s = await r.query(sibling, 'A');
    if (s.answers.some((a) => a.type === 'A')) names.push(sibling);
  }
  const endpoints = [];
  for (const name of names) {
    const ips = name === host && ctx.shared.ips?.[host] ? ctx.shared.ips[host] : { v4: await r.records(name, 'A').catch(() => []), v6: await r.records(name, 'AAAA').catch(() => []) };
    for (const ip of ips.v4.slice(0, 4)) endpoints.push({ name, ip });
    for (const ip of ips.v6.slice(0, 2)) endpoints.push({ name, ip, v6: true });
    if (!ips.v4.length && !ips.v6.length) endpoints.push({ name, ip: null });
  }
  const limit = pLimit(4);
  const shakes = await Promise.all(endpoints.map((e) => limit(async () => ({ ...e, hs: await handshake({ host: e.name, ip: e.ip, connect: ctx.connect }) }))));
  const okShakes = shakes.filter((s) => s.hs.ok);
  const failed = shakes.filter((s) => !s.hs.ok);
  const v6Failed = failed.filter((s) => s.v6);
  const v4Failed = failed.filter((s) => !s.v6);
  if (!okShakes.length) {
    out.push(result('tls.handshake', 'fail', 'TLS handshake', failed.map((s) => `${s.name}${s.ip ? ` @ ${s.ip}` : ''}: ${s.hs.error}`).join('; '), { fix: 'Serve https on port 443 with a valid certificate.', blocker: true }));
    return out;
  }
  if (v4Failed.length) out.push(result('tls.handshake', 'fail', 'TLS handshake', `${v4Failed.map((s) => `${s.name} @ ${s.ip}: ${s.hs.error}`).join('; ')} (other addresses answer)`, { fix: 'One address in the DNS answer is not serving https; visitors routed there get an error.' }));
  const noRoute = v6Failed.filter((s) => /EAFNOSUPPORT|ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL/.test(s.hs.error));
  if (noRoute.length && noRoute.length === v6Failed.length) out.push(result('tls.ipv6', 'skip', 'IPv6 endpoints', `this machine has no IPv6 route, so ${[...new Set(noRoute.map((s) => s.ip))].join(', ')} could not be tested`));
  else if (v6Failed.length) out.push(result('tls.ipv6', 'warn', 'IPv6 endpoints', v6Failed.map((s) => `${s.name} @ ${s.ip}: ${s.hs.error}`).join('; '), { fix: 'The AAAA record points at an address that does not answer https. Fix or remove it.' }));

  // Per endpoint: trust, expiry, names.
  const rows = okShakes.map((s) => {
    const leaf = s.hs.chain[0] || {};
    return { ...s, leaf, days: daysLeft(leaf.validTo, ctx.now), covers: sanCovers(leaf.san || [], s.name) };
  });
  const primary = rows.find((x) => x.name === host) || rows[0];
  ctx.shared.issuer = primary.leaf.issuer;
  ctx.shared.cert = primary.leaf;
  const untrusted = rows.filter((x) => !x.hs.authorized);
  out.push(untrusted.length
    ? result('tls.chain', 'fail', 'Certificate chain', untrusted.map((x) => `${x.name} @ ${x.ip || 'default'}: ${x.hs.authorizationError}${x.hs.authorizationError === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ? ' (intermediate certificate not sent)' : ''}`).join('; '), { fix: 'Install the full chain (leaf + intermediates) on every endpoint; browsers that cannot fetch the missing intermediate (many Android apps, curl, APIs) fail.', blocker: true })
    : result('tls.chain', 'pass', 'Certificate chain', `trusted on ${plural(rows.length, 'endpoint')}, issued by ${primary.leaf.issuer} (${primary.leaf.issuerCN})`));
  const minDays = Math.min(...rows.map((x) => x.days ?? Infinity));
  const soonest = rows.find((x) => x.days === minDays);
  out.push(result('tls.expiry', minDays < 14 ? 'fail' : minDays < 30 ? 'warn' : 'pass', 'Certificate expiry', `${minDays} days left (${soonest.name} @ ${soonest.ip || 'default'}, until ${fmtDate(soonest.leaf.validTo)})`, { fix: minDays < 30 ? 'Renew now and check why automatic renewal did not run.' : '', blocker: minDays < 3 }));
  const distinct = new Set(rows.map((x) => x.leaf.fingerprint));
  if (distinct.size > 1) {
    const byFp = {};
    for (const x of rows) (byFp[x.leaf.fingerprint] ||= []).push(x);
    out.push(result('tls.consistency', 'info', 'Certificates per endpoint', Object.values(byFp).map((xs) => `${xs.map((x) => `${x.name}@${x.ip || 'default'}`).join(', ')}: until ${fmtDate(xs[0].leaf.validTo)}, ${xs[0].leaf.issuer}`).join(' · '), { fix: 'Different certificates per address is normal on a CDN; check none of them is near expiry.' }));
  }
  const uncovered = rows.filter((x) => !x.covers);
  out.push(uncovered.length
    ? result('tls.san', 'fail', 'Names on the certificate', uncovered.map((x) => `${x.name} not in ${x.leaf.san.slice(0, 6).join(', ')}`).join('; '), { fix: 'Reissue the certificate with every served host name.', blocker: uncovered.some((x) => x.name === host) })
    : result('tls.san', 'pass', 'Names on the certificate', `${names.join(' and ')} covered`));

  const leaf = primary.leaf;
  const keyProblems = [];
  if (leaf.keyType === 'RSA' && leaf.bits && leaf.bits < 2048) keyProblems.push(`RSA ${leaf.bits} bit`);
  if (/sha1/i.test(leaf.signature || '')) keyProblems.push(`signed with ${leaf.signature}`);
  out.push(result('tls.key', keyProblems.length ? 'fail' : 'pass', 'Key and signature', `${leaf.keyType || '?'}${leaf.bits ? ` ${leaf.bits} bit` : ''}${leaf.curve ? ` ${leaf.curve}` : ''}, ${leaf.signature || 'signature algorithm unknown'}`, { fix: keyProblems.length ? 'Reissue with RSA 2048+ or ECDSA P-256 and SHA-256.' : '' }));

  const protos = [...new Set(rows.map((x) => x.hs.protocol))];
  const alpn = [...new Set(rows.map((x) => x.hs.alpn || 'none'))];
  out.push(result('tls.protocol', protos.every((p) => p === 'TLSv1.3') ? 'pass' : protos.some((p) => /TLSv1(\.[01])?$/.test(p)) ? 'fail' : 'info', 'Negotiated protocol', `${protos.join(', ')}; ALPN ${alpn.join(', ')}`, { fix: protos.every((p) => p === 'TLSv1.3') ? '' : 'Enable TLS 1.3.' }));
  if (!alpn.includes('h2')) out.push(result('tls.alpn', 'warn', 'HTTP/2', 'the server does not offer h2 in ALPN', { fix: 'Turn on HTTP/2 at the server or CDN.' }));
  out.push(result('tls.ocsp-stapling', 'info', 'OCSP stapling', rows.some((x) => x.hs.ocsp) ? 'stapled' : 'not stapled', { fix: rows.some((x) => x.hs.ocsp) ? '' : 'Optional; Let\'s Encrypt ended OCSP in 2025, so no stapling is normal there.' }));

  if (ctx.legacy) {
    const legacy = [];
    for (const v of ['TLSv1', 'TLSv1.1']) {
      const hs = await handshake({ host, ip: primary.ip, minVersion: v, maxVersion: v, ciphers: 'DEFAULT@SECLEVEL=0', connect: ctx.connect, timeout: 6000 });
      if (hs.ok) legacy.push(v.replace('TLSv1', 'TLS 1.').replace(/\.$/, '.0'));
      else if (/no protocols available|unsupported protocol|NO_PROTOCOLS/i.test(hs.error)) legacy.push(null);
    }
    if (legacy.includes(null)) out.push(result('tls.legacy', 'skip', 'TLS 1.0 / 1.1', 'this machine\'s OpenSSL cannot offer TLS 1.0/1.1, so it cannot test whether the server still accepts them'));
    else out.push(result('tls.legacy', legacy.length ? 'warn' : 'pass', 'TLS 1.0 / 1.1', legacy.length ? `server still accepts ${legacy.join(' and ')}` : 'refused', { fix: legacy.length ? 'Disable TLS 1.0 and 1.1 (deprecated by RFC 8996; PCI DSS forbids them).' : '' }));
  }

  if (ctx.shared.caa?.length && leaf.issuer) {
    const m = caaAllows(ctx.shared.caa, `${leaf.issuer} ${leaf.issuerCN || ''}`);
    if (m.allowed === false) out.push(result('tls.caa-match', 'fail', 'CAA allows the current CA', `the certificate is from ${leaf.issuer}, but CAA on ${ctx.shared.caaAt} allows only ${m.allowedCas.join(', ')}`, { fix: `Add \`0 issue "<${leaf.issuer}'s CAA domain>"\` or renewal will fail.` }));
    else if (m.allowed) out.push(result('tls.caa-match', 'pass', 'CAA allows the current CA', `${leaf.issuer} is allowed (${m.allowedCas.join(', ')})`));
  }
  return out;
}

// ------------------------------------------------------------------ edge

const CDNS = [
  ['Cloudflare', (h) => h['cf-ray'] || /cloudflare/i.test(h.server || '')],
  ['Vercel', (h) => h['x-vercel-id'] || /vercel/i.test(h.server || '')],
  ['Netlify', (h) => h['x-nf-request-id'] || /netlify/i.test(h.server || '')],
  ['Fastly', (h) => /fastly/i.test(h['x-served-by'] || '') || h['x-fastly-request-id']],
  ['Amazon CloudFront', (h) => h['x-amz-cf-id'] || /cloudfront/i.test(h.via || '')],
  ['Azure Front Door', (h) => h['x-azure-ref'] || h['x-fd-healthprobe']],
  ['Akamai', (h) => /akamai/i.test(h.server || '') || h['x-akamai-transformed']],
  ['GitHub Pages', (h) => /github\.com/i.test(h.server || '')],
  ['Bunny CDN', (h) => /bunnycdn/i.test(h.server || '') || h['cdn-requestid']],
];

export const detectCdn = (h) => CDNS.find(([, f]) => f(h))?.[0] || null;

export async function edgeChecks(ctx) {
  const out = [];
  let res = null;
  try {
    res = await ctx.fetch(`https://${ctx.host}/`, { redirect: 'manual', headers: { 'user-agent': ctx.ua, ...ctx.siteHeaders }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    out.push(result('edge.response', 'skip', 'Edge', `https://${ctx.host}/ did not answer: ${e.cause?.code || e.message}`));
  }
  const h = res ? Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v])) : {};
  if (res) {
    const cdn = detectCdn(h);
    const cache = h['cf-cache-status'] || h['x-vercel-cache'] || h['x-cache'] || h['x-nf-cache-status'] || null;
    out.push(result('edge.cdn', 'info', 'CDN / host', `${cdn || 'no CDN recognised from the headers'}${cache ? `; cache status ${cache}` : ''}${h.server ? `; server ${h.server}` : ''}`, { fix: cdn ? '' : 'A CDN in front of the origin adds DDoS protection, HTTP/3 and edge caching.' }));
  }
  const https = await ctx.resolver.query(ctx.host, 'HTTPS');
  const httpsRr = https.answers.find((a) => a.type === 'HTTPS')?.data || '';
  const altSvc = h['alt-svc'] || '';
  const h3 = /\bh3\b/.test(altSvc) || /alpn="?[^"\s]*h3/.test(httpsRr);
  out.push(result('edge.http3', h3 ? 'pass' : 'info', 'HTTP/3', h3 ? `advertised (${[altSvc && `Alt-Svc ${altSvc.slice(0, 60)}`, httpsRr && 'HTTPS DNS record'].filter(Boolean).join('; ')})` : 'not advertised (no h3 in Alt-Svc or an HTTPS DNS record)', { fix: h3 ? '' : 'Optional: most CDNs enable HTTP/3 with a toggle; it helps on mobile networks.' }));

  // HSTS preload: the header from launch-audit's headers group decides eligibility; here the list status and what preloading would break.
  const hsts = h['strict-transport-security'] || '';
  const pre = await preloadStatus(ctx.apex, { fetch: ctx.fetch });
  ctx.shared.hsts = { header: hsts, preload: pre.ok ? pre.status : null, includeSubDomains: /includesubdomains/i.test(hsts) };
  if (!pre.ok) out.push(result('hsts.preload-list', 'skip', 'HSTS preload list', `hstspreload.org: ${pre.error}`));
  else {
    const eligible = /max-age=(\d+)/i.test(hsts) && Number(/max-age=(\d+)/i.exec(hsts)[1]) >= 31536000 && /includesubdomains/i.test(hsts) && /preload/i.test(hsts);
    out.push(result('hsts.preload-list', 'info', 'HSTS preload list', `${ctx.apex}: ${pre.status}${hsts ? `; header on ${ctx.host}: \`${hsts}\`` : `; no HSTS header on ${ctx.host}`}${pre.status !== 'preloaded' ? (eligible ? ' (header is eligible)' : ' (header not eligible: needs max-age ≥ 31536000, includeSubDomains, preload)') : ''}`, { fix: pre.status === 'preloaded' ? '' : 'Preload only when every subdomain serves https; see the subdomain section for any that do not. Submit the apex at hstspreload.org.', link: `https://hstspreload.org/?domain=${ctx.apex}` }));
  }
  return out;
}

// ------------------------------------------------------------------ Certificate Transparency

/** Services whose names can be claimed by anyone once the resource is deleted (can-i-take-over-xyz). */
export const TAKEOVER_SUFFIXES = ['azurewebsites.net', 'cloudapp.net', 'cloudapp.azure.com', 'trafficmanager.net', 'blob.core.windows.net', 'azureedge.net', 'azurestaticapps.net', 's3.amazonaws.com', 's3-website', 'elasticbeanstalk.com', 'herokuapp.com', 'herokudns.com', 'github.io', 'netlify.app', 'netlify.com', 'vercel.app', 'pantheonsite.io', 'surge.sh', 'bitbucket.io', 'ghost.io', 'myshopify.com', 'zendesk.com', 'wpengine.com', 'fly.dev', 'readme.io', 'helpscoutdocs.com', 'webflow.io', 'unbouncepages.com', 'firebaseapp.com', 'web.app'];

export async function ctChecks(ctx) {
  const { resolver: r, apex } = ctx;
  const out = [];
  const ct = await crtSh(apex, { fetch: ctx.fetch, now: ctx.now });
  if (!ct.ok) { out.push(result('ct.inventory', 'skip', 'Certificate Transparency', `crt.sh: ${ct.error} (it is often slow; run again or pass --no-ct)`)); return out; }
  const wildcards = ct.names.filter((n) => n.startsWith('*.'));
  const names = ct.names.filter((n) => !n.startsWith('*.')).sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b));
  const probe = names.slice(0, ctx.maxSubdomains);
  out.push(result('ct.inventory', 'info', 'Names in CT logs', `${plural(names.length, 'host name')}${wildcards.length ? ` and ${plural(wildcards.length, 'wildcard')}` : ''} on ${ct.certs} unexpired certificates; issuers ${Object.entries(ct.issuers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}${names.length > probe.length ? `; checked the first ${probe.length}` : ''}`, { data: { names, wildcards } }));

  // Every publicly trusted certificate is logged; a leaf that is not means someone re-signs TLS on the way.
  const leaf = ctx.shared.cert;
  if (leaf?.serial && ct.serials.size && !ct.serials.has(normSerial(leaf.serial))) {
    out.push(result('tls.interception', 'warn', 'Certificate not in CT logs', `the certificate this machine received for ${ctx.host} (serial ${leaf.serial}, issuer ${leaf.issuer}) is not among the ${ct.certs} logged ones. A proxy, VPN or antivirus is probably re-signing TLS here, so the TLS rows above describe it, not the site`, { fix: 'Run again from a network without TLS inspection, or check the certificate at crt.sh. If it really is unlogged, browsers that enforce CT will reject it.', link: `https://crt.sh/?q=${ctx.host}` }));
  }

  const caa = ctx.shared.caa || [];
  if (caa.length) {
    const off = Object.keys(ct.issuers).filter((i) => caaAllows(caa, i).allowed === false);
    if (off.length) out.push(result('ct.issuers', 'info', 'CAs outside CAA', `${off.join(', ')} issued unexpired certificates for the domain but are not in CAA (${ctx.shared.caaAt}); new ones would be refused`, { fix: 'Expected if CAA was tightened recently; otherwise add the CA or find out who ordered those certificates.' }));
  }

  const limit = pLimit(6);
  const rows = await Promise.all(probe.map((name) => limit(async () => {
    const [c, a4, a6] = await Promise.all([r.query(name, 'CNAME'), r.query(name, 'A'), r.query(name, 'AAAA')]);
    const alias = c.answers.find((x) => x.type === 'CNAME' && x.name === name)?.data;
    const addrs = [...a4.answers.filter((x) => x.type === 'A'), ...a6.answers.filter((x) => x.type === 'AAAA')].map((x) => x.data);
    const row = { name, alias: alias ? undot(alias) : null, addrs, nx: a4.nxdomain && !alias };
    if (alias && !addrs.length) {
      const t = await r.query(undot(alias), 'A');
      row.dangling = t.nxdomain || !t.answers.length;
    }
    if (addrs.length) {
      const hs = await settle(handshake({ host: name, connect: ctx.connect, timeout: 6000 }), 8000, (e) => ({ ok: false, error: e.message }));
      row.https = hs.ok;
      if (hs.ok) {
        const leaf = hs.chain[0] || {};
        row.days = daysLeft(leaf.validTo, ctx.now);
        row.covers = sanCovers(leaf.san || [], name);
        row.trusted = hs.authorized;
        row.error = hs.authorizationError;
      } else row.error = hs.error;
    }
    return row;
  })));

  const dangling = rows.filter((x) => x.dangling);
  const risky = dangling.filter((x) => TAKEOVER_SUFFIXES.some((s) => x.alias.includes(s)));
  out.push(dangling.length
    ? result('ct.dangling', 'fail', 'Dangling CNAMEs', dangling.map((x) => `${x.name} → ${x.alias}${TAKEOVER_SUFFIXES.some((s) => x.alias.includes(s)) ? ' (claimable service)' : ''}`).join('; '), { fix: 'Delete these CNAMEs (or recreate the targets). On a claimable service anyone can register the target and serve pages, cookies and phishing on your domain.', blocker: risky.length > 0 })
    : result('ct.dangling', 'pass', 'Dangling CNAMEs', `none among ${plural(rows.length, 'name')} checked`));

  const live = rows.filter((x) => x.https);
  const bad = live.filter((x) => !x.trusted || !x.covers || (x.days !== null && x.days < 14));
  out.push(bad.length
    ? result('ct.certificates', 'warn', 'Subdomain certificates', bad.map((x) => `${x.name}: ${!x.trusted ? x.error : !x.covers ? 'name not on certificate' : `${x.days} days left`}`).join('; '), { fix: 'Renew or fix these; a broken certificate on any subdomain also blocks HSTS includeSubDomains.' })
    : result('ct.certificates', 'pass', 'Subdomain certificates', `${plural(live.length, 'subdomain')} answer https with a valid certificate`));

  const noHttps = rows.filter((x) => x.addrs.length && !x.https);
  const gone = rows.filter((x) => x.nx);
  if (noHttps.length) {
    const hstsSub = ctx.shared.hsts?.includeSubDomains || ctx.shared.hsts?.preload === 'preloaded';
    out.push(result('ct.no-https', hstsSub ? 'warn' : 'info', 'Subdomains without https', `${noHttps.map((x) => `${x.name} (${x.error})`).join('; ')}`, { fix: hstsSub ? 'HSTS includeSubDomains (or the preload list) forces https on these, so browsers cannot reach them. Serve https or move them off the domain.' : 'Fine for mail or internal hosts; required before HSTS includeSubDomains or preload.' }));
  }
  if (gone.length) out.push(result('ct.stale', 'info', 'Names no longer in DNS', `${gone.map((x) => x.name).join(', ')}`, { fix: 'Certificates still list them; nothing to do unless they should exist.' }));
  return out;
}
