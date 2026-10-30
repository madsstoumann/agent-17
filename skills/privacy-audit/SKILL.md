---
name: privacy-audit
description: Use when someone wants a GDPR, ePrivacy or cookie compliance check of a website — cookies or trackers set before consent, whether "reject" is honoured, whether the consent banner offers reject on the first layer and treats both buttons equally, pre-ticked boxes, Google Consent Mode v2, embeds and Google Fonts loaded without consent, data sent to the US and other third countries, and whether the privacy policy and cookie declaration exist and name every cookie. Also "is our cookie banner legal", "what does the site track", "Datatilsynet cookie check". Drives headless Chrome as three new visitors; read-only. Not for security headers or TLS (launch-audit, infra-audit).
argument-hint: "<url> [--pages N] [--only first,reject,accept] [--lang L] [--header NAME:VALUE] [--out DIR]"
allowed-tools: Bash(node:*), Read, Write, Edit, WebFetch
metadata:
  version: "1.0.0"
---

# Privacy audit

A script loads the site in headless Chrome as three new visitors, each in a fresh browser context:

1. **No choice.** Loads the start page and `--pages` more internal pages without touching the
   banner, then opens the privacy and cookie policy pages. Records every request (iframes included),
   every cookie in the browser (first- and third-party, set by headers or JavaScript), storage keys,
   the Google Consent Mode commands and the banner itself (buttons, sizes, colours, pre-ticked
   switches), and screenshots it as `banner.png`.
2. **Reject.** Clicks reject on the first layer; if there is none, opens the settings and rejects
   or saves there; as a last resort uses the consent tool's JavaScript API (and reports that a
   visitor could not). Reloads and records what still loads.
3. **Accept.** Clicks accept, reloads, records what it turns on.

It then classifies hosts and cookies (vendor, purpose, country) and writes `report.md`,
`report.json` (rows, raw requests and cookies, and task candidates for audit-all), `banner.png`
and `policy-*.txt`. Your job: run it, look at the screenshot, read the policy, and add a short
policy review to the report.

It only reads: it clicks consent buttons and follows internal links, never submits forms or logs
in. Only audit sites the user owns or is engaged on.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scan.mjs" <url> [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder. Run it through Bash with `timeout: 600000`; a run takes
1–4 minutes (busy news sites take longest). It needs Chrome, Chromium or Edge (installed apps,
`CHROME_PATH`, `--chrome`, or Playwright's Chromium) and Node 20+. No npm packages.

| Flag | Use it when |
|---|---|
| `--pages N` | Extra internal pages loaded before consent (default 2, picked from different sections so other templates load). `0` for a quick run. |
| `--only reject` / `--only accept` | Only one choice scenario (the no-choice visit always runs). |
| `--lang en-GB` | The site picks the banner language from the browser; default Danish (`da-DK`). |
| `--header "Name: value"` | A WAF bypass rule (see launch-audit). Sent only to the audited host and its www/apex sibling, never to third parties. Also `AUDIT_HEADERS`. |
| `--no-policy` | Skip opening the policy pages. |
| `--out DIR` | The user names a folder. Default `<reports>/privacy-audit/<host>-<YYYYMMDD-HHMM>/`, where `<reports>` is `$AUDIT_OUT_DIR`, else the Downloads folder if it exists (the XDG download folder on Linux), else `~/audit-reports/`. |

**Run it from the EU.** Many consent tools only show the banner to EU visitors. From a US cloud IP
the banner may be missing and everything may load at once; if `consent.banner` fails on a site that
clearly has a banner in the EU, say so and re-run from an EU network.

## What it checks

| Section | Checks (`id`) |
|---|---|
| Consent banner | `consent.cmp` (which tool; none with trackers fails), `consent.banner`, `consent.reject-first-layer` (missing is a fail), `consent.button-parity` (reject much smaller or plain text next to a filled accept), `consent.prechecked`, `consent.google-consent-mode` (v2 default with all four parameters denied) |
| Before any choice | `before.trackers` (analytics, ads, session replay, marketing hosts), `before.cookieless-pings` (Consent Mode "advanced" hits with storage denied), `before.cookies`, `before.unclassified-cookies`, `before.storage`, `before.embeds` (YouTube, Maps, reCAPTCHA), `before.fonts` (Google Fonts), `before.tag-manager` |
| After reject | `reject.works` (no tracker and no tracking cookie after reject and reload), `reject.method`, `reject.prechecked` |
| After accept | `accept.inventory`: vendors and cookies that accepting turns on |
| Transfers | `transfer.third-countries` (vendors outside the EU/EEA, warn when contacted before consent), `transfer.hosts` (every third-party host, unrecognised ones listed) |
| Policy & forms | `policy.privacy` (linked from the start page, loads), `policy.cookie-declaration` (every cookie seen after accepting is named in the policy pages or the banner's details), `policy.forms` (personal-data forms over http, to third parties, or with a pre-ticked marketing box) |

Classification is a static list of about 60 vendors and 45 cookie families. A miss is
"unclassified", never "fine": look up unrecognised hosts and cookies yourself (WebFetch the vendor's
site) before calling them harmless.

## After the script: your part

1. **Look at `banner.png`** (Read it). Confirm the banner and check what the numbers cannot: is
   reject as visible as accept (colour, contrast, wording), is the text clear about purposes, is
   there a link to the policy, are there dark patterns ("Accept and continue" with a tiny "settings")?
2. **Read the `policy-*.txt` files** and check the privacy policy against GDPR Art. 13: controller
   name and contact (and CVR for Danish companies), DPO if any, purposes with legal basis, recipients
   and processors, transfers to third countries and their safeguard, retention periods, the data
   subject's rights, the right to withdraw consent, the right to complain to Datatilsynet (or the
   local authority). Compare the vendors in `accept.inventory` and `transfer.third-countries` with
   what the policy names.
3. **Append a `## Policy review` section** to `report.md`: one table row per Art. 13 item (✅ / ⚠️ / ❌
   with a short quote or "not found"), then the vendors the site uses but the policy does not name.
   Mark it as your reading, not legal advice.
4. Tell the user, in a few lines: what fails (before-consent trackers and cookies, reject not
   honoured, no first-layer reject are the serious ones), what to fix where (consent tool settings,
   GTM triggers, template), and the report path.

Severity, roughly: trackers or tracking cookies before consent, and reject not honoured, are
**high** (they are what Datatilsynet and other EU authorities fine for). A missing first-layer
reject is high. Consent Mode pings, embeds, Google Fonts and third-country transfers are medium.
Undeclared or unclassified cookies are low unless they turn out to be trackers.

## Not here

launch-audit checks cookie flags (Secure, HttpOnly, SameSite) on the first response and security
headers; infra-audit checks TLS and DNS. Inside audit-all, launch-audit runs with `--skip privacy`
when privacy-audit runs, so each finding appears once.

## For audit-all

`report.json` has `tasks`: every fail and warn in the tasks.json shape (`sources: ["privacy"]`,
`owner: "human"` by default). Make one an agent task when the fix is in the repo (the GTM snippet,
the CMP configuration, a hard-coded pixel, a Google Fonts `<link>`).

## Files

- `scripts/scan.mjs`: CLI, the three scenarios, report.
- `scripts/lib/cdp.mjs`: finds Chrome and speaks the DevTools protocol over a pipe.
- `scripts/lib/visit.mjs`: one browser context: navigation, request log (iframes too), banner clicks.
- `scripts/lib/inpage.mjs`: code that runs in the page: banner finder (shadow DOM too), CMP APIs, page facts.
- `scripts/lib/classify.mjs`: vendors, cookie families, countries, CMP signatures, Consent Mode parsing.
- `scripts/lib/analyse.mjs`: turns the scenarios into check rows (pure; tested without a browser).
- `scripts/lib/common.mjs`: result rows, report folder, Markdown, task candidates (same file as infra-audit's; keep in step).
- `scripts/test/`: `cd scripts && node --test test/*.test.mjs`.
