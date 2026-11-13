# Attack classes for the deep review

One section per ledger area (`deep/ledger.json` → `area`). The eight core areas apply to every repo;
the others apply when the inventory or your reading finds the boundary they describe, not merely
because a package name appears. The classes and the method follow the attack-class files of
Cloudflare's security-audit skill ([github.com/cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill),
MIT, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)), condensed and reworded for a read-only review.

## Core method (send it with every unit)

1. **Work from an invariant.** Name the lower-trust principal and what it can already do; the value,
   action or resource selector it controls; the control that should reject, bind, isolate or limit
   it; the exact source path after that decision; the smallest wrong result (another user's record,
   a wrong return value, a file outside the folder); and the source change that enforces it.
2. **Read at depth.** Follow input through parsing, identity, authorisation, normalisation, stored
   copies and the final sink. Read the sibling paths that reach the same effect: batch, bulk, export,
   import, retry, error, legacy, admin and API-only routes. Compare controls for equivalence, not
   presence: a check on path A and a weaker check on path B is the finding.
3. **Sad paths and disagreements.** Absent, empty, zero, negative, huge, duplicate, mixed-encoding,
   stale, revoked, reordered, concurrent and half-migrated values, where the interface takes them.
   Compare canonicalisation at every hand-off: what A guarantees against what B assumes.
4. **Variants.** A confirmed root cause usually repeats: search your unit for the same pattern; give
   each variant its own conditions. A variant in another unit goes back to the ledger as new work.
5. **Stop when the invariant is settled**, either way, and record it. Do not run code, contact a
   service or guess deployment settings; when the deciding fact is outside the repo, it is
   `needs-validation` with that fact named.
6. **A flag is not a finding.** A missing `HttpOnly` matters if the cookie is a session and nothing
   needs to read it; an error message matters if the field is ever sensitive. Trace the impact.

<a id="injection"></a>
## Injection (core)

Untrusted input reaching an interpreter: SQL and NoSQL queries, shell commands, template engines,
HTML output, file paths, redirects, LDAP/XPath, log lines, deserialisers, `eval`/`Function`/dynamic
`import()`. Look past the direct path: data stored safely and later used raw by other code
(second-order), injection through field names, keys, headers and metadata, and injection into
secondary systems (logs, caches, search indexes, analytics, mail templates).

<a id="access"></a>
## Access control (core)

Can a caller do something outside its authority? Not "is there a check" but "is it the right
check, on the right resource, by the right mechanism":
- another path to the same state change that checks a weaker permission;
- a body field that overrides what authorisation meant to restrict (`role`, `ownerId`, `tenantId`, mass assignment);
- routes that authenticate but never authorise (object ids from the URL: IDOR);
- several access paths to one resource with different checks (UI route vs API vs GraphQL vs export);
- bulk, batch, export and import operations that skip the per-item check;
- admin, debug and internal routes reachable from outside; method or path variants (`HEAD`, trailing slash, case) that skip middleware.

<a id="files"></a>
## Files, outbound requests and deserialisation (core)

Path traversal on read and write (encoded sequences, symlinks, absolute paths, archive entries: zip
slip); uploads stored under a served folder or with a client-chosen name or type; temporary files;
server-side requests to user-supplied URLs (SSRF) including via redirects, DNS rebinding, URL-parser
differences and webhook or image-fetch features; unsafe deserialisation; check-then-use races on files.

<a id="secrets"></a>
## Cryptography and secrets (core)

Weak or predictable randomness for tokens, ids, nonces and reset codes; secrets in code, logs, error
messages, URLs or client-visible responses; broken key derivation, missing HMAC checks, static IVs and
nonce reuse, ECB, unauthenticated encryption; timing-unsafe comparison of secrets; what happens when a
crypto call fails: does the error path fall back to no check?

<a id="logic"></a>
## Business logic (core)

Scanners cannot find these; read each important workflow by hand.
- Skip, repeat or reverse steps of a flow; replay a completed one; partial failure without rollback.
- Check-then-act races with business impact: double spend, double approve, coupon reuse, lost updates.
- Quantities: negative, zero, huge, fractional, string-vs-number coercion, rounding.
- Trust in data "validated on the way in" that another path wrote.
- Time: expiry boundaries, time zones, clock skew between components.
- Defaults and fallbacks: missing config, feature flag off, dependency down, mid-migration.

<a id="abuse"></a>
## Feature abuse, data leakage and chains (core)

Legitimate features used for something else, and steps that are harmless alone:
- export, backup and report features that include data above the caller's access, other users', deleted or draft content;
- import and restore that overwrite or create records past normal validation;
- search, filter and sort as an oracle for data the caller cannot read; enumeration through different errors, sizes or timings (login, reset, invite);
- preview and draft tokens that unlock more than one item; drafts in sitemaps, feeds or listing APIs; CDN caching of private responses;
- user-set webhook or callback URLs the server fetches;
- chains: what a low-privilege user can write that a later, more trusted step reads (a slug that becomes a path, text that becomes a template, a stored URL that becomes a fetch); capabilities that grow after delegation, refresh or role change; rollback and undelete that skip current ownership checks.

<a id="obvious"></a>
## Obvious things (core)

Check each literally and say what you found; everyone assumes someone else did:
hard-coded passwords, keys and default credentials; security TODO/FIXME/HACK comments ("TODO: add
auth"); debug or dev mode switchable in production by env, query string or header; seed or test
accounts that work in production; unprotected `/debug`, `/admin`, `/status`, `/metrics`, `/env`,
`/config` routes; secret files in git and what `.gitignore` really covers; unpinned dependencies and
known CVEs (the scanner's dependency list); `eval`/`exec` with dynamic input; CORS `*` or reflected
origin with credentials; cookie flags on session cookies; open redirects (`next`, `return`, `url`,
`redirect`, `continue`); stack traces and SQL errors in production responses.

<a id="wildcard"></a>
## Wildcard (core)

No category. Read what looks boring, half-finished, experimental, legacy or bolted on. Call the API
the way the front end never does. Look for undocumented routes, parameters and headers in the route
table and middleware. Mix features never designed together (localisation + preview + cache; import +
plugins + webhooks; OAuth + impersonation + API keys). Read the git history for reverted security
fixes and commented-out checks. Compare the edge cases the tests cover with the ones they do not. If
a comment explains why something is safe, verify the explanation.

<a id="web"></a>
## HTTP, sessions and identity

- **Host and forwarded headers**: absolute URLs (reset links, redirects, OAuth redirect URIs, cache keys) built from `Host`/`X-Forwarded-Host`; client IP from `X-Forwarded-For` used for rate limits or allowlists.
- **Caching**: unkeyed headers or parameters that change the response (cache poisoning); private responses cacheable by a CDN (cache deception via `/account.css`-style paths).
- **Response-header injection**: user input in `Location`, `Set-Cookie` or other headers without CR/LF handling.
- **Request framing**: custom HTTP parsing, proxies that disagree on `Content-Length`/`Transfer-Encoding` (only where the repo holds a proxy or parser).
- **Sessions**: CSRF on cookie-authenticated state changes; session fixation (no new id on login); logout and password change that do not invalidate sessions; cookie scope (`Domain`, `Path`) wider than needed.
- **JWT**: algorithm not pinned, `none` or HS/RS confusion, missing `exp`/`aud`/`iss` checks, `decode` used where `verify` was meant, keys from the token header (`jku`, `kid` paths).
- **OAuth/OIDC/SAML**: `state` and PKCE, exact redirect-URI match, `nonce`, token audience, signature over the right element (XML signature wrapping), account linking by unverified email.
- **MFA and recovery**: enrolment without re-authentication, step-up bound to the action, remember-device scope, password reset token lifetime, single use and account binding, recovery that skips MFA.
- **API keys and mTLS**: key scope enforced per resource, keys in URLs or logs, certificate checks that fall back on error.

<a id="client"></a>
## Client side and browser

- **DOM XSS**: sources (`location`, `document.referrer`, `postMessage` data, storage, API and CMS content) to sinks (`innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `setTimeout(string)`, `href`/`src` with `javascript:`, framework raw-HTML bindings).
- **DOM clobbering** and **prototype pollution** with a gadget that uses the polluted property.
- **Cross-window messaging**: `message` handlers without an origin allowlist; `postMessage(…, '*')` with sensitive data; `window.opener` access.
- **CORS and WebSockets**: credentialed CORS with a reflected or broad origin; WebSocket handshakes that accept any `Origin` while using cookies.
- **Service workers**: registration of a user-controllable script or a wide scope; caches that serve one user's responses to another or keep them after logout.
- **Browser storage**: tokens in `localStorage` readable by any XSS; authorisation state cached client-side and trusted after it changes.
- **Cross-site leaks**: responses whose size, timing, frame count or errors reveal state to another origin.
- **UI redress**: sensitive actions frameable (missing `frame-ancestors`), and client-side navigation that follows untrusted URLs.

<a id="supply"></a>
## Supply chain and CI

- **Dependencies**: name confusion between a private and a public registry (scoped packages without a registry pin), packages fetched by URL or git branch, lockfiles missing or not used in CI (`npm install` instead of `npm ci`), install scripts.
- **Build inputs**: unpinned base images, tools downloaded with `curl | sh`, generated code whose generator input is untrusted, build context that copies secrets into images.
- **CI**: untrusted code in a privileged workflow (`pull_request_target`, `workflow_run` with artifacts from forks, self-hosted runners), expression injection (`${{ github.event.* }}` in `run:`), caches and artifacts shared between trusted and untrusted jobs, tokens with more permissions than the job needs, long-lived cloud keys instead of OIDC.
- **Release and update**: who can publish or promote, whether what is released is what was built and reviewed, signing and its verification, update metadata that can roll back to a vulnerable version, plugins and extensions that get more trust than their source deserves.

<a id="cloud"></a>
## Cloud, containers and infrastructure as code

- **Identity**: workload roles broader than the code needs (`*` actions, `*` resources, `iam:PassRole`), cross-account trust without `ExternalId` or source conditions, app authorisation that trusts cloud metadata or headers set by something the client controls.
- **Network**: management planes, databases, metrics or debug ports reachable from the internet; trusted-proxy assumptions the network does not enforce; reach to the metadata endpoint (169.254.169.254) through SSRF.
- **Containers and Kubernetes**: privileged pods, host namespaces and `hostPath`, Docker socket mounts, root users, service-account tokens mounted where unused, admission rules that one path skips, trust in labels and namespaces anyone can set.
- **Configuration and secrets**: secure settings overridden by a later layer (env over file, staging values shipped to production); secrets readable by other workloads; credential renewal that fails open.
- **Storage, events and edge**: public buckets and over-broad signed URLs; event handlers that trust the event's claimed source; edge functions and origin that disagree on auth or routing.

<a id="ai"></a>
## AI, LLM and agents

- **Indirect prompt injection**: retrieved pages, documents, mail, tickets or tool results that the model treats as instructions.
- **Context bleed**: one user's or tenant's data in another's context through shared caches, memory, vector stores or conversation ids.
- **Memory poisoning**: content a user can write into long-term memory or a knowledge base that later steers other sessions.
- **Role confusion**: untrusted text joined into the system or developer prompt; tool results presented as user or system messages.
- **Tool calls**: model-chosen arguments reaching SQL, shell, HTTP, file or mail sinks; tools that run with the service's authority rather than the user's (confused deputy); destructive actions without a confirmation bound to the exact action; dispatcher and schema that disagree; unbounded tool loops and spend.
- **MCP and sub-agents**: servers or sub-agents trusted by name or description; tool metadata used as policy; credentials passed further than needed.
- **Output**: model output rendered as HTML or Markdown with links and images (data exfiltration via image URLs), executed, or used as a URL; system prompts and other users' data extractable through the model.

<a id="protocols"></a>
## RPC, GraphQL, queues and webhooks

- **Framing and schema**: parsers that disagree on message boundaries or canonical form; enum, union and default values that change meaning; an envelope identity that differs from the payload's.
- **Identity**: interceptors applied to some methods but not others; transport identity (mTLS, API key) mapped to the wrong application principal; per-item authorisation missing in batch and streaming calls; callback and reply correlation that one client can hijack.
- **GraphQL**: per-field and per-object authorisation (not only per query), batching and aliases that bypass rate limits, introspection in production, query depth and cost limits.
- **Queues and brokers**: topic and subscription scope, producers that the consumer trusts as a control plane, dead-letter queues that leak data, retries that repeat side effects (idempotency), stale and out-of-order messages, acknowledging before the work commits.
- **Webhooks**: signature checked over the raw body with a constant-time compare, timestamp tolerance and replay protection, the event re-fetched from the provider before acting.

<a id="resources"></a>
## Resource exhaustion and spend

Not load testing: find from source where one unauthenticated or cheap request makes the service do
disproportionate work or spend.
- Superlinear work: regexes with nested quantifiers on input (ReDoS), parsers, sorting or matching on unbounded input.
- Amplification: decompression bombs, image and PDF processing, XML entity expansion, one request fanning out to many queries or API calls.
- Accumulation: unbounded buffering, request bodies, upload sizes, cardinality (keys, labels, sessions), file handles and temp files not released, work that continues after the client cancels.
- Quotas: limits keyed on something the client controls, reset by re-registration, or counted per instance; work done before authentication.
- Failure: a reachable crash or deadlock in a shared process, retry storms, poison messages that block a queue, paid APIs (LLMs, SMS, mail) callable without a per-user limit.

<a id="data"></a>
## Data isolation and lifecycle

- **Tenants and owners**: queries that miss the tenant or owner filter on some path; composite keys and namespaces that collide; row-level security and app checks that disagree; blob and signed-URL references valid beyond their owner.
- **Derived copies**: search indexes, caches, analytics, logs, traces and exports that lose the ACL of the source data; aggregate and count endpoints that reveal hidden records.
- **Export, backup, import, migration**: scope of what is exported or restored, and under whose authority; defaults a migration gives to existing rows; replicas and backups with weaker access.
- **Deletion and revocation**: soft-deleted records still returned by some path; access that survives a role change, removal or token revocation through a cached or derived copy; retention jobs and queued work that outlive deletion; restore that brings back revoked access.

<a id="native"></a>
## Memory safety and native code

For C, C++, unsafe Rust, FFI and native add-ons: out-of-bounds reads and writes; integer overflow,
truncation and signedness at size calculations; use-after-free, double free and stale views;
uninitialised data; type confusion; races on shared state; pointer-and-length contracts across FFI;
library and plugin search paths; untrusted binary formats (headers, offsets, relocations). Without a
sanitizer run (which this review does not do), a plausible memory bug is `needs-validation` with the
exact input shape that would show it.

<a id="apps"></a>
## Desktop, mobile and local IPC

- **Deep links and callbacks**: custom schemes and app links that start actions or carry tokens without confirming the source; OAuth callbacks another app can claim.
- **Webviews and bridges**: navigation to untrusted origins inside a webview that exposes a native bridge (`addJavascriptInterface`, `contextBridge`, Electron with `nodeIntegration`); file access from webviews.
- **IPC and exported components**: Android exported activities, services, receivers and providers; XPC, D-Bus and local sockets without peer authentication; the claimed caller trusted over the channel's real identity.
- **Privileged helpers and updates**: helpers that act for any local caller; install and update paths writable by the user; files created with loose permissions; local secret storage outside the platform keystore.
- **Lifecycle**: data left after logout or account switch, backups that include tokens, pending actions that run without the user present.
