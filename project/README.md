# Project

A small set of structured markdown files for a project, and the skills that fill them and keep them true, so PMs, designers, developers, QA and the client work from the same thing. This folder is its own plugin, `project`, beside the audits in [`skills/`](../skills/) and the memory setup in [`memory/`](../memory/).

**Early versions.** `/project:new` has been run on an established repo and on a blank one with simulated answers; `/project:add`, `/project:decide`, `/project:status` and `/project:report` are built and tested against an invented project. The plan for the rest, and the research behind it, is in [docs/](docs/README.md).

## Install

```text
/plugin marketplace add madsstoumann/agent-17
/plugin install project@agent-17
```

On claude.ai, add the `agent-17` marketplace under [Customize > Plugins](https://claude.ai/customize/plugins) and add **project**. Skills run as `/project:<name>`.

The skills share the scripts in `scripts/`, so install the plugin; copying one skill folder is not enough.

### What comes with it

| Plugin | Installed with `project`? | Why |
|---|---|---|
| `memory` | Yes, in Claude Code: it is a declared dependency, so it is installed and enabled alongside. On claude.ai, add **memory** yourself; whether dependencies resolve there is not confirmed | The project files follow the memory store's rules, and the weekly dream reviews them |
| `skills` (the audits) | No | The project skills only propose things to the audits. Install it where the audits will run; without it, a hook that would have fired is reported and skipped |

## Contents

**Keep this list current.** A pull request that adds, removes or renames a skill here, or changes what it does or how it is called, updates this table in the same PR.

| Skill | What it does | How to use it |
| --- | --- | --- |
| [new](new/SKILL.md) | Writes the starting set into a project (`AGENTS.md` with rules only, product context, technical context, experience, boundaries, `DESIGN.md`, plus an index, a state file and a decision list the scripts keep), reads what the repo and any briefs or transcripts already say, then interviews each role on what is missing, one question at a time, writing every answer into the file that owns it. Stops after any answer and resumes later. | `/project:new` in the project's repo · `--size small\|medium\|large` · `--kind client\|product\|library` · `--role designer` for one role's questions · `--from kickoff.txt` for a brief or transcript · run it again to continue |
| [add](add/SKILL.md) | Takes a sentence, a document or a meeting transcript and files each part where it belongs: answers to open questions, changes to what a file says, decisions, new questions. A wording fix is written straight through; a reversal or a boundary gets questions and the owner's yes. One change record per input. Adds a file only when a subject calls for one (a second theme, motion, an integration), and offers the follow-ups for the audits. | `/project:add "what is new"` · `--from notes.txt` for a file or transcript · `--dry-run` to see the plan only |
| [decide](decide/SKILL.md) | Records a decision as one change record: context, the options weighed, the choice, the reason and who made it. Marks the decision it replaces as superseded, updates the project files it changes, closes the interview questions it settles, and can hold a decision open until the person who decides says yes. | `/project:decide "what was decided"` · `--propose` for one still open · `--accept NAME` · `--reject NAME` · `--list` |
| [status](status/SKILL.md) | Says where the project stands from its files alone: phase, what each role still owes, what waits on a decision or a person, files going stale or outgrowing their budget, paths a file names that are gone, and the last changes. Moves the project to its next phase when the team says so. | `/project:status` · `--role designer` for one role · `--phase planning` to move on |
| [report](report/SKILL.md) | Writes a report from the project's files and change records, one per reader: what was decided and why, what changed, what is waiting and on whom, and what is needed from the reader. Plain and short for a client, by role for a PM, by file and follow-up for the tech team. Saved in the project, so the next one can say what moved. | `/project:report --for client` · `--for pm,tech` for several · `--since 7d` for a period; without it, an outline of the project as it stands |

Planned next: memory setup as the last step of `new`, token export, a timeline and tracker sync. See [docs/README.md](docs/README.md#commands).

## What a project gets

| File | Written by | Holds |
|---|---|---|
| `AGENTS.md` | people | Rules only, and a pointer to the files below |
| `project/foundation/product-context.md` | people | What the project is and why |
| `project/foundation/technical-context.md` | people | Constraints, hosting, existing systems, reasons |
| `project/intent/experience.md` | people | Goal, audiences, principles |
| `project/intent/boundaries.md` | people | Must, must not, compliance, out of scope |
| `project/building-blocks/DESIGN.md` | people | Direction and tokens, in [Google's DESIGN.md format](https://github.com/google-labs-code/design.md) |
| `project/INDEX.md`, `project/memory/decisions.md` | `build.mjs` | Every file with its owner, version and open questions; the decisions |
| `project/memory/state.md` | `scaffold.mjs`, `answer.mjs` | Phase, size and the interview's questions |
| `project/memory/changes/` | the skills | One record per change; versions and changelogs are built from these |

The rules for these files are in [references/files.md](references/files.md), change records in [references/changes.md](references/changes.md), the interview method in [references/interviewing.md](references/interviewing.md).

## Scripts

Zero-dependency Node 18+. Each answers `--help` and prints JSON.

| Script | Does |
|---|---|
| `scripts/scaffold.mjs --root DIR --name NAME [--size S] [--kind K] [--date D] [--dry-run]` | Writes the starting set; never overwrites |
| `scripts/check.mjs --root DIR [--console] [--today DATE]` | Lints headers, budgets, secrets and generated views; counts open questions per role; exit 1 on an error. Use it in CI |
| `scripts/check.mjs --root DIR --next` | The questions that can be asked now |
| `scripts/answer.mjs --root DIR --id Q --status answered\|skipped\|parked\|open [--note T]` | Records a question's outcome; `--add ID --file KEY --role ROLE --ask TEXT` adds one |
| `scripts/record.mjs --root DIR --slug S --title T --asked-by ROLE [--bumps file:level,...] [--decision D] [--supersedes NAME]` | Creates a change record; `--set NAME --status applied\|rejected [--decision accepted]` moves one along; `--list` |
| `scripts/file.mjs --root DIR --path project/F/NAME.md --description T --owner ROLE [--parent KEY]` | Adds one written file with the standard header; `--sizes` lists every file against its budget |
| `scripts/status.mjs --root DIR [--console] [--today DATE] [--stale-days N]` | Phase, open questions per role, what is waiting, stale files, budgets, missing paths, last changes; `--phase P` sets the phase |
| `scripts/report.mjs --root DIR --for client\|pm\|tech [--since 7d]` | The facts a report is written from, selected for that reader and period |
| `scripts/build.mjs --root DIR [--check]` | Rebuilds versions, changelogs, decisions and the index |

Tests: `cd project/scripts && node --test test/*.test.mjs`.

## No client data

Templates hold `{{placeholders}}` only, the tests use one invented project, and a test fails on an undocumented placeholder, an email address or a host that is not on its short list. Tests, changelogs and pull requests follow [CONTRIBUTING.md](../CONTRIBUTING.md): no real projects, no real sites.

## Versioning

As in [skills/README.md](../skills/README.md#versioning): semver in each `SKILL.md` under `metadata.version`, a `CHANGELOG.md` beside it, both changed in the same commit as the skill. One difference: a skill here starts at `0.1.0` and moves to `1.0.0` after it has run on a real project.
