# Sources

| Source | Used for |
|---|---|
| "Learning while you sleep: beyond memory to dreaming", AI DevCon 2026 (Anthropic Applied AI) | The four layers (CLAUDE.md, memory tool, skills, memory as files), the production guardrails (versions, hash-before-write, permissions, portability), in-band memory versus out-of-band dreaming with evidence and a person accepting |
| [Claude Code: How Claude remembers your project](https://code.claude.com/docs/en/memory) | CLAUDE.md locations and `@imports`, AGENTS.md only through an import, the 200-line guidance, `.claude/rules/` with `paths:`, auto memory (`MEMORY.md`, first 200 lines or 25 KB), the four `type` values, `autoMemoryDirectory` |
| [Claude Code: Skills](https://code.claude.com/docs/en/skills) | Description at start, body when used, SKILL.md under 500 lines |
| [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | `/memories`, the six commands, path traversal, expiring unread files |
| [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) | Clearing old tool results, and saving to memory before they are cleared |
| [Managed Agents: Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory) | Stores under `/mnt/memory/`, read-only and read-write access, `content_sha256` preconditions, versions, redaction, limits, the prompt-injection warning |
| [Managed Agents: Dreams](https://platform.claude.com/docs/en/managed-agents/dreams) | One store and 1–100 sessions in, a new store out, input never modified; research preview |
| [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Just-in-time retrieval: point to files, load them when needed |

The budgets in `audit.mjs` (200 lines, the 200-line / 25 KB index load, 500-line skills,
1024-character descriptions) come from these pages. The 4 KB file size comes from hosted stores
that show only the first 4 KB of a file on recall. The 12 KB index target and the 1 KB rule length
are this skill's own defaults; flags change the budgets.
