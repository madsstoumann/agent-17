# Changelog

All notable changes to the `plan-geo` skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). See [../README.md](../README.md) for the versioning convention.

## [1.0.0] - 2026-11-06

### Added
- First version: the follow-up to a GEO audit. Proposes the structured data and the content a site needs to be understood and quoted by AI answer engines; no verdict.
- `plan.mjs extract`: reads an audit-seo or audit-all run (or runs audit-seo first for a URL), groups the crawl into templates by URL section with a guessed page type, reads a sample of pages in full (Chrome when the served HTML is thin) and writes `inventory.md` and `pages/<slug>.md|json`: Markdown text, question-and-answer pairs, the page's own date and other dates, bylines, breadcrumb, logo, social profiles, phone, email, link and image URLs, existing JSON-LD.
- Claude writes `site-profile.md` (kept in the target folder and reused), `markup/*.jsonld` drafts with a field mapping per template, `content/questions.csv`, `content/briefs/`, `tasks.json` and `summary.md` (SKILL.md, `references/page-types.md`, `references/brief.md`).
- `plan.mjs check`: each draft parsed, Google's required and recommended properties (audit-seo's rules), validator.schema.org, and every text value, URL and date checked against the page; a publication date must be the date the page shows as its own.
- `plan.mjs build`: `proposals.md` (summary, profile, markup per template with check results, the question map, briefs, tasks) and `fix/TODO.md` + `fix/tasks/` in audit-all's shape for audit-fix (`sources: ["plan-geo"]`).
- Flags: `--pages`, `--only markup|content`, `--queries`, `--competitors`, `--repo`, `--out`, `--header`, `--no-render`, `--no-remote`, `--insecure`.
