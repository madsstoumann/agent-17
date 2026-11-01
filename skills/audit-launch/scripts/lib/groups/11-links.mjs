/**
 * 11. Links, mixed content, social previews & icons — a bounded crawl of the
 * site (start URL + sitemap sample), every link it finds checked, plus the
 * W3C and schema.org validators, share-preview tags and the icon set.
 */
import { result } from '../registry.mjs';
import { crawlSite, checkLinks, recheckPages } from '../crawl.mjs';
import { sampleSitemapUrls } from '../robots.mjs';
import { w3cValidate, schemaValidate } from '../services.mjs';
import { fetchImageMeta } from '../images.mjs';
import { hostOf, sameUrlModuloSlash } from '../http.mjs';
import { isStagingHost } from '../cli.mjs';

const short = (u, n = 70) => (u.length > n ? `${u.slice(0, n)}…` : u);

export default {
  id: 'links',
  title: 'Links, mixed content, social previews & icons',
  phase: 'B',
  budget: 300000,
  async run(ctx) {
    const { http, finalUrl, hostname, page, sitemap, opts, remote, log, productionHost, production, origin } = ctx;
    const meta = page.meta || {};
    const out = [];

    // --- W3C and schema.org first, before the crawl loads the origin (by URL when public; the fetched HTML is posted when private or when the validator cannot reach the site)
    const w3cLink = `https://validator.w3.org/nu/?doc=${encodeURIComponent(finalUrl)}`;
    if (remote || page.html) {
      let w = await w3cValidate(http, remote ? { url: finalUrl } : { html: page.html });
      const unreachable = (x) => x.ok && (x.messages || []).some((m) => m.type === 'non-document-error');
      if ((!w.ok || unreachable(w)) && page.html) w = { ...(await w3cValidate(http, { html: page.html })), fellBack: true };
      if (w.ok && !unreachable(w)) {
        const s = w.summary;
        await ctx.saveRaw('w3c.json', { url: finalUrl, mode: w.mode, messages: w.messages });
        ctx.scoreboard.w3c = { errors: s.errors, warnings: s.warnings, distinct: s.distinct, fatal: s.fatal, link: w3cLink };
        const top = s.groups.filter((g) => g.type === 'error').slice(0, 5).map((g) => `${g.count}× ${g.message.slice(0, 90)}`).join(' · ');
        out.push(result('links.w3c', s.fatal ? 'fail' : s.errors ? 'warn' : s.warnings ? 'info' : 'pass', 'W3C HTML validator', `${s.errors} error${s.errors === 1 ? '' : 's'}, ${s.warnings} warning${s.warnings === 1 ? '' : 's'} (${s.distinct} distinct)${top ? ` — ${top}` : ''}${w.mode === 'html' ? (w.fellBack ? ' (validator could not fetch the URL; the fetched HTML was posted instead)' : ' (HTML posted; private host)') : ''}`, { fix: s.errors ? 'Group by message (the raw w3c.json has them all): most are one template fix each — e.g. link[as] without rel, unknown CSS values, block elements inside inline ones.' : '', link: w3cLink, data: { groups: s.groups.slice(0, 30) } }));
      } else {
        ctx.scoreboard.w3c = { errors: null, error: w.error, link: w3cLink };
        out.push(result('links.w3c', 'skip', 'W3C HTML validator', `not validated: ${w.error}`, { link: w3cLink }));
      }
    } else {
      out.push(result('links.w3c', 'skip', 'W3C HTML validator', 'no HTML to validate', { link: w3cLink }));
    }
    const sdoLink = `https://validator.schema.org/#url=${encodeURIComponent(finalUrl)}`;
    if (remote || page.html) {
      let sc = await schemaValidate(http, remote ? { url: finalUrl } : { html: page.html });
      if ((!sc.ok || sc.raw?.fetchError) && page.html) sc = { ...(await schemaValidate(http, { html: page.html })), fellBack: true };
      if (sc.ok && !sc.raw?.fetchError) {
        await ctx.saveRaw('schema.json', sc.raw);
        ctx.scoreboard.schema = { objects: sc.objects, errors: sc.errors, warnings: sc.warnings, types: sc.types, link: sdoLink };
        const nodeErrs = sc.nodes.flatMap((n) => n.errors.map((e) => `${n.types.join('/')}: ${(e.message || e.errorType || JSON.stringify(e)).toString().slice(0, 80)}`)).slice(0, 4);
        out.push(sc.objects === 0
          ? result('links.schema-org', 'info', 'schema.org validator', 'no structured data found on the start page', { fix: 'Optional: add Organization + WebSite JSON-LD on the homepage; product/article types where they apply.', link: sdoLink })
          : result('links.schema-org', sc.errors ? 'warn' : 'pass', 'schema.org validator', `${sc.objects} object(s) (${sc.types.join(', ')}), ${sc.errors} error${sc.errors === 1 ? '' : 's'}, ${sc.warnings} warning${sc.warnings === 1 ? '' : 's'}${nodeErrs.length ? ` — ${nodeErrs.join('; ')}` : ''}${sc.fellBack ? ' (validator could not fetch the URL; the fetched HTML was posted instead)' : ''}`, { fix: sc.errors ? 'Fix the reported properties; then run the Rich Results Test for what Google will show.' : '', link: sdoLink }));
      } else {
        ctx.scoreboard.schema = { objects: null, error: sc.error, link: sdoLink };
        out.push(result('links.schema-org', 'skip', 'schema.org validator', `not validated: ${sc.error || sc.raw?.fetchError}`, { link: sdoLink }));
      }
    }


    // --- crawl
    const seeds = sampleSitemapUrls(sitemap.urls, { startUrl: finalUrl, n: Math.min(50, opts.maxPages) });
    const crawl = await crawlSite(http, { startUrl: finalUrl, seeds, maxPages: opts.maxPages, concurrency: opts.concurrency, log });
    ctx.crawl = crawl;
    const pages = crawl.pages;
    // Pages that failed under parallel load are tried again one at a time: a capacity problem is a different finding from a broken page.
    const recheck = await recheckPages(http, pages, { max: 20 });
    const html = pages.filter((p) => p.status === 200 && /html/.test(p.contentType));
    const s5 = pages.filter((p) => p.status >= 500 || p.status === 0);
    const s4 = pages.filter((p) => p.status >= 400 && p.status < 500);
    const from = (u) => [...(crawl.internalLinks.get(u) || [])][0];
    const capacity = recheck.transient.length ? `; ${recheck.transient.length} page(s) answered 5xx/timeout under ${opts.concurrency} parallel requests but 200 alone — origin capacity, not broken pages` : '';
    out.push(result('links.crawl-summary', s5.length ? 'fail' : (s4.length || recheck.transient.length) ? 'warn' : 'pass', 'Crawl', `${pages.length} pages fetched${crawl.truncated ? ` (capped at --max-pages ${opts.maxPages})` : ''}: ${html.length} HTML 200, ${s4.length} 4xx, ${s5.length} 5xx/unreachable${s5.length ? ` — ${s5.slice(0, 3).map((p) => `${p.status || p.error} ${short(p.url)}${from(p.url) ? ` (from ${short(from(p.url), 50)})` : ''}`).join('; ')}` : ''}${capacity}`, { fix: s5.length ? 'Pages that throw or time out even when fetched alone must be fixed before launch.' : recheck.transient.length ? 'The origin buckles under a handful of parallel renders: add instances, cache HTML at the edge, or warm the cache before launch.' : s4.length ? 'Fix or redirect the linked pages that 404.' : '', blocker: s5.length > 0 ? true : undefined, data: { truncated: crawl.truncated, transient: recheck.transient, statuses: pages.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {}) } }));

    // --- internal links not fetched as pages (files, beyond the cap)
    const fetched = new Set(pages.map((p) => p.url));
    const unfetched = [...crawl.internalLinks.keys()].filter((u) => !fetched.has(u));
    const internalChecked = await checkLinks(http, unfetched, { concurrency: opts.concurrency, max: 300, external: false });
    // Internal links that failed with 5xx/timeout get one sequential retry too.
    const retry = internalChecked.filter((c) => !c.ok && (c.status === 0 || c.status >= 500));
    for (const c of retry) { const r = await http.get(c.url, { redirect: 'follow', maxBytes: 0, timeout: 20000, retry: 0 }); if (r.status >= 200 && r.status < 400) { c.ok = true; c.status = r.status; c.transient = true; } }
    const brokenInternal = [...s4.map((p) => ({ url: p.url, status: p.status })), ...internalChecked.filter((c) => !c.ok).map((c) => ({ url: c.url, status: c.status || c.error }))];
    out.push(brokenInternal.length
      ? result('links.internal-broken', brokenInternal.some((b) => Number(b.status) >= 500) ? 'fail' : 'warn', 'Broken internal links', `${brokenInternal.length}: ${brokenInternal.slice(0, 5).map((b) => `${b.status} ${short(b.url)}${from(b.url) ? ` ← ${short(from(b.url), 40)}` : ''}`).join('; ')}`, { fix: 'Fix the href or redirect the old URL; each is a dead end for users and crawlers.', data: { broken: brokenInternal.map((b) => ({ ...b, from: [...(crawl.internalLinks.get(b.url) || [])].slice(0, 5) })) } })
      : result('links.internal-broken', 'pass', 'Broken internal links', `none among ${crawl.internalLinks.size} internal links`));

    // --- external links
    const externals = [...crawl.externalLinks.keys()];
    if (externals.length) {
      const ext = await checkLinks(http, externals, { concurrency: opts.concurrency, max: opts.maxExternal, external: true });
      const broken = ext.filter((c) => !c.ok);
      const blocked = ext.filter((c) => c.blocked);
      out.push(broken.length
        ? result('links.external-broken', 'warn', 'Broken external links', `${broken.length} of ${ext.length} checked: ${broken.slice(0, 5).map((b) => `${b.status || b.error} ${short(b.url)}`).join('; ')}${blocked.length ? ` (+${blocked.length} blocked the check: verify by hand)` : ''}`, { fix: 'Replace or remove dead outbound links.', data: { broken: broken.map((b) => ({ url: b.url, status: b.status, error: b.error, from: [...(crawl.externalLinks.get(b.url) || [])].slice(0, 3) })), blocked: blocked.map((b) => b.url) } })
        : result('links.external-broken', 'pass', 'Broken external links', `none among ${ext.length} checked${externals.length > ext.length ? ` (of ${externals.length})` : ''}${blocked.length ? `; ${blocked.length} refused HEAD/GET from a script (403/429) — verify by hand` : ''}`));
    } else {
      out.push(result('links.external-broken', 'info', 'Broken external links', 'no external links found'));
    }

    // --- per-page hygiene
    const mixed = html.filter((p) => p.mixedContent > 0);
    out.push(mixed.length
      ? result('links.mixed-content', 'fail', 'Mixed content', `${mixed.length} page(s) load http:// resources: ${mixed.slice(0, 3).map((p) => `${short(p.url, 50)} → ${p.mixedContentSamples[0]}`).join('; ')}`, { fix: 'Serve every script, style, image, frame and media over https; browsers block or downgrade the page otherwise.', blocker: true })
      : result('links.mixed-content', 'pass', 'Mixed content', `none on ${html.length} pages`));
    const noAlt = html.filter((p) => p.imgNoAlt > 0);
    const imgTotal = html.reduce((a, p) => a + (p.imgCount || 0), 0);
    const emptyAlt = html.reduce((a, p) => a + (p.imgEmptyAlt || 0), 0);
    const emptyShare = imgTotal ? emptyAlt / imgTotal : 0;
    out.push(noAlt.length
      ? result('links.images-alt', 'warn', 'Images without alt', `${noAlt.reduce((a, p) => a + p.imgNoAlt, 0)} images on ${noAlt.length} page(s), e.g. ${noAlt.slice(0, 3).map((p) => `${short(p.url, 50)} (${p.imgNoAlt})`).join(', ')}`, { fix: 'Every <img> needs an alt attribute: descriptive text, or alt="" when decorative.' })
      : result('links.images-alt', 'pass', 'Images without alt', `every image on ${html.length} pages has an alt attribute`));
    // alt="" is valid for decoration; a site where almost every image is "decorative" has no image descriptions at all.
    if (imgTotal >= 20 && emptyShare > 0.5) out.push(result('links.images-empty-alt', 'warn', 'Images with empty alt', `${emptyAlt} of ${imgTotal} images (${Math.round(emptyShare * 100)}%) carry alt="" — content images seem to have no description`, { fix: 'Give content images (product shots, article images, people) real alt text from the CMS; keep alt="" only for decoration.' }));
    else if (imgTotal) out.push(result('links.images-empty-alt', 'info', 'Images with empty alt', `${emptyAlt} of ${imgTotal} images carry alt="" (decorative)`));
    const noTitle = html.filter((p) => !p.title);
    const noDesc = html.filter((p) => !p.description);
    const titleCounts = html.reduce((a, p) => { if (p.title) a[p.title] = (a[p.title] || 0) + 1; return a; }, {});
    const dupTitles = Object.entries(titleCounts).filter(([, n]) => n > 1);
    const issues = [];
    if (noTitle.length) issues.push(`${noTitle.length} without <title>`);
    if (noDesc.length) issues.push(`${noDesc.length} without meta description`);
    if (dupTitles.length) issues.push(`${dupTitles.length} duplicated title(s): "${dupTitles[0][0].slice(0, 50)}" ×${dupTitles[0][1]}`);
    out.push(issues.length ? result('links.titles-descriptions', 'warn', 'Titles & descriptions across pages', issues.join('; '), { fix: 'Unique title and description per page; templates should fall back to page name + site name.', data: { noTitle: noTitle.map((p) => p.url), noDesc: noDesc.map((p) => p.url), dupTitles } }) : result('links.titles-descriptions', 'pass', 'Titles & descriptions across pages', `all ${html.length} pages have a unique title and a description`));
    const noH1 = html.filter((p) => p.h1Count === 0);
    out.push(result('links.h1', noH1.length ? 'info' : 'pass', 'H1 across pages', noH1.length ? `${noH1.length} page(s) without an h1, e.g. ${noH1.slice(0, 3).map((p) => short(p.url, 50)).join(', ')}` : `every page has an h1`));
    const ld = html.filter((p) => p.jsonLdTypes.length);
    const types = ld.reduce((a, p) => { for (const t of p.jsonLdTypes) a[t] = (a[t] || 0) + 1; return a; }, {});
    out.push(result('links.jsonld', 'info', 'Structured data across pages', ld.length ? `${ld.length}/${html.length} pages carry JSON-LD: ${Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ×${n}`).join(', ')}` : 'no JSON-LD on any crawled page', { fix: ld.length ? '' : 'Optional but valuable: Organization/WebSite on the homepage, Article/Product/Event/BreadcrumbList where they apply.' }));

    // --- social previews
    const og = meta.og || {}; const tw = meta.twitter || {};
    const missing = [['og:title', og.title], ['og:description', og.description], ['og:image', og.image], ['og:url', og.url], ['twitter:card', tw.card]].filter(([, v]) => !v).map(([k]) => k);
    out.push(missing.length
      ? result('social.og', 'warn', 'Share preview tags', `missing ${missing.join(', ')}${og.title ? ` (og:title "${og.title.slice(0, 60)}")` : ''}`, { fix: 'Add the Open Graph and Twitter card tags on every page template; without og:image the share is a bare link.' })
      : result('social.og', 'pass', 'Share preview tags', `og:title "${og.title.slice(0, 60)}", og:type ${og.type || '—'}, twitter:card ${tw.card}`));
    if (og.image) {
      const im = await fetchImageMeta(http, og.image, { maxBytes: 5 * 1024 * 1024 });
      const w = im.size?.width; const h = im.size?.height;
      const stagingImg = isStagingHost(hostOf(og.image)) && hostOf(og.image) !== hostname;
      if (im.status !== 200 || !im.isImage) out.push(result('social.og-image', 'fail', 'og:image', `${og.image} → ${im.status || im.error}${im.contentType ? ` ${im.contentType}` : ''}`, { fix: 'og:image must be an absolute https URL to a real image (1200×630 recommended).' }));
      else if (w && h && (w < 1200 || h < 630)) out.push(result('social.og-image', 'warn', 'og:image', `${w}×${h} ${im.size.type} (${(im.bytes / 1024).toFixed(0)} kB)`, { fix: 'Use at least 1200×630 (1.91:1) so LinkedIn/Facebook show the large card.' }));
      else out.push(result('social.og-image', w && h && Math.abs(w / h - 1.91) > 0.25 ? 'info' : 'pass', 'og:image', `${w && h ? `${w}×${h} ` : ''}${im.size?.type || im.contentType} (${(im.bytes / 1024).toFixed(0)} kB)${w && h && Math.abs(w / h - 1.91) > 0.25 ? ' — not 1.91:1, expect cropping in link previews' : ''}${stagingImg ? ` — hosted on a staging host (${hostOf(og.image)})` : ''}`, { fix: w && h && Math.abs(w / h - 1.91) > 0.25 ? 'Provide a 1200×630 variant for previews.' : '', beforeProduction: stagingImg || undefined }));
    }
    if (og.url) {
      const same = sameUrlModuloSlash(og.url, finalUrl) || sameUrlModuloSlash(og.url, meta.canonical || '');
      const ogHost = hostOf(og.url);
      if (same) out.push(result('social.og-url', 'pass', 'og:url', og.url));
      else if (ogHost === productionHost && !production) out.push(result('social.og-url', 'info', 'og:url', `already points at the production host: ${og.url}`));
      else out.push(result('social.og-url', ogHost !== hostname ? 'warn' : 'info', 'og:url', `${og.url} differs from the page URL / canonical`, { fix: 'og:url should equal the canonical URL of the page.', beforeProduction: isStagingHost(ogHost) && ogHost !== hostname ? true : undefined }));
    }

    // --- icons and manifest
    const icons = meta.icons || [];
    const fav = await http.get(`${origin}/favicon.ico`, { redirect: 'follow', maxBytes: 0, timeout: 10000 });
    const relIcons = icons.filter((i) => /(^|\s)icon(\s|$)/i.test(i.rel) && !/apple/i.test(i.rel));
    out.push(fav.status === 200 || relIcons.length
      ? result('icons.favicon', 'pass', 'Favicon', `${relIcons.length ? `${relIcons.length} rel=icon (${relIcons.map((i) => i.type || i.sizes || 'ico').join(', ')})` : ''}${fav.status === 200 ? `${relIcons.length ? '; ' : ''}/favicon.ico 200` : ' — /favicon.ico missing (browsers and bookmark tools still request it)'}`, { fix: fav.status === 200 ? '' : 'Also serve /favicon.ico; many tools ignore <link rel="icon">.' })
      : result('icons.favicon', 'warn', 'Favicon', 'no <link rel="icon"> and /favicon.ico is missing', { fix: 'Add an SVG icon plus /favicon.ico (RealFaviconGenerator makes the whole set).' }));
    const apple = icons.find((i) => /apple-touch-icon/i.test(i.rel));
    if (apple) {
      const im = await fetchImageMeta(http, apple.href);
      out.push(result('icons.apple-touch', im.status === 200 && im.isImage ? (im.size?.width === 180 ? 'pass' : 'info') : 'warn', 'Apple touch icon', im.status === 200 && im.isImage ? `${im.size?.width || '?'}×${im.size?.height || '?'} ${im.size?.type || ''}` : `${apple.href} → ${im.status || im.error}`, { fix: im.status === 200 ? (im.size?.width === 180 ? '' : '180×180 PNG is the size iOS uses.') : 'The linked apple-touch-icon must exist.' }));
    } else {
      out.push(result('icons.apple-touch', 'info', 'Apple touch icon', 'no apple-touch-icon link (iOS home-screen bookmarks get a screenshot instead)', { fix: 'Add <link rel="apple-touch-icon" href="/apple-touch-icon.png"> (180×180).' }));
    }
    if (meta.manifest) {
      const m = await http.get(meta.manifest, { redirect: 'follow', maxBytes: 256 * 1024, timeout: 10000 });
      let j = null; try { j = m.body ? JSON.parse(m.body) : null; } catch { /* invalid */ }
      if (m.status !== 200 || !j) out.push(result('icons.manifest', 'warn', 'Web manifest', `${meta.manifest} → ${m.status}${m.status === 200 ? ', not valid JSON' : ''}`, { fix: 'The manifest must be reachable and valid JSON (application/manifest+json).' }));
      else {
        const sizes = (j.icons || []).map((i) => i.sizes || '').join(' ');
        const problems = [];
        if (!j.name && !j.short_name) problems.push('no name');
        if (!j.start_url) problems.push('no start_url');
        if (!/192x192/.test(sizes)) problems.push('no 192×192 icon');
        if (!/512x512/.test(sizes)) problems.push('no 512×512 icon');
        out.push(result('icons.manifest', problems.length ? 'info' : 'pass', 'Web manifest', problems.length ? `${meta.manifest}: ${problems.join(', ')}` : `${j.name || j.short_name}, ${(j.icons || []).length} icons, start_url ${j.start_url}`, { fix: problems.length ? 'Only matters for install prompts / PWA; add name, start_url and 192 + 512 icons if that is wanted.' : '' }));
      }
    } else {
      out.push(result('icons.manifest', 'info', 'Web manifest', 'no <link rel="manifest"> (only needed for installable/PWA behaviour)'));
    }
    return out;
  },
};
