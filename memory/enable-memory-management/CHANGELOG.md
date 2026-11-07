# Changelog

All notable changes to the `enable-memory-management` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md#versioning) for the versioning convention.

## [2.0.0] - 2026-11-07

### Changed
- Lives in `memory/` and installs as its own plugin, `memory@agent-17`, so it runs as `/memory:enable-memory-management`. The `memory-dream` template, the README and the schedule line use the new command and install line.

## [1.0.0] - 2026-11-03

### Added
- Initial release: `audit.mjs` measures the always-loaded instructions, AGENTS.md, `.claude/rules`, skills, docs and the memory store, and lists the enable steps that apply (E1–E8) with the findings behind each; `--lint` for hooks and CI.
- `transcripts.mjs` counts, per session, the commands, files, skills and corrections in Claude Code transcripts or exported event pages, for skill candidates and dream runs.
- `snapshot.mjs` snapshots a store with a sha256 manifest, diffs and restores it, and checks a file's hash before a write.
- The dreaming method (`references/dreaming.md`), the store format, the in-band rules block, and templates for a project's `memory-dream` skill and `STEERING.md`.
- `README.md`: running the skill in Claude Code, and setting it up with Claude Managed Agents (a memory store attached to the working sessions, a weekly memory-dreamer deployment with the store read-only, reviewing and applying its proposals, undo through memory versions, and Dreams).
- When several files share a moved file's name, the folder nearest the old path wins (`page` → `page-grid`); a tie is reported as missing, not guessed.
- `sessions-export.mjs` saves a Managed Agents agent's recent sessions as event files (GET requests only), and `transcripts.mjs` reads Managed Agents session events (`user.message`, `agent.tool_use`) as well as Claude Code transcripts.
