# Changelog

All notable changes to the `launch-audit` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.1] - 2026-10-29

### Fixed
- The run command uses `${CLAUDE_SKILL_DIR}` instead of a hard-coded `~/.claude/skills/` path, so the skill also works when installed as part of the `mads-skills` plugin.

## [1.0.0] - 2026-09-24

### Added
- Initial release: `scripts/audit.mjs` runs the full pre-launch audit (crawl, redirects, soft 404s, TLS, DNS/SPF/DMARC, exposed files, security headers, caching, Lighthouse performance and accessibility, privacy, broken links, social previews, icons) and writes `report.md` and `report.json`.
- Flags for environment (`--env`), future production host, sampled pages, skipping or narrowing check groups, baseline comparison and self-signed local URLs.
- Supersedes the old `security-headers` skill.
