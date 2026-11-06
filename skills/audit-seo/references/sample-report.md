# SEO audit — browser.style

**Site:** https://browser.style/ · **Date:** 2026-11-06 · **Tool:** audit-seo 2.4.0

**Result:** 0 fail, 11 warn, 13 pass, 12 info, 1 skipped

**GEO readiness:** 93/100 over 21 AI search checks (0 fail, 3 warn, 9 pass, 9 info, 1 skipped). A summary of the checks below, not a measure of how often AI engines cite the site.

**Crawled:** 20 HTML pages and 4 other URLs (3 redirects, 1 errors) by following links (stopped at the --pages cap of 20; the site has more). 20 pages are indexable. 213 more link targets past the cap were checked for a status only.

## Fix list

| # | Status | Check | Finding | Pages |
|---|---|---|---|---|
| 1 | ⚠️ Warn | Missing canonical | 20 indexable pages without rel=canonical | 20 |
| 2 | ⚠️ Warn | Open Graph tags | 20 indexable pages miss og:title, og:description or og:image | 20 |
| 3 | ⚠️ Warn | Duplicate descriptions | 2 descriptions shared by 18 indexable pages | 18 |
| 4 | ⚠️ Warn | Title length | 11 titles outside 10–60 characters | 11 |
| 5 | ⚠️ Warn | Duplicate titles | 2 titles shared by 4 indexable pages | 4 |
| 6 | ⚠️ Warn | AI crawlers at the edge | robots.txt lets them in, but the edge refuses PerplexityBot on 3 pages of 3, while a Googlebot user agent gets the page | 3 |
| 7 | ⚠️ Warn | Broken internal links | 3 URLs linked from the site answer 404 | 3 |
| 8 | ⚠️ Warn | Broken external links | 2 external links of 4 checked are dead | 2 |
| 9 | ⚠️ Warn | Entity markup for answer engines | start page has no Organization (or LocalBusiness/Person) and no WebSite JSON-LD | 1 |
| 10 | ⚠️ Warn | Structured data coverage | no JSON-LD on any indexable page, also after rendering in Chrome |  |
| 11 | ⚠️ Warn | XML sitemap | no sitemap found (robots.txt, /sitemap.xml, /sitemap_index.xml) |  |

## 1. Indexing and crawl

| Status | Check | Evidence |
|---|---|---|
| ℹ️ Info | Thin pages | 11 indexable pages with fewer than 150 words of text |
| ✅ Pass | Noindex pages | none of 20 crawled pages is noindex |
| ✅ Pass | Start page indexable | no noindex on the start page |

### Thin pages

**Fix:** Thin pages rarely rank. Add content, merge them, or noindex utility pages. Pages that render their text with JavaScript also show up here.

- `https://browser.style/ui/analog-clock/` — 16 words
- `https://browser.style/ui/auto-suggest/` — 90 words
- `https://browser.style/ui/analog-gauge/` — 14 words
- `https://browser.style/ui/alert/` — 21 words
- `https://browser.style/ui/avatar/` — 96 words
- `https://browser.style/ui/badge/` — 118 words
- `https://browser.style/ui/async-loader/` — 34 words
- `https://browser.style/ui/blink/` — 43 words
- `https://browser.style/ui/breadcrumbs/` — 52 words
- `https://browser.style/ui/bubble-grid/` — 39 words
- …and 1 more (all in `findings.json`)

## 2. Sitemap and robots.txt

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | XML sitemap | no sitemap found (robots.txt, /sitemap.xml, /sitemap_index.xml) |
| ✅ Pass | robots.txt | 32 group(s), 0 Sitemap lines |

### XML sitemap

**Fix:** Generate an XML sitemap of every indexable page, declare it in robots.txt and submit it in Search Console.

## 3. Links and redirects

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Broken internal links | 3 URLs linked from the site answer 404 |
| ⚠️ Warn | Broken external links | 2 external links of 4 checked are dead |
| ℹ️ Info | Links to redirects | 3 internal link targets redirect; link to the final URL instead |
| ✅ Pass | Redirect chains | 3 redirects, each one hop |

### Broken internal links

**Fix:** Fix or remove the links, or redirect the old URL (301) to its replacement.

- `https://browser.style/categories` — 404 · linked from https://browser.style/ui/breadcrumbs/
- `https://browser.style/ui/layout/dist/animations.html` — 404 · linked from https://browser.style/ui/
- `https://browser.style/ui/layout/dist/page.html` — 404 · linked from https://browser.style/ui/

### Broken external links

**Fix:** Update or remove dead outbound links.

- `https://example.com/books` — 404 · from https://browser.style/ui/breadcrumbs/
- `https://example.com/books/sciencefiction` — 404 · from https://browser.style/ui/breadcrumbs/

### Links to redirects

**Fix:** Update menus, content and templates to link straight to the final URL. Each redirect costs a round trip and some crawl budget.

- `https://browser.style/examples/core` — 301 → https://browser.style/examples/core/ · from https://browser.style/
- `https://browser.style/ui` — 301 → https://browser.style/ui/ · from https://browser.style/
- `https://browser.style/examples/form` — 301 → https://browser.style/examples/form/ · from https://browser.style/

## 4. Titles, descriptions and headings

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Duplicate descriptions | 2 descriptions shared by 18 indexable pages |
| ⚠️ Warn | Title length | 11 titles outside 10–60 characters |
| ⚠️ Warn | Duplicate titles | 2 titles shared by 4 indexable pages |
| ✅ Pass | Missing meta descriptions | all 20 indexable pages have one |
| ✅ Pass | H1 headings | one h1 on every indexable page |
| ✅ Pass | html lang | set on all 20 pages (en-US) |
| ✅ Pass | Missing titles | all 20 pages have a title |

### Duplicate descriptions

**Fix:** Write a description per page, or leave it out so Google picks a snippet; a template-wide default helps no one.

- `https://browser.style/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/examples/core/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/ui/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/examples/form/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/ui/auto-suggest/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/ui/avatar/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/ui/badge/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/ui/barcode-scanner/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/ui/async-loader/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- `https://browser.style/ui/bento/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×16)
- …and 8 more (all in `findings.json`)

### Title length

**Fix:** Aim for 10–60 characters with the page topic first; Google truncates around 60. A long site-name suffix is the usual cause.

- `https://browser.style/` — 4 chars: "HTML"
- `https://browser.style/examples/core/` — 4 chars: "HTML"
- `https://browser.style/ui/` — 2 chars: "UI"
- `https://browser.style/examples/form/` — 4 chars: "Form"
- `https://browser.style/ui/accordion/` — 9 chars: "Accordion"
- `https://browser.style/ui/avatar/` — 6 chars: "Avatar"
- `https://browser.style/ui/badge/` — 5 chars: "Badge"
- `https://browser.style/ui/bento/` — 2 chars: "UI"
- `https://browser.style/ui/blinds/` — 6 chars: "Blinds"
- `https://browser.style/ui/blink/` — 5 chars: "Blink"
- …and 1 more (all in `findings.json`)

### Duplicate titles

**Fix:** Give each indexable page its own title. Shared titles usually come from a template default, or from duplicates that need a canonical.

- `https://browser.style/` — "HTML" (×2)
- `https://browser.style/examples/core/` — "HTML" (×2)
- `https://browser.style/ui/` — "UI" (×2)
- `https://browser.style/ui/bento/` — "UI" (×2)

## 5. Canonical and hreflang

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Missing canonical | 20 indexable pages without rel=canonical |
| ℹ️ Info | hreflang | no hreflang on any page (fine for a single-language site) |
| ✅ Pass | Canonical on another host | none |
| ✅ Pass | Canonical points at a bad URL | no canonical points at a redirect, error or noindex page |

### Missing canonical

**Fix:** Add a self-referencing absolute canonical on every page, so query strings and tracking parameters do not make duplicates.

- `https://browser.style/`
- `https://browser.style/examples/core/`
- `https://browser.style/ui/`
- `https://browser.style/examples/form/`
- `https://browser.style/ui/analog-clock/`
- `https://browser.style/ui/accordion/`
- `https://browser.style/ui/auto-suggest/`
- `https://browser.style/ui/analog-gauge/`
- `https://browser.style/ui/alert/`
- `https://browser.style/ui/avatar/`
- …and 10 more (all in `findings.json`)

## 6. Open Graph and share previews

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Open Graph tags | 20 indexable pages miss og:title, og:description or og:image |
| ℹ️ Info | twitter:card | 20 indexable pages without twitter:card (X falls back to Open Graph, but shows a small card) |

### Open Graph tags

**Fix:** Set og:title, og:description, og:image (1200×630, absolute URL) and og:url on every page so links shared on LinkedIn, Facebook, Slack and Teams get a preview.

- `https://browser.style/` — missing og:title, og:description, og:image
- `https://browser.style/examples/core/` — missing og:title, og:description, og:image
- `https://browser.style/ui/` — missing og:title, og:description, og:image
- `https://browser.style/examples/form/` — missing og:title, og:description, og:image
- `https://browser.style/ui/analog-clock/` — missing og:title, og:description, og:image
- `https://browser.style/ui/accordion/` — missing og:title, og:description, og:image
- `https://browser.style/ui/auto-suggest/` — missing og:title, og:description, og:image
- `https://browser.style/ui/analog-gauge/` — missing og:title, og:description, og:image
- `https://browser.style/ui/alert/` — missing og:title, og:description, og:image
- `https://browser.style/ui/avatar/` — missing og:title, og:description, og:image
- …and 10 more (all in `findings.json`)

### twitter:card

**Fix:** Add <meta name="twitter:card" content="summary_large_image"> for a large preview on X.

- `https://browser.style/`
- `https://browser.style/examples/core/`
- `https://browser.style/ui/`
- `https://browser.style/examples/form/`
- `https://browser.style/ui/analog-clock/`
- `https://browser.style/ui/accordion/`
- `https://browser.style/ui/auto-suggest/`
- `https://browser.style/ui/analog-gauge/`
- `https://browser.style/ui/alert/`
- `https://browser.style/ui/avatar/`
- …and 10 more (all in `findings.json`)

## 7. Structured data

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Structured data coverage | no JSON-LD on any indexable page, also after rendering in Chrome |
| ✅ Pass | JSON-LD added by JavaScript | 3 pages rendered in Chrome: no JSON-LD beyond what the served HTML has |
| ✅ Pass | JSON-LD that does not parse | 0 pages carry JSON-LD, all of it parses |
| ⏭️ Skipped | schema.org validator | no page with structured data to validate |

### Structured data coverage

**Fix:** At least Organization (or LocalBusiness) and WebSite on the start page, BreadcrumbList on inner pages, and Article, Product, Event or FAQPage where the content is one.

## 8. AI search (GEO)

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | AI crawlers at the edge | robots.txt lets them in, but the edge refuses PerplexityBot on 3 pages of 3, while a Googlebot user agent gets the page |
| ⚠️ Warn | Entity markup for answer engines | start page has no Organization (or LocalBusiness/Person) and no WebSite JSON-LD |
| ℹ️ Info | Structured data opportunities | pages that look like they could carry more markup: Article 0, FAQPage 2, BreadcrumbList 1 |
| ℹ️ Info | AI crawlers in robots.txt | AI search crawlers allowed; 8 training crawlers blocked (a policy choice): GPTBot (OpenAI), ClaudeBot (Anthropic), Google-Extended (Google (Gemini)), Applebot-Extended (Apple), CCBot (Common Crawl), Meta-ExternalAgent (Meta), Bytespider (B… |
| ℹ️ Info | Answer-friendly structure | 8 pages with text: question headings on 2, lists or tables on 4, mostly paragraphs over 120 words on 0, no subheadings on 0 of the long ones |
| ℹ️ Info | Bing (feeds ChatGPT search and Copilot) | bingbot allowed; no Bing verification tag on the start page (it may be verified by DNS or a file instead) |
| ℹ️ Info | Content-Signal in robots.txt | search=yes,ai-train=no,use=reference |
| ℹ️ Info | Dates on articles | no article pages recognised among 20 indexable pages (Article/BlogPosting JSON-LD, og:type article or a dated <article>); 0 carry a machine-readable date |
| ℹ️ Info | llms-full.txt | none (404); optional, the full text of the key pages in one file |
| ℹ️ Info | llms.txt | no /llms.txt (404) |
| ✅ Pass | Text without JavaScript | the served HTML holds 100% of the rendered text on 3 pages checked in Chrome |

### AI crawlers at the edge

**Fix:** A CDN or WAF rule is blocking AI search crawlers by user agent (Cloudflare "Block AI bots" or AI Crawl Control, a Vercel or Akamai bot rule, a security plugin). Allow the search and user-triggered crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User) and bingbot, and keep blocking only the training crawlers if that is the policy. Confirm in the CDN logs afterwards: the real crawlers come from published IP ranges.

- `https://browser.style/` — PerplexityBot: HTTP 403
- `https://browser.style/examples/core/` — PerplexityBot: HTTP 403
- `https://browser.style/ui/` — PerplexityBot: HTTP 403

### Entity markup for answer engines

**Fix:** Add Organization (or LocalBusiness) with name, url, logo and sameAs links to the official profiles, plus WebSite with name and url, on the start page. AI answers and knowledge panels use it to tie the site to the brand.

- `https://browser.style/`

### Structured data opportunities

**Fix:** Article (with datePublished, dateModified, author) on articles; BreadcrumbList where a breadcrumb trail is shown; FAQPage where a page answers several questions. Google shows FAQ rich results only for government and health sites, but the markup still tells AI engines which text answers which question. Mark up only what is visible on the page.

- `https://browser.style/examples/core/` — FAQPage (4 questions)
- `https://browser.style/ui/accordion/` — FAQPage (16 questions)
- `https://browser.style/ui/breadcrumbs/` — BreadcrumbList

### Answer-friendly structure

**Fix:** AI answers quote passages that stand on their own: a heading that asks or names the question, a direct one- or two-sentence answer under it, then the detail; facts as lists or tables; paragraphs short enough to lift. Start with the pages listed (walls of text and long pages without subheadings).

### Bing (feeds ChatGPT search and Copilot)

**Fix:** Verify the site in Bing Webmaster Tools, submit the sitemap there, and turn on IndexNow (a CMS plugin, or Cloudflare Crawler Hints) so changes reach Bing, ChatGPT search and Copilot within hours. IndexNow cannot be seen from outside; ask whoever runs the site.

### Dates on articles

**Fix:** If the site has news, insights or blog pages, mark them up as Article (or BlogPosting/NewsArticle) with datePublished, dateModified and author, so search and AI engines can tell them from evergreen pages and date them.

### llms.txt

**Fix:** Optional. A Markdown index at /llms.txt (an H1 with the site name, a one-line > summary, then ## sections listing the key pages as links) gives AI tools a clean map of the site. Few AI search engines read it yet, so treat it as cheap insurance, not a ranking factor.

## Not covered

- Rankings, search volume, backlinks and Search Console data: none of that is visible from outside. Check Search Console for coverage and Core Web Vitals field data.
- Speed, Core Web Vitals and the start page's launch basics are in audit-launch; accessibility in audit-a11y.
- Pages are read as served, as most crawlers first see them. Only the start page and one page per section are rendered in Chrome (--render-pages), to find JSON-LD and text that JavaScript adds; the other pages are judged on their served HTML.
- The AI crawler test sends each crawler's user agent from this machine, not from the crawler's own addresses. An edge that checks crawlers by IP answers differently to the real ones; the report says so when a Googlebot user agent is refused too. IndexNow and Bing Webmaster Tools cannot be seen from outside.
- Google's Rich Results Test itself (it has no public API): its required and recommended properties are checked locally for the common result types; the Search Console enhancement reports show what Google actually picked up.
- Whether AI engines actually cite the site: that needs prompts run against each engine over time, not a crawl.

Files: `report.json` (every row and page), `findings.json` (the fix list with every affected URL), `pages.csv` (one row per crawled URL).
