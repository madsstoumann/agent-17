/**
 * The grep net. Each rule is one line-level regex; Claude triages every hit in context,
 * so rules favour recall over precision and say in `review` what decides a real finding.
 *
 *   { id, group, severity: high|medium|low, langs: [ext…] | null (any text file), re, unless?, title, review, fix, secret? }
 *
 * `secret: true` rules are also run over git history and have their match redacted.
 * A line containing `audit-security: ignore` is skipped; `audit-security: ignore-file` in the
 * first 15 lines skips the whole file (this file says it, or it would flag itself).
 *
 * audit-security: ignore-file
 */

export const JS = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro', 'html', 'htm'];
export const CS = ['cs', 'cshtml', 'razor', 'vb'];
export const PHP = ['php', 'phtml'];
export const PY = ['py'];
export const RB = ['rb', 'erb'];
export const GO = ['go'];
export const SERVER = [...JS, ...CS, ...PHP, ...PY, ...RB, ...GO, 'java', 'kt'];
export const CONFIG = ['json', 'yml', 'yaml', 'xml', 'config', 'toml', 'ini', 'properties', 'env', 'conf', 'tf', 'tfvars'];

/** Values that are obviously not real secrets: placeholders, env lookups, templates. */
export const PLACEHOLDER = /(x{4,}|\*{3,}|change.?me|your[_-]?|example|dummy|sample|placeholder|redacted|fake|<[^>]+>|\$\{|\{\{|%\(|process\.env|os\.environ|getenv|Environment\.|config\[|settings\.|\bnull\b|\bundefined\b|^test|^password$|^secret$)/i;

export const RULES = [
  // ------------------------------------------------------------------ secrets
  { id: 'secrets.private-key', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
    title: 'Private key in source', review: 'Real unless it is a documented test fixture.', fix: 'Remove, rotate the key, purge history (git filter-repo).' },
  { id: 'secrets.aws-key', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    title: 'AWS access key id', review: 'AKIAIOSFODNN7EXAMPLE is the AWS docs example.', fix: 'Deactivate in IAM, rotate, move to a secret store.' },
  { id: 'secrets.github-token', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/,
    title: 'GitHub token', review: 'Real by format.', fix: 'Revoke at github.com/settings/tokens.' },
  { id: 'secrets.slack', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}|https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/,
    title: 'Slack token or webhook', review: 'Real by format.', fix: 'Revoke the token / regenerate the webhook.' },
  { id: 'secrets.stripe', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/,
    title: 'Stripe live secret key', review: 'sk_test_ keys are not matched.', fix: 'Roll the key in the Stripe dashboard.' },
  { id: 'secrets.ai-key', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/,
    title: 'Anthropic / OpenAI API key', review: 'Real by format.', fix: 'Revoke in the provider console.' },
  { id: 'secrets.sendgrid', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
    title: 'SendGrid API key', review: 'Real by format.', fix: 'Delete the key in SendGrid.' },
  { id: 'secrets.npm-token', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\bnpm_[A-Za-z0-9]{36}\b|_authToken=[A-Za-z0-9-_]{20,}/,
    title: 'npm token', review: 'In .npmrc a ${NPM_TOKEN} reference is fine.', fix: 'Revoke with `npm token revoke`.' },
  { id: 'secrets.azure-storage', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /AccountKey=[A-Za-z0-9+/=]{40,}|SharedAccessSignature=sv=|[?&]sig=[A-Za-z0-9%+/=]{30,}/,
    title: 'Azure storage key or SAS', review: 'UseDevelopmentStorage=true / Azurite key is fine.', fix: 'Rotate the storage key; prefer managed identity.' },
  { id: 'secrets.db-url', group: 'secrets', severity: 'high', langs: null, secret: true,
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql):\/\/[^\s:@/'"]+:[^\s@/'"$]{3,}@/,
    title: 'Database URL with password', review: 'localhost with a dev password is low; anything else is high.', fix: 'Move to an env var / secret store; rotate.' },
  { id: 'secrets.connection-string', group: 'secrets', severity: 'medium', langs: [...CONFIG, ...CS], secret: true,
    re: /(?:^|[;"'\s])(?:Password|Pwd)\s*=\s*(?!["';\s$%{])[^;"'\s]{4,}/i,
    title: 'Password in a connection string', review: 'Check it is not a local dev DB or placeholder.', fix: 'User secrets / Key Vault / env vars; Integrated Security where possible.' },
  { id: 'secrets.jwt', group: 'secrets', severity: 'medium', langs: null, secret: true,
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    title: 'Hard-coded JWT', review: 'Decode the payload: a Supabase anon key or test token is low; a service-role or long-lived token is high.', fix: 'Remove; issue tokens at runtime.' },
  { id: 'secrets.google-api-key', group: 'secrets', severity: 'low', langs: null, secret: true,
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    title: 'Google API key', review: 'Browser Maps/Firebase keys are public by design: check they are referrer-restricted.', fix: 'Restrict by HTTP referrer and API in Google Cloud console.' },
  { id: 'secrets.config-token', group: 'secrets', severity: 'medium', langs: CONFIG, secret: true, placeholderCheck: true,
    re: /(?:^|["'\s{,])[\w.-]*(?:token|bearer)["']?\s*[:=]\s*["']?(?:bearer\s+)?([A-Za-z0-9._~+/=-]{12,})/i,
    unless: /#\{|__\w+__|\$\(/,
    title: 'Token in a config file', review: 'Keys like BearerToken, Token or AccessToken in appsettings*.json, .json or .yml config. Real when the value is long and random and the file is committed; a dev-only or expired token still belongs in a secret store.', fix: 'Move to user secrets / Key Vault / env vars (appsettings key → environment variable Section__BearerToken); rotate the token.' },
  { id: 'secrets.generic', group: 'secrets', severity: 'medium', langs: null, secret: true, placeholderCheck: true,
    re: /(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|private[_-]?key|password|passwd)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i,
    title: 'Secret-looking assignment', review: 'Most noise lives here: placeholders, i18n labels, test fixtures. Real when the value looks random.', fix: 'Move to env / secret store; rotate if real.' },

  // ------------------------------------------------------------------ XSS
  { id: 'xss.dom-sink', group: 'xss', severity: 'medium', langs: JS,
    re: /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)|\.insertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(|\.createContextualFragment\s*\(/,
    title: 'DOM HTML sink', review: 'Real when the value can come from the URL, user input, an API or CMS content without sanitising (DOMPurify). Static strings are fine.', fix: 'textContent, DOM APIs, or DOMPurify.sanitize().' },
  { id: 'xss.framework-raw', group: 'xss', severity: 'medium', langs: JS,
    re: /dangerouslySetInnerHTML|\bv-html\s*=|\{@html\s|\[innerHTML\]\s*=|bypassSecurityTrust(?:Html|Script|Url|ResourceUrl)\s*\(|\bset:html\s*=/,
    title: 'Framework raw-HTML binding', review: 'Real when the bound value is user- or CMS-controlled and not sanitised.', fix: 'Render as text, or sanitise server-side / with DOMPurify.' },
  { id: 'xss.jquery-html', group: 'xss', severity: 'low', langs: JS,
    re: /\.(?:html|append|prepend|after|before|replaceWith)\s*\(\s*(?:[a-zA-Z_$][\w$.]*\s*\+|`[^`]*\$\{)/,
    title: 'jQuery HTML insertion with concatenation', review: 'Real when the concatenated value is untrusted.', fix: '.text(), or build elements.' },
  { id: 'xss.razor-raw', group: 'xss', severity: 'medium', langs: CS,
    re: /\bHtml\.Raw\s*\(|new\s+(?:Html|Mvc)String\s*\(|@Html\.Raw/,
    title: 'Razor raw HTML output', review: 'Umbraco RTE content via Html.Raw is normal; user input or query strings are not.', fix: 'Let Razor encode; sanitise RTE input (HtmlSanitizer).' },
  { id: 'xss.server-echo', group: 'xss', severity: 'high', langs: [...PHP, ...PY, ...RB],
    re: /\becho\s+\$_(?:GET|POST|REQUEST|COOKIE|SERVER)|<%==|\|\s*safe\b|\bmark_safe\s*\(|\bMarkup\s*\(|\.html_safe\b|\braw\s*\(/,
    title: 'Unescaped server-side output', review: 'Real when the value is request-derived.', fix: 'htmlspecialchars / template auto-escaping.' },

  // ------------------------------------------------------------------ injection
  { id: 'inject.eval', group: 'injection', severity: 'medium', langs: [...JS, ...PY, ...PHP, ...RB],
    re: /(?<![\w.$])eval\s*\(|\bnew\s+Function\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]|\bexec\s*\(\s*(?:compile|request|input)|\bcreate_function\s*\(|\bassert\s*\(\s*\$/,
    title: 'Dynamic code evaluation', review: 'Real when any part of the string is input-derived. Build tooling and webpack runtime are noise.', fix: 'Remove; JSON.parse / a lookup table instead.' },
  { id: 'inject.command', group: 'injection', severity: 'high', langs: SERVER,
    re: /\b(?:exec|execSync|spawnSync|spawn)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)|\bshell\s*=\s*True|\bos\.(?:system|popen)\s*\(|\b(?:shell_exec|system|passthru|popen|proc_open)\s*\(\s*["']?[^)]*\$|\bProcess\.Start\s*\(|`[^`]*#\{|\bexec\.Command\s*\(\s*"(?:sh|bash|cmd)"/,
    title: 'OS command built from a string', review: 'Real when an argument is input-derived. Scripts with fixed args are low.', fix: 'execFile/spawn with an argument array; never a shell.' },
  { id: 'inject.sql', group: 'injection', severity: 'high', langs: SERVER,
    re: /["'`]\s*(?:SELECT\s[^"'`]*?\bFROM|INSERT\s+INTO|UPDATE\s+[\w.\[\]]+\s+SET|DELETE\s+FROM)\b[^"'`]*["'`]\s*\+|`\s*(?:SELECT\s[^"'`]*?\bFROM|INSERT\s+INTO|UPDATE\s+[\w.\[\]]+\s+SET|DELETE\s+FROM)\b[^`]*\$\{|\$"\s*(?:SELECT\s[^"'`]*?\bFROM|INSERT\s+INTO|UPDATE\s+[\w.\[\]]+\s+SET|DELETE\s+FROM)\b[^"]*\{|\b(?:FromSqlRaw|ExecuteSqlRaw|SqlQueryRaw)\s*\(\s*(?:\$"|[^")]*\+)|\.(?:execute|executemany|raw)\s*\(\s*(?:f["']|["'][^"']*["']\s*%)|\b(?:mysqli?_query|pg_query)\s*\([^)]*\$|->query\s*\(\s*["'][^"']*\$|\.(?:query|raw|whereRaw|orderByRaw)\s*\(\s*`[^`]*\$\{/i,
    unless: /\b(?:FromSqlInterpolated|ExecuteSqlInterpolated|SqlQuery)\s*\(|\b(?:sql|Prisma\.sql|\$queryRaw|\$executeRaw)`/,
    title: 'SQL built by concatenation / interpolation', review: 'Real unless every interpolated piece is a constant or whitelisted identifier. Tagged templates (sql``, Prisma.$queryRaw``) are parameterised and fine.', fix: 'Parameters / prepared statements / the ORM query builder.' },
  { id: 'inject.nosql', group: 'injection', severity: 'medium', langs: JS,
    re: /["']?\$where["']?\s*:|\.find(?:One)?\s*\(\s*req\.(?:body|query)\b/,
    title: 'NoSQL operator injection surface', review: 'Real when a request object reaches the query unvalidated (allows {$ne: null}).', fix: 'Validate types (zod/joi); mongo-sanitize.' },
  { id: 'inject.template', group: 'injection', severity: 'medium', langs: SERVER,
    re: /\brender_template_string\s*\(|\bTemplate\s*\(\s*request\.|\bejs\.render\s*\(\s*req\.|\bHandlebars\.compile\s*\(\s*req\./,
    title: 'Server-side template from input', review: 'Real when the template text (not just data) is input-derived.', fix: 'Fixed templates; input only as data.' },

  // ------------------------------------------------------------------ request handling
  { id: 'ssrf.request-url', group: 'request', severity: 'high', langs: SERVER,
    re: /\b(?:fetch|axios(?:\.\w+)?|got(?:\.\w+)?|request|needle|superagent\.\w+|https?\.(?:get|request)|\$fetch|ofetch|useFetch)\s*\(\s*(?:`[^`]*\$\{\s*)?(?:req|request|event|ctx)\.(?:query|body|params|url)|\brequests\.(?:get|post)\s*\(\s*request\.|\bfile_get_contents\s*\(\s*\$_|\bcurl_init\s*\(\s*\$_|\bHttpClient\b.*\bRequest\.Query/,
    title: 'Outbound request to an input-controlled URL', review: 'Real when the host is not pinned to an allowlist (cloud metadata 169.254.169.254, internal hosts).', fix: 'Allowlist hosts; block private ranges after DNS resolution.' },
  { id: 'redirect.open', group: 'request', severity: 'medium', langs: SERVER,
    re: /\.redirect\s*\(\s*(?:\d{3}\s*,\s*)?(?:req|request|ctx|event)\.(?:query|body|params)|\bnavigateTo\s*\(\s*(?:route|useRoute\(\))\.query|\b(?:Redirect|LocalRedirect)\s*\(\s*(?:returnUrl|redirectUrl|url|Request\.)|header\s*\(\s*["']Location:\s*["']?\s*\.\s*\$_|window\.location(?:\.href)?\s*=\s*(?:new\s+URLSearchParams|params\.get|searchParams\.get|getParam)/,
    title: 'Redirect target from input', review: 'Real unless the target is checked as local (Url.IsLocalUrl, starts with "/" and not "//").', fix: 'Accept only relative paths or an allowlist; LocalRedirect in ASP.NET.' },
  { id: 'path.traversal', group: 'request', severity: 'high', langs: SERVER,
    re: /\b(?:readFile|readFileSync|createReadStream|sendFile|download|unlink|writeFile)\s*\(\s*[^)]*(?:req|request|ctx|event)\.(?:query|body|params)|\bpath\.(?:join|resolve)\s*\([^)]*(?:req|request)\.(?:query|body|params)|\bPath\.Combine\s*\([^)]*Request\.|\b(?:include|require)(?:_once)?\s*\(?\s*\$_(?:GET|POST|REQUEST)|\bopen\s*\(\s*request\.(?:args|form|GET|POST)|\bsend_file\s*\(\s*request\./,
    title: 'File path from input', review: 'Real unless the name is normalised and checked to stay inside a base folder.', fix: 'path.basename / resolve + startsWith(base); an id → filename map.' },
  { id: 'csrf.disabled', group: 'request', severity: 'medium', langs: SERVER,
    re: /\[IgnoreAntiforgeryToken|@csrf_exempt|csrf\s*:\s*false|\.csrf\(\)\s*\.disable\(\)|skip_forgery_protection|protect_from_forgery\s+except|verify_authenticity_token/,
    title: 'CSRF protection switched off', review: 'Fine for token-authenticated APIs and webhooks; real for cookie-session form posts.', fix: 'Re-enable; scope the exemption to the webhook route.' },
  { id: 'upload.unrestricted', group: 'request', severity: 'low', langs: SERVER,
    re: /\bmulter\s*\(\s*\{(?![^}]*fileFilter)|\bmove_uploaded_file\s*\(|\bIFormFile\b.*\.FileName\b/,
    title: 'File upload handling', review: 'Check type allowlist, size limit, random stored name, storage outside the web root.', fix: 'Validate content type and extension; store outside wwwroot.' },

  // ------------------------------------------------------------------ crypto / auth / transport
  { id: 'crypto.weak-hash', group: 'crypto', severity: 'low', langs: SERVER,
    re: /createHash\s*\(\s*["'](?:md5|sha1)["']|\b(?:MD5|SHA1)(?:CryptoServiceProvider)?\.(?:Create|HashData)\b|\bhashlib\.(?:md5|sha1)\s*\(|\b(?:md5|sha1)\s*\(\s*\$|Digest::(?:MD5|SHA1)|\bmd5\.New\(\)|\bsha1\.New\(\)/,
    title: 'MD5 / SHA-1', review: 'High when it hashes passwords or signs anything; fine for cache keys and ETags.', fix: 'Passwords: argon2id/bcrypt/scrypt. Integrity: SHA-256.' },
  { id: 'crypto.weak-cipher', group: 'crypto', severity: 'medium', langs: SERVER,
    re: /\b(?:des|rc4|rc2|blowfish)(?:-\w+)?["']|aes-\d+-ecb|CipherMode\.ECB|\bDES\.Create|\bTripleDES|\bAES\.new\([^)]*MODE_ECB|createCipher\s*\(/i,
    title: 'Weak cipher or mode', review: 'Real by construction; createCipher (no iv) is deprecated.', fix: 'AES-256-GCM with a random IV (createCipheriv).' },
  { id: 'crypto.insecure-random', group: 'crypto', severity: 'low', langs: SERVER,
    re: /(?:token|secret|password|passwd|nonce|salt|otp|apikey|api_key|session|csrf|reset)[^\n]{0,60}\bMath\.random\s*\(|\bMath\.random\s*\([^\n]{0,60}(?:token|secret|password|nonce|salt|otp|session|csrf|reset)|\bnew\s+Random\s*\(\s*\)[^\n]{0,60}(?:token|password|salt)|\brandom\.(?:random|randint|choice)\s*\([^\n]{0,40}(?:token|password|secret)/i,
    title: 'Non-cryptographic random for a secret', review: 'Real when the value is a token, id or password someone could guess.', fix: 'crypto.randomUUID / randomBytes; RandomNumberGenerator; secrets module.' },
  { id: 'tls.verify-disabled', group: 'crypto', severity: 'high', langs: null,
    re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*["']?0|\bverify\s*=\s*False|ServerCertificateCustomValidationCallback\s*=|ServerCertificateValidationCallback\s*[+=]|DangerousAcceptAnyServerCertificateValidator|CURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*(?:false|0)|InsecureSkipVerify\s*:\s*true|strictSSL\s*[:=]\s*false/,
    title: 'TLS certificate verification disabled', review: 'Real outside a clearly dev-only branch.', fix: 'Remove; trust the internal CA explicitly instead.' },
  { id: 'auth.jwt', group: 'crypto', severity: 'high', langs: SERVER,
    re: /algorithms\s*[:=]\s*\[[^\]]*["']none["']|verify_signature["']?\s*:\s*False|\b(?:ValidateIssuerSigningKey|RequireSignedTokens|ValidateLifetime|RequireExpirationTime)\s*=\s*false|\bjwt\.decode\s*\(\s*[^,)]+\)\s*(?:;|$)|ignoreExpiration\s*:\s*true/,
    title: 'JWT validation weakened', review: 'jwt.decode without verify is fine only when the token was already verified upstream.', fix: 'jwt.verify with an explicit algorithms list; validate exp/iss/aud.' },
  { id: 'auth.cors', group: 'crypto', severity: 'medium', langs: SERVER,
    re: /\borigin\s*:\s*(?:true|["']\*["'])|SetIsOriginAllowed\s*\(\s*_?\w*\s*=>\s*true\s*\)|\bAllowAnyOrigin\s*\(\s*\)|Access-Control-Allow-Origin["']?\s*[,:]\s*(?:req|request)\.headers|CORS_ORIGIN_ALLOW_ALL\s*=\s*True|CORS_ALLOW_ALL_ORIGINS\s*=\s*True/,
    title: 'Permissive CORS in code', review: 'High when combined with credentials (cookies) — origin:true reflects any origin. Public read-only APIs are fine.', fix: 'Explicit origin allowlist.' },
  { id: 'auth.cookie-flags', group: 'crypto', severity: 'medium', langs: SERVER,
    re: /\bhttpOnly\s*:\s*false|\bsecure\s*:\s*false|HttpOnly\s*=\s*false|Secure\s*=\s*false|SESSION_COOKIE_SECURE\s*=\s*False|SESSION_COOKIE_HTTPONLY\s*=\s*False|CookieSecurePolicy\.None|SameSite\s*=\s*SameSiteMode\.None/,
    title: 'Session cookie flag switched off', review: 'Real for auth/session cookies in production config.', fix: 'Secure; HttpOnly; SameSite=Lax.' },
  { id: 'deserialize.unsafe', group: 'crypto', severity: 'high', langs: SERVER,
    re: /\b(?:BinaryFormatter|NetDataContractSerializer|LosFormatter|SoapFormatter|ObjectStateFormatter)\b|TypeNameHandling\.(?:All|Auto|Objects|Arrays)|\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*SafeLoader)|\bunserialize\s*\(\s*\$_|\bMarshal\.load\b|\bYAML\.load\b(?!_file)|node-serialize|\bserialize-javascript\b.*unsafe/,
    title: 'Unsafe deserialisation', review: 'Real when the data can come from outside (request, cookie, queue, file upload).', fix: 'JSON with a schema; yaml.safe_load; System.Text.Json.' },

  // ------------------------------------------------------------------ config
  { id: 'config.debug', group: 'config', severity: 'low', langs: [...CONFIG, ...PY, 'cs', 'js', 'ts', 'mjs'],
    re: /^\s*DEBUG\s*=\s*True\b|customErrors\s+mode\s*=\s*["']Off["']|<compilation[^>]*debug\s*=\s*["']true|ASPNETCORE_ENVIRONMENT["']?\s*[:=]\s*["']?Development|UseDeveloperExceptionPage\s*\(\s*\)|display_errors\s*=\s*On|APP_DEBUG\s*=\s*true/i,
    title: 'Debug / developer error pages', review: 'Fine in dev-only files (appsettings.Development.json, inside if (env.IsDevelopment())); real in production config.', fix: 'Gate on environment; generic error page in production.' },
  { id: 'config.sourcemaps', group: 'config', severity: 'low', langs: ['js', 'mjs', 'cjs', 'ts', 'mts', 'json'],
    re: /productionBrowserSourceMaps\s*:\s*true|sourcemap\s*:\s*(?:true|["'](?:true|hidden)?["'])\s*[,}]?\s*$|devtool\s*:\s*["'](?:source-map|eval)/,
    title: 'Source maps in production build', review: 'Real when the maps are deployed publicly (check the site for .js.map).', fix: 'Hidden source maps uploaded to the error tracker only.' },
  { id: 'config.docker-privileged', group: 'config', severity: 'medium', langs: ['yml', 'yaml', 'dockerfile', 'sh'],
    re: /privileged\s*:\s*true|--privileged\b|\/var\/run\/docker\.sock|network_mode\s*:\s*["']?host|cap_add\s*:\s*\[?\s*["']?(?:ALL|SYS_ADMIN)/,
    title: 'Privileged container', review: 'Real outside local tooling.', fix: 'Drop privileged / socket mounts; add only needed capabilities.' },
  { id: 'config.curl-pipe-shell', group: 'config', severity: 'low', langs: null,
    re: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/,
    title: 'curl | sh', review: 'Supply-chain risk in Dockerfiles and CI.', fix: 'Pin a version and verify a checksum.' },

  // ------------------------------------------------------------------ CI (only .github/workflows, .gitlab-ci.yml, azure-pipelines.yml, bitbucket-pipelines.yml)
  { id: 'ci.pull-request-target', group: 'ci', severity: 'medium', ci: true,
    re: /^\s*(?:-\s*)?pull_request_target\b|^\s*on\s*:\s*\[?[^\n]*\bpull_request_target\b/,
    title: 'pull_request_target trigger', review: 'High when the job checks out or runs the PR head (ref: ${{ github.event.pull_request.head.sha }}) with secrets.', fix: 'Use pull_request; or never check out head code in this job.' },
  { id: 'ci.script-injection', group: 'ci', severity: 'high', ci: true,
    re: /\$\{\{\s*github\.(?:event\.(?:issue\.(?:title|body)|pull_request\.(?:title|body|head\.ref|head\.label)|comment\.body|review\.body|review_comment\.body|head_commit\.(?:message|author)|commits|pages|discussion\.(?:title|body))|head_ref)\b[^}]*\}\}/,
    title: 'Untrusted GitHub context interpolated', review: 'Real when the line is inside run: (shell) or a script: input; fine in with: inputs that are not evaluated.', fix: 'Pass through env: and quote "$VAR".' },
  { id: 'ci.unpinned-action', group: 'ci', severity: 'low', ci: true,
    re: /^\s*(?:-\s*)?uses\s*:\s*["']?(?!actions\/|github\/|\.\/|docker:\/\/)[\w.-]+\/[\w./-]+@(?![0-9a-f]{40}\b)[\w.-]+/,
    title: 'Third-party action pinned by tag, not SHA', review: 'Tags can be moved (tj-actions/changed-files, 2025).', fix: 'Pin to a full commit SHA with a # vX comment; Dependabot keeps it current.' },
  { id: 'ci.permissions', group: 'ci', severity: 'medium', ci: true,
    re: /^\s*permissions\s*:\s*write-all\b|^\s*contents\s*:\s*write\b/,
    title: 'Broad workflow token permissions', review: 'contents: write is normal for release jobs; check the job needs it.', fix: 'permissions: read-all at the top, widen per job.' },
  { id: 'ci.secrets-echo', group: 'ci', severity: 'medium', ci: true,
    re: /\b(?:echo|printf|cat)\b[^\n]*\$\{\{\s*secrets\./,
    title: 'Secret printed in a step', review: 'Masking fails for transformed values (base64, substrings).', fix: 'Pass via env and never print.' },
];

/** File-level checks by name (path relative to the root). */
export const FILE_RULES = [
  { id: 'secrets.env-file', group: 'secrets', severity: 'high',
    test: (rel) => /(^|\/)\.env(\.[\w-]+)?$/.test(rel) && !/\.(example|sample|template|dist|defaults?)$/i.test(rel),
    title: 'Committed .env file', review: 'Open it: placeholders only is low; real values are high and need rotating.', fix: 'git rm --cached, add to .gitignore, rotate, ship a .env.example.' },
  { id: 'secrets.key-file', group: 'secrets', severity: 'high',
    test: (rel) => /(^|\/)(id_rsa|id_ed25519|id_ecdsa)$|\.(pem|key|p12|pfx|jks|keystore|ppk)$/i.test(rel) && !/(^|\/)(test|tests|fixtures?|__tests__|spec)\//i.test(rel),
    title: 'Key or certificate file', review: 'A public .pem certificate is fine; a private key is not.', fix: 'Remove from the repo, rotate, purge history.' },
  { id: 'secrets.credentials-file', group: 'secrets', severity: 'medium',
    test: (rel) => /(^|\/)(\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials\.json|service-account[\w-]*\.json|firebase-adminsdk[\w-]*\.json|secrets?\.(json|ya?ml)|appsettings\.(?!Development\.)[\w-]+\.json|local\.settings\.json|\.htpasswd)$/i.test(rel),
    title: 'Credentials-type file', review: 'Open it: a token reference (${NPM_TOKEN}) is fine. appsettings.<Environment>.json and local.settings.json often hold the real tokens and connection strings for that environment.', fix: 'Remove and rotate; inject at deploy.' },
];

/**
 * Files a hosting platform writes into the repo itself, credentials included. They are part of the
 * platform's workflow, so removing them breaks deploys: the secret rules still read them, but every
 * secret hit in one is reported under the platform rule instead, at review level, owned by a person.
 * The severity follows the repo's visibility (see scan.mjs): private or internal → low, unknown →
 * medium, public → high.
 */
export const PLATFORM_FILES = [
  { id: 'secrets.umbraco-cloud', group: 'secrets', platform: 'Umbraco Cloud', owner: 'human',
    test: (rel) => /(^|\/)umbraco-cloud\.json$/i.test(rel),
    title: 'Umbraco Cloud credentials in umbraco-cloud.json (platform file)',
    review: 'Expected, not a leak: Umbraco Cloud commits umbraco-cloud.json itself (commits by support@umbraco.io such as "Update Umbraco Deploy api key"). Deploy.Settings.ApiKey is the Umbraco Deploy key for environment-to-environment transfers; Identity.ClientId/ClientSecret are for the Umbraco Cloud Identity login (redirect.identity.umbraco.com). Neither is the CI/CD Deployment API key for api.cloud.umbraco.com, which belongs in a CI secret. Accepted risk when the repo is private and access is controlled; a blocker when the repo is or was public.',
    fix: 'Keep the file. Private repo: accept the risk in triage.json (reason + expiry) and keep repo access tight. Public now or ever: rotate the Deploy key and the Identity credentials in the Umbraco Cloud portal, make the repo private, and check the CI/CD Deployment API key is a CI secret, not in the repo.' },
];

/** The platform rule for a file, or null. */
/**
 * Extra rules for --deep only. They point at trust boundaries the default rules leave to the
 * "what grep cannot see" pass: browser messaging, proxy and host-header trust, secret
 * comparison, model output, container and cloud policy, CI trust. Several of the areas follow the
 * attack classes of cloudflare/security-audit-skill (MIT); see references/deep-classes.md.
 * Same shape as RULES, plus `deep: true`; they keep the groups of RULES so --only still works.
 */
const IAC = ['tf', 'tfvars', 'json', 'yml', 'yaml', 'bicep', 'hcl'];
export const DEEP_RULES = [
  // ------------------------------------------------------------------ client side
  { id: 'xss.message-no-origin', group: 'xss', severity: 'medium', langs: JS,
    re: /addEventListener\s*\(\s*["'`]message["'`]|\bonmessage\s*=|\$\(\s*window\s*\)\.on\(\s*["']message["']/,
    unless: /\borigin\b|MessagePort|worker|Worker/,
    title: 'Message listener (check event.origin)', review: 'Real when the handler acts on event.data (navigates, writes HTML, stores tokens, calls an API) without comparing event.origin to an allowlist. Read the handler body; a check a few lines down is fine. Worker and MessageChannel ports are not cross-origin.', fix: 'if (event.origin !== EXPECTED_ORIGIN) return; before using event.data.' },
  { id: 'xss.postmessage-wildcard', group: 'xss', severity: 'low', langs: JS,
    re: /\.postMessage\s*\([^)]*,\s*["'`]\*["'`]\s*\)/,
    title: 'postMessage to any origin', review: 'Real when the message carries a token, user data or anything a framing page should not read.', fix: 'Pass the exact target origin instead of "*".' },
  { id: 'inject.prototype-pollution', group: 'injection', severity: 'medium', langs: JS,
    re: /(?:\b_\.(?:merge|mergeWith|defaultsDeep|set|setWith|zipObjectDeep)|\$\.extend\s*\(\s*true|\bdeepmerge|\bmerge(?:Deep|Recursive)?|\bdefaultsDeep|\bset(?:Value|Path)?|\bdot\.(?:set|str))\s*\([^)]*\b(?:req|request|ctx\.request)\.(?:body|query|params)/,
    title: 'Deep merge or path set from request data', review: 'Real when keys from the request reach the merge unfiltered: {"__proto__": {"isAdmin": true}} then changes every object. Check the library version and whether __proto__/constructor/prototype keys are dropped.', fix: 'Validate against a schema first; Object.create(null) targets; drop __proto__, constructor and prototype keys.' },
  { id: 'xss.service-worker', group: 'xss', severity: 'low', langs: JS,
    re: /navigator\.serviceWorker\.register\s*\(/,
    title: 'Service worker registration', review: 'Check the script URL is a fixed same-origin path (never from the URL or an upload folder) and the scope is no wider than needed; a worker that caches authenticated responses must vary them per user.', fix: 'Fixed script path, narrow scope, no caching of personalised responses.' },

  // ------------------------------------------------------------------ web protocol and identity
  { id: 'request.host-header', group: 'request', severity: 'medium', langs: SERVER,
    re: /\breq\.(?:headers\.host|hostname|get\(\s*["']host["']\s*\))|\bRequest\.Host\b|\bHttpContext\.Request\.Host\b|\$_SERVER\[\s*["']HTTP_HOST["']\s*\]|\brequest\.(?:get_host\(\)|host_url|host)\b|x-forwarded-host/i,
    title: 'Host header used by the app', review: 'Real when the value builds an absolute URL that leaves the request: password-reset or invite links in mail, redirects, cache keys, OAuth redirect URIs. Fine when the host is checked against an allowlist (AllowedHosts, ALLOWED_HOSTS) before use.', fix: 'Build absolute URLs from configuration (PUBLIC_URL), or validate Host against an allowlist.' },
  { id: 'request.forwarded-trust', group: 'request', severity: 'low', langs: SERVER,
    re: /["']trust proxy["']\s*,\s*true|x-forwarded-for|ForwardedHeaders\.All|KnownNetworks\.Clear\(\)|KnownProxies\.Clear\(\)|HTTP_X_FORWARDED_FOR|getClientIp|request\.access_route/i,
    title: 'Client IP from X-Forwarded-For', review: 'Real when the IP feeds rate limiting, lockout, allowlists or audit logs and the app is reachable without the proxy, or trusts every hop: the client then sets its own IP.', fix: 'Trust only the known proxy hops (trust proxy = 1, KnownProxies), or read the IP the edge sets.' },
  { id: 'auth.timing-compare', group: 'crypto', severity: 'low', langs: SERVER,
    re: /\b\w*(?:signature|hmac|digest|token|secret|api_?key|apikey)\w*\s*(?:===|!==|==|!=)\s*(?:req|request|ctx|params|headers|body|expected|computed|\w*(?:signature|hmac|digest|token|secret))/i,
    unless: /\b(?:null|undefined|None|typeof|length)\b|===?\s*["'`]/,
    title: 'Secret compared with ==', review: 'Real for webhook signatures, HMACs, API keys and reset tokens compared against request input: a plain compare leaks timing. Not for comparing ids or presence checks.', fix: 'crypto.timingSafeEqual (equal-length buffers), hmac.compare_digest, CryptographicOperations.FixedTimeEquals, hash_equals.' },
  { id: 'auth.hardcoded-signing-key', group: 'crypto', severity: 'medium', langs: SERVER,
    re: /\bjwt\.sign\s*\([^,]+,\s*["'`][^"'`]{3,}["'`]|\bcookieParser\s*\(\s*["'`][^"'`]{3,}["'`]|\bsession\s*\(\s*\{[^}]*secret\s*:\s*["'`][^"'`]{3,}["'`]|\bSymmetricSecurityKey\s*\(\s*Encoding\.\w+\.GetBytes\s*\(\s*"|\bSECRET_KEY\s*=\s*["'][^"']{3,}["']/,
    unless: /process\.env|os\.environ|getenv|Configuration\[|config\./,
    title: 'Signing or session key in code', review: 'Real when this key signs sessions or tokens in production: anyone with the repo can mint them. A test-only key is fine.', fix: 'Read the key from a secret store or environment variable and rotate the one in git.' },
  { id: 'crypto.static-iv', group: 'crypto', severity: 'medium', langs: SERVER,
    re: /createCipheriv\s*\([^,]+,[^,]+,\s*(?:["'`]|Buffer\.(?:from\s*\(\s*["'`]|alloc\s*\())|\bIV\s*=\s*(?:new\s+byte\s*\[\s*\d+\s*\]|Encoding\.\w+\.GetBytes\s*\(\s*")|\biv\s*=\s*b["']|AES\.new\([^)]*MODE_ECB|\bnonce\s*=\s*b["']/,
    title: 'Fixed IV or nonce', review: 'Real when the same key encrypts more than one message: a fixed IV or nonce breaks CBC/GCM confidentiality (and GCM integrity).', fix: 'A random IV/nonce per message (crypto.randomBytes(12) for GCM), stored with the ciphertext.' },
  { id: 'config.graphql-introspection', group: 'config', severity: 'low', langs: SERVER,
    re: /\bintrospection\s*:\s*true|\bplayground\s*:\s*true|\bgraphiql\s*:\s*true|\bGraphiQL\s*=\s*True|\.AddGraphQL\w*\([^)]*EnableIntrospection/,
    title: 'GraphQL introspection or playground on', review: 'Real when it is not gated on a development environment: the whole schema, including admin mutations, is public. Fine for a public API by design.', fix: 'Gate on NODE_ENV/ASPNETCORE_ENVIRONMENT; persisted queries for production.' },
  { id: 'config.body-limit', group: 'config', severity: 'low', langs: JS,
    re: /\blimit\s*:\s*["'`](?:[5-9]\d|\d{3,})\s*mb["'`]|\blimit\s*:\s*["'`]\d+\s*gb["'`]|maxFileSize\s*:\s*(?:Infinity|\d{9,})/i,
    title: 'Very large request body limit', review: 'Real on unauthenticated routes: one client can tie up memory and workers. Uploads that need it should stream to storage on their own route.', fix: 'A small default limit (100kb–1mb); a larger one only on the upload route, streamed.' },
  { id: 'inject.regex', group: 'injection', severity: 'low', langs: SERVER,
    re: /new\s+RegExp\s*\(\s*(?:req|request|ctx|params|query|body|input|search|term|filter)\b|\bRegex\s*\(\s*(?:Request|input|query|search)|re\.compile\s*\(\s*request\./,
    title: 'Regular expression built from input', review: 'Real when request input becomes the pattern: a crafted pattern can backtrack for seconds (ReDoS) or match more than intended.', fix: 'Escape the input (escapeRegExp, Regex.Escape, re.escape) or use a plain includes/indexOf; set a match timeout where the runtime has one.' },

  // ------------------------------------------------------------------ AI and LLM
  { id: 'secrets.llm-browser-key', group: 'secrets', severity: 'medium', langs: JS,
    re: /dangerouslyAllowBrowser\s*:\s*true/,
    title: 'Model API key used in the browser', review: 'Real when this code ships to browsers: the key is readable by every visitor and can be spent on their behalf.', fix: 'Call the model from a server route that holds the key and checks the user.' },
  { id: 'inject.llm-output', group: 'injection', severity: 'medium', langs: [...JS, ...PY],
    re: /(?:completion|choices\s*\[\s*0\s*\]|\.output_text|message\.content|response\.text|\.generated_text|llm\.invoke|\.invoke\s*\()[^\n]*(?:\beval\s*\(|\bexec\s*\(|innerHTML|dangerouslySetInnerHTML|child_process|subprocess\.|os\.system|\bFunction\s*\()|(?:\beval\s*\(|\bexec\s*\(|innerHTML\s*=|os\.system\s*\()[^\n]*(?:completion|choices\s*\[\s*0\s*\]|output_text|message\.content|generated_text)/,
    title: 'Model output into code, shell or HTML', review: 'Model output is attacker-influenced whenever the prompt holds user text, retrieved pages, mail or files. Real when it reaches eval, a shell, SQL or raw HTML without a fixed allowlist or sanitiser.', fix: 'Treat model output as untrusted input: parse to a schema, allowlist actions, render as text or sanitise.' },
  { id: 'inject.prompt-concat', group: 'injection', severity: 'low', langs: [...JS, ...PY],
    re: /role\s*["']?\s*:\s*["']system["'][^\n]*(?:\$\{|\+\s*\w|f["'])|(?:system_prompt|systemPrompt|SYSTEM_PROMPT)\s*[+:=]\s*(?:`[^`]*\$\{|f["']|[^\n]*\+\s*(?:req|request|user|input|body|query))/,
    title: 'User text in the system prompt', review: 'Real when untrusted text (the user, a web page, a document) is joined into the system or tool instructions and the model can act: call tools, send mail, read other users\' data.', fix: 'Keep instructions fixed; pass untrusted text as a separate user message, and enforce permissions in the tools, not in the prompt.' },

  // ------------------------------------------------------------------ cloud, containers, IaC
  { id: 'config.container-root', group: 'config', severity: 'low', langs: ['dockerfile', 'yml', 'yaml'],
    re: /^\s*USER\s+(?:root|0)(?::\S+)?\s*$|\brunAsUser\s*:\s*0\b|\brunAsNonRoot\s*:\s*false|\ballowPrivilegeEscalation\s*:\s*true/,
    title: 'Container runs as root', review: 'Real for the production image or pod: a code-execution bug then owns the container and its mounted secrets.', fix: 'USER with a non-root uid; runAsNonRoot: true, allowPrivilegeEscalation: false.' },
  { id: 'config.k8s-host', group: 'config', severity: 'medium', langs: ['yml', 'yaml', 'json'],
    re: /\bhost(?:Network|PID|IPC)\s*:\s*true|^\s*-?\s*hostPath\s*:|\bautomountServiceAccountToken\s*:\s*true/,
    title: 'Pod shares the host', review: 'Real outside node agents (log shippers, CNI): hostNetwork/hostPID/hostPath let a compromised pod reach the node and its other pods.', fix: 'Drop the host namespaces and hostPath; mount only the volumes the workload needs.' },
  { id: 'config.iam-wildcard', group: 'config', severity: 'medium', langs: IAC,
    re: /["']?Action["']?\s*[:=]\s*\[?\s*["']\*["']|\bactions\s*=\s*\[\s*["']\*["']|["']?Principal["']?\s*[:=]\s*["']\*["']|["']?Principal["']?\s*[:=]\s*\{\s*["']AWS["']\s*:\s*["']\*["']|\broles\/owner\b/,
    title: 'Wildcard IAM action or principal', review: 'Real when the policy grants every action, or lets anyone (Principal "*") use the resource, without a narrowing Condition.', fix: 'List the actions the workload calls; name the principal; add conditions (aws:SourceArn, aws:PrincipalOrgID).' },
  { id: 'config.open-ingress', group: 'config', severity: 'medium', langs: IAC,
    re: /0\.0\.0\.0\/0|::\/0|["']?sourceAddressPrefix["']?\s*[:=]\s*["'](?:\*|Internet)["']/,
    unless: /egress|outbound/i,
    title: 'Ingress open to the internet', review: 'Real for any port other than the public 80/443 of a load balancer: SSH, RDP, databases, admin ports. Read the rule\'s from_port/to_port.', fix: 'Restrict the source to the office/VPN range or a bastion; keep databases private.' },
  { id: 'config.public-storage', group: 'config', severity: 'medium', langs: IAC,
    re: /\bacl\s*=\s*["']public-read(?:-write)?["']|AccessControl\s*:\s*PublicRead|\bblock_public_(?:acls|policy)\s*=\s*false|BlockPublic(?:Acls|Policy)\s*:\s*false|\ballUsers\b|\ballAuthenticatedUsers\b|allowBlobPublicAccess["']?\s*[:=]\s*true/,
    title: 'Public storage bucket or container', review: 'Real unless the bucket only serves public assets by design (a static site). Check what is written to it: uploads, exports and backups must not be public.', fix: 'Block public access; serve public files through a CDN with an origin access identity; signed URLs for private files.' },

  // ------------------------------------------------------------------ CI and supply chain
  { id: 'ci.self-hosted', group: 'ci', severity: 'medium', ci: true,
    re: /runs-on\s*:\s*\[?\s*["']?self-hosted/,
    title: 'Self-hosted runner', review: 'Real when the workflow runs for pull requests from forks: their code then runs on your machine, which may keep state and network access between jobs.', fix: 'GitHub-hosted runners for untrusted triggers; ephemeral, isolated self-hosted runners otherwise.' },
  { id: 'ci.workflow-run', group: 'ci', severity: 'medium', ci: true,
    re: /^\s*(?:-\s*)?workflow_run\s*:|^\s*on\s*:\s*\[?[^\n]*\bworkflow_run\b/,
    title: 'workflow_run trigger', review: 'Real when the job downloads artifacts from the triggering run (built from a fork PR) and executes or trusts them with secrets or a write token.', fix: 'Treat downloaded artifacts as untrusted data: never execute them; check the triggering run\'s head repository.' },
].map((r) => ({ ...r, deep: true }));

export const platformFor = (rel) => PLATFORM_FILES.find((p) => p.test(rel)) || null;

export const CI_FILE = /(^|\/)(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|\.circleci\/config\.ya?ml)$/;

export function extOf(rel) {
  const base = rel.split('/').pop();
  if (/^dockerfile/i.test(base) || /\.dockerfile$/i.test(base)) return 'dockerfile';
  if (/^\.env/.test(base)) return 'env';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function rulesFor(rel, { deep = false } = {}) {
  const ext = extOf(rel);
  const ci = CI_FILE.test(rel);
  return (deep ? [...RULES, ...DEEP_RULES] : RULES).filter((r) => (r.ci ? ci : (r.langs === null || r.langs.includes(ext))));
}

/** Show enough of a secret to recognise it, never the whole thing. */
export function redact(s) {
  if (s.length <= 8) return `${s.slice(0, 2)}…`;
  return `${s.slice(0, Math.min(6, Math.floor(s.length / 4)))}…[${s.length} chars]`;
}

const MAX_LINE = 400;

/**
 * Run the line rules over one file's text. Returns hits:
 *   { id, line, col, text, match? }   (text = trimmed line, secret part redacted; match = the redacted secret)
 */
export function scanText(rel, text, rules = rulesFor(rel)) {
  const hits = [];
  if (!rules.length) return hits;
  const lines = text.split(/\r?\n/);
  if (lines.slice(0, 15).some((l) => l.includes('audit-security: ignore-file'))) return hits;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // minified / generated
    const seen = new Set(); // secret values already reported on this line, so one token is one hit
    for (const r of rules) {
      const m = r.re.exec(line);
      if (!m) continue;
      if (r.unless?.test(line)) continue;
      if (r.placeholderCheck && PLACEHOLDER.test(m[1] ?? m[0])) continue;
      if (/EXAMPLE|AKIAIOSFODNN7/.test(m[0]) && r.id === 'secrets.aws-key') continue;
      if (/audit-security:\s*ignore/.test(line)) continue;
      if (r.secret) { const v = m[1] ?? m[0]; if ([...seen].some((x) => x.includes(v) || v.includes(x))) continue; seen.add(v); }
      let shown = line.trim();
      if (r.secret) shown = shown.replace(m[1] ?? m[0], redact(m[1] ?? m[0]));
      if (shown.length > MAX_LINE) shown = `${shown.slice(0, MAX_LINE)}…`;
      hits.push({ id: r.id, line: i + 1, col: m.index + 1, text: shown, ...(r.secret ? { match: redact(m[1] ?? m[0]) } : {}) });
    }
  }
  return hits;
}
