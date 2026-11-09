# Page types, markup and modules

What each kind of page should carry for AI answer engines, and which content modules fit it.
"Required" follows Google's structured-data docs where Google has a rich result (the same rules
audit-seo's `rich.mjs` checks); elsewhere it is what makes the entity unambiguous. Mark up only
what the page shows.

## The site graph (every site)

One `@graph` in `markup/site.jsonld`, rendered on every page (or at least the start page), that
every other draft points at by `@id`. Only the two types below: a product, service or event in the
site graph would be on every page, and Google flags a SoftwareApplication or Product without a
price or rating as an invalid rich result wherever it appears. Give the flagship product an `@id`
(`https://<host>/#<product>`) in its own template's draft instead, and point at it from elsewhere.

| Type | Properties | Notes |
| --- | --- | --- |
| Organization (or Corporation, NGO, LocalBusiness, GovernmentOrganization, EducationalOrganization) | `@id` `https://<host>/#organization`, name, url, logo (ImageObject with url), sameAs (social profiles, Wikipedia/Wikidata when the site links them), description | legalName, foundingDate, address, contactPoint, numberOfEmployees only when a page shows them. `parentOrganization` / `subOrganization` for brands the site presents (Example / Axioma). |
| WebSite | `@id` `https://<host>/#website`, url, name, publisher → `#organization`, inLanguage | No SearchAction unless the site has a search page that takes a query parameter. |

## Per template

| Page type | Types | Key properties | Modules worth proposing |
| --- | --- | --- | --- |
| home | Organization + WebSite (the site graph), WebPage | about → `#organization` | Key facts (what, for whom, proof), short FAQ about the company |
| article, insight, white paper, guide | Article (or TechArticle, Report) + BreadcrumbList | headline, description, image, datePublished, dateModified, author (Person: name, jobTitle, url; worksFor when shown), publisher → `#organization`, mainEntityOfPage, about / mentions (DefinedTerm or Thing for the topics) | Key takeaways at the top, FAQ block for the questions the text answers, a definition paragraph for each term it relies on |
| news, press release | NewsArticle + BreadcrumbList | as Article; dateline date is the datePublished | Key facts box (who, what, when, where) |
| case study, client story | Article + BreadcrumbList; about → the client as Organization (name, url) | headline, the client, the product used (mentions → `#product`), results as text | Results box (numbers the story states), challenge / solution / result headings, a quote (Quotation or Review only if it is a real quote) |
| product, platform, module | SoftwareApplication (applicationCategory BusinessApplication, operatingSystem "Web" when SaaS) or Product; Service when what is sold is work | name, description, brand / provider → `#organization`, url, image, featureList (from the page's feature list), audience (BusinessAudience with audienceType) | Comparison table (versus the old way, versus build in-house, between editions), FAQ block (fit, implementation, integration, security), key facts (who uses it, scale) |
| service, managed service, training | Service (Course + CourseInstance for training with dates) | name, serviceType, provider → `#organization`, areaServed, audience, offers only with a shown price | FAQ (scope, duration, what is included), comparison of service tiers |
| industry or audience landing | WebPage with about / audience; or Service per industry | audience (BusinessAudience audienceType "Pension funds"), mentions the products | "Challenges we solve" as question headings, FAQ for that audience, comparison table of approaches |
| event, webinar | Event + BreadcrumbList | name, startDate, endDate, eventAttendanceMode, eventStatus, location (Place or VirtualLocation), organizer → `#organization`, performer (Person) | Agenda list, speakers |
| job | JobPosting | title, description, datePosted, validThrough, hiringOrganization → `#organization`, jobLocation, employmentType | FAQ about hiring |
| person, author, leadership | Person (ProfilePage on the bio page) | name, jobTitle, worksFor → `#organization`, image, sameAs (their LinkedIn), knowsAbout | Author bio box on articles that links here |
| about | AboutPage; the Organization with more detail | as the site graph, plus the facts the page states (founding year, headquarters, employees) | Key facts list, timeline |
| contact, offices | ContactPage; Organization with address and contactPoint per office | address (PostalAddress), telephone, email as shown | |
| FAQ, help | FAQPage | mainEntity: Question (name) with acceptedAnswer (Answer text), only questions shown on the page | |
| glossary | DefinedTermSet + DefinedTerm per term | name, description, inDefinedTermSet, url with a fragment per term | The glossary itself: one short definition each, linked from the articles that use the terms |
| legal | BreadcrumbList only | | |

## Modules

| Module | When | Fields the CMS needs | Markup |
| --- | --- | --- | --- |
| FAQ block | A page answers recurring questions, or the question map has partial answers for it | question, answer (rich text), optional anchor | FAQPage on pages whose main content is the Q&A; otherwise Question/Answer inside the page's own type is optional |
| Comparison table | "X vs Y", "build vs buy", editions, old way vs new way | caption, column headers, rows, a one-line conclusion above the table | none needed; a real `<table>` with `<th>` and `<caption>` is what engines read |
| Key facts / key takeaways | Long articles, case studies, product pages | 3–6 short statements, each true on its own | none (plain list near the top) |
| Definition paragraph | Pages that rely on a term the reader may not know | term, one-sentence definition, link to the glossary | DefinedTerm via `about` or `mentions` |
| Glossary | Many definitions questions in the map | term, definition, related terms | DefinedTermSet |
| Author box | Articles with named authors | person reference (name, role, photo, bio link) | Person via `author` |

## Writing for answers (for briefs)

- Start each section with the direct answer in one or two sentences; detail after.
- Use the question as the heading when people ask it that way.
- Facts as lists or tables; numbers with their unit, date and source.
- One idea per paragraph, short enough to quote.
- Name things the way the field names them (and give the site's own product name next to the
  generic term: "Example One, an investment book of record (IBOR) platform").
- Date the page and name the author; update the date when the content changes.
