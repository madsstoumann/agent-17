---
name: eco-audit
description: Use when someone asks about a website's carbon footprint, CO2 per page view, digital sustainability, a Website Carbon style rating (A+ to F), page weight, or whether the site is on green hosting — and what to cut first (video, images, fonts, JavaScript, third parties). Measures real page loads in headless Chrome and applies the Sustainable Web Design model v4 (as CO2.js), with an optional country grid and a yearly estimate from page views. Also for re-checking after a slimming pass.
argument-hint: "<url> [more page urls] [--pages N] [--grid DK] [--views N] [--mobile] [--out DIR] [--header NAME:VALUE]"
allowed-tools: Bash(node:*), Read
metadata:
  version: "1.0.0"
---

# Eco audit

One script loads the start page and a few other pages (one per template from the sitemap) in
headless Chrome, as a first visit with an empty cache, and records every request: bytes on the
wire, type, compression and caching. It scrolls to the bottom to see what lazy loading saves,
looks up the host with the Green Web Foundation, and turns bytes into grams of CO2e per page view
with the Sustainable Web Design model v4, the model CO2.js and Website Carbon use. It writes
`report.md`, `findings.json` (the fix list) and `report.json` (every request).

Only audit sites the user owns or works on. A page load is an ordinary visit (`X-Audit:
eco-audit` on the script's own requests).

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/eco.mjs" <url> [more page urls] [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder. If it is not filled in, use the folder this
`SKILL.md` is in. Node 22 or newer, no dependencies; it finds Chrome, Chromium or Edge like
audit-all does (installed apps, `CHROME_PATH`, `--chrome`, Playwright's Chromium). Without a
browser it estimates from the HTML and what it references, and the report says so.

Run it with **`timeout: 600000`**. Each page takes 5–30 seconds (pages with video take longest).

| Flag | Use it when |
|---|---|
| `--pages N` (default 4) | Extra pages from the sitemap, one per template. Page URLs after the first are measured too ("measure the product page and the checkout"). |
| `--grid DK` | The user wants the figure for their visitors' country (DK, SE, DE, or any ISO alpha-3 code). Applies to device and network; the data centre stays on the global figure. Without it the model's global 494 g/kWh is used, which keeps sites comparable; say which one the report uses. Denmark's grid is roughly a third of the global one, so `--grid DK` gives much lower numbers. |
| `--views N` | The user knows monthly page views: the report adds a yearly CO2e estimate. |
| `--mobile` | "On mobile": a 412×915 phone viewport (images may differ with srcset). |
| `--header "Name: value"` | The site is behind a WAF bypass rule. Chrome sends it with every request the page makes, third parties included, so use a value made only for this. Also `AUDIT_HEADERS`. |
| `--no-browser` | Quick estimate, or no Chrome available. Oversized images, lazy loading and compression are then skipped. |
| `--no-remote` | Skip the Green Web Foundation lookup. |
| `--insecure` | localhost or a self-signed certificate. |
| `--out DIR` | The user names a folder for this run (audit-all does this). |
| `--state DIR`, `--baseline FILE`, `--no-baseline` | See "Folders and re-runs". |

## Folders and re-runs

Each site gets one target folder, `<reports>/eco-audit/<host>/`, where `<reports>` is
`$AUDIT_OUT_DIR`, else the Downloads folder if it exists, else `~/audit-reports/`. Runs go to
`runs/<YYYYMMDD-HHMM>/` inside it (or to `--out`). `last-report.json` there makes the next run add
a **Since last run** section (grams and bytes before and after, checks fixed or worse) by itself.
`notes.md` is the user's own (for example "the hero video is a client requirement until March")
and is shown in every report; do not write it unless asked.

## Present the results

1. **The number**: start page grams of CO2e per view and its rating, the median across the pages,
   and which grid it uses. One sentence on what dominates (video, images, scripts).
2. **Fix first**: the fails and warnings, biggest bytes first. Video that downloads before anyone
   presses play is usually the single largest win, then images (format, size, lazy loading),
   then JavaScript and fonts.
3. Green hosting: verified or not. Not verified is a conversation with the host (a person's task),
   not a code change.
4. The yearly figure only when the user gave page views; never invent traffic.
5. What was skipped or estimated, and the report paths.

Honesty rules:

- The model estimates; it does not measure the site's real footprint. Use it to compare pages
  and track change. Say "about 0.3 g CO2e per view (Sustainable Web Design model v4)", not
  "emits 0.3 g".
- Video and streams download for as long as the page is open, so video bytes vary from run to
  run. Round them in the summary.
- Ratings are not comparable across grids. Compare runs with the same `--grid`.
- Website Carbon's own site may show a different figure (another grid, its own crawler, cached
  results). Do not "correct" the script to match it.

## Fix plan

`findings.json` lists every fail and warn with `severity`, `fix`, `verify` and the heaviest files,
in the shape audit-all's `tasks.json` uses (`sources: ["eco"]`). Green hosting is marked
`owner: "human"`. Image and video fixes often live in the CMS or image CDN settings rather than
the repo.

## Example prompts

```
/eco-audit https://www.example.dk
What is the CO2 per page view of https://www.example.dk for Danish visitors? We have 80,000 views a month.
Is https://www.example.dk on green hosting?
Eco audit of https://www.example.dk and https://www.example.dk/shop/product-x on mobile
Check the page weight again after we removed the hero video
```

## Files

- `scripts/eco.mjs` — the runner (`--help` lists every flag).
- `scripts/lib/browser.mjs` — finds Chrome, loads a page over the DevTools protocol and records
  requests; `lib/static.mjs` — the no-browser estimate; `lib/co2.mjs` — the SWDM v4 model and
  ratings; `lib/grid-intensity.json` — yearly grid intensities by country (CO2.js 0.19 data,
  Ember, Apache-2.0); `lib/checks.mjs` — every check; `lib/report.mjs` — report.md and
  findings.json.
- `scripts/lib/http.mjs`, `html.mjs`, `robots.mjs` — copies of launch-audit's;
  `target-state.mjs` — the shared target-folder layout; keep the copies in step.
- Tests: `cd scripts && node --test test/*.test.mjs`.
