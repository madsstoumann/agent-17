---
name: check-tech-stack
description: Use when someone asks what a website is built with or runs on — its CMS, framework, JavaScript libraries and versions, hosting, CDN, web server, analytics, tag manager, trackers, consent tool or other third-party services ("what's this site made with", "is it WordPress or Umbraco", "Wappalyzer this", "which analytics does X use", "compare the stacks of these competitors"). One URL or a list of URLs; reports evidence for every finding. Not for pre-launch audits (audit-launch) or security reviews (audit-security).
argument-hint: "<url> [<url> …] [--file urls.txt] [--browser] [--pages N] [--out DIR] [--json]"
allowed-tools: Bash(node:*), Read
metadata:
  version: "2.1.1"
---

# Tech stack

One script fetches each site's page, reads the scripts and stylesheets it serves from its own
domain, and matches about 290 technology signatures against headers, cookies, meta tags, markup,
asset URLs and bundle contents. Every finding comes with the evidence that proves it, a version
when one is visible, and account or container IDs for tags (GTM-…, G-…). Your job is to run it,
then answer the user's question from the stdout summary and `report.md`. Do not fingerprint the
site by hand with curl and grep: the script does it in seconds and avoids the false positives a
hand grep for "react" or "angular" produces.

It is passive: one GET per site (plus `--pages` more pages the start page links to) and at most
`--assets` same-site files those pages reference. It never probes paths, so it is fine for any public site, including competitors'.
Requests carry an `X-Audit: check-tech-stack/<version>` header.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-tech-stack.mjs" <url> [<url> …] [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder, wherever it is installed (`~/.claude/skills/check-tech-stack`, a plugin, or an uploaded skill). If it is not filled in, use the folder this `SKILL.md` is in.

A site takes 2–10 seconds; `--browser` adds 5–15 seconds per site. For more than about 20 sites,
run it through Bash with `timeout: 600000`. Stdout has one line per site, then the two output
paths; progress goes to stderr. Exit code is 0 unless every site failed.

| Flag | Use it when |
|---|---|
| `--file urls.txt` | The user gives a list or a file. One URL per line, `#` comments allowed. Bare hosts are fine. |
| `--browser` | The user asks about analytics, trackers, tags or consent. Renders the start page in headless Chromium so tags loaded by a tag manager, cookies set by JavaScript and window globals (`jQuery.fn.jquery`, `next.version`) count too. Needs Playwright; without it the script says so and continues with raw HTML. Without the flag the script still renders a start page whose HTML shows little (an empty app shell, almost no text, or no CMS or framework recognised) when Playwright is installed, and the report says why. |
| `--no-browser` | Never render, not even a thin page. |
| `--pages N` | The user asks about the whole site, or the start page looks like a landing page: also reads up to N (max 10) same-site pages it links to, other subdomains and sections first (a shop, a blog). They are read as raw HTML, without the browser. Technologies found only there are marked with the page. Default 0. |
| `--out DIR` | The user says where the report should go. Default `<reports>/check-tech-stack/<host>/runs/<YYYYMMDD-HHMM>/` (several sites: `<reports>/check-tech-stack/batch-<n>-<YYYYMMDD-HHMM>/`), where `<reports>` is `$AUDIT_OUT_DIR` if set, else the Downloads folder if it exists (the XDG download folder on Linux), else `~/audit-reports/`. The folder is created and its path printed last on stdout. Do not point it into the current repo unless the user asks. |
| `--assets N` | Default 12 same-site scripts and stylesheets per site. Raise it (30) for big SPAs where the framework hides in a later chunk; `0` for headers and markup only. |
| `--jobs N` | Sites in parallel, default 4 (2 with `--browser`). |
| `--insecure` | `localhost` or a self-signed certificate. |
| `--no-history` | Do not compare with each site's last run or save this one. |
| `--offline` | Skip the npm registry lookup of each library's latest version. |
| `--json` | Another tool or script consumes the result: prints `results.json` to stdout. |

## Present the results

Answer the question that was asked, from the summary line and the report:

- "What is it built with?": CMS or platform, framework, hosting/CDN, then notable libraries and
  services, with versions where shown. Two to five lines.
- A specific question ("which analytics?", "is it Umbraco?"): answer it directly and cite the
  evidence from the report's Evidence column, such as `x-powered-by: Next.js` or a crop URL.
- Several sites: summarise the Comparison table (the user can open `report.md` for the full
  matrix and the "Usage across sites" counts), and point out what they share and where they differ.

Always give the `report.md` path.

Two things the report adds on its own:

- **Changes since the last run.** Each site's last result is kept in
  `<reports>/check-tech-stack/<host>/last.json` (also when `--out` is used), and the next run
  lists what is new, what changed version and what was not seen. Mention changes when there are
  any ("since 3 October it moved from Sitecore to Next.js"). "Not seen" is not "removed": when the
  report says the last run looked further (browser, more pages), say that.
- **Library age.** Versions with a known npm package are compared with the latest release on
  npm ("jQuery 1.12.4, latest 4.0.0, major update available"). That is age only: do not call it
  vulnerable or unsupported.

Wording rules that keep it honest:

- **Possible** entries rest on weak evidence only (a class name, a generic path). Say "possibly X"
  or leave them out; never present them as detected.
- **Not detected is not absent.** Server-side code, a headless CMS behind an API, or a stack
  behind a CDN often leaves no trace. Say "nothing in the page reveals the CMS", not "it has no CMS".
- Without `--browser`, tags fired by a tag manager are invisible. If the user asked about
  analytics or trackers and you ran without it, say so or re-run with it.
- A **Blocked** note means a bot challenge or a 403/429 answered instead of the site, so only the
  protection layer (Cloudflare, Akamai, Fastly) was seen. Report that and do not present it as the
  site's stack. Do not try to get around the protection (no User-Agent spoofing, no retries
  through other routes); suggest the user runs it from a network the site allows, or asks the
  site's owner.
- Versions come from the evidence shown. Do not guess a version, and do not call a version
  vulnerable or out of support: that is the `audit-security` skill. The npm "latest" shown is
  release age only.
- IDs (GTM container, GA4 measurement ID, Meta Pixel ID) are public by nature, but list them
  only when they help answer the question.

## Not this skill

- Missing security headers, robots/sitemap, meta tags, cookies before consent, broken links:
  `audit-launch`. The old `analyze-sites` script mixed those checks in; this skill only answers
  "what is it built with".
- Vulnerable front-end library versions and leaked secrets: `audit-security`.
- Whether a site is a scam: `is-website-safe`.

## Adding a technology

Signatures live in `scripts/lib/signatures.mjs`, one object per technology; the comment at the
top explains every field. Prefer evidence that cannot appear by accident (a header, a cookie
name, a vendor host, a runtime marker in a bundle); wrap anything looser in `weak()`. Add a test
in `scripts/test/detect.test.mjs` with the evidence you saw, and bump the minor version.

## Example prompts

```
/check-tech-stack https://www.example.com
What is https://www.example.dk built with?
Is example.com running Sitecore or AEM?
Which analytics and consent tools does https://www.example.com use?      (→ --browser)
What runs the shop and the blog on example.dk?                           (→ --pages 5)
Has competitor.dk changed anything since last month?                     (→ just run it again)
Compare the tech stacks of these five competitors: a.dk, b.dk, c.dk, d.dk, e.dk
Run check-tech-stack on the URLs in ~/clients.txt and save the report in ./research/
```

Mapping: a list or a file → `--file` or several URLs; analytics, trackers, tags or consent →
`--browser`; the whole site, a shop or blog section → `--pages`; "save it in …" → `--out`.

## Files

- `scripts/check-tech-stack.mjs`: the runner (`--help` lists every flag). Zero dependencies, Node ≥ 20.
  Playwright only for `--browser`.
- `scripts/lib/signatures.mjs`: the technology signatures.
- `scripts/lib/detect.mjs`: matching, versions, implied technologies, confidence.
- `scripts/lib/fetch.mjs`, `page.mjs`, `browser.mjs`, `report.mjs`: fetching, HTML parsing and
  link picking, the browser pass and the report.
- `scripts/lib/history.mjs`: last run per host and the changes since. `scripts/lib/versions.mjs`:
  npm latest-version lookup.
- `scripts/lib/out-dir.mjs`: the default report folder, shared logic with audit-launch,
  audit-security and audit-all.
- `scripts/test/*.test.mjs`: `cd scripts && node --test test/*.test.mjs`.
