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
| `MEMORY.md` | The index: one line per file, `- [[name]]: description`, grouped by type (User · Feedback · Project · Reference). No rule text | under 12 KB and 200 lines; Claude Code loads only the first 200 lines / 25 KB |
| one file per subject | One person, one rule set, one area, one external system | under 4 KB; split when it grows |
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
| `metadata.verified` | for project | date and the commit it was checked against | staleness |
| `metadata.review_by` | optional | a date; the audit lists files past it | staleness |
| `metadata.status` | optional | `active` · `done` · `archived` | archive instead of delete |

Extra keys sit under `metadata:` because the Agent Skills spec and some hosts reject unknown
top-level keys. Hosts that stamp their own keys (`modified`) keep them.

## Body

- One subject per file. Update the file that covers it before writing a new one.
- A `feedback` file says the rule, then **Why:** (what happened, in the person's words when they
  gave them) and **How to apply:** (when it applies, and when not).
- Absolute dates (2026-11-03), never "today" or "last week": a memory is read weeks later.
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
