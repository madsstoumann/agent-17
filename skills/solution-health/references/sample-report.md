# Solution health report — 2026-10-21

Solution: `.` · Previous run: 2026-10-21

**11 red · 2 amber · 0 unknown · 1 info · 3 green**

## New since 2026-10-21

Nothing got worse since the last run.

## ⚠️ Changed pages not yet assessed

These pages changed (or mention deprecation on first sight) and nobody has read the change yet. They will be flagged again on the next run until assessed.

- **DAWA (Danmarks Adressers Web API)** — http://127.0.0.1:8787/docs → `.solution-health/run/changes/dawa-danmarks-adressers-web-api--127-0-0-1-8787-docs--f746ed.md`
- **Example: payment provider** — http://127.0.0.1:8787/changelog → `.solution-health/run/changes/example-payment-provider--127-0-0-1-8787-changelog--6980dc.md`

## Action needed

### 🔴 left-pad@1.3.0 _(package, npm)_
- installed version deprecated: use String.prototype.padStart()
- source repo archived (github.com/stevemao/left-pad)
- no release in 104 months, no commits in 104 months
- single maintainer (bus factor 1)
- Where: `frontend/package.json`
- Red since: 2026-10-21

### 🔴 Microsoft.Azure.Storage.Blob@11.2.3 _(package, nuget)_
- installed version deprecated: Legacy: Please use Azure.Storage.Blobs
- suggested replacement: Azure.Storage.Blobs
- source repo archived (unknown repo)
- no release in 74 months, no commits in 66 months
- single maintainer (bus factor 1)
- Where: `src/Web/Web.csproj`
- Red since: 2026-10-21

### 🔴 Newtonsoft.Json@12.0.3 _(package, nuget)_
- no release in 14 months (last commit 14 months ago)
- single maintainer (bus factor 1)
- 1 known vulnerability (high)
- 1 major behind (12.0.3 → 13.0.4)
- Where: `src/Web/Web.csproj`
- Red since: 2026-10-21

### 🔴 next@13.5.11 _(package, npm)_
- 1 known vulnerability (critical)
- 3 major versions behind (13.5.11 → 16.4.2)
- Where: `frontend/package.json`
- Red since: 2026-10-21

### 🔴 node-sass@7.0.3 _(package, npm)_
- installed version deprecated: Node Sass is no longer supported. Please use `sass` or `sass-embedded` instead.
- ecosyste.ms status: deprecated
- source repo archived (github.com/sass/node-sass)
- no release in 37 months, no commits in 27 months
- single maintainer (bus factor 1)
- 1 known vulnerability (high)
- 2 major versions behind (7.0.3 → 9.0.0)
- Where: `frontend/package.json`
- Red since: 2026-10-21

### 🔴 request@2.88.2 _(package, npm)_
- installed version deprecated: request has been deprecated, see https://github.com/request/request/issues/3142
- ecosyste.ms status: deprecated
- source repo archived (github.com/request/request)
- no release in 81 months, no commits in 34 months
- OpenSSF Scorecard "Maintained" = 0/10
- 1 known vulnerability (critical)
- Where: `frontend/package.json`
- Red since: 2026-10-21

### 🔴 nodejs 16 _(runtime)_
- nodejs 16 is end-of-life since 2023-09-11
- Where: `.nvmrc`, `frontend/package.json (engines.node ">=16")`
- Red since: 2026-10-21

### 🔴 dotnet 6.0 _(runtime)_
- dotnet 6.0 is end-of-life since 2024-11-12
- Where: `src/Web/Web.csproj (net6.0)`
- Red since: 2026-10-21

### 🔴 nextjs 13 _(runtime)_
- nextjs 13 is end-of-life since 2025-08-26
- Where: `npm package next`
- Red since: 2026-10-21

### 🔴 umbraco 10 _(runtime)_
- umbraco 10 is end-of-life since 2025-06-16
- Where: `nuget package Umbraco.Cms`
- Red since: 2026-10-21

### 🔴 DAWA (Danmarks Adressers Web API) _(api)_
- Deprecation header: 2025-06-30T22:00:00.000Z
- Sunset header: 2026-07-01 (112 days ago)
- Link: successor-version → https://adressevaelger.dk, deprecation → http://127.0.0.1:8787/docs
- known shutdown date 2026-07-01 has passed — still referenced in 1 file(s)
- marked replaced, but host still referenced in 1 file(s)
- 1 new deprecation-keyword sentence(s) on http://127.0.0.1:8787/docs
- Replacement: https://adressevaelger.dk (same address UUIDs) or a commercial DAWA-compatible API
- Owner: @backend-lead
- Where: `frontend/src/address.ts`
- Red since: 2026-10-21

## Watch

| | Item | Area | Why | Since |
|---|---|---|---|---|
| 🟠 | Umbraco.Cms@10.8.0 | package | single maintainer (bus factor 1); 6 major versions behind (10.8.0 → 16.3.1) | 2026-10-21 |
| 🟠 | Example: payment provider | api | 2 new deprecation-keyword sentence(s) on http://127.0.0.1:8787/changelog; host not found in code (removed? or built at runtime) | 2026-10-21 |

## External APIs

| | API | Probe | Watched pages | Code refs | Notes |
|---|---|---|---|---|---|
| 🔴 | DAWA (Danmarks Adressers Web API) | 200 · Deprecation · Sunset 2026-07-01 | changed | 1 | Deprecation header: 2025-06-30T22:00:00.000Z; Sunset header: 2026-07-01 (112 days ago); Link: successor-version → https://adressevaelger.dk, deprecation → http://127.0.0.1:8787/docs; known shutdown date 2026-07-01 has passed — still referenced in 1 file(s); marked replaced, but host still referenced in 1 file(s); 1 new deprecation-keyword sentence(s) on http://127.0.0.1:8787/docs |
| 🟠 | Example: payment provider | 200 | changed | 0 | 2 new deprecation-keyword sentence(s) on http://127.0.0.1:8787/changelog; host not found in code (removed? or built at runtime) |

## Packages (9 direct)

| | Package | Eco | Installed | Latest | Last release | Maintained* | Why |
|---|---|---|---|---|---|---|---|
| 🔴 | left-pad | npm | 1.3.0 | 1.3.0 | 2018-04-09 (104 mo) | ? | installed version deprecated: use String.prototype.padStart(); source repo archived (github.com/stevemao/left-pad); no release in 104 months, no commits in 104 months; single maintainer (bus factor 1) |
| 🔴 | Microsoft.Azure.Storage.Blob | nuget | 11.2.3 | 11.2.3 | 2020-10-01 (74 mo) | ? | installed version deprecated: Legacy: Please use Azure.Storage.Blobs; suggested replacement: Azure.Storage.Blobs; source repo archived (unknown repo); no release in 74 months, no commits in 66 months; single maintainer (bus factor 1) |
| 🔴 | Newtonsoft.Json | nuget | 12.0.3 | 13.0.4 | 2025-09-01 (14 mo) | ? | no release in 14 months (last commit 14 months ago); single maintainer (bus factor 1); 1 known vulnerability (high); 1 major behind (12.0.3 → 13.0.4) |
| 🔴 | next | npm | 13.5.11 | 16.4.2 | 2026-10-12 (0 mo) | ? | 1 known vulnerability (critical); 3 major versions behind (13.5.11 → 16.4.2) |
| 🔴 | node-sass | npm | 7.0.3 | 9.0.0 | 2023-10-01 (37 mo) | ? | installed version deprecated: Node Sass is no longer supported. Please use `sass` or `sass-embedded` instead.; ecosyste.ms status: deprecated; source repo archived (github.com/sass/node-sass); no release in 37 months, no commits in 27 months; single maintainer (bus factor 1); 1 known vulnerability (high); 2 major versions behind (7.0.3 → 9.0.0) |
| 🔴 | request | npm | 2.88.2 | 2.88.2 | 2020-02-11 (81 mo) | 0 | installed version deprecated: request has been deprecated, see https://github.com/request/request/issues/3142; ecosyste.ms status: deprecated; source repo archived (github.com/request/request); no release in 81 months, no commits in 34 months; OpenSSF Scorecard "Maintained" = 0/10; 1 known vulnerability (critical) |
| 🟠 | Umbraco.Cms | nuget | 10.8.0 | 16.3.1 | 2026-10-06 (1 mo) | ? | single maintainer (bus factor 1); 6 major versions behind (10.8.0 → 16.3.1) |

_*OpenSSF Scorecard "Maintained" check, 0–10, via deps.dev. ? = not assessed._

<details><summary>1 packages with updates available</summary>

- npm react: 1 major behind (18.3.1 → 19.3.1)

</details>

npm audit `frontend/package.json`: 4 critical, 8 high, 3 moderate, 2 low (incl. transitive). Run `npm audit fix` (no `--force`) for semver-compatible fixes.

## Runtimes & frameworks

| | Product | Cycle | EOL | Newest cycle | Found in |
|---|---|---|---|---|---|
| 🔴 | nodejs | 16 | 2023-09-11 | 26 | .nvmrc, frontend/package.json (engines.node ">=16") |
| 🔴 | dotnet | 6.0 | 2024-11-12 | 10.0 | src/Web/Web.csproj (net6.0) |
| 🔴 | nextjs | 13 | 2025-08-26 | 16 | npm package next |
| 🔴 | umbraco | 10 | 2025-06-16 | 16 | nuget package Umbraco.Cms |
| 🟢 | react | 18 | not set | 19 | npm package react |
| 🟢 | mssqlserver | 2019 | 2030-01-08 | 2022 | manifest (Azure VM database) |

## Hosts in code that nobody is watching (3)

Add each real integration to `manifest.json` → `apis` (with a watch page), or to `hostsIgnore` if it is not an integration.

- **maps.googleapis.com** — 1 file(s), e.g. `frontend/src/address.ts`
- **api.hubapi.com** — 1 file(s), e.g. `src/Web/appsettings.json`
- **distribution.virk.dk** — 1 file(s), e.g. `src/Web/appsettings.json`

## Coverage and gaps

- dotnet SDK not installed — NuGet transitive/vulnerability data from CLI skipped
- src/Web/Web.csproj: dotnet not on PATH: using the NuGet API only (no transitive or local-feed data).

---
Generated by the `solution-health` skill. Re-run: ask Claude "run the solution health check". Config: `.solution-health/manifest.json`.
