# solution-health skill

Copy the `.claude/` folder into the root of a solution repo (merge with an existing `.claude/` if there is one) and commit it. Everyone who opens the repo in Claude Code gets the skill.

First run: ask Claude "run the solution health check". It will scan the code for outbound hosts, propose `.solution-health/manifest.json` (see `templates/manifest.example.json` — DAWA is the worked example), and ask you to confirm before writing it.

Add to `.gitignore`:

    .solution-health/run/

Commit the rest of `.solution-health/` (manifest, state, snapshots, report) so the next run, and the next developer, can see what changed.

Requires Node 18+. Uses npm and the dotnet SDK when they are installed.

## Status

Written and tested 21–29 Oct 2026 against a fixture solution and a mock provider; see `scripts/test/skill-test.md`.
The api.nuget.org and endoflife.date parsers were checked against the live services. The packages.ecosyste.ms and
api.deps.dev parsers were written from documentation and have not been verified against live responses: if a real
run shows "Maintained = ?" for every package, start there (`scripts/packages.mjs` → `healthFacts()`).
npms.io is deliberately not used; its data has been stale for years.

Run the test: `node --test scripts/test/solution-health.test.mjs`
