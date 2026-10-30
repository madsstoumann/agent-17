# Changelog

All notable changes to the `eco-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/eco.mjs` loads the start page and a sample of sitemap pages in headless Chrome over the DevTools protocol (empty cache, desktop or `--mobile`), records every request, scrolls to measure lazy loading, and estimates CO2e per page view with the Sustainable Web Design model v4 (as CO2.js 0.19) and its A+ to F rating.
- Checks page weight, video and audio on load, image weight, formats, oversized and eagerly loaded images, web fonts and WOFF2, JavaScript, third-party share, text compression, browser caching and green hosting (Green Web Foundation).
- `--grid` for a country's grid intensity (bundled CO2.js data), `--views` for a yearly estimate, `--no-browser` for an estimate from the HTML when no Chrome is available.
- Writes `report.md`, `report.json` and `findings.json` (the fix list in the shape audit-all's tasks.json uses). Target folder per host with `runs/<stamp>/`, `last-report.json` for "Since last run" and a hand-written `notes.md`.
