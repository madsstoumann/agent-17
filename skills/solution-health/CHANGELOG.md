# Changelog

All notable changes to the `solution-health` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.1.1] - 2026-10-29

### Fixed
- The script commands use `${CLAUDE_SKILL_DIR}` instead of a hard-coded `.claude/skills/solution-health/` path, so the skill also works when installed as part of the `mads-skills` plugin or in `~/.claude/skills/`.

## [1.1.0] - 2026-10-29

### Added
- NuGet sources and package folders are resolved from the solution itself instead of assumed: the NuGet.config chain (project folder up to the drive root, plus the user config) with `<clear/>`, disabled sources and package source mapping, MSBuild restore properties (`RestoreSources`, `RestorePackagesPath`, `RestoreFallbackFolders`, `RestoreConfigFile` and friends), `NUGET_PACKAGES`, `globalPackagesFolder`, `fallbackPackageFolders` and `repositoryPath`. Confirmed with `dotnet nuget locals` / `dotnet nuget list source` when the SDK is installed.
- Each resolved source and folder is validated: local feeds and folders must exist, feed URLs are probed (404/410 red, unreachable or plain http amber, auth required info), unset `%VAR%`s and Windows-only paths are flagged, packages that source mapping sends nowhere are red, and the report shows how many direct packages are restored locally.
- New "NuGet sources and folders" section in `report.md`; these findings are tracked in `state.json` like packages and runtimes.

### Changed
- A NuGet package missing from nuget.org is reported as unknown (private feed) instead of red when the solution has a private feed it can come from.
- `nuget.config` files are no longer scanned for API hosts; their feeds are checked by the NuGet phase instead.

## [1.0.1] - 2026-10-29

### Added
- End-to-end test (`scripts/test/`): fixture solution, mock DAWA/PSP provider sending RFC 9745/8594 headers and the Danish shutdown banner, seeded metadata caches, `node:test` assertions for every phase. Run with `node --test scripts/test/solution-health.test.mjs`.
- README status note on which metadata parsers were verified against live services (api.nuget.org, endoflife.date) and which were not (packages.ecosyste.ms, api.deps.dev).

## [1.0.0] - 2026-10-29

### Added
- Initial release: report-only health check of npm and NuGet packages (outdated, vulnerable, deprecated, archived upstream), runtime and framework end-of-life, and external APIs the code calls (deprecation and sunset headers, shutdown notices).
- Committed `.solution-health/` manifest and state so each run reports what changed since the last one.
