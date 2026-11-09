# Changelog

All notable changes to the `plan-geo` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.2.1] - 2026-11-09

### Fixed
- Text from a Next.js page's script payload (`lib/rsc.mjs`, shared with audit-privacy) is read from the page's own components only. The not-found and error pages, inline script bodies, nav and footer labels, an app store link and the header's promo teasers were on every page and were counted as each page's hidden text, added to `pages/<slug>.md` and appended to the last FAQ answer on the page. Closed accordion answers are still read and question counts are unchanged.
- `check` no longer words a draft named after a page as a naming mistake. For `markup/visit.jsonld` when a template "visit" also exists, it said "not the example of template "visit" (name the draft visit-annual-pass.jsonld for that)"; it now says the draft is checked against the page its name matches, and that markup for every page of the template would be a separate draft.

## [1.2.0] - 2026-11-09

### Fixed
- `check` matches `markup/<name>.jsonld` to a page slug before a template slug. When a page and a template share a name (the page /visit and the template "visit", whose example is /visit/annual-pass), the draft was checked against the template's example instead of the page it was written for. The check line now says when a template of the same name exists and how to name the draft for its example.
- Dates written in Danish, Norwegian, Swedish, German, Dutch, French and Spanish count as shown on the page ("1. oktober 2026", "d. 9. november 2026", "1er octobre 2026", "1 de octubre de 2026"), as do ranges whose first part has no year ("1. oktober – 29. marts 2027", "3.–5. juni 2026"). Only English month names were read, so the ISO dates in a draft for a Danish page were reported as "date not shown on the page". A date without a year is still not a full date.
- Text behind closed accordions and tabs on Next.js sites is read. When the content only mounts on open, it is in the React Server Components payload (`self.__next_f.push(…)` scripts) and nowhere in the served or rendered HTML, so FAQ answers came out empty and drafts that quoted them failed the check. The payload text is now in the page record (`hidden`, with `questions` marked `hidden: true`), at the end of `pages/<slug>.md` under "Only in the Next.js payload", in `inventory.md`'s "Read as" column, and counts for the check. New `lib/rsc.mjs`, shared with audit-privacy.

## [1.1.0] - 2026-11-09

### Added
- `plan.mjs samples <run folder>`: one `samples/<slug>.html` per draft, the site graph and the draft merged into the one `@graph` the page would carry (a draft node with a site `@id` is merged into it), in a small page that names the page it is for and how to test it in Google's Rich Results Test or validator.schema.org. `site.jsonld` gets `samples/site.html` when there is no start-page draft. `samples/README.md` lists each sample with its page, types, validator.schema.org result and what Google's rich-result rules still ask for.
- `--live` (on `samples`): also fetches each draft's page and writes `<slug>.live.html`, the live page with its own JSON-LD replaced by the sample's and a `<base href>`, so it opens in a browser as the page would look after the work.
- `--samples` (on `build`): writes the samples first and links `samples/README.md` from `proposals.md`.

### Changed
- The site graph holds Organization and WebSite only (SKILL.md, `references/page-types.md`). A SoftwareApplication or Product in it is on every page, where Google flags it as an invalid rich result without a price or rating; on example.com every article sample showed an invalid software app. `check` now says to move such a node to its own template's draft.
- validator.schema.org posts from `samples` wait and retry on a rate limit (HTTP 429), and after one that outlasts the retries the remaining samples are left for pasting by hand instead of waiting on each.

## [1.0.1] - 2026-11-07

### Changed
- Example hostnames in the docs, changelog and tests are placeholders now (example.com and similar).

## [1.0.0] - 2026-11-06

### Added
- First version: the follow-up to a GEO audit. Proposes the structured data and the content a site needs to be understood and quoted by AI answer engines; no verdict.
- `plan.mjs extract`: reads an audit-seo or audit-all run (or runs audit-seo first for a URL), groups the crawl into templates by URL section with a guessed page type, reads a sample of pages in full (Chrome when the served HTML is thin) and writes `inventory.md` and `pages/<slug>.md|json`: Markdown text, question-and-answer pairs, the page's own date and other dates, bylines, breadcrumb, logo, social profiles, phone, email, link and image URLs, existing JSON-LD.
- Claude writes `site-profile.md` (kept in the target folder and reused), `markup/*.jsonld` drafts with a field mapping per template, `content/questions.csv`, `content/briefs/`, `tasks.json` and `summary.md` (SKILL.md, `references/page-types.md`, `references/brief.md`).
- `plan.mjs check`: each draft parsed, Google's required and recommended properties (audit-seo's rules), validator.schema.org, and every text value, URL and date checked against the page; a publication date must be the date the page shows as its own.
- `plan.mjs build`: `proposals.md` (summary, profile, markup per template with check results, the question map, briefs, tasks) and `fix/TODO.md` + `fix/tasks/` in audit-all's shape for audit-fix (`sources: ["plan-geo"]`).
- Flags: `--pages`, `--only markup|content`, `--queries`, `--competitors`, `--repo`, `--out`, `--header`, `--no-render`, `--no-remote`, `--insecure`.
