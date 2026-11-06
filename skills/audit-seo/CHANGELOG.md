# Changelog

All notable changes to the `audit-seo` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.3.1] - 2026-11-06

### Fixed
- Sitemaps are read depth first: a sitemap index's children come before the next sitemap declared in robots.txt, and a child that is also declared is read in its index's place. On 3.dk the help centre's sitemap on another host (8,680 URLs) filled the 5,000-URL cap before www.3.dk/sitemap.xml was read, so only help pages could be sampled.

## [2.3.0] - 2026-11-06

### Added
- `--internal-links N` (default 300, `0` to skip): internal link targets the crawl found but did not fetch because `--pages` ran out are checked for a status (HEAD, redirects followed), so broken links on every crawled page are reported. The report says how many were checked this way.

### Changed
- The `--pages` budget is shared across language sections: each crawl wave takes links from the sections with the fewest pages so far, and at most half of what is left, so a section found late still gets pages. The sitemap sample is spread over the sections the same way. The report lists pages per language section when there is more than one.

### Fixed
- The crawl spent its whole budget on `/en/` pages of wpp.com and reported "every internal link answers" while the footer links of `/es-ES/` and `/de-DE/` pages returned 404 (audit-launch counted 161 such links). Both changes above fix it; a live re-run finds them.

## [2.2.0] - 2026-11-01

### Added
- Pages rendered in headless Chrome (`--render-pages N`, default 8: the start page plus pages with no JSON-LD in the served HTML, one per section). JSON-LD that only JavaScript adds is used by every structured-data check, posted to validator.schema.org as the rendered DOM, and reported as the new warning "JSON-LD added by JavaScript" (`seo.jsonld-client-side`). Skipped with a note when no Chrome is found. Zero dependencies (DevTools protocol over Node 22's WebSocket, as in audit-eco); `--header` values go only to the site's own hosts.
- Google rich-result rules (`lib/rich.mjs`, `seo.rich-required` warn, `seo.rich-recommended` info, `seo.rich-notes` info): Google's required and recommended properties for Product (and offer prices), Review, AggregateRating, Article, BreadcrumbList, Event, FAQPage, JobPosting, LocalBusiness, Organization, Recipe, SoftwareApplication, VideoObject and Course, with a Rich Results Test link. FAQPage and HowTo get a note on Google's limits.
- `--schema-only` and local HTML files (`seo.mjs ./index.html`): structured data on that one page only, every validator error and warning on its own line. Replaces the validate-schema skill. These runs keep their own baseline (`last-schema-report.json`).

### Changed
- `lib/schema.mjs` is now shared with audit-launch as an identical copy (tested in both skills).
- Validator error notes include the property path and arguments (`Product offers.price: MISSING_REQUIRED (price)`).

## [2.1.0] - 2026-11-01

### Removed
- Fallbacks for the old skill names: results saved with the old `tool` value no longer count as a baseline, and the old env var names (`*_AUDIT_DEBUG`, `A11Y_AUDIT_CACHE`) are gone. An old reports folder is still moved once, silently.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `seo-audit` to `audit-seo`, so every audit skill starts with `audit` (folder, `name:`, `/skills:audit-seo`, the `tool` value in report.json, the X-Audit header and the reports folder `<reports>/audit-seo/`).
- The first run moves an existing `<reports>/seo-audit/` target folder to `<reports>/audit-seo/`, so notes.md, triage and the last result carry over. Results saved with `tool: "seo-audit"` still count as earlier runs for the baseline.
- Major version because the skill's name and invocation changed.

## [1.2.0] - 2026-11-01

### Added
- `--level error|warn|info` (comma list, e.g. `error,warn`; default `all`): report.md and the stdout summary show only rows at those levels, with a line saying what is hidden. report.json, findings.json and last-report.json keep every result, so baselines are unaffected.
- `--console`: a compact list on stdout, one line per issue, errors first, counts on top (`scripts/lib/levels.mjs`). The run's files go to a scratch folder in the system temp folder; last-report.json is still saved. `--console --report` gives both.

## [1.1.0] - 2026-10-30

### Added
- An "AI search (GEO)" section: `/llms.txt` (llmstxt.org structure, up to 20 same-site links checked), `/llms-full.txt`, `/ai.txt`, AI crawler rules in robots.txt (search crawlers such as OAI-SearchBot, Claude-SearchBot and PerplexityBot warn when blocked; training crawlers such as GPTBot, ClaudeBot, Google-Extended and CCBot are info), `Content-Signal` lines, and Organization/WebSite entity markup on the start page.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/seo.mjs` crawls a site by following links (robots.txt respected, redirects recorded hop by hop), samples the sitemap URLs the links did not reach, and checks indexing (noindex, status codes, thin pages, URL hygiene, trailing-slash duplicates), sitemap and robots.txt consistency (URLs that redirect, are noindex, canonicalised elsewhere, blocked or on another host; indexable pages missing from the sitemap; orphans), links (broken internal and external links, links to redirects, chains, loops, temporary redirects), titles, descriptions, h1 and lang (missing, length, duplicates), canonical (missing, relative, other host, pointing at a bad URL), hreflang (codes, self reference, x-default, return links, targets, lang mismatch), Open Graph and twitter:card, and structured data (JSON-LD that does not parse, coverage, validator.schema.org on one page per template).
- Writes `report.md`, `report.json`, `findings.json` (the fix list in the shape audit-all's tasks.json uses) and `pages.csv`.
- Target folder per host (`<reports>/seo-audit/<host>/`) with `runs/<stamp>/`, `last-report.json` for an automatic "Since last run" section, and a hand-written `notes.md` shown in the report.
