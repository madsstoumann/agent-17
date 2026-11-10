# Changelog

All notable changes to the `audit-security` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.5.1] - 2026-11-10

### Fixed
- Site mode: the `headers.hsts-subdomains` fix keeps the site's own max-age and other directives (`max-age=63072000; includeSubDomains`) instead of suggesting `max-age=31536000`, which would shorten a longer policy.
- Site mode, "Since last run": a row the skill now counts under another (X-Frame-Options and the Observatory row under Clickjacking (frame-ancestors), since 2.4.0) is listed as "Merged: … is now counted under …", never as "Fixed". Rows carry `mergedInto`; `diff.merged` is new.

## [2.5.0] - 2026-11-10

### Changed
- Site mode: a frame-ancestors wildcard warns when it is on any name on the Public Suffix List (`*.vercel.app`, `*.github.io`, `*.s3.amazonaws.com`, `*.co.uk`), read from the shared `lib/hosts.mjs` and its vendored list, instead of a hand-kept list of hosting suffixes. The evidence says "is a public suffix".
- Site mode: a dev, staging or test source in frame-ancestors is a staging word in a label below its registrable domain, or a platform preview address (`hosts.json`); a site whose own name is the word (`dev.<tld>`) is not one.

## [2.4.0] - 2026-11-10

### Added
- Site mode: `headers.hsts-subdomains`, an info note when HSTS has a max-age of a year or more but no includeSubDomains.

### Changed
- Site mode: frame-ancestors that lets a dev, staging or test host (`dev-`, `stage-`, `staging.`, `test.`, `uat`, `preview` and the like) frame the live site is a warning, as a public-hosting wildcard is.
- Site mode: a missing frame-ancestors is counted once, under Clickjacking (frame-ancestors). The X-Frame-Options row becomes info and says so, and the MDN Observatory row is graded without its x-frame-options test and leaves the framing advice to the Clickjacking row.

## [2.3.1] - 2026-11-10

### Changed
- SKILL.md documents `--url` and that site mode sends `AUDIT_HEADERS`; the argument hint lists `--url` and `--insecure`.

## [2.3.0] - 2026-11-10

### Changed
- Site mode's clickjacking row warns when `frame-ancestors` allows a wildcard on a public hosting suffix (`https://*.vercel.app`, `*.netlify.app`, `*.github.io`, `*.azurewebsites.net`, `*.pages.dev` and others in `PUBLIC_HOSTING_SUFFIXES`): anyone can deploy there and frame the page. It passed before. A site's own wildcard (`https://*.cms.example.com`) still passes.
- The HSTS row (from audit-launch 2.5.0) warns below one year, `max-age=31536000`, instead of below 180 days.

### Fixed
- The clickjacking fix text said to keep `X-Frame-Options: SAMEORIGIN` also when the site sends `DENY`. It now says to keep the value the site sends, and to add `SAMEORIGIN` only when it sends none (or one browsers ignore).

## [2.2.1] - 2026-11-09

### Fixed
- Site mode sends `AUDIT_HEADERS` (the WAF bypass headers) on its own request for the clickjacking row too, not only through audit-launch. Behind a firewall that challenges scripts, the row could otherwise be judged on the challenge page's headers.
## [2.2.0] - 2026-11-09

### Added
- Site mode: `scan.mjs <https://url>` (or `--url`) checks a live site from outside, passively, when there is no repo to scan. Groups `headers` (the six graded headers incl. CSP, Permissions-Policy, HSTS and Referrer-Policy, CSP lint, cookie flags, CORS, COOP/COEP/CORP, MDN Observatory, securityheaders.com), `redirects`, `exposed` (secret files, manifests, admin paths, security.txt) and `blocklists` (OpenPhish, plus Google Safe Browsing, URLhaus and VirusTotal with their keys). The header, redirect and exposed-file checks are audit-launch's, run from the sibling skill with its state kept apart; site mode adds a clickjacking row (CSP `frame-ancestors` against X-Frame-Options) and the blocklists (`lib/sources.mjs` and `lib/target.mjs`, identical copies of is-website-safe's, tested). The scanner writes `report.md` ("Security audit (site)") and `report.json` itself into `<reports>/audit-security/<host>/` and compares with the host's last site scan. `--header` and `--insecure` are new flags for it.

## [2.1.1] - 2026-11-09

### Fixed
- `--console --out DIR` writes findings.json to `DIR`. `--console` without `--report` always used a scratch folder in the system temp folder and ignored `--out`.

## [2.1.0] - 2026-11-01

### Removed
- Fallbacks for the old skill names: results saved with the old `tool` value no longer count as a baseline, and the old env var names (`*_AUDIT_DEBUG`, `A11Y_AUDIT_CACHE`) are gone. An old reports folder is still moved once, silently.
- Skips `.audit-solution-health/` instead of the old folder names.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `security-audit` to `audit-security`, so every audit skill starts with `audit` (folder, `name:`, `/skills:audit-security`, the `tool` value in report.json, the X-Audit header and the reports folder `<reports>/audit-security/`).
- The first run moves an existing `<reports>/security-audit/` target folder to `<reports>/audit-security/`, so notes.md, triage and the last result carry over. Results saved with `tool: "security-audit"` still count as earlier runs for the baseline.
- Major version because the skill's name and invocation changed.

## [1.4.0] - 2026-11-01

### Added
- `--level error|warn|info` (comma list; default `all`): the scanner lists only candidates at those levels (high and critical are errors; medium, moderate and low warnings), and Claude writes report.md at that level. findings.json, last-findings.json and triage.json keep every hit.
- `--console`: findings.json goes to a scratch folder in the system temp folder, no report.md is written, and after triage Claude replies with a compact list of confirmed findings in the shared one-line format. `--console --report` gives both.

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
