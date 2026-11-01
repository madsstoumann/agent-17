/**
 * From measured page loads to result rows:
 *   { id, area, status: pass|warn|fail|info|skip, title, evidence, fix, items: [{ url, note, bytes }] }
 * and the per-page numbers the report tables use.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { perView, rating, fmtG } from './co2.mjs';

export const KB = 1024;
export const MB = 1024 * 1024;
export const fmtBytes = (n) => (n >= MB ? `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB` : `${Math.round(n / KB)} kB`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

export const AREAS = [
  ['carbon', 'Carbon and page weight'],
  ['images', 'Images and video'],
  ['code', 'Fonts, scripts and third parties'],
  ['delivery', 'Delivery and hosting'],
];
const AREA_OF = {
  'eco.rating': 'carbon', 'eco.page-weight': 'carbon', 'eco.lazy-savings': 'carbon',
  'eco.image-weight': 'images', 'eco.image-format': 'images', 'eco.image-oversized': 'images', 'eco.image-lazy': 'images', 'eco.video': 'images',
  'eco.fonts': 'code', 'eco.font-format': 'code', 'eco.javascript': 'code', 'eco.third-party': 'code',
  'eco.compression': 'delivery', 'eco.caching': 'delivery', 'eco.green-hosting': 'delivery',
};
export function result(id, status, title, evidence, { fix = '', items = [] } = {}) {
  return { id, area: AREA_OF[id] || 'carbon', status, title, evidence, fix, items };
}

/** Bucket a request: document, css, js, image, font, media, other. */
export function kindOf(r) {
  const t = r.type; const m = String(r.mimeType || '').toLowerCase(); const u = String(r.url || '').toLowerCase().split('?')[0];
  if (t === 'Document') return 'document';
  if (t === 'Stylesheet' || m === 'text/css') return 'css';
  if (t === 'Script' || /javascript|ecmascript/.test(m)) return 'js';
  if (t === 'Font' || /^font\/|font-woff|opentype|truetype/.test(m) || /\.(woff2?|ttf|otf|eot)$/.test(u)) return 'font';
  if (t === 'Media' || /^(video|audio)\//.test(m)) return 'media';
  if (t === 'Image' || /^image\//.test(m)) return 'image';
  return 'other';
}

/** First party: the site's host or any host under the same domain (cdn.example.dk for www.example.dk). */
export function isFirstParty(url, siteHost) {
  let h;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return false; }
  const base = String(siteHost || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  return h === base || h.endsWith(`.${base}`);
}

/** One measured page -> the numbers. */
export function summarisePage(m, { siteHost, green = false, grid = {} } = {}) {
  const reqs = m.requests.filter((r) => !r.lazy);
  const by = { document: 0, css: 0, js: 0, image: 0, font: 0, media: 0, other: 0 };
  let third = 0;
  for (const r of reqs) {
    by[kindOf(r)] += r.transfer;
    if (!isFirstParty(r.url, siteHost)) third += r.transfer;
  }
  const bytes = m.initialBytes;
  const co2 = perView(bytes, { green, ...grid });
  return { url: m.url, estimate: Boolean(m.estimate), bytes, afterScroll: m.afterScrollBytes, requests: reqs.length, by, third, grams: co2.grams, rating: co2.rating, co2 };
}

const isText = (r) => ['document', 'css', 'js'].includes(kindOf(r)) || /json|xml|svg|text\//i.test(r.mimeType || '');
const maxAge = (cc) => { const m = /max-age=(\d+)/i.exec(cc || ''); return m ? Number(m[1]) : null; };
const name = (u) => { try { const x = new URL(u); return `${x.host}${x.pathname.length > 60 ? `${x.pathname.slice(0, 57)}…` : x.pathname}`; } catch { return u; } };

/**
 * runChecks({ siteHost, pages: [measurement], summaries, green: { green, hostedBy, error } | null })
 */
export function runChecks({ siteHost, pages, summaries, green }) {
  const out = [];
  const n = summaries.length;
  const all = pages.flatMap((m) => m.requests.filter((r) => !r.lazy && r.transfer > 0).map((r) => ({ ...r, page: m.url })));
  const uniq = new Map();
  for (const r of all) if (!uniq.has(r.url) || uniq.get(r.url).transfer < r.transfer) uniq.set(r.url, r);
  const assets = [...uniq.values()];
  const estimate = summaries.some((s) => s.estimate);
  const medBytes = median(summaries.map((s) => s.bytes));
  const medGrams = median(summaries.map((s) => s.grams));
  const worst = [...summaries].sort((a, b) => b.bytes - a.bytes);

  // ---------------------------------------------------------------- carbon and weight
  // The start page is the one most visitors see (and the one Website Carbon measures), so it sets the status with the median.
  const start = summaries[0];
  const r = rating(medGrams);
  const grade = (x) => (['A+', 'A', 'B'].includes(x) ? 0 : ['C', 'D'].includes(x) ? 1 : 2);
  const worstGrade = Math.max(grade(r), grade(start.rating));
  out.push(result('eco.rating', ['pass', 'warn', 'fail'][worstGrade], 'Carbon rating', `start page ${fmtG(start.grams)} g CO2e per view (${start.rating}); median of ${plural(n, 'page')} ${fmtG(medGrams)} g (${r})${green?.green ? ', green hosting counted' : ''}`, {
    fix: worstGrade ? 'Emissions follow bytes: the image, video, font and script rows below are where the weight is.' : '',
    items: worst.map((s) => ({ url: s.url, note: `${fmtG(s.grams)} g · ${s.rating} · ${fmtBytes(s.bytes)}`, bytes: s.bytes })),
  }));
  const heavy = summaries.filter((s) => s.bytes > 1.5 * MB);
  const weightOf = (b) => (b <= 1.5 * MB ? 0 : b <= 3 * MB ? 1 : 2);
  out.push(result('eco.page-weight', ['pass', 'warn', 'fail'][Math.max(weightOf(medBytes), weightOf(start.bytes))], 'Page weight', `start page ${fmtBytes(start.bytes)}, median ${fmtBytes(medBytes)} transferred on first load${worst[0] && worst[0] !== start ? `, heaviest ${fmtBytes(worst[0].bytes)}` : ''}${estimate ? ' (estimated without a browser)' : ''}`, {
    fix: heavy.length ? 'Aim for under 1.5 MB on first load (the web\'s median page is about 2.5 MB). Cut the biggest asset types first.' : '',
    items: heavy.map((s) => ({ url: s.url, note: `${fmtBytes(s.bytes)}: images ${fmtBytes(s.by.image)}, video ${fmtBytes(s.by.media)}, JS ${fmtBytes(s.by.js)}, fonts ${fmtBytes(s.by.font)}`, bytes: s.bytes })),
  }));
  const deferred = summaries.filter((s) => s.afterScroll > s.bytes);
  if (!estimate) out.push(result('eco.lazy-savings', 'info', 'Loaded only after scrolling', deferred.length ? `${fmtBytes(deferred.reduce((a, s) => a + s.afterScroll - s.bytes, 0))} on ${plural(deferred.length, 'page')} load only when the visitor scrolls (not counted above)` : 'nothing more loads on scroll', { items: deferred.map((s) => ({ url: s.url, note: `+${fmtBytes(s.afterScroll - s.bytes)} after scrolling` })) }));

  // ---------------------------------------------------------------- images and video
  const images = assets.filter((a) => kindOf(a) === 'image');
  const imgBytes = median(summaries.map((s) => s.by.image));
  const big = images.filter((a) => a.transfer > 200 * KB).sort((a, b) => b.transfer - a.transfer);
  out.push(result('eco.image-weight', big.length > 2 || imgBytes > 1 * MB ? 'warn' : big.length ? 'info' : 'pass', 'Image weight', `median ${fmtBytes(imgBytes)} of images per page; ${plural(big.length, 'image')} over 200 kB`, {
    fix: big.length ? 'Compress hard (AVIF or WebP at quality 50–70 is usually invisible), and serve sizes that match the layout with srcset and sizes.' : '',
    items: big.map((a) => ({ url: a.url, note: `${fmtBytes(a.transfer)} ${a.mimeType || ''}`.trim(), bytes: a.transfer })),
  }));
  const legacy = images.filter((a) => /image\/(jpe?g|png|gif|bmp|tiff)/i.test(a.mimeType || '') && a.transfer > 30 * KB);
  out.push(result('eco.image-format', legacy.length > 3 ? 'warn' : legacy.length ? 'info' : 'pass', 'Modern image formats', legacy.length ? `${plural(legacy.length, 'image')} over 30 kB served as JPEG, PNG or GIF (${fmtBytes(legacy.reduce((a, x) => a + x.transfer, 0))})` : 'every image over 30 kB is AVIF, WebP or SVG', {
    fix: legacy.length ? 'Serve AVIF or WebP, through the CMS or image CDN (Umbraco ImageSharp `format=webp`, Next/Nuxt Image, Cloudinary `f_auto`, Vercel and Netlify image optimisation). Typically 30–50% smaller than JPEG at the same quality.' : '',
    items: legacy.sort((a, b) => b.transfer - a.transfer).map((a) => ({ url: a.url, note: `${fmtBytes(a.transfer)} ${a.mimeType}`, bytes: a.transfer })),
  }));
  const probed = pages.filter((m) => m.images);
  if (probed.length) {
    const oversized = []; const eager = [];
    for (const m of probed) {
      const dpr = m.viewport?.dpr || 1;
      for (const img of m.images) {
        const req = uniq.get(img.src);
        if (!req || req.transfer < 20 * KB) continue;
        if (img.w > 0 && img.nw > Math.max(2 * img.w * dpr, img.w * dpr + 400)) oversized.push({ url: img.src, note: `${img.nw}×${img.nh} shown at ${img.w}×${img.h} on ${name(m.url)} · ${fmtBytes(req.transfer)}`, bytes: req.transfer });
        if (img.offscreen && img.loading !== 'lazy' && !req.lazy) eager.push({ url: img.src, note: `${fmtBytes(req.transfer)}, ${img.top}px down ${name(m.url)}`, bytes: req.transfer });
      }
    }
    const dedupe = (xs) => [...new Map(xs.map((x) => [x.url, x])).values()].sort((a, b) => b.bytes - a.bytes);
    const ov = dedupe(oversized); const ea = dedupe(eager);
    out.push(result('eco.image-oversized', ov.length > 2 ? 'warn' : ov.length ? 'info' : 'pass', 'Oversized images', ov.length ? `${plural(ov.length, 'image')} at least twice the size they are shown at (${fmtBytes(ov.reduce((a, x) => a + x.bytes, 0))})` : 'images are served close to the size they are shown at', {
      fix: ov.length ? 'Give each <img> a srcset with widths that match the layout and a sizes attribute, or ask the image CDN for the displayed width.' : '', items: ov,
    }));
    out.push(result('eco.image-lazy', ea.length > 2 ? 'warn' : ea.length ? 'info' : 'pass', 'Lazy loading', ea.length ? `${plural(ea.length, 'image')} far below the first screen load straight away (${fmtBytes(ea.reduce((a, x) => a + x.bytes, 0))})` : 'images below the first screen wait for the visitor', {
      fix: ea.length ? 'Add loading="lazy" to images below the first screen (never to the hero image).' : '', items: ea,
    }));
  } else {
    out.push(result('eco.image-oversized', 'skip', 'Oversized images', 'needs a browser'));
    out.push(result('eco.image-lazy', 'skip', 'Lazy loading', 'needs a browser'));
  }
  const media = assets.filter((a) => kindOf(a) === 'media');
  const mediaBytes = media.reduce((a, x) => a + x.transfer, 0);
  out.push(result('eco.video', mediaBytes > 2 * MB ? 'fail' : mediaBytes > 500 * KB ? 'warn' : 'pass', 'Video and audio on load', media.length ? `${fmtBytes(mediaBytes)} of video or audio downloads before anyone presses play (${plural(media.length, 'file')})` : 'no video or audio loads with the page', {
    fix: mediaBytes > 500 * KB ? 'Do not autoplay background video, or serve a short, heavily compressed loop (AV1 or H.265, 720p, under 1 MB) with preload="none" and a poster image, and skip it for prefers-reduced-motion and Save-Data. Embeds (YouTube, Vimeo) should load on click.' : '',
    items: media.sort((a, b) => b.transfer - a.transfer).map((a) => ({ url: a.url, note: fmtBytes(a.transfer), bytes: a.transfer })),
  }));

  // ---------------------------------------------------------------- fonts, scripts, third parties
  const fonts = assets.filter((a) => kindOf(a) === 'font');
  const fontBytes = fonts.reduce((a, x) => a + x.transfer, 0);
  out.push(result('eco.fonts', fontBytes > 300 * KB || fonts.length > 8 ? 'warn' : fontBytes > 150 * KB || fonts.length > 5 ? 'info' : 'pass', 'Web fonts', fonts.length ? `${plural(fonts.length, 'font file')}, ${fmtBytes(fontBytes)} across the pages sampled` : 'no web fonts', {
    fix: fontBytes > 150 * KB || fonts.length > 5 ? 'Fewer families and weights (a variable font often replaces four files), subset to the languages used (Latin for Danish), and self-host WOFF2. A system font stack costs nothing.' : '',
    items: fonts.sort((a, b) => b.transfer - a.transfer).map((a) => ({ url: a.url, note: fmtBytes(a.transfer), bytes: a.transfer })),
  }));
  const oldFonts = fonts.filter((a) => !/woff2/i.test(a.mimeType || '') && !/\.woff2(\?|$)/i.test(a.url));
  if (fonts.length) out.push(result('eco.font-format', oldFonts.length ? 'warn' : 'pass', 'WOFF2 fonts', oldFonts.length ? `${plural(oldFonts.length, 'font')} not WOFF2 (${fmtBytes(oldFonts.reduce((a, x) => a + x.transfer, 0))})` : 'every font is WOFF2', {
    fix: oldFonts.length ? 'Serve WOFF2 only; every current browser supports it and it is about 30% smaller than WOFF and far smaller than TTF.' : '', items: oldFonts.map((a) => ({ url: a.url, note: `${fmtBytes(a.transfer)} ${a.mimeType || ''}`.trim(), bytes: a.transfer })),
  }));
  const jsMed = median(summaries.map((s) => s.by.js));
  const scripts = assets.filter((a) => kindOf(a) === 'js').sort((a, b) => b.transfer - a.transfer);
  out.push(result('eco.javascript', jsMed > 1 * MB ? 'fail' : jsMed > 500 * KB ? 'warn' : 'pass', 'JavaScript', `median ${fmtBytes(jsMed)} of JavaScript per page on the wire, ${plural(scripts.length, 'file')} in all`, {
    fix: jsMed > 500 * KB ? 'Every kilobyte of script is also CPU time on the visitor\'s device. Split bundles per route, drop unused libraries and polyfills, and load widgets (chat, maps, video) on interaction.' : '',
    items: scripts.slice(0, 30).map((a) => ({ url: a.url, note: `${fmtBytes(a.transfer)}${isFirstParty(a.url, siteHost) ? '' : ' · third party'}`, bytes: a.transfer })),
  }));
  const thirdMed = median(summaries.map((s) => (s.bytes ? s.third / s.bytes : 0)));
  const hosts = new Map();
  for (const a of assets) if (!isFirstParty(a.url, siteHost)) { const h = new URL(a.url).host; hosts.set(h, (hosts.get(h) || 0) + a.transfer); }
  out.push(result('eco.third-party', thirdMed > 0.5 ? 'warn' : 'info', 'Third parties', `${Math.round(thirdMed * 100)}% of the bytes come from ${plural(hosts.size, 'other host')} (median)`, {
    fix: thirdMed > 0.5 ? 'Most of the weight is not yours. Question each tag (analytics, A/B testing, chat, social embeds), self-host what you keep and load the rest on interaction.' : '',
    items: [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([h, b]) => ({ url: h, note: fmtBytes(b), bytes: b })),
  }));

  // ---------------------------------------------------------------- delivery
  const uncompressed = assets.filter((a) => isText(a) && !a.encoding && a.size > 1400 && a.status === 200 && !estimate);
  out.push(result('eco.compression', uncompressed.length ? 'warn' : estimate ? 'skip' : 'pass', 'Text compression', estimate ? 'needs a browser' : uncompressed.length ? `${plural(uncompressed.length, 'text file')} served without gzip or Brotli (${fmtBytes(uncompressed.reduce((a, x) => a + x.size, 0))})` : 'HTML, CSS, JS, JSON and SVG are compressed', {
    fix: uncompressed.length ? 'Turn on Brotli (or gzip) for text types at the server or CDN; it typically cuts them by 70–80%.' : '',
    items: uncompressed.map((a) => ({ url: a.url, note: `${fmtBytes(a.size)} ${a.mimeType}`, bytes: a.size })),
  }));
  const statics = assets.filter((a) => ['css', 'js', 'image', 'font'].includes(kindOf(a)) && isFirstParty(a.url, siteHost) && a.status === 200);
  const short = statics.filter((a) => /no-store|no-cache/i.test(a.cacheControl || '') || (maxAge(a.cacheControl) ?? 0) < 86400);
  out.push(result('eco.caching', statics.length && short.length / statics.length > 0.3 ? 'warn' : short.length ? 'info' : 'pass', 'Browser caching', statics.length ? `${short.length} of ${statics.length} own CSS, JS, image and font files are cached for less than a day` : 'no own static files', {
    fix: short.length ? 'Fingerprinted files (name contains a hash) can be cached a year: "Cache-Control: public, max-age=31536000, immutable". Every repeat view then skips them.' : '',
    items: short.slice(0, 30).map((a) => ({ url: a.url, note: a.cacheControl || 'no cache-control', bytes: a.transfer })),
  }));
  if (!green || green.error) out.push(result('eco.green-hosting', 'skip', 'Green hosting', `Green Web Foundation lookup failed${green?.error ? `: ${green.error}` : ''}`));
  else out.push(result('eco.green-hosting', green.green ? 'pass' : 'warn', 'Green hosting', green.green ? `${siteHost} is on verified green hosting${green.hostedBy ? ` (${green.hostedBy})` : ''}` : `${siteHost} is not on hosting the Green Web Foundation can verify as green`, {
    fix: green.green ? '' : 'Ask the host for evidence of renewable power and register it with the Green Web Foundation (https://www.thegreenwebfoundation.org/tools/green-web-check/), or move to a verified provider. A CDN in front changes the answer only for what it serves.',
  }));
  return out;
}

export const STATUS_ORDER = { fail: 0, warn: 1, info: 2, pass: 3, skip: 4 };
export function countStatuses(rows) {
  const c = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}
