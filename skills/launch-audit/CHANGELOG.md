# Changelog

All notable changes to the `launch-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.3.0] - 2026-10-30

### Added
- A stable target folder per host, `<reports>/launch-audit/<host>/` (`target.txt`, `--state DIR` to override), with `last-report.json` and `notes.md`.
- Every run compares with the last complete run for the same host automatically; `--baseline FILE` still picks a specific one and `--no-baseline` turns it off. The first run after upgrading finds the newest earlier `report.json` for the host, including in old timestamped folders and audit-all run folders.
- `notes.md` in the target folder is shown in a "Notes" section of the report. The script never writes it.
- stdout ends with the target folder and what the run was compared with.

### Changed
- The default report folder moved from `<reports>/launch-audit/<host>-<stamp>/` to `<reports>/launch-audit/<host>/runs/<stamp>/`. A second run in the same minute gets `-2` instead of overwriting the first.

## [1.2.0] - 2026-10-30

### Added
- `--header "Name: value"` (repeatable, or `AUDIT_HEADERS`) for a WAF bypass rule. Sent to the audited host and its www/apex sibling and by Lighthouse, never by the script to third-party services; redacted in the saved Lighthouse JSON.
- Bot-challenge detection for Lighthouse: a run whose page answered 403/429/503 is reported as "blocked by Vercel/Cloudflare bot challenge" instead of scoring the challenge page, the remaining runs are skipped, and PageSpeed Insights takes over when `PSI_API_KEY` is set.
- The start-page check also recognises Vercel challenges (`x-vercel-mitigated`, "Vercel Security Checkpoint") and Cloudflare's `cf-mitigated` header, and its message points at `--header`.

### Changed
- Lighthouse runs before the crawl and the exposed-file probes, so a firewall that reacts to that burst does not challenge it.
- Chrome gets `--no-sandbox` when the audit runs as root (containers, cloud sessions), where it would otherwise not start.

## [1.1.0] - 2026-10-30

### Changed
- The default report folder no longer assumes `~/Downloads`. It is `$AUDIT_OUT_DIR` if set, else the Downloads folder if it exists and is writable (on Linux the XDG download folder first), else `~/audit-reports/`. The same order is used by security-audit and audit-all.

## [1.0.1] - 2026-10-29

### Fixed
- The run command uses `${CLAUDE_SKILL_DIR}` instead of a hard-coded `~/.claude/skills/` path, so the skill also works when installed as part of the `mads-skills` plugin.

## [1.0.0] - 2026-09-24

### Added
- Initial release: `scripts/audit.mjs` runs the full pre-launch audit (crawl, redirects, soft 404s, TLS, DNS/SPF/DMARC, exposed files, security headers, caching, Lighthouse performance and accessibility, privacy, broken links, social previews, icons) and writes `report.md` and `report.json`.
- Flags for environment (`--env`), future production host, sampled pages, skipping or narrowing check groups, baseline comparison and self-signed local URLs.
- Supersedes the old `security-headers` skill.
