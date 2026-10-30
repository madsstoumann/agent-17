---
name: audit-all
description: Use when someone wants the full audit of a site and its code in one go, a combined or all-in-one audit report, or one PDF covering launch readiness, code security and dependency health. Runs launch-audit and a11y-audit (WCAG 2.2 / EN 301 549) on the live URL, security-audit and solution-health on one or more repos, then writes a combined report.md and a typeset report.pdf with a verdict and a ranked "fix first" list, plus a fix plan (fix/TODO.md and one agent-ready prompt per task, each with a suggested model) that the audit-fix skill can hand to subagents. Also when asked to combine existing launch-audit, a11y-audit, security-audit or solution-health reports into one.
argument-hint: "[url] [repo path ...] [--style serif|sans] [--out DIR] [--skip launch,a11y,security,health]"
allowed-tools: Bash(node:*), Bash(npx lighthouse:*), Bash(curl:*), Bash(dig:*), Bash(git log:*), Bash(git show:*), Bash(npm:*), Bash(dotnet:*), Bash(semgrep:*), Bash(command -v:*), Bash(cp:*), Bash(mkdir:*), Read, Write, Edit, Grep, Glob, WebFetch, WebSearch
metadata:
  version: "1.3.0"
---

# Audit all

One run folder, four audits, one report. This skill does not check anything itself: it runs the
sibling skills (launch-audit, a11y-audit, security-audit, solution-health), each writing its own `report.md`
as usual, then you write a short `summary.md` and `scripts/combine.mjs` merges everything into a
combined `report.md`, a self-contained `report.html` and a typeset `report.pdf`. You also write
`tasks.json`, and `combine.mjs` turns it into a fix plan: `fix/TODO.md` and one prompt per task in
`fix/tasks/`, ready for the audit-fix skill or for pasting into any session.

`${CLAUDE_SKILL_DIR}` is this skill's folder. The sibling skills sit next to it when installed as
the `skills` plugin (`${CLAUDE_SKILL_DIR}/../launch-audit/` and so on). If they are installed some
other way, invoke them by name instead (`skills:launch-audit` in the plugin, `launch-audit` on its own).

## 1. Work out the targets

- **Site URL** for launch-audit and a11y-audit. If the user named one, use it. Otherwise look in each repo for the
  live URL: `package.json` `homepage`, a `CNAME` file, the site URL in `nuxt.config.*`,
  `next.config.*`, `astro.config.*` or `.env.production`, Umbraco `appsettings.Production.json`,
  then the README. One candidate: ask the user once to confirm it. None: ask for one, and accept
  "no site" to skip both. Staging URLs are fine; launch-audit works out the environment.
- **Repos** for security-audit and solution-health. Default: the current directory when it is a
  repo root (has `.git`). The user can name several ("audit-all ~/code/shop-web ~/code/shop-api
  https://shop.example.dk"); each gets its own run of both.
- **Skips.** "only launch and security", "--skip health" and the like drop an audit.
- **Style.** `--style serif` (default, Newsreader) or `--style sans` (IBM Plex Sans). "sans",
  "sans-serif", "plain" or "classic look" mean sans.

## 2. Create the run folder

```bash
node "${CLAUDE_SKILL_DIR}/scripts/combine.mjs" --new <site host or repo name>
```

It creates the run folder and prints it: `<reports>/audit-all/<name>/runs/<YYYYMMDD-HHMM>/`. The
`<name>/` part is the **target folder** for this site or solution; it never depends on a run, so every
run of the same target lands next to the last one. On stderr it also prints the target folder (and
whether it has a `notes.md`) and the **previous run**, if any; use them in step 4. `<reports>` is
the same for every audit skill, first match wins:

1. `--out DIR` when the user names a folder (then use that instead of `--new`),
2. `$AUDIT_OUT_DIR`,
3. the Downloads folder if it exists and is writable (on Linux the XDG download folder first),
4. `~/audit-reports/`.

Do not put the run folder inside a repo unless asked: security reports can describe live secrets.

**What carries over is never in a run folder.** Each skill keeps it in its own target folder, named
after the site host or repo folder: `<reports>/launch-audit/<host>/`, `<reports>/security-audit/<repo>/`,
`<reports>/solution-health/<repo>/` and `<reports>/audit-all/<name>/`. That is where the manifests,
triage verdicts, baselines and `notes.md` live, and each skill finds its own there whatever run
folder the output goes to. Run folders are marked with an `.audit-run` file and are disposable.

## 3. Run the audits

Run them one after another, each into its own sub-folder of the run folder. Folder names matter:
`combine.mjs` finds reports by the prefix `launch-audit`, `a11y-audit`, `security-audit` or `solution-health`,
optionally followed by `-<target>`. With one repo, plain names are fine; with several, add the repo
folder name.

| Audit | How | Writes |
|---|---|---|
| launch-audit | Follow launch-audit's SKILL.md with `--out "<run>/launch-audit"` (one folder per URL: `launch-audit-<host>`) | `report.md`, `report.json` |
| a11y-audit | Follow a11y-audit's SKILL.md with `--out "<run>/a11y-audit"` (one folder per URL: `a11y-audit-<host>`). Run it after launch-audit and pass `--from "<run>/launch-audit/report.json"` so it samples the pages the crawl found; pass `--repo <name>` when one of the repos renders the site | `report.md`, `report.json`, `tasks.json` |
| security-audit | Follow security-audit's SKILL.md with `--out "<run>/security-audit-<repo>"`, including the triage and `report.md` it asks you to write. Semgrep runs automatically when installed | `findings.json`, `report.md` |
| solution-health | Follow solution-health's SKILL.md in the repo, **without** `--dir` or `--out`: it keeps its manifest, state and report in its own folder (`<reports>/solution-health/<repo>/`, or `.solution-health/` with `--in-repo`), never in the run folder. Pass the repo to `combine.mjs --repo` and it copies the report in | `report.md` in its state folder |

launch-audit and security-audit compare with their last run of the same host or repo automatically,
from their own target folders, and security-audit reuses its earlier triage verdicts: only new hits
need triage. Do not pass `--baseline` unless the user wants a specific run compared.

Each skill's own rules still apply (report only, no fixes, launch-audit only on sites the user owns
or works on). Keep each skill's chat summary to a few lines: the combined report is the deliverable.
If an audit cannot run (no Node 22 for Lighthouse, no network, no solution-health manifest
yet and the user does not want to set one up), say so in the summary and carry on with the rest.

## 4. Write summary.md

Read the reports you produced and write `<run>/summary.md`. This is the only part of the combined
report you write; everything else comes from the sub-reports. Layout:

```markdown
---
title: Ready to launch, with three things to fix first
subject: shop.example.dk
prepared-for: the shop.example.dk team
---

## Verdict

Two or three sentences: can it ship, what blocks it, what can wait.

## Fix first

In order. Duplicates across the audits are merged.

1. **Rotate the Stripe secret key** — Committed in `config/payments.js` and still in history. [Blocker · Security]
2. **Remove noindex from the production build** — Header and meta tag both say noindex. [Fail · Launch]
3. **Replace the DAWA address lookup** — DAWA closes on 1 July 2026. [Red · Health]
4. **Tighten the CSP** — `script-src` allows `'unsafe-inline'`. [Warn · Launch, Security]
```

- `title` is the cover headline: a plain verdict in a few words, not "Audit report".
  `subject` is the site host or the solution name. `prepared-for` and `deck` (a one-line subtitle)
  are optional.
- **Fix first**: 3 to 7 items, most urgent first, across all audits. The trailing `[status · source]`
  sets the coloured mark: Blocker/Fail/High/Red, Warn/Medium/Amber, or Low/Info. Source is Launch,
  A11y, Security or Health, comma-separated when several audits found the same thing.
- **Merge duplicates.** The same problem often shows up twice: an exposed `.env` (launch-audit) and a
  committed `.env` (security-audit), a weak CSP in headers and in `nuxt.config`, a vulnerable package
  in both security-audit and solution-health, missing alt text or low contrast in both launch-audit's
  Lighthouse section and a11y-audit. One item, both sources.
- Use only facts from the reports. More `##` sections (for example "Can wait") are rendered too.
- **Since last run.** When `--new` printed a previous run, read its `summary.md` and `tasks.json` and
  add a `## Since last run` section: what was fixed, what is new, what is still open, using the
  sub-reports' own "Since last run" sections as evidence. Leave it out on the first run.
- Decisions that should hold for future runs (an accepted risk, an owner, a planned migration) go in
  `notes.md` in the target folder, not in `summary.md`. `combine.mjs` shows it as a "Notes" section
  in every report; nothing rewrites it. Ask the user before writing to it.

## 5. Write tasks.json

`<run>/tasks.json` is the fix plan as data: **every** confirmed problem worth fixing, not only the
"Fix first" items. Merge duplicates the same way, one task per fix. Leave out false positives,
"needs a look" items you could not confirm (list them in summary.md instead) and pure info.

solution-health already writes its red and amber findings in this shape, and `combine.mjs --repo`
copies them to `solution-health-<repo>/tasks.json` (ids `H1`, `H2`, …). Start from those: renumber
them, merge each with the same fix from the other audits (a vulnerable package security-audit also
found), and keep their owner, model and files unless you know better.

```json
{
  "subject": "shop.example.dk",
  "repos": { "shop-web": "/Users/mads/code/shop-web" },
  "tasks": [
    {
      "id": "T1", "title": "Rotate the Stripe secret key", "severity": "blocker", "owner": "human",
      "sources": ["security"], "area": "secrets",
      "evidence": "sk_live_… committed in config/payments.js (a1b2c3d, 2026-03-02), still in history.",
      "fix": "Roll the key in the Stripe dashboard and update the hosting secret."
    },
    {
      "id": "T2", "title": "Read the Stripe key from the environment", "severity": "blocker",
      "owner": "agent", "model": "sonnet", "sources": ["security"], "repo": "shop-web",
      "files": ["config/payments.js"], "dependsOn": ["T1"],
      "evidence": "config/payments.js:4 assigns the live key as a string literal.",
      "fix": "Use process.env.STRIPE_SECRET_KEY and fail fast when it is missing; add it to .env.example.",
      "verify": "No sk_live_ string in the working tree; the app starts with the variable set.",
      "refs": ["security-audit-shop-web/report.md"]
    }
  ]
}
```

| Field | Notes |
|---|---|
| `id` | `T1`, `T2`, … Stable within the run; `dependsOn` refers to these. When the previous run's `tasks.json` has the same problem, reuse its id and title so the two plans can be compared. |
| `severity` | `blocker`, `high`, `medium` or `low`, the same call as in the reports. |
| `owner` | `agent`, or `human` for anything an agent must not or cannot do: rotating secrets, DNS, CDN or hosting settings outside the repo, purging git history, product or legal calls. |
| `model` | For agent tasks, the cheapest tier that will do it well: `haiku` for mechanical, local edits (a header in a config file, a meta tag, alt text, a patch bump with no code changes); `sonnet` for ordinary code changes, multi-file edits and minor upgrades; `opus` for security fixes that need data-flow reasoning (injection, XSS, auth, SSRF), and for big jobs (a framework major or EOL runtime upgrade, replacing a closing API). `fable` only when the user asks for it. Left out, security and blocker tasks get `opus`, the rest `sonnet`. |
| `repo` | A key of `repos` (absolute path). Required for agent tasks. |
| `files` | Paths relative to the repo. Tasks in one repo that share a file, or that list no files, never run at the same time, so list them when you know them. |
| `evidence`, `fix` | From the reports: what is wrong where, and the fix. Quote code as code; never paste a secret, redact it. |
| `verify` | How to prove it is fixed: a command, a test to add, or the launch-audit check that should pass on the next run. |
| `sources` | `launch`, `a11y`, `security`, `health`. `refs` (optional) points at the sub-report. |

Launch-audit findings are often fixed outside the code (CDN headers, DNS, redirects at the host).
Make them agent tasks only when the repo holds the setting (`nuxt.config`, `web.config`,
`next.config`, `vercel.json`, `staticwebapp.config.json`, middleware); otherwise `owner: "human"`.

a11y-audit writes a draft in the same shape, `<run>/a11y-audit/tasks.json` (ids `A1`, `A2`, …,
`sources: ["a11y"]`). Copy its tasks in with new `T` ids, merging any that duplicate a launch-audit
item. They are agent tasks when the repo holds the templates or components (set `repo`, and `files`
once you have found the component); content fixes made in a CMS (alt text on uploaded images, link
text in articles) are `owner: "human"`.

## 6. Combine

```bash
node "${CLAUDE_SKILL_DIR}/scripts/combine.mjs" "<run>" [--style serif|sans] [--repo <repo>]...
```

It writes `<run>/report.md` (summary, an at-a-glance table, then every report with headings moved
down a level), `<run>/report.html` (fonts embedded, opens anywhere) and `<run>/report.pdf`. It prints
the three paths and the fix plan: quote them to the user, with the verdict and the "Fix first" list
in a few lines, then one line on the plan ("12 tasks: 9 for agents, 3 for you; run audit-fix to
start them").

`fix/TODO.md` lists the tasks for people first, then the agent tasks in rounds: tasks in one round
touch different files or repos and can run in parallel. Each `fix/tasks/NN-slug.md` is a
self-contained prompt with the problem, files, fix, "done when" check and the rules (one task only,
run the repo's checks, commit without pushing, never touch secrets or production, stop and report
when blocked). If `tasks.json` has errors, `combine.mjs` lists them and writes no plan; fix the file
and run it again (`--no-pdf` to skip the PDF while iterating).

Do not start fixing from here: this skill reports. When the user wants the fixes done, use the
audit-fix skill on the run folder.

The PDF is printed by headless Chrome, Chromium or Edge (installed apps, `CHROME_PATH`, `--chrome
PATH`, or Playwright's Chromium). With no browser it still writes `report.html` and says so; tell
the user to open it and print to PDF. `--no-pdf` skips the PDF.

To change only the look, run `combine.mjs` again with the other `--style`; nothing else re-runs.

## Re-running

"Run it again after the fixes": create a new run folder with the same name and repeat. Every audit
compares with its last run by itself (launch-audit and security-audit from their target folders,
solution-health from its state), and `--new` names the previous audit-all run for the "Since last
run" section.

## Files

- `scripts/combine.mjs`: run folder (`--new`), solution-health copy (`--repo`), merge and print.
- `scripts/lib/markdown.mjs`: the small Markdown renderer (raw HTML in reports is escaped).
- `scripts/lib/report.mjs`: finds reports, pulls headline numbers, builds the Markdown and HTML.
- `scripts/lib/pdf.mjs`: finds a browser and prints to PDF.
- `scripts/lib/tasks.mjs`: checks `tasks.json`, orders agent tasks into rounds, writes `fix/`.
- `scripts/lib/target-state.mjs`: target folders and run folders (kept in step with the copies in launch-audit and security-audit).
- `assets/report.css`: the A4 layout for both styles. `assets/fonts/`: Newsreader and IBM Plex
  (SIL Open Font License, see the `OFL-*.txt` files).
