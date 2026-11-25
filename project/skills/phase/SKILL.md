---
name: phase
description: Moves a project from one phase to the next (context, planning, design, dev, qa, release) and says what the move means: what is still open from the phase being left, which files the new phase usually calls for, and which roles are up next. The team decides when to move; the skill shows what they are leaving unfinished and records the move. Use when someone says the project is moving to planning, design, development, QA or release, "we are done with discovery", "design is signed off", "we start building", "we are going live", or asks what phase the project is in and what it takes to leave it.
argument-hint: "[context|planning|design|dev|qa|release] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Grep, Glob
metadata:
  version: "0.1.0"
---

# Phase

A phase is a statement about where the team's attention is, not a gate. This skill is the phase
part of [status](../status/SKILL.md) under its own name: the script and the rules are the same.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. If `project/memory/state.md` is missing, the project is not set up: say so and point to `/project:new`.

## 1. Where it is

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/status.mjs" --root .
```

With no phase given, say the current phase, what is open in it, and stop.

## 2. What is left behind

Before moving, name what belongs to the phase being left and is not finished:

| Leaving | Look at |
|---|---|
| context | Setup questions still open or only drafted; `product-context.md` or `boundaries.md` still a draft |
| planning | Proposed decisions; parked technical questions; no milestone in the timeline |
| design | `DESIGN.md` sections still omitted; design questions parked on a prototype |
| dev | Paths the files name that are gone; records still proposed |
| qa | Boundaries and compliance items nobody has checked off |

Give the items themselves, not a count. Then ask once: move anyway? Moving with things open is
normal and allowed; moving without knowing is what this step prevents. Skipping a phase or going
back is allowed too: say that it is a step back and ask why, for the record.

## 3. Move

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/status.mjs" --root . --phase <phase>
```

## 4. What the new phase calls for

From [docs/file-map.md](../../docs/file-map.md#optional-files-and-their-triggers), name the optional
files this phase usually brings and which role would own each (planning: an architecture file,
guardrails, pull request rules; design: motion, themes or component files as they come up; qa: a
QA file). Do not create them: `/project:add` does when there is something to put in them. Name the
audits that fit the phase when the audit plugin is installed (before release: launch,
accessibility, security), as an offer.

If there is a timeline, give the next milestone. If the move makes a milestone done, say so and
leave marking it to `/project:timeline`.

## 5. Record

A move is a fact about the project, so it gets a change record with no bumps
(`record.mjs --slug phase-<phase> --title "Moved to <phase>" --asked-by <role> --status applied`),
with what was left open under "Deltas". In a git repo, commit on the branch `project-changes`; do
not push without being asked.

## Rules

- The team moves the project. Never move it because a list looks complete.
- What is left open is said plainly, once, and then the decision is theirs.
- Creates no files and closes no questions.
