# Changelog

All notable changes to the `enable-memory-management` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md#versioning) for the versioning convention.

## [2.2.1] - 2026-11-15

### Added
- `scripts/test/versions.test.mjs`: every memory skill's SKILL.md version is its newest CHANGELOG entry, and `plugin.json`, the marketplace entry and `memory/README.md` name every memory skill on disk.
- The root README's Parameters section lists the memory skills' main flags.

## [2.2.0] - 2026-11-15

### Added
- `--host claude-code|claude-project`: how the host reads `MEMORY.md`. `claude-project` is a hosted project whose coordinator sees only the index: its update is refused above 16,384 bytes, so M2 is an error past that and a warning past 14 KB ("move detail into topic files now, after a snapshot"); index lines may run to 800 characters (M3), because they carry what the coordinator routes with; the memory-rules check (E3) says the rules live in the project's instructions, which the audit cannot read. `report.json` records the host.
- `templates/rules/`: the memory rules in three forms, one text: a CLAUDE.md block (`claude-md.md`), `.claude/rules/memory.md` (`rules-memory.md`), and a hosted project's instructions (`project-instructions.md`). New rules from a project that has run them since 2026-11-03: at most two memory writes a turn, `metadata.written_by`, curated only from the person's own words, a decision as one line in the month's log, read back after ten seconds on a synced store, only the coordinator writes a hosted index.
- `templates/archive-a-plan/SKILL.md.template`: the project's `archive-a-plan` skill, written by step E6.
- `templates/STEERING.md`: an "Approval words" table.
- `references/store-format.md`: index limits by host, the index a coordinator reads, writing to a synced store (silently dropped writes, refused stale updates, sync lag, host-stamped keys), `metadata.written_by`, decisions in the month's log.
- `references/dreaming.md`: hosted projects (threads as sessions, whose words count, the coordinator reposts the list, `MEMORY.md` last as line edits), the full `last-dream.json` (`read_through`, `accepted_by`, `before`, `after`, `report`), and when a list goes stale.
- `scripts/test/templates.test.mjs`: every form under 15 lines, the two Claude Code forms identical, every placeholder explained.

### Changed
- `references/in-band-rules.md` says which form goes where, what each placeholder takes, and why each rule is there; the block itself moved to `templates/rules/`.
- SKILL.md: a hosts table; E2 for a coordinator's index, E3 by host, E4's one-line-per-rule shape, E6 writes `archive-a-plan`, E7 offers `/memory:snapshot` (the new sibling skill); a table of every template placeholder.

## [2.1.0] - 2026-11-15

### Changed
- The memory checks count only live files: a file with `metadata.status: archived` is left out of the orphan (M5), index (M4), Why (M10), size (M11), relative-date (M12), review (M13), dead-path (M14) and duplicate (M15) counts. It is still read for secrets (M7) and frontmatter (M8, M9). The summary counts `archived` and `logs`.
- A log (`metadata.kind: log`: dated lines, newest first, such as a month of decisions) may pass the 4 KB size limit.
- A path to a place Claude Code reads (`.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/settings.json`, `.mcp.json`, …) is not reported as missing or moved: a doc or skill that names it describes the convention.
- A path that exists in a git checkout beside the project (a sibling repo the text is about, such as an upstream model repo) is not reported as missing or moved. `opts.siblings: false` turns this off.

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
