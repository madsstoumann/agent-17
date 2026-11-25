# Changelog

All notable changes to the `timeline` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../../README.md](../../README.md#versioning) for the versioning convention.

## [0.1.0] - 2026-11-25

### Added
- First version, `/project:timeline`, not yet run on a real project. Keeps milestones in `project/foundation/timeline.md`: add, move (the first date is kept), done, dropped; what is next and what is past its date.
- `scripts/timeline.mjs`: reads and edits the milestone table, creates the file on the first milestone, refuses a date that is not a date and a milestone listed twice. `status.mjs` and `report.mjs` now return the next and overdue milestones.
