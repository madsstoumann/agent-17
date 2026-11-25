---
name: tokens
description: Exports the design tokens in a project's DESIGN.md (colours, typography, spacing, rounding, motion) as CSS custom properties and as a design-tokens JSON file, and checks that exports already on disk still match. DESIGN.md stays the one place a token is decided; the exports are generated and never edited by hand. Use when someone asks to export or generate the tokens, wants CSS variables or a tokens.json from DESIGN.md, asks whether the CSS and the design file agree, changes a colour, a font size or a spacing step and wants the code to follow, or wants a check for a pipeline that fails when the two drift apart.
argument-hint: "[--css PATH] [--json PATH] [--check] [--root DIR]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Write, Edit, Grep, Glob
metadata:
  version: "0.1.0"
---

# Tokens

A token decided in one place and typed again in three others is wrong in one of them within a
month. This skill makes `DESIGN.md` the source and the stylesheet a copy: it reads the token groups
in the design file's header and writes them out, the same way every time.

Scripts are in `${CLAUDE_SKILL_DIR}/../../scripts/`. It reads `project/building-blocks/DESIGN.md`, or the repo's
own `DESIGN.md` when the project adopted one. It works without the rest of the project files.

## 1. Read

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/tokens.mjs" --root .
```

With no output path it writes nothing and returns the tokens, the groups, the sections the design
file lists as `omitted` (not decided yet) and any problems: a reference to a token that does not
exist, a colour that does not read as one, two tokens that would export under the same name.

- **Problems**: stop and show them. They are fixed in `DESIGN.md`, by its owner; do not export
  around them and do not correct a value yourself.
- **No tokens**: say which sections are still omitted and that there is nothing to export yet.
  Deciding them is the designer's part of `/project:new`, or `/project:add` with the design
  hand-off. Never invent a palette or a scale to have something to export.

## 2. Where the exports go

Look before asking: an existing generated file (it carries a "Generated from DESIGN.md" line), a
`tokens.css` or `tokens.json`, the stylesheet folder the repo already has, and what
`project/foundation/technical-context.md` says about styling. Propose one path for each format and
ask once. A path that holds a hand-written file is refused by the script; pick another, never
overwrite it.

## 3. Export

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/tokens.mjs" --root . --css <path> --json <path>
```

| Group in DESIGN.md | Custom property | Example |
|---|---|---|
| `colors` | `--color-<name>` | `--color-on-primary` |
| `typography` | `--type-<style>-<property>` | `--type-h1-font-size` |
| `spacing` | `--space-<name>` | `--space-md` |
| `rounded` | `--rounded-<name>` | `--rounded-sm` |
| `motion`, any other group | `--<group>-<name>` | `--motion-fast` |

A reference such as `{colors.primary}` becomes `var(--color-primary)` in the CSS and stays a
reference in the JSON. `components` in the design file is guidance for people and agents, not
tokens, and is not exported.

If the repo already uses other names for the same values, say so and list the pairs; renaming the
code's variables is a change to the code that the tech lead decides, not something this skill does
on the way.

## 4. Check

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/tokens.mjs" --root . --css <path> --json <path> --check
```

Exits 1 when an export is missing or differs from the design file. That one line is the pipeline
step; offer it when the repo has CI, and add it only on a yes. When a check fails, the fix is to
export again, unless someone edited the generated file: then the edit belongs in `DESIGN.md`
first, through `/project:add`.

## 5. Record

The export is generated, so it needs no change record of its own. A token that *changed* does: that
change is made in `DESIGN.md` with `/project:add` or `/project:decide`, and this skill runs after
it. In a git repo, commit the exports with the change that caused them; do not push without being
asked.

## Rules

- `DESIGN.md` is the source. Never edit a generated file, and never change a token here.
- Never overwrite a file this skill did not generate.
- No tokens from a screenshot, a brand guess or another project.
