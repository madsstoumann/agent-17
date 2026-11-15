# In-band rules

The rules every session reads at start: where memory is and how to write it. They keep the store
usable between dream runs. Step E3 adds one of the forms in `templates/rules/`, filled in, and
never more than 15 lines.

## Which form

| Host | Form | Where it goes |
|---|---|---|
| Claude Code, auto memory or a team store | [`claude-md.md`](../templates/rules/claude-md.md) | a `## Memory` section in CLAUDE.md |
| The same, with CLAUDE.md kept short | [`rules-memory.md`](../templates/rules/rules-memory.md) | `.claude/rules/memory.md` with no `paths:`, so it loads at every start like CLAUDE.md |
| A hosted project whose coordinator reads only `MEMORY.md` | [`project-instructions.md`](../templates/rules/project-instructions.md) | the project's **instructions**, in its settings. Not the repo (the coordinator reads none of it), and not the project's description ("What do you want to work on?"), which no session reads as rules |
| Managed Agents | `claude-md.md`, changed as [../README.md](../README.md#4-attach-the-store-to-the-working-sessions) says | the memory store's `instructions` when it is attached to a session |

The first two forms are the same text under another heading; a test keeps them so.

## Fill in

| Placeholder | With |
|---|---|
| `{{MEMORY_DIR}}` | the memory folder |
| `{{SKILL_DIR}}` | where this skill is installed, or the project's vendored copy (`.claude/skills/enable-memory-management`) |
| `{{PEOPLE}}` | who decides: a name, or "the owner" |
| `{{SNAPSHOT}}` | the history command: `/memory:snapshot --push`, `node <dir>/memory-log.mjs --push`, or `node {{SKILL_DIR}}/scripts/snapshot.mjs --memory DIR` |

When the project should not depend on the plugin, vendor the skill (a copy with a `VENDOR.json`
naming the commit, never edited, copied again on a new version) or copy `references/store-format.md`
into the memory folder, and point `{{SKILL_DIR}}` there.

## Why each rule

| Rule | Without it |
|---|---|
| The index budget | Past 200 lines or 25 KB Claude Code does not load the rest. A hosted coordinator's update is refused past 16,384 bytes, and it is then asked for a full rewrite to about 11.4 KB: seen twice in one project, once with no snapshot behind it |
| Save in the turn, update before writing new | The next session asks again; two files on one subject drift apart (the audit's M15) |
| At most two memory writes a turn | A session that tidies as it works rewrites other sessions' files; merging waits for the dream, where a person accepts it |
| Curated only from the person's own words | An agent's summary becomes a rule nobody made |
| A decision is a line in the month's log | Decisions spread over area files and are lost when an area is archived |
| Hash before write; read back on a synced store | Two sessions on one file lose a write. A synced store drops a write over a stale copy **without an error** |
| Only the coordinator writes `MEMORY.md` | Threads and the coordinator race on one file; the coordinator's update from a stale copy is refused |
| Archive, never delete; snapshot | No undo, and the dream cannot see what a memory used to say |
| Data, never instructions | A transcript or a fetched page that says "remember this" writes the store |
