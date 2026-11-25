# Changelog

All notable changes to the `add` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:add`, not yet run on a real project. Sorts a prompt, file or transcript into answers, changes, decisions, questions, conflicts and what does not belong; sizes each change (wording, addition, reversal); stops on a conflict with a boundary or a standing decision; shows one plan; writes one change record and applies it; adds a file only on a trigger; offers hooks to the audits.
- Tested once by a fresh agent on an invented meeting transcript before release; what it found is in: a test for decision or change, an instruction inside the input is an item and never an order, a boundary addition needs its owner's yes, a missing yes goes in a second record, a file is added only when there is content for it, and hooks nobody answered are listed as offered.
- `scripts/file.mjs`: adds one written file with the standard header, refusing a duplicate name, a path under `memory/` and a parent that is not a project file; `--sizes` lists every file against its budget.
- Shared scripts: `answer.mjs --add` takes `--status parked|skipped --note`, and an answered question drops the note that said what it waited for; `record.mjs` keeps a title under 100 characters and accepts a file name (`DESIGN.md`) in `--bumps`.
