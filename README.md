# agent-17

Agent skills, in [`skills/`](skills/). See [skills/README.md](skills/README.md) for how they are versioned.

## Install the skills

The repository is a plugin marketplace. It has one plugin, `skills`, which holds every skill in `skills/`. Install it once and you get new skills and fixes as they land here.

### Claude Code

```text
/plugin marketplace add madsstoumann/agent-17
/plugin install skills@agent-17
```

Or from your shell: `claude plugin install skills --marketplace madsstoumann/agent-17`.

The skills show up as `/skills:audit-launch`, `/skills:audit-seo` and so on, and Claude also picks them up on its own when a task matches. To get updates automatically, open `/plugin`, go to **Marketplaces**, select `agent-17` and choose **Enable auto-update**. Otherwise run `claude plugin update skills@agent-17` now and then.

### claude.ai and the Claude desktop app

1. Open [Customize > Plugins](https://claude.ai/customize/plugins).
2. Choose **Add > Add marketplace** and enter `madsstoumann/agent-17`.
3. Add **skills**. Turn on **Sync automatically** for the marketplace to get updates.

A plugin added on claude.ai is saved to your account, so it also loads in Cowork and in Claude Code when you are signed in with the same account. If you already uploaded some of these skills one by one under Customize > Skills, remove those copies so they don't trigger twice.

### One skill only

Copy its folder into `~/.claude/skills/` (Claude Code), or zip the folder and upload it under Customize > Skills (claude.ai).

## Setup for the audit skills

None of this is required; each item makes audit-launch (and audit-all) more complete.

### Environment variables

Set them in your shell profile (`~/.zshrc` on a Mac, then open a new terminal), or for Claude Code only in
`~/.claude/settings.json` under `"env": { … }`. Never put keys in a repo.

| Variable | What it does |
|---|---|
| `PSI_API_KEY` | Runs Lighthouse through the PageSpeed Insights API: real-user field data (CrUX), the same numbers as pagespeed.web.dev, and a fallback when a firewall blocks local Lighthouse. Without it Lighthouse runs locally with Chrome (lab data only). |
| `AUDIT_HEADERS` | Extra headers sent to the audited site by audit-launch, Lighthouse and audit-a11y, one `Name: value` per line. Used for the firewall bypass below. |
| `AUDIT_OUT_DIR` | Where reports go. Default: your Downloads folder, else `~/audit-reports/`. |

```bash
export PSI_API_KEY=AIza...                              # no quotes needed
export AUDIT_HEADERS="x-audit-bypass: <your value>"     # quotes needed: the value has a space
```

### Get a PageSpeed Insights key

1. Open the [Google Cloud console](https://console.cloud.google.com/) and pick or create a project.
2. **APIs & Services > Library**, search for **PageSpeed Insights API**, and choose **Enable**.
3. **APIs & Services > Credentials > Create credentials > API key**.
4. Edit the key: under **API restrictions**, restrict it to the PageSpeed Insights API.
5. Set it as `PSI_API_KEY`. It is free; without a key the shared quota usually answers 429.

### Let audit-launch past a Vercel firewall

Vercel's Bot Protection can show headless Chrome a "Vercel Security Checkpoint" that a person's browser
passes without noticing. Lighthouse then fails, and the report says "blocked by Vercel bot challenge".
For a site you run, add a rule that lets requests with a secret header through:

1. Make a value: `openssl rand -hex 24`.
2. In the Vercel project: **Firewall > ⋯ > Configure > Add New… > Rule**. Name it "audit-launch bypass".
3. **If** `Request Header` `x-audit-bypass` **Equals** your value, **Then** **Bypass**.
4. **Save Rule**, then **Review Changes > Publish**. It applies at once, no redeploy.
5. Locally: `export AUDIT_HEADERS="x-audit-bypass: <your value>"` (or pass `--header` for one run).

Notes:

- A custom Bypass rule skips custom rules and managed rules such as Bot Protection. It does **not**
  skip **Attack Mode** or Vercel's own DDoS mitigations. If the Firewall overview shows Attack Mode
  doing the challenging, turn it off under **Bot Management** (it is meant for an ongoing attack), use
  a System Bypass rule for your IP (Pro and Enterprise), or rely on `PSI_API_KEY`.
- The script sends the header only to the audited host. Lighthouse loads a real page, so it sends the
  header with every request the page makes, third-party scripts included. Use a value made only for
  this rule and replace it if it leaks. It is redacted in the saved Lighthouse JSON.
- Cloudflare works the same way: a WAF custom rule (header equals your value) with the **Skip** action.

## Running every audit at once

`/skills:audit-all` asks first: **All** (all eight audits) or **Customize**, with the live URL it
found in the repo named in the question (type another one under "Other"). Customize shows two
screens of four: Accessibility, Infrastructure, Launch, Privacy, then Security, SEO / GEO,
Solution health, Sustainability. Infrastructure, Launch, Privacy, Security and Solution health
are recommended; Accessibility, SEO / GEO and Sustainability are opt-in. It also asks for the
report's look: Editorial (serif, like a printed report) or Modern (sans-serif). Every run writes
two PDFs: `report.pdf` (everything) and `report-compact.pdf` (only what needs action, long URL and
package lists cut to five rows). Flags skip the questions:

```text
/skills:audit-all https://shop.example.dk --yes               # default audits, no questions
/skills:audit-all --url https://shop.example.dk --add a11y,seo
/skills:audit-all --no-site --only security,health
```

## Running audits automatically

To run the audits on pull requests, after preview deploys or on a schedule (GitHub Actions, `claude -p`, or the plain Node scripts without Claude), see [skills/audits.md](skills/audits.md).

## Fixing what an audit finds

audit-all writes a fix plan next to its report: `fix/TODO.md` and one prompt per task in `fix/tasks/`,
each with a suggested model. To have agents do the work, ask for it after the audit, in the same session
or a later one:

```text
/skills:audit-fix                     # the newest audit-all run
/skills:audit-fix ~/Downloads/audit-all/shop.example.dk-20261030-0927
```

It shows the plan, asks once, then runs one subagent per task in its own git worktree and branch.
Fixes that pass end up on a local `audit-fix/<run>` branch per repo for you to review and merge;
nothing is pushed. Tasks marked for people (rotating secrets, DNS, hosting settings) stay on the
checklist. You can also paste any single prompt from `fix/tasks/` into a Claude Code session in that repo.

## Parameters

You rarely need these: say what you want in plain words ("errors only", "skip Lighthouse", "just list the issues") and Claude picks the flags. They are here for scripted runs and for when you want to be exact. Every skill also answers `--help`.

### Shared by every report-writing skill

| Flag | What it does |
|---|---|
| `--level error\|warn\|info\|all` | What the report and the summary show. Takes a comma list, e.g. `error,warn`. Default `all`. **error** = fail, blocker, critical, high, red; **warning** = warn, medium, moderate, low, amber; **info** = info, review items. Saved data (`report.json`, `findings.json`, `tasks.json`, `last-report.json`) always keeps everything. |
| `--console` | A compact list in the terminal, one line per issue, errors first, instead of `report.md`. Add `--report` to get both. |
| `--out DIR` | Where this run's files go. Default `<reports>/<skill>/<site or repo>/runs/<stamp>/`, where `<reports>` is `$AUDIT_OUT_DIR`, else Downloads, else `~/audit-reports/`. |
| `--state DIR` | The folder kept between runs (`last-report.json`, `notes.md`). Default `<reports>/<skill>/<site or repo>/`. |
| `--baseline FILE` / `--no-baseline` | Compare with a specific earlier run, or not at all. Default: the last run of the same site or repo. |
| `--header "Name: value"` | Sent to the audited site only (a firewall bypass rule). Repeatable; also `AUDIT_HEADERS`. |
| `--insecure` | Accept a self-signed certificate (localhost, staging). |

### audit-all

| Flag | What it does |
|---|---|
| `--url URL` / `--no-site` | The live site to audit, or code audits only. |
| `--only`, `--skip`, `--add` | Which audits run: `a11y`, `infra`, `launch`, `privacy`, `security`, `seo`, `health`, `eco` (or `all`). Default: infra, launch, privacy, security, health. |
| `--geo` | A GEO audit: SEO / GEO (audit-seo `--geo`, with its GEO readiness score) plus Launch, and a summary that leads with AI search. |
| `--yes` | No questions: the default audits, Editorial, level all, the detected URL. |
| `--style serif\|sans` | Report look: Editorial (`serif`, default) or Modern (`sans`). |
| `--level`, `--console` | As above. The level is passed to every audit and applied to `fix/TODO.md`; `--console` prints the fix plan as a list instead of the combined report and PDFs. |
| `--out DIR` | The run folder. |

`combine.mjs` (run by the skill) also takes `--repo PATH` (copy a repo's audit-solution-health report in), `--no-pdf`, `--no-compact`, `--chrome PATH` and `--new <name>` (create a run folder).

### audit-fix

| Flag | What it does |
|---|---|
| `[run folder]` | Which audit-all run to fix. Default: the newest. |
| `--only T1,T4` / `--skip T7` | Run only these tasks, or all but these. |
| `--max-parallel N` | Agents running at the same time (default 4). |
| `--dry-run` | Show the plan, run nothing. |

### audit-launch

| Flag | What it does |
|---|---|
| `--env dev\|staging\|production` | Which environment this is. Default: guessed from the hostname. On dev and staging, noindex is expected and goes on a "Before production" list. |
| `--production-host HOST` | The future live hostname, for canonical, og:url and sitemap checks. |
| `--pages N` | Extra sitemap pages for Lighthouse, indexable ones from different sections (default 3). |
| `--max-pages N` / `--max-external N` | Crawl limit (default 100) and external links checked (default 200). |
| `--skip a,b` / `--only a,b` | Groups: `crawl redirects notfound tls dns email exposed headers caching perf a11y privacy links social icons ops`. `--skip perf` skips Lighthouse. |
| `--lighthouse local\|psi\|off` | Default `psi` with `PSI_API_KEY`, else `local`. |
| `--email-domain D` | Where SPF and DMARC live (default: the host without www). |
| `--ssllabs` | Also run Qualys SSL Labs (slow). |
| `--no-remote` | Skip every third-party service. |
| `--timeout MS` / `--lh-timeout MS` / `--concurrency N` | Per request (15000), per Lighthouse run (240000), parallel requests (6). |
| `--ua STRING` / `--from EMAIL` | Override the User-Agent, add a From header. |
| `--strict` | Exit code 3 when anything fails (CI). |
| `--json` / `--quiet` | report.json on stdout / no progress output. |

### audit-a11y

| Flag | What it does |
|---|---|
| `--wcag A\|AA\|AAA` | WCAG target (default AA). `--level A`, `AA` or `AAA` still works. |
| `--pages N` | Pages to audit, start page included (default 10). |
| `--from FILE` / `--urls FILE` | Take the pages from a audit-launch `report.json`, or exactly the URLs in a file. |
| `--keyboard N` / `--max-tabs N` | Keyboard walk on the first N pages (default 3, 0 to skip), Tab presses per walk (200). |
| `--repo NAME[=PATH]` | The repo that renders the site, so tasks become agent tasks. |
| `--chrome PATH` / `--timeout MS` | Browser to use, page load timeout (30000). |

### audit-seo

Give it a URL for the site-wide audit, or a local HTML file to check that file's structured data only.

| Flag | What it does |
|---|---|
| `--schema-only` | Structured data on the given page only: validator.schema.org, Google rich-result rules, JSON-LD added by JavaScript, every issue on its own line. No crawl. Implied for a local file. |
| `--geo` | GEO view: `report.md` titled "GEO audit", showing the AI search rows and the indexing rows that decide what AI crawlers reach, under a GEO readiness score. `report.json` and `findings.json` keep everything. |
| `--render-pages N` | Pages rendered in headless Chrome (start page, pages without JSON-LD, then one per section) to find JSON-LD and text that JavaScript adds; the text is compared with the served HTML that AI crawlers read (default 8, 0 to skip). Uses `CHROME_PATH` or finds Chrome. |
| `--bot-pages N` | Pages fetched with each AI crawler's user agent (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot…), bingbot and Googlebot, to find CDN or WAF rules that refuse them (default 3, 0 to skip). |
| `--pages N` | Pages to crawl (default 150), shared across language sections. |
| `--sitemap-sample N` | Extra sitemap URLs the crawl did not reach (default 50). |
| `--internal-links N` | Internal link targets past the `--pages` cap, checked for a status only (default 300, 0 to skip). |
| `--external-links N` | External links to check (default 150, 0 to skip). |
| `--schema-pages N` | Pages sent to validator.schema.org (default 8, 0 to skip). |
| `--production-host HOST` | The future live host. |
| `--no-remote` / `--ignore-robots` | Skip validator.schema.org / crawl paths robots.txt disallows. |
| `--concurrency N` / `--timeout MS` / `--quiet` | Parallel requests (6), per request (15000), no progress output. |

### audit-eco

| Flag | What it does |
|---|---|
| `[more page urls]` / `--pages N` | Extra pages to measure, or N indexable ones from different sections of the sitemap (default 4). |
| `--grid CODE` | The visitors' country for grid intensity (`DK`, `SE`, `DEU` …). Default: global average. |
| `--views N` | Page views a month, for a yearly CO2e estimate. |
| `--mobile` | Phone viewport instead of desktop. |
| `--no-browser` | Estimate from the HTML, no Chrome. |
| `--no-remote` | Skip the Green Web Foundation lookup. |
| `--chrome PATH` / `--timeout MS` / `--quiet` | Browser, page load timeout (45000), no progress output. |

### audit-privacy

| Flag | What it does |
|---|---|
| `--pages N` | Extra pages loaded before consent (default 2). |
| `--only first,reject,accept` | Which visitors to simulate (default all three). |
| `--lang L` | Browser language (default `da-DK,da,en`). |
| `--no-policy` | Do not open the privacy and cookie policy pages. |
| `--chrome PATH` | Browser to use. |

### audit-infra

| Flag | What it does |
|---|---|
| `--email-domain D` | Mail domain when it is not the site's own. |
| `--dkim-selector S` | Your provider's DKIM selector (repeatable). |
| `--only` / `--skip` | Groups: `domain email tls edge ct`. |
| `--no-ct` / `--max-subdomains N` | Skip the Certificate Transparency sweep, or limit it (default 30). |
| `--no-legacy` | Skip the TLS 1.0/1.1 probe. |
| `--platform-ok` | Audit a hosting platform's own domain anyway (`*.umbraco.io` and the like). |

### audit-security

| Flag | What it does |
|---|---|
| `[path]` | The repo to scan (default: the current folder). |
| `--only` / `--skip` | Groups: `deps secrets xss injection request crypto config ci`. |
| `--history [N]` | Also scan the last N commits (default 1000) for removed secrets. |
| `--offline` | No vulnerability lookup, dependency inventory only. |
| `--no-tests` | Leave out hits in test, fixture and docs paths. |
| `--max N` | Hits printed per rule (default 6). |
| `--visibility public\|private\|internal` | The repo's visibility when `gh` cannot tell. |
| `--json` | findings.json on stdout. |

### audit-solution-health

| Flag | What it does |
|---|---|
| `--root PATH` | The solution to check (default: the current folder). |
| `--in-repo` / `--dir PATH` | Keep state in the repo (`.audit-solution-health/`), or in a folder of your choice. |
| `--transitive` | Also check packages further down the dependency tree. |
| `--offline` / `--no-enrich` | No network lookups / skip the extra package health data. |
| `--skip packages,runtimes,apis` | Leave out a check. |
| `--level`, `--console` | As above, on `finalize.mjs`: red is an error, amber a warning. |
| `--dry-run` | On `finalize.mjs`: preview without saving. |

### check-tech-stack

| Flag | What it does |
|---|---|
| `<url> …` / `--file PATH` | Sites to check, or a file with one URL per line. |
| `--browser` / `--no-browser` | Always render each page in headless Chromium / never (by default only a page whose HTML shows little, when Playwright is installed). |
| `--pages N` | Also read up to N same-site pages linked from the start page (default 0, max 10). |
| `--no-history` | Do not compare with the site's last run or save this one. |
| `--offline` | Skip the npm lookup of each library's latest version. |
| `--assets N` | Same-site scripts and stylesheets read per site (default 12). |
| `--jobs N` / `--timeout MS` | Sites in parallel (4), per request (15000). |
| `--out DIR` / `--insecure` / `--json` / `--quiet` | As for the other skills. |

### is-website-safe

| Flag | What it does |
|---|---|
| `<url or domain>` | The link or site to check, path included. Short links are followed. |
| `--brand X` | The site the user expects (`PostNord`, `postnord.dk`, or any brand name); any other domain is flagged as not theirs. |
| `--no-page` | Skip loading the page: name, registration, DNS and blocklists only. |
| `--json` | Print every fact as JSON instead of the summary. |

Optional keys, each adding one lookup: `GOOGLE_SAFE_BROWSING_KEY` (Google Safe Browsing), `VIRUSTOTAL_API_KEY`, `URLHAUS_AUTH_KEY` (abuse.ch) and `URLSCAN_API_KEY` (works without, lower quota). All have free tiers; see the skill for where to get them.

### enable-memory-management

| Flag | What it does |
|---|---|
| `--root DIR` | The project (default: the current folder). |
| `--memory DIR` | The memory folder. Default: Claude Code's auto memory for the project (`autoMemoryDirectory` if set). Pass it for a team store, `/mnt/memory/<store>` or `/memories`. |
| `--transcripts DIR` / `none` | Session transcripts to count (default: Claude Code's for the project), or skip them. Also reads exported event pages and Managed Agents session events (`.json`, `.jsonl`). |
| `--since YYYY-MM-DD` | Only sessions on or after this date. |
| `--exclude a/,b/**` | Leave vendored or generated markdown out of the docs checks. |
| `--audit-only` | Measure and summarise; no question, no changes. |
| `--dream` | The dreaming pass: sessions since the last dream against the memory, numbered proposals with quotes and counts, applied only when accepted. |
| `--lint` | Errors and warnings for instructions, memory and skills, no files written, exit 1 on an error (for a hook or CI). |
| `--level`, `--console`, `--out`, `--state`, `--no-baseline` | As above. |
| `--budget-lines N` / `--index-bytes N` | Change the budgets (200 lines always loaded; 25,000 bytes for `MEMORY.md`). |

`snapshot.mjs` (run by the skill) takes `--memory DIR`, `--diff`, `--list`, `--sha FILE`, `--check FILE --expect SHA` and `--restore STAMP --yes`. `sessions-export.mjs` takes `--agent AGENT_ID --out DIR [--since YYYY-MM-DD] [--max N]` and reads `ANTHROPIC_API_KEY`: it saves a Managed Agents agent's recent sessions for a dream run. Running the skill with Claude Managed Agents (a memory store and a weekly dreamer deployment): [its README](skills/enable-memory-management/README.md#set-it-up-with-managed-agents).

### check-node-toolchain

No flags.

## Adding a skill

Put it in its own folder under `skills/` with a `SKILL.md` and a `CHANGELOG.md`. The plugin picks it up with no other change. Refer to bundled scripts as `${CLAUDE_SKILL_DIR}/...`, not a fixed `~/.claude/skills/...` path, because a plugin installs the skill somewhere else. Add a row for it to the contents in [skills/README.md](skills/README.md#contents), and keep that row up to date when the skill changes or goes away.
