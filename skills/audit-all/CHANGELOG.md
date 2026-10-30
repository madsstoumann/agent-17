# Changelog

All notable changes to the `audit-all` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.5.0] - 2026-10-30

### Added
- privacy-audit (cookies, trackers, consent banner, transfers, privacy policy) and infra-audit (domain, DNS, mail authentication, TLS per endpoint, CT subdomains) as sub-audits on the site URL, into `<run>/privacy-audit` and `<run>/infra-audit`. Both get a section in the combined report and fail/warn counts on the cover; `privacy` and `infra` are valid `tasks.json` sources, and `--skip privacy,infra` drops them.
- When they run, launch-audit runs with `--skip privacy` and `--skip tls`, so each finding is reported once.

## [1.4.0] - 2026-10-30

### Added
- seo-audit and eco-audit as sub-audits on the site URL, into `<run>/seo-audit` and `<run>/eco-audit`. The combined report gets a section for each, with fail and warn counts on the cover (and the start page's CO2e per view for eco-audit).
- `tasks.json` accepts `seo` and `eco` as sources; both skills write a `findings.json` in the task shape to start from. `--skip seo,eco` drops them.

## [1.3.0] - 2026-10-30

### Added
- a11y-audit as a fourth audit: run on the site URL after launch-audit (`--from` its crawl) into `<run>/a11y-audit/`. `combine.mjs` picks up `a11y-audit[-<host>]/report.md`, puts it after the launch audit, and shows criteria failed and issues on the cover and in the at-a-glance table.
- `a11y` as a task source in `tasks.json`; a11y-audit's own `tasks.json` draft is merged into the run's plan.

## [1.2.1] - 2026-10-30

### Added
- `--repo` also copies solution-health's `tasks.json` (its red and amber findings as draft fix tasks, solution-health 2.2.0+) next to its report, and step 5 says to start the plan's dependency, runtime, API and licence tasks from it.

## [1.2.0] - 2026-10-30

### Added
- A target folder per site or solution, `<reports>/audit-all/<name>/`, with run folders under `runs/<stamp>/` (marked `.audit-run`). `--new` also prints the target folder and the previous run, including an old-layout `<name>-<stamp>/` run.
- `notes.md` in the target folder is shown as a "Notes" section in every combined report. No script writes it.
- SKILL.md: a "Since last run" section in summary.md from the previous run, task ids reused across runs, and the rule that state lives in each skill's target folder, never in a run folder (solution-health runs without `--dir`).

### Changed
- `combine.mjs --new` creates `<reports>/audit-all/<name>/runs/<stamp>/` instead of `<reports>/audit-all/<name>-<stamp>/`.

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
