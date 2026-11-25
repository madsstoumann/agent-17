---
name: timeline
description: Keeps a project's milestones in one file, with what is due, when, and which role owns it. Adds a milestone, moves a date while keeping the date it had, marks one done or dropped, and says what is next and what is past its date. A date that moves is recorded with its reason, so reports can say the plan changed and why. Use when someone asks for a timeline, a plan, a roadmap or the milestones, gives a deadline, a launch date or a delivery date, says a date has moved or slipped, asks what is next or what is late, or wants the dates from a kick-off or a contract written down.
argument-hint: "[add|move|done|drop] [\"milestone\"] [--date YYYY-MM-DD] [--owner ROLE] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Write, Edit, Grep, Glob
metadata:
  version: "0.1.0"
---

# Timeline

A project's dates live in mails, a contract and people's heads until one of them is missed. This
skill keeps them in `project/foundation/timeline.md`: one table, one row per milestone. It is not a
task tracker and holds no tasks; a milestone is something the client or the team would notice
being late.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. If `project/memory/state.md` is missing, the project is not set up: say so and point to `/project:new`.

## 1. Read

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/timeline.mjs" --root .
```

It returns the milestones, the next one with the days left, those past their date and any row it
cannot read. With no file yet, say so and go to step 2 only if there is a date to write.

Asked only "what is next" or "are we late": answer from this and stop.

## 2. Add a milestone

A milestone needs three things: a name a client would recognise, a date, and the role that owns
it. Ask for what is missing. A date nobody has given is not guessed and not worked out from
another date: record it as an open question for the PM instead
(`answer.mjs --add ... --file timeline`, once the file exists).

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/timeline.mjs" --root . --add "<name>" --date <YYYY-MM-DD> --owner <role> [--note "<why this date>"]
```

The first milestone creates the file, owned by the PM, as a child of `product-context.md`. Taking
dates from a document (a contract, a kick-off transcript): quote where each came from in the note,
and add only dates the document states.

## 3. Move, finish or drop one

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/timeline.mjs" --root . --set "<name>" --date <new date>
node "${CLAUDE_SKILL_DIR}/../../scripts/timeline.mjs" --root . --set "<name>" --status done|dropped
```

A new date marks the row `moved` and keeps the first date in its note, so the file always shows
what was promised. Before moving a date, ask two things and write the answers into the change
record: why it moved, and who agreed. A date the client was given moves only with the PM's yes; a
date that is a boundary (a launch tied to an event, a legal deadline in `boundaries.md`) is a
decision and goes through `/project:decide`.

Check what the move touches: later milestones that depended on it stay where they are until
someone says otherwise. Name them and ask; never shift them on your own.

## 4. Record

Each run that changes the table gets one change record, with the bump the script returned
(`timeline:new` for the first milestone, `timeline:minor` after):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/record.mjs" --root . --slug <slug> --title "<one line>" --asked-by <role> --bumps <bump> --status applied
```

Write "Asked", "Why" and "Deltas" in it ([references/changes.md](../../references/changes.md)),
then run `build.mjs` and `check.mjs --console`. In a git repo, commit on the branch
`project-changes`; do not push without being asked.

## 5. Where it shows

`/project:status` gives the next milestone and those past their date. `/project:report` tells each
reader the next date and any that moved in the period, with the recorded reason.

## Rules

- A date comes from a person or a document. Never estimate one.
- A moved date keeps its first date. Never rewrite the table to look as if the plan held.
- Roles, not names, in the owner column.
- No tasks, no percentages, no estimates of effort: those belong in the tracker.
