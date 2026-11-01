# Changelog

All notable changes to the `is-website-safe` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.0.0] - 2026-11-01

Rebuilt to answer "is this the real site, a copy of a famous one, or a fake shop?". The old additive score let a five-day-old PayPal lookalike reach "Moderate risk" and a phishing page on a free host reach "Trusted".

### Added
- `scripts/check.mjs`: one read-only run that prints a verdict, the red flags and the facts (`--json` for everything).
- Lookalike detection against about 150 brands that phishing and fake shops copy (Danish and Nordic ones included): typos, homoglyphs and mixed alphabets, the brand plus lure words, the brand on another TLD, the brand's domain or name as a subdomain, and free names on shared hosts.
- Page checks: what the page calls itself, password/card/CPR/one-time-code fields, forms posting elsewhere, input sent to Telegram bots or Discord webhooks, the brand's own favicon, files loaded from the brand's servers, cloaking, pressure wording, and webshop signals (bank-transfer-only or crypto payment, free-mail contact, no CVR/VAT or terms, 50-90% discounts, a Trustpilot badge for another site).
- Blocklists without keys: Quad9 and Cloudflare's security resolver (over DNS-over-HTTPS), the OpenPhish feed, urlscan.io. With optional keys: Google Safe Browsing, VirusTotal, URLhaus.
- History: RDAP (whois on port 43 for TLDs without RDAP, such as .dk), registry hold status, first certificate in Certificate Transparency, first Wayback Machine snapshot (catches domains that changed hands), Tranco rank, hosting network.
- Trustpilot read from the exact domain's page, never from a search result for a similar name.
- `--brand` for "is this really X?": a listed brand, the real domain, or a brand name looked up on Wikidata.
- Tests (`node --test scripts/test/check.test.mjs`), fully offline.

### Changed
- The verdict comes from hard red flags first (Dangerous / Suspicious / Caution / Likely safe / Trusted / Unknown); the 0-100 score is capped by the verdict.
- Complete WHOIS registrant details no longer earn points (GDPR redacts them for nearly everyone), "no Trustpilot reviews" is neutral instead of half marks, and A/MX/NS records no longer count.

### Removed
- The `whois`, `dig` and WebSearch-for-Trustpilot steps run by hand.

## [1.0.0] - 2026-01-09

### Added
- Initial release: website trust score from domain registration (WHOIS), DNS records and Trustpilot reviews, with a safety report and recommendation.
