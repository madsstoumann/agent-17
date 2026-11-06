---
name: audit-seo
description: Use when someone wants an SEO, content or GEO (AI search) audit of a whole website, not just the start page. Titles and descriptions, Open Graph, structured data (JSON-LD that does not parse, validator.schema.org errors, Google rich-result properties, JSON-LD only JavaScript adds), sitemap and robots.txt consistency, canonical and hreflang, broken links and redirect chains. GEO with a readiness score covers AI crawler rules in robots.txt and whether the CDN or WAF lets OAI-SearchBot, Claude-SearchBot or PerplexityBot in, text only JavaScript builds, llms.txt, entity markup, dates and authors, sitemap lastmod, answer structure, missing markup, Bing. Also for a client's technical GEO audit (`--geo`), validating one URL's or a local HTML file's JSON-LD (`--schema-only`), "why is this page not indexed", or re-checking after fixes. Any stack, public or local URLs.
argument-hint: "<url | file.html> [--geo] [--schema-only] [--pages N] [--sitemap-sample N] [--external-links N] [--internal-links N] [--schema-pages N] [--render-pages N] [--bot-pages N] [--production-host HOST] [--out DIR] [--header NAME:VALUE] [--level error|warn|error,warn|all] [--console]"
allowed-tools: Bash(node:*), Read
metadata:
  version: "2.5.0"
---

# SEO audit

One script crawls the site the way a search engine would (links first, robots.txt respected,
redirects recorded hop by hop), samples the sitemap URLs the links did not reach, and runs every
check across all of it. It writes `report.md` for people, `findings.json` for the fix list,
`pages.csv` (one row per URL, for a spreadsheet) and `report.json`. Your job is to run it with the
right flags, read the stdout summary and tell the user what to fix first.

audit-launch checks the start page's SEO basics on launch day; this skill is the site-wide view.
Only audit sites the user owns or works on. The crawler identifies itself (`X-Audit: audit-seo`),
stays on the site's host, fetches pages only (no assets) and does not fuzz.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/seo.mjs" <url> [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder. If it is not filled in, use the folder this
`SKILL.md` is in. Node 22 or newer, no dependencies.

Run it with **`timeout: 600000`**. A 150-page crawl takes 10–60 seconds, the schema.org
validator about 5 seconds a page, external links up to a minute. Progress goes to stderr; the
stdout summary lists every fail and warn and ends with the report paths. Exit code 0 whatever
the findings; non-zero means the script failed (read the last stderr lines).

| Flag | Use it when |
|---|---|
| `--pages N` (default 150) | Pages reached by following links, shared across language sections (`/en/`, `/es-ES/`, …) so one locale cannot use the whole budget. Big sites: 300–500 for a fuller picture (a minute or two more). The report says when the cap was hit; orphan detection is skipped then. |
| `--sitemap-sample N` (default 50) | Sitemap URLs the crawl did not reach, fetched to check status, noindex and canonical. |
| `--internal-links N` (default 300) | Internal link targets the crawl found but did not fetch (past `--pages`), checked for a status so a broken footer link in any crawled section is reported. `0` to skip. |
| `--external-links N` (default 150) | Outbound links to check. `0` to skip. 403/429/999 answers are bot walls, reported as "verify by hand". |
| `--schema-pages N` (default 8) | Pages sent to validator.schema.org, one per distinct JSON-LD type set. Private hosts get their HTML posted instead. `0` or `--no-remote` skips it. |
| `--render-pages N` (default 8) | Pages rendered in headless Chrome after the crawl: the start page, then pages whose served HTML has no JSON-LD, one per section, then one page per section not picked yet. JSON-LD that appears only after JavaScript runs is adopted for every structured-data check, posted to the validator as the rendered DOM, and reported as "JSON-LD added by JavaScript" (Google sees it; Bing, social scrapers and most AI crawlers do not). Each rendered page's text (consent banners left out) is compared with its served HTML for "Text without JavaScript". Needs Chrome, Chromium or Edge (found automatically, or `CHROME_PATH`); without one those rows are skipped. `0` turns it off. Raise it (16–24) for a GEO audit of a site with many templates. |
| `--bot-pages N` (default 3) | Pages (start page, then one per section) fetched once as a browser and once with each AI crawler's user agent (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, GPTBot, ClaudeBot), bingbot and Googlebot, without the `--header` bypass, to find CDN or WAF rules that refuse crawlers robots.txt lets in. Crawlers robots.txt shuts out are not fetched. `0` skips it. |
| `--geo` | The user wants a GEO audit, AI search readiness, "is the site ready for ChatGPT / AI answers", or the technical part of a GEO proposal. `report.md` becomes a "GEO audit" with the AI search rows first and only the indexing rows that decide what AI crawlers reach (robots.txt, noindex, thin pages, sitemap and the noindex or blocked URLs it lists, canonical targets, JSON-LD and its coverage, duplicate titles, h1, lang). `report.json` and `findings.json` keep every row (`"geo": true` marks the GEO findings). |
| `--schema-only` | The user only wants the structured data of one page checked ("validate the schema on …", "is my JSON-LD valid?"). Fetches that URL alone, renders it, validates it and runs the Google rich-result rules, and lists every validator error and warning on its own line. No crawl, robots, sitemap or GEO. |
| `<file.html>` instead of a URL | A local HTML file: the same as `--schema-only` on the file (rendered from `file://`, its HTML posted to the validator). |
| `--production-host www.example.com` | Auditing staging: canonicals, sitemap URLs and hreflang on the future live host are then not "another host". |
| `--header "Name: value"` | The site is behind a WAF that challenges scripts (Vercel Firewall, Cloudflare) and the owner added a bypass rule for a secret header. Sent to the site's host only. Also `AUDIT_HEADERS`. |
| `--ignore-robots` | The user wants disallowed paths crawled too (they are still reported). |
| `--insecure` | localhost or a self-signed certificate. |
| `--out DIR` | The user names a folder for this run (audit-all does this). |
| `--state DIR`, `--baseline FILE`, `--no-baseline` | See "Folders and re-runs". |

### Levels and the console list

`--level` sets what `report.md` and the stdout summary show: `error` (failed checks), `warn`, `info`, a comma list such as
`error,warn`, or `all` (the default: every row, passes included). Use it when the user asks for
"errors only", "only warnings", "skip the info" and the like. It never filters saved data:
`report.json`, `findings.json` and `last-report.json` keep every result, so the next run's "Since last run" is unaffected.

`--console` prints a compact list instead of writing `report.md`: one line per issue, errors
first, with the counts on top. The run's files go to a scratch folder in the system temp folder,
so nothing is left in the reports folder except the target folder's `last-report.json`. Use it when
the user wants "just the list", "in the terminal" or "no report". Show the list as it is, in a code
block, with a sentence of context; there is no report path to quote. `--console --report` writes
the report as well.

### Structured data only

For "validate the schema.org markup on this page" or "check the JSON-LD in my index.html", run
`seo.mjs <url> --schema-only --console` (or `seo.mjs ./index.html --console`) and show the list.
Errors are validator.schema.org errors (invalid markup: search engines ignore it); warnings are its
warnings, missing Google-required properties (the page cannot get that rich result) and JSON-LD
added only by JavaScript; info is properties Google recommends. Drop `--console` for a report.md.
A `--schema-only` run keeps its own baseline (`last-schema-report.json`), so it never disturbs
the full audit's "Since last run".

Google's Rich Results Test has no public API, so its required and recommended properties are
checked locally (`lib/rich.mjs`) for Product, Offer prices, Review, AggregateRating, Article,
BreadcrumbList, Event, FAQPage, JobPosting, LocalBusiness, Organization, Recipe,
SoftwareApplication, VideoObject and Course. Say so, and point to the Rich Results Test link in
the fix text for the final word; Search Console's enhancement reports show what Google picked up.

## Folders and re-runs

Each site gets one target folder, `<reports>/audit-seo/<host>/`, where `<reports>` is
`$AUDIT_OUT_DIR`, else the Downloads folder if it exists, else `~/audit-reports/`. Runs go to
`runs/<YYYYMMDD-HHMM>/` inside it (or to `--out`). The target folder keeps `last-report.json`, so
the next run adds a **Since last run** section (fixed, new or worse) without being asked, and
`notes.md`, which the user can write (known exceptions, "the /en/ site is not ours") and which is
shown in every report. Never write notes.md yourself unless asked; never put report folders in a
repo.

## Present the results

Read the stdout summary, and `report.md` only for the rows you need the URL list of. Then:

1. **Verdict** in one or two sentences: is anything keeping pages out of search (noindex, robots,
   canonical on another host, sitemap URLs that are noindex or blocked)?
2. **Fix first**: fails, then the warnings that touch most pages. Name the likely single cause
   when many pages share one problem (a template default title, a CMS sitemap plugin, a staging
   host in config), because that is one fix, not two hundred.
3. Noteworthy info rows (thin pages, orphans, canonicalised pages) in a line or two.
4. What was skipped or capped, by name. Skipped is "not checked", never "fine".
5. The report paths.

Honesty rules:

- On dev or staging, noindex and `Disallow: /` are expected (the report says so at the top);
  list them as "before launch", not as bugs.
- "Thin pages" counts text in the served HTML. A page that renders its text with JavaScript shows
  up there too; say so if the site is an SPA. JSON-LD is different: the Chrome pass finds JSON-LD
  that JavaScript adds on the pages it renders (`--render-pages`), not on every crawled page.
- FAQPage and HowTo markup are fine to keep, but Google limits FAQ rich results to government and
  health sites and no longer shows HowTo; do not promise them.
- Duplicate titles across language versions are fine when hreflang ties them together.
- The crawl is a sample when the cap was hit. Say "in the 150 pages crawled", not "on the site".
- **GEO readiness** (on every full run, at the top of the report) is the share of GEO rows that
  pass: pass and plain info count 1, warn 0.5, fail 0, skipped rows are left out. Info rows that
  point at something missing (no llms.txt, structured data opportunities, no article pages
  recognised, no sitemap lastmod, partial JSON-LD coverage) are **opportunities** and count 0.75;
  the report lists them under the score. It sums up the rows; it does not measure whether AI
  engines cite the site. Say so whenever you quote it.
- **AI crawlers at the edge** sends each crawler's user agent from this machine, not from the
  crawler's published IP ranges. When a Googlebot user agent is refused too, the edge checks
  crawlers by IP and the row is info ("cannot tell from here"): point to the CDN's bot settings
  and the server logs. A refusal of AI search crawlers while Googlebot gets through is a real rule
  (Cloudflare "Block AI bots" / AI Crawl Control, a Vercel or Akamai bot rule, a security plugin).
- **Text without JavaScript** compares the rendered pages only (`--render-pages`), one per section.
  Name it a sample; a site that fails it builds its content in the browser, which most AI
  crawlers do not run.
- Dates, authors, answer structure and structured data opportunities are heuristics over the
  served HTML. "Article pages" are pages with Article/BlogPosting/NewsArticle JSON-LD, og:type
  article, article:published_time or a dated `<article>`, plus **article-like pages** without that
  markup: a news, blog or insights URL with its own slug and either a year in the path
  (`/news/2022/…`) or a date written as text on the page ("November 24, 2022"). Those count as
  articles without a machine-readable date. Question headings end in "?". Present them as where
  to look, not as defects, except undated or anonymous articles.
- og:image and link checks send HEAD and then GET (body discarded) when HEAD answers nothing or any
  4xx/5xx: image edges such as Sitecore's answer HEAD 404 for a resized variant they have not built
  yet, and scrapers use GET.
- IndexNow and Bing Webmaster Tools cannot be seen from outside: the Bing row says what to ask.
- GEO rows are about readiness, not results. Blocking an AI *search* crawler (OAI-SearchBot,
  ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot) keeps the site out of AI answers and
  is a warning; blocking only *training* crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot) is
  a policy choice, reported as info. A missing llms.txt is info: few engines read it yet, so do not
  sell it as a ranking factor. Nothing here shows whether an AI engine actually cites the site.
- Nothing here sees rankings, traffic, backlinks or Search Console. Offer Search Console's page
  indexing report as the next step for "why is X not indexed".

## GEO audit for a client

For a technical GEO audit (crawlability, content accessibility for AI crawlers, structured data, a
prioritised plan), run `seo.mjs <url> --geo --render-pages 16` (or audit-all with `--geo`, which
adds audit-launch and the combined PDF and fix plan). Then lead the write-up with what keeps AI
crawlers out (robots.txt or edge rules, text only JavaScript builds), then what makes the content
hard to use (no dates or authors, no entity markup, walls of text), then the nice-to-haves
(llms.txt, more markup). Two things stay manual and should be offered: a check of the server or
CDN logs for real AI crawler visits, and a spot-check of how ChatGPT, Perplexity, Gemini and Google
AI Overviews answer the client's key questions (does the site appear or get cited). Nothing here
measures that.

## Fix plan

`findings.json` lists every fail and warn with `severity` (blocker, high, medium, low), `fix`,
`verify` and every affected URL, in the shape audit-all's `tasks.json` uses (`sources: ["seo"]`).
Most fixes live in templates or CMS settings (title pattern, meta description field, sitemap
plugin, canonical tag). Redirects and robots.txt may be hosting settings rather than code.

## Example prompts

```
/audit-seo https://www.example.dk
SEO audit of https://stage.example.dk — production will be https://www.example.dk
Why are half our pages not in Google? https://www.example.dk
Check the structured data and share previews across https://shop.example.dk
Validate the schema.org markup on https://shop.example.dk/products/mug   (--schema-only)
Is the JSON-LD in ./dist/index.html valid? Will Google show product stars?   (local file)
Is https://www.example.dk ready for AI search? Do we have an llms.txt?
GEO audit of https://www.example.dk for the client proposal   (--geo)
Do Cloudflare or our WAF block ChatGPT or Perplexity from https://www.example.dk?
Crawl 500 pages of https://www.example.dk and give me the duplicate titles as a spreadsheet   (pages.csv)
Run the SEO audit again after the fixes
```

## Files

- `scripts/seo.mjs` — the runner (`--help` lists every flag).
- `scripts/lib/crawl.mjs` — the crawl and the per-page record; `lib/checks.mjs` — every check;
  `lib/report.mjs` — report.md, findings.json, pages.csv; `lib/schema.mjs` — validator.schema.org
  (identical copy in audit-launch; a test in each skill checks it); `lib/rich.mjs` — Google
  rich-result rules; `lib/render.mjs` — headless Chrome over the DevTools protocol (no
  `--user-data-dir`: it hangs); `lib/robotsmatch.mjs` — robots.txt matching;
  `lib/geo.mjs` — llms.txt, ai.txt, AI crawlers in robots.txt and at the edge, entity markup,
  text without JavaScript, dates and authors, sitemap lastmod, answer structure, structured data
  opportunities, Bing, and the GEO readiness score; `lib/content.mjs` — the per-page signals those
  rows read (dates, author, headings, lists, tables, paragraph length).
- `scripts/lib/http.mjs`, `html.mjs`, `robots.mjs`, `redirects.mjs` — copies of audit-launch's;
  `target-state.mjs` — the shared target-folder layout; keep the copies in step.
- Tests: `cd scripts && node --test test/*.test.mjs`.
