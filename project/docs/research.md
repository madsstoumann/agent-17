# Research

What the plan was tested against on 2026-11-25, and what each source changed. Read level is stated per source; treat anything not marked "read" as a lead to check before a skill quotes it.

## Evidence

| Source | Read | Finding | Change to the plan |
|---|---|---|---|
| [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) (ETH Zurich) | abstract | Context files did not generally improve task success and raised inference cost by over 20%. Instructions were followed; repository overviews did not help | `AGENTS.md` holds rules only; the index is generated and loaded by the skills |
| [Atlassian's DESIGN.md test](https://www.atlassian.com/blog/how-we-build/atlassians-design-md-is-here-what-we-learned-testing-portable-design-context-in-practice) | full | As the only design context: about 92% more tokens and about 30% design-system use, against about 80% for guidance fetched on demand. Agents re-created components instead of importing them. Lint rules cost no tokens. One task, described by its authors as not conclusive | `DESIGN.md` holds direction and tokens under a size budget; component guidance loads on demand and names the import; enforceable rules become lint |
| [Understanding spec-driven development](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) (Böckeler) | full | One workflow for every size (a small bug became 4 stories and 16 criteria); many markdown files are a review burden; agents do not follow every instruction; unclear who a document is for | Depth follows size; people review one change record; one accountable role and one audience per file |
| [Thoughtworks Radar: spec-driven development](https://www.thoughtworks.com/radar/techniques/spec-driven-development) | full | "Assess". Workflows are elaborate and opinionated; hand-written detailed rules for AI may not scale | Five commands; triggers are guidance, not hard-coded rules |
| [Limitations of BMAD Method](https://asantos2000.github.io/blog/post-3/) | partly a summary | Strict phase order; 50+ commands; agents that do not update all artifacts | Phases set focus, not locks; drift checks |
| [Claude Code memory docs](https://code.claude.com/docs/en/memory) | full | `AGENTS.md` is read natively from v2.1.277, by default only when no `CLAUDE.md` exists | No `CLAUDE.md` in the scaffold |

## Prior art

| System | Read | What it does | Taken |
|---|---|---|---|
| [Conductor](https://github.com/gemini-cli-extensions/conductor) (Google) | announcement, README | Setup interview writes `product.md`, `product-guidelines.md`, `tech-stack.md`, `workflow.md`; work happens in tracks (`spec.md`, `plan.md`); state in files so work resumes; reads an existing codebase first; syncs context when a track ends | Reading what exists before asking; confirmation that the foundation split is sound |
| [AI-DLC](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/) (AWS) | two posts | "Mob elaboration": the whole team validates the AI's questions and proposals; the workflow adapts which stages run and how deep | The Context room; adaptive depth |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | README, concepts | Current truth in `specs/`, each change in its own folder with deltas (added, modified, removed), merged and archived on approval | The change record |
| [grill-me](https://www.aihero.dev/skills-grill-me), [wayfinder](https://www.aihero.dev/skills-wayfinder) (Matt Pocock) | full | Interview in rounds over the frontier of answerable questions; a map of decisions, open questions and what is out of scope; questions talk cannot settle become prototypes | The interview mechanics and `state.md` |
| GSD | one page | Size limits per file enforced by checks; a state file as cross-session memory | Size budgets; `state.md` |
| [DESIGN.md](https://github.com/google-labs-code/design.md) (Google) | spec, README | Prose plus YAML tokens; groups for themes and breakpoints; `@file` references; a CLI that lints and exports to W3C tokens and Tailwind | The format of `DESIGN.md` and the export |
| GitHub Spec Kit, Kiro, Cline Memory Bank, Taskmaster, ADR/MADR, arc42, C4 | not read this round | Developer spec workflows, always-loaded context files, decision records, architecture outlines | Decision fields; architecture outline |

## Not covered by any source

Staleness is the gap everywhere: none of these systems says how files stay true after the first month. The plan's answer (generate what can be derived, check what can be compared, report what nobody reads) is untested. So are the mixed-team parts. The pilot exists to find out.
