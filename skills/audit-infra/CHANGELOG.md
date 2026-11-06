# Changelog

All notable changes to the `audit-infra` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.3.0] - 2026-11-06

### Fixed
- SPF: an include or redirect whose target uses macros (RFC 7208 §7, such as Proofpoint's `include:%{ir}.%{v}.%{d}.spf.has.pphosted.com`) is no longer read as a missing record and a permanent error. It still counts as one DNS lookup, is not followed (receivers expand it per message), and the evidence names it as a macro include.
- `--version` printed 2.1.0; it now matches the skill version.

### Changed
- Certificate Transparency: crt.sh gets a second try after a short pause, and when it still does not answer (it often returns 502) the names come from Cert Spotter's free API instead. The row says which source answered. With Cert Spotter the "certificate not in CT logs" check compares SHA-256 fingerprints instead of serials, and is skipped when only the first pages were read.

## [2.2.0] - 2026-11-04

### Changed
- `hsts.preload-list` uses `scripts/lib/hsts-preload.mjs`, shared with audit-launch: hstspreload.org's status and preloadable checks for the apex, the Chromium source list when hstspreload.org does not answer, and the same verdict as audit-launch (pass when preloaded and the header still qualifies, warn when preloaded but the header dropped a requirement or a pending submission has errors, info when not listed).

## [2.1.0] - 2026-11-01

### Removed
- Fallbacks for the old skill names: results saved with the old `tool` value no longer count as a baseline, and the old env var names (`*_AUDIT_DEBUG`, `A11Y_AUDIT_CACHE`) are gone. An old reports folder is still moved once, silently.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `infra-audit` to `audit-infra`, so every audit skill starts with `audit` (folder, `name:`, `/skills:audit-infra`, the `tool` value in report.json, the X-Audit header and the reports folder `<reports>/audit-infra/`).
- The first run moves an existing `<reports>/infra-audit/` target folder to `<reports>/audit-infra/`, so notes.md, triage and the last result carry over. Results saved with `tool: "infra-audit"` still count as earlier runs for the baseline.
- Major version because the skill's name and invocation changed.

## [1.2.0] - 2026-11-01

### Added
- `--level error|warn|info` (comma list, e.g. `error,warn`; default `all`): report.md and the stdout summary show only rows at those levels, with a line saying what is hidden. report.json (with `tasks`) and last-report.json keep every result, so baselines are unaffected.
- `--console`: a compact list on stdout, one line per issue, errors first, counts on top (`scripts/lib/levels.mjs`). The run's files go to a scratch folder in the system temp folder; last-report.json is still saved. `--console --report` gives both.

## [1.1.0] - 2026-10-30

### Fixed
- A hosting platform's address (`*.umbraco.io`, `*.azurewebsites.net`, `*.vercel.app`, `*.netlify.app`, `*.ondigitalocean.app` and others) is no longer audited as if the platform's domain were the site's: domain, mail and subdomain checks are skipped with a "Hosting platform address" warning and a note at the top of the report, and CAA, HSTS preload and the www sibling use the host itself. `--platform-ok` audits the platform's domain anyway. A run on an Umbraco Cloud address had reported umbraco.io's CAA and DKIM as the site's.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/scan.mjs` audits a site's domain, DNS, mail authentication, TLS per endpoint, edge and subdomains, and writes `report.md` and `report.json` under the shared report folder.
- DNS over HTTPS first (Cloudflare, then Google, then the system resolver), so answers and the DNSSEC flag are the same on every network.
- Domain: RDAP expiry and transfer lock, name servers, SOA timers, DNSSEC (broken chain is a blocker), addresses and TTL, dangling CNAME, CAA with tree climbing.
- Email: MX health, SPF followed through every include with the 10-lookup and void-lookup limits, DMARC with external report authorisation, DKIM at about 25 selectors (plus `--dkim-selector`) with key size, MTA-STS policy and MX coverage, TLS-RPT, BIMI.
- TLS: one handshake per host and IP address (site and www/apex sibling, IPv4 and IPv6): chain, expiry, names, key and signature, protocol and ALPN, OCSP stapling, TLS 1.0/1.1 acceptance, and whether CAA allows the CA that issued the live certificate.
- Edge: CDN and cache status, HTTP/3 via Alt-Svc or the HTTPS DNS record, HSTS preload list status.
- Subdomains from Certificate Transparency (crt.sh): dangling CNAMEs with takeover-prone services as blockers, broken certificates, hosts without https when HSTS includeSubDomains would lock them out, CAs outside CAA.
- Detects TLS interception (the received certificate is not in CT logs) and marks the certificate rows as skipped instead of reporting the proxy's certificate.
- `report.json` carries task candidates in audit-all's tasks.json shape.
- A target folder per host (`<reports>/infra-audit/<host>/` with `target.txt`, `notes.md`, `last-report.json`) and one run folder per run under `runs/`. Each run compares with the last one ("Since last run") and shows `notes.md`; `--baseline` picks another report.
