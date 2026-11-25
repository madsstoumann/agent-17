---
name: onboard
description: Gets a new person into a project from its files: what the project is in a paragraph, what to read and in which order for their role, the rules they must not break, the decisions that explain why things are the way they are, what is open for their role right now, and what to ask whom. Written for one role at a time and short enough to read before a first meeting. Use when someone joins a project, asks "where do I start", "what should I read", "give me the overview", is taking over from a colleague, when a new developer, designer, PM, QA or client contact needs an introduction, or when an agent starts work in a project it has not seen.
argument-hint: "[--role ROLE] [--save] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Write, Grep, Glob
metadata:
  version: "0.1.0"
---

# Onboard

A project's files are written for people who were there. Someone new needs a way in: what to read
first, what they can leave for later, and what is theirs to pick up. This skill writes that, for
one role, from the files alone.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. If `project/memory/state.md` is missing, the project is not set up: say so and point to `/project:new`.

## 1. Who is joining

Ask for the role when it is not given, as one word the project uses (`pm`, `designer`,
`frontend`, `tech-lead`, `qa`, `client`). Someone taking over a role is onboarded to that role.

## 2. Read

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/status.mjs" --root .
```

and `project/INDEX.md`, which gives every file with its owner, audience, version and open
questions. Then read the files this role needs, by the order in step 3.

## 3. The reading order

Everyone starts the same way and then follows their role. A file the project does not have is
left out, not mentioned.

| Role | Reads, in order |
|---|---|
| Everyone | `product-context.md`, then `boundaries.md` |
| PM | `experience.md`, the timeline, `memory/decisions.md`, then `/project:status` |
| Designer | `experience.md`, `DESIGN.md` and the files under `design/`, the components |
| Developer, tech lead | `AGENTS.md`, `technical-context.md`, the files under `tech/`, `DESIGN.md` for its tokens |
| QA | `experience.md`, the scenarios and journeys if there are any, compliance, the QA file |
| Client contact | `experience.md` and the timeline; nothing under `tech/` |

Then add what this project in particular makes necessary: a file that role owns comes first after
the two shared ones; a file changed in the last weeks comes before one that has been still; a
draft is marked as a draft so nobody builds on it.

## 4. Write it

One page, in this order:

1. **The project in a paragraph**, from `product-context.md`: what it is, for whom, why now.
2. **Where it is**: the phase, the next milestone if there is a timeline, in two lines.
3. **Read these, in this order**: each file with one line on what they will get from it and
   roughly how long it is. Mark what can wait.
4. **Rules you must not break**: the must and must-not items in `boundaries.md` that this role
   can break, and the rules in `AGENTS.md` for a developer. In the files' own words.
5. **Why things are the way they are**: the three to five standing decisions that would surprise
   a newcomer or that they might undo by accident, each with its reason from the record.
6. **Yours now**: the open questions for this role, as the questions themselves; the files this
   role owns; anything waiting on this role.
7. **Who to ask**: by role, and by name only where "People and roles" gives one.

Keep it to what the files say. Where a file is thin or a draft, say so: it tells the newcomer what
they cannot rely on, and it is the most useful line on the page.

For a client contact, leave out file names, versions and tooling, as
[report](../report/SKILL.md) does for a client.

## 5. Hand over

Show it in the conversation. With `--save`, write it to
`project/memory/reports/<date>-onboard-<role>.md` with the report header from the report skill
(`type: report`, `audience: <role>`). It is a snapshot: the next person gets a new one, and an old
one is not kept up to date.

If the newcomer is a person the project does not list, offer to add them to "People and roles"
with `/project:add`. Do not add them here.

## Rules

- Reads only, apart from the saved page.
- Nothing from memory, the conversation or the code unless a project file says it.
- One role per page.
- No history of the project. Decisions that still stand, with reasons; not the story of how they
  were reached.
