# Changelog

All notable changes to the `new` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md#versioning) for the versioning convention.

## [0.2.0] - 2026-11-25

Two test runs: a repo that already had its own `AGENTS.md`, `DESIGN.md` and skills, and an empty repo with an invented team answering over two sessions.

### Added
- `--kind client|product|library`. The kind rewords the questions that assume a client (who pays, the client contact, the client's IT rules, launch dates), so a product or a library is not asked them.
- A `draft` status for an answer read from the repo or a brief. It is written with its source, is asked first in the next round for a person to confirm, keeps its file a draft, and does not hold up the questions after it.
- `check.mjs --next --role ROLE`, and per-role lines in `check.mjs --console`.
- `answer.mjs --role ROLE` moves a question to another role, for a team without the role the question was written for.
- A decision made during the interview is recorded with `/project:decide` afterwards; the session's own record keeps `decision: none`.
- Rules for what is not a clean answer: a partial answer, "not decided yet", "ask someone else", "there is none", and one person holding two roles.

### Changed
- A `DESIGN.md` the repo already has is kept as the design file: the scaffold writes no second one and asks no design questions.
- When tokens originate in a design tool or in code, the token questions are closed with a pointer to the source instead of being parked forever.
- Resuming reads who holds which role, asks who is present and re-raises parked questions.
- The change record of an interview session and the git branch are spelled out.

### Fixed
- A parked or skipped question blocked every question that depended on it, so the interview could end with answerable questions never asked.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:new`, not yet run on a real project. Scaffolds the starting set (`AGENTS.md`, product context, technical context, experience, boundaries, `DESIGN.md`, plus `INDEX.md`, `memory/state.md` and `memory/decisions.md`), reads the repo and any briefs or transcripts before asking, interviews in rounds by role and project size, and writes each answer before the next question so a session can stop and resume.
- Shared scripts in `project/scripts/`: `scaffold.mjs`, `answer.mjs`, `build.mjs` (versions, changelogs, decisions and the index from change records) and `check.mjs` (lint, open questions per role, the next round).
