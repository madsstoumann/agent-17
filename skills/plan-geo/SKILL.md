---
name: plan-geo
description: Use when someone wants to know what structured data and what content a website should add to be understood and quoted by AI answer engines (ChatGPT, Perplexity, Gemini, Google AI Overviews) — the follow-up to a GEO audit. Reads the site's pages, works out what each page template is, drafts JSON-LD from the pages' own text (Organization, WebSite, Article, Product or SoftwareApplication, Service, Event, FAQPage, BreadcrumbList…) and checks every value is on the page, then maps the questions people ask in the site's field to the pages that answer them and writes content briefs for the gaps (FAQ blocks, comparison tables, glossary, "what is" pages). Also for the "technical GEO implementation" and "AI content framework" phases of a client proposal. Proposes work; it gives no verdict.
argument-hint: "<audit-seo or audit-all run folder | url> [--pages N] [--queries FILE] [--competitors a.com,b.com] [--repo PATH] [--only markup|content] [--out DIR] [--header NAME:VALUE] [--no-render] [--no-remote]"
allowed-tools: Bash(node:*), Read, Write
metadata:
  version: "1.0.0"
---

# GEO plan

audit-seo says what is wrong with a site's markup and whether AI crawlers can reach it. This skill
says what to **add**: the structured data each page template should carry, drafted from the
pages' own text, and the content the site is missing for the questions people ask AI engines in
its field. The output is a plan for a client (`proposals.md`) and tasks in audit-all's fix-plan
shape, so audit-fix can build the markup and page modules where there is a repo.

It is a `plan-` skill: no verdict, no `--level`, nothing passes or fails. Run it after audit-seo
(or audit-all with SEO / GEO); it reuses that crawl instead of crawling again. Only plan for sites
the user owns or works on.

Two parts, both by default: **markup** (Phase 2 of a GEO proposal: technical implementation) and
**content** (Phase 3: content gaps and guidelines). `--only markup` or `--only content` does one.

## 1. Extract

```bash
node "${CLAUDE_SKILL_DIR}/scripts/plan.mjs" extract <input> [--pages N] [--out DIR] [--header "Name: value"]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder. If it is not filled in, use the folder this
`SKILL.md` is in. Node 22 or newer, no dependencies. Run it with **`timeout: 900000`**.

`<input>` is, best first: an audit-all run folder (the plan goes into its `plan-geo/` sub-folder),
an audit-seo run folder or `report.json`, or the site's URL (the host's last audit-seo run is used;
with none, audit-seo runs first with `--geo`, a minute or two). `--queries`, `--competitors`, `--repo` and `--only`
are recorded in `inventory.json` for the later steps (a queries file is copied into the run
folder as `input-queries.<ext>`). Default `--pages 24`: the start
page, the longest page of each template, a second page of each large template, then pages with
three or more question headings. Pages whose served HTML is thin are rendered in Chrome
(`--no-render` turns that off). `--header` is the WAF bypass header, as for the audit skills.

It writes into the run folder:

- `inventory.md`: the templates (URL sections) with page counts, a guessed page type, the markup
  such pages usually carry, modules to consider, markup they have now, and the pages read.
- `pages/<slug>.md`: each page read, as Markdown with its dates, bylines, breadcrumb, logo, social
  profiles and existing JSON-LD on top. `pages/<slug>.json` holds the same plus the full text the
  check step compares drafts with.

Read `inventory.md`, then every `pages/*.md`. Stdout ends with the run folder and the path of the
site profile.

## 2. Write the plan

Write these files in the run folder (the site profile in the target folder). Write the briefs,
questions and summary in the site's language (`inventory.md` says which; English when unknown),
unless the user asks for another.

### Site profile

`site-profile.md` at the path extract printed (`<reports>/plan-geo/<host>/site-profile.md`). If it
exists, read it first and keep what the user wrote; update only what the pages contradict. Half a
page: what the organisation is and does (one sentence a buyer would understand), its products and
services by name, who it sells to (industries, roles, regions), the terms of its field it uses
(for simcorp.com: IBOR, ABOR, front-to-back, total portfolio, factor risk models), named
competitors or alternatives the site mentions, and the proof it shows (clients, awards, numbers).
Only what the pages say; anything you add from general knowledge goes under "Context (not from
the site)". This file is the industry framing everything else builds on.

### Markup (skip with `--only content`)

Read `references/page-types.md` for the types, properties and where each belongs.

1. **Confirm the page type of each template** from the pages you read; the guess in
   `inventory.md` is only a start. Legal pages get nothing beyond BreadcrumbList.
2. **`markup/site.jsonld`**: one `@graph` with Organization (or the more specific type the site
   is: Corporation, LocalBusiness, NGO, GovernmentOrganization…) and WebSite, with `@id`s
   (`https://<host>/#organization`, `#website`) that every other draft references. name, url,
   logo, `sameAs` (the social profiles extract found), description in the site's own words,
   contactPoint only from what the pages show.
3. **`markup/<template slug>.jsonld`** for each template worth marking up, drafted for its
   example page. The template slug is the template key with `/` written as `--`
   (`resources/insights` → `markup/resources--insights.jsonld`), and the draft is checked against
   the page in the `Example` column of `inventory.md`. To draft for another page, name the file
   after that page's slug in `pages/` instead. Reference the
   Organization by `@id` instead of repeating it. Article pages: headline, datePublished (and
   dateModified when shown), author as Person with name and jobTitle when the page names them,
   publisher by `@id`, image. Products: SoftwareApplication or Product by what the site sells;
   Service for services. BreadcrumbList from the trail extract found. FAQPage only where the page
   shows the questions and answers.
4. **Mark up only what is visible.** Every text value must be copied from the page, every date
   must be a date the page shows, every URL the page or a link on it. No ratings, prices, awards,
   founding years or headcounts the page does not show. The check step flags anything else.
5. **`markup/<slug>.md`** beside each draft: which CMS field or component fills each property
   for the whole template (`headline` = the page title field, `datePublished` = the article date
   field…), what the template lacks (no date field, author not structured), and the module the
   template should get (FAQ block, comparison table, key facts list) with the fields it needs.
   Where the site's stack is known (check-tech-stack, `report.md` of audit-launch, or the repo),
   say where the JSON-LD is rendered (a Next.js layout, a Sitecore rendering, an Umbraco partial).

Then run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/plan.mjs" check <run folder>
```

It parses each draft, applies Google's required and recommended properties (the same rules as
audit-seo), posts it to validator.schema.org (`--no-remote` skips that) and lists every value
the page does not show. Fix the drafts until each line is OK or the remaining notes are
deliberate (say why in the draft's `.md`): a value flagged "not on the page" is removed, or the
`.md` says the page must show it first.

### Content (skip with `--only markup`)

1. **The questions.** From the profile, list 20 to 40 questions buyers and their advisers put to
   AI engines about this field, not about the brand alone: definitions ("What is an IBOR?"),
   comparisons ("IBOR vs ABOR", "build vs buy a portfolio optimizer", the site's product vs the
   alternatives the site names), how-to and fit ("How do pension funds handle reform reporting?",
   "Which platform suits an insurer with private assets?"), pricing and implementation (time,
   cost drivers), proof (clients, results) and trust (security, compliance). With `--queries
   FILE` (Search Console queries, People Also Ask, the client's own list) start from those and
   say so. Competitors are named only when `--competitors` gives them or the site already names
   them.
2. **Map each question** to the page that answers it: `answered` (a page answers it directly
   and quotably), `partial` (the topic is covered but the answer is buried, scattered or
   implied), `missing`. Use the pages you read and the page titles in `inventory.md`; say
   `partial` rather than guess `answered` for pages you did not read.
3. **`content/questions.csv`** with the header `question,intent,status,page,brief`. intent is one
   of definition, comparison, how-to, fit, pricing, proof, trust, other; page is the URL that
   answers it (required unless missing); brief is the brief's file name when one covers it.
4. **`content/briefs/NN-<slug>.md`**, one per proposed page or module, most valuable first
   (format in `references/brief.md`). Group questions: one glossary covers twenty definitions;
   one comparison page covers a family of "X vs Y". A `partial` question usually becomes a module
   on the existing page (an FAQ block, a key-facts box, a comparison table, a definition
   paragraph at the top), not a new page.

### Tasks and summary

`tasks.json` in audit-all's shape (`references/brief.md` has an example), `sources:
["plan-geo"]`, ids `G1`, `G2`…:

- Markup for each template and the site graph, and each new module component (FAQ block,
  comparison table): `owner: "agent"` with `repo` and `files` when `--repo` was given or the
  user named the repo, else `owner: "human"` for the site's developers. `fix` names the draft
  (`markup/<slug>.jsonld`) and the mapping file; `verify` is "audit-seo --schema-only <example
  URL> shows the types with no errors" or the repo's own test.
- Content: `owner: "human"`, one task per brief, `fix` names the brief.
- Template changes the markup depends on (a date field, structured authors): `owner: "human"`,
  and the markup task `dependsOn` it.
- severity: `high` for the site graph and markup on the largest article or product templates,
  `medium` for the rest and for briefs answering many questions, `low` for nice-to-haves.

`summary.md`: three to six sentences for the client, no verdict: what the site is, the one or two
things that would make the biggest difference (usually: the site graph and article markup; then
the content gaps with the most questions behind them), and how much work is in the plan.

## 3. Build

```bash
node "${CLAUDE_SKILL_DIR}/scripts/plan.mjs" build <run folder>
```

It runs the check again, copies the profile into the run folder, writes `proposals.md` (summary,
profile, a markup table per template with each draft's check result, the question map, the
briefs, the tasks) and `fix/TODO.md` + `fix/tasks/*.md` from `tasks.json`, and keeps
`last-plan.json` in the target folder. `NOTE` lines name anything missing or malformed; fix and
build again.

## Present the result

1. What the site is, in one sentence (from the profile).
2. Markup: how many templates get markup, the site graph, and any value you had to leave out
   because the page does not show it (that is a content task, not a markup one).
3. Content: answered / partly / missing counts and the three briefs with the most questions
   behind them.
4. Tasks: how many for agents and for people, and that `/skills:audit-fix <run folder>` builds
   the agent ones in the repo.
5. The paths of `proposals.md` and `fix/TODO.md`.

Honesty rules:

- **This does not measure AI visibility.** Nothing here asks ChatGPT, Perplexity, Gemini or
  Google AI Overviews anything. Offer the question list as the test set: ask each engine before
  and after the work, by hand or with a visibility tracker.
- **The questions are an informed guess** unless `--queries` gave real search data. Say which.
- **Rich results are not promised.** FAQ rich results are limited to government and health
  sites; HowTo is retired. The markup is for meaning: which text is the answer, who wrote it,
  when, about what.
- **Templates, not pages.** The drafts are for one example page per template; the `.md` beside
  each says how the template fills it for every page. Say how many pages each template covers.
- **Comparisons with competitors are the client's call.** Propose them only for alternatives the
  site already names or `--competitors` lists, and say they need sign-off.
- **No invented facts.** If a good answer needs a number or claim the site does not make, the
  brief asks the client for it; it never supplies one.

## Example prompts

```
/skills:plan-geo https://www.example.com
What markup and content should we add for AI search? <audit-all run folder>
Phase 2 and 3 of the GEO proposal for https://www.simcorp.com
Draft JSON-LD for each page template of https://www.example.dk   (--only markup)
Which questions in our industry do we not answer yet? https://www.example.com   (--only content)
Content gaps for https://www.example.com using our Search Console export   (--queries queries.csv)
```

## Files

- `scripts/plan.mjs`: `extract`, `check` and `build` (`--help` lists every flag).
- `scripts/lib/templates.mjs`: templates from URL sections, page-type guesses, the sample.
- `scripts/lib/extract.mjs`: a page as Markdown, question-and-answer pairs, dates, bylines,
  breadcrumbs, organisation details, link and image URLs.
- `scripts/lib/verify.mjs`: the "is every value on the page" check.
- `scripts/lib/proposals.mjs`: questions.csv and proposals.md.
- Copies kept identical by tests: `html.mjs`, `render.mjs`, `rich.mjs`, `schema.mjs` (audit-seo),
  `tasks.mjs`, `levels.mjs` (audit-all), `target-state.mjs` (the audit skills).
- `references/page-types.md`: page type → schema.org types, properties, modules.
- `references/brief.md`: the brief format and a tasks.json example.
- Tests: `cd scripts && node --test test/*.test.mjs`.
