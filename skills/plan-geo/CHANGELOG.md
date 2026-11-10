# Changelog

All notable changes to the `plan-geo` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.5.0] - 2026-11-10

### Added
- `extract --urls a,b`: pages to read first and use as examples, as full URLs or paths.
- `extract --from-archive DIR` with no run folder or URL: the site is the one the archive holds, and audit-seo runs on the archive first. It stopped with "no input" before.

### Changed
- The page date comes only from where a page states its own date: a `<time>` element (its `datetime` only when the element shows a day) or an element classed as a date or byline within a few lines of the h1, an "opdateret / publiceret / updated / published" label (and the same in the other languages read) with a date, a date line right above or below the h1, or a press release dateline. Dates in body text, law references, FAQ answers, event and exhibition dates, deadlines, "Appointed / Joined / Born" labels, listing teasers and dates after today are never the page date; a page that shows none of the above has none.
- Bylines are names after a "By / Af / Authors:" label (also on the lines after a label line of its own) or in an element classed as an author. Teaser labels, staff lists, all-caps headings and the subject of a news story are no longer taken as authors.
- The example page of a template is its canonical URL: a page whose canonical points to another URL is ranked like one with a query string, a URL (or its canonical, or the target it redirects to) is never picked twice, a legal page (privacy, cookies, terms, accessibility) is the example only when the template has nothing else, and a calendar, archive or search listing is ranked after the section's other pages.
- `rich.mjs`: Event subtypes (ExhibitionEvent, MusicEvent, TheaterEvent, Festival, EventSeries and the rest of schema.org's list) get Google's Event rules in `check` and `samples`, as Event does.
- The consent-banner filter on page text also covers Cookie Information's wrapper and overlay.

### Fixed
- A date list ("5., 12. og 19. december 2026", "5, 12 and 19 December 2026") gave only the last day; every day is read now.
- A draft's event date without a year on the page ("Torsdag den 5. november kl. 17-22" for a startDate of 5 November at 17:00) was flagged as not on the page. A day and month shown without a year now match a startDate, endDate or other event date of that day; datePublished and dateModified still need the full date.

## [1.4.1] - 2026-11-10

### Changed
- SKILL.md documents `--insecure` and `AUDIT_HEADERS`.

## [1.4.0] - 2026-11-10

### Added
- `extract --from-archive DIR`: reads every page from a page archive (`index.json` plus `<slug>.html.gz`, as audit-seo `--save-html` writes it) instead of the site, and never starts Chrome. A thin page a live run would render uses the archived `<slug>.hidden.txt.gz` and `<slug>.txt.gz` for its text, hidden text and dates ("served HTML + archived text"; outline, questions and word count stay from the served HTML); without them it is read from its served HTML and marked "served HTML only". A page the archive does not hold is listed as not archived and skipped; `--allow-live` fetches it. `inventory.md`, `inventory.json` (`archive`) and `proposals.md` say on top that the plan was built from the archive of that date, not the live site, and list the degraded and missing pages. `samples --live` reads the same archive. With no earlier audit-seo run, audit-seo runs with `--from-archive` too.
- Masked secrets from an archive (`abcd…[masked <type>]`) are left out of the pages read, and `check` flags a draft value that holds one as "masked placeholder from the page archive, not a real value".
- `--no-validate`: the same as `--no-remote`. On `extract`, either is passed on to audit-seo when it has to run first.

## [1.3.0] - 2026-11-10

### Changed
- The example page of each template is a representative page, not the longest: one with a title of its own (not only the site name), not thin for its template, the most recent where pages are dated (published date, the date it shows, or a year in its path) in a template named as news, articles or case studies, then the longest; a URL with a query string is not picked. The longest page of a news section was often a legal statement titled only with the site name. The sample's reason reads "representative page of the template".
- The `check` note for a draft named after a page (when a template has the same name) says the page match is intended and the file name should stay; a draft for every page of that template is mentioned only as an optional second draft.

### Fixed
- `build --samples` posted every draft to validator.schema.org again right after the samples, hit HTTP 429 and showed "not reached". Samples now run first and `check` reuses their answers (each sample holds the draft), and every answer is kept for the run in `markup/validator.json` by the hash of what was posted, so `check`, `samples` and `build` never post the same draft or sample twice. After a 429 that outlasts the retries, `check` stops posting too.
- The page date (`Page date:` in `pages/*.md`, which `check` compares `datePublished` with) was the earliest date near the top, not the first: a news item dated above its h1 that cites an older order in its first paragraph got the older date. It is now the first date in reading order. `article:published_time` is read too: it is shown next to the page date, and used as the page date when the page shows no date near the top but does show that one.

## [1.2.2] - 2026-11-09

### Fixed
- `extract` listed a page's meta description under "Only in the Next.js payload" when the payload repeated it, though it is in the served HTML's `<meta name="description">`. Text the head already carries (title, meta description, og: and twitter: values) is left out of the payload-only text and its word count.

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
