# Skills

Each folder is one skill: a `SKILL.md` plus whatever scripts, references and templates it needs.

## Versioning

Every skill carries a [semver](https://semver.org/) version in its `SKILL.md` frontmatter and a `CHANGELOG.md` next to it.

```yaml
---
name: my-skill
description: ...
metadata:
  version: "1.2.0"
---
```

The version lives under `metadata` because the Agent Skills spec only allows `name`, `description`, `license`, `allowed-tools`, `metadata` and `compatibility` at the top level, and some tools (including the claude.ai skill upload) reject other keys. Quote it so YAML keeps it a string.

When to bump:

- **Major**: the skill's contract changes in a way that breaks existing use, such as a renamed or removed flag or argument, a changed output file or report format, or a new required setup step.
- **Minor**: new checks, flags or capabilities that keep existing use working.
- **Patch**: fixes, wording, and description tweaks that change triggering only slightly.

Changes that touch only the changelog or other repo housekeeping do not bump the version.

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): newest version first, a `## [x.y.z] - YYYY-MM-DD` heading per release, and `Added`, `Changed`, `Fixed` or `Removed` subsections. Bump the version and add the changelog entry in the same commit as the change. A new skill starts at `1.0.0`.

## Report folders

Skills that write report files (audit-a11y, audit-all, audit-eco, audit-infra, audit-launch, audit-privacy, audit-seo, audit-security, audit-solution-health, check-tech-stack) use the same default folder, so reports from one machine end up in one place. First match wins:

1. `--out` when the user names a folder,
2. `$AUDIT_OUT_DIR`,
3. the Downloads folder if it exists and is writable (on Linux the XDG download folder from `XDG_DOWNLOAD_DIR` or `~/.config/user-dirs.dirs` first, then `~/Downloads`),
4. `~/audit-reports/`.

### Target folders and run folders

Nothing that should carry over between runs lives in a timestamped folder. Each skill keeps one **target folder** per site or repo, named after the site host or the repo folder (never after a run), and puts each run in a `runs/` folder inside it:

```
<folder>/<skill>/<target>/            what carries over
  target.txt                          which repo path or host the folder belongs to (root.txt in audit-solution-health)
  notes.md                            hand-written notes; no script writes it, reports show it
  last-report.json, triage.json, …    the last result to compare with, verdicts, manifests
  runs/<YYYYMMDD-HHMM>/               one folder per run, marked with an .audit-run file
```

- A second target with the same name (two repos called `web`) gets a short hash suffix, decided by `target.txt`.
- Each skill finds its own target folder by target, even when the run output goes somewhere else (audit-all passes `--out` into its own run folder), and compares with its last run automatically. `--baseline FILE` picks a specific run; `--no-baseline` skips the comparison.
- A folder with an `.audit-run` marker, or one inside it, is never used for state: audit-solution-health ignores a `--dir` there.
- When a target folder is new, a skill looks once for its earlier results in the old layouts (timestamped folders, audit-all run folders) by their content, not by folder name.
- audit-solution-health's state folder is `<folder>/audit-solution-health/<solution>/` itself (manifest.json, state.json, snapshots/, notes.md), because each run updates the state in place; `--in-repo` keeps it in the solution for teams that commit it.

Skills install separately, so audit-launch, audit-security, audit-a11y and audit-all each carry a copy of `scripts/lib/target-state.mjs` (audit-security's tests check the copies are identical), and each carries its own `reportsRoot()` (see `audit-security/scripts/scan.mjs`); keep them in step. A new skill that writes reports should use the same layout.

## Levels and the console list

Every skill that writes a report takes the same two flags:

- `--level error|warn|info`, or a comma list such as `error,warn`, or `all` (the default). One scale for all skills: **error** is fail, blocker, critical, high or red; **warning** is warn, medium, moderate, low or amber; **info** is info, review items and unknown. Passing and skipped checks show only with `all`.
- `--console` prints a compact list instead of writing `report.md`, one line per issue, errors first:

  ```
  audit-launch shop.example.dk — 2 errors · 5 warnings · 3 info — showing errors only
  ERROR  exposed  secret-files  Secret files · /.env served (200)
  ERROR  crawl    meta-robots   Meta robots · noindex, nofollow
  ```

  The run's files go to a scratch folder in the system temp folder; the target folder's `last-report.json` is still saved. `--console --report` writes both.

The level filters what people read: the console list, `report.md`, the combined report and PDFs, and audit-all's `fix/TODO.md`. It never filters saved data (`report.json`, `findings.json`, `tasks.json`, `last-report.json`, `state.json`, `triage.json`), so the next run's comparison is unaffected. audit-all passes the level to each sub-audit, applies it to the fix plan, and asks for it on its first screen.

Skills install separately, so each carries an identical `scripts/lib/levels.mjs` (`audit-all/scripts/test/levels.test.mjs` checks the copies). Change one, copy it to the others.
