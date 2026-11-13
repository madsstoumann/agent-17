# Security audit: <repo name>

<date> · code mode<, deep> · audit-security <version> · scanned `<path>` (<N> files, git: yes/no, history: last N commits / not scanned)

**Verdict:** <one sentence: N blockers / no blockers found, and the single most important action>

## Since last run

Only with a baseline (the scanner's BASELINE section). Leave out on the first run.

- **Fixed (N):** `secrets.config-token` in `appsettings.json` (Loby BearerToken), lodash 4.17.15 → 4.17.21, …
- **New (N):** the new findings, by verdict, with a pointer to the row below.
- **Still open (N):** confirmed and needs-a-look findings from last time, unchanged.
- Carried-over verdicts: N false positives, N accepted until their dates (list the dates that fall within 30 days).

## Blockers

Confirmed secrets and confirmed high-severity flaws. Each one: what, where, why it is real, fix.

1. **<title>** — `src/api/users.js:42`
   `req.query.id` is interpolated into `SELECT … WHERE id = ${…}` on an unauthenticated route.
   Fix: parameterised query (`db.query('… WHERE id = $1', [id])`).

## Findings

| # | Severity | Area | Finding | Location | Fix |
|---|---|---|---|---|---|
| 1 | High | Injection | … | `file:line` | … |
| 2 | Medium | XSS | … | `file:line` (+3 similar) | … |

Severity is your call after triage (see SKILL.md), not the rule's default.

## Needs a look

Plausible hits whose data flow you could not confirm. One line each: location, what to check.

## Dependencies

<N> lockfiles, <N> packages (ecosystems). <N> vulnerable package versions: <n> critical, <n> high, …

| Package | Version | Worst advisory | Severity | Fixed in | Lockfile |
|---|---|---|---|---|---|
| lodash | 4.17.15 | [GHSA-35jh-r3h4-6jhm](https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm) command injection (+5) | High | 4.17.21 | `package-lock.json` |

Dev-only packages listed separately, or noted "(dev)".

## Secrets in git history

Only when `--history` ran. Commit, date, file, type of secret (redacted). Each needs rotating.

## Checked, no issues

The areas with hits that were all false positives, and the missing-control questions answered
with evidence (e.g. "Auth: all `/api/admin/*` routes use `requireAdmin` (src/routes/admin.ts:8)").

## Not checked

Skipped groups, `--offline`, history not scanned, Semgrep not installed, missing-control questions not done, anything
behind generated code, languages the rules do not cover.

## Deep review

Only with `--deep` (references/deep.md). Leave out otherwise.

**Coverage:** <N> units: <n> covered, <n> candidate, <n> blocked, <n> deferred, <n> not applicable.
Areas reviewed: <core eight + selected>. Not reached: <deferred units and why>. Since the last deep
run (deep-check): <n> new, <n> still open, <n> gone. One run never covers everything.

**Architecture:** two or three sentences from `deep/architecture.md`: what the app is, its
principals and the boundaries that matter, and what the repo cannot show (proxy, WAF, identity provider).

### Confirmed

| # | Severity | Finding | Boundary (who → what) | Trace | Fix |
|---|---|---|---|---|---|
| D1 | High | Any signed-in user reads other users' invoices | customer → other customers' invoices | `src/api/invoices.ts:14` → `src/db/invoices.ts:22` | scope `findById` to the owner |

For each confirmed medium, high or critical record, a short paragraph: the principal and input,
the control that fails, the result, the fix and the regression test.

### Needs validation

Leads with no severity. One line each: title, trace, the missing fact, the check that settles it.

### Hardening notes

Defence-in-depth gaps with no reachable boundary failure, and positive patterns worth keeping.

### Tools

Semgrep, osv-scanner, Gitleaks and TruffleHog: ran (with counts) or not checked and why, with the
install line.

## Accepted

Accepted risks from `triage.json`: what, reason, expiry.

## False positives

Grouped, one line per group, so a re-run can be compared quickly
(e.g. "`tls.verify-disabled` ×3 in `scripts/lib/net.mjs`: deliberate, it reads certificates for reporting").
