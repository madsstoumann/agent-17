// audit-security: ignore-file (its own patterns would select every review area)
/**
 * --deep, code mode: the inventory that seeds the review, the coverage ledger and the checks on
 * what Claude writes back (deep/ledger.json, deep/verdicts.json).
 *
 * The method (map the trust boundaries, plan coverage per attack class, hunt per unit, let a fresh
 * agent try to refute every candidate, give severity only to confirmed records) is adapted from
 * cloudflare/security-audit-skill, MIT licence, (c) 2025-2026 Cloudflare, Inc.
 * (references/THIRD-PARTY-NOTICES.md). The code here is our own.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { RULES, scanText, CI_FILE } from './patterns.mjs';

// ------------------------------------------------------------------ areas (references/deep-classes.md)

/** Always reviewed. `anchor` is the heading in references/deep-classes.md. */
export const CORE_AREAS = [
  { id: 'injection', title: 'Injection', split: true },
  { id: 'access', title: 'Access control', split: true },
  { id: 'files', title: 'Files, outbound requests and deserialisation' },
  { id: 'secrets', title: 'Cryptography and secrets' },
  { id: 'logic', title: 'Business logic' },
  { id: 'abuse', title: 'Feature abuse, data leakage and chains' },
  { id: 'obvious', title: 'Obvious things' },
  { id: 'wildcard', title: 'Wildcard' },
];

/**
 * Reviewed when the inventory finds the boundary: `deps` (package names in a manifest),
 * `path` (a file path) or `text` (a line in a scanned file). Each hit is kept as evidence.
 */
export const DOMAINS = [
  { id: 'web', title: 'HTTP, sessions and identity',
    deps: /^(express|next|fastify|koa|@hapi\/hapi|hapi|@nestjs\/core|hono|@remix-run\/\w+|nuxt|@sveltejs\/kit|astro|django|flask|fastapi|starlette|rails|laravel\/framework|symfony\/\w+|Microsoft\.AspNetCore\.\w+|Umbraco\.Cms(\.\w+)?|passport|next-auth|@auth\/core|jsonwebtoken|jose|express-session|openid-client|@azure\/msal-\w+|Microsoft\.Identity\.\w+)$/i,
    text: /\b(?:AddAuthentication|UseAuthentication|AddJwtBearer|passport\.use|NextAuth\(|getServerSession|jwt\.verify|express-session|SAMLResponse|openid-client|oauth2?)\b/ },
  { id: 'client', title: 'Client side and browser',
    deps: /^(react|react-dom|vue|svelte|@angular\/core|jquery|preact|solid-js|lit|alpinejs|htmx\.org)$/i,
    path: /\.(jsx|tsx|vue|svelte|astro)$/i,
    text: /\bpostMessage\s*\(|addEventListener\s*\(\s*["']message["']|serviceWorker\.register|localStorage\.setItem\s*\(\s*["'][^"']*(?:token|jwt|session)/i },
  { id: 'supply', title: 'Supply chain and CI',
    path: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|composer\.lock|poetry\.lock|Pipfile\.lock|requirements[^/]*\.txt|Gemfile\.lock|go\.sum|Cargo\.lock|\.npmrc|nuget\.config|Directory\.Packages\.props)$/i,
    ci: true },
  { id: 'cloud', title: 'Cloud, containers and infrastructure as code',
    path: /(^|\/)(Dockerfile[^/]*|[^/]*\.dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml|[^/]+\.tf|[^/]+\.bicep|serverless\.ya?ml|wrangler\.toml|vercel\.json|netlify\.toml|Chart\.yaml|kustomization\.ya?ml|cdk\.json|template\.ya?ml|fly\.toml|app\.yaml|azure-pipelines[^/]*\.ya?ml)$|(^|\/)(k8s|kubernetes|helm|charts|infra|terraform|deploy)\//i,
    text: /^\s*(?:apiVersion:\s*\S+|kind:\s*(?:Deployment|Pod|Service|Ingress|Role|ClusterRole|RoleBinding)\b)/ },
  { id: 'ai', title: 'AI, LLM and agents',
    deps: /^(openai|@anthropic-ai\/sdk|anthropic|langchain|@langchain\/\w+|llamaindex|llama-index|ai|@ai-sdk\/\w+|@modelcontextprotocol\/sdk|mcp|ollama|cohere-ai|@google\/generative-ai|google-generativeai|@azure\/openai|Azure\.AI\.OpenAI|Microsoft\.SemanticKernel|OpenAI|Anthropic\.SDK|transformers)$/i,
    text: /\b(?:chat\.completions\.create|messages\.create|ChatCompletion|generateText|streamText|McpServer|tool_choice|function_call)\b/ },
  { id: 'protocols', title: 'RPC, GraphQL, queues and webhooks',
    deps: /^(@grpc\/grpc-js|grpcio|Grpc\.AspNetCore|graphql|@apollo\/server|apollo-server(-\w+)?|graphql-yoga|HotChocolate(\.\w+)?|kafkajs|amqplib|bullmq|bull|nats|mqtt|ws|socket\.io|MassTransit|RabbitMQ\.Client|Azure\.Messaging\.\w+|@azure\/service-bus|celery|pika|sidekiq|@aws-sdk\/client-sqs|stripe|svix)$/i,
    path: /\.(proto|graphql|gql)$/i,
    text: /\bwebhook\w*\b|\bconstructEvent\s*\(|\bWebSocketServer\b|\bon\s*\(\s*["']connection["']/i },
  { id: 'resources', title: 'Resource exhaustion and spend',
    deps: /^(multer|busboy|formidable|sharp|jimp|unzipper|adm-zip|archiver|tar|yauzl|xml2js|fast-xml-parser|pdf-parse|pdfjs-dist|SixLabors\.ImageSharp|SharpZipLib|Pillow|lxml|ffmpeg-static|fluent-ffmpeg|puppeteer|playwright)$/i,
    text: /\b(?:IFormFile|request\.files|\$_FILES|zlib\.(?:gunzip|inflate)|ZipArchive|ZipFile|decompress|rateLimit|RateLimiter)\b/ },
  { id: 'data', title: 'Data isolation and lifecycle',
    text: /\b(?:tenant_?id|tenantId|org(?:anization)?_?id|orgId|organizationId|workspace_?id|workspaceId|deletedAt|deleted_at|IsDeleted|soft_?delete|paranoid\s*:\s*true|withTrashed|row level security|ROW LEVEL SECURITY)\b/ },
  { id: 'native', title: 'Memory safety and native code',
    path: /\.(c|cc|cpp|cxx|h|hh|hpp|rs|zig|m|mm)$|(^|\/)(binding\.gyp|CMakeLists\.txt|Cargo\.toml|Makefile)$/i,
    text: /\bunsafe\s*\{|\bextern\s+"C"|\bDllImport\b|\bffi\b|\bnode-gyp\b/ },
  { id: 'apps', title: 'Desktop, mobile and local IPC',
    deps: /^(electron|react-native|@capacitor\/core|cordova|@tauri-apps\/api|expo|@ionic\/\w+|Microsoft\.Maui\.\w+|Xamarin\.\w+)$/i,
    path: /(^|\/)(AndroidManifest\.xml|Info\.plist|[^/]+\.xcodeproj\/|[^/]+\.entitlements|tauri\.conf\.json|electron-builder\.\w+)$/i,
    text: /\b(?:ipcMain|ipcRenderer|contextBridge|nodeIntegration\s*:\s*true|WKWebView|addJavascriptInterface|NSXPCConnection)\b/ },
];

export const AREAS = [...CORE_AREAS, ...DOMAINS.map(({ id, title }) => ({ id, title }))];
export const areaById = Object.fromEntries(AREAS.map((a) => [a.id, a]));

// ------------------------------------------------------------------ entry surfaces and controls

/** Where lower-trust input comes in, and the controls that guard it. One line per hit. */
export const SURFACES = [
  { kind: 'http-route', re: /\b(?:app|router|server|api|routes?|fastify|hono)\.(?:get|post|put|patch|delete|all|route)\s*\(\s*["'`]/ },
  { kind: 'http-route', re: /\[(?:Http(?:Get|Post|Put|Delete|Patch)|Route)\b|\.Map(?:Get|Post|Put|Delete|Patch|Methods|Group|Controllers?)\s*\(|:\s*(?:Controller|ControllerBase|ApiController|SurfaceController|UmbracoApiController|UmbracoAuthorizedApiController|RenderController)\b/ },
  { kind: 'http-route', re: /@\w+\.(?:route|get|post|put|delete|patch|websocket)\s*\(|@(?:Get|Post|Put|Delete|Patch|Request)Mapping\b|\bRoute::(?:get|post|put|patch|delete|any|match|resource)\b|\.(?:HandleFunc|Handle)\s*\(\s*"/ },
  { kind: 'http-route', file: /(^|\/)urls\.py$/, re: /\b(?:re_)?path\s*\(\s*r?["']/ },
  { kind: 'http-route', file: /(^|\/)config\/routes\.rb$/, re: /^\s*(?:get|post|put|patch|delete|resources?|namespace)\s+["':]/ },
  { kind: 'server-action', re: /^\s*["']use server["']/ },
  { kind: 'upload', re: /\bmulter\s*\(|\bIFormFile\b|\brequest\.files\b|\$_FILES\b|\bbusboy\b|\bformidable\s*\(/ },
  { kind: 'webhook', re: /webhook/i, also: /\b(?:post|route|Map\w*|Http\w+)\b/i },
  { kind: 'cli', re: /\bprocess\.argv\b|\bargparse\.ArgumentParser\b|\bnew\s+Command\s*\(|\byargs\b|System\.CommandLine|\bclick\.command\b/ },
  { kind: 'queue-consumer', re: /\.(?:consume|subscribe|process)\s*\(\s*["'`][\w.:/-]+["'`]|@(?:KafkaListener|RabbitListener|SqsListener)\b|\bIConsumer<|\bnew\s+Worker\s*\(\s*["'`]/ },
  { kind: 'llm-call', re: /\b(?:chat\.completions\.create|messages\.create|generateText|streamText|ChatCompletion\.create|GetChatCompletions\w*|\.invoke\s*\(\s*\{?\s*(?:messages|input))\b/ },
  { kind: 'auth-control', re: /\[Authorize\b|\[AllowAnonymous\]|\bRequireAuthorization\s*\(|\bUseAuthorization\s*\(|\brequireAuth\w*\b|\bisAuthenticated\b|\bpassport\.authenticate\s*\(|\bgetServerSession\s*\(|\bauth\s*\(\s*\)|@login_required|\bpermission_classes\b|before_action\s+:authenticate|\bmiddleware\s*\(\s*["']auth|\bjwt\.verify\s*\(|\bverifyToken\b|\bclerkMiddleware\b|\bwithAuth\b|\bensureLoggedIn\b|\bcurrentUser\b|\bcan\?\(|\bauthorize!?\s*\(|\bGate::|\bPolicy\b/ },
];

const PATH_SURFACES = [
  { kind: 'http-route', file: /(^|\/)app\/(?:.*\/)?route\.[cm]?[jt]sx?$/ },
  { kind: 'http-route', file: /(^|\/)pages\/api\/.+\.[cm]?[jt]sx?$/ },
  { kind: 'http-route', file: /^(?:api|functions|netlify\/functions)\/[^/]+\.[cm]?[jt]s$/ },
  { kind: 'http-route', file: /(^|\/)src\/routes\/.*\+(?:server|page\.server)\.[jt]s$/ },
];

const MANIFEST = /(^|\/)(package\.json|[^/]+\.csproj|Directory\.Packages\.props|packages\.config|requirements[^/]*\.txt|pyproject\.toml|Pipfile|composer\.json|Gemfile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?)$/i;
const MAX_SAMPLES = 40;

/** Package names a manifest declares (no versions; enough to pick review areas). */
export function manifestNames(rel, text) {
  const base = rel.split('/').pop().toLowerCase();
  const out = new Set();
  if (base === 'package.json' || base === 'composer.json') {
    try {
      const j = JSON.parse(text);
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'require', 'require-dev']) for (const n of Object.keys(j[k] || {})) out.add(n);
    } catch { /* not JSON */ }
  } else if (/\.csproj$|\.props$|packages\.config$/.test(base)) {
    for (const m of text.matchAll(/<Package(?:Reference|Version)\s+[^>]*Include\s*=\s*"([^"]+)"|<package\s+id\s*=\s*"([^"]+)"/gi)) out.add(m[1] || m[2]);
  } else if (/^requirements/.test(base)) {
    for (const l of text.split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z0-9][\w.-]*)/); if (m && !l.trim().startsWith('#') && !l.trim().startsWith('-')) out.add(m[1]); }
  } else if (base === 'pyproject.toml' || base === 'pipfile' || base === 'cargo.toml') {
    for (const m of text.matchAll(/^\s*["']?([A-Za-z0-9][\w.-]*)["']?\s*=|["']([A-Za-z0-9][\w.-]*)\s*[<>=~!\[;"']/gm)) out.add(m[1] || m[2]);
  } else if (base === 'gemfile') {
    for (const m of text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) out.add(m[1]);
  } else if (base === 'go.mod') {
    for (const m of text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\/[\w./-]+)\s+v\d/gm)) out.add(m[1]);
  } else if (base === 'pom.xml' || base.startsWith('build.gradle')) {
    for (const m of text.matchAll(/<artifactId>([^<]+)<\/artifactId>|["']([\w.-]+:[\w.-]+):/g)) out.add(m[1] || m[2]);
  }
  return [...out];
}

/** The folder a surface belongs to, for splitting units: the first two path segments of its folder. */
export function subsystemOf(rel) {
  const dir = rel.split('/').slice(0, -1);
  if (!dir.length) return '.';
  const top = ['src', 'app', 'apps', 'packages', 'services', 'libs', 'modules', 'server', 'api'].includes(dir[0]) && dir[1] ? dir.slice(0, 2) : dir.slice(0, 1);
  return top.join('/');
}

/**
 * Collects facts while scan.mjs walks the files: file(rel) for every listed file, text(rel, text)
 * for every file it reads. done() returns the inventory.
 */
export function createInventory() {
  const languages = {};
  const surfaces = {};
  const domainHits = Object.fromEntries(DOMAINS.map((d) => [d.id, []]));
  const packages = new Set();
  const subsystems = {};
  const add = (list, item) => { if (list.length < MAX_SAMPLES) list.push(item); };
  const surface = (kind, item) => {
    const s = (surfaces[kind] ||= { count: 0, samples: [] });
    s.count++;
    add(s.samples, item);
    if (kind !== 'auth-control' && kind !== 'cli') subsystems[subsystemOf(item.file)] = (subsystems[subsystemOf(item.file)] || 0) + 1;
  };
  return {
    file(rel) {
      const ext = (rel.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
      if (ext) languages[ext] = (languages[ext] || 0) + 1;
      for (const s of PATH_SURFACES) if (s.file.test(rel)) surface(s.kind, { file: rel, line: 0, text: '(route file)' });
      for (const d of DOMAINS) {
        if (d.path?.test(rel)) add(domainHits[d.id], { file: rel, why: 'file' });
        if (d.ci && CI_FILE.test(rel)) add(domainHits[d.id], { file: rel, why: 'CI workflow' });
      }
    },
    text(rel, text) {
      if (MANIFEST.test(rel)) {
        for (const n of manifestNames(rel, text)) {
          packages.add(n);
          for (const d of DOMAINS) if (d.deps?.test(n)) add(domainHits[d.id], { file: rel, why: `package ${n}` });
        }
      }
      if (text.slice(0, 2000).includes('audit-security: ignore-file')) return;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 4000) continue;
        for (const s of SURFACES) {
          if (s.file && !s.file.test(rel)) continue;
          if (s.re.test(line) && (!s.also || s.also.test(line))) surface(s.kind, { file: rel, line: i + 1, text: line.trim().slice(0, 160) });
        }
        for (const d of DOMAINS) {
          if (d.text && domainHits[d.id].length < MAX_SAMPLES && d.text.test(line)) add(domainHits[d.id], { file: rel, line: i + 1, why: line.trim().slice(0, 120) });
        }
      }
    },
    done() {
      const domains = DOMAINS.map((d) => ({ id: d.id, title: d.title, selected: domainHits[d.id].length > 0, evidence: domainHits[d.id].slice(0, 8), count: domainHits[d.id].length }));
      const subs = Object.entries(subsystems).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, surfaces: count }));
      const langs = Object.fromEntries(Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 15));
      return { languages: langs, packages: packages.size, surfaces, subsystems: subs, domains };
    },
  };
}

// ------------------------------------------------------------------ ledger

export const UNIT_STATUSES = ['planned', 'covered', 'candidate', 'blocked', 'deferred', 'not_applicable'];
export const FINAL_STATUSES = UNIT_STATUSES.filter((s) => s !== 'planned');
const MAX_SPLIT = 6;

const unitId = (area, subsystem) => `${area}::${subsystem}`;

function startingPaths(inv, area, subsystem) {
  const files = new Set();
  const want = (f) => subsystem === 'all' || subsystemOf(f) === subsystem;
  if (areaById[area] && DOMAINS.some((d) => d.id === area)) {
    for (const e of inv.domains.find((d) => d.id === area)?.evidence || []) if (want(e.file)) files.add(e.line ? `${e.file}:${e.line}` : e.file);
  } else {
    const kinds = area === 'access' ? ['auth-control', 'http-route', 'server-action'] : area === 'files' ? ['upload', 'http-route'] : ['http-route', 'server-action', 'webhook', 'queue-consumer', 'cli', 'upload'];
    for (const k of kinds) for (const s of inv.surfaces[k]?.samples || []) if (want(s.file)) files.add(s.line ? `${s.file}:${s.line}` : s.file);
  }
  return [...files].slice(0, 8);
}

/**
 * The coverage plan: one unit per core area (injection and access control split per subsystem
 * when the routes live in more than one), plus one per selected domain. A unit the last deep run
 * had keeps its id and gets `prior`; a unit only the last run had is carried as planned work, so
 * nothing it found or left open disappears silently.
 */
export function seedLedger(inv, { prior = null, at = new Date().toISOString() } = {}) {
  const units = [];
  const subs = inv.subsystems.slice(0, MAX_SPLIT).map((s) => s.name);
  const unit = (area, subsystem) => ({
    id: unitId(area, subsystem), area, title: areaById[area].title, classes: `references/deep-classes.md#${area}`,
    subsystem, startingPaths: startingPaths(inv, area, subsystem),
    status: 'planned', checked: [], findings: [], reason: '',
  });
  for (const a of CORE_AREAS) {
    if (a.split && subs.length > 1) for (const s of subs) units.push(unit(a.id, s));
    else units.push(unit(a.id, 'all'));
  }
  for (const d of inv.domains) if (d.selected) units.push(unit(d.id, 'all'));
  const before = new Map((prior?.units || []).map((u) => [u.id, u]));
  for (const u of units) {
    const p = before.get(u.id);
    if (p) u.prior = { status: p.status, findings: p.findings || [], reason: p.reason || '' };
  }
  for (const p of before.values()) {
    if (units.some((u) => u.id === p.id) || !areaById[p.area]) continue;
    units.push({ ...unit(p.area, p.subsystem || 'all'), id: p.id, prior: { status: p.status, findings: p.findings || [], reason: p.reason || '' }, note: 'from the last deep run; not seeded by this inventory' });
  }
  units.sort((a, b) => a.id.localeCompare(b.id));
  return { version: 1, at, units };
}

// ------------------------------------------------------------------ verdicts

export const VERDICTS = ['confirmed', 'needs-validation', 'rejected'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const BOUNDARY = ['principal', 'input', 'control', 'crossed', 'affected'];
const TRACE = /^(.+?):(\d+)(?:-\d+)?$/;

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const traceFile = (t) => (String(t).match(TRACE) || [])[1] || null;

/** Source-derived identity of a record: area, entry file, sink file, the control. No line numbers, no wording. */
export function recordFp(rec, ledger) {
  const unit = ledger?.units?.find((u) => u.id === rec.unit);
  const trace = rec.trace || [];
  return sha(`deep|${unit?.area || rec.area || ''}|${traceFile(trace[0]) || ''}|${traceFile(trace.at(-1)) || ''}|${String(rec.boundary?.control || '').toLowerCase().replace(/\s+/g, ' ').trim()}`);
}

const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v != null);

/**
 * Checks deep/ledger.json and deep/verdicts.json against the rules in references/deep.md.
 * `root` is the repo (trace entries must point at real lines in it). Returns { errors, warnings, counts }.
 */
export function validateDeep({ ledger, verdicts, root, readFile = (p) => fs.readFileSync(p, 'utf8') }) {
  const errors = [];
  const warnings = [];
  const units = ledger?.units;
  if (!Array.isArray(units)) errors.push('ledger.json: no "units" array');
  const records = verdicts?.records;
  if (!Array.isArray(records)) errors.push('verdicts.json: no "records" array');
  if (errors.length) return { errors, warnings, counts: {} };

  const byUnit = new Map();
  for (const u of units) {
    const where = `unit ${u.id}`;
    if (byUnit.has(u.id)) errors.push(`${where}: duplicate id`);
    byUnit.set(u.id, u);
    if (!areaById[u.area]) errors.push(`${where}: unknown area "${u.area}"`);
    if (!UNIT_STATUSES.includes(u.status)) { errors.push(`${where}: status "${u.status}" is not one of ${UNIT_STATUSES.join(', ')}`); continue; }
    if (u.status === 'planned') errors.push(`${where}: still planned; give it covered, candidate, blocked, deferred or not_applicable`);
    const checked = nonEmpty(u.checked);
    const found = nonEmpty(u.findings);
    if (['covered', 'candidate', 'blocked'].includes(u.status) && !checked) errors.push(`${where}: ${u.status} needs "checked" (the files and controls you read)`);
    if (u.status === 'covered' && found) errors.push(`${where}: covered but lists findings; use candidate`);
    if (u.status === 'candidate' && !found) errors.push(`${where}: candidate needs "findings" (record ids)`);
    if (['blocked', 'deferred', 'not_applicable'].includes(u.status) && !nonEmpty(u.reason)) errors.push(`${where}: ${u.status} needs a "reason"`);
    if (['deferred', 'not_applicable'].includes(u.status) && found) errors.push(`${where}: ${u.status} cannot list findings`);
  }

  const lines = new Map();
  const fileLines = (rel) => {
    if (!lines.has(rel)) {
      let n = null;
      try {
        const abs = path.resolve(root, rel);
        if (abs === root || abs.startsWith(root + path.sep)) n = readFile(abs).split(/\r?\n/).length;
      } catch { n = null; }
      lines.set(rel, n);
    }
    return lines.get(rel);
  };
  const ids = new Set();
  const counts = { confirmed: 0, 'needs-validation': 0, rejected: 0 };
  const secretRules = RULES.filter((r) => r.secret && r.id !== 'secrets.generic');
  for (const r of records) {
    const where = `record ${r.id || '(no id)'}`;
    if (!nonEmpty(r.id)) errors.push(`${where}: needs an "id"`);
    else if (ids.has(r.id)) errors.push(`${where}: duplicate id`);
    ids.add(r.id);
    if (!VERDICTS.includes(r.verdict)) { errors.push(`${where}: verdict "${r.verdict}" is not one of ${VERDICTS.join(', ')}`); continue; }
    counts[r.verdict]++;
    if (!nonEmpty(r.title)) errors.push(`${where}: needs a "title"`);
    const u = byUnit.get(r.unit);
    if (!u) errors.push(`${where}: unit "${r.unit}" is not in ledger.json`);
    else if (r.verdict !== 'rejected' && !(u.findings || []).includes(r.id)) errors.push(`${where}: its unit ${u.id} does not list it under "findings"`);
    if (r.verdict !== 'confirmed' && r.severity != null) errors.push(`${where}: only confirmed records get a severity`);
    const trace = Array.isArray(r.trace) ? r.trace : [];
    for (const t of trace) {
      const m = String(t).match(TRACE);
      if (!m) { errors.push(`${where}: trace entry "${t}" is not file:line`); continue; }
      const n = fileLines(m[1]);
      if (n == null) errors.push(`${where}: trace file ${m[1]} is not in the repo`);
      else if (Number(m[2]) < 1 || Number(m[2]) > n) errors.push(`${where}: ${m[1]} has ${n} lines, trace says ${m[2]}`);
    }
    if (r.verdict === 'confirmed') {
      for (const k of BOUNDARY) if (!nonEmpty(r.boundary?.[k])) errors.push(`${where}: confirmed needs boundary.${k}`);
      if (trace.length < 2) errors.push(`${where}: confirmed needs a trace from the entry point to the sink (2 or more file:line)`);
      if (!SEVERITIES.includes(r.severity)) errors.push(`${where}: confirmed needs a severity (${SEVERITIES.join(', ')})`);
      for (const k of ['result', 'fix', 'verifiedBy']) if (!nonEmpty(r[k])) errors.push(`${where}: confirmed needs "${k}"`);
    } else if (r.verdict === 'needs-validation') {
      if (trace.length < 1) errors.push(`${where}: needs-validation needs the source trace so far`);
      for (const k of ['blocker', 'check']) if (!nonEmpty(r[k])) errors.push(`${where}: needs-validation needs "${k}"`);
    } else if (!nonEmpty(r.reason)) errors.push(`${where}: rejected needs a "reason" (what refuted it)`);
    const json = JSON.stringify(r);
    for (const h of scanText('verdicts.json', json, secretRules)) errors.push(`${where}: contains what looks like a secret (${h.id}); quote file:line and a redacted prefix only`);
  }
  for (const u of units) for (const f of u.findings || []) if (!ids.has(f)) errors.push(`unit ${u.id}: finding "${f}" is not in verdicts.json`);
  const unitCounts = Object.fromEntries(UNIT_STATUSES.map((s) => [s, units.filter((u) => u.status === s).length]));
  if (!records.length && !units.some((u) => u.status === 'candidate')) warnings.push('no records: fine for a clean run, say so in the report');
  return { errors, warnings, counts: { ...counts, units: unitCounts } };
}

/** What changed since the last saved deep run, by record fp. */
export function diffVerdicts(prev, cur) {
  const before = new Map((prev?.records || []).filter((r) => r.verdict !== 'rejected').map((r) => [r.fp, r]));
  const now = (cur?.records || []).filter((r) => r.verdict !== 'rejected');
  const open = now.filter((r) => before.has(r.fp));
  const added = now.filter((r) => !before.has(r.fp));
  const seen = new Set(now.map((r) => r.fp));
  const gone = [...before.values()].filter((r) => !seen.has(r.fp));
  return { open, new: added, gone };
}

/** Inventory -> the DEEP block of the scanner's summary. */
export function inventoryLines(deep) {
  const L = [];
  const inv = deep.inventory;
  L.push(`DEEP  inventory, tools and coverage plan (references/deep.md)`);
  L.push(`  languages: ${Object.entries(inv.languages).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; ${inv.packages} declared package(s)`);
  const kinds = Object.entries(inv.surfaces).map(([k, v]) => `${k} ${v.count}`);
  L.push(`  entry surfaces and controls: ${kinds.join(', ') || 'none found by pattern (read the entry points yourself)'}`);
  if (inv.subsystems.length) L.push(`  subsystems: ${inv.subsystems.slice(0, 8).map((s) => `${s.name} (${s.surfaces})`).join(', ')}`);
  const sel = inv.domains.filter((d) => d.selected);
  L.push(`  review areas besides the core eight: ${sel.map((d) => `${d.id} (${d.evidence[0] ? `${d.evidence[0].file}${d.evidence[0].line ? `:${d.evidence[0].line}` : ''}` : ''}${d.count > 1 ? ` +${d.count - 1}` : ''})`).join(', ') || 'none'}`);
  const skipped = inv.domains.filter((d) => !d.selected).map((d) => d.id);
  if (skipped.length) L.push(`  not selected (no evidence): ${skipped.join(', ')}`);
  for (const t of deep.tools) L.push(`  ${t.status.toUpperCase().padEnd(4)} ${t.title}: ${t.evidence}${t.status === 'skip' && t.install ? ` (install: ${t.install})` : ''}`);
  L.push(`  ledger: ${deep.files.ledger} (${deep.units} units, all planned)`);
  L.push(`  verdicts: ${deep.files.verdicts} (you write records here)`);
  L.push(`  check: node "<skill>/scripts/deep-check.mjs" "${deep.files.dir}" --save`);
  return L;
}
