---
name: solution-health
description: Periodic health check of a solution's dependencies and external integrations. Checks npm and NuGet packages (outdated majors; vulnerable, including transitive, via npm audit, dotnet and NuGet's vulnerability database; deprecated, unmaintained or archived upstream), the licence of every installed package with compatibility flags (AGPL, GPL, source-available, missing), the NuGet sources and folders the solution's NuGet.config resolves to, runtime and framework end-of-life (Node, .NET, Umbraco, Next.js…), and external APIs the code calls (deprecation/sunset headers, shutdown notices on provider pages, including Danish ones like DAWA's). Remembers each run, so it reports what changed. Use whenever someone asks for a solution or dependency health check, to audit packages or licences, about deprecated or abandoned packages, whether an API we use is shutting down, a quarterly maintenance check, or "is anything in this project end-of-life?", even if they do not name the skill.
argument-hint: "[--root PATH] [--in-repo | --dir PATH] [--transitive] [--offline] [--skip packages,runtimes,apis]"
allowed-tools: Bash(node:*), Bash(npm:*), Bash(dotnet:*), Read, Write, Edit, WebFetch, WebSearch
metadata:
  version: "2.2.0"
---

# Solution health check

This skill exists because a site kept calling DAWA (the Danish address API) long after its shutdown was announced on DAWA's own docs page. Nobody read that page. `npm audit` and `dotnet list package --vulnerable` only catch known CVEs. They do not tell you that a package's repo was archived, that a runtime is out of support, that an AGPL package came in three levels down, or that a government API is closing. This skill covers all of these and remembers what it saw last time, so a dev running it every month or quarter sees what changed.

It is **report only**. Do not change code, upgrade packages or edit lockfiles as part of a run. The only exception is `npm audit fix`, and only when the developer explicitly asks for it (never `--force`). The deliverable is `report.md` in the state folder (below) plus a short summary in chat, and `tasks.json`, the red and amber findings as fix tasks that audit-all and audit-fix take as they are.

## Files

Everything lives in the **state folder**, outside the repo by default, so a run never adds files to the solution:
`<reports>/solution-health/<solution folder name>/`, where `<reports>` is `$AUDIT_OUT_DIR` if set, else the
Downloads folder if it exists (the XDG download folder on Linux), else `~/audit-reports/`, the same as the other
audit skills. The name is stable, so each run compares with the previous one; a `root.txt` records which solution
the folder belongs to (two solutions with the same folder name get a hash suffix). `check.mjs` prints the folder.

A team that wants the state committed, so every developer and the PR history see it, runs with `--in-repo`
(`.solution-health/` in the solution) or `--dir PATH`. Pass the same flag to every script. An old in-repo
`.solution-health/` from before 2.0.0 is copied to the state folder on the first run (not `run/`), and left in
place: tell the user it is no longer used and can be deleted, unless they want `--in-repo`.

Never point `--dir` at an audit run folder (audit-all's or any skill's timestamped `runs/<stamp>/`, marked with
an `.audit-run` file): the next run would not look there. The scripts ignore such a `--dir` and use the state
folder above. When the state folder has no manifest yet but an earlier run left one in an audit run folder
under `<reports>/audit-all/` (found by its `root.txt` or `run/discovery.json`, not by folder name), `check.mjs`
copies the newest one over once and says so.

| File | Owner | Purpose |
|---|---|---|
| `manifest.json` | Team (you propose, a dev approves) | External APIs to watch, ignore lists, thresholds. Template: `templates/manifest.example.json` |
| `state.json` | Scripts | Last verdict per item, page hashes, assessments |
| `snapshots/*.txt` | Scripts | Normalized text of each watched page, used to diff the next run |
| `notes.md` | You and the team | Triage notes, migration plans, decisions. No script writes it; `finalize.mjs` shows it in the report's "Notes" section on every run |
| `report.md` | Scripts | Latest report, rewritten by every `finalize.mjs` run. Do not write notes into it |
| `tasks.json` | Scripts + you | Red and amber findings as fix tasks, in audit-all's `tasks.json` shape |
| `run/` | Scripts | Scratch: raw results, HTTP cache, change files (with `--in-repo`, add `.solution-health/run/` to `.gitignore`) |

Scripts are in `scripts/` next to this file. They are zero-dependency Node (18+), so they run on any dev machine with Node, including .NET-only devs. Run them from the solution root, or pass `--root <path>`. The commands below use `${CLAUDE_SKILL_DIR}`, this skill's folder wherever it is installed (`.claude/skills/solution-health/` in the solution, `~/.claude/skills/`, or a plugin); if it is not filled in, use the folder this `SKILL.md` is in. `references/sample-report.md` shows what a finished report looks like.

## Workflow

### 1. Run the checks

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check.mjs"
```

This runs discover → packages → runtimes → apis in order and prints a summary of each. Options: `--transitive` (include transitive packages; noisy, use for audits), `--offline` (no network), `--skip apis` and similar.

If the state folder has no `manifest.json`, this is the **first run**. Do step 2 before anything else, then run `check.mjs` again.

### 2. First run, or new hosts found: build the API manifest

`discover.mjs` scans config and source for outbound URLs and lists the **untracked hosts**. Hosts marked `high` look like APIs or sit in config keys. These are the candidates for the manifest, and this step is what catches the next DAWA. For each candidate:

1. Work out what it is from the code that calls it (open one or two of the listed files).
2. Find the provider's pages where a shutdown would be announced: the API docs landing page, the changelog or release notes, a deprecations page, the status page or its RSS feed. Use WebSearch/WebFetch. Public-sector Danish providers (Dataforsyningen, Datafordeler, CVR, MitID, NemLog-in, Digital Post, DMI) announce in Danish on their own docs and news pages, so watch those pages, not just an English changelog.
3. Pick a cheap, side-effect-free probe URL (a GET that returns a small response). Never a POST, never anything that sends mail, charges money or writes data. If it needs a key, reference an env var (`"$NAME"`); keys never go in the manifest.
4. If you already know of a deprecation or shutdown, record `status`, `sunset` (ISO date) and `replacement`.

Present the proposed entries to the developer as a short list (name, hosts, watch pages, probe), and write them to `manifest.json` only once they confirm. Hosts that are not integrations (analytics snippets, font CDNs, links in content) go in `hostsIgnore`, also with confirmation. Do not invent watch URLs you have not fetched at least once.

On later runs, only new untracked hosts need this treatment. The report lists them, so the list shrinks over time.

### 3. Read and judge every change file

`apis.mjs` prints a list of change files (`run/changes/*.md` in the state folder). A change file is written when a watched page changed since the accepted snapshot, or when a page mentions deprecation keywords on first sight. Each file contains the added and removed sentences, plus the sentences that match deprecation keywords in English and Danish.

Read every one. Keyword matching is only a filter: "lukker" also matches a cookie banner, and a real shutdown notice can avoid every keyword ("vi overgår til en ny platform"). For each page, decide:

- `red`: announces a shutdown, removal, forced migration or breaking change that affects how this solution uses the API (check the calling code if in doubt).
- `amber`: an announced deprecation without a date, a new major version with the old one put in maintenance, a pricing or auth change that needs planning.
- `info`: a relevant change that needs no action.
- `benign`: noise (layout, unrelated news, cookie text, dates).

Write the results to `run/assessments.json` in the state folder, keyed by the watched URL:

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

This merges everything, compares with the previous `state.json`, writes `report.md` and `tasks.json`, updates `state.json` and accepts the assessed snapshots. Use `--dry-run` to preview without saving.

### 5. Look into the red packages, then summarize

Read `notes.md` first: earlier runs may already have looked into the same items. For each red package, spend a minute confirming the signal and finding the way out: the npm deprecation message often names the replacement, NuGet has `alternatePackage`, and the repo README of an archived project often points to a fork or successor. A package with no release in two years that is small, dependency-free and feature-complete can be fine. Say so, and suggest an `ignore` entry with a reason and an expiry date (6–12 months) rather than leaving it red forever. Never add ignore entries yourself without the developer's confirmation.

Write what you found to `notes.md` in the state folder (replacement, migration notes, effort guess), one `## <item>` section per item with the date, and update the sections that are already there instead of adding duplicates. Never edit `report.md`: the next `finalize.mjs` rewrites it. Run `finalize.mjs` again afterwards so the report shows the notes. If `finalize.mjs` says it saved a hand-edited `report.edited-<date>.md`, move the notes in it to `notes.md` and tell the user the old copy can be deleted.

For each red or amber licence, check the signal the same way. A licence the scripts could not recognise (`SEE LICENSE IN …`, a URL, no licence at all) is often fine once read: open the package's LICENSE file (in `node_modules`, the NuGet package folder, or on the repo via WebFetch) and say what it is. A copyleft hit is only a problem if the package ships: a GPL build tool is not, a GPL package in the browser bundle is. These are legal calls for the developer or the client, so describe the finding and the options (replace, buy a licence, accept) and never add a `licenses.accept` entry without their confirmation.

Then bring `tasks.json` in line with what you found: a better replacement in `fix`, a different `model` when the job is bigger or smaller than the default guess, `owner: "human"` for anything that needs a decision first. Keep the ids and the shape (see audit-all's SKILL.md, "Write tasks.json"). Only red and amber findings are in it; info and ignored items are not tasks.

Then reply in chat with:
- the counts (red/amber, and what is new since last run),
- every red item with its one-line action,
- any changed pages you judged red or amber,
- licences that need a decision, and vulnerable transitive packages with the direct package that pulls them in,
- the untracked hosts that still need a decision,
- gaps (unreachable sources, missing tools), so a clean report is not mistaken for a clean bill of health.

Keep it short; the report has the detail, and give its full path. With `--in-repo`, remind them to commit `.solution-health/` (except `run/`).

## How the verdicts work

Thresholds are in the manifest (`packages.thresholds`, `runtimes.warnDays`, `apiSunsetWarnDays`).

**Packages** (direct dependencies by default):
- 🔴 deprecated on the registry (installed or latest version), repo archived, unpublished/missing, high or critical vulnerability, or no release *and* no commit in `staleMonths` (24).
- 🟠 no release in `quietMonths` (12), OpenSSF Scorecard "Maintained" ≤ 2, moderate/low vulnerability, or 2+ major versions behind.
- 🔵 updates available. ⚫ ignored. An ignore entry hides amber and info. It also hides a red that comes **only** from staleness (no release and no commits in `staleMonths`), but only when the entry has both a `reason` and an `expires` date; at expiry the red comes back. It never hides deprecated, archived, missing or vulnerable packages.
- Data comes from the npm registry, api.nuget.org (registration: deprecation, vulnerabilities, publish dates; public metadata, even when the solution restores through a private feed that mirrors nuget.org), `npm outdated`/`npm audit`, `dotnet list package --outdated/--deprecated/--vulnerable` when the SDK is installed, packages.ecosyste.ms (archived, last push, maintainers) and api.deps.dev (Scorecard). npms.io is deliberately **not** used: its data is years stale.

**Vulnerable transitive packages** (the whole tree, not only direct dependencies):
- npm: every entry `npm audit` reports that is not a direct dependency, with the direct package that pulls it in (from audit's `effects`) and the fix (`npm audit fix`, or the parent version that fixes it). NuGet: `dotnet list package --vulnerable --include-transitive` when the SDK is installed, otherwise NuGet's own vulnerability database (`api.nuget.org/v3/vulnerabilities`) matched against `obj/project.assets.json`, with the direct packages found through the assets file's dependency graph.
- 🔴 high or critical, 🟠 moderate, 🔵 low. A transitive npm package that is only reached through dev dependencies drops one level (build tooling is not shipped).
- In `tasks.json`, a transitive vulnerability whose fix is "upgrade the direct package X" is folded into X's task, so one upgrade is one task.

**Licences** (every installed or locked package, direct and transitive):
- Read from what is on disk, so no network is needed: `package-lock.json` (v2/v3 record each package's licence), `node_modules/*/package.json` when there is no npm lockfile, and for NuGet the `.nuspec` of each package in the folders `obj/project.assets.json` names (licence expression, licence file, or a known `licenseUrl`). A `SEE LICENSE IN` or licence file is identified from its text when it is a well-known licence. Direct packages that are not installed fall back to the registry (npm, api.nuget.org) and deps.dev.
- Judged against the solution's own licence: `licenses.projectLicense` in the manifest, else the root `package.json` `license`, else a csproj `PackageLicenseExpression`, else assumed closed source (most client solutions).
- For a closed-source or permissive solution: 🔴 network copyleft (AGPL, OSL) and source-available or non-commercial licences (SSPL, BUSL, Elastic, PolyForm, CC-BY-NC); 🟠 strong copyleft (GPL, EUPL), no licence, an unrecognised licence, or `UNLICENSED`; 🔵 weak copyleft (LGPL, MPL, EPL). Permissive licences (MIT, BSD, Apache-2.0, ISC, …) are green and only counted. `MIT OR GPL-3.0` counts as MIT; `MIT AND GPL-3.0` as GPL.
- Dev-only packages drop to 🔵, except non-commercial licences, which stay 🟠: using the tool at work is the commercial use they forbid.
- For a GPL solution, copyleft dependencies are fine, and the known incompatibilities are 🔴: Apache-2.0 or any v3 licence in a GPL-2.0-only work, GPL-2.0-only code in a GPL-3.0 or AGPL-3.0 work.
- The manifest's `licenses` block overrides this: `allow`, `review` (amber) and `deny` (red) lists of licence ids, and `accept: [{ name, ecosystem, reason, expires }]` for a package someone has cleared.

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
