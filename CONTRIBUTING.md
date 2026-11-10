# Changing the skills

Running the skills on a new site will always turn up something. This page decides what becomes a code change and what does not, so the skills get more general with each batch of sites instead of more tuned to the last one.

## Sort every reported issue first

Give each issue from an audit run one of four labels before anything is changed:

| Label | What it is | Where it goes |
|---|---|---|
| **Wrong verdict** | A fail that should pass (or the reverse), advice for something the site does not have, the audit breaking its own measurement | A PR, with a corpus diff |
| **Over-reach** | The skill guessed and guessed wrong (a date, an author, which text is hidden, which host is staging) | A PR that makes the skill say "unknown" or "degraded", never a smarter guess |
| **Preference** | Wording, which page is the example, a threshold that could reasonably sit elsewhere | `todo.md`, done in one batch a week; or an override flag for that site (`--urls`, `--production-host`, `notes.md`) |
| **New check** | Something the skill does not look at yet | `todo.md` as a feature, not a fix |

Only the first two become PRs straight away. Several issues with the same cause are one fix.

## Rules for a fix

1. **Read explicit signals, otherwise say "unknown".** A value comes from a place made to hold it: `<time datetime>`, `article:published_time`, JSON-LD, a labelled byline ("By", "Af"), the canonical URL, a header. When none is there, report that the page does not state it. A missing value is not a ticket; a wrong one is.
2. **Degraded, not wrong.** When the input is unusual (a firewall challenge, a re-signed TLS chain, an empty or titleless answer, a file an archive does not hold) the row is skipped with `environment: "degraded"` and a reason. It is never a fail and never a task.
3. **Lists are data, not code.** Hosting platforms, staging words and vendor hosts belong in a data file or the Public Suffix List, not in a regular expression next to the check.
4. **Advice comes from the finding.** Fix text names only what the site actually sends (a directive it has, a value it uses), built from the check's own data.
5. **A new heuristic shows its corpus diff.** Run the corpus check (below) and put its summary in the PR. If a rule written for one site changes others, it is the wrong rule. If it changes none, an override flag is usually cheaper.
6. **No real sites in this repo.** Tests, fixtures, changelogs and PRs use `example.com`, `example.dk` and the like.

## The corpus check

`tools/corpus/corpus.mjs` runs audit-seo and plan-geo from this checkout over saved page archives (`audit-seo --save-html` writes them) with no network, and writes one digest per site: every row verdict and count, the example page of each template, and the date, bylines, word counts and questions of each page plan-geo reads. The archives and the golden digests live in the private reports repo, never here.

```bash
# before a change: are the golden digests still current?
node tools/corpus/corpus.mjs check --archives <reports repo>/reports --golden <reports repo>/corpus/golden

# after the change: what does it move? (exit 1 when something changed)
node tools/corpus/corpus.mjs check --archives <reports repo>/reports --golden <reports repo>/corpus/golden --md corpus-diff.md

# when the diff is what you meant, update the golden digests in the reports repo
node tools/corpus/corpus.mjs check … --update
```

It takes about half a minute for six sites. Summarise `corpus-diff.md` in the PR body without host names ("2 of 6 sites: one page date now unknown, one row warn → pass"); the full diff with hosts goes in the reports repo.

## Tests

Every test folder runs on each PR (`.github/workflows/test.yml`). Run one locally with `cd skills/<name>/scripts && node --test test/*.test.mjs`. A new test folder must be added to the workflow's matrix; a check in the workflow fails when one is missing.
