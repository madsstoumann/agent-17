# Manual checks — services with no API

The audit prints these links with the URL filled in (report section "Manual checks").
Open them after the script has run; each takes under a minute.

| Service | URL template | What to look at | Notes |
|---|---|---|---|
| securityheaders.com | `https://securityheaders.com/?q=<url>&followRedirects=on` | The letter grade and the "Warnings" panel | The site sits behind a Cloudflare challenge, so curl and headless Chrome are blocked. The report's grade is **estimated** with the same rules (six headers, A+ needs no `unsafe-inline`/`unsafe-eval` in `script-src`); confirm here. A paid API key (`SECURITYHEADERS_API_KEY`) removes the guesswork. |
| Google CSP Evaluator | `https://csp-evaluator.withgoogle.com/` | Paste the `Content-Security-Policy` value | Finds bypasses (JSONP hosts, `strict-dynamic` gaps) beyond the report's lint. |
| PageSpeed Insights | `https://pagespeed.web.dev/analysis?url=<url>` | Field data (CrUX) block, the five categories | Same Lighthouse the script runs locally; the field data only appears with real Chrome traffic. A free API key (`PSI_API_KEY`, Google Cloud → PageSpeed Insights API) lets the script fetch this itself. |
| Google Rich Results Test | `https://search.google.com/test/rich-results?url=<url>` | Which rich results Google detects, with errors | validator.schema.org checks vocabulary; this checks Google's requirements. |
| validator.w3.org/nu | `https://validator.w3.org/nu/?doc=<url>` | The full message list | The report groups the messages by text; the raw `w3c.json` beside it has every one. |
| validator.schema.org | `https://validator.schema.org/#url=<url>` | Detected entities and their errors | The report calls the same validator; use the UI to browse nested properties. |
| MDN HTTP Observatory | `https://developer.mozilla.org/en-US/observatory/analyze?host=<host>` | Per-test result and recommendation | Same scan as `observatory.json`; the UI explains each test. |
| Qualys SSL Labs | `https://www.ssllabs.com/ssltest/analyze.html?d=<host>&hideResults=on` | Grade, protocol support, chain issues, known vulnerabilities | Takes 2–4 minutes. `--ssllabs` runs it from the script (v3 API, deprecated but answering). |
| hstspreload.org | `https://hstspreload.org/?domain=<apex>` | Eligibility errors, submission | Only submit when every subdomain is https-only, forever. |
| Webbkoll | `https://webbkoll.dataskydd.net/en/check?url=<url>` | Third-party requests and cookies before consent, referrer leakage | What a data-protection authority sees. Run on production after launch too. |
| Blacklight | `https://themarkup.org/blacklight?url=<url>` | Trackers, session recording, key logging, fingerprinting, Facebook pixel | Second opinion on Webbkoll. |
| LinkedIn Post Inspector | `https://www.linkedin.com/post-inspector/inspect/<url>` | Title, description, image of the share card | Also **clears LinkedIn's cached preview** — do this after launch if the URL was shared from staging. |
| Facebook Sharing Debugger | `https://developers.facebook.com/tools/debug/?q=<url>` | Same, plus og warnings | "Scrape again" clears the cache. |
| RealFaviconGenerator checker | `https://realfavicongenerator.net/favicon_checker?protocol=https&site=<host>` | Every platform's icon, the manifest, the theme colour | Generates the full set if anything is missing. |
| WAVE | `https://wave.webaim.org/report#/<url>` | Errors, contrast, structure, ARIA | Then the manual pass: keyboard only, screen reader, 200 % zoom, reduced motion. |
| Google Search Console | `https://search.google.com/search-console` | Ownership, sitemap submission, coverage, Core Web Vitals report | Launch day: submit the sitemap; if the domain changed, run "Change of address" on the old property. |
| dnsviz.net | `https://dnsviz.net/d/<apex>/dnssec/` | DNSSEC chain | Only if DNSSEC is enabled; the report's DNSSEC row uses the DoH `AD` flag. |
| MXToolbox | `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a<apex>` | MX, SPF, DMARC, blacklist status | The report checks SPF/DMARC records; this adds blacklist lookups. |

## What the script cannot see at all

- **Cookies set by JavaScript** and requests made after interaction. The Lighthouse run sees a first load with no consent; a headed browser with the consent banner declined is the real test (Playwright MCP: navigate, decline, list network requests).
- **Behind a login**: nothing past the login page. Audit those templates by exporting their HTML and posting it to the validators, or run Lighthouse with `--extra-headers` carrying a session cookie.
- **Load capacity**: use k6 or oha before a campaign launch; never against a shared staging host without asking.
- **Email delivery**: SPF/DMARC records can be right and mail still land in spam; send a real message through every form on production and read the headers (`Authentication-Results`).
