# Every check: what it means, when it fails, what to do

Status words: **fail** = fix before launch (a `blocker` when it makes the site unusable or unsafe); **warn** = should fix; **info** = for your information or a checklist item; **skip** = not evaluated, with the reason in the evidence — never read a skip as a pass.

On **dev/staging** (`--env dev|staging`, or guessed from the hostname), findings marked *before production* are demoted to info and collected into the report's "Before production" checklist. On production they fail, and a fail there is a blocker.

## 1. crawl — Crawlability & staging leftovers

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `crawl.x-robots-tag` | `X-Robots-Tag` response header | `noindex`/`none` fail *(before production)*; `nofollow` warn | Hosting/env setting or the SEO package's "indexable" flag; nuxt-robots, Next `robots`, Umbraco SEO packages all have one. |
| `crawl.meta-robots` | `<meta name="robots">` / `googlebot` | same | Same place as above, in the layout template. |
| `crawl.robots-txt` | robots.txt | 404 warn; not plain text warn; 5xx warn; `Disallow: /` for `*` fail *(before production)*; no `Sitemap:` line info | `User-agent: *`, `Allow: /`, `Sitemap: https://host/sitemap.xml`. |
| `crawl.sitemap` | XML sitemap found and parsed | none → warn; index files followed (≤ 5 children, ≤ 5,000 URLs) | Generate from the CMS; declare in robots.txt; submit in Search Console. |
| `crawl.sitemap-hosts` | Every `<loc>` on this host | other hosts fail (production host on dev → info) | Generate from the live hostname. |
| `crawl.sitemap-sample` | 10 sitemap URLs answer 200 | any non-200 → warn (redirects) / fail (404/5xx) | Sitemaps list final URLs only. |
| `crawl.canonical` | `<link rel="canonical">` | none warn; relative warn; other host fail (production host on dev → info); other path warn | Self-referencing absolute canonical per page. |
| `crawl.hreflang` | Alternates well-formed and reciprocal | none info; bad codes / no self / no x-default / not reciprocal → warn | Each language lists all languages incl. itself and x-default. |
| `crawl.title` | `<title>` | none fail; outside 10–60 chars warn | Unique per page. |
| `crawl.meta-description` | Meta description | none warn; outside 50–160 warn | Unique per page. |
| `crawl.lang` | `<html lang>` | missing warn | Set it; screen readers depend on it. |
| `crawl.viewport` | Viewport meta | missing fail | `width=device-width, initial-scale=1`. |
| `crawl.charset` | Charset declared | missing warn; not UTF-8 info | `<meta charset="utf-8">` first in head. |
| `crawl.h1` | H1 count on the start page | 0 warn; > 1 info | One h1. |
| `crawl.llms-txt` | `/llms.txt` | info only | Optional (llmstxt.org); Lighthouse "Agentic browsing" scores it. |
| `crawl.staging-refs` | dev/stage hostnames in links, assets, CSP, canonical, og, sitemap | any → warn *(before production)* | Replace before the staging host disappears. |

## 2. redirects

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `redirects.start-url` | Hops from the given URL to the final one | > 1 warn | One 301. |
| `redirects.matrix` | http/https × apex/www table | info | — |
| `redirects.http-to-https` | `http://` → `https://` | none fail; 302/307 warn; > 1 hop warn; unreachable warn on production | 301 at the edge; HSTS on the https response. |
| `redirects.www-variant` | The other host (www or apex) | lands on the final host in one permanent hop pass; serves its own copy warn; unreachable warn on production | 301 to the canonical host. |
| `redirects.hop-types` | 302/307 anywhere | warn | 301/308. |
| `redirects.hsts-on-https-hops` | HSTS on every https response in the matrix | missing info | Send HSTS on redirects too. |

## 3. notfound

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `notfound.random-path` | A random path | 404/410 pass; 200 with "not found" wording warn (soft 404); 200 otherwise fail; redirect to home warn; 5xx fail | Return 404 from the catch-all route. |
| `notfound.custom-page` | Branded error page | platform default → info | Navigation + search on the 404 page. |

## 4. tls / dns / email / hsts

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `tls.chain` | Certificate trusted | untrusted fail (blocker); `--insecure` info; http only fail | Full chain from a public CA. |
| `tls.expiry` | Days left | < 14 fail; < 30 warn | Automate renewal, alert on expiry. |
| `tls.san` | Names covered | host missing fail (blocker); www/apex sibling missing warn | Add the sibling name. |
| `tls.protocol` | Negotiated version | below TLS 1.2 warn | TLS 1.2 + 1.3 only. |
| `tls.issuer` | CA and serial | info | — |
| `dns.records` | A/AAAA/NS | info | IPv6 is optional but cheap on a CDN. |
| `dns.caa` | CAA on host or apex | none warn | `0 issue "letsencrypt.org"` (or your CA). |
| `dns.mx` | Mail exchangers on the apex | info | — |
| `dns.dnssec` | DoH `AD` flag | info | Optional. |
| `email.spf` | `v=spf1` on the email domain | 0 records: warn with MX, info without; > 1 fail; `-all`/`~all` pass; `?all`/`+all` warn; > 10 lookups warn | One record ending `-all` (or `~all`). |
| `email.dmarc` | `_dmarc.<domain>` | missing: fail with MX, warn without; `p=none` warn | `v=DMARC1; p=quarantine; rua=mailto:…` |
| `email.dkim` | Common selectors | info | Confirm the provider's selector. |
| `hsts.preload` | Header eligibility + list status | info | Only preload when every subdomain is https-only. |

## 5. exposed

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `exposed.secret-files` | `.git/HEAD`, `.env`, `appsettings*.json`, `web.config`, `.DS_Store`, `wp-config.php`, `.htaccess`, `phpinfo.php`, `server-status` — a hit needs a body signature, a 200 alone is not one | any → fail (blocker) | Block at the server/CDN; rotate what leaked. |
| `exposed.manifests` | `package.json`, `composer.json` served | warn | Exclude from the deploy or block; they list exact library versions. |
| `exposed.admin-paths` | `/umbraco`, `/sitecore`, `/wp-admin`, `/admin`, … reachable | reachable → warn *(before production)* | IP allowlist / Access / MFA; rate-limit the login. |
| `exposed.security-txt` | RFC 9116 file | missing info; missing `Expires` / expired / > 1 year → warn | securitytxt.org generator. |

## 6. headers

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `headers.grade` | securityheaders.com-style grade, **estimated locally** | A+/A pass; B/C warn; D–F fail | Add missing headers; resolve warnings for A+. |
| `headers.hsts` … `headers.permissions-policy` | Each of the six headers | missing fail; HSTS max-age < 6 months warn; XCTO not `nosniff` fail; report-only CSP warn | One line each in the server/CDN/framework config. |
| `headers.csp-lint` | `unsafe-inline`/`unsafe-eval`/wildcards/no script restriction/bypass hosts/missing `frame-ancestors` | any warn | Nonces or hashes, `strict-dynamic`, `object-src 'none'`, `base-uri 'self'`. |
| `headers.info-leak` | `server` with a version, `x-powered-by`, `x-aspnet-version`, … | warn | Remove the headers. |
| `headers.cookies` | Flags on first-response cookies | `SameSite=None` without Secure fail; no Secure warn; sensitive without HttpOnly warn | `Secure; HttpOnly; SameSite=Lax`. |
| `headers.cors` | `Access-Control-Allow-Origin` | `*` info; `*` + credentials fail | Echo an allowlisted origin. |
| `headers.cross-origin-policies` | COOP/COEP/CORP | info | Optional hardening. |
| `headers.observatory` | MDN HTTP Observatory | A pass; B warn; C or worse fail | Follow each failed test's recommendation. |
| `headers.securityheaders-scrape` / `-api` | The real securityheaders.com grade | info when obtained; skip when the Cloudflare challenge blocks it | Open the link; or set `SECURITYHEADERS_API_KEY`. |

## 7. caching

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `caching.compression` | HTML `content-encoding` | none fail | brotli/gzip for text. |
| `caching.document-cache-control` | HTML Cache-Control | info | Decide explicitly. |
| `caching.validators` | ETag / Last-Modified | info | — |
| `caching.cdn` | Edge cache headers | info | — |
| `caching.vary` | Vary | info; User-Agent/Cookie noted | Avoid varying on UA/Cookie. |
| `caching.http-version` | From curl | h2/h3 pass; 1.1 warn | Enable HTTP/2. |
| `caching.alt-svc-h3` | HTTP/3 advertised | info | Optional. |
| `caching.ttfb` | Server time after TLS | < 800 ms pass; < 1.8 s warn; else fail | Edge-cache HTML; profile the origin. |
| `caching.static-assets` | Up to 5 same-origin CSS/JS/images | max-age < 1 week and not immutable → warn; long max-age without a hash → info | `public, max-age=31536000, immutable` on hashed files. |

## 8. perf

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `perf.lighthouse-mobile` / `-desktop` | Five category scores | performance ≥ 90 pass; ≥ 50 warn; else fail. On dev the SEO score is annotated "depressed by noindex" | Opportunities row; LCP and TBT first. |
| `perf.cwv-lab` | LCP/CLS/TBT (lab) | LCP 2.5/4 s, CLS 0.1/0.25, TBT 200/600 ms | Same targets in the field with INP ≤ 200 ms. |
| `perf.cwv-field` | CrUX p75 (PSI only) | overall FAST/AVERAGE/SLOW | Needs real traffic. |
| `perf.opportunities` | Top 8 by savings | info | — |
| `perf.third-parties` | Main-thread blocking by third parties | > 250 ms warn | Defer, facade, or load after consent. |
| `perf.page` | Sampled sitemap pages (mobile) | as above, per page | The slow template. |
| `perf.agentic` | Lighthouse "Agentic browsing" fraction | info | Experimental. |

## 9. a11y

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `a11y.lighthouse` / `a11y.page` | Lighthouse accessibility per page | ≥ 90 pass; else warn, with failing audits | Alt, contrast, link names, labels. |
| `a11y.manual-*` | Keyboard, skip link, screen reader, zoom, motion, forms, state contrast | info checklist | Do the pass by hand (Playwright MCP helps). |
| `a11y.eaa` | European Accessibility Act | info | WCAG 2.1 AA + statement page. |

## 10. privacy

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `privacy.cookies-first-load` | Non-essential cookies on the first response | any → warn *(before production)* | Only strictly necessary cookies before consent. |
| `privacy.trackers` | Analytics/ads/session-replay hosts contacted on first load (Lighthouse network log; static scan fallback) | any → warn *(before production)* | Consent mode / script blocking. |
| `privacy.third-party-hosts` | Everyone contacted, grouped | info | — |
| `privacy.consent-tool` | CMP detected | info | Required with trackers in the EU. |
| `privacy.manual` | Webbkoll / Blacklight | info | Run on production. |

## 11. links / social / icons

| id | Meaning | Rule | Fix |
|---|---|---|---|
| `links.crawl-summary` | Pages fetched, statuses | 5xx fail; 4xx warn | — |
| `links.internal-broken` | Internal links that do not answer 2xx/3xx | 5xx fail; else warn | Fix or redirect. |
| `links.external-broken` | External links (HEAD, then GET) | broken warn; 403/429/999 = blocked, info | Replace dead links. |
| `links.mixed-content` | `http://` sub-resources on https pages | any fail | https everywhere. |
| `links.images-alt` | `<img>` without an alt attribute | any warn | alt text or `alt=""`. |
| `links.images-empty-alt` | Share of images with `alt=""` | > 50 % of ≥ 20 images warn | Real alt text on content images; `alt=""` only for decoration. |
| `links.titles-descriptions` | Missing/duplicate titles, missing descriptions | any warn | Unique per page. |
| `links.h1` | Pages without h1 | info | — |
| `links.jsonld` | JSON-LD types across pages | info | — |
| `links.w3c` | W3C Nu validator | fatal fail; errors warn; warnings info | Group by message; one template fix each. |
| `links.schema-org` | validator.schema.org | errors warn; none found info | Fix properties; then Rich Results Test. |
| `social.og` | og:title/description/image/url + twitter:card | missing warn | Add per template. |
| `social.og-image` | Reachable, ≥ 1200×630, ~1.91:1 | unreachable fail; small warn; other ratio info; staging host *(before production)* | 1200×630 JPEG/PNG on the live host. |
| `social.og-url` | Equals canonical | differs warn/info | Match the canonical. |
| `icons.favicon` | `rel=icon` and `/favicon.ico` | neither warn | SVG + ICO. |
| `icons.apple-touch` | 180×180 | missing info; unreachable warn | — |
| `icons.manifest` | Valid JSON, name, start_url, 192 + 512 icons | missing info; invalid warn | Only for PWA/install. |

## 12. ops

All info, rendered as a checklist: uptime monitor, error-tracking DSN, analytics on the live domain, certificate renewal alert, DNS TTL lowered before the switch, redirect map from the old site, Search Console, social caches re-scraped, backups rehearsed, CDN purge, WAF, forms and email tested, legal pages, 404 monitoring after launch.

## Per-stack notes

- **Nuxt**: `nuxt-robots` / `@nuxtjs/seo` control noindex and robots.txt per environment (`indexable`); `nuxt-security` sets the headers and CSP nonces.
- **Next.js**: `headers()` in `next.config.js` for security headers; `app/robots.ts` and `app/sitemap.ts`; `metadata.robots` per route.
- **Umbraco**: security headers via middleware or `web.config` `<customHeaders>`; restrict `/umbraco` by IP or Cloudflare Access; robots/sitemap from an SEO package or a Root-file block; `X-Powered-By` off in the host.
- **Sitecore**: `/sitecore` login must not be public on CD servers; headers in `web.config`; canonical/hreflang from the SXA or custom components.
- **Cloudflare**: Transform Rules for headers, HSTS toggle under SSL/TLS, Bot Fight Mode can block audits (allowlist the IP or skip for staging), Cache Rules for `immutable` assets, `Always Use HTTPS` + `Automatic HTTPS Rewrites` for the redirect matrix.
