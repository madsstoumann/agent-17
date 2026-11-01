/**
 * 6. Security headers & CSP — the six securityheaders.com grades, a local
 * CSP lint, cookie flags, CORS, MDN Observatory, and the securityheaders.com
 * grade itself when we can get it (scrape or paid API), never invented.
 */
import { result } from '../registry.mjs';
import { gradeSecurityHeaders, parseCsp, lintCsp, parseSetCookie, lintCookies, infoLeakHeaders, parseHsts, corsVerdict, crossOriginPolicies, GRADE_NOTE } from '../headers.mjs';
import { observatoryScan, securityHeadersScrape, securityHeadersApi } from '../services.mjs';

const HEADER_FIX = {
  'strict-transport-security': 'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  'content-security-policy': 'Start with a report-only policy from the CSP Evaluator, then enforce: default-src \'self\'; script-src with nonces; object-src \'none\'; base-uri \'self\'; frame-ancestors \'self\'.',
  'x-frame-options': 'X-Frame-Options: DENY (or SAMEORIGIN), or CSP frame-ancestors.',
  'x-content-type-options': 'X-Content-Type-Options: nosniff',
  'referrer-policy': 'Referrer-Policy: strict-origin-when-cross-origin',
  'permissions-policy': 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
};
const LABEL = { 'strict-transport-security': 'HSTS', 'content-security-policy': 'Content-Security-Policy', 'x-frame-options': 'X-Frame-Options', 'x-content-type-options': 'X-Content-Type-Options', 'referrer-policy': 'Referrer-Policy', 'permissions-policy': 'Permissions-Policy' };
const ID = { 'strict-transport-security': 'hsts', 'content-security-policy': 'csp', 'x-frame-options': 'xfo', 'x-content-type-options': 'xcto', 'referrer-policy': 'referrer-policy', 'permissions-policy': 'permissions-policy' };

export default {
  id: 'headers',
  title: 'Security headers & CSP',
  phase: 'B',
  budget: 90000,
  async run(ctx) {
    const { http, page, hostname, finalUrl, remote, opts, production } = ctx;
    const h = page.headers;
    const out = [];
    const shLink = `https://securityheaders.com/?q=${encodeURIComponent(finalUrl)}&followRedirects=on`;

    const g = gradeSecurityHeaders(h);
    const gradeStatus = /^A/.test(g.grade) ? 'pass' : /^[BC]/.test(g.grade) ? 'warn' : 'fail';
    ctx.scoreboard.headersGrade = { grade: g.grade, estimated: true, link: shLink, present: g.present, missing: g.missing, warnings: g.warnings };
    out.push(result('headers.grade', gradeStatus, 'Security headers grade (estimated)', `${g.grade} — ${g.present.length}/6 present${g.missing.length ? `, missing: ${g.missing.map((m) => LABEL[m] || m).join(', ')}` : ''}${g.warnings.length ? `; warnings: ${g.warnings.join('; ')}` : ''} (${GRADE_NOTE})`, { fix: g.missing.length ? 'Add the missing headers; each is one line in the web server, CDN or framework config.' : g.warnings.length ? 'Resolve the warnings for A+.' : '', link: shLink }));

    for (const name of Object.keys(LABEL)) {
      const present = g.present.includes(name);
      const value = h[name];
      const viaCsp = name === 'x-frame-options' && !value && g.xfoViaCsp;
      let status = present ? 'pass' : 'fail';
      let evidence = present ? (viaCsp ? 'satisfied by CSP frame-ancestors' : String(value).slice(0, 200)) : 'missing';
      if (name === 'strict-transport-security' && present) {
        const p = parseHsts(value);
        if (p && p.maxAge < 15552000) { status = 'warn'; evidence += ` — max-age ${p.maxAge} is under 6 months`; }
      }
      if (name === 'x-content-type-options' && value && !/nosniff/i.test(value)) { status = 'fail'; evidence = `${value} (must be nosniff)`; }
      if (name === 'content-security-policy' && !present && h['content-security-policy-report-only']) { status = 'warn'; evidence = 'report-only policy only — nothing is enforced'; }
      out.push(result(`headers.${ID[name]}`, status, LABEL[name], evidence, { fix: status === 'pass' ? '' : HEADER_FIX[name] }));
    }

    const cspValue = h['content-security-policy'] || h['content-security-policy-report-only'] || '';
    if (cspValue) {
      const findings = lintCsp(parseCsp(cspValue), { reportOnly: !h['content-security-policy'] });
      const warns = findings.filter((f) => f.severity === 'warn');
      out.push(result('headers.csp-lint', warns.length ? 'warn' : 'pass', 'CSP lint', warns.length ? warns.map((f) => f.text).join(' · ') : `no bypass found${findings.length ? ` (${findings.map((f) => f.code).join(', ')})` : ''}`, { fix: warns.length ? 'Move inline scripts to nonces or hashes, drop unsafe-eval and wildcards, add object-src \'none\' and base-uri; verify in the CSP Evaluator.' : '', link: 'https://csp-evaluator.withgoogle.com/', data: { findings } }));
    }

    const leaks = infoLeakHeaders(h);
    out.push(leaks.length ? result('headers.info-leak', 'warn', 'Version disclosure', leaks.map((l) => `${l.header}: ${l.value}`).join('; '), { fix: 'Remove or blank these headers; they advertise the exact software version to scanners.' }) : result('headers.info-leak', 'pass', 'Version disclosure', `no version-bearing server/x-powered-by headers${h.server ? ` (server: ${h.server})` : ''}`));

    const cookies = (page.setCookie || []).map(parseSetCookie);
    if (cookies.length) {
      const lint = lintCookies(cookies, { https: finalUrl.startsWith('https:'), host: hostname });
      const worst = lint.find((l) => l.severity === 'fail') ? 'fail' : lint.find((l) => l.severity === 'warn') ? 'warn' : 'pass';
      out.push(result('headers.cookies', worst, 'Cookies on first response', `${cookies.length} cookie(s): ${cookies.map((c) => c.name).join(', ')}${lint.length ? ` — ${lint.filter((l) => l.severity !== 'info').map((l) => `${l.name}: ${l.text}`).join('; ') || lint.map((l) => `${l.name}: ${l.text}`).join('; ')}` : ''}`, { fix: worst === 'pass' ? '' : 'Set Secure on every cookie over https, HttpOnly on anything a script does not need, and an explicit SameSite.', data: { cookies, lint } }));
    } else {
      out.push(result('headers.cookies', 'pass', 'Cookies on first response', 'no Set-Cookie on the start page'));
    }

    const cors = corsVerdict(h);
    out.push(result('headers.cors', cors.status, 'CORS', cors.text, { fix: cors.status === 'fail' ? 'Never combine a wildcard origin with credentials; echo an allowlisted origin instead.' : '' }));
    const cop = crossOriginPolicies(h);
    out.push(result('headers.cross-origin-policies', 'info', 'COOP / COEP / CORP', `COOP ${cop.coop || '—'} · COEP ${cop.coep || '—'} · CORP ${cop.corp || '—'}`, { fix: 'Optional hardening; needed only for SharedArrayBuffer or to isolate the window from cross-origin pop-ups.' }));

    // --- MDN HTTP Observatory (free API)
    if (remote) {
      const obs = await observatoryScan(http, hostname, { timeout: 30000 });
      if (obs.ok) {
        const st = /^A/.test(obs.grade) ? 'pass' : /^B/.test(obs.grade) ? 'warn' : 'fail';
        ctx.scoreboard.observatory = { grade: obs.grade, score: obs.score, passed: obs.testsPassed, total: obs.testsQuantity, link: obs.detailsUrl };
        await ctx.saveRaw('observatory.json', obs.raw);
        out.push(result('headers.observatory', st, 'MDN HTTP Observatory', `${obs.grade} (${obs.score}/100), ${obs.testsPassed}/${obs.testsQuantity} tests passed${obs.failed.length ? ` — failed: ${obs.failed.map((f) => `${f.name} (${f.result}, ${f.modifier})`).join('; ')}` : ''}`, { fix: obs.failed.length ? obs.failed.map((f) => f.recommendation).filter(Boolean).slice(0, 3).join(' ') : '', link: obs.detailsUrl }));
      } else {
        ctx.scoreboard.observatory = { grade: null, error: obs.error };
        out.push(result('headers.observatory', 'skip', 'MDN HTTP Observatory', `not scanned: ${obs.error}`, { link: `https://developer.mozilla.org/en-US/observatory/analyze?host=${encodeURIComponent(hostname)}` }));
      }
    } else {
      out.push(result('headers.observatory', 'skip', 'MDN HTTP Observatory', ctx.isPrivate ? 'host not publicly reachable' : 'remote services disabled (--no-remote)'));
    }

    // --- securityheaders.com: paid API if a key exists, else a headless scrape attempt, else the link
    if (remote && opts.shKey) {
      const api = await securityHeadersApi(http, finalUrl, opts.shKey);
      if (api.ok && api.grade) { ctx.scoreboard.headersScraped = { grade: api.grade, source: 'api' }; out.push(result('headers.securityheaders-api', 'info', 'securityheaders.com (API)', `grade ${api.grade}`, { link: shLink })); }
      else out.push(result('headers.securityheaders-api', 'skip', 'securityheaders.com (API)', api.error || 'no grade in the response', { link: shLink }));
    }
    if (remote && !ctx.scoreboard.headersScraped) {
      const sc = ctx.chromePath ? await securityHeadersScrape(finalUrl, { chromePath: ctx.chromePath, timeout: 30000 }) : { ok: false, error: 'Chrome not found' };
      if (sc.ok && sc.grade) {
        ctx.scoreboard.headersScraped = { grade: sc.grade, source: 'scrape' };
        out.push(result('headers.securityheaders-scrape', 'info', 'securityheaders.com (scraped)', `grade ${sc.grade}`, { link: shLink }));
      } else {
        out.push(result('headers.securityheaders-scrape', 'skip', 'securityheaders.com grade', sc.challenge ? 'Cloudflare challenge blocked the headless browser — open the link to confirm the estimated grade' : `not scraped: ${sc.error || 'no grade found'}`, { link: shLink }));
      }
    } else if (!remote) {
      out.push(result('headers.securityheaders-scrape', 'skip', 'securityheaders.com grade', ctx.isPrivate ? 'host not publicly reachable' : 'remote services disabled', { link: shLink }));
    }
    return out;
  },
};
