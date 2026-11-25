---
name: report
description: Writes a report on a project from its own files and change records, for the client, the PM, the tech team, or several of them at once, over a period or as it stands now. Says what was decided and why, what changed, what is waiting and on whom, and what is needed from the reader, in that reader's language: plain and short for a client, by role and deadline for a PM, by file, drift and follow-up for the tech team. Saves each report in the project so the next one can say what moved since. Use when someone asks for a status report, a weekly or monthly update, a client update, a summary for a steering group, "what happened this week", an outline of the project for a new team member, a hand-over, or wants the same thing on a schedule.
argument-hint: "[--for client|pm|tech[,...]] [--since 7d|YYYY-MM-DD] [--until YYYY-MM-DD] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Write, Grep, Glob
metadata:
  version: "0.1.0"
---

# Report

A report is where a project's files meet people who will never open them. This skill writes it from
what the files and the change records say, and from nothing else: if a thing was not recorded, it
is not in the report, and the report says where the record is thin.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. If `project/memory/state.md` is missing, the
project is not set up: say so and point to `/project:new`.

## 1. Who it is for, and which period

`--for` takes one audience or several (`client,pm`). Each audience gets its own report; never one
text for two readers. With no `--for`, ask once. With no `--since`, the report is an outline of the
project as it stands; with one (`7d`, `30d` or a date) it covers that period.

## 2. Collect

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/report.mjs" --root . --for <audience> [--since <period>]
```

It returns, already selected for that reader: the decisions and other changes in the period, with
each record's own "Why", "Deltas" and "Decision" text; what is waiting, and what waits on the
client; the phase and how far the setup is; and, for the PM and the tech team, what is going stale.

Then read what the facts point to, and only that: the project files named in the changes, and the
previous report for this audience in `project/memory/reports/` if there is one, so this report can
say what moved since. For an outline with no period, read `product-context.md`, `boundaries.md`
and the files that audience reads.

If `empty` is true, nothing was recorded in the period. Say exactly that, list what is still
waiting, and stop: a report padded to look busy is worse than a short one.

## 3. Write it for that reader

| | Client | PM | Tech |
|---|---|---|---|
| Opens with | Where the project is, in two sentences | Phase, and what moved since the last report | What changed in the technical files |
| Decisions | What was chosen and what it means for them. The reason in a sentence | Each decision, who made it, what it replaced, what it costs or moves | The choice, the option that lost and why, the files it changed |
| Changes | Only what they would notice: scope, dates, audiences, look and feel | By file owner: what changed and what is still a draft | By file, with versions; hooks offered and not yet answered |
| Waiting | "We need from you", each with why it matters and by when, if a date is recorded | Who owes what, by role and by person where the files name them; how long proposals have waited | Parked technical questions, missing paths, files near budget |
| Leaves out | File names, versions, role words, tooling, internal disagreement, anything in `technical-context.md` that is not a consequence for them | Nothing, but keeps it to a page | Product background they already have |
| Length | Half a page | One page | One page |

Rules for all three:

- Lead with what the reader has to do or know. The history comes after.
- A decision is reported with its reason, taken from the record's own words. No reason recorded:
  say "no reason was recorded", do not supply one.
- Say what replaced what when a decision reverses an earlier one.
- A date, a cost or a number appears only if a file holds it.
- No progress percentages and no traffic lights: "21 of 29 setup questions answered" is a fact,
  "72% done" and "green" are not.
- A client report is written in the client's language and never names a person on the team as the
  cause of a delay; it names what is waiting.
- Something that waits on the client is phrased as a question they can answer by replying.

## 4. Check it against the facts

Before saving, go through the report sentence by sentence: each one traces to a line in the
collected facts or in a project file. Remove what does not. Then check the reverse: every decision
in the period and everything that waits on this reader is in the report.

## 5. Save and hand over

Write the report to the path the script gives as `saveAs`
(`project/memory/reports/<date>-<audience>.md`), with this header and nothing generated beneath it:

```markdown
---
name: <date>-<audience>
description: "<Audience> report, <since> to <until>"
metadata:
  type: report
  audience: <audience>
  since: <since or empty>
  until: <until>
---
```

If `exists` is true there is already a report for that date and audience: show the difference and
ask before replacing it. Reports are a record of what was said; an old one is never edited to
match what turned out to be true.

Show the report in the conversation as well. Sending it (mail, a channel, a document for the
client) is the person's step: offer the text, and do not send anything yourself unless asked, in
those words.

In a git repo, commit the report on the branch `project-changes`; do not push without being asked.

## 6. On a schedule

A weekly client report is this skill with `--for client --since 7d` on a schedule. When asked to
set one up, schedule it to write the report and show it to the PM; the PM sends it. A report never
goes to a client unread.

## Rules

- Only what the files and the change records hold. Nothing from memory, the conversation or the
  code unless a project file says it.
- One reader per report.
- No secrets, and no private details about people. Roles; a name only where the project's files
  give it and the reader needs it.
- The report changes nothing else in the project. What it reveals as wrong or missing is fixed
  with `/project:add` or `/project:decide`, and the report may say so in one line to the PM or the
  tech team, never to the client.
