# Changelog

All notable changes to the `audit-a11y` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.1.0] - 2026-11-01

### Removed
- Fallbacks for the old skill names: results saved with the old `tool` value no longer count as a baseline, and the old env var names (`*_AUDIT_DEBUG`, `A11Y_AUDIT_CACHE`) are gone. An old reports folder is still moved once, silently.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `a11y-audit` to `audit-a11y`, so every audit skill starts with `audit` (folder, `name:`, `/skills:audit-a11y`, the `tool` value in report.json, the X-Audit header and the reports folder `<reports>/audit-a11y/`).
- The first run moves an existing `<reports>/a11y-audit/` target folder to `<reports>/audit-a11y/`, so notes.md, triage and the last result carry over. Results saved with `tool: "a11y-audit"` still count as earlier runs for the baseline.
- Major version because the skill's name and invocation changed.

## [1.1.0] - 2026-11-01

### Added
- `--level error|warn|info` (comma list, e.g. `error,warn`; default `all`): report.md and the stdout summary show only rows at those levels, with a line saying what is hidden. report.json, tasks.json and last-report.json keep every result, so baselines are unaffected. Blocker and high issues are errors, medium and low warnings, review and best-practice items info; with a level the criteria table, manual checks and page list are left out.
- `--console`: a compact list on stdout, one line per issue, errors first, counts on top (`scripts/lib/levels.mjs`). The run's files go to a scratch folder in the system temp folder; last-report.json is still saved. `--console --report` gives both.
- `--wcag A|AA|AAA` for the WCAG target level.

### Changed
- `--level` now sets the output level. `--level A`, `AA` and `AAA` still set the WCAG level, so existing commands keep working.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/a11y.mjs` audits a sample of pages (default 10, one per template, from the sitemap and start-page links, a launch-audit crawl with `--from`, or a list with `--urls`) in headless Chrome, Chromium or Edge over the DevTools Protocol. No npm dependencies.
- axe-core 4.14.0 and HTML_CodeSniffer 2.5.1 (Pa11y's default engine), pinned, SHA-256 verified and cached on first use.
- Keyboard walk on the first `--keyboard N` pages (default 3): keyboard traps (Escape tried first), focus on invisible elements, missing focus style, focus covered by sticky headers or overlays (2.4.11), skip link, focus-order jumps. Cookie banners are recognised and reported once.
- Reflow at 320 px (1.4.10) and text spacing (1.4.12) checks, and a check for an accessibility statement link.
- Every finding mapped to WCAG 2.2 criteria and EN 301 549 v3.2.1 clauses; `report.md` has a status per A/AA criterion (fails, review, no automated failures, manual check) and the manual checks still needed.
- `tasks.json` in audit-all's fix-plan shape (`sources: ["a11y"]`); with `--repo NAME[=PATH]` the tasks are agent tasks with a suggested model.
- Target folder per site, `<reports>/a11y-audit/<host>/`, with `last-report.json`, `notes.md` and `runs/<stamp>/` (the shared layout). Every run compares with the last one ("Since last run": fixed, new, still open, criteria that changed); `--baseline`, `--no-baseline` and `--state` override it. `<reports>` is `$AUDIT_OUT_DIR`, else the Downloads folder if it exists, else `~/audit-reports/`.
- `--header` / `AUDIT_HEADERS` for a WAF bypass rule, sent only to the audited site.
