# solution-health skill

Copy the `.claude/` folder into the root of a solution repo (merge with an existing `.claude/` if there is one) and commit it. Everyone who opens the repo in Claude Code gets the skill.

First run: ask Claude "run the solution health check". It will scan the code for outbound hosts, propose `.solution-health/manifest.json` (see `templates/manifest.example.json` — DAWA is the worked example), and ask you to confirm before writing it.

Add to `.gitignore`:

    .solution-health/run/

Commit the rest of `.solution-health/` (manifest, state, snapshots, report) so the next run, and the next developer, can see what changed.

Requires Node 18+. Uses npm and the dotnet SDK when they are installed.
