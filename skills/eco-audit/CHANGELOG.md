# Changelog

All notable changes to the `eco-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

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
