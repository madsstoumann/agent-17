# Changelog

All notable changes to the `seo-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/seo.mjs` crawls a site by following links (robots.txt respected, redirects recorded hop by hop), samples the sitemap URLs the links did not reach, and checks indexing (noindex, status codes, thin pages, URL hygiene, trailing-slash duplicates), sitemap and robots.txt consistency (URLs that redirect, are noindex, canonicalised elsewhere, blocked or on another host; indexable pages missing from the sitemap; orphans), links (broken internal and external links, links to redirects, chains, loops, temporary redirects), titles, descriptions, h1 and lang (missing, length, duplicates), canonical (missing, relative, other host, pointing at a bad URL), hreflang (codes, self reference, x-default, return links, targets, lang mismatch), Open Graph and twitter:card, and structured data (JSON-LD that does not parse, coverage, validator.schema.org on one page per template).
- Writes `report.md`, `report.json`, `findings.json` (the fix list in the shape audit-all's tasks.json uses) and `pages.csv`.
- Target folder per host (`<reports>/seo-audit/<host>/`) with `runs/<stamp>/`, `last-report.json` for an automatic "Since last run" section, and a hand-written `notes.md` shown in the report.
