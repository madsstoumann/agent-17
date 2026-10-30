---
name: launch-audit
description: Use when a website is about to go live or has just launched and needs a pre-launch / go-live audit, a launch checklist or an "is the site ready" answer for any dev, staging or production URL — the manual round of PageSpeed Insights, securityheaders.com, the W3C and schema.org validators and MDN Observatory, plus robots/sitemap/canonical, redirects, soft 404s, TLS/DNS/SPF/DMARC, exposed files, caching, cookies and trackers, broken links, mixed content, share previews and icons. Also for re-checking a site after fixes or comparing with an earlier audit. Public and local (self-signed) URLs, any stack.
argument-hint: "<url> [--env dev|staging|production] [--production-host HOST] [--pages N] [--skip group,...] [--out PATH] [--baseline report.json] [--insecure] [--header NAME:VALUE]"
allowed-tools: Bash(node:*), Bash(npx lighthouse:*), Bash(curl:*), Bash(dig:*), Read, WebFetch
metadata:
  version: "1.2.0"
---

# Launch audit

One script runs every pre-launch check and writes a report a client or team can read:
`report.md` (numbered sections, a scoreboard, a launch-day checklist) and `report.json`
(machine-readable, diffable). Your job is to run it with the right flags, then read the
stdout summary and tell the user what blocks launch, what to fix, and what could not be
checked. Do not re-derive the checks by hand with curl: the script does them in 4–7 minutes
with far less context, and it covers exactly the services the user used to open manually
(PageSpeed/Lighthouse, securityheaders.com, W3C, schema.org, Observatory).

Only audit sites the user owns or is engaged on. The script identifies itself
(`X-Audit: launch-audit` header), probes only well-known paths (`.git/HEAD`, `.env`,
`/umbraco`, …) and never fuzzes.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/audit.mjs" <url> [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder, wherever it is installed (`~/.claude/skills/launch-audit`, a plugin, or an uploaded skill). If it is not filled in, use the folder this `SKILL.md` is in.

Run it through Bash with **`timeout: 600000`** (a full run is 4–7 minutes: Lighthouse runs
mobile + desktop + `--pages` sampled pages sequentially; the crawl and link check take
1–3 minutes). `--skip perf` finishes in about a minute. The stdout summary (≈40 lines) is
what you read; `report.md` has every row. Progress goes to stderr. Exit code is 0 whatever
the findings (3 only with `--strict`), so a non-zero exit means the script itself failed —
read the last stderr lines.

| Flag | Use it when |
|---|---|
| `--env dev\|staging\|production` | Always pass it when the user says which environment it is. Otherwise the script guesses from the hostname and the report says `(auto from hostname — pass --env to override)`; repeat that caveat to the user. |
| `--production-host www.example.com` | The user names the future live domain. Canonical, og:url, hreflang and sitemap hosts are then compared against it. |
| `--pages N` (default 3) | Extra sitemap pages for Lighthouse, mobile only. `0` for speed. |
| `--skip perf` / `--skip perf,links` | "Quick check", "skip Lighthouse". `--only headers,tls` for a narrow question. Groups: `crawl redirects notfound tls exposed headers caching perf a11y privacy links ops` (also `dns`, `email`, `social`, `icons`). |
| `--out PATH` | The user says where the report should go: a folder, or a `.md` path (JSON and raw files land beside it). Default `<reports>/launch-audit/<host>-<YYYYMMDD-HHMM>/`, where `<reports>` is `$AUDIT_OUT_DIR` if set, else the Downloads folder if it exists (the XDG download folder on Linux), else `~/audit-reports/`. Always quote the two paths printed last on stdout. |
| `--baseline <previous report.json>` | "Compare with last time" / re-check after fixes. Find the previous run under `<reports>/launch-audit/` when not named. Adds a "Since last run" section. |
| `--insecure` | `localhost` or a self-signed certificate. Remote validators are skipped automatically for private hosts (W3C and schema.org get the HTML posted instead). |
| `--email-domain example.com` | Auditing a platform or staging host but the mail domain is known. |
| `--ssllabs` | The user wants the Qualys grade in the report (slow, opt-in). |
| `--no-remote` | Offline / CI: skip every third-party service. |
| `--header "Name: value"` | The site sits behind a WAF (Vercel Firewall, Cloudflare) that challenges scripts or headless Chrome, and the owner has added a rule that bypasses the challenge for a secret header. Sent to the audited host and its www/apex sibling, and by Lighthouse; never by the script to third-party services. Repeatable; also `AUDIT_HEADERS` (one per line). The value is redacted in saved Lighthouse JSON. Lighthouse sends it with every request the page makes, third-party scripts included, so use a dedicated value just for this rule. |

Environment variables: `PSI_API_KEY` (free Google Cloud key for the PageSpeed Insights API —
adds CrUX field data and matches pagespeed.web.dev exactly; without it Lighthouse runs
locally through `npx lighthouse` + Chrome, same five categories, lab data only),
`SECURITYHEADERS_API_KEY` (paid; otherwise the grade is estimated), `CHROME_PATH`, `AUDIT_HEADERS`.
Getting a PSI key: Google Cloud console → enable "PageSpeed Insights API" → Credentials → Create
API key (restrict it to that API). Without a key the API's shared quota answers 429, so the
script does not try.

Lighthouse runs right after the start page, before the crawl and the exposed-file probes, so a
WAF that reacts to that burst has not been triggered yet. If it still meets a bot challenge (the
page answers 403/429/503, e.g. the Vercel Security Checkpoint), the report says so instead of
scoring the challenge page, and switches to PageSpeed Insights when `PSI_API_KEY` is set.

## Present the results

Budget after the script: the stdout summary, one read of `report.md` if a row needs its full
text, and optionally the Playwright check of the securityheaders.com grade. That is all —
`report.json`, the Lighthouse JSON files and the live site are for the deep-dives below, which
you offer rather than run. A with-skill test run that ignored this spent fifteen extra tool
calls and twenty minutes re-deriving what the report already said.

Lead with the verdict, in this order, and keep it short — the report has the detail:

1. **Verdict** in one sentence: ready / not ready, and why.
2. **Launch blockers** (the `Launch blockers:` lines) — each with its fix.
3. **Before production** (dev/staging only) — the checklist of things that are *expected* here
   (noindex, `Disallow: /`, canonical on the dev host) but must be reversed at launch. Never
   call these bugs; never forget to list them.
4. The top warnings, grouped (headers/CSP, SEO basics, links, performance).
5. The **scoreboard** as it is printed: Lighthouse scores, Core Web Vitals, the security-headers
   grade, Observatory, W3C counts, schema.org, TLS.
6. What was **skipped or estimated**, by name. A `SKIP` is "not checked", never "fine".
7. The report paths, and the deep-dives you can offer (below).

Wording rules that keep the report honest:

- The securityheaders.com grade is **estimated** unless the scrape or the paid API succeeded:
  say `securityheaders.com: A (estimated locally — confirm at <link>)`. If
  `headers.securityheaders-scrape` was skipped (their Cloudflare challenge blocks headless
  browsers), you may open the link with the Playwright MCP (`browser_navigate`, then
  `browser_snapshot` and read the grade); if that also shows "Just a moment…", give the estimate
  and the link.
- On dev/staging the Lighthouse **SEO score is depressed by noindex**; the row says so. Report it
  as "SEO 69, depressed by noindex — re-run on production", not as bad SEO.
- Lighthouse without `PSI_API_KEY` is lab data from this machine; say "local Lighthouse" and
  offer the key when the user wants field data or exact pagespeed.web.dev parity.
- Numbers come from the script; do not round the grade up or add checks you did not run.

## After the audit

Offer, do not run by default:

- **Performance deep-dive**: the `web-perf` skill (chrome-devtools MCP) for an LCP breakdown
  and render-blocking chain on the slowest sampled page.
- **Accessibility manual pass**: Playwright MCP keyboard/focus walk of the main flows; the report's
  section 9 lists what Lighthouse cannot see.
- **Re-check after fixes**: same command with `--baseline <this run's report.json>`.
- Things the script does not cover and that a longer investigation could: forms and email
  delivery, anything behind a login, cookies set by JavaScript after consent, config leaks in
  JS bundles, a redirect map from the old site (`--old-sitemap` is planned), locale-prefix
  duplicates. Name them when relevant; ask before spending twenty minutes on them.

## Troubleshooting

| Symptom | Do |
|---|---|
| Exit 2 "answered 403/503 with a bot challenge" | WAF blocks scripts: allowlist this IP or disable Bot Fight Mode on staging; try `--ua` with a different User-Agent only if the user agrees. |
| Exit 2 with a certificate error | Self-signed or private CA: `--insecure`. |
| `perf.lighthouse-*` skipped, "blocked by Vercel bot challenge (HTTP 429)" (or Cloudflare) | The firewall challenges headless Chrome from this IP; a person's browser passes it silently. Set `PSI_API_KEY` (Google fetches the page instead), or ask the owner for a bypass rule (Vercel: Firewall → custom rule: header `x-audit-bypass` equals a long random value → Bypass; Cloudflare: WAF skip rule) and re-run with `--header "x-audit-bypass: <value>"`. Do not try to get around a challenge in other ways. |
| `perf.lighthouse-mobile` skipped, "Node ≥ 22.19 / Chrome" | Set `PSI_API_KEY`, or install Chrome / `CHROME_PATH`. First `npx lighthouse` on a new machine downloads once (~20 s extra). |
| Everything remote is `SKIP` | Private host or `--no-remote`; expected. |
| Lighthouse timed out | Heavy page or slow machine: `--lh-timeout 400000`, or `--pages 0`. |
| The Bash tool timed out | You forgot `timeout: 600000`. The script writes `report.json` after each phase (`partial: true`), so the partial report is still there. |

## Red flags — stop and re-read the rules above

| Thought | Reality |
|---|---|
| "I'll just curl the headers myself first" | The script already did, with grading and links. Run it. |
| "The estimated grade is close enough to call it the securityheaders.com grade" | Estimated is estimated. Say so and give the link. |
| "noindex on staging is a fail" | It is expected there; it belongs in the "Before production" checklist. |
| "Skipped means fine" | Skipped means not checked. Name it. |
| "SEO score is bad" (on dev) | It is depressed by noindex; say that. |
| "I'll write the report from the stdout summary" | The user gets `report.md`; you summarise it and point to it. |
| "Let me grep the Lighthouse JSON for the LCP element" | That is the `web-perf` deep-dive. Offer it. |
| "Let me compare with the old site's sitemap / read the JS bundles" | Valuable, and twenty minutes. Offer it as a follow-up; do not run it unasked. |

## Example prompts

```
/launch-audit https://www.example.com
/launch-audit https://akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app/ --env dev
Run a launch audit on https://stage.example.com — it's the stage site, production will be https://www.example.com
We go live with https://www.example.com next week. Test it and give me a report I can send to the client.
Pre-launch check of https://dev.example.com, save the report in ./docs/audits/
Audit https://www.example.com again and compare with ~/Downloads/launch-audit/www.example.com-20260924-0900/report.json
Quick check of https://www.example.com — skip Lighthouse
Only the security headers, cookies and TLS for https://www.example.com
Audit https://localhost:44380 before we push to staging (self-signed cert)
Run the launch audit on https://www.example.com with PageSpeed field data      (needs PSI_API_KEY)
```

Mapping: "it's the dev/stage site" → `--env dev`; "production will be X" → `--production-host X`;
"save it in …" / "next to IOI.report.md" → `--out`; "compare with last time" → `--baseline`;
"quick" / "skip Lighthouse" → `--skip perf`; "only headers and TLS" → `--only headers,tls`;
"self-signed" / `localhost` → `--insecure`. Nothing said → defaults, and say where the report went.

## Files

- `scripts/audit.mjs` — the runner (`--help` lists every flag). Zero dependencies, Node ≥ 22.19.
- `references/checks.md` — every check id: meaning, threshold, fix, per-stack notes. Read it when
  the user asks why a row failed or how to fix it on their stack.
- `references/manual.md` — the services with no API and what to look at there.
- `references/sample-report.md` — a real report (a dev site), to show what the output looks like.
- `scripts/test/*.test.mjs` — `cd scripts && node --test test/*.test.mjs`.
