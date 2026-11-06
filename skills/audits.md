# Running the audits automatically

This page is for people who want the audits to run by themselves when something important changes in a
project: on a pull request, after a deploy, or on a timetable. It covers what works today, the commands
to use, and what is not built yet.

You don't need any of this to run an audit by hand. In Claude Code, `/skills:audit-all` or any single
audit (see the [Contents](README.md#contents)) is still the easiest way.

## The short version

- **Don't keep an agent running in the background.** Code only changes when someone pushes, and GitHub
  already tells you about every push for free. A watcher costs the same on a quiet day as on a busy one,
  and it judges half-finished work.
- **Run audits on events instead:** a pull request for the code audits, a preview deploy for the site
  audits.
- **Add a schedule** for things that change without a commit: a new vulnerability in a package you
  already use, an expiring certificate, a tracking tag someone added in Google Tag Manager, an API that
  announces its shutdown.
- **Start with the scripts, call Claude only when needed.** Every audit has a Node script that does the
  checking without Claude and costs no tokens. Claude adds the judgment: triage, explanations and the fix
  plan. Use it when the scripts find something new.

## Which change calls for which audit

Use this as the starting point for path filters in CI. Adjust it to the project.

| When these files change | Run | Needs a live URL |
| --- | --- | --- |
| `package.json`, lockfiles, `*.csproj`, `Directory.Packages.props`, `NuGet.config`, `global.json`, `.nvmrc` | audit-solution-health, audit-security | No |
| Source code, `.github/workflows/`, `Dockerfile`, `appsettings*.json`, `.env*`, `umbraco-cloud.json` | audit-security | No |
| Templates and components (`*.cshtml`, `*.tsx`, `*.jsx`, `*.vue`, `*.astro`, `*.html`), CSS | audit-a11y | Yes (preview) |
| Layouts and `<head>`, routes, `robots.txt`, sitemap, redirects, JSON-LD | audit-seo | Yes, or `--schema-only` on a local HTML file |
| Images, video, fonts, bundler config, a large new dependency | audit-eco | Yes (preview) |
| Cookie banner, analytics or GTM snippet, privacy page, a new third-party script | audit-privacy | Yes, ideally production |
| Header config (`vercel.json`, `netlify.toml`, `web.config`, `staticwebapp.config.json`, middleware), DNS or CDN settings | audit-launch, audit-infra | Yes |
| A release to production | audit-launch, plus the site audits with `--level error` | Production |
| Only Markdown or docs | Nothing | |

**Code audits** (audit-security, audit-solution-health) only need the checked-out code, so they can run
the moment a pull request opens.

**Site audits** (audit-launch, audit-a11y, audit-seo, audit-eco, audit-privacy, audit-infra) need a
deployed site. Run them when a preview deploy finishes, against the preview's URL. If the preview is
protected, pass the bypass header with `--header` or `AUDIT_HEADERS` (see
[Let audit-launch past a Vercel firewall](../README.md#let-audit-launch-past-a-vercel-firewall)).
Without preview deploys, run them after merge against staging, or on the schedule.

audit-infra and audit-privacy are about the production domain more than about any one change. Run them
on production deploys and on the schedule rather than on every pull request.

## Run an audit without Claude

Each audit's checks are a plain Node script (Node 18 or newer, no `npm install`). This is what you
run in CI for every change: it is fast and costs nothing.

Get the scripts by cloning this repository. In CI, pin a tag or commit so the audits don't change under
the project between runs:

```bash
git clone https://github.com/madsstoumann/agent-17.git
cd agent-17 && git checkout <commit>   # pin it
```

| Audit | Command |
| --- | --- |
| audit-security | `node skills/audit-security/scripts/scan.mjs <repo path>` |
| audit-solution-health | `node skills/audit-solution-health/scripts/check.mjs --root <solution path>`, then `finalize.mjs` (see below) |
| audit-launch | `node skills/audit-launch/scripts/audit.mjs <url>` |
| audit-a11y | `node skills/audit-a11y/scripts/a11y.mjs <url>` |
| audit-seo | `node skills/audit-seo/scripts/seo.mjs <url>` (add `--geo` for the GEO view) |
| audit-eco | `node skills/audit-eco/scripts/eco.mjs <url>` |
| audit-privacy | `node skills/audit-privacy/scripts/scan.mjs <url>` |
| audit-infra | `node skills/audit-infra/scripts/scan.mjs <domain>` |

Add the [shared flags](../README.md#shared-by-every-report-writing-skill) you need. The useful ones for
unattended runs:

- `--console` prints one line per issue instead of writing `report.md`.
- `--level error` shows only errors; `--level error,warn` adds warnings.
- `--out DIR` (or `AUDIT_OUT_DIR`) decides where the files go.

For example, errors only, as a short list:

```bash
node skills/audit-infra/scripts/scan.mjs example.com --console --level error
```

```text
audit-infra example.com — 0 errors · 2 warnings · 6 info — showing errors only
No errors.
```

Two things to know:

- **audit-security's script finds candidates, not findings.** It lists every place a rule matched, many
  of them harmless. Deciding which are real is Claude's job (next section), and the verdicts are
  remembered so the same line is never judged twice.
- **audit-solution-health needs one interactive run first.** Its first run builds a list of the external
  APIs the project calls, and a developer must confirm it. Do that once in Claude Code with
  `/skills:audit-solution-health --in-repo`, then commit `.audit-solution-health/manifest.json` (and add
  `.audit-solution-health/run/` to `.gitignore`). After that, `check.mjs` and `finalize.mjs` run
  unattended with `--in-repo`.

## Run an audit with Claude, without questions

`claude -p` runs Claude Code once, with no chat, and prints the answer. Load the skills straight from
your pinned clone with `--plugin-dir`, so you don't need to install the plugin on the machine:

```bash
claude -p "/skills:audit-security . --level error,warn" \
  --plugin-dir ./agent-17/skills \
  --allowedTools "Bash(node:*) Bash(git log:*) Read Grep Glob Write"
```

```bash
claude -p "/skills:audit-all https://preview.example.com --only launch,a11y,seo --level error --yes" \
  --plugin-dir ./agent-17/skills \
  --allowedTools "Bash(node:*) Bash(npx lighthouse:*) Bash(curl:*) Bash(dig:*) Read Grep Glob Write Edit WebFetch"
```

- audit-all never asks a question when there is nobody to answer: `--yes`, `--only`, `--skip`, `--add`,
  `--url` and `--no-site` settle everything it would otherwise ask.
- `--allowedTools` lists what Claude may do without asking. Keep it to what the audit needs; `audit-all`'s
  own list is in its [SKILL.md](audit-all/SKILL.md).
- It needs `ANTHROPIC_API_KEY` in the environment.

## In GitHub Actions

Three workflows in the project being audited cover it. The examples below are a starting point, not a
finished product: see [What doesn't work yet](#what-doesnt-work-yet) before relying on them to block
a merge.

### 1. On every pull request: the code audits

```yaml
# .github/workflows/audits.yml
name: Audits
on:
  pull_request:
    paths:
      - '**/package.json'
      - '**/package-lock.json'
      - '**/pnpm-lock.yaml'
      - '**/yarn.lock'
      - '**/*.csproj'
      - '**/Directory.Packages.props'
      - '**/NuGet.config'
      - '**/*.js'
      - '**/*.ts'
      - '**/*.cs'
      - '**/appsettings*.json'
      - '.github/workflows/**'

jobs:
  code-audits:
    runs-on: ubuntu-latest
    env:
      AUDIT_OUT_DIR: ${{ runner.temp }}/audit-reports
    steps:
      - uses: actions/checkout@v4
        with:
          path: project
          fetch-depth: 0
      - uses: actions/checkout@v4
        with:
          repository: madsstoumann/agent-17
          ref: <commit>                     # pin it
          path: agent-17
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Keep baselines and triage between runs (see "What doesn't work yet")
      - uses: actions/cache@v4
        with:
          path: ${{ runner.temp }}/audit-reports
          key: audits-${{ github.head_ref }}-${{ github.run_id }}
          restore-keys: |
            audits-${{ github.head_ref }}-
            audits-main-
      - name: Security scan
        run: node agent-17/skills/audit-security/scripts/scan.mjs project --console --level error,warn
      - name: Dependency health
        run: |
          node agent-17/skills/audit-solution-health/scripts/check.mjs --root project --in-repo
          node agent-17/skills/audit-solution-health/scripts/finalize.mjs --root project --in-repo --console --level error,warn
```

For Claude's triage on top, add a step with `claude -p` as shown above and the `ANTHROPIC_API_KEY`
repository secret. To keep cost down, run it only when the script reports something new compared with
the last run (the `BASELINE … N new` line).

Split the paths into two jobs if you want dependency changes to run only audit-solution-health, and
code changes only audit-security.

### 2. After a preview deploy: the site audits

Vercel, Netlify and Azure Static Web Apps report a finished preview to GitHub as a deployment. Trigger
on it and audit the preview's URL:

```yaml
on:
  deployment_status:

jobs:
  site-audits:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    env:
      URL: ${{ github.event.deployment_status.environment_url }}
      PSI_API_KEY: ${{ secrets.PSI_API_KEY }}
      AUDIT_HEADERS: ${{ secrets.AUDIT_HEADERS }}   # preview protection bypass, if any
    steps:
      # check out agent-17 and set up Node as above
      - run: node agent-17/skills/audit-launch/scripts/audit.mjs "$URL" --env staging --console --level error
      - run: node agent-17/skills/audit-a11y/scripts/a11y.mjs "$URL" --pages 5 --console --level error
      - run: node agent-17/skills/audit-seo/scripts/seo.mjs "$URL" --console --level error
```

GitHub's Ubuntu runners have Chrome installed, which audit-a11y, audit-eco, audit-privacy and audit-seo
use. Set `CHROME_PATH` if they can't find it. Set `PSI_API_KEY` so Lighthouse results come from
PageSpeed Insights and don't depend on the runner.

### 3. On a schedule: what changes without a commit

```yaml
on:
  schedule:
    - cron: '0 5 * * *'     # nightly: dependency and security advisories
    - cron: '0 6 * * 1'     # Mondays: the live site
  workflow_dispatch:
```

- **Nightly:** audit-solution-health and audit-security on the main branch. New vulnerabilities are
  published against code that hasn't changed.
- **Weekly:** audit-infra, audit-launch and audit-privacy against production. Certificates, DNS, mail
  records and tracking scripts change outside the code.
- **Monthly:** a full `audit-all --yes` through `claude -p`, with the PDF saved as a build artifact.

Report to a single issue ("Audit drift") rather than one per run, and only when something changed since
the last run.

**Where to run audit-privacy.** GitHub's hosted runners are in the US, and many cookie banners only show
to visitors in the EU, so audit-privacy can miss what an EU visitor sees. Run it from a self-hosted
runner in the EU, or from your own machine.

### Fixing what was found

Keep fixing started by a person. Run `/skills:audit-fix` on a finished audit-all run: it works on a local
branch and never pushes, so a person reviews every change.

## On your own machine

Claude Code hooks can run a check before you push. Keep it to one quick, quiet check: a hook that runs
after every edit judges half-finished work and slows you down. For example, a pre-push git hook:

```bash
#!/bin/sh
# .git/hooks/pre-push
node ~/agent-17/skills/audit-security/scripts/scan.mjs . --only secrets --console --level error
```

## What doesn't work yet

These gaps are known. Until they are fixed, treat the CI workflows above as reporting, not as a gate.

| Gap | What it means | Workaround for now |
| --- | --- | --- |
| The scripts always exit with 0 | A failed check can't fail the build | Read the first line of `--console` output (`— N errors`) in a script step |
| Baselines and triage live in the reports folder on the machine | A fresh CI runner has no "since last run" and re-triages everything | Cache `AUDIT_OUT_DIR` between runs as in the example; never commit reports, they can describe live secrets |
| Each run is compared with the last run, not with the main branch | Two pull requests can overwrite each other's baseline | Cache per branch and fall back to main's cache, as in the example |
| Some decisions need a person: the first solution-health manifest, accepting a licence, accepting a security finding | An unattended run can't make them | Make them once in Claude Code and commit the result (`--in-repo`) |
| No output made for pull requests (SARIF, a PR comment) | Findings don't show where developers look | Have `claude -p` write the summary and post it with `gh pr comment` |
| Audits check the whole repo or site, not just what changed | Slower and noisier on small pull requests | Use `--only` to narrow audit-security, `--pages` to limit site audits |
