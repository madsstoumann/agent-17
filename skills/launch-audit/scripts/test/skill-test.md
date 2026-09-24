# Skill-level test (writing-skills discipline: RED before the skill, GREEN with it)

Prompt used for both runs, verbatim:

> We go live with https://akqa-dk-ioi-nuxt-dev-yij8m.ondigitalocean.app/ next week — test it and give me a report.

## RED — baseline, no skill (2026-09-24)

A general-purpose subagent with Bash, WebFetch and WebSearch, no skill.

- Cost: 26 min wall clock, ~255k tokens, 45 tool calls (42 numbered steps in its command log).
- What it did: curl/dig/openssl by hand, crawled all 318 sitemap URLs + locale prefixes,
  checked 379 external links, grepped 131 JS chunks for config, drove headless Chromium
  through Playwright on 7 pages, compared with the current ioi.dk sitemap.
- What it found: genuinely useful, deep findings (dev CMS host baked into the bundle, empty
  GTM/reCAPTCHA keys, locale duplicates, the /umbraco proxy enumerating the content tree,
  edge cache bypassed by a Set-Cookie, 1,277 images without alt, transient 521s under load).
- What it did NOT do — every item on the owner's manual list:
  - no Lighthouse / PageSpeed scores ("Not tested: … Lighthouse")
  - no securityheaders.com grade, no MDN Observatory
  - no W3C validation, no schema.org validation
  - no reusable output (a narrative report, no JSON to diff next time)
  - treated the dev environment's noindex as blocker B1 without the "expected here, reverse
    at launch" framing
- Rationalisations observed: none explicit; it simply had no checklist and followed what it
  found, which is why the four validators never came up.

Lesson encoded in SKILL.md: run the script first (deterministic, 4–7 min, covers the manual
list), present blockers → before-production → warnings → scoreboard → skips, and *offer* the
deep investigations (bundle config leaks, old-site sitemap diff, forms) rather than doing 25
minutes of ad-hoc probing by default.

## GREEN — with the skill (2026-09-24, same prompt, skill installed but not named)

- Cost: 20.7 min, ~189k tokens, 28 tool calls (baseline: 26 min, ~255k, 45).
- Triggered the skill on its own (tool call 1: `Skill — launch-audit`), read sibling repos for the
  production host, then ran `audit.mjs … --env dev --production-host ioi.dk --email-domain ioi.dk`
  with `timeout 600000`. One script run, 110 s.
- Answer followed the recipe: verdict → launch blockers ("none by the script's definition") →
  "Before production" checklist (noindex header/meta, robots Disallow, staging hostnames,
  canonical/og:url/sitemap host, a test page in the sitemap, old-site redirects, DNS cut-over)
  → warnings grouped → scoreboard → "Skipped or estimated" → report paths → offered deep-dives.
- Rubric: ran the script ✔ · `--env dev` ✔ · report path quoted ✔ · blockers first ✔ · noindex
  framed as expected-on-dev + production must-do ✔ · securityheaders grade: opened the page with
  the Playwright MCP and reported the confirmed A, saying the script's was an estimate ✔ · skips
  named ✔ · SEO annotated "depressed by noindex" ✔ · deep-dives offered ✔ · single Bash timeout ✔.
- Miss: steps 12–26 of its log are deep-dives it ran unasked (Lighthouse JSON for the LCP
  element, a live-vs-new sitemap diff, CSP host review, locale checks). Good findings, but the
  skill says offer, not run.

## REFACTOR

Added to SKILL.md: an explicit post-script budget (stdout summary, one read of report.md,
optional Playwright grade check; everything else is a deep-dive to offer) and two red-flag rows
("grep the Lighthouse JSON for the LCP element", "compare with the old site's sitemap").

Rubric used above: ran `audit.mjs` (not hand-rolled curl); passed `--env dev`; report.md written
and its path quoted; led with blockers and the Before-production list; noindex framed as expected
on dev + must-do for production; securityheaders grade labelled estimated with the link (or
confirmed); skipped services named as not checked; Lighthouse SEO annotated as depressed by
noindex; deep-dives offered, not run; finished inside one Bash timeout (`timeout: 600000`).
