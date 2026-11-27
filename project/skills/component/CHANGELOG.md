# Changelog

All notable changes to the `component` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.1] - 2026-11-26

### Fixed
- The `description` in the header is now in double quotes. It held a colon followed by a space, which is not valid YAML unquoted: GitHub showed a parse error on the file, and a strict parser would not load the skill. The text is unchanged.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:component`. **Untested**: written without a design tool connection, so reading a component from a design file has not been run. Writes one guidance file per component under `project/building-blocks/components/`, with purpose, anatomy, variants, states, tokens by name, behaviour and accessibility; values that match no token become questions. Uses `file.mjs`, `record.mjs` and `tokens.mjs`, which are tested.
