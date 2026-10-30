---
name: a11y-audit
description: Use when someone wants an accessibility audit, WCAG 2.2 or 2.1 AA check, EN 301 549 or European Accessibility Act (EAA) conformance check, webtilgængelighed / tilgængelighedserklæring review, or "is this site accessible" answer for a live or local URL — axe-core and HTML_CodeSniffer (Pa11y's engine) over a sample of pages, a keyboard-only walk for traps, invisible or covered focus and skip links, colour contrast, reflow at 320 px and text spacing, every finding mapped to WCAG criteria and EN 301 549 clauses. Writes report.md, report.json and a fix-plan draft. Not a substitute for a screen reader test, and not for code-only review without a running site.
argument-hint: "<url> [--pages N] [--from launch-audit/report.json] [--urls FILE] [--keyboard N] [--level A|AA|AAA] [--repo NAME[=PATH]] [--out DIR] [--state DIR] [--baseline FILE] [--no-baseline] [--header NAME:VALUE] [--insecure]"
allowed-tools: Bash(node:*), Read, WebFetch
metadata:
  version: "1.0.0"
---

# Accessibility audit

One script opens the site in headless Chrome and checks a sample of pages the way an
accessibility auditor's tool pass would: two rule engines, a keyboard-only walk and two layout
checks. It writes `report.md` (issues ranked by severity, a WCAG 2.2 criteria table with EN 301 549
clauses, the manual checks still needed), `report.json` and `tasks.json`, a fix-plan draft in the
shape audit-all and audit-fix read. Your job is to run it, read the stdout summary, look at the
items it marks for review, and tell the user what fails and what still needs a person.

Only audit sites the user owns or is engaged on. The script loads pages like a browser, presses
Tab, and never submits forms or clicks buttons.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/a11y.mjs" <url> [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder, wherever it is installed. If it is not filled in, use
the folder this `SKILL.md` is in.

Run it through Bash with **`timeout: 600000`**. Ten pages take one to three minutes. Progress goes
to stderr; the summary (about 25 lines) goes to stdout and ends with the three file paths. Exit
code 0 means it ran, whatever it found.

| Flag | Use it when |
|---|---|
| `--pages N` (default 10) | Pages to audit, start page included. Picked from the sitemap and the start page's links, one per template (first path segment and depth) before more of the same. |
| `--from <launch-audit report.json>` | launch-audit already crawled the site: sample from its crawl. audit-all always does this. |
| `--urls FILE` | The user names the pages (one URL per line): the checkout, a form, a login page. |
| `--keyboard N` (default 3) | Keyboard walk on the first N pages. `0` for a quick engine-only pass. |
| `--level A\|AA\|AAA` | Default AA, which is what the EU directives and the Danish webtilgængelighedslov require. |
| `--repo NAME[=PATH]` | The repo that renders the site. `tasks.json` then holds agent tasks for that repo instead of tasks for a person. |
| `--out DIR` | The user says where the report goes (audit-all passes its own run folder). Default `<target>/runs/<YYYYMMDD-HHMM>/`. |
| `--state DIR` | Target folder for this site. Default `<reports>/a11y-audit/<host>/`, where `<reports>` is `$AUDIT_OUT_DIR`, else the Downloads folder if it exists (the XDG download folder on Linux), else `~/audit-reports/`. |
| `--baseline FILE` / `--no-baseline` | Compare with a specific earlier `report.json`, or not at all. By default every run compares with the last run for this host. |
| `--header "Name: value"` | The site sits behind a WAF that challenges headless Chrome and has a bypass rule for a secret header (see the repo README). Sent only to the audited host and its www/apex sibling. Repeatable; also `AUDIT_HEADERS`. |
| `--insecure` | `localhost` or a self-signed certificate. |
| `--chrome PATH` | A specific browser. Default: `CHROME_PATH`, installed Chrome/Chromium/Edge, then Playwright's Chromium. |

Needs Node 22 and Chrome, Chromium or Edge. The first run downloads axe-core 4.14.0 and
HTML_CodeSniffer 2.5.1 from jsDelivr (unpkg as fallback), checks their SHA-256 against the pinned
value and caches them (`~/Library/Caches/a11y-audit`, `~/.cache/a11y-audit`, or `A11Y_AUDIT_CACHE`).
No npm install.

## Between runs

Each site has one target folder, `<reports>/a11y-audit/<host>/` (see the repo's `skills/README.md`):
`target.txt`, `last-report.json` (the next run's baseline), an optional hand-written `notes.md`, and
`runs/<stamp>/` per run. The report gets a "Since last run" section (fixed, new, still open, criteria
that changed) and a "Notes" section with `notes.md`. Write accepted exceptions there ("footer contrast
is a brand decision, signed off by …") when the user asks; no script writes it. The first run looks
once for an earlier a11y-audit `report.json` for the host under `<reports>/a11y-audit/` and
`<reports>/audit-all/`.

## What it checks

- **axe-core** with the WCAG 2.0, 2.1 and 2.2 A/AA tags plus best practice, at 1280 px. Covers
  contrast, alt text, names for links, buttons and fields, ARIA, landmarks, `lang`, target size
  (2.5.8) and more.
- **HTML_CodeSniffer**, the engine Pa11y runs by default, for the same standard. Its errors become
  issues unless axe already fails that criterion on the page; 4.1.1 Parsing (obsolete in WCAG 2.2)
  goes under best practice.
- **Keyboard walk.** Tab from the top with no mouse, recording every stop: keyboard traps (2.1.2,
  a blocker; Escape is tried before calling it one), focus on things you cannot see (2.4.7),
  no visible focus style (2.4.7, focused and blurred looks compared), focus covered by a sticky
  header or banner (2.4.11), the skip link (2.4.1) and big jumps in focus order (2.4.3).
- **Reflow** at 320 px (1.4.10) and **text spacing** (1.4.12, the bookmarklet values).
- **Accessibility statement** link on the start page (Danish public bodies: was.digst.dk).

## Read the results

Issues are confirmed failures; review items need a person to decide. Before you report:

- **Cookie banners.** The audit sees a first visit, so the consent banner is open. The walk reports
  a banner that covers the page once ("The cookie banner covers the page while Tab moves behind
  it") and skips banner buttons when looking for the skip link. Say that the other keyboard
  results ran with it open.
- **"No visible focus indicator"** compares computed styles; a style that only appears on real
  keyboard `:focus-visible` can be missed in rare cases. Spot-check one example in a browser
  before calling it a high finding.
- **"Focus moves to elements you cannot see"** is usually links in a closed menu or an off-screen
  slide. Confirm with the examples (selector and HTML are in the report).
- **Contrast** findings from axe give the measured ratio and colours; quote them.
- **Needs review** from axe ("incomplete") are often contrast over images or gradients: look at
  the page or say that they need a manual check.

Tell the user, in a few lines: the verdict, the blockers and high issues with their WCAG criteria,
what needs review, and that automated tools find only about a third of WCAG problems, so the
manual checks in the report (screen reader, forms, zoom, media) still decide conformance. Quote
the report paths. Do not fix anything as part of the audit; the fixes are a follow-up the user
asks for (audit-fix can work from `tasks.json` via audit-all).

## Legal context (for the summary, not legal advice)

- **EN 301 549 v3.2.1** is the harmonised standard: clause 9 is WCAG 2.1 A and AA for web pages,
  so WCAG 2.2's new criteria (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8) are good practice and
  likely in the next EN version, not yet the legal bar.
- **Denmark:** public bodies under the webtilgængelighedslov must meet EN 301 549 and publish an
  accessibility statement through Digitaliseringsstyrelsen's WAS-Tool. Private businesses selling
  consumer services covered by the European Accessibility Act (e-commerce, banking, transport,
  e-books, telecom) have had to comply since 28 June 2025; micro-enterprises are exempt for services.

## Files

- `scripts/a11y.mjs`: CLI, report folder, the run.
- `scripts/lib/cdp.mjs`: finds and launches the browser; a small DevTools Protocol client.
- `scripts/lib/engines.mjs`: pinned axe-core and HTML_CodeSniffer, checksum-verified and cached.
- `scripts/lib/probes.mjs`: code that runs in the page (engines, focus snapshot, reflow, text spacing).
- `scripts/lib/keyboard.mjs`: the Tab walk and its analysis.
- `scripts/lib/pages.mjs`: page sampling from sitemap, links, launch-audit or a list.
- `scripts/lib/wcag.mjs`: WCAG 2.2 criteria, levels and EN 301 549 clauses.
- `scripts/lib/findings.mjs`: issues across pages, review items, criteria status, `tasks.json`.
- `scripts/lib/report.mjs`: `report.md` and the stdout summary.
- `scripts/lib/target-state.mjs`: target and run folders, shared with the other audit skills (keep the copies identical).
- `references/manual.md`: the manual checks printed at the end of every report.
- `references/sample-report.md`: a report from the test fixture.
