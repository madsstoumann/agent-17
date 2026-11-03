# Changelog

All notable changes to the `enable-memory-management` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.0] - 2026-11-03

### Added
- Initial release: `audit.mjs` measures the always-loaded instructions, AGENTS.md, `.claude/rules`, skills, docs and the memory store, and lists the enable steps that apply (E1–E8) with the findings behind each; `--lint` for hooks and CI.
- `transcripts.mjs` counts, per session, the commands, files, skills and corrections in Claude Code transcripts or exported event pages, for skill candidates and dream runs.
- `snapshot.mjs` snapshots a store with a sha256 manifest, diffs and restores it, and checks a file's hash before a write.
- The dreaming method (`references/dreaming.md`), the store format, the in-band rules block, and templates for a project's `memory-dream` skill and `STEERING.md`.
