/**
 * 4. TLS, DNS & email — certificate, negotiated protocol, CAA/MX/DNSSEC, and
 * the SPF/DMARC records that decide whether the site's transactional mail
 * lands. Email records live on the email domain (host minus www., or
 * --email-domain), which is rarely the audited host on staging.
 */
import { result } from '../registry.mjs';
import { tlsInfo, publicTlsInfo, certSummary, dnsRecords, dnssecStatus, evaluateSpf, evaluateDmarc, dkimProbe, pickResolver, zoneOf } from '../net.mjs';
import { preloadLookup, preloadVerdict } from '../hsts-preload.mjs';
import net from 'node:net';
import { isPlatformHost } from '../cli.mjs';

export default {
  id: 'tls',
  title: 'TLS, DNS & email',
  phase: 'B',
  budget: 60000,
  async run(ctx) {
    const { http, hostname, sibling, emailDomain, isPrivate, insecure, remote, page, finalUrl } = ctx;
    const out = [];
    const u = new URL(finalUrl);
    const isIp = net.isIP(hostname) !== 0;

    // --- TLS
    if (u.protocol !== 'https:') {
      out.push(result('tls.chain', 'fail', 'HTTPS', `the site is served over ${u.protocol.replace(':', '')}`, { fix: 'Serve everything over https with a valid certificate.', blocker: true }));
    } else {
      // Public hosts are judged against the public roots only, so a re-signing proxy is caught; a
      // private host keeps the local store (mkcert and company CAs are expected there).
      const tlsOpts = { port: Number(u.port) || 443, timeout: 10000 };
      const info = isPrivate || isIp ? await tlsInfo(hostname, tlsOpts) : await publicTlsInfo(hostname, tlsOpts);
      const tlsStart = out.length;
      if (!info.ok) {
        out.push(result('tls.chain', 'skip', 'Certificate chain', `TLS handshake failed: ${info.error}`));
      } else {
        const sum = certSummary(info, { host: hostname, altHost: sibling });
        ctx.scoreboard.tls = { protocol: info.protocol, issuer: sum.issuer, daysLeft: sum.daysLeft, alpn: info.alpn };
        if (info.authorized) out.push(result('tls.chain', 'pass', 'Certificate chain', `valid chain (${sum.chainLength} certs), issued by ${sum.issuer}`));
        else if (insecure) out.push(result('tls.chain', 'info', 'Certificate chain', `not trusted (${info.authorizationError}) — accepted because of --insecure`));
        else out.push(result('tls.chain', 'fail', 'Certificate chain', `not trusted: ${info.authorizationError}`, { fix: 'Install the full chain (leaf + intermediates) from a public CA; browsers will show an interstitial otherwise.', blocker: true }));
        const expiry = sum.daysLeft == null ? 'info' : sum.daysLeft < 14 ? 'fail' : sum.daysLeft < 30 ? 'warn' : 'pass';
        out.push(result('tls.expiry', expiry, 'Certificate expiry', `expires ${String(sum.validTo).slice(0, 10)} (${sum.daysLeft} days)`, { fix: expiry === 'pass' ? '' : 'Renew now and make sure renewal is automatic (ACME) with an expiry alert.', blocker: expiry === 'fail' ? true : undefined }));
        out.push(sum.coversHost
          ? result('tls.san', sum.coversAlt === false ? 'warn' : 'pass', 'Certificate names', `covers ${hostname}${sibling ? (sum.coversAlt ? ` and ${sibling}` : ` but not ${sibling}`) : ''}${sum.wildcard ? ' (wildcard)' : ''}`, { fix: sum.coversAlt === false ? `Add ${sibling} to the certificate so the www/apex redirect does not throw a certificate error first.` : '' })
          : result('tls.san', 'fail', 'Certificate names', `the certificate does not cover ${hostname} (SANs: ${sum.sans.slice(0, 5).join(', ')})`, { fix: 'Issue a certificate for this hostname.', blocker: true }));
        const proto = info.protocol || '';
        out.push(result('tls.protocol', /TLSv1\.[23]/.test(proto) ? 'pass' : 'warn', 'Negotiated protocol', `${proto}${info.alpn ? `, ALPN ${info.alpn}` : ''}${info.cipher?.name ? `, ${info.cipher.name}` : ''}`, { fix: /TLSv1\.[23]/.test(proto) ? '' : 'Enable TLS 1.2 and 1.3; disable 1.0/1.1.' }));
        out.push(result('tls.issuer', 'info', 'Issuer', `${sum.issuer}${info.cert?.serialNumber ? ` · serial ${info.cert.serialNumber.slice(0, 16)}…` : ''}`, { link: `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(hostname)}&hideResults=on` }));
        if (info.intercepted) {
          // The rows above describe the proxy's certificate, not the site's.
          for (const r of out.slice(tlsStart)) {
            r.evidence = `not checked from this network (TLS is re-signed on the way, see "TLS interception"); seen: ${r.evidence}`;
            r.status = 'skip'; r.fix = ''; delete r.blocker; delete r.beforeProduction;
          }
          ctx.scoreboard.tls = null;
          out.push(result('tls.interception', 'warn', 'TLS interception', `the certificate this machine received for ${hostname} chains to ${info.interceptedBy}, which only this machine's own CA store trusts, not the public roots. A proxy, VPN, antivirus or cloud egress gateway re-signs TLS here`, { fix: 'Run the audit from a network without TLS inspection (your own machine) to check the real certificate.', link: `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(hostname)}&hideResults=on` }));
        }
      }
    }

    if (isPrivate || isIp) {
      out.push(result('dns.records', 'skip', 'DNS', `${isIp ? 'IP address' : 'private host'} — DNS, DNSSEC and email records are not checked`));
      return out;
    }

    out.push(...await dnsRows(ctx));

    // --- HSTS preload: header requirements plus the real list (hstspreload.org, Chromium list as fallback)
    const header = page.headers['strict-transport-security'];
    const lookup = remote ? await preloadLookup(hostname, { apex: ctx.apexHost, fetch: ctx.fetch }) : { ok: false, error: '--no-remote' };
    const v = preloadVerdict({ host: hostname, header, lookup });
    out.push(result('hsts.preload', v.status, 'HSTS preload', v.text, { fix: v.fix, link: `https://hstspreload.org/?domain=${encodeURIComponent(ctx.apexHost)}`, data: { status: lookup.status, source: lookup.source, preloadedDomain: lookup.preloadedDomain, errors: lookup.errors, warnings: lookup.warnings } }));
    return out;
  },
};

/**
 * DNS, DNSSEC and mail rows. `ctx.net` may inject { resolver, doh } (tests). A local resolver that
 * answers addresses only is caught first (see pickResolver): its empty answers would otherwise read
 * as "no SPF, no DMARC, no CAA, no MX".
 */
export async function dnsRows(ctx) {
  const { hostname, emailDomain } = ctx;
  const inject = ctx.net || {};
  const out = [];
  const zone = zoneOf(hostname);
  const pick = await pickResolver(zone, inject);
  const via = pick.mode === 'doh' ? ` (read over DNS-over-HTTPS: ${pick.note})` : '';
  if (pick.mode === 'blind') {
    const why = `not checked: ${pick.note}`;
    const fix = 'Run the audit from a network whose resolver answers TXT, MX, NS and CAA (or where cloudflare-dns.com / dns.google are reachable).';
    out.push(result('dns.records', 'skip', 'DNS records', why, { fix }));
    for (const [id, title] of [['dns.caa', 'CAA'], ['dns.mx', 'MX'], ['dns.dnssec', 'DNSSEC'], ['email.spf', `SPF (${emailDomain})`], ['email.dmarc', `DMARC (${emailDomain})`], ['email.dkim', `DKIM (${emailDomain})`]]) out.push(result(id, 'skip', title, why));
    return out;
  }
  const opt = { resolver: pick.resolver, ...(inject.doh ? { doh: inject.doh } : {}) };

  // --- DNS for the host
  const d = await dnsRecords(hostname, opt);
  const apex = ctx.apexHost;
  const apexD = apex !== hostname ? await dnsRecords(apex, opt) : d;
  // NS of the domain, not of www: a www CNAME answers with the hosting platform's name servers.
  const ns = apexD.ns.length ? apexD.ns : d.ns;
  out.push(result('dns.records', 'info', 'DNS records', `A ${d.a.join(', ') || '—'} · AAAA ${d.aaaa.join(', ') || '— (no IPv6)'} · NS ${ns.slice(0, 4).join(', ') || '—'}${via}`, { data: d }));
  const caa = d.caa.length ? d.caa : apexD.caa;
  const platform = isPlatformHost(hostname);
  const platformNote = platform ? ' — platform hostname, its DNS is the host\'s; re-check on the production domain' : '';
  out.push(caa.length
    ? result('dns.caa', 'pass', 'CAA', caa.map((c) => `${c.tag} ${c.value}`).join('; '))
    : result('dns.caa', platform ? 'info' : 'warn', 'CAA', `no CAA record on ${hostname}${apex !== hostname ? ` or ${apex}` : ''}${platformNote}`, { fix: 'Add CAA records naming your CA (e.g. `0 issue "letsencrypt.org"`) so no other CA can be tricked into issuing for the domain.' }));
  out.push(result('dns.mx', 'info', 'MX', apexD.mx.length ? apexD.mx.map((m) => `${m.priority} ${m.exchange}`).join(', ') : `no MX on ${apex} (no inbound mail)`));

  // DNSSEC on the zone, not the host: www.example.com as a CNAME to a platform carries the platform zone's AD flag.
  const dohOpt = inject.doh ? { doh: inject.doh } : {};
  const sec = await dnssecStatus(zone, { type: 'NS', ...dohOpt });
  const hostSec = hostname !== zone && sec.validated ? await dnssecStatus(hostname, dohOpt) : null;
  let secText;
  if (sec.validated === null) secText = `could not determine (${sec.error || 'no answer'})`;
  else if (!sec.validated) secText = `${zone} is not signed`;
  else {
    secText = `${zone} validated (AD flag set by ${sec.provider})`;
    if (hostSec && hostSec.validated === false) secText += hostSec.cname ? `; ${hostname} is a CNAME to ${hostSec.cname}, whose zone is not signed (normal for a hosting platform)` : `; ${hostname} itself does not validate`;
  }
  out.push(result('dns.dnssec', 'info', 'DNSSEC', secText, { fix: sec.validated ? '' : 'Optional: enable DNSSEC at the registrar/DNS host; check dnsviz.net after.' }));

  // --- email authentication on the email domain
  const e = emailDomain === apex ? apexD : await dnsRecords(emailDomain, opt);
  const hasMx = e.mx.length > 0;
  const emailPlatform = isPlatformHost(emailDomain) && !hasMx;
  if (emailPlatform) {
    out.push(result('email.spf', 'info', `SPF (${emailDomain})`, 'platform hostname without MX — mail records belong to the production domain; re-run with --email-domain <domain>'));
    out.push(result('email.dmarc', 'info', `DMARC (${emailDomain})`, 'not applicable to a platform hostname; check the production domain with --email-domain'));
  } else {
    const spf = evaluateSpf(e.txt, { hasMx });
    out.push(result('email.spf', spf.status, `SPF (${emailDomain})`, spf.text, { fix: spf.fix || '' }));
    const dm = await dnsRecords(`_dmarc.${emailDomain}`, opt);
    const dmarc = evaluateDmarc(dm.txt, { hasMx });
    out.push(result('email.dmarc', dmarc.status, `DMARC (${emailDomain})`, dmarc.text, { fix: dmarc.fix || '' }));
    const dk = await dkimProbe(emailDomain, { resolver: pick.resolver });
    out.push(result('email.dkim', 'info', `DKIM (${emailDomain})`, dk.found.length ? `selectors found: ${dk.found.map((f) => f.selector).join(', ')}` : 'no common selector found (google, selector1/2, default, k1, mail…) — DKIM may still exist under another selector', { fix: dk.found.length ? '' : 'Confirm the mail provider\'s DKIM selector is published; send a test mail and check the headers.' }));
  }
  return out;
}
