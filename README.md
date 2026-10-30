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

The skills show up as `/skills:launch-audit`, `/skills:validate-schema` and so on, and Claude also picks them up on its own when a task matches. To get updates automatically, open `/plugin`, go to **Marketplaces**, select `agent-17` and choose **Enable auto-update**. Otherwise run `claude plugin update skills@agent-17` now and then.

### claude.ai and the Claude desktop app

1. Open [Customize > Plugins](https://claude.ai/customize/plugins).
2. Choose **Add > Add marketplace** and enter `madsstoumann/agent-17`.
3. Add **skills**. Turn on **Sync automatically** for the marketplace to get updates.

A plugin added on claude.ai is saved to your account, so it also loads in Cowork and in Claude Code when you are signed in with the same account. If you already uploaded some of these skills one by one under Customize > Skills, remove those copies so they don't trigger twice.

### One skill only

Copy its folder into `~/.claude/skills/` (Claude Code), or zip the folder and upload it under Customize > Skills (claude.ai).

## Setup for the audit skills

None of this is required; each item makes launch-audit (and audit-all) more complete.

### Environment variables

Set them in your shell profile (`~/.zshrc` on a Mac, then open a new terminal), or for Claude Code only in
`~/.claude/settings.json` under `"env": { … }`. Never put keys in a repo.

| Variable | What it does |
|---|---|
| `PSI_API_KEY` | Runs Lighthouse through the PageSpeed Insights API: real-user field data (CrUX), the same numbers as pagespeed.web.dev, and a fallback when a firewall blocks local Lighthouse. Without it Lighthouse runs locally with Chrome (lab data only). |
| `AUDIT_HEADERS` | Extra headers sent to the audited site by launch-audit, Lighthouse and a11y-audit, one `Name: value` per line. Used for the firewall bypass below. |
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

### Let launch-audit past a Vercel firewall

Vercel's Bot Protection can show headless Chrome a "Vercel Security Checkpoint" that a person's browser
passes without noticing. Lighthouse then fails, and the report says "blocked by Vercel bot challenge".
For a site you run, add a rule that lets requests with a secret header through:

1. Make a value: `openssl rand -hex 24`.
2. In the Vercel project: **Firewall > ⋯ > Configure > Add New… > Rule**. Name it "launch-audit bypass".
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

`/skills:audit-all` asks first, on two screens: which of the eight audits to run (Accessibility,
Infrastructure, Launch, Privacy, Security, SEO / GEO, Solution health, Sustainability), with the
live URL it found in the repo named in the question (type another one under "Other").
Infrastructure, Launch, Privacy, Security and Solution health are recommended; Accessibility,
SEO / GEO and Sustainability are opt-in. Flags skip the questions:

```text
/skills:audit-all https://shop.example.dk --yes               # default audits, no questions
/skills:audit-all --url https://shop.example.dk --add a11y,seo
/skills:audit-all --no-site --only security,health
```

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

## Adding a skill

Put it in its own folder under `skills/` with a `SKILL.md` and a `CHANGELOG.md`. The plugin picks it up with no other change. Refer to bundled scripts as `${CLAUDE_SKILL_DIR}/...`, not a fixed `~/.claude/skills/...` path, because a plugin installs the skill somewhere else.
