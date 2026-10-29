# Changelog

All notable changes to the `solution-health` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.1] - 2026-10-29

### Added
- End-to-end test (`scripts/test/`): fixture solution, mock DAWA/PSP provider sending RFC 9745/8594 headers and the Danish shutdown banner, seeded metadata caches, `node:test` assertions for every phase. Run with `node --test scripts/test/solution-health.test.mjs`.
- README status note on which metadata parsers were verified against live services (api.nuget.org, endoflife.date) and which were not (packages.ecosyste.ms, api.deps.dev).

## [1.0.0] - 2026-10-29

### Added
- Initial release: report-only health check of npm and NuGet packages (outdated, vulnerable, deprecated, archived upstream), runtime and framework end-of-life, and external APIs the code calls (deprecation and sunset headers, shutdown notices).
- Committed `.solution-health/` manifest and state so each run reports what changed since the last one.
