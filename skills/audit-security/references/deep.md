# Deep review (`--deep`, code mode)

The default code mode triages scanner hits and asks five "what grep cannot see" questions. `--deep`
turns that into a planned review of every trust boundary in the repo. The method is adapted from
Cloudflare's security-audit skill ([github.com/cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill),
MIT, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)): map the system, plan coverage, hunt per
unit, have a fresh agent try to refute every candidate, write structured records with a strict
evidence bar, then report. Two rules from it matter most:

- **A finding needs a boundary and a result.** Name the lower-trust principal, what it sends, the
  control that should stop it, the boundary crossed and what is affected. A missing best practice
  with no affected principal is a hardening note, not a finding.
- **The agent that checks a finding is never the one that found it.**

What stays as audit-security always was: **read-only**. Never run the project, its tests, builds or
scripts, never install anything, never contact the deployed site, a provider API or a registry on
the repo's behalf. Where the Cloudflare skill would run a sandboxed local test, a deep review here
stops at the source trace: a claim that needs runtime behaviour to settle is `needs-validation`,
with the exact check that would settle it.

## 1. Scan

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scan.mjs" <path> --deep [--history N] [--offline] [--out DIR]
```

Run it with `timeout: 600000`. On top of the default scan it:

- adds the deep rules (message listeners, prototype pollution, Host and X-Forwarded-For trust,
  secret comparison with `==`, signing keys in code, fixed IVs, GraphQL introspection, body limits,
  regex from input, model output into sinks, user text in system prompts, browser model keys,
  containers as root, pods sharing the host, wildcard IAM, open ingress, public buckets,
  self-hosted runners, `workflow_run`). They are scanner hits like any other: triage them.
- reads git history (`--history 1000` unless you pass another N).
- runs **Semgrep** (`p/owasp-top-ten`, `p/security-audit`, `p/secrets`), **osv-scanner**, **Gitleaks**
  and **TruffleHog** (`--no-verification`) when they are on PATH. Their results are rules named
  `semgrep:…`, `osv-scanner:…`, `gitleaks:…`, `trufflehog:…` in `findings.json`, with fingerprints,
  so triage, `triage.json` and `--level` work on them. A tool that is not installed, `--offline`
  (Semgrep and osv-scanner need the network), a timeout or a failure is a "not checked" row in the
  DEEP block with the install line. Never install a tool without asking; never run Semgrep again
  yourself in deep mode.
- prints a **DEEP** block: languages, entry surfaces and controls by kind (routes, server actions,
  uploads, webhooks, CLI, queue consumers, model calls, auth checks) with `file:line` samples, the
  subsystems, and the review areas the evidence selects.
- writes `<out>/deep/`: `meta.json` (repo, commit, dirty or not), `ledger.json` (the coverage plan,
  every unit `planned`) and an empty `verdicts.json`. A re-used `--out` folder keeps yours.

Triage every scanner and tool hit first, exactly as in default code mode (SKILL.md, Triage). The
deep review below comes on top; it does not replace triage.

## 2. Map the system (`deep/architecture.md`)

Read the entry points the inventory lists and the code around them, then write
`deep/architecture.md`, at most about 1,000 words:

1. What the product does, its users and operators, and the resources worth protecting.
2. Stack, frameworks and how it is deployed, as far as the repo shows.
3. Entry surfaces and the important source-to-sink paths.
4. Each trust boundary and the strongest control on it, with `file:line`.
5. What the repo cannot show (proxy, WAF, identity provider, cloud policy) that a boundary relies on.
6. Prior deep run (from `meta.json` → `prior`): what it left blocked, deferred or open.

The inventory finds surfaces by pattern; it misses some and flags some that are harmless. Add the
ones you find to the architecture and, if they form a boundary no unit covers, to the ledger.

## 3. The ledger (`deep/ledger.json`)

Each unit is one area (an attack-class section of [deep-classes.md](deep-classes.md)) for one
subsystem: `access::src/api`, `ai::all`, `wildcard::all`. The scanner seeds the eight core areas
for every repo (injection and access control split per subsystem when the routes live in more
than one) and one unit per selected area (`web`, `client`, `supply`, `cloud`, `ai`, `protocols`,
`resources`, `data`, `native`, `apps`). Each unit has `startingPaths`. A unit with `prior` was in the
last deep run of this repo: start from what it found or left open, never treat it as done.

You own the ledger. Add units (a subsystem the inventory missed, an area that applies after all),
and give every unit a final status:

| Status | Needs | Means |
|---|---|---|
| `covered` | `checked` | You traced the area and found no boundary failure. |
| `candidate` | `checked`, `findings` (record ids) | It produced at least one record in `verdicts.json`. |
| `blocked` | `checked`, `reason` | You started and could not finish (generated code, a missing file). |
| `deferred` | `reason` | Not reached within the budget. Say so in the report. |
| `not_applicable` | `reason` | The boundary does not exist here ("no native code"). |

`checked` lists what you read: `file:line` plus the control you verified, not just file names.
Never mark a unit `covered` because the scanner had no hits in it.

## 4. Hunt

Work through the units in the order the risk suggests (unauthenticated entry points and
cross-tenant data first). For each unit, read its section in [deep-classes.md](deep-classes.md),
the core method at the top of that file, and the architecture; then follow input from the starting
paths through parsing, identity, authorisation and state to the sink, including sibling, batch,
retry, error and legacy paths that reach the same effect.

**Parallel hunters.** When the platform has sub-agents (the Agent or Task tool), give each unit or
small group of units its own agent and send in the prompt: the architecture, the unit (id, starting
paths), its section of deep-classes.md copied in full together with the core method, the evidence bar
below, the units other hunters own (do not duplicate them) and the record format. A hunter returns
candidate records and the `checked` list; it writes nothing. Without sub-agents, do the units one
after another yourself.

For a large repo, agree a budget first: about one hunter per unit and one verifier per candidate.
If the budget runs out, mark the rest `deferred`; never thin out verification instead.

## 5. Try to refute every candidate

Give each candidate to a fresh agent that did not find it (without sub-agents: a separate pass that
starts from the record, not from your notes). Its brief:

> You did not write this candidate. Try to refute it from the repository source. Check every trace
> entry exists and says what the record claims; confirm the first entry is a real lower-trust entry
> point and the last is the claimed sink. Look for the strongest control on the path: validation,
> identity, authorisation, framework defaults, normalisation, a guard in a sibling layer. Check the
> severity matches only what the trace shows. Return `confirmed`, `needs-validation` or `rejected`
> with the corrected record. Do not run the code, contact any service or assume deployment settings.

The verifier's record replaces the hunter's. Note who verified it in `verifiedBy`.

## 6. Records (`deep/verdicts.json`)

```json
{
  "version": 1,
  "records": [
    {
      "id": "D1", "unit": "access::src/api", "verdict": "confirmed",
      "title": "Any signed-in user can read another user's invoices",
      "boundary": {
        "principal": "any signed-in customer",
        "input": "invoice id in GET /api/invoices/:id",
        "control": "requireAuth checks the session, nothing checks the owner",
        "crossed": "customer to customer",
        "affected": "other customers' invoices (name, address, amounts)"
      },
      "trace": ["src/api/invoices.ts:14", "src/services/invoices.ts:40", "src/db/invoices.ts:22"],
      "result": "findById(id) returns the row for any id; the handler returns it unchanged",
      "severity": "high", "likelihood": "high", "impact": "medium",
      "fix": "findById(id, { ownerId: req.user.id }) in src/services/invoices.ts:40, 404 when it is not theirs",
      "regression": "a test that user B gets 404 for user A's invoice",
      "verifiedBy": "fresh agent"
    },
    {
      "id": "D2", "unit": "web::all", "verdict": "needs-validation",
      "title": "Password reset link built from the Host header",
      "trace": ["src/auth/reset.ts:31"],
      "blocker": "whether the edge proxy overwrites Host is not in the repo",
      "check": "the owner sends a reset request with Host: attacker.example to staging and reads the mail"
    },
    { "id": "D3", "unit": "injection::src/api", "verdict": "rejected", "title": "SQL injection in search", "reason": "the value goes through sql`` tagged template, parameterised (src/db/search.ts:9)" }
  ]
}
```

The evidence bar, which `deep-check.mjs` enforces:

- **confirmed**: all five boundary fields, a trace of two or more `file:line` from entry point to sink
  (the lines must exist), the result, a severity, a fix and `verifiedBy`. The unit lists the id.
- **needs-validation**: a specific, source-grounded hypothesis blocked by one missing fact. The trace
  so far, the `blocker` (the exact fact) and the `check` (a safe check the owner can run: a config to
  read, a staging request with a dummy account). **No severity**: it is a lead, not a low finding.
- **rejected**: what refuted it. Keep rejected records: they stop the next run re-raising the claim.
- Never put a secret in a record: `file:line` and a redacted prefix only.

Severity (likelihood × impact, never above the demonstrated impact):

| Severity | Anchor |
|---|---|
| critical | An unauthenticated actor gains code execution, the whole data store, or arbitrary accounts. |
| high | A real control is fully defeated: auth bypass, cross-tenant read or write, stored XSS against other users, authenticated code execution. |
| medium | A real boundary violation with a limited blast radius or uncommon preconditions. |
| low | Disclosure of non-secret internals, or an effect that takes sustained effort for little gain. |
| info | Confirmed but minimal; mainly a step in a larger chain. |

If you cannot say what the damage is, the severity is lower than it feels. If layer A already stops
the attack, a missing layer B is a hardening note.

## 7. Check and save

```bash
node "${CLAUDE_SKILL_DIR}/scripts/deep-check.mjs" "<out>/deep" --save
```

It lists every problem (a unit still planned, a confirmed record without a boundary field, a trace
line that does not exist, a severity on a lead, a secret in a record). Fix them and run it again
until it says OK. With `--save` it then gives each record a fingerprint (area, entry file, sink file,
control: wording and line numbers do not change it), compares with the last saved deep run
("new, still open, gone") and saves the ledger and verdicts in the target folder, so the next deep
run starts from them. Do not write the report before it passes.

## 8. Report

`report.md` uses the default layout (`references/report-template.md`) with its deep sections:
coverage, confirmed findings with their boundary, needs validation, hardening notes, tools. The
blockers are confirmed critical and high records plus the usual confirmed secrets. A deep run with
no confirmed records is a fine result: say so and state the coverage and the open leads, without
inventing low findings. One run never covers everything; say which units were deferred or blocked,
and that a second deep run usually finds more.

When audit-all runs the deep review, confirmed records become tasks in its `tasks.json` like any
other confirmed finding (security fixes that need data-flow reasoning get `opus`); needs-validation
records become `human` tasks to run the stated check.
