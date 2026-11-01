# Changelog

All notable changes to the `privacy-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

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
