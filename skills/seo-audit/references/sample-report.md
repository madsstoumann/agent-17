# SEO audit — browser.style

**Site:** https://browser.style/ · **Date:** 2026-10-30 · **Tool:** seo-audit 1.0.0

**Result:** 0 fail, 8 warn, 12 pass, 4 info, 1 skipped

**Crawled:** 21 HTML pages and 3 other URLs (3 redirects, 0 errors) by following links (stopped at the --pages cap of 20; the site has more). 21 pages are indexable.

## Fix list

| # | Status | Check | Finding | Pages |
|---|---|---|---|---|
| 1 | ⚠️ Warn | Missing canonical | 21 indexable pages without rel=canonical | 21 |
| 2 | ⚠️ Warn | Open Graph tags | 21 indexable pages miss og:title, og:description or og:image | 21 |
| 3 | ⚠️ Warn | Duplicate descriptions | 2 descriptions shared by 19 indexable pages | 19 |
| 4 | ⚠️ Warn | Title length | 11 titles outside 10–60 characters | 11 |
| 5 | ⚠️ Warn | Duplicate titles | 2 titles shared by 4 indexable pages | 4 |
| 6 | ⚠️ Warn | Broken external links | 2 external links of 4 checked are dead | 2 |
| 7 | ⚠️ Warn | Structured data coverage | no JSON-LD on any indexable page |  |
| 8 | ⚠️ Warn | XML sitemap | no sitemap found (robots.txt, /sitemap.xml, /sitemap_index.xml) |  |

## 1. Indexing and crawl

| Status | Check | Evidence |
|---|---|---|
| ℹ️ Info | Thin pages | 12 indexable pages with fewer than 150 words of text |
| ✅ Pass | Noindex pages | none of 21 crawled pages is noindex |
| ✅ Pass | Start page indexable | no noindex on the start page |

### Thin pages

**Fix:** Thin pages rarely rank. Add content, merge them, or noindex utility pages. Pages that render their text with JavaScript also show up here.

- `https://browser.style/ui/analog-clock/` — 16 words
- `https://browser.style/ui/analog-gauge/` — 14 words
- `https://browser.style/ui/alert/` — 21 words
- `https://browser.style/ui/async-loader/` — 34 words
- `https://browser.style/ui/auto-suggest/` — 90 words
- `https://browser.style/ui/avatar/` — 96 words
- `https://browser.style/ui/badge/` — 118 words
- `https://browser.style/ui/bubble-grid/` — 39 words
- `https://browser.style/ui/blink/` — 43 words
- `https://browser.style/ui/button/` — 135 words
- …and 2 more (all in `findings.json`)

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
| ⚠️ Warn | Broken external links | 2 external links of 4 checked are dead |
| ℹ️ Info | Links to redirects | 3 internal link targets redirect; link to the final URL instead |
| ✅ Pass | Broken internal links | every internal link of 24 URLs answers |
| ✅ Pass | Redirect chains | 3 redirects, each one hop |

### Broken external links

**Fix:** Update or remove dead outbound links.

- `https://example.com/books` — 404 · from https://browser.style/ui/breadcrumbs/
- `https://example.com/books/sciencefiction` — 404 · from https://browser.style/ui/breadcrumbs/

### Links to redirects

**Fix:** Update menus, content and templates to link straight to the final URL. Each redirect costs a round trip and some crawl budget.

- `https://browser.style/examples/form` — 301 → https://browser.style/examples/form/ · from https://browser.style/
- `https://browser.style/examples/core` — 301 → https://browser.style/examples/core/ · from https://browser.style/
- `https://browser.style/ui` — 301 → https://browser.style/ui/ · from https://browser.style/

## 4. Titles, descriptions and headings

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Duplicate descriptions | 2 descriptions shared by 19 indexable pages |
| ⚠️ Warn | Title length | 11 titles outside 10–60 characters |
| ⚠️ Warn | Duplicate titles | 2 titles shared by 4 indexable pages |
| ✅ Pass | Missing meta descriptions | all 21 indexable pages have one |
| ✅ Pass | H1 headings | one h1 on every indexable page |
| ✅ Pass | html lang | set on all 21 pages (en-US) |
| ✅ Pass | Missing titles | all 21 pages have a title |

### Duplicate descriptions

**Fix:** Write a description per page, or leave it out so Google picks a snippet; a template-wide default helps no one.

- `https://browser.style/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/examples/form/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/examples/core/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/ui/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/ui/async-loader/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/ui/barcode-scanner/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/ui/auto-suggest/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/ui/avatar/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/ui/bento/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- `https://browser.style/ui/badge/` — "HTML is the foundation of the World Wide Web, and it is stil…" (×17)
- …and 9 more (all in `findings.json`)

### Title length

**Fix:** Aim for 10–60 characters with the page topic first; Google truncates around 60. A long site-name suffix is the usual cause.

- `https://browser.style/` — 4 chars: "HTML"
- `https://browser.style/examples/form/` — 4 chars: "Form"
- `https://browser.style/examples/core/` — 4 chars: "HTML"
- `https://browser.style/ui/` — 2 chars: "UI"
- `https://browser.style/ui/accordion/` — 9 chars: "Accordion"
- `https://browser.style/ui/avatar/` — 6 chars: "Avatar"
- `https://browser.style/ui/bento/` — 2 chars: "UI"
- `https://browser.style/ui/badge/` — 5 chars: "Badge"
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
| ⚠️ Warn | Missing canonical | 21 indexable pages without rel=canonical |
| ℹ️ Info | hreflang | no hreflang on any page (fine for a single-language site) |
| ✅ Pass | Canonical on another host | none |
| ✅ Pass | Canonical points at a bad URL | no canonical points at a redirect, error or noindex page |

### Missing canonical

**Fix:** Add a self-referencing absolute canonical on every page, so query strings and tracking parameters do not make duplicates.

- `https://browser.style/`
- `https://browser.style/examples/form/`
- `https://browser.style/examples/core/`
- `https://browser.style/ui/`
- `https://browser.style/ui/analog-clock/`
- `https://browser.style/ui/analog-gauge/`
- `https://browser.style/ui/alert/`
- `https://browser.style/ui/accordion/`
- `https://browser.style/ui/async-loader/`
- `https://browser.style/ui/barcode-scanner/`
- …and 11 more (all in `findings.json`)

## 6. Open Graph and share previews

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Open Graph tags | 21 indexable pages miss og:title, og:description or og:image |
| ℹ️ Info | twitter:card | 21 indexable pages without twitter:card (X falls back to Open Graph, but shows a small card) |

### Open Graph tags

**Fix:** Set og:title, og:description, og:image (1200×630, absolute URL) and og:url on every page so links shared on LinkedIn, Facebook, Slack and Teams get a preview.

- `https://browser.style/` — missing og:title, og:description, og:image
- `https://browser.style/examples/form/` — missing og:title, og:description, og:image
- `https://browser.style/examples/core/` — missing og:title, og:description, og:image
- `https://browser.style/ui/` — missing og:title, og:description, og:image
- `https://browser.style/ui/analog-clock/` — missing og:title, og:description, og:image
- `https://browser.style/ui/analog-gauge/` — missing og:title, og:description, og:image
- `https://browser.style/ui/alert/` — missing og:title, og:description, og:image
- `https://browser.style/ui/accordion/` — missing og:title, og:description, og:image
- `https://browser.style/ui/async-loader/` — missing og:title, og:description, og:image
- `https://browser.style/ui/barcode-scanner/` — missing og:title, og:description, og:image
- …and 11 more (all in `findings.json`)

### twitter:card

**Fix:** Add <meta name="twitter:card" content="summary_large_image"> for a large preview on X.

- `https://browser.style/`
- `https://browser.style/examples/form/`
- `https://browser.style/examples/core/`
- `https://browser.style/ui/`
- `https://browser.style/ui/analog-clock/`
- `https://browser.style/ui/analog-gauge/`
- `https://browser.style/ui/alert/`
- `https://browser.style/ui/accordion/`
- `https://browser.style/ui/async-loader/`
- `https://browser.style/ui/barcode-scanner/`
- …and 11 more (all in `findings.json`)

## 7. Structured data

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Structured data coverage | no JSON-LD on any indexable page |
| ✅ Pass | JSON-LD that does not parse | 0 pages carry JSON-LD, all of it parses |
| ⏭️ Skipped | schema.org validator | no page with structured data to validate |

### Structured data coverage

**Fix:** At least Organization (or LocalBusiness) and WebSite on the start page, BreadcrumbList on inner pages, and Article, Product, Event or FAQPage where the content is one.

## Not covered

- Rankings, search volume, backlinks and Search Console data: none of that is visible from outside. Check Search Console for coverage and Core Web Vitals field data.
- Speed, Core Web Vitals and the start page's launch basics are in launch-audit; accessibility in a11y-audit.
- Pages that build their content with JavaScript are read as served (no rendering), as most crawlers first see them.

Files: `report.json` (every row and page), `findings.json` (the fix list with every affected URL), `pages.csv` (one row per crawled URL).
