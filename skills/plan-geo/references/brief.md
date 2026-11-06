# Content brief format

One file per proposed page or module: `content/briefs/NN-<slug>.md`, most valuable first. Write it
in the site's language. Keep it to what an editor needs to write the page without a meeting.

```markdown
# <Working title>

**Type:** new page | module on an existing page (<URL>) | rewrite of <URL>
**Answers:** <the questions from questions.csv it covers, one per line>
**Audience:** <who asks, in the profile's words>
**Why:** <one or two sentences: the gap, and what the site already has to build on>

## Proposed title and h1
<title, under 60 characters> / <h1>

## Outline
1. <Heading as a question or plain statement> — <what the first two sentences must say: the direct answer>
2. …
(Include the module: "Comparison table: <columns> × <rows>", "FAQ block: <questions>".)

## Facts to use
- <fact> — from <URL on the site>
- <fact the client must supply> — ASK THE CLIENT (never invent it)

## Links
- From: <existing pages that should link here, with the anchor text>
- To: <pages this one should link to>

## Markup
<types, e.g. Article + FAQPage for the FAQ block, DefinedTerm for each glossary entry>

## Owner and sign-off
<who writes it; competitor comparisons and claims need the client's sign-off>
```

# tasks.json example

audit-all's fix-plan shape (audit-fix reads it). `sources: ["plan-geo"]`, ids G1, G2, …

```json
{
  "subject": "www.example.com",
  "repos": { "web": "/Users/me/code/example-web" },
  "tasks": [
    {
      "id": "G1",
      "owner": "agent",
      "repo": "web",
      "files": ["src/app/layout.tsx"],
      "title": "Render the site graph (Organization + WebSite) on every page",
      "severity": "high",
      "sources": ["plan-geo"],
      "area": "structured data",
      "evidence": "No page carries Organization or WebSite JSON-LD (audit-seo, 184 pages).",
      "fix": "Render markup/site.jsonld from this plan as a <script type=\"application/ld+json\"> in the root layout. Values are in the draft; keep the @id values.",
      "verify": "audit-seo --schema-only https://www.example.com/ lists Organization and WebSite with no errors.",
      "refs": ["plan-geo/markup/site.jsonld"]
    },
    {
      "id": "G2",
      "owner": "human",
      "title": "Add a structured date and author to the article template",
      "severity": "medium",
      "sources": ["plan-geo"],
      "area": "CMS template",
      "evidence": "Articles show the date and authors as plain text only.",
      "fix": "Add date and author (person reference) fields to the article template so the markup can read them.",
      "verify": "The fields exist and are filled on the example article."
    },
    {
      "id": "G3",
      "owner": "agent",
      "repo": "web",
      "dependsOn": ["G2"],
      "title": "Article markup on the insights template",
      "severity": "high",
      "sources": ["plan-geo"],
      "fix": "Build Article + BreadcrumbList JSON-LD from the template fields, following markup/resources--insights.jsonld and its .md mapping.",
      "verify": "audit-seo --schema-only on the example article shows Article with datePublished and author, no errors."
    },
    {
      "id": "G4",
      "owner": "human",
      "title": "Write the glossary page",
      "severity": "medium",
      "sources": ["plan-geo"],
      "area": "content",
      "fix": "Write the page in content/briefs/01-glossary.md (answers 14 definition questions)."
    }
  ]
}
```

Without a repo, the markup tasks are `owner: "human"` for the site's developers; the fix text is
the same.
