# Project

A small set of structured markdown files for a project, and the skills that fill them and keep them true, so PMs, designers, developers, QA and the client work from the same thing. This folder is its own plugin, `project`, beside the audits in [`skills/`](../skills/) and the memory setup in [`memory/`](../memory/).

**First version.** `/project:new` and its scripts are built and tested against an invented project; nothing here has run on a real one yet. The plan for the rest, and the research behind it, is in [docs/](docs/README.md).

## Install

```text
/plugin marketplace add madsstoumann/agent-17
/plugin install project@agent-17
```

On claude.ai, add the `agent-17` marketplace under [Customize > Plugins](https://claude.ai/customize/plugins) and add **project**. Skills run as `/project:<name>`.

The skills share the scripts in `scripts/`, so install the plugin; copying one skill folder is not enough.

## Contents

**Keep this list current.** A pull request that adds, removes or renames a skill here, or changes what it does or how it is called, updates this table in the same PR.

| Skill | What it does | How to use it |
| --- | --- | --- |
| [new](new/SKILL.md) | Writes the starting set into a project (`AGENTS.md` with rules only, product context, technical context, experience, boundaries, `DESIGN.md`, plus an index, a state file and a decision list the scripts keep), reads what the repo and any briefs or transcripts already say, then interviews each role on what is missing, one question at a time, writing every answer into the file that owns it. Stops after any answer and resumes later. | `/project:new` in the project's repo · `--size small\|medium\|large` · `--role designer` for one role's questions · `--from kickoff.txt` for a brief or transcript · run it again to continue |

Planned, in this order: `add` (a prompt, file or transcript becomes one change record), `decide`, `status`, `report`. See [docs/README.md](docs/README.md#commands).

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
| `scripts/scaffold.mjs --root DIR --name NAME [--size S] [--dry-run]` | Writes the starting set; never overwrites |
| `scripts/check.mjs --root DIR [--console] [--today DATE]` | Lints headers, budgets, secrets and generated views; counts open questions per role; exit 1 on an error. Use it in CI |
| `scripts/check.mjs --root DIR --next` | The questions that can be asked now |
| `scripts/answer.mjs --root DIR --id Q --status answered\|skipped\|parked\|open [--note T]` | Records a question's outcome; `--add ID --file KEY --role ROLE --ask TEXT` adds one |
| `scripts/build.mjs --root DIR [--check]` | Rebuilds versions, changelogs, decisions and the index |

Tests: `cd project/scripts && node --test test/*.test.mjs`.

## No client data

Templates hold `{{placeholders}}` only, the tests use one invented project, and a test fails on an undocumented placeholder, an email address or a host that is not on its short list. Tests, changelogs and pull requests follow [CONTRIBUTING.md](../CONTRIBUTING.md): no real projects, no real sites.

## Versioning

As in [skills/README.md](../skills/README.md#versioning): semver in each `SKILL.md` under `metadata.version`, a `CHANGELOG.md` beside it, both changed in the same commit as the skill. One difference: a skill here starts at `0.1.0` and moves to `1.0.0` after it has run on a real project.
