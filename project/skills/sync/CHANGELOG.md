# Changelog

All notable changes to the `sync` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.1] - 2026-11-26

### Fixed
- The `description` in the header is now in double quotes. It held a colon followed by a space, which is not valid YAML unquoted: GitHub showed a parse error on the file, and a strict parser would not load the skill. The text is unchanged.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:sync`. **Untested**: written without a tracker connection, so it has never been run against one. Turns open, parked and skipped questions, proposed decisions and milestones into tracker items tied to the project by a marker line, shows the full list before touching the tracker, and offers closed items back as answers through `add`, `decide` and `timeline`.
