---
name: security-audit
description: Use when someone wants a security review, code security audit, vulnerability scan or "is this repo safe to ship" check of a whole codebase or folder — committed secrets and API keys (also in git history), known-vulnerable dependencies from any lockfile (npm, yarn, pnpm, NuGet, Composer, PyPI, RubyGems, Go via OSV), XSS sinks, SQL/command/template injection, SSRF, open redirects, path traversal, weak crypto, disabled TLS verification, JWT and CORS mistakes, unsafe deserialisation, debug config, and GitHub Actions risks such as pull_request_target and script injection. Report only. Not for a single diff (use /security-review), live HTTP headers or TLS of a URL (use launch-audit), or routine package upkeep (use solution-health).
argument-hint: "[path] [--only deps,secrets,xss,injection,request,crypto,config,ci] [--history [N]] [--offline] [--no-tests] [--out DIR]"
allowed-tools: Bash(node:*), Bash(git log:*), Bash(git show:*), Read, Grep, Glob, WebFetch
metadata:
  version: "1.0.0"
---

# Security audit (code mode)

A scanner collects candidates; you decide which are real. `scripts/scan.mjs` greps the repo
with about 45 rules, reads every lockfile and asks OSV for known vulnerabilities, and
optionally searches git history for secrets that were committed and later deleted. It prints
a summary and writes `findings.json`. Your job is to **triage every hit in context** and write
`report.md` next to it. Grep has high recall and poor precision; the value of this skill is
the triage, so do not paste raw hits into the report.

It is **read-only**. Never edit code, install or upgrade packages, run `npm audit fix`, run
the project, or commit as part of an audit. Fixes are a follow-up the user asks for.

Only audit code the user owns or is engaged on. Never print a full secret: the scanner
redacts them, and so must you when quoting a file.

## Run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scan.mjs" <path> [flags]
```

Run it through Bash with `timeout: 300000`. A typical repo takes 5–30 seconds; `--history` on
a large repo can take a minute or two. Progress goes to stderr; the summary (dependencies,
then hits grouped by rule, highest severity first) goes to stdout. Exit code is 0 whatever it
finds; non-zero means the scanner itself failed.

| Flag | Use it when |
|---|---|
| `<path>` | The repo or a subfolder (default `.`). In a git repo it scans what is tracked plus untracked-but-not-ignored, so build output and `node_modules` drop out via `.gitignore`. |
| `--history [N]` | Always offer it; pass it when the user asks for a thorough audit or about leaked keys. Scans added lines in the last N commits (default 1000) across all branches for secrets no longer in the working tree. A hit there still needs rotating. |
| `--only` / `--skip` | Narrow questions: "just secrets" → `--only secrets`; "only dependencies" → `--only deps`. Groups: `deps secrets xss injection request crypto config ci`. |
| `--offline` | No network: lists lockfiles and package counts but skips OSV. Say so in the report. |
| `--no-tests` | The user wants production code only. By default hits in test, fixture, example and docs paths are kept and tagged `[test]`. |
| `--out DIR` | The user names where the report goes. Default `~/Downloads/security-audit/<folder>-<stamp>/`. Do not write into the repo unless asked: the report may describe live secrets. |
| `--max N` | Hits printed per rule (default 6). `findings.json` always has every hit. |

## Triage

`findings.json` → `rules[]` has, per rule, `severity`, `title`, `review` (what makes a hit
real), `fix`, and all `hits` (`file`, `line`, `text`, `inTest`). For each rule, highest
severity first:

1. **Open the hit in context.** Read about 15 lines around `line`, more if you must follow
   where a variable comes from. Use the rule's `review` text as the test. Typical questions:
   does the value come from a request, the URL, a cookie, a CMS field or an upload? Is there a
   sanitiser, an allowlist, a parameterised call or an environment guard on the path?
2. **Give it a verdict:**
   - **Confirmed**: input reaches the sink unprotected, or the secret is real and live-looking.
   - **Needs a look**: plausible but you could not trace the data flow within budget. Say what to check.
   - **False positive**: say why in a few words (constant string, test fixture, dev-only branch, placeholder).
3. **Set the final severity yourself.** The rule severity is a prior. Raise it for a
   confirmed, internet-facing path (an unauthenticated route). Lower it for dev-only code,
   tests, or internal tools.

Budget: triage every high and medium hit. When a rule has more than about 20 hits, read 8–10
representative ones, then report the pattern ("38 `Html.Raw` calls, all on RTE properties
from Umbraco; 2 on query-string values: `Views/Search.cshtml:14`, …"). Low rules can be
sampled. Hits under test, docs or example paths are usually false positives unless they are
real secrets: a live key in a test file is still a leak.

**Dependencies:** list critical and high advisories in production packages first, with the
fixed version and the lockfile. Dev-only packages (`(dev)`) matter less unless they run in CI
with secrets. One vulnerable package often shows several advisories; group them under the
package. Do not claim a vulnerability is exploitable in this app; it is known-vulnerable code
that ships. For regular npm/NuGet upkeep (outdated, deprecated, end-of-life), point to the
`solution-health` skill rather than expanding this section.

**Secrets:** a confirmed secret is always a blocker, even when it has been deleted (the
history hits). The fix is rotate first, then remove, then purge history if the repo is or
was public. Check whether a hit is a public-by-design key (Firebase/Maps browser keys,
Supabase anon keys, Stripe publishable keys) before calling it a leak.

## What grep cannot see

The scanner finds dangerous calls. It cannot see a missing control. After triage, spend a few
minutes, with Grep and Read, on the questions below for the main app. Report each one as
checked, with the evidence, or as not checked. Never leave one out silently.

- Authentication and authorisation on routes: find route and controller definitions and check
  for auth middleware, `[Authorize]` or a session check. Look for admin or API routes that have none.
- Rate limiting or lockout on login, password reset and other OTP or code endpoints.
- CSRF protection on cookie-authenticated POST/PUT/DELETE forms.
- Security headers set in code (helmet, `NWebsec`, `next.config` `headers()`): note them. The
  live result is launch-audit's job.
- Input validation at the API boundary (zod, joi, data annotations, FluentValidation).

When `semgrep` is already on PATH you may add
`semgrep scan --config p/owasp-top-ten --config p/secrets --json --quiet <path>` and triage
its results the same way. Do not install it without asking.

## Report

Write `report.md` in the folder the scanner printed, using the layout in
`references/report-template.md`. Then reply in chat with:

1. A one-sentence **verdict**: blockers found or not.
2. **Blockers**: confirmed secrets and confirmed high-severity flaws, each with `file:line` and the fix.
3. The other confirmed findings, then the "needs a look" ones, grouped by area.
4. Dependency advisories by count, plus the worst three.
5. What was **not checked**: skipped groups, `--offline`, no `--history`, the missing-control
   questions you did not get to. A skip is never "fine".
6. The report path, and the follow-ups you can offer.

## After the audit

Offer these follow-ups; do not run them by default:

- **Fix pass**: fix the confirmed findings on a branch, one commit per finding.
- **History scan** if it was not run, and a rotation checklist for every confirmed secret.
- **Live site checks**: launch-audit for headers, TLS, cookies and exposed files on the deployed URL.
- **Diff reviews** going forward: `/security-review` on each PR.

## Red flags

| Thought | Reality |
|---|---|
| "I'll list all 140 hits in the report" | The reader needs verdicts. Triage, group, and link the JSON for the rest. |
| "It matched `inject.sql`, so it's SQL injection" | Only if input reaches it unparameterised. Read the code. |
| "The key was deleted, so it's fine" | It is in git history. It still needs rotating. |
| "No hits for auth, so auth is fine" | Grep cannot see missing checks. Do the "what grep cannot see" pass or say it was not done. |
| "Let me just run npm audit fix" | Report only. Offer the fix pass. |
| "I'll quote the secret so they can find it" | `file:line` and the redacted prefix are enough. |

## Example prompts

```
/security-audit
Run a security audit of this repo, including git history
Are there any secrets or API keys committed in ./apps/web?
Check our dependencies for known vulnerabilities — we have npm and NuGet
Security review of the whole codebase before the pen test next week
Only check the GitHub Actions workflows for security problems
```

Mapping: "including history" / "leaked keys" → `--history`; "only dependencies" → `--only deps`;
"just the workflows" → `--only ci`; "ignore tests" → `--no-tests`; "save it in …" → `--out`.

## Files

- `scripts/scan.mjs`: the scanner (`--help` lists every flag). Zero dependencies, Node 18 or later, uses `git` when present.
- `scripts/lib/patterns.mjs`: every rule, with its regex, `review` and `fix` text. A line
  containing `security-audit: ignore` is skipped, which teams can use for accepted findings.
- `scripts/lib/deps.mjs`: lockfile parsers and the OSV lookup.
- `references/report-template.md`: the `report.md` layout.
- `scripts/test/`: `node --test scripts/test/*.test.mjs`.
