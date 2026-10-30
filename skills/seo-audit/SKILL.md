---
name: seo-audit
description: Use when someone wants an SEO or content audit of a whole website, not just the start page — titles and meta descriptions (missing, too long, duplicated), Open Graph and share previews, structured data (JSON-LD that does not parse, validator.schema.org errors), sitemap and robots.txt consistency (noindex, redirecting, blocked or missing URLs, orphan pages), canonical and hreflang problems, broken internal and external links and redirect chains. Also for "why is this page not indexed", re-checking after SEO fixes, or comparing with the last run. Any stack, public or local URLs.
argument-hint: "<url> [--pages N] [--sitemap-sample N] [--external-links N] [--schema-pages N] [--production-host HOST] [--out DIR] [--header NAME:VALUE]"
allowed-tools: Bash(node:*), Read
metadata:
  version: "1.0.0"
---

# SEO audit

One script crawls the site the way a search engine would (links first, robots.txt respected,
redirects recorded hop by hop), samples the sitemap URLs the links did not reach, and runs every
check across all of it. It writes `report.md` for people, `findings.json` for the fix list,
`pages.csv` (one row per URL, for a spreadsheet) and `report.json`. Your job is to run it with the
right flags, read the stdout summary and tell the user what to fix first.

launch-audit checks the start page's SEO basics on launch day; this skill is the site-wide view.
Only audit sites the user owns or works on. The crawler identifies itself (`X-Audit: seo-audit`),
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
| `--pages N` (default 150) | Pages reached by following links. Big sites: 300–500 for a fuller picture (a minute or two more). The report says when the cap was hit; orphan detection is skipped then. |
| `--sitemap-sample N` (default 50) | Sitemap URLs the crawl did not reach, fetched to check status, noindex and canonical. |
| `--external-links N` (default 150) | Outbound links to check. `0` to skip. 403/429/999 answers are bot walls, reported as "verify by hand". |
| `--schema-pages N` (default 8) | Pages sent to validator.schema.org, one per distinct JSON-LD type set. Private hosts get their HTML posted instead. `0` or `--no-remote` skips it. |
| `--production-host www.example.com` | Auditing staging: canonicals, sitemap URLs and hreflang on the future live host are then not "another host". |
| `--header "Name: value"` | The site is behind a WAF that challenges scripts (Vercel Firewall, Cloudflare) and the owner added a bypass rule for a secret header. Sent to the site's host only. Also `AUDIT_HEADERS`. |
| `--ignore-robots` | The user wants disallowed paths crawled too (they are still reported). |
| `--insecure` | localhost or a self-signed certificate. |
| `--out DIR` | The user names a folder for this run (audit-all does this). |
| `--state DIR`, `--baseline FILE`, `--no-baseline` | See "Folders and re-runs". |

## Folders and re-runs

Each site gets one target folder, `<reports>/seo-audit/<host>/`, where `<reports>` is
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
  up there too; say so if the site is an SPA.
- Duplicate titles across language versions are fine when hreflang ties them together.
- The crawl is a sample when the cap was hit. Say "in the 150 pages crawled", not "on the site".
- Nothing here sees rankings, traffic, backlinks or Search Console. Offer Search Console's page
  indexing report as the next step for "why is X not indexed".

## Fix plan

`findings.json` lists every fail and warn with `severity` (blocker, high, medium, low), `fix`,
`verify` and every affected URL, in the shape audit-all's `tasks.json` uses (`sources: ["seo"]`).
Most fixes live in templates or CMS settings (title pattern, meta description field, sitemap
plugin, canonical tag). Redirects and robots.txt may be hosting settings rather than code.

## Example prompts

```
/seo-audit https://www.example.dk
SEO audit of https://stage.example.dk — production will be https://www.example.dk
Why are half our pages not in Google? https://www.example.dk
Check the structured data and share previews across https://shop.example.dk
Crawl 500 pages of https://www.example.dk and give me the duplicate titles as a spreadsheet   (pages.csv)
Run the SEO audit again after the fixes
```

## Files

- `scripts/seo.mjs` — the runner (`--help` lists every flag).
- `scripts/lib/crawl.mjs` — the crawl and the per-page record; `lib/checks.mjs` — every check;
  `lib/report.mjs` — report.md, findings.json, pages.csv; `lib/schema.mjs` — validator.schema.org
  (the service the validate-schema skill uses); `lib/robotsmatch.mjs` — robots.txt matching.
- `scripts/lib/http.mjs`, `html.mjs`, `robots.mjs`, `redirects.mjs` — copies of launch-audit's;
  `target-state.mjs` — the shared target-folder layout; keep the copies in step.
- Tests: `cd scripts && node --test test/*.test.mjs`.
