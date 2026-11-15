# Changelog

All notable changes to the `snapshot` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md#versioning) for the versioning convention.

## [1.0.0] - 2026-11-15

### Added
- Initial release, `/memory:snapshot`. `memory-log.mjs` keeps a memory store's history on a private, orphan git branch (`memory-log`): one commit per snapshot, only when something changed, files and folders that start with a dot left out, pushed with `--push` (fast-forward only, never rewritten). A second clone catches up with the remote before it commits.
- `--list` (the snapshots, newest first), `--diff [A [B]]` (the store against the newest snapshot, against A, or A against B), `--show FILE [--from REV]` and `--restore FILE [--from REV] [--yes]` (shows the diff, and with `--yes` snapshots first, then writes one file back).
- Ported from a project where it has kept a hosted team store's history since 2026-11-03, with `--branch`, `--repo` and the reading commands added.
