# Changelog

All notable changes to the `new` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:new`, not yet run on a real project. Scaffolds the starting set (`AGENTS.md`, product context, technical context, experience, boundaries, `DESIGN.md`, plus `INDEX.md`, `memory/state.md` and `memory/decisions.md`), reads the repo and any briefs or transcripts before asking, interviews in rounds by role and project size, and writes each answer before the next question so a session can stop and resume.
- Shared scripts in `project/scripts/`: `scaffold.mjs`, `answer.mjs`, `build.mjs` (versions, changelogs, decisions and the index from change records) and `check.mjs` (lint, open questions per role, the next round).
