# Changelog

All notable changes to the `security-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.3.0] - 2026-10-30

### Added
- Platform credential files: secrets in Umbraco Cloud's `umbraco-cloud.json` (`Deploy.Settings.ApiKey`, `Identity.ClientSecret`) are reported under `secrets.umbraco-cloud` instead of as generic committed secrets. The file is written by Umbraco Cloud and needed for its deploys, so the rule is owned by a person and its severity follows the repo's visibility from `gh repo view`: private or internal → low (accept in `triage.json`), unknown → medium, public → high (rotate in the Umbraco Cloud portal). History hits in the file are skipped.
- `--visibility public|private|internal` for when `gh` cannot tell.
- A secret that moves to another rule (same file, same redacted value) counts as still open, not fixed plus new, and keeps an earlier `accepted` or `false-positive` verdict.

## [1.2.0] - 2026-10-30

### Added
- A stable target folder per repo, `<reports>/security-audit/<repo folder name>/` (`target.txt`, hash suffix on a name clash, `--state DIR` to override), with `last-findings.json`, `triage.json` and `notes.md`. Default runs go to `runs/<stamp>/` inside it.
- Every scan compares with the last one automatically: hits and advisories get a line-independent fingerprint and a `new`/`open` status, and `baseline.fixed` lists what disappeared. `--baseline FILE|DIR` picks a specific earlier scan, `--no-baseline` skips it. The first scan after upgrading finds the newest earlier `findings.json` for the same repo, including inside audit-all run folders.
- `triage.json`: Claude's verdicts per fingerprint carry over, so a re-run only triages new hits. `accepted` needs a reason and an expiry.
- `secrets.config-token`: BearerToken, Token, AccessToken and other `*Token` keys in JSON, YAML and other config files (also `Bearer <token>` values); `#{…}#`, `__…__` and `${…}` placeholders are skipped.
- `secrets.credentials-file` also flags committed `appsettings.<Environment>.json` (not Development) and `local.settings.json`.

### Changed
- The default report folder moved from `<reports>/security-audit/<repo>-<stamp>/` to `<reports>/security-audit/<repo>/runs/<stamp>/`.
- One secret on a line is reported once, by the first rule that matches it.

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
