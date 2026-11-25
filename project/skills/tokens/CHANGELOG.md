# Changelog

All notable changes to the `tokens` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:tokens`, not yet run on a real project. Exports the token groups in `DESIGN.md` as CSS custom properties and as a design-tokens JSON file, and checks exports on disk against the design file.
- `scripts/tokens.mjs`: reads the design file's header, resolves `{group.name}` references, refuses to export when a reference or a colour is wrong, never overwrites a file it did not generate; `--check` exits 1 on drift.
