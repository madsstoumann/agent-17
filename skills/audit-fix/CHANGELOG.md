# Changelog

All notable changes to the `audit-fix` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.2] - 2026-10-30

### Changed
- The offer to re-run audit-all passes `--url`/`--no-site` and `--only`, so audit-all 1.6.0 does not stop to ask which audits to run.

## [1.0.1] - 2026-10-30

### Changed
- Finds the newest plan in audit-all 1.2.0's `<name>/runs/<stamp>/` run folders as well as the old `<name>-<stamp>/` ones.

## [1.0.0] - 2026-10-30

### Added
- Initial release. Reads an audit-all run folder's fix plan, asks once for approval, and runs one subagent per agent task with the model the plan suggests, in the plan's parallel rounds.
- Each task gets its own git worktree and branch under the run folder; passing tasks are merged into one local `audit-fix/<run>` branch per repo. Nothing is pushed and the repo's own working tree is not touched.
- Checks on every result (scope of the diff, skipped tests, secrets, the task's verify step) and an independent review by a separate subagent for blocker, security and opus tasks.
- `fix/results.md` with the outcome per task, and ticks in `fix/TODO.md`.
