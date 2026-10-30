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

Skills that write report files (audit-all, launch-audit, security-audit, solution-health, tech-stack) use the same default folder, so reports from one machine end up in one place. First match wins:

1. `--out` when the user names a folder,
2. `$AUDIT_OUT_DIR`,
3. the Downloads folder if it exists and is writable (on Linux the XDG download folder from `XDG_DOWNLOAD_DIR` or `~/.config/user-dirs.dirs` first, then `~/Downloads`),
4. `~/audit-reports/`.

### Target folders and run folders

Nothing that should carry over between runs lives in a timestamped folder. Each skill keeps one **target folder** per site or repo, named after the site host or the repo folder (never after a run), and puts each run in a `runs/` folder inside it:

```
<folder>/<skill>/<target>/            what carries over
  target.txt                          which repo path or host the folder belongs to (root.txt in solution-health)
  notes.md                            hand-written notes; no script writes it, reports show it
  last-report.json, triage.json, …    the last result to compare with, verdicts, manifests
  runs/<YYYYMMDD-HHMM>/               one folder per run, marked with an .audit-run file
```

- A second target with the same name (two repos called `web`) gets a short hash suffix, decided by `target.txt`.
- Each skill finds its own target folder by target, even when the run output goes somewhere else (audit-all passes `--out` into its own run folder), and compares with its last run automatically. `--baseline FILE` picks a specific run; `--no-baseline` skips the comparison.
- A folder with an `.audit-run` marker, or one inside it, is never used for state: solution-health ignores a `--dir` there.
- When a target folder is new, a skill looks once for its earlier results in the old layouts (timestamped folders, audit-all run folders) by their content, not by folder name.
- solution-health's state folder is `<folder>/solution-health/<solution>/` itself (manifest.json, state.json, snapshots/, notes.md), because each run updates the state in place; `--in-repo` keeps it in the solution for teams that commit it.

Skills install separately, so launch-audit, security-audit and audit-all each carry a copy of `scripts/lib/target-state.mjs` (security-audit's tests check the copies are identical), and each carries its own `reportsRoot()` (see `security-audit/scripts/scan.mjs`); keep them in step. A new skill that writes reports should use the same layout.
