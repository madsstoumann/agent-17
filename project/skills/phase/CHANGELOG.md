# Changelog

All notable changes to the `phase` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.1] - 2026-11-26

### Fixed
- The `description` in the header is now in double quotes. It held a colon followed by a space, which is not valid YAML unquoted: GitHub showed a parse error on the file, and a strict parser would not load the skill. The text is unchanged.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:phase`: the phase part of [status](../status/SKILL.md) under its own name. Shows what is left open in the phase being left, moves the project with `status.mjs --phase`, names the files and audits the new phase usually calls for, and records the move. Not yet run on a real project.
