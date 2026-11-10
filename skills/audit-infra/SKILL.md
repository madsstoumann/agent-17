---
name: audit-infra
description: Use when someone wants the infrastructure or domain hygiene of a site checked — domain registration expiry and transfer lock, name servers, SOA, DNSSEC, CAA, dangling CNAMEs and subdomain takeover risk, mail authentication in depth (MX, SPF followed through every include and the 10-lookup limit, DMARC including external report authorisation, DKIM key sizes, MTA-STS, TLS-RPT, BIMI), TLS per endpoint and IP (chain, expiry, names, key, TLS 1.0/1.1, OCSP, CAA vs issuer), CDN, HTTP/3, the HSTS preload list, and every subdomain in Certificate Transparency logs. Also "is our DNS/mail set up right", "why does our mail land in spam", "when does the domain or certificate expire". Passive and read-only. Not for redirects, headers or caching (audit-launch).
argument-hint: "<url or domain> [--email-domain D] [--dkim-selector S] [--no-ct] [--max-subdomains N] [--only domain,email,tls,edge,ct] [--out DIR] [--level error|warn|error,warn|all] [--console]"
allowed-tools: Bash(node:*), Read, WebFetch
metadata:
  version: "2.6.0"
---

# Infrastructure audit

One script checks everything below the web page: the domain registration, DNS, mail
authentication, the TLS certificate on every address the name points at, the edge, and every
subdomain that has ever had a certificate. It writes `report.md` (fix first, should fix, then one
table per section) and `report.json` (every row plus task candidates for audit-all). Your job is to
run it, read the stdout summary and tell the user what to fix and who fixes it (DNS provider,
registrar, mail provider, host).

It is **passive**. It asks DNS over HTTPS (Cloudflare, then Google), makes ordinary TLS handshakes,
one GET of the home page, and reads public registries: RDAP for the registration, crt.sh (Cert Spotter when crt.sh does not answer) for
Certificate Transparency, hstspreload.org for the preload list. No port scans, no load, no logins,
no zone transfers. Still, only audit domains the user owns or is engaged on.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scan.mjs" <url or domain> [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder. Run it through Bash with `timeout: 300000`; a run takes
10–60 seconds, most of it waiting for crt.sh. Progress goes to stderr, the summary (fails, warns,
skips) to stdout. Exit code 0 whatever it finds; non-zero means the script failed.

| Flag | Use it when |
|---|---|
| `<url or domain>` | The site (`https://www.example.dk/`) or a bare domain. Mail checks run on the registrable domain (`example.dk`). Always the live, public domain: a hosting platform's address (`*.umbraco.io`, `*.azurewebsites.net`, `*.vercel.app`, `*.netlify.app`, …) gets only its TLS and edge checked, with a warning, because that domain, its DNS and its mail are the platform's. When the URL came from a repo and is such an address, ask for the live domain. |
| `--platform-ok` | Only when the user wants the platform's own domain audited. |
| `--email-domain D` | Mail is sent from another domain than the site's. |
| `--dkim-selector S` | The user knows their provider's selector (it is `s=` in the DKIM-Signature header of a sent mail). Repeatable. About 25 common selectors are always tried. |
| `--no-ct` / `--max-subdomains N` | crt.sh and Cert Spotter are both down or slow, or the domain has hundreds of hosts. Default probes the first 30 names. |
| `--only` / `--skip` | Narrow questions. Groups: `domain email tls edge ct`. "Just mail" → `--only email`. |
| `--no-legacy` | Skip the TLS 1.0/1.1 probe. |
| `--header "Name: value"` | A WAF bypass header (see audit-launch); sent only with the one GET of the home page. Also `AUDIT_HEADERS`. |
| `--out DIR` | The user names a folder, or audit-all passes its run folder. Default `<reports>/audit-infra/<host>/runs/<YYYYMMDD-HHMM>/`, where `<reports>` is `$AUDIT_OUT_DIR`, else the Downloads folder if it exists (the XDG download folder on Linux), else `~/audit-reports/`. Quote the paths printed last. |
| `--baseline FILE` | Compare with a specific earlier `report.json`. By default the script compares with the last run for the same host. |

### Levels and the console list

`--level` sets what `report.md` and the stdout summary show: `error` (failed checks), `warn`, `info`, a comma list such as
`error,warn`, or `all` (the default: every row, passes included). Use it when the user asks for
"errors only", "only warnings", "skip the info" and the like. It never filters saved data:
`report.json` (with its `tasks`) and `last-report.json` keep every result, so the next run's "Since last run" is unaffected.

`--console` prints a compact list instead of writing `report.md`: one line per issue, errors
first, with the counts on top. The run's files go to a scratch folder in the system temp folder,
so nothing is left in the reports folder except the target folder's `last-report.json`. Use it when
the user wants "just the list", "in the terminal" or "no report". Show the list as it is, in a code
block, with a sentence of context; there is no report path to quote. `--console --report` writes
the report as well, and so does `--console --out DIR` (the run's files go to that folder).

## What it checks

| Section | Checks (`id`) |
|---|---|
| Domain & DNS | `domain.registration` (expiry < 30 days fail, < 60 warn), `domain.transfer-lock`, `dns.nameservers` (≥ 2), `dns.soa` timers, `dns.dnssec` (DS + validation; SERVFAIL with a DS is a blocker; a host that is an alias into an unsigned zone is info, insecure by delegation), `dns.addresses` (A/AAAA, TTL), `dns.dangling` (CNAME to nothing: blocker), `dns.caa` |
| Email | `email.mx` (resolves, no CNAME, null MX), `email.spf` (whole include tree, > 10 lookups or `+all` fail; an include that uses macros such as `%{ir}` counts as one lookup and is not followed, void includes), `email.dmarc` (p, sp, pct, rua, external destinations publish the `_report._dmarc` record), `email.dkim` (keys found, < 2048-bit RSA warn), `email.mta-sts` (policy file, mode, covers every MX), `email.tls-rpt`, `email.bimi` |
| TLS | One handshake per host (site + www/apex sibling) and per IP: `tls.chain` (missing intermediates), `tls.expiry` (soonest endpoint), `tls.consistency`, `tls.san`, `tls.key`, `tls.protocol`, `tls.alpn` (h2), `tls.ocsp-stapling`, `tls.legacy` (TLS 1.0/1.1 accepted), `tls.caa-match` (CAA allows the CA that issued the live certificate, or renewal fails), `tls.ipv6` |
| Edge | `edge.cdn` (and cache status), `edge.http3` (Alt-Svc or HTTPS record), `hsts.preload-list` (apex on the preload list per hstspreload.org, Chromium list as fallback; pass when listed and the header still qualifies, warn when listed but the header dropped a requirement) |
| Subdomains | `ct.inventory` from crt.sh (or Cert Spotter, said in the row), `ct.dangling` (claimable services such as azurewebsites.net or github.io are blockers), `ct.certificates` (expired, wrong name, untrusted), `ct.no-https` (warn when HSTS includeSubDomains or preload would lock them out), `ct.issuers` vs CAA, `ct.stale` |

`tls.interception`: every handshake is verified against Node's built-in public roots only. When
only this machine's own CA store trusts the chain, or the certificate it receives is not in the CT
logs, something on the network re-signs TLS (corporate proxy, VPN, antivirus, a cloud sandbox's
egress proxy). The script then marks the certificate rows as skipped instead of reporting the
proxy's certificate, and `tls.interception` itself is a degraded run: skipped, not a warning, never
a task, and named on top of `report.md` as a condition of the network, not of the site. Tell the
user to run it from another network for those rows.

DNS is read over DNS-over-HTTPS (Cloudflare, then Google), with the system resolver as the fallback.
When neither DoH provider answers and the system resolver returns no NS records for the domain (a
resolver that answers addresses only, as in some cloud sandboxes), the DNS and mail rows are
skipped with "the local resolver returned no records" rather than reported as missing.

## Reading the result

- **Blockers**: a dangling CNAME, a broken DNSSEC chain, an untrusted chain, a name missing from
  the certificate, a domain or certificate days from expiry. Lead with these.
- Most fixes are **outside the code**: DNS provider (CAA, SPF, DMARC, MTA-STS, dangling records),
  registrar (renewal, lock, DS), mail provider (DKIM rotation), host or CDN (TLS, HTTP/3). Say which.
- SPF over 10 lookups fails silently for receivers: mail just stops authenticating. Explain that
  plainly; it is the usual cause of "our mail goes to spam".
- DMARC `p=none` is a starting point, not protection. The path is none → quarantine → reject while
  reading the rua reports.
- A skip is not a pass. RDAP is missing for some TLDs (the registrar's panel has the expiry date).

Write a short chat summary: fixes first with who does them, then the two paths. Do not paste the
whole report.

## Not here

audit-launch already checks redirects (http→https, www/apex), compression, caching, HTTP version,
security headers, cookies, exposed files and security.txt; audit-security checks code. Inside
audit-all, audit-launch runs with `--skip tls` when audit-infra runs, so the TLS, DNS and email rows
appear once, here.

## For audit-all

`report.json` has `tasks`: every fail and warn in the tasks.json shape (`sources: ["infra"]`,
`owner: "human"` because DNS, registrar and mail settings live outside the repo, a `verify` line
naming the check). Copy them into the run's `tasks.json`, merging duplicates.

## State between runs

Each host has a target folder, `<reports>/audit-infra/<host>/`, which holds `target.txt`, the last result
(`last-report.json`) and `notes.md`. Every run compares with that last result, also when audit-all
passes `--out`, and adds a "Since last run" section (fixed, new or worse). `notes.md` is
hand-written and shown as "Notes" in the report. Write the user's context into it when they give
some ("CAA is managed by the agency", "the banner is Cookiebot's default"); no script writes it.

## Files

- `scripts/scan.mjs`: CLI, group runner, report.
- `scripts/lib/dns.mjs`: DoH resolver with system fallback, record parsers.
- `scripts/lib/email.mjs`: SPF tree, DMARC, DKIM, MTA-STS.
- `scripts/lib/tls.mjs`: handshakes, certificate fields, CAA match.
- `scripts/lib/services.mjs`: RDAP, crt.sh, Cert Spotter.
- `scripts/lib/hsts-preload.mjs`: HSTS preload lookup and verdict (identical copy in audit-launch; its test compares them).
- `scripts/lib/checks.mjs`: the five groups.
- `scripts/lib/target-state.mjs`: target folders and run folders (identical copy in every audit skill; a test compares them).
- `scripts/lib/common.mjs`: result rows, report folder, Markdown, task candidates (same file as audit-privacy's; keep in step).
- `scripts/test/`: `cd scripts && node --test test/*.test.mjs`.
