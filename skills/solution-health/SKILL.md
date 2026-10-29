---
name: solution-health
description: Periodic health check of this solution's dependencies and external integrations. Checks npm and NuGet packages (outdated, vulnerable via npm audit / dotnet, deprecated, unmaintained or archived upstream), the NuGet sources and package folders the solution's own NuGet.config resolves to, runtime and framework end-of-life (Node, .NET, Umbraco, Next.js…), and external APIs the code calls (deprecation/sunset headers, shutdown notices on the provider's docs, changelog or status pages, including Danish notices like DAWA's). Keeps a committed manifest and state in .solution-health/ so each run reports what changed since last time. Use whenever someone asks to run the solution or dependency health check, audit dependencies or packages, check for deprecated or abandoned packages, check if an API we use is being shut down or deprecated, do a quarterly maintenance check, or asks "is anything in this project end-of-life?", even if they do not name the skill.
argument-hint: "[--root PATH] [--transitive] [--offline] [--skip packages,runtimes,apis]"
allowed-tools: Bash(node:*), Bash(npm:*), Bash(dotnet:*), Read, Write, Edit, WebFetch, WebSearch
metadata:
  version: "1.1.1"
---

# Solution health check

This skill exists because a site kept calling DAWA (the Danish address API) long after its shutdown was announced on DAWA's own docs page. Nobody read that page. `npm audit` and `dotnet list package --vulnerable` only catch known CVEs. They do not tell you that a package's repo was archived, that a runtime is out of support, or that a government API is closing. This skill covers all of these and remembers what it saw last time, so a dev running it every month or quarter sees what changed.

It is **report only**. Do not change code, upgrade packages or edit lockfiles as part of a run. The only exception is `npm audit fix`, and only when the developer explicitly asks for it (never `--force`). The deliverable is `.solution-health/report.md` plus a short summary in chat.

## Files

Everything lives in `.solution-health/` at the solution root and is committed, except `run/`:

| File | Owner | Purpose |
|---|---|---|
| `manifest.json` | Team (you propose, a dev approves) | External APIs to watch, ignore lists, thresholds. Template: `templates/manifest.example.json` |
| `state.json` | Scripts | Last verdict per item, page hashes, assessments. Diffing this file in a PR shows what changed |
| `snapshots/*.txt` | Scripts | Normalized text of each watched page, used to diff the next run |
| `report.md` | Scripts + you | Latest report. Commit it, so the git history shows when a warning first appeared |
| `run/` | Scripts | Scratch: raw results, HTTP cache, change files. Add `.solution-health/run/` to `.gitignore` |

Scripts are in `scripts/` next to this file. They are zero-dependency Node (18+), so they run on any dev machine with Node, including .NET-only devs. Run them from the solution root, or pass `--root <path>`. The commands below use `${CLAUDE_SKILL_DIR}`, this skill's folder wherever it is installed (`.claude/skills/solution-health/` in the solution, `~/.claude/skills/`, or a plugin); if it is not filled in, use the folder this `SKILL.md` is in. `references/sample-report.md` shows what a finished report looks like.

## Workflow

### 1. Run the checks

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check.mjs"
```

This runs discover → packages → runtimes → apis in order and prints a summary of each. Options: `--transitive` (include transitive packages; noisy, use for audits), `--offline` (no network), `--skip apis` and similar.

If `.solution-health/manifest.json` does not exist, this is the **first run**. Do step 2 before anything else, then run `check.mjs` again.

### 2. First run, or new hosts found: build the API manifest

`discover.mjs` scans config and source for outbound URLs and lists the **untracked hosts**. Hosts marked `high` look like APIs or sit in config keys. These are the candidates for the manifest, and this step is what catches the next DAWA. For each candidate:

1. Work out what it is from the code that calls it (open one or two of the listed files).
2. Find the provider's pages where a shutdown would be announced: the API docs landing page, the changelog or release notes, a deprecations page, the status page or its RSS feed. Use WebSearch/WebFetch. Public-sector Danish providers (Dataforsyningen, Datafordeler, CVR, MitID, NemLog-in, Digital Post, DMI) announce in Danish on their own docs and news pages, so watch those pages, not just an English changelog.
3. Pick a cheap, side-effect-free probe URL (a GET that returns a small response). Never a POST, never anything that sends mail, charges money or writes data. If it needs a key, reference an env var (`"$NAME"`); keys never go in the manifest.
4. If you already know of a deprecation or shutdown, record `status`, `sunset` (ISO date) and `replacement`.

Present the proposed entries to the developer as a short list (name, hosts, watch pages, probe), and write them to `manifest.json` only once they confirm. Hosts that are not integrations (analytics snippets, font CDNs, links in content) go in `hostsIgnore`, also with confirmation. Do not invent watch URLs you have not fetched at least once.

On later runs, only new untracked hosts need this treatment. The report lists them, so the list shrinks over time.

### 3. Read and judge every change file

`apis.mjs` prints a list of change files (`.solution-health/run/changes/*.md`). A change file is written when a watched page changed since the accepted snapshot, or when a page mentions deprecation keywords on first sight. Each file contains the added and removed sentences, plus the sentences that match deprecation keywords in English and Danish.

Read every one. Keyword matching is only a filter: "lukker" also matches a cookie banner, and a real shutdown notice can avoid every keyword ("vi overgår til en ny platform"). For each page, decide:

- `red`: announces a shutdown, removal, forced migration or breaking change that affects how this solution uses the API (check the calling code if in doubt).
- `amber`: an announced deprecation without a date, a new major version with the old one put in maintenance, a pricing or auth change that needs planning.
- `info`: a relevant change that needs no action.
- `benign`: noise (layout, unrelated news, cookie text, dates).

Write the results to `.solution-health/run/assessments.json`, keyed by the watched URL:

```json
{
  "https://dawadocs.dataforsyningen.dk": {
    "verdict": "red",
    "summary": "Banner: DAWA closes 1 July 2026; use Adressevælger or Datafordeleren.",
    "action": "Migrate address autocomplete in src/checkout/address.ts to Adressevælger before the shutdown date."
  }
}
```

Quote the notice's own words (translated if Danish) in `summary`, include the date if one is given, and make `action` name the code that is affected. A changed page is only accepted as the new baseline once it has an assessment. Unread changes keep coming back on every run, so nothing is silently lost.

If a red or amber finding gives a date or replacement that should hold for future runs (e.g. `sunset`, `replacement`), propose updating that API's manifest entry.

### 4. Finalize

```bash
node "${CLAUDE_SKILL_DIR}/scripts/finalize.mjs"
```

This merges everything, compares with the previous `state.json`, writes `report.md`, updates `state.json` and accepts the assessed snapshots. Use `--dry-run` to preview without saving.

### 5. Look into the red packages, then summarize

For each red package, spend a minute confirming the signal and finding the way out: the npm deprecation message often names the replacement, NuGet has `alternatePackage`, and the repo README of an archived project often points to a fork or successor. A package with no release in two years that is small, dependency-free and feature-complete can be fine. Say so, and suggest an `ignore` entry with a reason and an expiry date (6–12 months) rather than leaving it red forever. Never add ignore entries yourself without the developer's confirmation.

Add what you found to the "Action needed" section of `report.md` (replacement, migration notes, effort guess).

Then reply in chat with:
- the counts (red/amber, and what is new since last run),
- every red item with its one-line action,
- any changed pages you judged red or amber,
- the untracked hosts that still need a decision,
- gaps (unreachable sources, missing tools), so a clean report is not mistaken for a clean bill of health.

Keep it short; the report has the detail. Remind them to commit `.solution-health/` (except `run/`).

## How the verdicts work

Thresholds are in the manifest (`packages.thresholds`, `runtimes.warnDays`, `apiSunsetWarnDays`).

**Packages** (direct dependencies by default):
- 🔴 deprecated on the registry (installed or latest version), repo archived, unpublished/missing, high or critical vulnerability, or no release *and* no commit in `staleMonths` (24).
- 🟠 no release in `quietMonths` (12), OpenSSF Scorecard "Maintained" ≤ 2, moderate/low vulnerability, or 2+ major versions behind.
- 🔵 updates available. ⚫ ignored (with reason and expiry; an ignored package that turns red shows up again).
- Data comes from the npm registry, api.nuget.org (registration: deprecation, vulnerabilities, publish dates; public metadata, even when the solution restores through a private feed that mirrors nuget.org), `npm outdated`/`npm audit`, `dotnet list package --outdated/--deprecated/--vulnerable` when the SDK is installed, packages.ecosyste.ms (archived, last push, maintainers) and api.deps.dev (Scorecard). npms.io is deliberately **not** used: its data is years stale.

**NuGet sources and folders** (resolved from the solution, never assumed): for each project, the NuGet.config chain from the project folder up to the drive root plus the user-level config, `<clear/>`, `disabledPackageSources` and `packageSourceMapping`; MSBuild `RestoreSources`, `RestoreAdditionalProjectSources`, `RestorePackagesPath`, `RestoreFallbackFolders` and `RestoreConfigFile` in the project or nearest `Directory.Build.props`; the `NUGET_PACKAGES` env var; `globalPackagesFolder`, `fallbackPackageFolders` and, for packages.config projects, `repositoryPath` (default `<solution dir>/packages`). `%VAR%` and relative paths resolve the way NuGet resolves them. With the SDK installed, `dotnet nuget locals global-packages --list` and `dotnet nuget list source` confirm the result. nuget.org is only assumed when nothing configures a source, and `~/.nuget/packages` only when nothing sets the folder.
- 🔴 local source folder missing (NU1301), feed URL returns 404/410, a package that source mapping sends to no enabled source (NU1100), every source cleared or disabled, `RestoreConfigFile` pointing nowhere.
- 🟠 feed unreachable or 5xx, plain `http` feed (NU1803), a `%VAR%` that is not set here, an absolute Windows path on another OS, a configured package or fallback folder that does not exist.
- 🔵 feed needs authentication (401/403, normal for private feeds), a source only in this machine's user config (other devs and CI will not have it), a disabled source, direct packages not restored into the packages folder yet, nuget.org not used at all.
- A NuGet package that is not on nuget.org but can come from a private feed is ⚪ unknown, not red: registry and health checks do not cover private feeds.

**Runtimes and frameworks** (endoflife.date): Node from `.nvmrc`/`engines`/Dockerfiles/CI, .NET from `TargetFramework`/`global.json`, plus Umbraco, Next.js, React, Angular, Vue, Nuxt and others detected from packages. 🔴 past EOL, 🟠 EOL within `warnDays`. Add databases, search engines or hosting runtimes the code does not reveal under `runtimes.extra`.

**External APIs**:
- 🔴 probe returns 404/410, `Deprecation` header (RFC 9745) or `Sunset` header (RFC 8594) within `apiSunsetWarnDays`, a known `sunset` date that is near or past while the host is still in code, `status: "replaced"` but still referenced, or an assessed page judged red.
- 🟠 new deprecation-keyword sentences on a watched page (until you assess it), probe unreachable or 5xx, redirect to another host, deprecation text in the probe response, a watch page that has disappeared.
- 401/403 on a probe usually means auth or IP allowlisting, not a dead API; it is reported as info.

## When something cannot be reached

Corporate networks and sandboxes sometimes block registries or health APIs. The report's "Coverage and gaps" section lists what did not run. Behind a corporate proxy, Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21+/24.5+); if everything is "unreachable" but the browser works, rerun with that variable set. Do not present an unchecked item as healthy. If a source the scripts could not reach is reachable via your WebFetch tool (e.g. a provider's docs page), fetch it and assess it manually, and note in the report that it was checked by hand.

## Other ecosystems

`discover.mjs` lists other manifests it sees (composer.json, requirements.txt, go.mod…) without checking them. If present, run the native tool when available (`composer outdated --direct`, `composer audit`, `pip-audit`, `go list -m -u all`) and fold the results into the report by hand, noting that they were checked outside the scripts.
