# Changelog

All notable changes to the `audit-seo` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.7.1] - 2026-11-10

### Changed
- The consent-banner list is the new shared `lib/consent.mjs` (identical in audit-seo, plan-geo, audit-privacy and audit-a11y, tested), so a banner tool added once is left out by every skill. No change in what is counted.

## [2.7.0] - 2026-11-10

### Changed
- "Text without JavaScript" compares the served text with the rendered page's visible text only: consent banners (Cookie Information, Cookiebot, OneTrust, Usercentrics and other common tools) and hidden text (`display: none`, `visibility: hidden`, closed `<details>`, the `hidden` attribute) are no longer counted, and only visible headings are.
- `--save-html`: the page that answers 200 gets the plain slug and a redirect stub of the same address gets the `-x` slug, not the other way round. robots.txt, the sitemaps and llms.txt are saved as `<name>.gz` (`robots.txt.gz`, `sitemap.xml.gz`), not `<name>.html.gz`. `--from-archive` reads both namings.
- `--from-archive`: the orphan pages row is listed as skipped (an archive crawl is not limited like a live one, so pages look orphaned that are linked from pages outside the archive). The broken internal links row says a broken link to a page the archive does not hold is not counted, and the archive cover note lists link targets not archived apart from other URLs.
- `rich.mjs`: Event subtypes (ExhibitionEvent, MusicEvent, TheaterEvent, Festival, EventSeries and the rest of schema.org's list) get Google's Event rules, as Event does.

## [2.6.2] - 2026-11-10

### Fixed
- Archive mode: the skipped `llms-full.txt` and `ai.txt` rows now name their own file instead of saying "llms.txt is not in the archive". Tested in `archive.test.mjs`.

## [2.6.1] - 2026-11-10

### Changed
- SKILL.md says pages without a `<title>` are fetched again before `seo.title-missing` counts them.

## [2.6.0] - 2026-11-10

### Added
- `--from-archive DIR`: the audit from a page archive (`index.json` plus `<slug>.html.gz`, as served, redirects not followed) instead of the live site. Links are followed between archived pages, then every archived page the links did not reach is read. A URL the archive does not hold is listed as not archived and not fetched; `--allow-live` fetches it. The HTML checks run as usual (titles, descriptions, headings, canonicals, hreflang, internal links, structured data, word counts). Checks that need the network, timing or headers are listed as `skipped: archive mode` (external links, og:image, redirect rows, AI crawlers at the edge, the Chrome renders, and robots.txt, sitemap and llms.txt rows when the archive lacks those files); broken internal links, noindex, structured data rows and the validator say what they cannot see ("degraded"). The cover of report.md, the stdout summary and `report.json` (`archive`) say the report was built from the archive of that date, not the live site. An archive run keeps its own baseline, `last-archive-report.json`. The URL may be left out (the archive's start page).
- Masked secrets in an archive (`abcd…[masked <type>]`, `abcd…[masked]`) are placeholders: never findings, and a URL that holds one is never fetched, live or not.
- `--save-html DIR`: writes every page the crawl fetched, plus robots.txt, sitemaps and llms.txt, as a page archive in that format, so plan-geo and later `--from-archive` runs read the same pages instead of fetching them again. Nothing is masked: redact before sharing.
- `--no-validate`: skip validator.schema.org (the same as `--no-remote`).

### Changed
- validator.schema.org is asked once per distinct page or HTML in a run.

## [2.5.3] - 2026-11-09

### Fixed
- `seo.title-missing` no longer fails on a one-off answer. A page that comes back as HTML without a `<title>` is fetched again (twice, half a second and a second later) before it counts, and the first answer with a title is used. The retries stop once three pages still have no title after them, so a site whose pages really have none is not fetched three times over.

## [2.5.2] - 2026-11-09

### Fixed
- `--console --out DIR` writes the run's files to `DIR`. `--console` without `--report` always used a scratch folder in the system temp folder and ignored `--out`, and the scratch folder was removed at the end, so nothing was left where the user asked for it. The console list now ends with the report path when `--out` is given.

## [2.5.1] - 2026-11-07

### Changed
- Example hostnames in the docs, changelog and tests are placeholders now (example.com and similar).

## [2.5.0] - 2026-11-06

### Fixed
- `seo.og-image` no longer fails images whose host answers HEAD with 404 and GET with 200. og:image, external and internal link checks and llms.txt links now fall back to GET (body discarded) on any 4xx/5xx or no answer, and trust the GET. Sitecore's image edge (edge.sitecorecloud.io) answers HEAD 404 for a resized variant (`?h=1080&iar=0&w=1920`) it has not generated yet; all 40 og:images on example.com were reported as "not served as an image".
- `--geo` and the GEO readiness score now count `seo.jsonld-coverage`, `seo.sitemap-noindex`, `seo.sitemap-blocked`, `seo.canonical-target` and `seo.title-duplicate`. On example.com (no JSON-LD on any page, 9 noindex URLs in the sitemap) the GEO report said 95/100 with two warnings, and audit-all's compact PDF said structured data passed.
- `seo.freshness`, `seo.author` and `seo.schema-opportunities` recognise article-like pages without article markup: a news, blog or insights URL with its own slug and either a year in the path or a date written on the page ("November 24, 2022", "24. november 2022", 24.11.2022). Without a machine-readable date they are reported as "article-like pages without a machine-readable date" (warning). example.com's news pages were "no article pages recognised".

### Changed
- GEO readiness: info rows that point at something missing (llms.txt, structured data opportunities, dates and authors, sitemap lastmod, JSON-LD coverage, entity markup) are opportunities and count 0.75 instead of a full pass. The report lists them under the score.

## [2.4.0] - 2026-11-06

### Added
- GEO readiness score at the top of every full report and summary: the share of GEO rows that pass (pass and info 1, warn 0.5, fail 0, skipped left out). A summary of the checks, not a measure of AI citations.
- `--geo`: a GEO audit. report.md is titled "GEO audit" and shows the AI search rows first plus the indexing rows that decide what AI crawlers reach; report.json and findings.json keep everything, and each finding carries `"geo": true|false`.
- `seo.ai-bot-access` (AI crawlers at the edge), with `--bot-pages N` (default 3): the start page and one page per section fetched as a browser and with each AI crawler's user agent (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, GPTBot, ClaudeBot), bingbot and Googlebot, without the `--header` bypass. A refused AI search crawler while Googlebot gets through is a warning (a CDN or WAF rule); a refused Googlebot means the edge checks bots by IP and the row says it cannot tell. On browser.style the edge refuses PerplexityBot on every page.
- `seo.ai-rendered-text` (Text without JavaScript): each rendered page's text, consent banners left out, against its served HTML. Pages that serve less than half of their text are a warning; a site where most rendered pages serve under a fifth fails (it builds its content in the browser, which most AI crawlers do not run).
- `seo.freshness` and `seo.author`: datePublished/dateModified (JSON-LD, article:* meta or a `<time datetime>` on an article) and an author on article pages; stale dates (over two years) as info.
- `seo.sitemap-lastmod`: no `<lastmod>` (info), or every lastmod the same day, a build stamp (warning).
- `seo.answer-structure` (info): question headings, lists and tables, walls of long paragraphs, long pages without subheadings.
- `seo.schema-opportunities` (info): pages that look like articles, FAQs or breadcrumb trails without the matching markup.
- `seo.bingbot`: bingbot blocked in robots.txt (warning, since ChatGPT search and Copilot draw on Bing), Bing verification tag, and what to ask about IndexNow.
- pages.csv: rendered_words, date_published, date_modified, author and question_headings columns.

### Changed
- `--render-pages` fills its remaining slots with one page per section that already has JSON-LD, so the text comparison sees every template.
- The skill description is under claude.ai's 1,024-character limit again.

## [2.3.1] - 2026-11-06

### Fixed
- Sitemaps are read depth first: a sitemap index's children come before the next sitemap declared in robots.txt, and a child that is also declared is read in its index's place. On example.dk the help centre's sitemap on another host (8,680 URLs) filled the 5,000-URL cap before www.example.dk/sitemap.xml was read, so only help pages could be sampled.

## [2.3.0] - 2026-11-06

### Added
- `--internal-links N` (default 300, `0` to skip): internal link targets the crawl found but did not fetch because `--pages` ran out are checked for a status (HEAD, redirects followed), so broken links on every crawled page are reported. The report says how many were checked this way.

### Changed
- The `--pages` budget is shared across language sections: each crawl wave takes links from the sections with the fewest pages so far, and at most half of what is left, so a section found late still gets pages. The sitemap sample is spread over the sections the same way. The report lists pages per language section when there is more than one.

### Fixed
- The crawl spent its whole budget on `/en/` pages of example.com and reported "every internal link answers" while the footer links of `/es-ES/` and `/de-DE/` pages returned 404 (audit-launch counted 161 such links). Both changes above fix it; a live re-run finds them.

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
