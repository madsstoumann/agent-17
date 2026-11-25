# Changelog

All notable changes to the `check` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:check`: the checks the other skills run when they finish, on their own. Reports each finding with its file and what puts it right, rebuilds only the generated files, and can add the check to a pipeline. Uses `check.mjs` and `build.mjs --check`, both in use since `new` 0.1.0.
