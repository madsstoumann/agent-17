/**
 * Archive mode (--from-archive): which rows still mean what they say when every page comes from
 * an archive of served HTML, and which are skipped or degraded.
 *
 * Skipped: checks that need the network, timing or response headers (external links, og:image,
 * redirects, AI crawlers at the edge, Chrome renders), and the robots.txt, sitemap and llms.txt
 * rows when the archive does not hold those files. Degraded: checks that still run but see less
 * than a live run (statuses as archived, meta robots without X-Robots-Tag, served JSON-LD only).
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { result } from './checks.mjs';

/** Always skipped in archive mode: id -> [title, why]. */
export const ARCHIVE_SKIPPED = {
  'seo.broken-external': ['Broken external links', 'external links need the network'],
  'seo.og-image': ['og:image', 'each image\'s status and type need the network'],
  'seo.internal-redirects': ['Links to redirects', 'redirects need the live site'],
  'seo.redirect-chains': ['Redirect chains', 'redirects need the live site'],
  'seo.temporary-redirects': ['Temporary redirects', 'redirects need the live site'],
  'seo.ai-bot-access': ['AI crawlers at the edge', 'each crawler\'s user agent is sent to the live site'],
  'seo.ai-rendered-text': ['Text without JavaScript', 'pages are rendered in Chrome from the live site'],
  'seo.jsonld-client-side': ['JSON-LD added by JavaScript', 'pages are rendered in Chrome from the live site'],
  // An archive holds the pages one crawl fetched: a sitemap URL it did not reach is not an orphan.
  'seo.orphans': ['Orphan pages', 'an archive holds only the pages one crawl reached, so sitemap URLs that no archived page links to are not orphans'],
};

/** Skipped when the archive does not hold the file they read. */
const ROBOTS_ROWS = { 'seo.robots-txt': 'robots.txt', 'seo.robots-blocked-links': 'Links to disallowed paths', 'seo.ai-crawlers': 'AI crawlers in robots.txt', 'seo.content-signal': 'Content-Signal in robots.txt', 'seo.bingbot': 'Bing (feeds ChatGPT search and Copilot)' };
const SITEMAP_ROWS = { 'seo.sitemap': 'XML sitemap', 'seo.sitemap-status': 'Sitemap URLs answer 200', 'seo.sitemap-noindex': 'Noindex pages in the sitemap', 'seo.sitemap-canonical': 'Sitemap URLs canonicalised elsewhere', 'seo.sitemap-blocked': 'Sitemap URLs blocked by robots.txt', 'seo.sitemap-missing': 'Indexable pages missing from the sitemap', 'seo.sitemap-hosts': 'Sitemap hosts', 'seo.orphans': 'Orphan pages', 'seo.sitemap-lastmod': 'Sitemap lastmod' };
const LLMS_ROWS = { 'seo.llms-txt': 'llms.txt', 'seo.llms-full': 'llms-full.txt', 'seo.ai-txt': 'ai.txt' };

/** Still run, but see less than a live run: id -> why. */
export const ARCHIVE_DEGRADED = {
  'seo.broken-internal': 'statuses as archived; link targets the archive does not hold are not checked',
  'seo.start': 'X-Robots-Tag headers are not archived: noindex read from meta tags only',
  'seo.noindex': 'X-Robots-Tag headers are not archived: noindex read from meta tags only',
  'seo.jsonld-coverage': 'served HTML only: JSON-LD that JavaScript adds is not seen',
  'seo.jsonld-parse': 'served HTML only: JSON-LD that JavaScript adds is not seen',
  'seo.rich-required': 'served HTML only: JSON-LD that JavaScript adds is not seen',
  'seo.rich-recommended': 'served HTML only: JSON-LD that JavaScript adds is not seen',
  'seo.entity-markup': 'served HTML only: JSON-LD that JavaScript adds is not seen',
  'seo.schema-validator': 'the archived served HTML is posted, not the live URL or a rendered DOM',
};

/**
 * applyArchiveMode(rows, { robots, sitemap, llms, notArchivedLinks }) -> { rows, skipped: [{ id, title, why }], degraded: [{ id, title, why }] }
 * `robots`, `sitemap` and `llms` say whether that file was read (from the archive, or live with
 * --allow-live). Rows in the skipped lists are replaced by a skip row (added when the live run
 * would not have had one either, so the report names every check archive mode leaves out).
 */
export function applyArchiveMode(rows, { robots = false, sitemap = false, llms = false, notArchivedLinks = 0 } = {}) {
  const skip = new Map(Object.entries(ARCHIVE_SKIPPED).map(([id, [title, why]]) => [id, { title, why }]));
  const missing = (map, file) => { for (const [id, title] of Object.entries(map)) skip.set(id, { title, why: `${file || title} is not in the archive (--allow-live fetches it)` }); };
  if (!robots) missing(ROBOTS_ROWS, 'robots.txt');
  if (!sitemap) missing(SITEMAP_ROWS, 'the XML sitemap');
  if (!llms) missing(LLMS_ROWS); // each row names its own file (llms.txt, llms-full.txt, ai.txt)
  const out = [];
  const skipped = [];
  const degraded = [];
  const done = new Set();
  for (const r of rows) {
    const s = skip.get(r.id);
    if (s) {
      if (done.has(r.id)) continue;
      done.add(r.id);
      out.push({ ...result(r.id, 'skip', r.title || s.title, `skipped: archive mode (${s.why})`), archive: 'skipped' });
      skipped.push({ id: r.id, title: r.title || s.title, why: s.why });
      continue;
    }
    let why = ARCHIVE_DEGRADED[r.id];
    if (r.id === 'seo.llms-txt' && llms) why = 'links in llms.txt are not checked';
    if (r.id === 'seo.broken-internal' && notArchivedLinks) why = `statuses as archived; ${notArchivedLinks} link target${notArchivedLinks === 1 ? '' : 's'} the archive does not hold ${notArchivedLinks === 1 ? 'is' : 'are'} not checked, so a broken link among them is not counted here (a live run checks such targets for a status and reports them)`;
    if (why && r.status !== 'skip') {
      out.push({ ...r, evidence: `${r.evidence} (archive mode: ${why})`, archive: 'degraded' });
      degraded.push({ id: r.id, title: r.title, why });
    } else out.push(r);
  }
  // Checks that had no input to run on (no sitemap, no robots.txt) or that a live run reports
  // only when they find something (og:image without images): still named as skipped.
  for (const [id, s] of skip) {
    if (done.has(id)) continue;
    out.push({ ...result(id, 'skip', s.title, `skipped: archive mode (${s.why})`), archive: 'skipped' });
    skipped.push({ id, title: s.title, why: s.why });
  }
  return { rows: out, skipped, degraded };
}

/** The cover lines for report.md: where the pages came from, what was skipped and degraded. */
export function archiveCoverLines(info) {
  if (!info) return [];
  const out = [`> **Built from the archive of ${info.date}, not the live site.** Every page was read from \`${info.dir}\`; nothing on the site was fetched${info.live?.length ? `, except ${info.live.length} URL${info.live.length === 1 ? '' : 's'} the archive does not hold (--allow-live)` : ''}.`];
  if (info.skipped?.length) out.push(`> **Skipped (archive mode):** ${info.skipped.map((s) => s.title).join(', ')}.`);
  if (info.degraded?.length) out.push(`> **Degraded (archive mode):** ${info.degraded.map((d) => `${d.title} (${d.why})`).join('; ')}.`);
  if (info.notArchived?.length) {
    const links = Math.min(info.notArchivedLinks || 0, info.notArchived.length);
    const other = info.notArchived.length - links;
    const parts = [links && `${links} ${links === 1 ? 'is a link target' : 'are link targets'} on archived pages: a live run checks those for a status, so a broken link among them (a 404) is reported live but not counted here`, other && `${other} ${other === 1 ? 'is a URL' : 'are URLs'} the run asked for (sitemaps, redirect targets, llms.txt)`].filter(Boolean);
    out.push(`> **Not archived:** ${info.notArchived.length} URL${info.notArchived.length === 1 ? '' : 's'} are not in the archive and were not fetched${parts.length ? `: ${parts.join('; ')}` : ''} (listed in report.json under \`archive.notArchived\`).`);
  }
  if (info.masked) out.push(`> **Masked secrets:** ${info.masked} masked value${info.masked === 1 ? '' : 's'} (\`abcd…[masked]\`) in the archived pages are placeholders, not findings; URLs that hold one were not fetched.`);
  return out.flatMap((l) => [l, '']);
}
