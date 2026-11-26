---
name: check
description: "Checks that a project's files are in order: every file has its header, an owner and a valid status, versions and changelogs match the change records, nothing is over its size budget, no secret has been pasted in, a review date has not passed, and the generated index and decision list are current. Fixes only what is generated; everything else is reported with the file and what is wrong. Use when someone asks to check, lint or validate the project files, asks \"is the project setup okay\", wants a check before a commit, a hand-over or a release, sees an error from a project script, or wants the check added to a pipeline."
argument-hint: "[--fix] [--ci] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Edit, Grep, Glob
metadata:
  version: "0.1.1"
---

# Check

[status](../status/SKILL.md) says where the project stands. This says whether its files can be
trusted to say so. It is the same check the other skills run when they finish, on its own.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. If `project/memory/state.md` is missing, the project is not set up: say so and point to `/project:new`.

## 1. Run

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/check.mjs" --root . --console
node "${CLAUDE_SKILL_DIR}/../../scripts/build.mjs" --root . --check
```

`check.mjs` exits 1 on an error. `build.mjs --check` says whether versions, changelogs, the
decision list and the index match the change records, without writing.

## 2. Report

Errors first, then warnings, each as: the file, what is wrong, and what puts it right. Group by
file when one file has several. If everything passes, say so in one line and stop.

| Finding | Put right by |
|---|---|
| Generated files out of date | `--fix`, below |
| A file with no header, a bad status, several owners, an unknown `depends_on` | Its owner, or `/project:add`; show the header it should have |
| Over its size budget | Splitting a section into its own file with `/project:add` |
| Something that reads as a secret | Removing it now and rotating it; say that history still holds it |
| A review date passed | The owner reading the file; `/project:add` if it changed |
| A change record applied with nothing under "Deltas", or bumping a file that does not exist | Whoever wrote the record |
| `state.md` and a file's header disagree | `answer.mjs`, which keeps the two together |

## 3. Fix, only what is generated

With `--fix`, or on a yes:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/build.mjs" --root .
```

That rebuilds versions, changelogs, `decisions.md` and `INDEX.md` from the change records. It is
the only fix this skill makes. A written file is never edited here: a missing owner is a question
for a person, not a value to fill in.

## 4. In a pipeline

With `--ci`, or when asked to add the check to CI, propose one step that runs `check.mjs --root .`
and fails on exit 1, in the workflow the repo already has. If tokens are exported, add
`tokens.mjs --check` from [tokens](../tokens/SKILL.md). Add it only on a yes.

## Rules

- Reports and rebuilds. Does not write prose, answer questions or change a header.
- A finding is given with its file. "3 errors" alone is not a report.
- A secret is reported by where it is, never repeated in the conversation.
