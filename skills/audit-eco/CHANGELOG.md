# Changelog

All notable changes to the `audit-eco` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.2.1] - 2026-11-07

### Changed
- Example hostnames in the docs, changelog and tests are placeholders now (example.com and similar).

## [2.2.0] - 2026-11-06

### Fixed
- `--pages` samples sitemap pages from different site sections (first path segment, locale prefix ignored) and skips noindex pages (meta robots or X-Robots-Tag). On example.dk every extra page was a noindex help guide, so the median described the help section only. A site that is noindex everywhere still gets its pages measured.
- Sitemaps are read depth first: a sitemap index's children come before the next sitemap declared in robots.txt, and a child that is also declared is read in its index's place. On example.dk the help centre's sitemap on another host (8,680 URLs) filled the 5,000-URL cap before www.example.dk/sitemap.xml was read, so only help pages could be sampled.

## [2.1.0] - 2026-11-01

### Removed
- Fallbacks for the old skill names: results saved with the old `tool` value no longer count as a baseline, and the old env var names (`*_AUDIT_DEBUG`, `A11Y_AUDIT_CACHE`) are gone. An old reports folder is still moved once, silently.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `eco-audit` to `audit-eco`, so every audit skill starts with `audit` (folder, `name:`, `/skills:audit-eco`, the `tool` value in report.json, the X-Audit header and the reports folder `<reports>/audit-eco/`).
- The first run moves an existing `<reports>/eco-audit/` target folder to `<reports>/audit-eco/`, so notes.md, triage and the last result carry over. Results saved with `tool: "eco-audit"` still count as earlier runs for the baseline.
- Major version because the skill's name and invocation changed.

## [1.1.0] - 2026-11-01

### Added
- `--level error|warn|info` (comma list, e.g. `error,warn`; default `all`): report.md and the stdout summary (the pages table stays) show only rows at those levels, with a line saying what is hidden. report.json, findings.json and last-report.json keep every result, so baselines are unaffected.
- `--console`: a compact list on stdout, one line per issue, errors first, counts on top (`scripts/lib/levels.mjs`; the title line carries the start page weight, CO2e and rating). The run's files go to a scratch folder in the system temp folder; last-report.json is still saved. `--console --report` gives both.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/eco.mjs` loads the start page and a sample of sitemap pages in headless Chrome over the DevTools protocol (empty cache, desktop or `--mobile`), records every request, scrolls to measure lazy loading, and estimates CO2e per page view with the Sustainable Web Design model v4 (as CO2.js 0.19) and its A+ to F rating.
- Checks page weight, video and audio on load, image weight, formats, oversized and eagerly loaded images, web fonts and WOFF2, JavaScript, third-party share, text compression, browser caching and green hosting (Green Web Foundation).
- `--grid` for a country's grid intensity (bundled CO2.js data), `--views` for a yearly estimate, `--no-browser` for an estimate from the HTML when no Chrome is available.
- Writes `report.md`, `report.json` and `findings.json` (the fix list in the shape audit-all's tasks.json uses). Target folder per host with `runs/<stamp>/`, `last-report.json` for "Since last run" and a hand-written `notes.md`.
