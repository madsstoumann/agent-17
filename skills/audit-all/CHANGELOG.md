# Changelog

All notable changes to the `audit-all` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.7.0] - 2026-10-30

### Added
- A compact report next to the full one on every run: `report-compact.html` and `report-compact.pdf` (`scripts/lib/compact.mjs`). Same cover, verdict, Fix first and at a glance; per audit only what needs action (every warn and fail kept, passes counted, other lists and tables cut to five rows, detail subsections and reference sections left out, clean sections named in one line). The sample run goes from 41 to 17 pages. `--no-compact` skips it.

### Changed
- `combine.mjs` reports its version as 1.7.0 (it still said 1.5.0).
- The first question is "All" or "Customize". All runs all eight audits; Customize shows two multi-selects of four audits each, alphabetical, named Accessibility, Infrastructure, Launch, Privacy, Security, SEO / GEO, Solution health and Sustainability. The live URL is part of the first question's text and changed under "Other"; a separate "Site" question appears only when several URLs were detected. `--yes` still means the default set, not All.
- A "Look" question next to All/Customize: Editorial (serif, the default) or Modern (sans). `--style editorial|modern` work as aliases for `serif|sans`; "classic look" no longer means sans.
- `accessibility`, `infrastructure`, `geo` and `sustainability` are accepted as flag names. The combined report calls the seo-audit and eco-audit sections "SEO / GEO audit" and "Sustainability audit".

## [1.6.0] - 2026-10-30

### Added
- Asks before starting, in one `AskUserQuestion` call: the live URL (detected candidates first, "No site" or a typed URL), the default site audits (launch, privacy, infra), the opt-in ones (a11y, SEO, carbon) and the code audits (security, health). A re-run recommends the audits that ran last time.
- `--only`, `--add`, `--url`, `--no-site` and `--yes` answer the questions, so scripted runs and audit-fix re-runs never stop to ask. Without the tool (claude.ai, `claude -p`, subagents) the flags and defaults apply and summary.md lists what was skipped.

### Changed
- a11y-audit, seo-audit and eco-audit are opt-in: the default set is launch, privacy, infra, security and health. Use `--add a11y,seo,eco` or `--only all` for the old behaviour.

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
