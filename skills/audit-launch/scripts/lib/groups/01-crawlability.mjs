/**
 * 1. Crawlability & staging leftovers — the launch failure that happens most:
 * a noindex, a Disallow: /, a canonical or sitemap still pointing at staging.
 * On dev/staging these are expected; they are marked beforeProduction so the
 * report turns them into the launch-day checklist instead of failing them.
 */
import { result } from '../registry.mjs';
import { isStagingHost } from '../cli.mjs';
import { hostOf, sameUrlModuloSlash, pLimit } from '../http.mjs';
import { extractHosts, extractLinks, extractAssets, extractMeta } from '../html.mjs';
import { isDisallowedForAll } from '../robots.mjs';

const LANG_RE = /^([a-z]{2,3}(-[A-Za-z]{2,4}(-[A-Za-z0-9]{2,8})?)?|x-default)$/;

function robotsDirectives(value) {
  return String(value || '').toLowerCase().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

export default {
  id: 'crawl',
  title: 'Crawlability & staging leftovers',
  phase: 'B',
  budget: 90000,
  async run(ctx) {
    const { http, page, robots, sitemap, hostname, finalUrl, productionHost, production } = ctx;
    const meta = page.meta || {};
    const out = [];
    const limit = pLimit(4);

    // --- index directives (header and meta)
    const xr = robotsDirectives(page.headers['x-robots-tag']);
    if (xr.includes('noindex') || xr.includes('none')) out.push(result('crawl.x-robots-tag', 'fail', 'X-Robots-Tag header', `x-robots-tag: ${page.headers['x-robots-tag']}`, { fix: 'Remove the noindex header on the production site (usually a hosting/env setting or nuxt-robots / SEO package "indexable" flag).', beforeProduction: true }));
    else if (xr.includes('nofollow')) out.push(result('crawl.x-robots-tag', 'warn', 'X-Robots-Tag header', `x-robots-tag: ${page.headers['x-robots-tag']}`, { fix: 'nofollow on the whole site stops link equity flowing; remove it on production.', beforeProduction: true }));
    else out.push(result('crawl.x-robots-tag', 'pass', 'X-Robots-Tag header', xr.length ? `x-robots-tag: ${page.headers['x-robots-tag']}` : 'no X-Robots-Tag header'));

    const mr = robotsDirectives([meta.robots, meta.googlebot].filter(Boolean).join(','));
    if (mr.includes('noindex') || mr.includes('none')) out.push(result('crawl.meta-robots', 'fail', 'Meta robots', `<meta name="robots" content="${meta.robots || meta.googlebot}">`, { fix: 'Remove noindex from the production build; keep it on dev/stage only.', beforeProduction: true }));
    else if (mr.includes('nofollow')) out.push(result('crawl.meta-robots', 'warn', 'Meta robots', `<meta name="robots" content="${meta.robots}">`, { fix: 'Remove nofollow on production.', beforeProduction: true }));
    else out.push(result('crawl.meta-robots', 'pass', 'Meta robots', meta.robots ? `content="${meta.robots}"` : 'no robots meta tag (indexable)'));

    // --- robots.txt
    if (robots.status === 404 || (robots.status === 200 && !robots.parsed)) {
      out.push(result('crawl.robots-txt', 'warn', 'robots.txt', robots.status === 404 ? 'no robots.txt (404)' : `robots.txt is not plain text (${robots.contentType})`, { fix: 'Serve a robots.txt with at least "User-agent: *", "Allow: /" and a "Sitemap:" line.' }));
    } else if (robots.status !== 200) {
      out.push(result('crawl.robots-txt', 'warn', 'robots.txt', `robots.txt answers ${robots.status}${robots.error ? ` (${robots.error})` : ''}`, { fix: 'robots.txt must answer 200 (or 404); a 5xx makes Google stop crawling the whole site.' }));
    } else if (isDisallowedForAll(robots.parsed)) {
      out.push(result('crawl.robots-txt', 'fail', 'robots.txt', 'User-agent: * / Disallow: / — every crawler is blocked', { fix: 'Replace with Allow: / on production and add the Sitemap: line.', beforeProduction: true }));
    } else {
      const sm = robots.parsed.sitemaps || [];
      out.push(result('crawl.robots-txt', sm.length ? 'pass' : 'info', 'robots.txt', `${robots.parsed.groups.length} group(s), ${sm.length} Sitemap line(s)${robots.parsed.groups.some((g) => g.disallow.length) ? `, disallows: ${robots.parsed.groups.flatMap((g) => g.disallow).slice(0, 5).join(' ')}` : ''}`, { fix: sm.length ? '' : 'Add "Sitemap: <absolute url>" so crawlers find the sitemap without Search Console.' }));
    }

    // --- sitemap
    const okSources = sitemap.sources.filter((s) => s.status === 200 && s.kind !== 'unknown');
    if (!sitemap.urls.length) {
      out.push(result('crawl.sitemap', 'warn', 'XML sitemap', okSources.length ? 'sitemap found but it lists no URLs' : `no sitemap at ${sitemap.candidates.map((c) => new URL(c).pathname).join(', ')}${sitemap.declared.length ? '' : ' (and robots.txt declares none)'}`, { fix: 'Generate a sitemap (index + per-section files for big sites), declare it in robots.txt and submit it in Search Console on launch day.' }));
    } else {
      out.push(result('crawl.sitemap', 'pass', 'XML sitemap', `${sitemap.urls.length}${sitemap.truncated ? '+' : ''} URLs in ${okSources.length} file(s)${sitemap.indexes?.length ? ` via ${sitemap.indexes.length} index` : ''}${sitemap.truncated ? ' (truncated at the cap)' : ''}`, { data: { sources: sitemap.sources } }));
      const foreign = [...new Set(sitemap.urls.map(hostOf).filter((h) => h && h !== hostname && h !== ctx.host))];
      if (foreign.length) {
        const onlyProduction = foreign.every((h) => h === productionHost);
        if (onlyProduction && !production) out.push(result('crawl.sitemap-hosts', 'info', 'Sitemap hosts', `sitemap URLs already use the production host ${productionHost}`));
        else out.push(result('crawl.sitemap-hosts', 'fail', 'Sitemap hosts', `sitemap lists URLs on other hosts: ${foreign.slice(0, 5).join(', ')}`, { fix: 'A sitemap may only list URLs on its own host; generate it from the live hostname.', beforeProduction: foreign.some(isStagingHost) }));
      } else {
        out.push(result('crawl.sitemap-hosts', 'pass', 'Sitemap hosts', 'every sitemap URL is on this host'));
      }
      const sample = sitemap.urls.filter((u) => !sameUrlModuloSlash(u, finalUrl)).slice(0, 10);
      const statuses = await Promise.all(sample.map((u) => limit(async () => ({ url: u, status: (await http.head(u, { redirect: 'follow', timeout: 10000 })).status }))));
      const bad = statuses.filter((s) => s.status !== 200);
      out.push(bad.length
        ? result('crawl.sitemap-sample', bad.every((s) => s.status >= 300 && s.status < 400) ? 'warn' : 'fail', 'Sitemap URLs answer 200', `${bad.length} of ${statuses.length} sampled: ${bad.slice(0, 4).map((s) => `${s.status} ${s.url}`).join('; ')}`, { fix: 'A sitemap must list final, 200 URLs — no redirects, no 404s.' })
        : result('crawl.sitemap-sample', 'pass', 'Sitemap URLs answer 200', `${statuses.length} sampled, all 200`));
    }

    // --- canonical
    const canon = meta.canonical;
    if (!canon) out.push(result('crawl.canonical', 'warn', 'Canonical', 'no <link rel="canonical">', { fix: 'Add a self-referencing canonical on every page (absolute URL, production host).' }));
    else if (!/^https?:\/\//i.test(canon)) out.push(result('crawl.canonical', 'warn', 'Canonical', `canonical is not absolute: ${canon}`, { fix: 'Use an absolute URL.' }));
    else if (hostOf(canon) !== hostname && hostOf(canon) !== ctx.host) {
      const h = hostOf(canon);
      if (h === productionHost && !production) out.push(result('crawl.canonical', 'info', 'Canonical', `canonical already points at the production host: ${canon}`));
      else out.push(result('crawl.canonical', 'fail', 'Canonical', `canonical points at another host: ${canon}`, { fix: 'The canonical must name this site\'s live hostname, or Google will index the other one.', beforeProduction: isStagingHost(h) }));
    } else if (sameUrlModuloSlash(canon, finalUrl)) out.push(result('crawl.canonical', 'pass', 'Canonical', canon));
    else out.push(result('crawl.canonical', 'warn', 'Canonical', `canonical ${canon} differs from the page URL ${finalUrl}`, { fix: 'Check the canonical is self-referencing on every page (query strings, trailing slash, language prefix).' }));

    // --- hreflang
    const hl = meta.hreflang || [];
    if (!hl.length) out.push(result('crawl.hreflang', 'info', 'hreflang', 'no hreflang alternates (fine for a single-language site)'));
    else {
      const issues = [];
      const badLang = hl.filter((a) => !LANG_RE.test(a.lang));
      if (badLang.length) issues.push(`invalid codes: ${badLang.map((a) => a.lang).join(', ')}`);
      if (!hl.some((a) => sameUrlModuloSlash(a.href, finalUrl))) issues.push('no self-referencing alternate');
      if (!hl.some((a) => a.lang === 'x-default')) issues.push('no x-default');
      const others = hl.filter((a) => !sameUrlModuloSlash(a.href, finalUrl)).slice(0, 3);
      const recip = await Promise.all(others.map((a) => limit(async () => {
        const r = await http.get(a.href, { redirect: 'follow', maxBytes: 512 * 1024, timeout: 10000 });
        const m = r.body ? extractMeta(r.body, a.href) : null;
        return { href: a.href, status: r.status, back: Boolean(m?.hreflang?.some((x) => sameUrlModuloSlash(x.href, finalUrl))) };
      })));
      const notBack = recip.filter((r) => r.status === 200 && !r.back);
      if (notBack.length) issues.push(`not reciprocal: ${notBack.map((r) => r.href).join(', ')}`);
      const dead = recip.filter((r) => r.status !== 200);
      if (dead.length) issues.push(`alternates not 200: ${dead.map((r) => `${r.status} ${r.href}`).join(', ')}`);
      out.push(result('crawl.hreflang', issues.length ? 'warn' : 'pass', 'hreflang', issues.length ? issues.join('; ') : `${hl.length} alternates (${hl.map((a) => a.lang).join(', ')}), reciprocal`, { fix: issues.length ? 'Every language version must list every other one plus itself, with x-default, and each must link back.' : '' }));
    }

    // --- page basics
    const title = meta.title || '';
    if (!title) out.push(result('crawl.title', 'fail', 'Title', 'no <title>', { fix: 'Every page needs a unique, descriptive title (10–60 characters).' }));
    else if (title.length < 10 || title.length > 60) out.push(result('crawl.title', 'warn', 'Title', `"${title}" (${title.length} chars)`, { fix: 'Aim for 10–60 characters; Google truncates longer titles.' }));
    else out.push(result('crawl.title', 'pass', 'Title', `"${title}" (${title.length} chars)`));
    const desc = meta.description || '';
    if (!desc) out.push(result('crawl.meta-description', 'warn', 'Meta description', 'none', { fix: 'Add a 50–160 character description; it is the snippet under the title in search results.' }));
    else if (desc.length < 50 || desc.length > 160) out.push(result('crawl.meta-description', 'warn', 'Meta description', `${desc.length} chars: "${desc.slice(0, 80)}${desc.length > 80 ? '…' : ''}"`, { fix: 'Aim for 50–160 characters.' }));
    else out.push(result('crawl.meta-description', 'pass', 'Meta description', `${desc.length} chars`));
    out.push(meta.lang ? result('crawl.lang', 'pass', 'html lang', `lang="${meta.lang}"`) : result('crawl.lang', 'warn', 'html lang', 'no lang attribute on <html>', { fix: 'Set <html lang="…">; screen readers and translation depend on it.' }));
    out.push(meta.viewport ? result('crawl.viewport', 'pass', 'Viewport meta', meta.viewport) : result('crawl.viewport', 'fail', 'Viewport meta', 'no viewport meta tag', { fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', blocker: true }));
    out.push(meta.charset ? result('crawl.charset', /utf-?8/i.test(meta.charset) ? 'pass' : 'info', 'Charset', meta.charset) : result('crawl.charset', 'warn', 'Charset', 'no <meta charset>', { fix: 'Declare <meta charset="utf-8"> first in <head>.' }));
    out.push(meta.h1Count === 1 ? result('crawl.h1', 'pass', 'H1', `one h1: "${(meta.h1s?.[0] || '').slice(0, 80)}"`) : meta.h1Count === 0 ? result('crawl.h1', 'warn', 'H1', 'no h1 on the start page', { fix: 'One h1 per page naming the page.' }) : result('crawl.h1', 'info', 'H1', `${meta.h1Count} h1 elements`, { fix: 'One h1 per page is the convention; more is allowed but muddles the outline.' }));

    // --- llms.txt (Lighthouse's agentic-browsing category checks it)
    const llms = await http.get(`${ctx.origin}/llms.txt`, { redirect: 'follow', maxBytes: 64 * 1024, timeout: 10000 });
    const llmsOk = llms.status === 200 && /text\/(plain|markdown)/i.test(llms.contentType) && /^#\s|\n#\s/.test(llms.body || '');
    out.push(result('crawl.llms-txt', 'info', 'llms.txt', llmsOk ? `present (${(llms.bytes / 1024).toFixed(1)} kB)` : 'absent — an optional markdown summary for AI agents (Lighthouse "Agentic browsing" scores it)', { fix: llmsOk ? '' : 'Optional: publish /llms.txt (llmstxt.org) if the site wants AI agents to find its key pages.', link: 'https://llmstxt.org/' }));

    // --- staging hostnames referenced anywhere on the start page
    const pool = [page.headers['content-security-policy'] || '', canon || '', meta.og?.url || '', meta.og?.image || '', ...(page.html ? extractLinks(page.html, finalUrl).map((l) => l.href) : []), ...(page.html ? extractAssets(page.html, finalUrl).all.map((a) => a.url) : []), ...sitemap.urls.slice(0, 500)];
    const stagingHosts = extractHosts(pool).filter((h) => h !== hostname && h !== ctx.host && isStagingHost(h));
    out.push(stagingHosts.length
      ? result('crawl.staging-refs', 'warn', 'Staging hostnames referenced', stagingHosts.slice(0, 8).join(', '), { fix: 'Links, assets, CSP sources and og:image that name a dev/stage host will break or leak once that environment is gone.', beforeProduction: true })
      : result('crawl.staging-refs', 'pass', 'Staging hostnames referenced', 'none found in links, assets, CSP, canonical, og tags or sitemap'));
    return out;
  },
};
