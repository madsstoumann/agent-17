# Changelog

All notable changes to the `node-toolchain-check` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.1] - 2026-10-29

### Fixed
- The run command uses `${CLAUDE_SKILL_DIR}` instead of a hard-coded `~/.claude/skills/` path, so the skill also works when installed as part of the `mads-skills` plugin.

## [1.0.0] - 2026-10-22

### Added
- Initial release: read-only `check.sh` report on nvm, Node (latest and LTS), outdated global npm packages (flagging major bumps and `npm link`ed packages), brew-managed pnpm/yarn/bun/deno, and Node installed outside nvm, followed by upgrades only for the items the user approves.
