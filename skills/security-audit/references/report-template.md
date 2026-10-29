# Security audit: <repo name>

<date> · code mode · security-audit <version> · scanned `<path>` (<N> files, git: yes/no, history: last N commits / not scanned)

**Verdict:** <one sentence: N blockers / no blockers found, and the single most important action>

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

Skipped groups, `--offline`, history not scanned, missing-control questions not done, anything
behind generated code, languages the rules do not cover.

## False positives

Grouped, one line per group, so a re-run can be compared quickly
(e.g. "`tls.verify-disabled` ×3 in `scripts/lib/net.mjs`: deliberate, it reads certificates for reporting").
