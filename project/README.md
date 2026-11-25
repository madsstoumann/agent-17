# Project

A small set of structured markdown files for a project, and the skills that fill them and keep them true, so PMs, designers, developers, QA and the client work from the same thing. This folder is its own plugin, `project`, beside the audits in [`skills/`](../skills/) and the memory setup in [`memory/`](../memory/).

**Early versions.** `/project:new` has been run on an established repo and on a blank one with simulated answers; `add`, `decide`, `status` and `report` are built and tested against an invented project. The ten skills added after them have tested scripts and have not been run on a project yet. Two of them, `component` and `sync`, are **untested**: they need a design tool and a tracker, and neither was available when they were written. The plan and the research behind it are in [docs/](docs/README.md).

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
| [new](skills/new/SKILL.md) | Writes the starting set into a project (`AGENTS.md` with rules only, product context, technical context, experience, boundaries, `DESIGN.md`, plus an index, a state file and a decision list the scripts keep), reads what the repo and any briefs or transcripts already say, then interviews each role on what is missing, one question at a time, writing every answer into the file that owns it. Stops after any answer and resumes later. | `/project:new` in the project's repo · `--size small\|medium\|large` · `--kind client\|product\|library` · `--role designer` for one role's questions · `--from kickoff.txt` for a brief or transcript · run it again to continue |
| [add](skills/add/SKILL.md) | Takes a sentence, a document or a meeting transcript and files each part where it belongs: answers to open questions, changes to what a file says, decisions, new questions. A wording fix is written straight through; a reversal or a boundary gets questions and the owner's yes. One change record per input. Adds a file only when a subject calls for one (a second theme, motion, an integration), and offers the follow-ups for the audits. | `/project:add "what is new"` · `--from notes.txt` for a file or transcript · `--dry-run` to see the plan only |
| [decide](skills/decide/SKILL.md) | Records a decision as one change record: context, the options weighed, the choice, the reason and who made it. Marks the decision it replaces as superseded, updates the project files it changes, closes the interview questions it settles, and can hold a decision open until the person who decides says yes. | `/project:decide "what was decided"` · `--propose` for one still open · `--accept NAME` · `--reject NAME` · `--list` |
| [status](skills/status/SKILL.md) | Says where the project stands from its files alone: phase, what each role still owes, what waits on a decision or a person, files going stale or outgrowing their budget, paths a file names that are gone, and the last changes. Moves the project to its next phase when the team says so. | `/project:status` · `--role designer` for one role · `--phase planning` to move on |
| [report](skills/report/SKILL.md) | Writes a report from the project's files and change records, one per reader: what was decided and why, what changed, what is waiting and on whom, and what is needed from the reader. Plain and short for a client, by role for a PM, by file and follow-up for the tech team. Saved in the project, so the next one can say what moved. | `/project:report --for client` · `--for pm,tech` for several · `--since 7d` for a period; without it, an outline of the project as it stands |
| [tokens](skills/tokens/SKILL.md) | Exports the tokens in `DESIGN.md` as CSS custom properties and a design-tokens JSON file, and checks that exports on disk still match. `DESIGN.md` stays the source; a generated file is never edited, and a hand-written one is never overwritten. | `/project:tokens --css src/tokens.css --json src/tokens.json` · `--check` for a pipeline |
| [timeline](skills/timeline/SKILL.md) | Keeps the milestones in one file: what is due, when, and which role owns it. A date that moves keeps the date it had, with the reason in a change record. Status and reports read it. | `/project:timeline` for what is next and late · `add "Launch" --date 2027-02-01 --owner pm` · `move`, `done`, `drop` |
| [pr](skills/pr/SKILL.md) | Writes a pull request description from the change records and files a branch holds, checked against the project's pull request rules and boundaries. Flags a project file changed with no record. Opens the pull request only when asked. | `/project:pr` · `--base main` · `--open` to open it as a draft |
| [meeting](skills/meeting/SKILL.md) | `add` with a meeting as its input: who was there and in which role, what was decided as opposed to wished for, dates for the timeline, and tasks listed for the tracker instead of written into the files. | `/project:meeting --from kickoff.txt` or paste the notes |
| [check](skills/check/SKILL.md) | The check the other skills run when they finish, on its own: headers, owners, budgets, secrets, review dates, versions against change records. Rebuilds only what is generated; everything else is reported with what puts it right. | `/project:check` · `--fix` to rebuild generated files · `--ci` to add it to a pipeline |
| [phase](skills/phase/SKILL.md) | The phase part of `status` under its own name: shows what is left open in the phase being left, moves the project, names the files and audits the new phase usually calls for, and records the move. | `/project:phase` for the current one · `/project:phase design` to move |
| [grill](skills/grill/SKILL.md) | Questions one file, plan or proposal for what it assumes, leaves undefined, contradicts or cannot test. One question at a time, nothing asked that the files answer, each answer written where it belongs. | `/project:grill technical-context` · `--role tech-lead` · `--rounds 2` |
| [onboard](skills/onboard/SKILL.md) | A one-page way into the project for one role: the project in a paragraph, what to read in which order, the rules that role can break, the decisions a newcomer would trip over, and what is open for them. | `/project:onboard --role frontend` · `--save` to keep the page |
| [component](skills/component/SKILL.md) | **Untested.** Writes one guidance file per component under `building-blocks/components/`: purpose, anatomy, variants, states, tokens by name, behaviour, accessibility. From a design tool when one is connected, or a screenshot, the code or a description. | `/project:component button --from button.png` |
| [sync](skills/sync/SKILL.md) | **Untested.** Turns open questions, proposed decisions and milestones into tracker items, shows the full list before touching the tracker, and offers closed items back as answers. | `/project:sync --dry-run` first · `--tracker NAME` · `--role ROLE` |

Five of these are the core (`new`, `add`, `decide`, `status`, `report`). `meeting`, `check`, `phase` and `grill` are those five under the names people reach for; they follow the same steps and scripts. Still planned: memory setup as the last step of `new`, and a Tailwind theme and per-breakpoint formulas in the token export. See [docs/README.md](docs/README.md#commands).

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
| `project/foundation/timeline.md` | `timeline.mjs` | Milestones, added with the first date someone gives |
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
| `scripts/tokens.mjs --root DIR [--css PATH] [--json PATH] [--check]` | The tokens in `DESIGN.md` as custom properties and design-tokens JSON; `--check` exits 1 when an export has drifted |
| `scripts/timeline.mjs --root DIR` | The milestones, the next one and those past their date; `--add NAME --date D --owner ROLE` and `--set NAME --date D\|--status S` change them |
| `scripts/pr.mjs --root DIR [--base BRANCH]` | The change records and files a branch adds against its base, and a project file changed without a record |
| `scripts/build.mjs --root DIR [--check]` | Rebuilds versions, changelogs, decisions and the index |

Tests: `cd project/scripts && node --test test/*.test.mjs`.

## No client data

Templates hold `{{placeholders}}` only, the tests use one invented project, and a test fails on an undocumented placeholder, an email address or a host that is not on its short list. Tests, changelogs and pull requests follow [CONTRIBUTING.md](../CONTRIBUTING.md): no real projects, no real sites.

## Versioning

As in [skills/README.md](../skills/README.md#versioning): semver in each `SKILL.md` under `metadata.version`, a `CHANGELOG.md` beside it, both changed in the same commit as the skill. One difference: a skill here starts at `0.1.0` and moves to `1.0.0` after it has run on a real project.
