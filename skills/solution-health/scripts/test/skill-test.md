# Testing solution-health

```bash
cd skills/solution-health
node --test scripts/test/solution-health.test.mjs        # ~10 s
VERBOSE=1 KEEP=1 node --test scripts/test/solution-health.test.mjs   # show script output, keep the temp solution
```

## What the test does

It copies `fixtures/solution/` to a temp folder, starts the mock provider in `mock/`, seeds the
HTTP cache with metadata responses, then runs every script the way Claude would:
discover → packages → runtimes → apis → finalize, writes an assessment, and runs apis + finalize again.

The fixture solution is deliberately unhealthy:

| Fixture | Expected verdict |
|---|---|
| `request`, `node-sass`, `left-pad` (npm) | red: deprecated, archived, stale |
| `left-pad` on the ignore list | still red (an ignore never hides a red) |
| `react` with an expired ignore | flagged for re-evaluation |
| `Microsoft.Azure.Storage.Blob` 11.2.3 | red, replacement `Azure.Storage.Blobs` surfaced |
| `Newtonsoft.Json` 12.0.3 | red, high-severity vulnerability on the installed version |
| `Serilog` via `Directory.Packages.props` | version resolved centrally |
| Node 16 (`.nvmrc`), net6.0, Umbraco 10, Next 13 | red, end-of-life |
| net8.0 in a multi-target `Lib.csproj` | amber/red depending on today's date |
| `api.dataforsyningen.dk` in `address.ts` | tracked API, 1 code reference |
| `api.hubapi.com` in `appsettings.json` | untracked, high priority |
| `developer.mozilla.org` in a comment | filtered out as documentation |
| `frontend/package-lock.json` | licences per package: `agpl-thing` (AGPL, red), `busl-sdk` (BUSL, red), `mystery-pkg` (none, amber), `dual-licensed` (MIT OR GPL, green), `gpl-build-tool` (GPL, dev only, info) |
| `src/Web/obj/project.assets.json` (written by the test) | NuGet inventory from the package folder it names: `iTextSharp` AGPL from its licence file (red, via Umbraco.Cms), the .NET library licence URL recognised |
| Seeded NuGet vulnerability database | transitive `System.Text.Encodings.Web` 4.5.0 critical, red, pulled in by Umbraco.Cms |
| `tasks.json` | validated with audit-all's `validateTasks` when that skill sits next to this one |
| Mock DAWA endpoint | `Deprecation: @1751320800`, `Sunset`, `Link rel="successor-version"` parsed |
| Mock DAWA docs page with "DAWA lukker den 1. juli 2026" | Danish keyword hit, change file written, API red |
| Unassessed change | flagged again on the next run, not accepted as baseline |
| Assessed change | accepted; next run reports the page `unchanged` |

## What is mocked, and why

When the skill was written (Oct 2026) the sandbox could reach registry.npmjs.org but not
api.nuget.org, packages.ecosyste.ms, api.deps.dev or endoflife.date. The test seeds those four
into `.solution-health/run/cache/` in the shapes the scripts parse:

- **api.nuget.org** registration index and **endoflife.date** product JSON: shapes verified against
  the live services at the time.
- **packages.ecosyste.ms** package and **api.deps.dev** version/project: shapes written from their
  API documentation and other clients, not verified live. If a real run on a normal network shows
  `Maintained = ?` and no archived/last-commit data for every package, check the field names in
  `packages.mjs` → `healthFacts()` against a live response first.

- **api.nuget.org/v3/vulnerabilities** index and base file (2.1.0): shape verified live on 2026-10-30
  (`{ "<lowercase id>": [{ url, severity 0–3, versions: "<NuGet range>" }] }`). The registration
  `licenseExpression`/`licenseUrl` fields and the deps.dev version `licenses` array were checked live
  the same day.

The npm registry, `npm outdated` and `npm audit` are called live when the network allows; nothing asserted
depends on them, so the test also passes offline.

## RED/GREEN note

The skill was not benchmarked against a no-skill baseline. The motivating failure is documented
in SKILL.md instead: a site kept calling DAWA after the shutdown was announced in Danish on the
provider's docs page, which no lockfile-based tool reports. The test above encodes that case.
