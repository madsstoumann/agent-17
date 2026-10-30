---
name: audit-all
description: Use when someone wants the full audit of a site and its code in one go, a combined or all-in-one audit report, or one PDF covering launch readiness, accessibility, SEO and AI search (GEO), sustainability (carbon footprint), privacy and consent, domain and mail infrastructure, code security and dependency health. Runs launch-audit, a11y-audit (WCAG 2.2 / EN 301 549), seo-audit, eco-audit, privacy-audit and infra-audit on the live URL, security-audit and solution-health on one or more repos, then writes a combined report.md and a typeset report.pdf with a verdict and a ranked "fix first" list, plus a fix plan (fix/TODO.md and one agent-ready prompt per task, each with a suggested model) that the audit-fix skill can hand to subagents. Also when asked to combine existing launch-audit, a11y-audit, seo-audit, eco-audit, privacy-audit, infra-audit, security-audit or solution-health reports into one.
argument-hint: "[url] [repo path ...] [--url URL | --no-site] [--only|--skip|--add a11y,infra,launch,privacy,security,seo,health,eco] [--yes] [--style serif|sans|editorial|modern] [--out DIR]"
allowed-tools: AskUserQuestion, Bash(node:*), Bash(npx lighthouse:*), Bash(curl:*), Bash(dig:*), Bash(git log:*), Bash(git show:*), Bash(npm:*), Bash(dotnet:*), Bash(semgrep:*), Bash(command -v:*), Bash(cp:*), Bash(mkdir:*), Read, Write, Edit, Grep, Glob, WebFetch, WebSearch
metadata:
  version: "1.8.1"
---

# Audit all

One run folder, up to eight audits, one report. This skill does not check anything itself: it runs the
sibling skills (launch-audit, a11y-audit, seo-audit, eco-audit, privacy-audit, infra-audit, security-audit, solution-health), each writing its own `report.md`
as usual, then you write a short `summary.md` and `scripts/combine.mjs` merges everything into a
combined `report.md`, a self-contained `report.html` and a typeset `report.pdf`. You also write
`tasks.json`, and `combine.mjs` turns it into a fix plan: `fix/TODO.md` and one prompt per task in
`fix/tasks/`, ready for the audit-fix skill or for pasting into any session.

`${CLAUDE_SKILL_DIR}` is this skill's folder. The sibling skills sit next to it when installed as
the `skills` plugin (`${CLAUDE_SKILL_DIR}/../launch-audit/` and so on). If they are installed some
other way, invoke them by name instead (`skills:launch-audit` in the plugin, `launch-audit` on its own).

## 1. Work out the targets

- **Site URL** for launch-audit, a11y-audit, seo-audit, eco-audit, privacy-audit and infra-audit.
  `--url URL` or a URL in the request wins. Otherwise look in each repo for the live URL:
  `package.json` `homepage`, a `CNAME` file, the site URL in `nuxt.config.*`, `next.config.*`,
  `astro.config.*` or `.env.production`, Umbraco `appsettings.Production.json`, then the README.
  The candidates you find are the defaults for the URL question in step 1a; confirm once, never
  more. `--no-site` (or "no site", "just the code") skips the site audits. Staging URLs are fine;
  launch-audit works out the environment.
- **Repos** for security-audit and solution-health. Default: the current directory when it is a
  repo root (has `.git`). The user can name several ("audit-all ~/code/shop-web ~/code/shop-api
  https://shop.example.dk"); each gets its own run of both.
- **Audits.** Eight, by the names the user sees (flag name in brackets): Accessibility (`a11y`),
  Infrastructure (`infra`), Launch (`launch`), Privacy (`privacy`), Security (`security`),
  SEO / GEO (`seo`), Solution health (`health`), Sustainability (`eco`). `accessibility`,
  `infrastructure`, `geo` and `sustainability` work as flag names too. The **default set** is
  Infrastructure, Launch, Privacy, Security and Solution health; Accessibility, SEO / GEO and
  Sustainability are opt-in (slower, and mostly design and content work). `--only a11y,seo` runs
  exactly those, `--skip health` drops one from the default set and `--add seo` adds an opt-in
  one. "only launch and security", "also check accessibility", "no SEO", "skip the carbon check"
  and the like mean the same; "everything" or `--only all` runs all eight.
- **Look.** Two report styles: **Editorial** (`--style serif`, the default: Newsreader, like a
  printed report) and **Modern** (`--style sans`: IBM Plex Sans, like a web page). "editorial",
  "serif" or "print" mean serif; "modern", "sans", "sans-serif" or "plain" mean sans.

## 1a. Ask before starting

Unless flags already settle it (below), ask before creating the run folder, with
`AskUserQuestion`. The tool allows at most four options per question, has no pre-ticked boxes
and always adds an "Other" row that cannot be removed.

**First, one question** (single choice, header "Audits"), two options:

- "All": "Run all eight audits."
- "Customize": "Pick which audits to run."

In the same call, unless `--style` or the request settles it, a second question (single choice,
header "Look"): "Editorial (Recommended)": "Serif type, like a printed report" and "Modern":
"Sans-serif type, like a web page". It shows as a second tab, so the "All" path is two clicks.

"All" runs all eight and asks nothing more. "Customize" asks the **two picker questions** in one
second call:

1. **Audits 1/2** (multi-select, header "Audits 1/2"): Accessibility, Infrastructure, Launch,
   Privacy.
2. **Audits 2/2** (multi-select, header "Audits 2/2"): Security, SEO / GEO, Solution health,
   Sustainability.

Always in that order, alphabetical as above, with exactly those labels. Add " (Recommended)" to
the label of each audit in the default set; that is how the defaults show. Each option's
description says in a few words what it checks (Infrastructure: "Domain, DNS, mail
authentication, TLS"; Sustainability: "Page weight and CO2e per view"; SEO / GEO: "Search and AI
search: crawl, sitemap, structured data, llms.txt"; and so on).

The **live URL rides in the first question's text**, so it needs no screen of its own, and
"Other" becomes the place to change it:

- One URL detected or given: "Run every audit on glyptoteket.dk, or pick? Type a different URL,
  or 'no site', under Other." A URL typed under Other replaces the detected one; then ask the
  All/Customize question again with the new URL in it.
- None detected: "No live URL found. Type it under Other to include the site audits, or choose
  All or Customize for the code audits only."
- Two or more candidates: ask a "Site" question first, single choice: up to three candidates
  (likeliest first, "(Recommended)") plus "No site: code audits only".

Read "Other" on the Look question as a style wish and map it to the nearest of the two. Use the
second picker's "Other" for anything else the user types ("also ~/code/shop-api", "sans
style") and read it as part of the request. Leave out an option that cannot run (the site
audits with no site, Security and Solution health with no repo); if that leaves a question with
fewer than two options, fold the rest into the other question, and "All" means all that can run.
When a re-run finds a previous run (a `<reports>/audit-all/<name>/runs/` folder; `--new` in step
2 prints the same one), say in the first question which audits ran last time ("Last time:
Launch, Privacy, Security") and mark those "(Recommended)" in the pickers instead.

Read the answers literally: what is ticked runs, what is not is skipped. If every audit ends up
unticked, say so and stop. Repeat the final list in one line ("Running Infrastructure, Launch,
Privacy, Security and Solution health on glyptoteket.dk") and carry on without asking again; later steps (solution-health's manifest, security-audit's triage)
may still ask their own questions.

**Flags answer the questions,** so scripted runs and audit-fix never stop to ask. Only what is
still open is asked:

- `--yes` (or `-y`, "no questions", "just run it"): the default set (not All), Editorial, the detected URL (the first
  candidate; none found means no site audits, said in the summary).
- `--only`, `--skip` or `--add` settle what to run, and `--url` or `--no-site` settle where. Given
  one of each, nothing is asked. Given only what to run, ask for the URL in one plain line when
  none was detected (not at all when only code audits were picked); given only where, ask the
  All/Customize question.
- The audit list and URL spelled out in the request ("audit-all https://shop.example.dk, only
  launch and security").
- No `AskUserQuestion` tool (claude.ai, `claude -p`, a subagent, or audit-fix re-running the
  audits): use the flags and defaults, and list what ran and what was skipped in summary.md.

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
`combine.mjs` finds reports by the prefix `launch-audit`, `a11y-audit`, `seo-audit`, `eco-audit`, `privacy-audit`, `infra-audit`,
`security-audit` or `solution-health`,
optionally followed by `-<target>`. With one repo, plain names are fine; with several, add the repo
folder name.

| Audit | How | Writes |
|---|---|---|
| launch-audit | Follow launch-audit's SKILL.md with `--out "<run>/launch-audit"` (one folder per URL: `launch-audit-<host>`). Add `--skip privacy` when privacy-audit runs and `--skip tls` when infra-audit runs: those two own the cookie/tracker and TLS/DNS/email checks, so each finding appears once | `report.md`, `report.json` |
| a11y-audit | Follow a11y-audit's SKILL.md with `--out "<run>/a11y-audit"` (one folder per URL: `a11y-audit-<host>`). Run it after launch-audit and pass `--from "<run>/launch-audit/report.json"` so it samples the pages the crawl found; pass `--repo <name>` when one of the repos renders the site | `report.md`, `report.json`, `tasks.json` |
| seo-audit | Follow seo-audit's SKILL.md with `--out "<run>/seo-audit"` (pass `--production-host` and `--header` as for launch-audit) | `report.md`, `findings.json`, `pages.csv` |
| eco-audit | Follow eco-audit's SKILL.md with `--out "<run>/eco-audit"`. Add `--grid` and `--views` only when the user gives a country or traffic | `report.md`, `findings.json` |
| privacy-audit | Follow privacy-audit's SKILL.md with `--out "<run>/privacy-audit"`, including the policy review it asks you to add to `report.md` | `report.md`, `report.json`, `banner.png`, `policy-*.txt` |
| infra-audit | Follow infra-audit's SKILL.md with `--out "<run>/infra-audit"` | `report.md`, `report.json` |
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
  A11y, SEO, Eco, Privacy, Infra, Security or Health, comma-separated when several audits found the same thing.
- **Merge duplicates.** The same problem often shows up twice: an exposed `.env` (launch-audit) and a
  committed `.env` (security-audit), a weak CSP in headers and in `nuxt.config`, a vulnerable package
  in both security-audit and solution-health, missing alt text or low contrast in both launch-audit's
  Lighthouse section and a11y-audit, a canonical on the staging host (launch-audit on the start page,
  seo-audit site-wide), uncompressed or uncached files (launch-audit and eco-audit). One item, both sources.
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
| `owner` | `agent`, or `human` for anything an agent must not or cannot do: rotating secrets, DNS, CDN or hosting settings outside the repo, purging git history, product or legal calls. A security-audit rule with `owner: "human"` (platform credential files such as Umbraco Cloud's `umbraco-cloud.json`) is always a `human` task and never gets an agent task beside it: removing the file breaks the platform's deploys. While the repo is private it is a `low` review task ("Confirm umbraco-cloud.json is accepted risk": keep the repo private, review who has access, record the acceptance); only a public repo makes it a `blocker` (rotate in the Umbraco Cloud portal). Leave it out when its triage verdict is `accepted`. |
| `model` | For agent tasks, the cheapest tier that will do it well: `haiku` for mechanical, local edits (a header in a config file, a meta tag, alt text, a patch bump with no code changes); `sonnet` for ordinary code changes, multi-file edits and minor upgrades; `opus` for security fixes that need data-flow reasoning (injection, XSS, auth, SSRF), and for big jobs (a framework major or EOL runtime upgrade, replacing a closing API). `fable` only when the user asks for it. Left out, security and blocker tasks get `opus`, the rest `sonnet`. |
| `repo` | A key of `repos` (absolute path). Required for agent tasks. |
| `files` | Paths relative to the repo. Tasks in one repo that share a file, or that list no files, never run at the same time, so list them when you know them. |
| `evidence`, `fix` | From the reports: what is wrong where, and the fix. Quote code as code; never paste a secret, redact it. |
| `verify` | How to prove it is fixed: a command, a test to add, or the launch-audit check that should pass on the next run. |
| `sources` | `launch`, `a11y`, `seo`, `eco`, `privacy`, `infra`, `security`, `health`. `refs` (optional) points at the sub-report. seo-audit and eco-audit write a `findings.json` in this shape (severity, evidence, fix, verify, affected URLs): start from it, merge duplicates, and decide owner, repo and files. |

privacy-audit and infra-audit put ready-made task candidates in their `report.json` (`tasks`):
copy them in, renumbered, and merge duplicates. Infra tasks are nearly always `owner: "human"` (DNS,
registrar, mail provider). Privacy tasks become agent tasks when the repo holds the consent setup
(GTM snippet, CMP config, a hard-coded pixel or font link in a template).

Launch-audit findings are often fixed outside the code (CDN headers, DNS, redirects at the host).
Make them agent tasks only when the repo holds the setting (`nuxt.config`, `web.config`,
`next.config`, `vercel.json`, `staticwebapp.config.json`, middleware); otherwise `owner: "human"`.
The same goes for seo-audit and eco-audit: titles, canonicals, image formats and lazy loading are
usually templates or components in the repo, while sitemap plugins, image CDN settings and
content (descriptions, alt text, a hero video) are often CMS work for a person. Green hosting is
always `owner: "human"`.

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
down a level), `<run>/report.html` (fonts embedded, opens anywhere) and `<run>/report.pdf`, plus a
**compact** version, `report-compact.html` and `report-compact.pdf`: the same cover, verdict, Fix
first and at-a-glance table, then each audit with only what needs action. Check tables keep every
warn and fail and count the rest; other lists and tables (URLs, packages, cookies, pages) stop at
five rows with "…and N more in the full report"; per-item detail under a summary table, long code
blocks and reference sections (Not covered, Manual checks, Pages) are left out; sections with
nothing to fix are named in one line. Typically a third to a half of the pages. Both are always
written (`--no-compact` skips it): the compact one for managers and clients, the full one for the
people fixing things. It prints the paths and the fix plan: quote them to the user, with the verdict and the "Fix first" list
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

To change only the look, run `combine.mjs` again with the other `--style` (Editorial is `serif`, Modern is `sans`); nothing else re-runs.

## Re-running

"Run it again after the fixes": create a new run folder with the same name and repeat. The
questions in step 1a recommend the audits that ran last time; "same as last time" or `--yes`
with the same `--only` skips them. Every audit
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
