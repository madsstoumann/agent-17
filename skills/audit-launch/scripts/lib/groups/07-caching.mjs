/**
 * 7. Caching, compression & protocol — what the document and a few static
 * assets say about themselves, plus what curl saw (HTTP version, TTFB).
 */
import { result } from '../registry.mjs';
import { parseCacheControl, lintAssetCaching } from '../headers.mjs';
import { extractAssets } from '../html.mjs';
import { hostOf, pLimit } from '../http.mjs';

const ms = (s) => `${Math.round(s * 1000)} ms`;

export default {
  id: 'caching',
  title: 'Caching, compression & protocol',
  phase: 'B',
  budget: 60000,
  async run(ctx) {
    const { http, page, finalUrl, hostname } = ctx;
    const h = page.headers;
    const curl = page.curl || {};
    const out = [];

    const enc = (h['content-encoding'] || '').toLowerCase();
    out.push(/br|gzip|zstd/.test(enc)
      ? result('caching.compression', 'pass', 'HTML compression', `content-encoding: ${enc} (${(page.bytes / 1024).toFixed(0)} kB decoded)`)
      : result('caching.compression', 'fail', 'HTML compression', 'the HTML is served uncompressed', { fix: 'Enable brotli (or gzip) for text responses at the CDN or server.' }));

    const cc = parseCacheControl(h['cache-control'] || '');
    out.push(result('caching.document-cache-control', 'info', 'HTML Cache-Control', h['cache-control'] ? `${h['cache-control']}${h.age ? ` · age ${h.age}` : ''}` : 'no Cache-Control on the document', { fix: h['cache-control'] ? '' : 'Decide explicitly: no-store for personalised pages, or a short s-maxage with stale-while-revalidate for public ones.' , data: cc }));
    out.push(result('caching.validators', 'info', 'Validators', [h.etag ? `etag ${h.etag.slice(0, 40)}` : null, h['last-modified'] ? `last-modified ${h['last-modified']}` : null].filter(Boolean).join(' · ') || 'no ETag / Last-Modified (conditional requests impossible)'));
    const cdn = [h['cf-cache-status'] ? `cf-cache-status ${h['cf-cache-status']}` : null, h['x-cache'] ? `x-cache ${h['x-cache']}` : null, h['x-vercel-cache'] ? `x-vercel-cache ${h['x-vercel-cache']}` : null, h['x-nextjs-cache'] ? `x-nextjs-cache ${h['x-nextjs-cache']}` : null, h.age != null ? `age ${h.age}` : null, h.server ? `server ${h.server}` : null, h.via ? `via ${h.via}` : null].filter(Boolean);
    out.push(result('caching.cdn', 'info', 'CDN / edge', cdn.join(' · ') || 'no CDN cache headers seen'));
    out.push(result('caching.vary', 'info', 'Vary', h.vary || 'no Vary header', { fix: h.vary && /user-agent|cookie/i.test(h.vary) ? 'Vary on User-Agent or Cookie makes the edge cache nearly useless.' : '' }));

    const hv = String(curl.httpVersion || '');
    if (curl.error) out.push(result('caching.http-version', 'skip', 'HTTP version', `curl probe failed: ${curl.error}`));
    else out.push(result('caching.http-version', /^[23]/.test(hv) ? 'pass' : 'warn', 'HTTP version', `HTTP/${hv}${curl.remoteIp ? ` from ${curl.remoteIp}` : ''}`, { fix: /^[23]/.test(hv) ? '' : 'Enable HTTP/2 (any CDN does it; on the origin it is one server flag).' }));
    const alt = h['alt-svc'] || '';
    out.push(result('caching.alt-svc-h3', 'info', 'HTTP/3', /h3/.test(alt) ? `advertised via alt-svc (${alt.slice(0, 60)})` : 'not advertised (alt-svc has no h3)', { fix: /h3/.test(alt) ? '' : 'Optional: HTTP/3 is a toggle on most CDNs.' }));

    if (curl.timings) {
      const t = curl.timings;
      const ttfb = Math.max(0, t.ttfb - (t.tls || t.connect));
      out.push(result('caching.ttfb', ttfb < 0.8 ? 'pass' : ttfb < 1.8 ? 'warn' : 'fail', 'Time to first byte (server)', `${ms(ttfb)} after the TLS handshake (dns ${ms(t.dns)}, connect ${ms(t.connect)}, tls ${ms(t.tls)}, total ${ms(t.total)})`, { fix: ttfb < 0.8 ? '' : 'Cache the HTML at the edge, or profile the origin: TTFB caps every other performance metric.' }));
    }

    // --- static assets: long max-age + hashed names
    const assets = page.html ? extractAssets(page.html, finalUrl) : { scripts: [], styles: [], images: [] };
    const same = (u) => hostOf(u) === hostname || hostOf(u) === ctx.host;
    const picks = [...assets.styles.filter(same).slice(0, 2), ...assets.scripts.filter(same).slice(0, 2), ...assets.images.filter(same).slice(0, 1)].slice(0, 5);
    if (!picks.length) {
      out.push(result('caching.static-assets', 'info', 'Static asset caching', 'no same-origin CSS/JS/images found on the start page (everything on a CDN host?)'));
    } else {
      const limit = pLimit(3);
      const checked = await Promise.all(picks.map((u) => limit(async () => {
        const r = await http.get(u, { redirect: 'follow', maxBytes: 0, timeout: 10000, headers: { accept: '*/*' } });
        return { url: u, status: r.status, ...lintAssetCaching({ url: u, headers: r.headers }) };
      })));
      const bad = checked.filter((c) => c.status === 200 && !c.ok);
      const nohash = checked.filter((c) => c.status === 200 && c.ok && !c.hashed);
      const summary = checked.map((c) => `${new URL(c.url).pathname.split('/').pop().slice(0, 40)}: ${c.status !== 200 ? c.status : `${c.maxAge != null ? `max-age ${c.maxAge}` : 'no max-age'}${c.immutable ? ' immutable' : ''}${c.hashed ? ' hashed' : ''}${c.compressed ? ' compressed' : ''}`}`).join(' · ');
      out.push(bad.length
        ? result('caching.static-assets', 'warn', 'Static asset caching', summary, { fix: 'Serve hashed CSS/JS/fonts with Cache-Control: public, max-age=31536000, immutable; short max-age only for un-hashed files.', data: { checked } })
        : result('caching.static-assets', nohash.length ? 'info' : 'pass', 'Static asset caching', summary, { fix: nohash.length ? 'Long max-age without a content hash in the filename means a deploy can serve stale files; add hashes to the build output.' : '', data: { checked } }));
    }
    return out;
  },
};
