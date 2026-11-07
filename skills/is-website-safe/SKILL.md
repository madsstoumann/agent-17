---
name: is-website-safe
description: Use when someone asks whether a website or link is safe, real, legit or a scam — "is this the real PayPal/MitID/PostNord site?", a link from an SMS or email, a webshop with prices too good to be true, a lookalike or spoofed domain (paypa1.com, apple-support-login.xyz), a phishing page, or a fake copy of a famous site. Checks what the name imitates, what the page asks for, phishing blocklists, domain and certificate age, history, popularity and Trustpilot, and gives a verdict with the red flags.
argument-hint: "<url or domain> [--brand <real site or brand name>] [--no-page] [--json]"
allowed-tools: Bash(node:*), WebFetch, WebSearch
metadata:
  version: "2.0.1"
---

# Is this website safe?

One script answers the question people really ask: is this the site it pretends to be, a copy of
a famous one, or a fake shop? It looks at the name (lookalikes of about 150 brands that phishing
and fake shops copy, Danish ones included), the page (what it calls itself, whether it asks for a
password, card or CPR number, where those forms send it, whether it wears the brand's icon or loads
its files), phishing blocklists, how old the domain and its first certificate are, whether it
changed hands, how popular it is, and Trustpilot. It prints a verdict, the red flags and the facts
behind them. Your job is to run it, add what it could not get, and give a plain answer.

It is **read-only**: DNS lookups and ordinary GETs, never a form submitted, never a login tried. The
page is fetched with a normal browser user agent, so it is safe to check a phishing link this way;
never open such a link in a real browser for the user.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check.mjs" <url or domain> [flags]
```

`${CLAUDE_SKILL_DIR}` is this skill's folder. Run it through Bash with `timeout: 180000`; a run takes
10-60 seconds, mostly crt.sh. Progress goes to stderr, the summary to stdout. Pass the whole URL the
user got (path included), not just the domain: where the link lands matters.

| Flag | Use it when |
|---|---|
| `<url or domain>` | Always. Short links (bit.ly) are followed; the checks run on where they land. |
| `--brand X` | The user says what the site should be: "is this really PostNord?", "my bank is Danske Bank". A listed brand name, the real domain (`--brand postnord.dk`), or any brand name (looked up on Wikidata). Any other domain is then flagged as not theirs. |
| `--no-page` | Only when the user does not want the page loaded at all. |
| `--json` | You need a fact the summary leaves out (every form action, every resource host, raw dates). |

Optional keys, read from the environment; each adds a lookup and nothing breaks without them:

| Variable | Service | Get it |
|---|---|---|
| `GOOGLE_SAFE_BROWSING_KEY` | Google Safe Browsing (phishing, malware) | Free API key in Google Cloud; non-commercial use (Web Risk API for commercial) |
| `VIRUSTOTAL_API_KEY` | VirusTotal domain verdicts from 70+ engines | Free community key, 4 requests a minute, non-commercial |
| `URLHAUS_AUTH_KEY` | abuse.ch URLhaus (malware distribution) | Free at auth.abuse.ch |
| `URLSCAN_API_KEY` | urlscan.io search (works without, lower quota) | Free account |

Mention the missing keys only when the verdict is Unknown or Caution and a blocklist answer would settle it.

## What it checks

| Group | Checks |
|---|---|
| Imitation | Typos (`paypa1`, `micros0ft`, `uspss`), homoglyphs and mixed alphabets (`pаypal` with a Cyrillic а, shown as `xn--`), the brand plus lure words (`netflix-trial`, `apple-support-login`), the brand on another TLD, the brand's domain or name as a subdomain (`paypal.com.verify.xyz`, `facebook.webmau.vn`), free names on shared hosts (`netflix-trial.vercel.app`) |
| The page | Title and site name (a page calling itself Spotify on an unrelated domain), password, card, CPR and one-time-code fields, forms posting to other sites, data sent to Telegram bots or Discord webhooks, the brand's own favicon, files loaded from the brand's servers, a different page for scripts than for browsers (cloaking), pressure wording, and for webshops: bank-transfer-only or crypto payment, free-mail contact, no CVR/VAT or terms, 50-90% discounts, a Trustpilot badge for another site |
| Blocklists | Quad9 and Cloudflare's security resolver (they refuse names on their threat feeds), the OpenPhish feed, urlscan.io verdicts, and with keys Google Safe Browsing, VirusTotal and URLhaus |
| History | Registration date (RDAP, else whois), registry hold status, first certificate in Certificate Transparency, first Wayback Machine snapshot (a domain archived for years but registered last month changed hands), Tranco popularity rank, hosting network |
| Reviews | Trustpilot page for the exact domain (never a search result for a similar name) |

## The verdict

| Verdict | When |
|---|---|
| **Dangerous** | Any one hard red flag: on a blocklist; imitates a brand and is young, asks for credentials or card, calls itself that brand or wears its icon; presents itself as a brand on an unrelated domain while asking for a password or card; sends form input to a chat bot; not the site the user expected (`--brand`). Nothing else outweighs these. |
| **Suspicious** | Two warnings, or one strong one (a lookalike name, registered this month, bank transfer only, a free page asking for a login) |
| **Caution** | One warning |
| **Trusted** | A brand's own listed domain, or one of the 100,000 most visited sites, with no warnings |
| **Likely safe** | Old and visible enough (years of history, top-million rank) with no warnings |
| **Unknown** | No red flags but too little history to vouch for it. Common for a new honest shop; say so rather than guessing |

The score (0-100) is capped by the verdict. Lead with the verdict, never with the score.

## Fill the gaps

The summary ends with "Not available this run". Fill what matters:

- **Trustpilot** often refuses scripts (HTTP 403). Open the exact URL it prints
  (`https://www.trustpilot.com/review/<domain>`) with WebFetch and read the rating, the number of
  reviews and the newest few. Never use a search result for another domain: lookalikes are
  routinely matched to the real brand's page. A burst of five-star reviews within a few days, or
  recent reviews saying "never received" or "scam", outweigh the average.
- **Registration date** for TLDs without RDAP (.dk and others) comes from whois on port 43; if a
  network blocks that, the certificate and Wayback dates stand in. Say which one you used.
- **Company number**: when a shop states a CVR, open `https://datacvr.virk.dk/` search for it, or
  WebSearch "CVR <number>", and check the name and address match the shop and the company is active.
- **Unknown brand**: if the page claims a brand that is not in the list and `--brand` found nothing,
  WebSearch for the brand's official site and compare the domain yourself.

Never visit the page in a real browser or follow its links for the user. Do not submit anything.

## Answer

Keep it short and lead with the answer:

```
**<verdict>**: <one sentence why, naming the brand it imitates or the deciding fact>.

<what to do: "Don't log in; the real site is paypal.com" / "Pay only by card so you can charge back" / "Fine to use">

Red flags
- <danger and warn lines, most serious first, in plain words>

Good signs
- <good lines worth knowing>

<one line on anything that could not be checked, if it matters>
```

When it imitates a brand, always give the brand's real domain. When someone has already entered
a password or card number, tell them to change the password on the real site, call their bank to
block the card (in Denmark also contact MitID if they used it), and report the site: to the brand,
to Google (safebrowsing.google.com/safebrowsing/report_phish) and in Denmark to
the police or Forbrugerombudsmanden for fake shops.

## Limits

- A blocklist miss proves little: most phishing sites live a day or two and are not listed yet.
  That is why imitation and page checks carry the verdict.
- The brand list is curated. A rare brand is only caught through the page title, `--brand`, or your
  own search.
- The page is fetched once without running JavaScript; pages that build their form in script may
  show no fields. Treat "no password field" on a lookalike as unknown, not as safe.
- Some phishing kits show scanners an empty page or the real site. The cloaking check catches some
  of these, not all.
