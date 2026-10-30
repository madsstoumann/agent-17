# Changelog

All notable changes to the `tech-stack` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.1.0] - 2026-10-30

### Changed
- The default report folder no longer assumes `~/Downloads`. It is `$AUDIT_OUT_DIR` if set, else the Downloads folder if it exists and is writable (on Linux the XDG download folder first), else `~/audit-reports/`. The same order is used by launch-audit, security-audit and audit-all.

### Fixed
- The version the script reports (and sends in its user agent) was still 1.0.1.

## [1.0.2] - 2026-10-29

### Changed
- The run note no longer names the plugin, which is now called `skills` instead of `mads-skills`.

## [1.0.1] - 2026-10-29

### Fixed
- The run command uses `${CLAUDE_SKILL_DIR}` instead of a hard-coded `~/.claude/skills/` path, so the skill also works when installed as part of the `mads-skills` plugin.

## [1.0.0] - 2026-10-29

### Added
- Initial release: `scripts/tech-stack.mjs` detects a site's CMS, e-commerce platform, framework, JavaScript and CSS libraries, backend, web server, hosting, CDN, analytics, tag managers, marketing pixels, session replay, A/B testing, RUM, consent tools, bot protection and other third-party services from about 270 signatures, with the evidence for every finding, versions where visible and tag IDs.
- Reads the page's own scripts and stylesheets (`--assets`) for bundle banners and runtime markers, and gets library versions from CDN URLs.
- Optional `--browser` pass through Playwright for tags injected by JavaScript, cookies set from JavaScript and window globals.
- Several URLs or `--file`: a comparison matrix and usage counts across sites in `report.md`, plus `results.json`.
- Weak evidence is reported as "possible", never as detected. Bot challenges and 403/429 answers are flagged as blocked.
- Replaces the `analyze-sites/` bash scripts. Their security-header, file and meta-tag checks are left to `launch-audit`.
