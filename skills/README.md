# Skills

Each folder is one skill: a `SKILL.md` plus whatever scripts, references and templates it needs. `.claude/skills/` holds copies of some of them for use in this repo; keep those identical to the folder here.

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
