# Changelog

All notable changes to the `audit-privacy` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [2.3.0] - 2026-11-10

### Added
- `policy.thin`: a privacy policy with fewer than 400 words of its own is a warning. A thin page that links to policies under it (a selector page, one policy per product) has those pages read too, one level down and at most three, saved as `policy-1-1.txt` and on; the row is info when one of them holds a full policy, and a warning naming the pages further down when they are selectors too.
- When the start page has no link to a privacy or cookie policy, the policy is looked for in the sitemaps (from robots.txt, the www or bare host alike, else `/sitemap.xml` and `/sitemap_index.xml`) and then at common paths (`/privatlivspolitik`, `/privacy-policy`, `/privacy`, `/cookiepolitik`, `/datenschutz` and others), and read. `policy.privacy` still fails, and says where the policy was found.

### Changed
- `policy-*.txt` holds the policy page's own text: the consent banner, the site header, navigation, sidebars and footer are left out (a cookie declaration the page embeds stays). The word count in `policy.privacy` is of that text.

## [2.2.3] - 2026-11-10

### Changed
- SKILL.md says how `consent.cmp` names the consent tool (by vendor host, `lib/cmp.mjs`).

## [2.2.2] - 2026-11-09

### Changed
- The consent tool is found by `lib/cmp.mjs`, shared with audit-launch (identical copy, tested), so both skills name the same tool. The vendor host a page requests wins over markup, and a consent tool found only by its window global is now named by vendor ("Usercentrics", not "UC_UI").

## [2.2.1] - 2026-11-09

### Fixed
- Text from a Next.js page's script payload (`lib/rsc.mjs`) is read from the page's own components only. The payload also carries what every page has, and that was counted as the policy's hidden text and appended to `policy-*.txt`: the not-found and error pages ("This page could not be found."), inline script bodies (analytics and consent snippets), nav and footer labels, an app store link and the promo teasers in the header's mega menu. That was about 40 to 110 extra words per page on the sites it was tried on. When the payload has its router tree, only the rows the page segment reaches are read; nav, header and footer elements, not-found and error boundaries, image and video descriptions and script code are skipped everywhere. Text in closed accordions is still read.

## [2.2.0] - 2026-11-09

### Fixed
- The policy text includes what sits behind closed accordions and tabs. On a Next.js site whose accordions mount their content only when opened, that text is not in the page's HTML or DOM, only in the React Server Components payload (`self.__next_f.push(…)` scripts), so `policy-*.txt` held the section headings without their text and the policy review saw a policy with most of it missing. `<details>` elements are opened before the text is read, and text that is only in the payload is added after a marker line. Nothing on the page is clicked. New `lib/rsc.mjs`, shared with plan-geo.

## [2.1.1] - 2026-11-09

### Fixed
- `--console --out DIR` writes the run's files to `DIR`. `--console` without `--report` always used a scratch folder in the system temp folder and ignored `--out`, and the scratch folder was removed at the end, so nothing was left where the user asked for it. The console list now ends with the report path when `--out` is given.

## [2.1.0] - 2026-11-01

### Removed
- Fallbacks for the old skill names: results saved with the old `tool` value no longer count as a baseline, and the old env var names (`*_AUDIT_DEBUG`, `A11Y_AUDIT_CACHE`) are gone. An old reports folder is still moved once, silently.

## [2.0.0] - 2026-11-01

### Changed
- Renamed from `privacy-audit` to `audit-privacy`, so every audit skill starts with `audit` (folder, `name:`, `/skills:audit-privacy`, the `tool` value in report.json, the X-Audit header and the reports folder `<reports>/audit-privacy/`).
- The first run moves an existing `<reports>/privacy-audit/` target folder to `<reports>/audit-privacy/`, so notes.md, triage and the last result carry over. Results saved with `tool: "privacy-audit"` still count as earlier runs for the baseline.
- Major version because the skill's name and invocation changed.

## [1.1.0] - 2026-11-01

### Added
- `--level error|warn|info` (comma list, e.g. `error,warn`; default `all`): report.md and the stdout summary show only rows at those levels, with a line saying what is hidden. report.json (with `tasks`) and last-report.json keep every result, so baselines are unaffected.
- `--console`: a compact list on stdout, one line per issue, errors first, counts on top (`scripts/lib/levels.mjs`). The run's files go to a scratch folder in the system temp folder; last-report.json is still saved. `--console --report` gives both. The scratch folder is kept for the policy text; Claude gives the policy review after the list.

## [1.0.0] - 2026-10-30

### Added
- Initial release. `scripts/scan.mjs` drives headless Chrome over the DevTools protocol (no npm packages) as three new visitors: no choice (start page plus `--pages` more), reject, and accept, each reloading after the choice.
- Records every request including iframes, every cookie in the browser context, storage keys, Google Consent Mode commands and the banner (buttons, sizes, pre-ticked switches, also in shadow DOM and cross-origin iframes), and saves a screenshot.
- Checks: consent tool and banner, reject on the first layer, button parity, pre-ticked purposes, Consent Mode v2 defaults, trackers, cookies, storage, embeds and Google Fonts before consent, Consent Mode pings, whether reject is honoured, what accept turns on, third-country vendors, privacy policy link, cookie declaration coverage and personal-data forms.
- Saves the privacy and cookie policy text for Claude's GDPR Art. 13 review, which the skill adds to the report.
- `report.json` carries task candidates in audit-all's tasks.json shape.
- A target folder per host (`<reports>/privacy-audit/<host>/` with `target.txt`, `notes.md`, `last-report.json`) and one run folder per run under `runs/`. Each run compares with the last one ("Since last run") and shows `notes.md`; `--baseline` picks another report.
