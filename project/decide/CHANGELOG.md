# Changelog

All notable changes to the `decide` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md#versioning) for the versioning convention.

## [0.1.1] - 2026-11-25

### Changed
- After a simulated run on a meeting transcript: a choice is stated once, under the heading that owns its subject; a choice with no reason given is recorded as such, never supplied; the git branch and commit are spelled out.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:decide`, not yet run on a real project. Records a decision as one change record with context, options, choice, reason and who decided; supersedes an earlier decision; updates the files it changes and closes the interview questions it settles; records an open decision and accepts or rejects it later.
- `scripts/record.mjs`: creates a change record from the template and moves one along (applied, rejected, accepted), refusing a bump that names no project file, a record it would overwrite and a superseded record that holds no decision.
- `decisions.md` gains a "Waiting" section: the interview questions that are parked, which are decisions nobody has taken yet.
