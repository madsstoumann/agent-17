# Changelog

All notable changes to the `audit-launch` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.4.4] - 2026-11-09

### Fixed
- `privacy.consent-tool` and `privacy.trackers` named Cookiebot on sites that use Cookie Information. Cookie Information's own snippet is `<script id="CookieConsent" src="https://policy.app.cookieinformation.com/uc.js">`, and the Cookiebot pattern matched the bare word `CookieConsent`. Consent tools are now found by the new `lib/cmp.mjs`, shared with audit-privacy (identical copy, tested): the vendor host the page requests or loads a script from wins, then vendor markup; `CookieConsent` alone names nobody. Tested against Cookiebot, Cookie Information (also inside a Next.js payload) and OneTrust markup.
- The scoreboard's "Core Web Vitals (field, CrUX)" row said "no PSI_API_KEY" whenever there was no field data, also when the key was set and `--only` or `--skip` left perf out (`--only headers,exposed`). It now says "not run (perf skipped)" when perf did not run, and names PSI_API_KEY only when the run had none. `report.json` records whether a key was set (`input.flags.psiKey`, a yes/no, never the key). The `perf.cwv-field` row no longer asks for the key when it is set and Lighthouse ran locally.

## [2.4.3] - 2026-11-09

### Fixed
- `crawl.staging-refs`, `social.og-image` and `social.og-url` no longer treat an Umbraco Cloud live host (`example-live.euwest01.umbraco.io`) as staging. It is the live environment, and headless front ends load their media from it. Umbraco Cloud's development and staging hosts (`dev-…`, `stage-…`) are still flagged. The DNS and mail rows still treat every umbraco.io host as the platform's. An audit of the live host itself now defaults to `--env production`.

## [2.4.2] - 2026-11-09

### Fixed
- `--console --out DIR` writes the run's files to `DIR`. `--console` without `--report` always used a scratch folder in the system temp folder and ignored `--out`, and the scratch folder was removed at the end, so nothing was left where the user asked for it. The console list now ends with the report path when `--out` is given.

## [2.4.1] - 2026-11-07

### Changed
- Example hostnames in the docs, changelog and tests are placeholders now (example.com and similar).

## [2.4.0] - 2026-11-06

### Fixed
- DNS and mail rows from a resolver that answers addresses only. The Claude cloud container's resolver returns ENODATA for TXT, MX, NS, CAA and DS, so example.com was reported without SPF, DMARC, DKIM, CAA, MX and NS. Every registered domain has NS records, so when the local resolver returns none for the domain, audit-launch asks DNS-over-HTTPS (Cloudflare, then Google) and reads every record there; `dns.records` says so. When DoH cannot be reached either, the DNS and mail rows are skipped with "the local resolver returned no records" instead of reported as missing.
- `dns.dnssec` checks the domain's zone, not the host. www.example.com is a CNAME to Vercel, whose zone is unsigned, so the row said "not signed" for a signed domain; it now says the domain validates and that the host is a CNAME into an unsigned zone.
- `links.external-broken`, internal links past the crawl and the sitemap sample fall back to GET (body discarded) when HEAD answers any 4xx/5xx, not only 403/405/5xx. Two edge.sitecorecloud.io images on example.com answered HEAD 404 and GET 200.
- `dns.records` shows the domain's name servers, not those of a www CNAME target.

## [2.3.1] - 2026-11-06

### Changed
- The sitemap loader keeps each URL's `<lastmod>` (`lastmod` in its result), for audit-seo's copy of the same file. No change to audit-launch's checks.

## [2.3.0] - 2026-11-06

### Fixed
- TLS interception: the certificate of a public host is verified against Node's built-in public roots only. When only this machine's own CA store trusts it (a corporate proxy, antivirus or cloud egress gateway re-signing TLS), `tls.interception` says so and the certificate rows are skipped instead of passing on the proxy's certificate. Private hosts keep the local store (mkcert, company CAs).
- Lighthouse pages are sampled from different site sections (first path segment, locale prefix ignored) instead of (segment, depth) buckets, and noindex pages (meta robots or X-Robots-Tag) are skipped. On example.dk every sampled page was a noindex help guide, so the page rows read "SEO 69 (page is noindex)". A site that is noindex everywhere still gets its pages measured.
- Sitemaps are read depth first: a sitemap index's children come before the next sitemap declared in robots.txt, and a child that is also declared is read in its index's place. On example.dk the help centre's sitemap on another host (8,680 URLs) filled the 5,000-URL cap before www.example.dk/sitemap.xml was read, so only help pages could be sampled.
- `links.w3c` no longer counts the validator's CSS errors for features its parser does not know (`@container`, `@property`, `@layer`, `@scope`, `container-type`, container and viewport units, and similar). They are listed in a new info row, `links.w3c-modern-css`, and the scoreboard notes them. On example.dk that was 262 of 433 errors.

### Added
- A test for the example.dk admin-path case (`/umbraco` and `/sitecore` 301 to a trailing slash, then 404), which 2.2.1 already handles.

## [2.2.1] - 2026-11-06

### Fixed
- `--version` printed 2.1.1; it now matches the skill version.
- `exposed.admin-paths` no longer flags a backoffice because a redirect's `Location` mentions the CMS. Redirects are followed (up to 5 hops) and only a 200 that looks like a login page counts: a password field, or the CMS's own name plus login words. A locale redirect that ends in a 404 (example.com: `/umbraco` → 307 `/en/umbraco` → 404) is now a pass. A redirect to another host is reported as "behind an external sign-in" instead of a warning. The row's data lists each probe's redirect chain.

## [2.2.0] - 2026-11-04

### Changed
- `hsts.preload` now verifies the real preload list, not just the header: hstspreload.org's status for the host (subdomains covered by a preloaded parent show "via <apex>") and its preloadable check for the apex. When hstspreload.org does not answer, the Chromium source list (the one every browser builds from) is read instead.
- The row is a pass when the host is preloaded and the header still meets the rules, a warning when it is preloaded but the header dropped max-age ≥ 1 year, includeSubDomains or preload (or a pending submission has errors), info when it is not listed, and skipped when no list answered. It used to be info whatever the result, with a "submit" fix even for preloaded domains.
- The lookup lives in `scripts/lib/hsts-preload.mjs`, an identical copy of audit-infra's, so both skills give the same verdict. audit-all still runs it once (`--skip tls` on audit-launch when audit-infra runs).

## [2.1.1] - 2026-11-01

### Changed
- The start page's schema.org check uses `lib/schema.mjs`, an identical copy of audit-seo's (a test in each skill checks they match), instead of its own code in services.mjs. Same results.

## [2.1.0] - 2026-11-01

### Removed
- Fallbacks for the old skill names: results saved with the old `tool` value no longer count as a baseline, and the old env var names (`*_AUDIT_DEBUG`, `A11Y_AUDIT_CACHE`) are gone. An old reports folder is still moved once, silently.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `launch-audit` to `audit-launch`, so every audit skill starts with `audit` (folder, `name:`, `/skills:audit-launch`, the `tool` value in report.json, the X-Audit header and the reports folder `<reports>/audit-launch/`).
- The first run moves an existing `<reports>/launch-audit/` target folder to `<reports>/audit-launch/`, so notes.md, triage and the last result carry over. Results saved with `tool: "launch-audit"` still count as earlier runs for the baseline.
- Major version because the skill's name and invocation changed.

## [1.4.0] - 2026-11-01

### Added
- `--level error|warn|info` (comma list, e.g. `error,warn`; default `all`): report.md and the stdout summary show only rows at those levels, with a line saying what is hidden. report.json and last-report.json keep every result, so baselines are unaffected.
- `--console`: a compact list on stdout, one line per issue, errors first, counts on top (`scripts/lib/levels.mjs`, shared with the other audit skills). The run's files go to a scratch folder in the system temp folder; last-report.json is still saved. `--console --report` gives both.

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
