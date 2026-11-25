# Project files

What the project skills keep in a project's repo, and the rules every file follows. The reasons are in [docs/README.md](../docs/README.md); every optional file and its trigger is in [docs/file-map.md](../docs/file-map.md).

## The starting set

| File | Kind | Holds | Accountable role |
|---|---|---|---|
| `AGENTS.md` | written, no header | Rules an agent would get wrong without being told, and one paragraph pointing here | `tech-lead` |
| `project/foundation/product-context.md` | written | What the project is and why, goals, people, dates | `pm` |
| `project/foundation/technical-context.md` | written, living | Constraints, hosting, existing systems, choices and their reasons | `tech-lead` |
| `project/intent/experience.md` | written, living | Goal, audiences, principles | `experience-lead` |
| `project/intent/boundaries.md` | written, living | Must, must not, compliance, out of scope | `pm` |
| `project/building-blocks/DESIGN.md` | written, living | Direction and tokens, in Google's DESIGN.md format | `designer` |
| `project/INDEX.md` | generated | Every file, its owner, audience, version and open questions | `build.mjs` |
| `project/memory/state.md` | kept | Phase, size, blockers, the interview's questions | `scaffold.mjs`, `answer.mjs` |
| `project/memory/decisions.md` | generated | Open, standing and superseded decisions | `build.mjs` |

Roles are words, never names. Who fills a role is an answer in `product-context.md`.

## The header

```yaml
---
name: boundaries              # the file name without .md
description: One line: what the file holds
metadata:
  type: project
  version: "0.1.0"            # written by build.mjs, never by hand
  status: draft               # draft | active | superseded
  audience: people-and-agents # people | agents | people-and-agents
  owner: pm                   # one role
  contributors: []
  depends_on: [product-context]
  open: [must, compliance]    # interview questions not answered yet
  changelog: memory/changelog/boundaries.md
  updated: 2026-11-25         # written by build.mjs
  review_by: 2027-02-25       # optional
---
```

`DESIGN.md` keeps Google's own top-level keys (`version: alpha`, `name`, `description`, `omitted`) and adds the `metadata` block. A file is `draft` while `open` has anything in it and `active` when it is empty; `answer.mjs` makes that switch.

## Budgets

| File | Budget | When over |
|---|---|---|
| `AGENTS.md` | 4 KB | Move anything that is not a rule into the project file that owns it |
| `DESIGN.md` | 16 KB | Move a section into `design/<topic>.md` and point to it with `@design/<topic>.md` |
| Any other | 8 KB | Split a section into its own file |

## Template placeholders

| Placeholder | In | Filled with |
|---|---|---|
| `{{PROJECT}}` | every template | the project's name, from `--name` |
| `{{DATE}}` | every template | the day, `YYYY-MM-DD` |
| `{{SIZE}}` | `state.md` | `small`, `medium` or `large` |
| `{{KIND}}` | `state.md` | `client`, `product` or `library` |
| `{{QUESTIONS}}` | `state.md` | the question rows for that size, from `templates/questions.json` |
| `{{SLUG}}`, `{{TITLE}}`, `{{ROLE}}`, `{{BUMPS}}` | `change.md` | a change record's file name, its one-line title, the role that asked, and the `file:level` list |

## Scripts

Zero-dependency Node 18+, in `scripts/` beside the skills. They print JSON.

| Script | Does |
|---|---|
| `scaffold.mjs --root DIR --name NAME [--size S]` | Writes the starting set. Never overwrites |
| `check.mjs --root DIR [--console]` | Lints headers, budgets, secrets and views; counts open questions per role. Exit 1 on an error |
| `check.mjs --root DIR --next` | The questions that can be asked now |
| `answer.mjs --root DIR --id Q --status answered\|draft\|skipped\|parked [--note T]` | Records a question's outcome in `state.md` and its file |
| `answer.mjs --root DIR --add ID --file KEY --role ROLE --ask TEXT` | Adds a question the interview found |
| `build.mjs --root DIR [--check]` | Rebuilds versions, changelogs, decisions and the index from the change records and headers |
