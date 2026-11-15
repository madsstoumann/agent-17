# Store format

What a memory store looks like once enable-memory-management has set it up. It works on a plain
folder of markdown, so the same layout fits Claude Code's auto memory, a team store a host mounts,
a Managed Agents store and the API memory tool.

## Where each kind of knowledge goes

| It is… | It goes in | Because |
|---|---|---|
| True in every session, and short | `CLAUDE.md` (one line) | read in full at every start |
| True only when certain files are touched | `.claude/rules/<area>.md` with `paths:` | loaded when a matching file is read |
| A procedure that ran in three or more sessions | a skill, `.claude/skills/<name>/SKILL.md` | only its description costs anything until it is used |
| How a feature works, at length | a doc, linked from the rule that needs it | read when the feature is the task |
| Learned: a preference, a decision, the state of an area | a memory file, pointed to from `MEMORY.md` | survives the session; found by its index line |
| Only useful in this session | nowhere (or a scratch file the session deletes) | |

## Files

| File | Holds | Size |
|---|---|---|
| `MEMORY.md` | The index: one line per file, `- [[name]]: description`, grouped by type (User · Feedback · Project · Reference). No rule text. Where a coordinator reads only this file, it also holds the lines the coordinator routes with ([below](#an-index-a-coordinator-reads)) | under 12 KB; the hard limit depends on the host ([below](#index-limits-by-host)) |
| one file per subject | One person, one rule set, one area, one external system | under 4 KB; split when it grows |
| a log (`metadata.kind: log`) | Dated lines for one period, newest first: `decisions-2026-11.md` | may pass 4 KB; a new period starts a new file |
| `STEERING.md` | What the dream run keeps, never stores, and whose words count (from `templates/STEERING.md`) | short |

Subfolders are fine (`decisions/2026-11.md`); links use the file's `name`, not its path.

## Frontmatter

```yaml
---
name: deploy-habits
description: How deploys run here and the Friday rule, one line
metadata:
  type: project
  tier: working
  source: [the message, PR or session it came from]
  verified: 2026-11-03 app@3f2a91c
  review_by: 2026-12-03
  status: active
---
```

| Key | Required | Values | Used for |
|---|---|---|---|
| `name` | yes | the file's slug | links, the index |
| `description` | yes | one line, under 200 characters | the index line, recall |
| `metadata.type` | yes | `user` · `feedback` · `project` · `reference` | the four Claude Code types |
| `metadata.tier` | recommended | `curated` · `working` · `scratch` | who may change it (below) |
| `metadata.source` | for curated | where it was learned: message ids, PR, session id | provenance |
| `metadata.written_by` | for a team | the session or thread that wrote it (its title) | who to ask; the dream groups by it |
| `metadata.verified` | for project | date and the commit it was checked against | staleness |
| `metadata.review_by` | optional | a date; the audit lists files past it | staleness |
| `metadata.status` | optional | `active` · `done` · `archived` | archive instead of delete; the audit counts an archived file only for secrets and frontmatter |
| `metadata.kind` | optional | `log` | a dated log, newest first (one month of decisions); may pass 4 KB, the audit does not flag its size |

Extra keys sit under `metadata:` because the Agent Skills spec and some hosts reject unknown
top-level keys. Hosts that stamp their own keys (`modified`) keep them.

## Index limits by host

| Host | How the index is read | Hard limit | Aim |
|---|---|---|---|
| Claude Code auto memory, or a team store a session loads | first 200 lines or 25 KB at every start; the rest is not loaded | 200 lines / 25 KB | under 12 KB (`--host claude-code`, the default) |
| A hosted project whose coordinator sees only `MEMORY.md` | the whole file is the coordinator's memory | its update is refused above 16,384 bytes, and it is then asked for a full rewrite to about 11.4 KB | under 12 KB; at 14 KB a session moves detail into topic files, after a snapshot (`--host claude-project`) |
| A Managed Agents store, the API memory tool | the agent opens files itself | none known | the Claude Code budget, so the store can move between hosts |

## An index a coordinator reads

When one agent (a project's coordinator) sees only `MEMORY.md` and routes work from it, the index is
that agent's whole memory. It keeps pointer lines, and adds what the coordinator needs to route:

| Section | Holds |
|---|---|
| Conventions | the repos and their rules, how pull requests are merged, who may approve what, one line each |
| One line per area | what the area is, the thread or session that owns it, and `[[its file]]` |
| Decisions | one short line per standing decision; the full line is in the month's log |
| Work | what is in flight, with the thread ids, and the date the section was checked |

Only the coordinator writes it; a session sends it exact line edits (old line, new line). Its
lines are longer than pointers by design (`--host claude-project` lets them reach 800 characters).

## Writing to a synced store

A store a host syncs between sessions (a team folder, a hosted project's memory) behaves unlike a
local folder:

| Case | What happens | So |
|---|---|---|
| A session writes over a copy that changed meanwhile | the write is **dropped silently**: the store's version wins, no conflict copy | read right before, read back after about ten seconds, redo a dropped write |
| The coordinator updates `MEMORY.md` from a stale revision | refused, with the current text handed back | re-read, merge, retry |
| Another session's write | can take minutes to show up locally | re-read right before merging; do not tell anyone a change is saved before reading it back |
| The host stamps its own keys (`modified`) | kept, and set by the host | never write them |
| The sync's own state (`.memory-sync`, dot-folders) | not memory | never edit it; snapshots leave it out |

## Body

- One subject per file. Update the file that covers it before writing a new one.
- A `feedback` file says the rule, then **Why:** (what happened, in the person's words when they
  gave them) and **How to apply:** (when it applies, and when not).
- Absolute dates (2026-11-03), never "today" or "last week": a memory is read weeks later.
- A decision is one line in the month's log (`decisions-YYYY-MM.md`, `metadata.kind: log`) with the
  time and where it was made (a message or card id); the area's file links the log instead of
  repeating it.
- Link related memories with `[[name]]`. A link to a memory not written yet is a to-do, and the
  audit lists it.
- Never a secret, a token or a password, not even partly.

## Tiers

| Tier | Who changes it | How |
|---|---|---|
| Owner (CLAUDE.md, AGENTS.md, docs) | the person | agents propose; the person merges |
| Skills | the person, or an accepted SKILL proposal | a PR or an accepted dream proposal |
| `curated` | an accepted dream proposal, or the person's own words in a session | the session quotes them in `source` |
| `working` | any session, in-band | hash before write |
| `scratch` | the session that wrote it | deleted when the session ends |

## Index lines

Good: `- [[deploy-habits]]: Deploys run on Fridays only; who approves; the rollback script.`

Too long: a line that carries the rule itself (the audit flags lines over 300 characters). Move the
text into the file the line points at and keep the pointer.
