# Memory

Memory management for a project's AI agents: what they load at every start, what they remember and how they learn from past sessions. This folder is its own plugin, `memory`, separate from the audit, check and plan skills in [`skills/`](../skills/), so the memory setup can grow its own rules and sub-skills.

## Install

```text
/plugin marketplace add madsstoumann/agent-17
/plugin install memory@agent-17
```

On claude.ai, add the `agent-17` marketplace under [Customize > Plugins](https://claude.ai/customize/plugins) and add **memory**. Skills run as `/memory:<name>`.

## Contents

**Keep this list current.** A pull request that adds, removes or renames a skill here, or changes what it does or how it is called, updates this table and the flags below in the same PR.

| Skill | What it does | How to use it |
| --- | --- | --- |
| [enable-memory-management](enable-memory-management/SKILL.md) | Measures a project's agent memory (always-loaded CLAUDE.md / AGENTS.md, `.claude/rules`, skills, docs, the memory store and past sessions), then after one approval sets up frontmatter and a lean index, in-band memory rules, snapshots with hash-before-write, a slimmer CLAUDE.md, skills for repeated procedures and a weekly dreaming pass that proposes memory changes for a person to accept. | `/memory:enable-memory-management` in the project, `--audit-only` to just measure, `--dream` for a review pass · [flags](#flags) · [with Managed Agents](enable-memory-management/README.md#set-it-up-with-managed-agents) |

### Flags

For `enable-memory-management`:

| Flag | What it does |
|---|---|
| `--root DIR` | The project (default: the current folder). |
| `--memory DIR` | The memory folder. Default: Claude Code's auto memory for the project (`autoMemoryDirectory` if set). Pass it for a team store, `/mnt/memory/<store>` or `/memories`. |
| `--transcripts DIR` / `none` | Session transcripts to count (default: Claude Code's for the project), or skip them. Also reads exported event pages and Managed Agents session events (`.json`, `.jsonl`). |
| `--since YYYY-MM-DD` | Only sessions on or after this date. |
| `--exclude a/,b/**` | Leave vendored or generated markdown out of the docs checks. |
| `--audit-only` | Measure and summarise; no question, no changes. |
| `--dream` | The dreaming pass: sessions since the last dream against the memory, numbered proposals with quotes and counts, applied only when accepted. |
| `--lint` | Errors and warnings for instructions, memory and skills, no files written, exit 1 on an error (for a hook or CI). |
| `--level`, `--console`, `--out`, `--state`, `--no-baseline` | As for the report-writing skills: see [Shared by every report-writing skill](../README.md#shared-by-every-report-writing-skill). |
| `--budget-lines N` / `--index-bytes N` | Change the budgets (200 lines always loaded; 25,000 bytes for `MEMORY.md`). |

`snapshot.mjs` (run by the skill) takes `--memory DIR`, `--diff`, `--list`, `--sha FILE`, `--check FILE --expect SHA` and `--restore STAMP --yes`. `sessions-export.mjs` takes `--agent AGENT_ID --out DIR [--since YYYY-MM-DD] [--max N]` and reads `ANTHROPIC_API_KEY`: it saves a Managed Agents agent's recent sessions for a dream run. Running the skill with Claude Managed Agents (a memory store and a weekly dreamer deployment): [its README](enable-memory-management/README.md#set-it-up-with-managed-agents).

## Versioning

Same convention as [`skills/`](../skills/README.md#versioning): a quoted semver `version` under `metadata` in each `SKILL.md`, and a `CHANGELOG.md` in Keep a Changelog format next to it, bumped in the same commit as the change. Each skill's tests run from its `scripts/` folder: `node --test test/*.test.mjs`.
