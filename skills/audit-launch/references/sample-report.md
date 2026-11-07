# Launch audit — site-dev-a1b2c.ondigitalocean.app

**Site:** https://site-dev-a1b2c.ondigitalocean.app/  ·  **Environment:** dev (from --env)  ·  **Date:** 2026-09-24 08:00 UTC  ·  **Tool:** audit-launch 1.0.0 · Lighthouse local 13.5.0
**Production host:** example.dk

**Result:** 48 pass · 17 warn · 1 fail · 53 info · 1 skipped

## Before production

Expected on dev; each must be reversed on the live site.

- [ ] **X-Robots-Tag header** — x-robots-tag: noindex, nofollow → Remove the noindex header on the production site (usually a hosting/env setting or nuxt-robots / SEO package "indexable" flag).
- [ ] **Meta robots** — <meta name="robots" content="noindex, nofollow"> → Remove noindex from the production build; keep it on dev/stage only.
- [ ] **robots.txt** — User-agent: * / Disallow: / — every crawler is blocked → Replace with Allow: / on production and add the Sitemap: line.
- [ ] **Staging hostnames referenced** — dev-example-website.euwest01.umbraco.io, stage-example-website.euwest01.umbraco.io, example-website.euwest01.umbraco.io → Links, assets, CSP sources and og:image that name a dev/stage host will break or leak once that environment is gone.

## Scoreboard

| Measure | Result |
|---|---|
| Lighthouse (mobile) | Perf 69 · A11y 95 · Best practices 73 · SEO 69 (depressed by noindex — expected on dev; re-run on production) · Agentic 1/2 |
| Lighthouse (desktop) | Perf 95 · A11y 100 · Best practices 73 · SEO 69 (depressed by noindex — expected on dev; re-run on production) · Agentic 1/2 |
| Core Web Vitals (lab, mobile) | LCP 7.5 s ❌ · CLS 0 ✅ · TBT 30 ms ✅ |
| Core Web Vitals (field, CrUX) | n/a (no PSI_API_KEY — field data needs the PageSpeed Insights API) |
| Security headers (securityheaders.com-style, estimated) | A — confirm on securityheaders.com [↗](https://securityheaders.com/?q=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F&followRedirects=on) |
| MDN HTTP Observatory | B (70) — 9/12 tests passed [↗](https://developer.mozilla.org/en-US/observatory/analyze?host=site-dev-a1b2c.ondigitalocean.app) |
| W3C validator | 128 errors · 7 warnings (26 distinct) [↗](https://validator.w3.org/nu/?doc=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) |
| schema.org | 1 object (WebSite) · 0 errors · 0 warnings [↗](https://validator.schema.org/#url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) |
| TLS | TLSv1.3 · Google Trust Services · expires in 88 days |

## 1. Crawlability & staging leftovers

| | Check | Evidence | Fix |
|---|---|---|---|
| ℹ️ | X-Robots-Tag header | x-robots-tag: noindex, nofollow (expected on dev — reverse before production) | Remove the noindex header on the production site (usually a hosting/env setting or nuxt-robots / SEO package "indexable" flag). |
| ℹ️ | Meta robots | <meta name="robots" content="noindex, nofollow"> (expected on dev — reverse before production) | Remove noindex from the production build; keep it on dev/stage only. |
| ℹ️ | robots.txt | User-agent: * / Disallow: / — every crawler is blocked (expected on dev — reverse before production) | Replace with Allow: / on production and add the Sitemap: line. |
| ✅ | XML sitemap | 318 URLs in 1 file(s) |  |
| ✅ | Sitemap hosts | every sitemap URL is on this host |  |
| ✅ | Sitemap URLs answer 200 | 10 sampled, all 200 |  |
| ✅ | Canonical | https://site-dev-a1b2c.ondigitalocean.app/ |  |
| ℹ️ | hreflang | no hreflang alternates (fine for a single-language site) |  |
| ✅ | Title | "Welcome to Example Studio - Get Spy Quest Now!" (52 chars) |  |
| ⚠️ | Meta description | 281 chars: "We're an independent game developer and publisher, based in several locations…" | Aim for 50–160 characters. |
| ✅ | html lang | lang="en-US" |  |
| ✅ | Viewport meta | width=device-width, initial-scale=1 |  |
| ✅ | Charset | utf-8 |  |
| ✅ | H1 | one h1: "A guest star joins the World of Shadows" |  |
| ℹ️ | llms.txt | absent — an optional markdown summary for AI agents (Lighthouse "Agentic browsing" scores it) [↗](https://llmstxt.org/) | Optional: publish /llms.txt (llmstxt.org) if the site wants AI agents to find its key pages. |
| ℹ️ | Staging hostnames referenced | dev-example-website.euwest01.umbraco.io, stage-example-website.euwest01.umbraco.io, example-website.euwest01.umbraco.io (expected on dev — reverse before production) | Links, assets, CSP sources and og:image that name a dev/stage host will break or leak once that environment is gone. |

## 2. Redirects

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | Start URL redirect chain | https://site-dev-a1b2c.ondigitalocean.app/ answers 200 directly |  |
| ℹ️ | Redirect matrix | http://site-dev-a1b2c.ondigitalocean.app/ → https://site-dev-a1b2c.ondigitalocean.app/ (301→200→200, 1 hop) · https://site-dev-a1b2c.ondigitalocean.app/ → https://site-dev-a1b2c.ondigitalocean… |  |
| ✅ | HTTP → HTTPS | http://site-dev-a1b2c.ondigitalocean.app/ → https://site-dev-a1b2c.ondigitalocean.app/ (301→200→200, 1 hop) |  |
| ℹ️ | www / apex variant | no www/apex sibling for this hostname |  |
| ✅ | Redirect status codes | every hop is permanent (301/308) |  |

## 3. Real 404s

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | Unknown URL answers 404 | 404 for a random path — "Example Studio" |  |
| ✅ | Custom not-found page | branded page with 46 links — "Example Studio" |  |

## 4. TLS, DNS & email

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | Certificate chain | valid chain (3 certs), issued by Google Trust Services |  |
| ✅ | Certificate expiry | expires 2026-12-22 (88 days) |  |
| ✅ | Certificate names | covers site-dev-a1b2c.ondigitalocean.app (wildcard) |  |
| ✅ | Negotiated protocol | TLSv1.3, ALPN h2, TLS_AES_256_GCM_SHA384 |  |
| ℹ️ | Issuer | Google Trust Services · serial 91FC2E6624162C2F… [↗](https://www.ssllabs.com/ssltest/analyze.html?d=site-dev-a1b2c.ondigitalocean.app&hideResults=on) |  |
| ℹ️ | DNS records | A 172.66.0.96, 162.159.140.98 · AAAA 2a06:98c1:58::60, 2606:4700:7::60 · NS — |  |
| ℹ️ | CAA | no CAA record on site-dev-a1b2c.ondigitalocean.app — platform hostname, its DNS is the host's; re-check on the production domain | Add CAA records naming your CA (e.g. `0 issue "letsencrypt.org"`) so no other CA can be tricked into issuing for the domain. |
| ℹ️ | MX | no MX on site-dev-a1b2c.ondigitalocean.app (no inbound mail) |  |
| ℹ️ | DNSSEC | not signed | Optional: enable DNSSEC at the registrar/DNS host; check dnsviz.net after. |
| ✅ | SPF (example.dk) | v=spf1 include:spf.protection.outlook.com include:amazonses.com include:servers.mcsv.net include:spf.mandrillapp.com include:mail.zendesk.com include:message.teamtailor.com ip4:62.116.222.29 -all (-all, 6 DNS lookups) |  |
| ✅ | DMARC (example.dk) | p=reject, reports to mailto:ekpcn8zx@ag.eu.dmarcian.com, mailto:dmarc_agg@vali.email |  |
| ℹ️ | DKIM (example.dk) | selectors found: selector1, k1 |  |
| ✅ | HSTS preload | preloaded via app (hstspreload.org); header meets the preload requirements [↗](https://hstspreload.org/?domain=site-dev-a1b2c.ondigitalocean.app) |  |

## 5. Exposed files & admin paths

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | Secret files reachable | 13 well-known paths probed (.git, .env, appsettings.json, web.config, …); none served a real file |  |
| ✅ | Backoffice reachable from the internet | no known CMS login answered on this host |  |
| ℹ️ | security.txt | no /.well-known/security.txt — researchers who find a hole have nobody to tell [↗](https://securitytxt.org/) | Add one (Contact:, Expires:, Preferred-Languages:); securitytxt.org generates it. |

## 6. Security headers & CSP

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | Security headers grade (estimated) | A — 6/6 present; warnings: content-security-policy: 'unsafe-inline' in the script list lets any injected inline script run; move inline scripts to files or mark them with a nonce or hash.; content-security-policy: 'unsafe-eval' lets eval() … [↗](https://securityheaders.com/?q=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F&followRedirects=on) | Resolve the warnings for A+. |
| ✅ | HSTS | max-age=31536000; includeSubDomains; preload |  |
| ✅ | Content-Security-Policy | default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://www.googletagmanager.com https://connect.facebook.net https://www.google.com https://snap.licdn.com https://www.reddit |  |
| ✅ | X-Frame-Options | satisfied by CSP frame-ancestors |  |
| ✅ | X-Content-Type-Options | nosniff |  |
| ✅ | Referrer-Policy | strict-origin-when-cross-origin |  |
| ✅ | Permissions-Policy | camera=(), microphone=(), geolocation=(), interest-cohort=() |  |
| ⚠️ | CSP lint | 'unsafe-inline' in the script list lets any injected inline script run; move inline scripts to files or mark them with a nonce or hash. · 'unsafe-eval' lets eval() and new Function() run injected strings; remove it and fix the library that … [↗](https://csp-evaluator.withgoogle.com/) | Move inline scripts to nonces or hashes, drop unsafe-eval and wildcards, add object-src 'none' and base-uri; verify in the CSP Evaluator. |
| ⚠️ | Version disclosure | x-powered-by: Nuxt | Remove or blank these headers; they advertise the exact software version to scanners. |
| ⚠️ | Cookies on first response | 2 cookie(s): i18n_redirected, __cf_bm — i18n_redirected: No Secure attribute: the cookie would also be sent over plain http; add Secure. | Set Secure on every cookie over https, HttpOnly on anything a script does not need, and an explicit SameSite. |
| ✅ | CORS | no CORS header |  |
| ℹ️ | COOP / COEP / CORP | COOP — · COEP — · CORP — | Optional hardening; needed only for SharedArrayBuffer or to isolate the window from cross-origin pop-ups. |
| ⚠️ | MDN HTTP Observatory | B (70/100), 9/12 tests passed — failed: content-security-policy (csp-implemented-with-unsafe-inline, -20); cookies (cookies-without-secure-flag-but-protected-by-hsts, -5); subresource-integrity (sri-not-implemented-but-external-scripts-load… [↗](https://developer.mozilla.org/en-US/observatory/analyze?host=site-dev-a1b2c.ondigitalocean.app) | Remove unsafe-inline and data: from script-src, overly broad sources from object-src and script-src, and ensure object-src and script-src are set. Use Secure flag. Add SRI to external scripts. |
| ⏭️ | securityheaders.com grade | Cloudflare challenge blocked the headless browser — open the link to confirm the estimated grade [↗](https://securityheaders.com/?q=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F&followRedirects=on) |  |

## 7. Caching, compression & protocol

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | HTML compression | content-encoding: br (281 kB decoded) |  |
| ℹ️ | HTML Cache-Control | s-maxage=600, stale-while-revalidate |  |
| ℹ️ | Validators | last-modified Thu, 24 Sep 2026 07:47:56 GMT |  |
| ℹ️ | CDN / edge | cf-cache-status BYPASS · server cloudflare |  |
| ℹ️ | Vary | no Vary header |  |
| ✅ | HTTP version | HTTP/2 from 162.159.140.98 |  |
| ℹ️ | HTTP/3 | advertised via alt-svc (h3=":443"; ma=86400) |  |
| ✅ | Time to first byte (server) | 56 ms after the TLS handshake (dns 3 ms, connect 4 ms, tls 11 ms, total 78 ms) |  |
| ⚠️ | Static asset caching | DOVFwu-e.js: max-age 31536000 immutable compressed · email-decode.min.js: no max-age compressed | Serve hashed CSS/JS/fonts with Cache-Control: public, max-age=31536000, immutable; short max-age only for un-hashed files. |

## 8. Performance

| | Check | Evidence | Fix |
|---|---|---|---|
| ⚠️ | Lighthouse (mobile) | Perf 69 · A11y 95 · Best practices 73 · SEO 69 (depressed by noindex — expected on dev; re-run on production) · Agentic 1/2 — local Lighthouse 13.5.0 | See the opportunities row; LCP and TBT are usually image delivery, render-blocking CSS/JS and third-party scripts. |
| ✅ | Lighthouse (desktop) | Perf 95 · A11y 100 · Best practices 73 · SEO 69 (depressed by noindex — expected on dev; re-run on production) · Agentic 1/2 — local Lighthouse 13.5.0 |  |
| ❌ | Core Web Vitals (lab, mobile) | LCP 7.5 s (poor) · CLS 0 (good) · TBT 30 ms (good) · FCP 3.2 s (poor) · SI 3.2 s (good) | Targets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms (INP ≤ 200 ms in the field). |
| ℹ️ | Core Web Vitals (field, CrUX) | not available from a local run; set PSI_API_KEY to get CrUX field data |  |
| ℹ️ | Top opportunities (mobile) | Reduce unused JavaScript — Est savings of 68 KiB · Legacy JavaScript — Est savings of 9 KiB · Use efficient cache lifetimes — Est savings of 0 KiB · Improve image delivery — Est savings of 72 KiB · Network dependency tree · Reduce unused CS… |  |
| ℹ️ | Third-party cost | 2 third parties, 0 ms main-thread blocking: cookieinformation.com, umbraco.io |  |
| ⚠️ | Lighthouse (page, mobile) (page: https://site-dev-a1b2c.ondigitalocean.app/shadow/news/2024/vr-edition) | Perf 68 · A11y 92 · Best practices 73 · SEO 69 (depressed by noindex — expected on dev; re-run on production) · Agentic 1/2 | Start with: Reduce unused JavaScript |
| ⚠️ | Lighthouse (page, mobile) (page: https://site-dev-a1b2c.ondigitalocean.app/careers/news/2021/studio-week-2021) | Perf 79 · A11y 92 · Best practices 73 · SEO 61 (depressed by noindex — expected on dev; re-run on production) · Agentic 1/2 | Start with: Improve image delivery |
| ⚠️ | Lighthouse (page, mobile) (page: https://site-dev-a1b2c.ondigitalocean.app/spyquest/news/2026/meet-the-team) | Perf 81 · A11y 95 · Best practices 73 · SEO 69 (depressed by noindex — expected on dev; re-run on production) · Agentic 1/2 | Start with: Reduce unused JavaScript |
| ℹ️ | Agentic browsing (Lighthouse) | 1/2 — agent-accessibility-tree: fail · webmcp-form-coverage: n/a · webmcp-registered-tools: n/a · webmcp-schema-validity: n/a · cumulative-layout-shift: pass · llms-txt: n/a · ard-schema: n/a | Experimental category: an llms.txt and a clean accessibility tree help AI agents; not a launch requirement. |

## 9. Accessibility

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | Lighthouse accessibility (start page) | 95/100 — failing: Buttons do not have an accessible name (1) |  |
| ✅ | Lighthouse accessibility (page) (page: https://site-dev-a1b2c.ondigitalocean.app/shadow/news/2024/vr-edition) | 92/100 — Buttons do not have an accessible name (1) · Links do not have a discernible name (1) |  |
| ✅ | Lighthouse accessibility (page) (page: https://site-dev-a1b2c.ondigitalocean.app/careers/news/2021/studio-week-2021) | 92/100 — Buttons do not have an accessible name (1) · Background and foreground colors do not have a sufficient contrast ratio. (1) |  |
| ✅ | Lighthouse accessibility (page) (page: https://site-dev-a1b2c.ondigitalocean.app/spyquest/news/2026/meet-the-team) | 95/100 — Buttons do not have an accessible name (1) |  |
| ℹ️ | Keyboard-only pass | Tab through the main flows: every control reachable, focus visible, no traps, Escape closes overlays. |  |
| ℹ️ | Skip link and landmarks | A "skip to content" link is the first Tab stop; header/nav/main/footer landmarks exist once. |  |
| ℹ️ | Screen reader pass | VoiceOver (macOS) or NVDA on the homepage, a form and a card list: headings, labels, image alternatives make sense read aloud. |  |
| ℹ️ | 200 % zoom / 320 px width | Nothing clipped, no horizontal scroll, text reflows. |  |
| ℹ️ | Reduced motion | prefers-reduced-motion stops autoplaying carousels, parallax and video. |  |
| ℹ️ | Forms | Every input has a visible label, errors are announced and described in text, not colour alone. |  |
| ℹ️ | Contrast in every state | Hover, focus and disabled states also meet 4.5:1 / 3:1 — Lighthouse tests the resting state only. |  |
| ℹ️ | European Accessibility Act | In force since 28 June 2025 for consumer-facing services in the EU: WCAG 2.1 AA (EN 301 549) is the expected bar, and an accessibility statement page is customary. [↗](https://www.w3.org/WAI/standards-guidelines/wcag/) |  |

## 10. Privacy & cookies

| | Check | Evidence | Fix |
|---|---|---|---|
| ✅ | Cookies before consent | only essential/infrastructure cookies on the first response (i18n_redirected, __cf_bm) |  |
| ✅ | Trackers loaded before consent | no known analytics/ads/session-replay host contacted on first load (Lighthouse page load) |  |
| ℹ️ | Third-party hosts on first load | dev-example-website.euwest01.umbraco.io · policy.app.cookieinformation.com |  |
| ℹ️ | Consent tool | Cookiebot detected |  |
| ℹ️ | Manual privacy checks | Run Webbkoll and Blacklight on the production URL after launch; read the cookie policy against what the site actually sets. [↗](https://themarkup.org/blacklight?url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) |  |

## 11. Links, mixed content, social previews & icons

| | Check | Evidence | Fix |
|---|---|---|---|
| ⚠️ | W3C HTML validator | 128 errors, 7 warnings (26 distinct) — 59× A “link” element with an “as” attribute must have a “rel” attribute that contains the valu · 10× CSS: Parse Error. · 8× CSS: “animation-timeline”: Property “animation-timeline” doesn't exist. · 6× … [↗](https://validator.w3.org/nu/?doc=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) | Group by message (the raw w3c.json has them all): most are one template fix each — e.g. link[as] without rel, unknown CSS values, block elements inside inline ones. |
| ✅ | schema.org validator | 1 object(s) (WebSite), 0 errors, 0 warnings [↗](https://validator.schema.org/#url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) |  |
| ⚠️ | Crawl | 100 pages fetched (capped at --max-pages 100): 99 HTML 200, 1 4xx, 0 5xx/unreachable | Fix or redirect the linked pages that 404. |
| ⚠️ | Broken internal links | 1: 404 https://site-dev-a1b2c.ondigitalocean.app/Amazon.com ← https://site-dev-a1b2c.ondig… | Fix the href or redirect the old URL; each is a dead end for users and crawlers. |
| ⚠️ | Broken external links | 5 of 113 checked: 404 https://bsky.app/profile/game.example.dk; ECONNRESET: read ECONNRESET https://www.spyquest.example.com/; ENOTFOUND: getaddrinfo ENOTFOUND here https://here/; 404 https://example.app.box.com/s/ih74jc04vg9itcjkcjebuo8ce… | Replace or remove dead outbound links. |
| ✅ | Mixed content | none on 99 pages |  |
| ✅ | Images without alt | every image on 99 pages has an alt attribute |  |
| ⚠️ | Images with empty alt | 659 of 674 images (98%) carry alt="" — content images seem to have no description | Give content images (product shots, article images, people) real alt text from the CMS; keep alt="" only for decoration. |
| ⚠️ | Titles & descriptions across pages | 76 without meta description; 8 duplicated title(s): "2021" ×2 | Unique title and description per page; templates should fall back to page name + site name. |
| ℹ️ | H1 across pages | 9 page(s) without an h1, e.g. https://site-dev-a1b2c.ondigitalocean.…, https://site-dev-a1b2c.ondigitalocean.…, https://site-dev-a1b2c.ondigitalocean.… |  |
| ℹ️ | Structured data across pages | 99/99 pages carry JSON-LD: Organization ×99, WebSite ×99, VideoGame ×9, Article ×8 |  |
| ✅ | Share preview tags | og:title "Welcome to Example Studio - Get Spy Quest Now!", og:type website, twitter:card summary_large_image |  |
| ⚠️ | og:image | 1080×1080 jpeg (67 kB) | Use at least 1200×630 (1.91:1) so LinkedIn/Facebook show the large card. |
| ✅ | og:url | https://site-dev-a1b2c.ondigitalocean.app |  |
| ✅ | Favicon | 3 rel=icon (image/x-icon, image/png, image/png); /favicon.ico 200 |  |
| ✅ | Apple touch icon | 180×180 png |  |
| ℹ️ | Web manifest | https://site-dev-a1b2c.ondigitalocean.app/site.webmanifest: no name, no start_url | Only matters for install prompts / PWA; add name, start_url and 192 + 512 icons if that is wanted. |

## 12. Operational readiness

- [ ] Uptime monitoring — A monitor (UptimeRobot, Better Stack, Cloudflare health check) watches the production URL and alerts a person.
- [ ] Error tracking — The production DSN (Sentry or similar) receives events from the live domain, not the staging project.
- [ ] Analytics on the production domain — The production property receives data from the live hostname; staging traffic is filtered out.
- [ ] Certificate renewal — Renewal is automatic, and an expiry alert exists in case it is not.
- [ ] DNS TTL before the switch — TTLs on the records that change at launch are lowered (300 s) a day ahead, and raised again after.
- [ ] Redirects from the old site — Every old URL with traffic or backlinks 301s to its new page (run with --old-sitemap when that lands).
- [ ] Search Console — Ownership verified for the live domain; the sitemap submitted on launch day; the old property's change-of-address done if the domain moved.
- [ ] Social share caches — LinkedIn Post Inspector and Facebook Sharing Debugger re-scraped so previews shared during staging update.
- [ ] Backups — A restore has been rehearsed, not only configured, for the CMS database and media.
- [ ] CDN purge — The cache is purged after the final deploy; stale staging HTML is not what visitors see first.
- [ ] WAF and rate limiting — Bot protection is on for production, with the audit/monitoring IPs allowlisted.
- [ ] Forms and transactional email — Every form on the site has been submitted once on production and the email arrived (SPF/DMARC pass).
- [ ] Legal pages — Privacy policy, cookie policy and imprint are live, linked from the footer, and the consent tool matches what the site loads.
- [ ] Post-launch 404 monitoring — Someone watches Search Console / server logs for 404s in the first two weeks.

## Manual checks

No API for these; the links carry the URL.

- [securityheaders.com](https://securityheaders.com/?q=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F&followRedirects=on) — The official grade; the report's grade is an estimate unless the scrape succeeded.
- [Google CSP Evaluator](https://csp-evaluator.withgoogle.com/) — Paste the CSP header; finds bypassable policies that look fine at a glance.
- [PageSpeed Insights](https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — Field data (CrUX) and the same Lighthouse run on Google's infrastructure.
- [Google Rich Results Test](https://search.google.com/test/rich-results?url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — What Google will actually render as a rich result.
- [validator.w3.org/nu](https://validator.w3.org/nu/?doc=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — The full message list behind the counts in the scoreboard.
- [validator.schema.org](https://validator.schema.org/#url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — Structured data as the validator renders it.
- [MDN HTTP Observatory](https://developer.mozilla.org/en-US/observatory/analyze?host=site-dev-a1b2c.ondigitalocean.app) — Per-test explanations and recommendations.
- [Qualys SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=site-dev-a1b2c.ondigitalocean.app&hideResults=on) — Protocol, cipher and chain grading (or run with --ssllabs).
- [hstspreload.org](https://hstspreload.org/?domain=site-dev-a1b2c.ondigitalocean.app) — Preload eligibility and submission.
- [Webbkoll](https://webbkoll.dataskydd.net/en/check?url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — Third-party requests and cookies set before consent (GDPR).
- [Blacklight (The Markup)](https://themarkup.org/blacklight?url=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — Second opinion on trackers, session recording and fingerprinting.
- [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/inspect/https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — Share preview; also clears LinkedIn's cached preview from staging.
- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/?q=https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — Share preview; "Scrape again" clears the stale cache.
- [RealFaviconGenerator checker](https://realfavicongenerator.net/favicon_checker?protocol=https&site=site-dev-a1b2c.ondigitalocean.app) — Favicons, touch icons and the web manifest across platforms.
- [WAVE](https://wave.webaim.org/report#/https%3A%2F%2Fsite-dev-a1b2c.ondigitalocean.app%2F) — Accessibility issues Lighthouse does not catch; then a keyboard-only pass by hand.

<details>
<summary>Appendix — pages crawled, raw files</summary>

| Page | Status | Title | H1 | Images without alt | Mixed content |
|---|---|---|---|---|---|
| https://site-dev-a1b2c.ondigitalocean.app/ | 200 | Welcome to Example Studio - Get Spy Quest Now! | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news/2024/vr-edition | 200 | SHADOW VR, out now | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/news/2021/studio-week-2021 | 200 | Studio Week 2021 | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spyquest/news/2026/meet-the-team | 200 | Spy Quest – Meet the team | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news/2021 | 200 | 2021 | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/news/2020 | 200 | 2020 | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/deai | 200 | DEAI | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal/security | 200 | Security/ | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/testimonials/2023/team-member-art | 200 | Team member - Art | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spyquest/faq | 200 | FAQ | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spyquest/news/2025 | 200 | 2025 | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news/2025/launch-trailer | 200 | Launch trailer | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news/2023 | 200 | 2023 | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spy-quest-collectors-and-legacy-editions | 200 | Get the Spy Quest Collectors and Legacy Editions Now | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spyquest | 200 | GET SPY QUEST NOW | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spy-quest-deluxe-edition | 200 | SPY QUEST - DELUXE EDITION | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spy-quest-standard-edition | 200 | Get the Spy Quest Standard Edition Now | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/example | 200 | Game Features | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about | 200 | About | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/game-three | 200 | Game Three | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/campaign-spyquest | 200 | SPY QUEST - GET UP TO -20% OFF | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers | 200 | Studio Careers | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/engine | 200 | Engine | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow-2 | 200 | Shadow 2 | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/engine/news | 200 | News | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow-5 | 200 | Shadow 5 | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow-4 | 200 | Shadow 4 | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow-1 | 200 | Shadow 1 | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow-3 | 200 | Shadow 3 | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow | 200 | SHADOW World of Shadows | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners | 200 | Studio Partners | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/game-five | 200 | Game Five | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news/2025 | 200 | 2025 | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/game-four | 200 | Game Four | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal | 200 | Legal | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/press | 200 | Press | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/game-two | 200 | Game Two | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal/studio-partners-legal/privacy-policy | 200 | Privacy Policy | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova | 200 | Project Nova | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spring-event | 200 | Play the spring event for free in SHADOW World of Shadows | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/roadmaps/2022/july-roadmap | 200 | July Roadmap | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/news/2022/studio-week-2022 | 200 | Studio Week 2022 | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spyquest/patch-notes/2026/1-0-1-game-update | 200 | 1.0.1 \| Game Update \| Spy Quest | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/news/2021 | 200 | 2021 | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news/2022 | 200 | 2022 | 0 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/news | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/blogs | 200 | Blogs | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/studio-four | 200 | Studio Four | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/?panel=/shadow/news/2026/guest-star-joins-the-world-of-shadows… | 200 | Welcome to Example Studio - Get Spy Quest Now! | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/studio-two | 200 | Studio Two | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/studio-three | 200 | Studio Three | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers/studio-one | 200 | Studio One | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal/terms-of-use | 200 | Terms of Use/ | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal/end-user-licence-agreement | 200 | End User Licence Agreement | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal/player-support | 200 | Player Support | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal/privacy-policy | 200 | Privacy Policy/ | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/spyquest/patch-notes/2026/1-1-1-game-u… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/legal/health-warning | 200 | Health Warning/ | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/shadow/roadmaps/2026/season-of-spring | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/shadow/news/2026/guest-star-joins-the-world… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/shadow/patch-notes/2026/game-update-3-280 | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/spyquest/news/2026/spy-quest-s-p… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/spyquest/news/2026/spy-quest-rea… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/spyquest/patch-notes/2026/1-1-0-game-u… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/shadow/news?panel=/spyquest/patch-notes/2026/1-0-5-game-u… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/spyquest/patch-notes/2026/1-1-1-game-upda… | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/shadow/patch-notes/2026/game-update-3-280 | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/shadow/roadmaps/2026/season-of-spring | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/shadow/news/2026/guest-star-joins-the-world… | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/spyquest/news/2026/spy-quest-reache… | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/spyquest/news/2026/spy-quest-s-path… | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/spyquest/patch-notes/2026/1-1-0-game-upda… | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about/di?panel=/spyquest/patch-notes/2026/1-0-5-game-upda… | 200 | DI | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/shadow/patch-notes/2026/game-update-3-… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/spyquest/patch-notes/2026/1-1… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/shadow/roadmaps/2026/season-of-the-her… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/shadow/news/2026/guest-star-joins-the-world… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/spyquest/news/2026/spy-quest-… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/spyquest/patch-notes/2026/1-1… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/spyquest/news/2026/spy-quest-… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/Amazon.com | 404 | Example Studio | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/project-nova/news?panel=/spyquest/patch-notes/2026/1-0… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/spyquest?panel=spyquest%2Ffaq?panel=spyquestfaq… | 200 | GET SPY QUEST NOW | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about?panel=/careers/studio-four | 200 | About | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about?panel=/careers/studio-two | 200 | About | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers?panel=/careers/studio-one | 200 | Studio Careers | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers?panel=/careers/studio-two | 200 | Studio Careers | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/about?panel=/careers/studio-three | 200 | About | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers?panel=/careers/studio-four | 200 | Studio Careers | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers?panel=/careers/studio-three | 200 | Studio Careers | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/careers?panel=/careers/diversity-and-inclusion | 200 | Studio Careers | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news?panel=/spyquest/patch-notes/2026/1-1-1-… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news?panel=/shadow/roadmaps/2026/season-of-spri… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news?panel=/shadow/news/2026/guest-star-joins-the-world… | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news?panel=/shadow/patch-notes/2026/game-update-3-280 | 200 | News | 1 | 0 | 0 |
| https://site-dev-a1b2c.ondigitalocean.app/studio-partners/news?panel=/spyquest/news/2026/spy-quest-lig… | 200 | News | 1 | 0 | 0 |

Raw files: `w3c.json`, `observatory.json`, `schema.json`, `lighthouse-mobile.json`, `lighthouse-desktop.json`, `lighthouse-page-1.json`, `lighthouse-page-2.json`, `lighthouse-page-3.json`

</details>
