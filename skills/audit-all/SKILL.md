---
name: audit-all
description: Use when someone wants the full audit of a site and its code in one go, a combined or all-in-one audit report, or one PDF covering launch readiness, code security and dependency health. Runs launch-audit on the live URL, security-audit and solution-health on one or more repos, then writes a combined report.md and a typeset report.pdf with a verdict and a ranked "fix first" list. Also when asked to combine existing launch-audit, security-audit or solution-health reports into one.
argument-hint: "[url] [repo path ...] [--style serif|sans] [--out DIR] [--skip launch,security,health]"
allowed-tools: Bash(node:*), Bash(npx lighthouse:*), Bash(curl:*), Bash(dig:*), Bash(git log:*), Bash(git show:*), Bash(npm:*), Bash(dotnet:*), Bash(semgrep:*), Bash(command -v:*), Bash(cp:*), Bash(mkdir:*), Read, Write, Edit, Grep, Glob, WebFetch, WebSearch
metadata:
  version: "1.0.0"
---

# Audit all

One run folder, three audits, one report. This skill does not check anything itself: it runs the
sibling skills (launch-audit, security-audit, solution-health), each writing its own `report.md`
as usual, then you write a short `summary.md` and `scripts/combine.mjs` merges everything into a
combined `report.md`, a self-contained `report.html` and a typeset `report.pdf`.

`${CLAUDE_SKILL_DIR}` is this skill's folder. The sibling skills sit next to it when installed as
the `skills` plugin (`${CLAUDE_SKILL_DIR}/../launch-audit/` and so on). If they are installed some
other way, invoke them by name instead (`skills:launch-audit` in the plugin, `launch-audit` on its own).

## 1. Work out the targets

- **Site URL** for launch-audit. If the user named one, use it. Otherwise look in each repo for the
  live URL: `package.json` `homepage`, a `CNAME` file, the site URL in `nuxt.config.*`,
  `next.config.*`, `astro.config.*` or `.env.production`, Umbraco `appsettings.Production.json`,
  then the README. One candidate: ask the user once to confirm it. None: ask for one, and accept
  "no site" to skip launch-audit. Staging URLs are fine; launch-audit works out the environment.
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

It prints the folder and creates it: `<reports>/audit-all/<name>-<YYYYMMDD-HHMM>/`. `<reports>` is
the same for every audit skill, first match wins:

1. `--out DIR` when the user names a folder (then use that instead of `--new`),
2. `$AUDIT_OUT_DIR`,
3. the Downloads folder if it exists and is writable (on Linux the XDG download folder first),
4. `~/audit-reports/`.

Do not put the run folder inside a repo unless asked: security reports can describe live secrets.

## 3. Run the audits

Run them one after another, each into its own sub-folder of the run folder. Folder names matter:
`combine.mjs` finds reports by the prefix `launch-audit`, `security-audit` or `solution-health`,
optionally followed by `-<target>`. With one repo, plain names are fine; with several, add the repo
folder name.

| Audit | How | Writes |
|---|---|---|
| launch-audit | Follow launch-audit's SKILL.md with `--out "<run>/launch-audit"` (one folder per URL: `launch-audit-<host>`) | `report.md`, `report.json` |
| security-audit | Follow security-audit's SKILL.md with `--out "<run>/security-audit-<repo>"`, including the triage and `report.md` it asks you to write. Semgrep runs automatically when installed | `findings.json`, `report.md` |
| solution-health | Follow solution-health's SKILL.md in the repo. It keeps its report in the repo (`.solution-health/report.md`) on purpose; pass the repo to `combine.mjs --repo` and it copies the report in | `.solution-health/` in the repo |

Each skill's own rules still apply (report only, no fixes, launch-audit only on sites the user owns
or works on). Keep each skill's chat summary to a few lines: the combined report is the deliverable.
If an audit cannot run (no Node 22 for Lighthouse, no network, no `.solution-health/manifest.json`
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
  Security or Health, comma-separated when several audits found the same thing.
- **Merge duplicates.** The same problem often shows up twice: an exposed `.env` (launch-audit) and a
  committed `.env` (security-audit), a weak CSP in headers and in `nuxt.config`, a vulnerable package
  in both security-audit and solution-health. One item, both sources.
- Use only facts from the reports. More `##` sections (for example "Can wait") are rendered too.

## 5. Combine

```bash
node "${CLAUDE_SKILL_DIR}/scripts/combine.mjs" "<run>" [--style serif|sans] [--repo <repo>]...
```

It writes `<run>/report.md` (summary, an at-a-glance table, then every report with headings moved
down a level), `<run>/report.html` (fonts embedded, opens anywhere) and `<run>/report.pdf`. It prints
the three paths: quote them to the user, with the verdict and the "Fix first" list in a few lines.

The PDF is printed by headless Chrome, Chromium or Edge (installed apps, `CHROME_PATH`, `--chrome
PATH`, or Playwright's Chromium). With no browser it still writes `report.html` and says so; tell
the user to open it and print to PDF. `--no-pdf` skips the PDF.

To change only the look, run `combine.mjs` again with the other `--style`; nothing else re-runs.

## Re-running

"Run it again after the fixes": create a new run folder and repeat. launch-audit can compare with the
previous run's `report.json` (`--baseline`), and solution-health always compares with its last state.

## Files

- `scripts/combine.mjs`: run folder (`--new`), solution-health copy (`--repo`), merge and print.
- `scripts/lib/markdown.mjs`: the small Markdown renderer (raw HTML in reports is escaped).
- `scripts/lib/report.mjs`: finds reports, pulls headline numbers, builds the Markdown and HTML.
- `scripts/lib/pdf.mjs`: finds a browser and prints to PDF.
- `assets/report.css`: the A4 layout for both styles. `assets/fonts/`: Newsreader and IBM Plex
  (SIL Open Font License, see the `OFL-*.txt` files).
