/**
 * 2. Redirects — http/https × www/apex must all land on the final URL in one
 * permanent hop, and the start URL itself should not chain.
 */
import { result } from '../registry.mjs';
import { hostOf } from '../http.mjs';
import { buildRedirectMatrix, followChain, classifyChain } from '../redirects.mjs';

const fmt = (v) => `${v.start} → ${v.final || '(none)'} (${v.codes.length ? v.codes.join('→') + '→' : ''}${v.finalStatus ?? v.error ?? '?'}, ${v.hops} hop${v.hops === 1 ? '' : 's'})`;

export default {
  id: 'redirects',
  title: 'Redirects',
  phase: 'B',
  budget: 60000,
  async run(ctx) {
    const { http, hostname, host, finalUrl, page, isPrivate, production } = ctx;
    const out = [];
    const u = new URL(finalUrl);
    const startChain = classifyChain(page.chain);
    if (startChain.hops > 1) out.push(result('redirects.start-url', 'warn', 'Start URL redirect chain', fmt(startChain), { fix: 'Collapse the chain: one 301 straight to the final URL.' }));
    else if (startChain.hops === 1) out.push(result('redirects.start-url', 'info', 'Start URL redirect chain', fmt(startChain)));
    else out.push(result('redirects.start-url', 'pass', 'Start URL redirect chain', `${finalUrl} answers ${startChain.finalStatus} directly`));

    if (isPrivate && u.port) {
      out.push(result('redirects.http-to-https', 'skip', 'HTTP → HTTPS', `private host on port ${u.port}; the http/www matrix does not apply`));
      return out;
    }

    const matrix = await buildRedirectMatrix(http, { host, path: u.pathname === '/' ? '/' : '/' });
    out.push(result('redirects.matrix', 'info', 'Redirect matrix', matrix.map(fmt).join(' · '), { data: { matrix } }));

    const finalHost = hostOf(finalUrl);
    const httpVariant = matrix.find((v) => v.start.startsWith('http://') && hostOf(v.start) === finalHost) || matrix.find((v) => v.start.startsWith('http://'));
    if (httpVariant) {
      const c = httpVariant;
      if (c.error && !c.final) out.push(result('redirects.http-to-https', production ? 'warn' : 'info', 'HTTP → HTTPS', `${c.start}: ${c.error}`, { fix: 'Port 80 must answer and 301 to https, or users typing the address get an error.' }));
      else if (!c.httpToHttps) out.push(result('redirects.http-to-https', 'fail', 'HTTP → HTTPS', fmt(c), { fix: 'Redirect every http:// request to https:// with a 301 (and send HSTS on the https response).', blocker: true }));
      else if (c.singleHop && c.allPermanent) out.push(result('redirects.http-to-https', 'pass', 'HTTP → HTTPS', fmt(c)));
      else if (!c.allPermanent) out.push(result('redirects.http-to-https', 'warn', 'HTTP → HTTPS', fmt(c), { fix: 'Use 301/308, not 302/307: temporary redirects are not cached and pass less signal.' }));
      else out.push(result('redirects.http-to-https', 'warn', 'HTTP → HTTPS', fmt(c), { fix: 'Redirect in one hop straight to the final https URL.' }));
    }

    const sibling = matrix.find((v) => v.start.startsWith('https://') && hostOf(v.start) !== finalHost);
    if (sibling) {
      const c = sibling;
      if (c.error && !c.final) out.push(result('redirects.www-variant', production ? 'warn' : 'info', 'www / apex variant', `${c.start}: ${c.error}`, { fix: 'Both www and the bare domain should resolve; point the unused one at the canonical host with a 301.' }));
      else if (hostOf(c.final) === finalHost) out.push(result('redirects.www-variant', c.singleHop && c.allPermanent ? 'pass' : 'warn', 'www / apex variant', fmt(c), { fix: c.singleHop && c.allPermanent ? '' : 'One permanent hop to the canonical host.' }));
      else if (c.reachedOk) out.push(result('redirects.www-variant', 'warn', 'www / apex variant', `${c.start} serves the site on its own host (${c.finalStatus}) — duplicate content`, { fix: '301 the variant to the canonical host.' }));
      else out.push(result('redirects.www-variant', 'info', 'www / apex variant', fmt(c)));
    } else {
      out.push(result('redirects.www-variant', 'info', 'www / apex variant', 'no www/apex sibling for this hostname'));
    }

    const temp = matrix.filter((v) => v.codes.some((code) => code === 302 || code === 307));
    out.push(temp.length ? result('redirects.hop-types', 'warn', 'Redirect status codes', temp.map(fmt).join(' · '), { fix: 'Use 301 (or 308) for permanent moves.' }) : result('redirects.hop-types', 'pass', 'Redirect status codes', 'every hop is permanent (301/308)'));

    const httpsHops = matrix.filter((v) => v.hstsOnHttps === false);
    if (httpsHops.length) out.push(result('redirects.hsts-on-https-hops', 'info', 'HSTS on https hops', `${httpsHops.length} https response(s) in the matrix without Strict-Transport-Security`, { fix: 'Send HSTS on every https response, including redirects, so the browser stops asking for http.' }));
    return out;
  },
};
