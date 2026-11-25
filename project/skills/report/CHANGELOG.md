# Changelog

All notable changes to the `report` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:report`, not yet run on a real project. Writes one report per audience (`--for client`, `pm`, `tech`, or several) over a period (`--since 7d`) or as an outline, from the project's files and change records only; saves it under `project/memory/reports/`.
- `scripts/report.mjs`: selects the facts for an audience and a period: decisions with their reasons, other changes to the files that audience reads, what is waiting and what waits on the client, and for the PM and tech team what is going stale.
