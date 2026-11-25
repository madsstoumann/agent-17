---
name: status
description: Says where a project stands, from its files alone, in under a screen. Reports the phase, how much of the setup interview is answered and what each role still owes, what is waiting on a decision or on a named person, which files are going stale or outgrowing their budget, where the files and the repo disagree (a path a file names that no longer exists), and the last changes. Moves the project to its next phase when the team says so. Read-only otherwise. Use when someone asks "where are we", "what is open", "what am I supposed to answer", "what is blocking", "is the project setup up to date", wants a quick check before a meeting or a hand-over, starts work in a project they do not know, or says the project is moving from context to planning, design, development, QA or release.
argument-hint: "[--role ROLE] [--phase context|planning|design|dev|qa|release] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Grep, Glob
metadata:
  version: "0.1.0"
---

# Status

The answer to "where are we" should not need a meeting. Everything this skill says comes from the
project's files and its change records; it adds nothing of its own and changes nothing, except the
phase when asked.

Scripts are in `${CLAUDE_SKILL_DIR}/../scripts/`.

## 1. Read

```bash
node "${CLAUDE_SKILL_DIR}/../scripts/status.mjs" --root .
```

If it says the project is not set up, say so and point to `/project:new`. If it reports errors,
those come first in step 2: a status built on files that disagree with each other is not to be
trusted.

## 2. Say it, shortest first

Answer in this order and stop early when the person only asked one thing. Leave out a part that is
empty; never write "none" five times.

1. **One line**: phase, how much of the setup is answered, and whether anything is wrong.
2. **Needs someone**: what is waiting on a decision (proposed records, parked questions) and on a
   person (skipped questions), each with the role and the note that says what would settle it.
   Who holds a role is in "People and roles" in `project/foundation/product-context.md`; name the
   person when the file does.
3. **Open questions per role.** With `--role`, only that role's, as the questions themselves, not
   their ids.
4. **Going wrong quietly**: files past a review date, unchanged for long or still drafts; files
   near their budget; paths a file names that are not in the repo.
5. **Last changes**: the last few change records, one line each.

Before reporting a missing path, look for it yourself: the check is literal, and a path written
relative to another folder, or with a different case, is not missing. Report only what you could
not find, and say which file names it.

Do not turn the status into advice. One suggestion at the end is enough, and only the next step
that unblocks the most: `/project:new` to continue the interview, `/project:decide` for a
proposal that has waited, `/project:add` when a file is stale because the project moved on.

## 3. Moving phase

The phases are context, planning, design, dev, qa and release. A project moves when the team says
it does, not when a checklist is full. When asked to move:

1. Say what is still open that belongs to the phase being left: unanswered setup questions, drafts,
   proposed records. Ask whether to move anyway.
2. On yes:
   ```bash
   node "${CLAUDE_SKILL_DIR}/../scripts/status.mjs" --root . --phase <phase>
   ```
3. Name the optional files the new phase usually calls for, from
   [docs/file-map.md](../docs/file-map.md#optional-files-and-their-triggers) (planning: an
   architecture file, guardrails; QA: a QA file), and that `/project:add` creates them when there
   is something to put in them. Do not create them here.

## Rules

- Read-only, apart from the phase. Never fix what you find; say which skill does.
- Nothing from memory or from the conversation: if it is not in the files, it is not in the status.
- No counts without the thing counted: "3 open for the designer" is followed by the three questions.
- A person's name appears only where the project's own files give it.
