# Changelog

All notable changes to the `audit-all` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.0] - 2026-10-30

### Added
- Initial release. Runs launch-audit, security-audit and solution-health (one URL, one or more repos) into one run folder, then combines their reports with a written verdict and "Fix first" list.
- `scripts/combine.mjs` writes a combined `report.md`, a self-contained `report.html` and an A4 `report.pdf` printed with headless Chrome, Chromium or Edge (including Playwright's Chromium in cloud sessions).
- `--style serif` (default, Newsreader) and `--style sans` (IBM Plex Sans), with IBM Plex Mono for code. Fonts are bundled and embedded, so the PDF looks the same offline.
- `--repo PATH` copies a repo's committed `.solution-health/report.md` into the run folder.
- `--new NAME` creates the run folder under the shared report root: `$AUDIT_OUT_DIR`, else the Downloads folder if it exists, else `~/audit-reports/`.
