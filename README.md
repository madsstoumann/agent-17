# agent-17

Agent skills, in two plugins:

- [`skills/`](skills/): audits, checks and plans for websites and code. See [skills/README.md](skills/README.md) for the list and how they are versioned.
- [`memory/`](memory/): memory management for a project's AI agents. See [memory/README.md](memory/README.md).

[CONTRIBUTING.md](CONTRIBUTING.md) says which reported issues become a fix and how a fix is checked against saved sites (`tools/corpus/`) before it ships.

## Install the skills

The repository is a plugin marketplace with two plugins: `skills`, which holds every skill in `skills/`, and `memory`, which holds the memory setup in `memory/`. Install one or both and you get new skills and fixes as they land here.

### Claude Code

```text
/plugin marketplace add madsstoumann/agent-17
/plugin install skills@agent-17
/plugin install memory@agent-17
```

Or from your shell: `claude plugin install skills --marketplace madsstoumann/agent-17`.

The skills show up as `/skills:audit-launch`, `/skills:audit-seo` and so on, and Claude also picks them up on its own when a task matches. To get updates automatically, open `/plugin`, go to **Marketplaces**, select `agent-17` and choose **Enable auto-update**. Otherwise run `claude plugin update skills@agent-17` now and then.

### claude.ai and the Claude desktop app

1. Open [Customize > Plugins](https://claude.ai/customize/plugins).
2. Choose **Add > Add marketplace** and enter `madsstoumann/agent-17`.
3. Add **skills** (and **memory** if you want it). Turn on **Sync automatically** for the marketplace to get updates.

A plugin added on claude.ai is saved to your account, so it also loads in Cowork and in Claude Code when you are signed in with the same account. If you already uploaded some of these skills one by one under Customize > Skills, remove those copies so they don't trigger twice.

### One skill only

Copy its folder into `~/.claude/skills/` (Claude Code), or zip the folder and upload it under Customize > Skills (claude.ai).

## Setup for the audit skills

None of this is required; each item makes the audits (and audit-all) more complete.

### Environment variables

Set them in your shell profile (`~/.zshrc` on a Mac, then open a new terminal), or for Claude Code only in
`~/.claude/settings.json` under `"env": { … }`. Never put keys in a repo.

| Variable | What it does |
|---|---|
| `PSI_API_KEY` | Runs Lighthouse through the PageSpeed Insights API: real-user field data (CrUX), the same numbers as pagespeed.web.dev, and a fallback when a firewall blocks local Lighthouse. Without it Lighthouse runs locally with Chrome (lab data only). |
| `AUDIT_HEADERS` | Extra headers sent to the audited site, one `Name: value` per line, by every site audit (audit-launch and its Lighthouse runs, audit-a11y, audit-seo, audit-eco, audit-privacy, audit-infra's one page request, audit-security's site mode) and plan-geo. Used for the firewall bypass below; `--header` does the same for one run. |
| `AUDIT_OUT_DIR` | Where reports go. Default: your Downloads folder, else `~/audit-reports/`. |
| `CHROME_PATH` | The Chrome, Chromium or Edge to use when the skills cannot find one (audit-launch's local Lighthouse, audit-a11y, audit-seo, audit-eco, audit-privacy, plan-geo and audit-all's PDFs). |
| `GOOGLE_SAFE_BROWSING_KEY`, `URLHAUS_AUTH_KEY`, `VIRUSTOTAL_API_KEY` | Optional blocklist lookups for is-website-safe and audit-security's site mode. Without them only the keyless OpenPhish feed is checked, and the other blocklist rows are skipped. `URLSCAN_API_KEY` raises is-website-safe's urlscan.io quota. |
| `SECURITYHEADERS_API_KEY` | audit-launch: the securityheaders.com grade from their paid API. Without it the grade is read from their page or estimated, and the report says which. |
| `AUDIT_FROM` | audit-launch: a contact address sent as a `From` header (the same as `--from`). |

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
are recommended; Accessibility, SEO / GEO and Sustainability are opt-in. Security scans each repo
and, when there is a site, the live site too (audit-security's site mode), so a site with no repo
still gets a security section of its own. It also asks for the
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

plan-geo, the follow-up to a GEO audit, writes its plan in the same shape: `/skills:audit-fix <plan-geo run folder>` builds the markup and page modules, and the content briefs stay on the checklist for people.

## Parameters

You rarely need these: say what you want in plain words ("errors only", "skip Lighthouse", "just list the issues") and Claude picks the flags. They are here for scripted runs and for when you want to be exact. Every skill also answers `--help`.

### Shared by every report-writing skill

| Flag | What it does |
|---|---|
| `--level error\|warn\|info\|all` | What the report and the summary show. Takes a comma list, e.g. `error,warn`. Default `all`. **error** = fail, blocker, critical, high, red; **warning** = warn, medium, moderate, low, amber; **info** = info, review items. Saved data (`report.json`, `findings.json`, `tasks.json`, `last-report.json`) always keeps everything. |
| `--console` | A compact list in the terminal, one line per issue, errors first, instead of `report.md`. Add `--report` to get both, or `--out DIR` to keep the run's files in that folder. |
| `--out DIR` | Where this run's files go. Default `<reports>/<skill>/<site or repo>/runs/<stamp>/`, where `<reports>` is `$AUDIT_OUT_DIR`, else Downloads, else `~/audit-reports/`. |
| `--state DIR` | The folder kept between runs (`last-report.json`, `notes.md`). Default `<reports>/<skill>/<site or repo>/`. |
| `--baseline FILE` / `--no-baseline` | Compare with a specific earlier run, or not at all. Default: the last run of the same site or repo. |
| `--header "Name: value"` | Sent to the audited site only (a firewall bypass rule). Repeatable; also `AUDIT_HEADERS`. |
| `--insecure` | Accept a self-signed certificate (localhost, staging). |

audit-infra and audit-privacy take `--out`, `--baseline`, `--header`, `--level`, `--console` and `--report`, but not `--state`, `--no-baseline` or `--insecure`. check-tech-stack, is-website-safe and check-node-toolchain have their own flags, below.

### audit-all

| Flag | What it does |
|---|---|
| `--url URL` / `--no-site` | The live site to audit, or code audits only. |
| `--only`, `--skip`, `--add` | Which audits run: `a11y`, `infra`, `launch`, `privacy`, `security`, `seo`, `health`, `eco` (or `all`). Default: infra, launch, privacy, security, health. `security` runs on each repo and on the site; audit-launch then leaves the header and exposed-file checks to it (and TLS to `infra`, cookies and trackers to `privacy`), so each finding appears once. |
| `--geo` | A GEO audit: SEO / GEO (audit-seo `--geo`, with its GEO readiness score) plus Launch, and a summary that leads with AI search. |
| `--deep` | Passes `--deep` to audit-security (repos and site): the deep code review and the site's client-side checks. Much slower; other audits are unchanged. |
| `--yes` | No questions: the default audits, Editorial, level all, the detected URL. |
| `--style serif\|sans` | Report look: Editorial (`serif`, default) or Modern (`sans`). |
| `--level`, `--console` | As above. The level is passed to every audit and applied to `fix/TODO.md`; `--console` prints the fix plan as a list instead of the combined report and PDFs. |
| `--out DIR` | The run folder. |

`combine.mjs` (run by the skill) also takes `--repo PATH` (copy a repo's audit-solution-health report in), `--expect LIST` (the audits that ran; one that left no report becomes a "Failed" row with its kept stderr), `--no-pdf`, `--no-compact`, `--chrome PATH` and `--new <name>` (create a run folder).

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
| `--lighthouse local\|psi\|off` | Default `psi` with `PSI_API_KEY`, else `local`. With perf skipped, the scoreboard's CrUX row says "not run (perf skipped)". |
| `--email-domain D` | Where SPF and DMARC live (default: the host without www). |
| `--ssllabs` | Also run Qualys SSL Labs (slow). |
| `--no-remote` | Skip every third-party service. |
| `--timeout MS` / `--lh-timeout MS` / `--concurrency N` | Per request (15000), per Lighthouse run (240000), parallel requests (6). |
| `--ua STRING` / `--from EMAIL` | Override the User-Agent, add a From header. |
| `--strict` | Exit code 3 when anything fails, so a CI step can fail on it. Without it the exit code is 0 whatever the findings. |
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
| `--geo` | GEO view: `report.md` titled "GEO audit", showing the AI search rows and the indexing rows that decide what AI crawlers reach (robots.txt, noindex, sitemap, canonicals, JSON-LD coverage, titles), under a GEO readiness score in which info rows that point at something missing count ¾. `report.json` and `findings.json` keep everything. |
| `--render-pages N` | Pages rendered in headless Chrome (start page, pages without JSON-LD, then one per section) to find JSON-LD and text that JavaScript adds; the text, robots, canonical, title, h1 and internal links are compared with the served HTML that AI crawlers read (default 8, 0 to skip). Uses `CHROME_PATH` or finds Chrome. |
| `--bot-pages N` | Pages fetched with each AI crawler's user agent (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot…), bingbot and Googlebot, to find CDN or WAF rules that refuse them (default 3, 0 to skip). |
| `--pages N` | Pages to crawl (default 150), shared across language sections. |
| `--sitemap-sample N` | Extra sitemap URLs the crawl did not reach (default 50). |
| `--internal-links N` | Internal link targets past the `--pages` cap, checked for a status only (default 300, 0 to skip). |
| `--external-links N` | External links to check (default 150, 0 to skip). |
| `--schema-pages N` | Pages sent to validator.schema.org (default 8, 0 to skip). |
| `--production-host HOST` | The future live host. |
| `--no-remote` / `--no-validate` / `--ignore-robots` | Skip validator.schema.org (either flag) / crawl paths robots.txt disallows. |
| `--from-archive DIR` | Read every page from a page archive (`index.json` plus `<slug>.html.gz`) instead of the site; the URL may be left out. The HTML checks run; checks that need the network (external links, og:image, redirects, AI crawlers at the edge, Chrome renders, and robots.txt, sitemap and llms.txt when not archived) are listed as skipped, and the report says on its cover that it was built from the archive of that date. URLs the archive does not hold are not fetched. |
| `--allow-live` | With `--from-archive`: fetch what the archive does not hold from the site. |
| `--save-html DIR` | Also write every page the crawl fetched (as served, redirects not followed), plus robots.txt, sitemaps and llms.txt, as a page archive in `DIR`, for plan-geo or a later `--from-archive` run. Secrets are not masked. |
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
| `--no-ct` / `--max-subdomains N` | Skip the Certificate Transparency sweep (crt.sh, Cert Spotter when crt.sh does not answer), or limit the subdomains probed (default 30). |
| `--no-legacy` | Skip the TLS 1.0/1.1 probe. |
| `--platform-ok` | Audit a hosting platform's own domain anyway (`*.umbraco.io` and the like). |
| `--header "Name: value"` | Sent with the one request for the home page (a WAF bypass rule). |

### audit-security

| Flag | What it does |
|---|---|
| `[path]` | The repo to scan (default: the current folder). |
| `<url>` / `--url URL` | Site mode: the live site instead of a repo (headers, clickjacking via `frame-ancestors`, cookie flags, CORS, redirects, exposed files and admin paths, security.txt, blocklists; passive). Needs audit-launch next to it for the header, redirect and exposed-file checks. Its state is `<reports>/audit-security/<host>/`. |
| `--only` / `--skip` | Groups: `deps secrets xss injection request crypto config ci`; in site mode `headers redirects exposed blocklists` (and `client` with `--deep`). |
| `--deep` | The deep review. Code mode: extra trust-boundary rules, git history, an inventory of entry points and auth controls, Semgrep, osv-scanner, Gitleaks and TruffleHog when installed (a missing one is a "not checked" row; nothing is installed), and a coverage ledger Claude works through with a fresh agent checking every finding (`deep/`, checked by `scripts/deep-check.mjs`). Site mode: adds the `client` group (Subresource Integrity, public source maps, secrets in the JavaScript, vulnerable front-end libraries, public API descriptions). Method adapted from Cloudflare's security-audit skill (MIT). |
| `--header "Name: value"` / `--insecure` | Site mode: send a WAF bypass header (repeatable; also `AUDIT_HEADERS`) / accept a self-signed certificate. |
| `--history [N]` | Also scan the last N commits (default 1000) for removed secrets. |
| `--offline` | No vulnerability lookup, dependency inventory only (site mode: no blocklist lookups). |
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

### plan-geo

Three steps with Claude's writing in between; the skill runs them. `plan.mjs extract`, then Claude writes the profile, drafts, questions and briefs, then `plan.mjs check` and `plan.mjs build`. `plan.mjs samples` (or `build --samples`) writes sample pages with the proposed JSON-LD for the Rich Results Test and validator.schema.org.

| Flag | What it does |
|---|---|
| `<input>` | An audit-all run folder (the plan goes into its `plan-geo/`), an audit-seo run folder or `report.json`, or a URL (the host's last audit-seo run; with none, audit-seo runs first with `--geo`). |
| `--pages N` | Pages read in full (default 24): the start page, a representative page of each template (a title of its own, not thin, the most recent in news and article sections; its canonical URL; legal pages and listings last), a second page of large templates, then pages with three or more question headings. No URL is read twice. |
| `--urls a,b` | On `extract`: pages to read first and use as examples (full URLs or paths). |
| `--only markup\|content` | Plan the structured data only, or the content gaps only. Default both. |
| `--queries FILE` | Search Console queries, People Also Ask or the client's own questions to start the question map from (otherwise the questions are Claude's informed guess, and the plan says so). |
| `--competitors a.com,b.com` | Alternatives comparison briefs may name. Without it, only alternatives the site already names. |
| `--repo PATH` | The site's code, so markup and module tasks go to audit-fix as agent tasks. |
| `--no-render` | Never use Chrome (by default pages whose served HTML is thin are rendered). |
| `--no-remote` / `--no-validate` | On `check`, `samples` and `build`: do not send the drafts or samples to validator.schema.org. |
| `--from-archive DIR` | On `extract`: read every page from a page archive (as audit-seo `--save-html` writes it) instead of the site; the input may be left out. Thin pages use the archived text files where a live run would render them, and are marked "served HTML only" without them; pages not in the archive are skipped. The plan says on top it was built from the archive of that date. `samples --live` reads the same archive. |
| `--allow-live` | With `--from-archive`: fetch pages the archive does not hold from the site. |
| `--samples` | On `build`: write `samples/` first and link it from `proposals.md`. |
| `--live` | On `samples`: also write `<slug>.live.html`, the live page with its own JSON-LD replaced by the proposed graph and a `<base href>`, so it opens in a browser as the page would look after the work. |
| `--out DIR` / `--header "Name: value"` / `--insecure` | As above. |

### is-website-safe

| Flag | What it does |
|---|---|
| `<url or domain>` | The link or site to check, path included. Short links are followed. |
| `--brand X` | The site the user expects (`PostNord`, `postnord.dk`, or any brand name); any other domain is flagged as not theirs. |
| `--no-page` | Skip loading the page: name, registration, DNS and blocklists only. |
| `--json` | Print every fact as JSON instead of the summary. |

Optional keys, each adding one lookup: `GOOGLE_SAFE_BROWSING_KEY` (Google Safe Browsing), `VIRUSTOTAL_API_KEY`, `URLHAUS_AUTH_KEY` (abuse.ch) and `URLSCAN_API_KEY` (works without, lower quota). All have free tiers; see the skill for where to get them.

### check-node-toolchain

No flags.

## Adding a skill

Put it in its own folder under `skills/` with a `SKILL.md` and a `CHANGELOG.md`. The plugin picks it up with no other change. Refer to bundled scripts as `${CLAUDE_SKILL_DIR}/...`, not a fixed `~/.claude/skills/...` path, because a plugin installs the skill somewhere else. Add a row for it to the contents in [skills/README.md](skills/README.md#contents), and keep that row up to date when the skill changes or goes away. A skill about agent memory goes under `memory/` instead, with its row and flags in [memory/README.md](memory/README.md). Add its test folder to the matrix in `.github/workflows/test.yml`, and read [CONTRIBUTING.md](CONTRIBUTING.md) before changing a skill after an audit run.
