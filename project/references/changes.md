# Change records

A change to the project files is written once, as a record in `project/memory/changes/<date>-<slug>.md`. People review the record, not a diff of five files. Versions, per-file changelogs, the rollup, the decision list and the index are built from the records by `build.mjs`.

```markdown
---
name: 2026-11-27-dark-mode
description: Dark mode as a second theme
metadata:
  type: change
  date: 2026-11-27
  status: applied             # proposed | applied | rejected
  asked_by: designer
  bumps: [design:minor, boundaries:patch]
  decision: accepted          # none | proposed | accepted | superseded
  supersedes: [2026-11-20-light-only]
---

## Asked
The request, in the person's words, and where it was made.

## Why
The reason they gave.

## Deltas
- design: ADDED a `dark` colour group; MODIFIED Overview to say both themes are first class
- boundaries: MODIFIED Must: contrast holds in both themes

## Decision
Context, the options considered, the choice, who made it. Empty for a plain edit.

## Hooks
What was proposed to the audits, and whether a developer accepted it.
```

## Bump levels

| Level | Means | Version |
|---|---|---|
| `patch` | Wording; nothing anyone relies on changed | 1.4.0 → 1.4.1 |
| `minor` | Something added: a section, tokens, a rule | 1.4.0 → 1.5.0 |
| `major` | Something others rely on changed or went: a renamed token, a reversed boundary | 1.4.0 → 2.0.0 |
| `complete` | The file's open questions are all answered | below 1.0.0 → 1.0.0 |
| `new` | The file was created by this change | 0.1.0 |

Below 1.0.0 a file is still being filled in, and `minor` and `major` both move the middle number.

## Order

1. Write the record as `proposed`, with the deltas.
2. Show it to the accountable role of every file in `bumps`. A `major`, or anything in `boundaries`, needs their yes in their own words.
3. Edit the files, set the record to `applied`, run `build.mjs`, then `check.mjs`.
4. A rejected record stays, as `rejected`, so the same change is not proposed again without new reasons.

Never edit a file's `version` or `updated`, a changelog, `decisions.md` or `INDEX.md` by hand: the next build overwrites them.
