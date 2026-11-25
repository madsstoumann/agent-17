# Project skills: the plan

Status: plan, second version (2026-11-25). Built so far: the templates, the scripts and `/project:new` (see [../README.md](../README.md)). The rest is still a plan. This folder is the design record for a third plugin in this repo, `project`, beside [`skills/`](../../skills/) and [`memory/`](../../memory/).

| Doc | Holds |
|---|---|
| This file | What the plugin is, the files it manages, the commands, how it is tested |
| [file-map.md](file-map.md) | Every file, who is accountable, which phase touches it, what triggers the optional ones |
| [research.md](research.md) | The evidence and prior art the plan was tested against, and what each changed |
| [artifacts/](artifacts/) | The published artifacts as standalone pages, each with a picture GitHub can show (the interactive file map) |

`docs/` is for people and for sessions that work on the plugin. Skills never load it; what a skill needs at run time goes in `references/` once the plugin exists.

**No client data, ever.** Templates hold `{{placeholders}}` only, examples use one invented project, and a test will fail on anything else. The same rule as CONTRIBUTING.md's "no real sites in this repo".

## What it is

A set of skills that give a project a small folder of structured markdown, keep it true as the project moves, and let every role work on it: PMs, designers, developers, QA and the client. The skills interview people, write the answers into the file that owns them, record each change once, and tell the audit skills when something they should watch has appeared.

What exists elsewhere covers developers only (see [research.md](research.md)). The parts that are new here, and therefore unproven: roles beyond developers, the client in the loop, phases with client outputs, non-technical members through the Claude app, and hooks into the audits.

## Principles

1. **Start with six files.** Add a file only when something triggers it.
2. **Instructions, not overviews, in what loads every session.** `AGENTS.md` holds rules and non-standard practices. The index is generated and loaded only by the skills.
3. **Derive, don't ask.** What the repo or a transcript already says is read, never grilled: stack from the manifests, the component index from the component folder, integrations from the hosts the code calls.
4. **One record per change.** People review one page; file versions and changelogs are generated from it.
5. **Depth follows size.** A wording fix writes straight through. Only a change to a boundary, a token others rely on or the architecture gets the full interview.
6. **One accountable role per file,** and one stated audience.
7. **Check claims against reality.** A file that describes the code is compared with the code.
8. **Phases set focus, not locks.** Any file can change in any phase.
9. **Sit above the feature workflow.** Spec, plan and tasks per feature stay with whatever the team uses.

## The starting set

`/project:new` writes six files for people and keeps three itself.

| File | Kind | Holds | Accountable |
|---|---|---|---|
| `AGENTS.md` | written | Rules and non-standard practices, one line pointing to the project skills | Tech lead |
| `project/foundation/product-context.md` | written | What the project is and why: business context, client goals, success measures | PM |
| `project/foundation/technical-context.md` | written, living | Constraints, hosting, existing systems, choices and their reasons | Tech lead |
| `project/intent/experience.md` | written, living | Goals, principles, audiences, the experience to give | Experience lead |
| `project/intent/boundaries.md` | written, living | Must, must not, compliance, out of scope | PM |
| `project/building-blocks/DESIGN.md` | written, living | Direction and tokens in [Google's DESIGN.md format](https://github.com/google-labs-code/design.md), under a size budget | Designer |
| `project/INDEX.md` | generated | Every project file with owner, audience and version | script |
| `project/memory/state.md` | kept by the skills | Phase, position, blockers, open questions per role | skills |
| `project/memory/decisions.md` | kept by the skills | One line per standing or open decision | skills |

"Living" files are not owned by one phase; they are updated in every one.

No `CLAUDE.md` is written. Claude Code reads `AGENTS.md` natively (v2.1.277 and later), by default only when no `CLAUDE.md` exists. Where a repo already has a `CLAUDE.md`, the skill adds `@AGENTS.md` to it instead.

Everything else is in [file-map.md](file-map.md).

## The file header

```yaml
---
name: design
description: Direction and tokens for every surface
metadata:
  type: project
  version: "1.4.0"
  status: active            # draft | active | superseded
  audience: people-and-agents
  owner: designer
  contributors: [frontend]
  depends_on: [experience, boundaries]
  open: []                  # ids of grill questions still unanswered
  changelog: memory/changelog/design.md
  review_by: 2027-02-25
---
```

Extra keys sit under `metadata:` for the same reason as in the [memory store format](../../memory/enable-memory-management/references/store-format.md). `version`, the changelog file it points to and `INDEX.md` are written by a script from the change records, never by hand. Version meaning: major when something others rely on changes or goes, minor when something is added, patch for wording.

`DESIGN.md` uses a top-level `version: alpha` for its spec version. Whether Google's linter accepts our `metadata` block without a warning is not yet tested; if it warns, `DESIGN.md` gets a sidecar `DESIGN.meta.yaml`.

## Changes and decisions

Each change is one file, `project/memory/changes/<date>-<slug>.md`:

| Part | Holds |
|---|---|
| Asked | The prompt, transcript or meeting it came from, and who asked |
| Why | The reason, in the person's words |
| Deltas | Per file: added, modified, removed, as short before and after lines |
| Decision | Context, options, the choice, who decided, what it supersedes; empty for a plain edit |
| Hooks | What was proposed to the audits |

A change is proposed, reviewed by the accountable roles of the files it touches, then applied. `decisions.md`, the per-file changelogs and `CHANGELOG.md` are views built from these records.

## Commands

| Command | What it does |
|---|---|
| `/project:new` | Scaffold, read what exists, interview on the gaps, fill. Run again later to resume |
| `/project:add` | Take a prompt, a file or a meeting transcript; size the change; interview if needed; write one change record and apply it; run the hooks |
| `/project:decide` | Record a decision and follow `depends_on` to the files it changes |
| `/project:report` | Outline the project now or over a period, `--for client`, `--for pm`, `--for tech`, one or several |
| `/project:status` | Phase, open questions per role, stale and unread files, drift between files and code |

Those five are the core. Ten more were added on request, against this plan's own advice to keep the list short, so each is either a real gap or one of the five under the name people reach for:

| Command | What it is |
|---|---|
| `/project:tokens` | New: exports `DESIGN.md` tokens as custom properties and design-tokens JSON, and checks for drift |
| `/project:timeline` | New: milestones in one file, moved dates kept |
| `/project:pr` | New: a pull request description from the branch's change records |
| `/project:meeting` | `add`, with a meeting as the input |
| `/project:check` | The check every skill runs when it finishes |
| `/project:phase` | The phase part of `status` |
| `/project:grill` | The interview method of `new`, pointed at one file or plan |
| `/project:onboard` | A reading order and an outline for one role |
| `/project:component` | New and **untested**: one guidance file per component; needs a design tool to prove |
| `/project:sync` | New and **untested**: questions, decisions and milestones to a tracker; needs a tracker to prove |

If the aliases turn out to split people's habits instead of matching them, they are the first to go. The weekly client report is `/project:report --for client --since 7d` on a schedule. The weekly dream is the memory plugin's, with steering that also proposes files to split, merge or retire.

### How /project:new runs

1. **Size.** Ask how large the project is; that sets how many questions and which optional files are offered.
2. **Scaffold.** Write the folders and the starting set as skeletons, `status: draft`.
3. **Read.** An existing repo, kick-off transcripts and briefs are read first and used to pre-fill, with the source quoted.
4. **Interview.** Rounds in the style of grill-me and wayfinder: each round asks every question whose prerequisites are answered, one at a time, with a suggested answer, to the role that owns it. Questions talk cannot settle are parked, not guessed.
5. **Write as you go.** Each answer is written before the next question. `state.md` holds answered, skipped, parked and open.
6. **Stop any time.** Running the command again reads `state.md` and the `open` lists, says what is left per role and continues.
7. **Wire up memory.** Run the memory plugin's setup so project files and agent memory follow one set of rules.

### Phases

| Phase | In the room | Client output |
|---|---|---|
| 1 Context | PM, client, designers, developers together | Project brief |
| 2 Planning | Tech team, then design and PM | Plan and timeline |
| 3 Design | Designers with frontend | Design system overview |
| 4 Dev | Developers | Weekly report, decision log |
| 5 QA | QA with developers and designers | QA report from the audits |
| 6 Release | Tech lead and PM | Release notes, launch audit |

Context is the scaffolding phase: the kick-off is recorded, the skill drafts from it, and the combined team corrects the draft and answers the gaps.

## Hooks into the audits

The project skill proposes; a developer approves. It never writes an audit's own state.

| When | Project file | Proposed to |
|---|---|---|
| A new external API, CMS or data source | `tech/integrations.md` | An entry for [audit-solution-health](../../skills/audit-solution-health/SKILL.md)'s `manifest.json` (hosts, watch pages, a safe GET probe, owner role, keys as `$ENV_NAME`) |
| Third-party scripts, cookies, analytics | `intent/boundaries.md` | audit-privacy in the QA cadence |
| An accessibility level or law; a new theme | `design/accessibility.md`, `design/themes.md` | audit-a11y per theme |
| A staging or public URL | `tech/environments.md` | audit-launch, audit-infra, audit-security site mode |
| Release phase | `tech/release.md` | audit-all, then audit-fix |

## Design tokens

`DESIGN.md` holds direction and tokens only. Component guidance lives in `components/<name>.md`, loaded when that component is the task, and each names the real component to import. A rule that can be enforced becomes a lint rule.

The interview asks where tokens originate: `DESIGN.md`, the design tool or code. The other forms are generated from that one: [W3C design tokens](https://www.designtokens.org/tr/2025.10/) JSON, a Tailwind 4 `@theme` file or plain custom properties.

`/project:tokens` covers the first and the last of these today: design-tokens JSON and plain custom properties. The Tailwind theme and the per-breakpoint formulas below are not built.

Neither format holds a formula. A rule such as "page margin is the spacing unit times a multiplier that grows with the breakpoint" is stored as its inputs (`spacing.unit`, a `margin-multiplier` per breakpoint group), stated in words in the Layout section, and multiplied in the generated CSS with `calc()` inside a media query per breakpoint. Google's exporter does not write those media queries, so the plugin's own export must.

## Repo and Claude app

The repo is the only source of truth. In the repo, a skill run is a branch and a pull request. In a Claude app Project with the repo attached, the same run opens the pull request from its thread; the people accountable see the change record, not a diff, and say yes there. Schedules (dream, client report, solution-health) run as scheduled tasks in either place.

Two sessions writing the same file is the known risk: the skill re-reads the file and its version right before writing and rebases when it moved, the same rule as the memory plugin's hash-before-write.

## Testing

One invented project, made by the tests in a temporary folder, never a real one. Each test names what must be true afterwards, so it can fail.

| # | Test | Passes when |
|---|---|---|
| 1 | `/project:new` on an empty repo, answers from a script | Six written files and three kept files exist, headers lint, nothing outside the placeholders' answers appears |
| 2 | Stop after round two, run again | No question is asked twice; `state.md` matches the files' `open` lists |
| 3 | `/project:new` on the example repo with code and a transcript | Stack, components and integrations are pre-filled with sources; questions cover only gaps |
| 4 | `/project:add` with a wording fix | No interview, one change record, patch bump |
| 5 | `/project:add` "the client wants dark mode" | Designer is interviewed; `design/themes.md` appears; one change record lists every delta; contrast lint runs per theme |
| 6 | `/project:add` a component that calls an external API | A solution-health manifest entry is proposed, not written |
| 7 | Build a component from a description | See below |
| 8 | Edit the code so a file is wrong | `/project:status` reports the drift |
| 9 | `/project:report` for each audience | The client version names no internals; every claim links a change record |
| 10 | Any template or example | The no-client-data test passes |

### Building a component from a description

The goal: the component is defined in the design tool or the design system, someone describes what they want, and the system builds it and writes `components/<name>.md`.

What it needs: tokens already in `DESIGN.md` (or generated from the design tool), a connection to the design tool that can read a component's structure, variants and variables, and a component folder in the repo with at least one existing component to follow.

| Step | Check |
|---|---|
| Read the component from the design tool, or its entry in the design system | Variants and the variables it uses are listed before any code is written |
| Map every value to a token | No raw colour, size or duration in the result; an unmapped value stops the run with a question |
| Reuse before building | Existing components are imported, not re-created |
| Build in the repo's stack, following an existing component | Lint and type checks pass |
| Compare a render with the design | A screenshot per variant and theme, differences listed for a person to judge |
| Write `components/<name>.md` and the change record | Purpose, variants, tokens used, import path, design-tool link, accessibility notes |

How well this works depends on the design file: components built with variables and named variants map cleanly, free-form frames do not. That is what the first pilot should measure.

## Build order

1. `references/` (interviewing, file map, header, hooks), `templates/`, the header lint, the script that builds versions, changelogs and the index from change records. Tests 1, 4, 10.
2. `new` with resume and reading existing repos; `add`; `decide`. Tests 2, 3, 5, 6.
3. `status` with drift checks; `report`. Tests 8, 9.
4. Component building. Test 7.
5. A pilot on one real project, outside this repo, with what counts as failure written down first: owners not answering their questions, files nobody reads, change records nobody reviews.

Plugin layout, following `memory/`:

```text
project/
  .claude-plugin/plugin.json
  README.md
  docs/                 this folder
  references/           what the skills load
  templates/            skeletons, {{placeholders}} only
  new/ add/ decide/ report/ status/    SKILL.md + CHANGELOG.md each
  scripts/              zero-dependency Node, with tests, shared by the skills
```

The scripts are shared: skills call them as `${CLAUDE_SKILL_DIR}/../scripts/`, so these skills install as the plugin, not one folder at a time.

## Open questions

- Write our own interviewing reference in the style of grill-me and wayfinder, or depend on those skills being installed? (Proposed: our own.)
- Should the client be able to answer questions and comment, or read reports only?
- Which tracker first for sync: Jira, Linear or GitHub issues?
- `project/` folder in the project's repo, or the files at the root?
- Which design tool connection does component building target first?
