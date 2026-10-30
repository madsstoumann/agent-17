# Changelog

All notable changes to the `a11y-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/a11y.mjs` audits a sample of pages (default 10, one per template, from the sitemap and start-page links, a launch-audit crawl with `--from`, or a list with `--urls`) in headless Chrome, Chromium or Edge over the DevTools Protocol. No npm dependencies.
- axe-core 4.14.0 and HTML_CodeSniffer 2.5.1 (Pa11y's default engine), pinned, SHA-256 verified and cached on first use.
- Keyboard walk on the first `--keyboard N` pages (default 3): keyboard traps (Escape tried first), focus on invisible elements, missing focus style, focus covered by sticky headers or overlays (2.4.11), skip link, focus-order jumps. Cookie banners are recognised and reported once.
- Reflow at 320 px (1.4.10) and text spacing (1.4.12) checks, and a check for an accessibility statement link.
- Every finding mapped to WCAG 2.2 criteria and EN 301 549 v3.2.1 clauses; `report.md` has a status per A/AA criterion (fails, review, no automated failures, manual check) and the manual checks still needed.
- `tasks.json` in audit-all's fix-plan shape (`sources: ["a11y"]`); with `--repo NAME[=PATH]` the tasks are agent tasks with a suggested model.
- Shared report folder: `--out`, else `$AUDIT_OUT_DIR`, else the Downloads folder if it exists, else `~/audit-reports/`.
- `--header` / `AUDIT_HEADERS` for a WAF bypass rule, sent only to the audited site.
