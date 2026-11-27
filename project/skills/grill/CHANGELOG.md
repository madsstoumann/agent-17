# Changelog

All notable changes to the `grill` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.1] - 2026-11-26

### Fixed
- The `description` in the header is now in double quotes. It held a colon followed by a space, which is not valid YAML unquoted: GitHub showed a parse error on the file, and a strict parser would not load the skill. The text is unchanged.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:grill`, not yet run on a real project. Questions one file, plan or proposal for what it assumes, leaves undefined, contradicts or cannot test; asks in rounds by [references/interviewing.md](../../references/interviewing.md) and writes each answer through the same rules as `add` and `decide`.
