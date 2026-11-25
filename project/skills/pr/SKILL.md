---
name: pr
description: Writes a pull request description from what the branch actually holds: the project's change records it adds (what was asked, why, what changed, the decision), the project files it edits and the code beside them, checked against the project's pull request rules and boundaries. Flags a project file changed with no record and a change still waiting for a yes. Opens the pull request only when asked. Use when someone asks to write, draft or open a pull request or a PR description, wants a summary of a branch for review, asks what a branch changes in the project files, or wants to know whether a branch is ready for review.
argument-hint: "[--base BRANCH] [--open] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Bash(gh:*), Read, Grep, Glob
metadata:
  version: "0.1.0"
---

# PR

A reviewer who has to work out why a change was made reviews the wrong thing. The reason is
already written, in the change records the branch carries; this skill puts it at the top of the
pull request.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. It needs a git repository. A repo without project files still
gets a description, from the commits and the diff alone; say that no records were found.

## 1. Collect

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pr.mjs" --root . [--base <branch>]
```

It returns the branch and its base, the commits, each change record the branch adds with its own
"Why", "Deltas" and "Decision" text, the project files changed, how many other files changed, the
rule files the project has (`tech/pr-rules.md`, `tech/guardrails.md`, `intent/boundaries.md`), the
repo's pull request template if there is one, and problems.

Then read the diff itself (`git diff <base>...HEAD`), the rule files, and the template.

## 2. Deal with the problems first

- **A project file changed and no record bumps it.** The change has no recorded reason. Say so and
  offer `/project:add` to record it before the pull request is written. If the person wants to go
  on, the description says in one line that the change is unrecorded.
- **A record is still proposed.** The branch carries something nobody has said yes to. Ask whether
  it should wait for `/project:decide` or leave the branch.
- **Nothing differs from the base.** Say so and stop.

## 3. Check against the project's rules

Go through `pr-rules.md` and `guardrails.md` if they exist, and the must and must-not lists in
`boundaries.md`. For each rule the diff touches, say whether the branch keeps it, with the file and
line that shows it. A rule you could not check from the diff is listed as not checked, never as
passed. A breach is reported to the person before anything is written; it is not softened into the
description.

## 4. Write

Use the repo's template when it has one: its headings are a layout to fill in. Skip a section that
asks for credentials, environment values or internal hosts. Without a template:

```markdown
<Title: what the branch does, under 70 characters>

## Why
<From the records' own words. One short paragraph. No record: say so.>

## What changed
<By area, not by file. Decisions first, each with what it replaced.>

## Project files
<Each project file changed, its new version, and the record that explains it.>

## Checked
<The rules gone through in step 3: kept, or not checked and why.>

## For the reviewer
<Where to look first; what was not tested; follow-ups a record lists under Hooks.>
```

- The reason comes from the record. Do not supply one the record does not give.
- No claim that something was tested unless the commits or a run in this session show it.
- No names of people; roles as the records give them.
- Nothing from the conversation that is not in the branch.

## 5. Hand over

Show the title and the description. With `--open`, or when the person asks for the pull request to
be opened, push the branch and open it against the base, as a draft unless they say otherwise.
Without that, stop at the text: opening a pull request notifies people.

## Rules

- Reads only. It never edits a project file, a record or the code.
- The description says what the branch holds, not what was intended.
- Opened only on the person's word, in this conversation.
