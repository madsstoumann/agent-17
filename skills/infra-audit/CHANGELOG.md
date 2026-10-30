# Changelog

All notable changes to the `infra-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

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
