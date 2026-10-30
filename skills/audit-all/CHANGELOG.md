# Changelog

All notable changes to the `audit-all` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.2.0] - 2026-10-30

### Added
- a11y-audit as a fourth audit: run on the site URL after launch-audit (`--from` its crawl) into `<run>/a11y-audit/`. `combine.mjs` picks up `a11y-audit[-<host>]/report.md`, puts it after the launch audit, and shows criteria failed and issues on the cover and in the at-a-glance table.
- `a11y` as a task source in `tasks.json`; a11y-audit's own `tasks.json` draft is merged into the run's plan.

## [1.1.0] - 2026-10-30

### Added
- Fix plan. Claude writes `tasks.json` next to `summary.md` (every confirmed fix, duplicates merged, each with severity, owner, suggested model, repo, files, evidence, fix and a "done when" check), and `combine.mjs` turns it into `fix/TODO.md` and one self-contained prompt per task in `fix/tasks/`.
- Model tiers per agent task: `haiku` for mechanical edits, `sonnet` for ordinary code changes, `opus` for security and large upgrades (`fable` on request). Defaults to `opus` for security and blocker tasks, else `sonnet`.
- `owner: "human"` for work an agent must not do (rotating secrets, DNS and hosting settings, history purges, product calls). These are listed first in `TODO.md` and get no agent rules.
- Agent tasks are grouped into rounds that can run in parallel: a task waits for its dependencies and for any task in the same repo that touches the same files (or lists none).
- `--repo` finds solution-health 2.0's report in its state folder under the report root (`<reports>/solution-health/<repo>/report.md`), and still falls back to an in-repo `.solution-health/report.md`.
- `scripts/lib/tasks.mjs` with tests. A broken `tasks.json` is reported field by field and no plan is written; the combined report is still written.

## [1.0.0] - 2026-10-30

### Added
- Initial release. Runs launch-audit, security-audit and solution-health (one URL, one or more repos) into one run folder, then combines their reports with a written verdict and "Fix first" list.
- `scripts/combine.mjs` writes a combined `report.md`, a self-contained `report.html` and an A4 `report.pdf` printed with headless Chrome, Chromium or Edge (including Playwright's Chromium in cloud sessions).
- `--style serif` (default, Newsreader) and `--style sans` (IBM Plex Sans), with IBM Plex Mono for code. Fonts are bundled and embedded, so the PDF looks the same offline.
- `--repo PATH` copies a repo's committed `.solution-health/report.md` into the run folder.
- `--new NAME` creates the run folder under the shared report root: `$AUDIT_OUT_DIR`, else the Downloads folder if it exists, else `~/audit-reports/`.
