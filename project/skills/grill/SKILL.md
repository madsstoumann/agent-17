---
name: grill
description: "Questions one project file, a plan or a proposal until its gaps show: what it assumes without saying, where it contradicts another file or a standing decision, what it leaves undefined, and what would have to be true for it to work. Asks one question at a time, in rounds, never asks what the files already answer, and writes each answer where it belongs. Use when someone says \"grill me\", \"poke holes in this\", \"what am I missing\", \"challenge this plan\", wants a file, a brief, a scope or an architecture stress-tested before it is agreed, or wants to be interviewed about one subject in depth after the project is set up."
argument-hint: "[file or subject] [--role ROLE] [--rounds N] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Write, Edit, Grep, Glob
metadata:
  version: "0.1.1"
---

# Grill

`/project:new` asks what a project needs to start. This asks what a file or a plan has not thought
about. The method is the one in [references/interviewing.md](../../references/interviewing.md):
rounds, one question at a time, nothing asked that a source already answers.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. If `project/memory/state.md` is missing, the project is not set up: say so and point to `/project:new`. A plan or a document that is not a project file can be
grilled too; its answers go into the project through step 5.

## 1. Read everything first

Read the subject, the files it depends on (`depends_on` in its header) and the files that depend
on it, `project/intent/boundaries.md`, and `project/memory/decisions.md`. Every question you could
answer from these is not a question. Run `check.mjs --root .` to see what is already open, so you
do not ask it again under another name.

## 2. Find the gaps

Go through the subject looking for these, and note each with the sentence that shows it:

| Gap | Looks like |
|---|---|
| Assumed | A claim that rests on something no file states ("users are logged in") |
| Undefined | A word carrying weight with no meaning given ("fast", "simple", "the usual flow") |
| Contradicted | Disagrees with another file, a boundary or a standing decision |
| Unowned | Something must happen and no role is said to do it |
| Unbounded | No limit where one is needed: how many, how long, by when, up to what cost |
| Untested | An outcome nobody could check: no way to tell it worked |
| Missing case | The empty state, the error, the second language, the person who is not the main audience |
| Empty | A heading with nothing under it in a file marked active |

Rank them: what would be most expensive to find out late comes first. Drop what does not matter
at this project's size.

## 3. Say what you found, then ask

Tell the person how many questions there are and for which roles, and the three that matter most.
They choose: all, only the top ones, or one role's. `--rounds` caps the rounds.

Then one question at a time:

- Quote the sentence the question comes from.
- Ask one thing. Offer a suggested answer when the files point to one, and say where it comes from.
- Ask a role only its own questions; a question for someone absent is recorded as skipped for
  that role, not answered by whoever is in the room.
- Follow an answer that opens a new gap, once. Do not chase every thread.

Challenge an answer that contradicts a file: say which, and ask which of the two stands. Do not
argue taste, and do not press for an answer nobody has: "we do not know yet" is an answer, and it
is recorded as parked with what would settle it.

## 4. Stop

Stop when the person says so, when the rounds are used, or when the questions left are below what
the project's size warrants. Everything answered so far is already written.

## 5. Write as you go

Each answer goes where [add](../add/SKILL.md) would put it, by add's sizing: a clarification is
written into the file under its heading; a choice between options or a reversal is a decision for
[decide](../decide/SKILL.md) after the session; what stays unanswered becomes a tracked question
(`answer.mjs --add`, then `--status parked` or `skipped` with a note). One change record for the
session, listing what was clarified; run `build.mjs` and `check.mjs --console` at the end.

## 6. Report

What is now settled; what was found and is still open, for whom; the contradictions and which
side won; what you chose not to ask and why. No verdict on the plan: the gaps are the result.

## Rules

- A gap is shown with the sentence it comes from. No general doubts.
- Never fill a gap yourself. A plausible answer nobody gave is worse than the gap.
- The person can stop after any answer.
- Hard on the text, not on the person.
