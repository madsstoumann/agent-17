# Changelog

All notable changes to the `security-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.1.0] - 2026-10-30

### Changed
- Semgrep runs on every audit when it is installed (OWASP Top Ten and secrets rulesets, saved as `semgrep.json` beside `findings.json`), instead of being optional. When it is missing, the report says so under "Not checked" with the install command.
- The default report folder no longer assumes `~/Downloads`. It is `$AUDIT_OUT_DIR` if set, else the Downloads folder if it exists and is writable (on Linux the XDG download folder first), else `~/audit-reports/`. The same order is used by launch-audit and audit-all.

### Fixed
- `--out ~/…` now expands `~` to the home folder instead of creating a folder literally named `~` under the current directory.

## [1.0.0] - 2026-10-29

### Added
- Initial release, code mode: `scripts/scan.mjs` scans a repo or folder and writes `findings.json` for Claude to triage into `report.md`.
- About 45 line rules across secrets, XSS, injection, request handling (SSRF, open redirect, path traversal, CSRF), crypto/auth/transport, config and CI (GitHub Actions and other pipelines), plus file-level checks for committed `.env`, key and credentials files.
- Dependency vulnerabilities from npm, yarn, pnpm, NuGet, Composer, PyPI, RubyGems and Go lockfiles via the OSV API.
- `--history` scans git history for secrets that were committed and later removed.
- `security-audit: ignore` (line) and `security-audit: ignore-file` markers for accepted findings.
