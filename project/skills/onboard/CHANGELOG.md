# Changelog

All notable changes to the `onboard` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.1] - 2026-11-26

### Fixed
- The `description` in the header is now in double quotes. It held a colon followed by a space, which is not valid YAML unquoted: GitHub showed a parse error on the file, and a strict parser would not load the skill. The text is unchanged.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:onboard`, not yet run on a real project. Writes a one-page way into a project for one role: the project in a paragraph, a reading order by role, the rules that role can break, the decisions a newcomer would trip over, and what is open for them. Reads `status.mjs` and `INDEX.md`; can save the page beside the reports.
