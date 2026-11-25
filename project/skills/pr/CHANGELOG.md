# Changelog

All notable changes to the `pr` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:pr`, not yet run on a real project. Writes a pull request description from the change records and files a branch holds, checked against the project's pull request rules and boundaries; opens the pull request only when asked.
- `scripts/pr.mjs`: lists the records a branch adds with their reasons, the project files and other files changed, the rule files and template present, and flags a project file changed without a record and a record still proposed.
