/**
 * Redirect chains: follow one hop by hop, classify it, and build the four-variant
 * matrix (http/https x apex/www). The network functions never throw.
 *
 * Zero dependencies. Node >= 22.
 */
import { siblingHost } from './http.mjs';

const isRedirect = (status) => status >= 300 && status < 400;

/**
 * followChain(http, url, { maxHops = 10 } = {}) ->
 *   { start, chain: [{ url, status, location, hsts: boolean, error? }], final, finalStatus, loop, tooMany, error }
 * Each hop is a manual GET with the body discarded (some servers answer HEAD differently).
 * `location` is the resolved absolute URL a 3xx pointed to, else null. Stops on a non-3xx
 * (final = that URL), a 3xx without a usable Location (error, final = that URL), a
 * network failure (status 0, error from the response, final = null), a URL seen before
 * (loop, final = that URL) or more than maxHops redirects (tooMany, final = the URL not
 * fetched). finalStatus is the status of the last response; 0 when nothing answered.
 * final is null when the last fetch got no response. error is null when none.
 */
export async function followChain(http, url, { maxHops = 10 } = {}) {
  const start = String(url ?? '');
  const result = { start, chain: [], final: null, finalStatus: 0, loop: false, tooMany: false, error: null };
  let current;
  try {
    current = new URL(start).toString();
  } catch {
    result.error = `not a URL: ${start}`;
    return result;
  }
  const visited = new Set();
  let redirects = 0;
  for (;;) {
    visited.add(current);
    const res = await http.request(current, { method: 'GET', redirect: 'manual', maxBytes: 0 });
    const hsts = Boolean(String(res.headers?.['strict-transport-security'] ?? '').trim());
    const entry = { url: current, status: res.status, location: null, hsts };
    result.chain.push(entry);
    result.finalStatus = res.status;
    if (res.status === 0) {
      entry.error = res.error || 'network error';
      result.error = entry.error;
      result.final = null;
      return result;
    }
    result.final = current;
    if (!isRedirect(res.status)) return result;
    const loc = String(res.headers?.location ?? '').trim();
    if (!loc) {
      result.error = `${res.status} without a Location header`;
      return result;
    }
    let next;
    try {
      next = new URL(loc, current).toString();
    } catch {
      result.error = `${res.status} with an unparseable Location: ${loc}`;
      return result;
    }
    entry.location = next;
    redirects++;
    if (visited.has(next)) {
      result.loop = true;
      result.final = next;
      return result;
    }
    if (redirects > maxHops) {
      result.tooMany = true;
      result.final = next;
      return result;
    }
    current = next;
  }
}

/**
 * classifyChain(result) -> { start, final, finalStatus, hops, codes: number[], singleHop,
 *   allPermanent, httpToHttps, loop, tooMany, error, hstsOnHttps: boolean|null, reachedOk }
 * Pure, from followChain()'s result. hops counts the redirects that carried a Location;
 * codes lists every response status in order (0 for a network failure). allPermanent:
 * every hop was a 301 or 308 (true when there were none). httpToHttps: start is http:,
 * final https:. hstsOnHttps: every https response carried strict-transport-security,
 * null when no https response was seen. reachedOk: no error, loop or tooMany and a
 * final status of 200-399.
 */
export function classifyChain(result) {
  const { start, final, finalStatus } = result;
  const error = result.error ?? null;
  const loop = Boolean(result.loop);
  const tooMany = Boolean(result.tooMany);
  const chain = result.chain || [];
  const followed = chain.filter((h) => isRedirect(h.status) && h.location);
  const httpsResponses = chain.filter((h) => h.status !== 0 && /^https:/i.test(h.url));
  const protocol = (u) => { try { return new URL(u).protocol; } catch { return ''; } };
  return {
    start,
    final,
    finalStatus,
    hops: followed.length,
    codes: chain.map((h) => h.status),
    singleHop: followed.length === 1,
    allPermanent: followed.every((h) => h.status === 301 || h.status === 308),
    httpToHttps: protocol(start) === 'http:' && protocol(final) === 'https:',
    loop,
    tooMany,
    error,
    hstsOnHttps: httpsResponses.length ? httpsResponses.every((h) => h.hsts) : null,
    reachedOk: !error && !loop && !tooMany && finalStatus >= 200 && finalStatus < 400,
  };
}

/**
 * buildRedirectMatrix(http, { host, path = '/', maxHops = 10 }) ->
 *   [{ variant: 'http-apex'|'https-apex'|'http-www'|'https-www', start, ...classifyChain(...) }]
 * The apex/www pair comes from siblingHost(host); a host with no www sibling (a deeper
 * subdomain) yields only its own two variants, named apex. The variants run concurrently.
 */
export async function buildRedirectMatrix(http, { host, path = '/', maxHops = 10 } = {}) {
  const h = String(host || '').toLowerCase();
  const p = String(path || '/').startsWith('/') ? String(path || '/') : `/${path}`;
  const sibling = siblingHost(h);
  const isWww = /^www\./.test(h);
  const apex = isWww ? sibling : h;
  const www = isWww ? h : sibling;
  const variants = [];
  if (apex) variants.push(['http-apex', `http://${apex}${p}`], ['https-apex', `https://${apex}${p}`]);
  if (www) variants.push(['http-www', `http://${www}${p}`], ['https-www', `https://${www}${p}`]);
  return Promise.all(variants.map(async ([variant, start]) => ({
    variant,
    start,
    ...classifyChain(await followChain(http, start, { maxHops })),
  })));
}
