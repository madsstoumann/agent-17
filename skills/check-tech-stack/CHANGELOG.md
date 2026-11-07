# Changelog

All notable changes to the `check-tech-stack` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.1.1] - 2026-11-07

### Changed
- Example hostnames in the docs, changelog and tests are placeholders now (example.com and similar).

## [2.1.0] - 2026-11-01

### Added
- Renders a page in the browser without `--browser` when its HTML shows little (an empty app shell, almost no text, or no CMS or framework recognised) and Playwright is installed; the report says why. `--no-browser` turns it off.
- `--pages N` (max 10) also reads same-site pages the start page links to, other subdomains and sections first. Technologies found only there are marked with the page.
- Changes since the last run: each host's result is kept in `<reports>/check-tech-stack/<host>/last.json`, and the report and summary line list what is new, what changed version and what was not seen (with a note when the last run looked further). `--no-history` skips it.
- Library age: detected versions are compared with the latest release on npm ("latest 4.0.0, major update available"). `--offline` skips the lookup.
- Signatures: Dynamicweb, Magnolia CMS, Umbraco Heartcore, Contentstack, Directus, Payload CMS, server-side Google Tag Manager, Cloudflare Zaraz, Sleeknote, Bloomreach Engagement and Discovery, Clerk.io, Hello Retail, Raptor, Vipps MobilePay, QuickPay, Frisbii (Reepay).

### Changed
- A single site's report goes to `<reports>/check-tech-stack/<host>/runs/<YYYYMMDD-HHMM>/`, next to its `last.json`, named after the host the site ended up on. Several sites still go to `batch-<n>-<YYYYMMDD-HHMM>/`.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `tech-stack` to `check-tech-stack`; run it as `/skills:check-tech-stack`. The runner is now `scripts/check-tech-stack.mjs`, requests carry `X-Audit: check-tech-stack/<version>`, `results.json` says `"tool": "check-tech-stack"`, and reports go to `<reports>/check-tech-stack/`.

## [1.1.1] - 2026-11-01

### Changed
- Points to the renamed skills audit-launch and audit-security.

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
