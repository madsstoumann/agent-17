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

Skills that write report files (a11y-audit, audit-all, launch-audit, security-audit, solution-health, tech-stack) use the same default folder, so reports from one machine end up in one place. First match wins:

1. `--out` when the user names a folder,
2. `$AUDIT_OUT_DIR`,
3. the Downloads folder if it exists and is writable (on Linux the XDG download folder from `XDG_DOWNLOAD_DIR` or `~/.config/user-dirs.dirs` first, then `~/Downloads`),
4. `~/audit-reports/`.

Each skill writes under `<folder>/<skill>/<site-or-repo>-<YYYYMMDD-HHMM>/`. Skills install separately, so each carries its own copy of the `reportsRoot()` resolver (see `security-audit/scripts/scan.mjs`); keep them in step when changing it. solution-health keeps one stable folder per solution instead of a timestamped one, `<folder>/solution-health/<solution>/`, because each run compares with the state the last run left there (`--in-repo` keeps it in the solution for teams that commit it).
