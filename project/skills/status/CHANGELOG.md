# Changelog

All notable changes to the `status` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:status`, not yet run on a real project. Reports phase, open questions per role, what waits on a decision or a person, stale files, files near their budget, paths that are named but missing, and the last changes; moves the project to another phase when asked.
- `scripts/status.mjs`: the same as JSON or with `--console`; `--phase` writes the phase to `state.md`.
