# To do

Open points from the sanity check of every skill on main (2026-11-10, after #47, #48 and #49). None of them is broken; each needs a decision.

- [ ] **audit-seo archive mode: ai.txt and llms-full.txt follow llms.txt.** Whether the `seo.llms-full` and `seo.ai-txt` rows are skipped depends only on whether llms.txt was archived. An archive that holds ai.txt but not llms.txt skips the ai.txt row, and one with llms.txt but no ai.txt runs it. Decide whether each row should check for its own file (`skills/audit-seo/scripts/lib/offline.mjs`, `seo.mjs`).
- [ ] **audit-launch tuning flags missing from SKILL.md.** `--max-pages`, `--max-external`, `--lighthouse`, `--timeout`, `--concurrency`, `--from`, `--json` and `--quiet` are in `--help` and the root README Parameters, but not in `skills/audit-launch/SKILL.md`. The same applies to `--timeout`/`--quiet` in audit-eco, audit-seo and check-tech-stack, and `--max-tabs`/`--timeout` in audit-a11y. Add them, or decide that SKILL.md lists only what Claude needs.
- [ ] **Plugin install line in the root README.** `claude plugin install skills --marketplace madsstoumann/agent-17` should be checked against the current CLI syntax (`claude plugin install skills@agent-17`).
- [ ] **target-state.mjs count.** skills/README.md ("Report folders") says 9 skills carry `target-state.mjs`. The memory plugin (`memory/enable-memory-management`) is a 10th copy, which its own test checks. Mention it, or leave the README about skills/ only.
- [ ] **audit-solution-health step scripts ignore `--help`.** `discover.mjs`, `packages.mjs`, `runtimes.mjs`, `apis.mjs`, `check.mjs` and `finalize.mjs` run against the current folder when given `--help`. Add a usage line, or leave them as internal steps that only SKILL.md calls.
- [ ] **Old run-folder fallback** (from the docs PR #47): audit-launch SKILL.md and skills/README "Report folders" still describe the fallback for older `<host>-<stamp>/` folders. Remove the docs and code, or keep them.
