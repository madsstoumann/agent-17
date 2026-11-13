/**
 * --deep, code mode: the external scanners. Each runs only when it is already on PATH; the skill
 * never installs anything. A missing tool, --offline, a timeout or a failure is a "not run" row
 * with the reason (lib/levels.mjs notChecked), never a pass.
 *
 * Results become scanner rules (`semgrep:<check>`, `gitleaks:<rule>`, `trufflehog:<detector>`,
 * `osv-scanner:<level>`), so triage, fingerprints, triage.json and --level work on them as on the
 * scanner's own hits. Secrets are never stored: gitleaks runs with --redact, TruffleHog's raw
 * value is reduced to the scanner's redacted prefix, and Semgrep's matched line is dropped for its
 * secrets rules. TruffleHog runs with --no-verification: verifying a key means calling the
 * provider with it, which an audit must not do.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { redact } from './patterns.mjs';
import { notChecked } from './levels.mjs';
import { SKIP_DIRS } from './files.mjs';

export const TOOLS = [
  { id: 'semgrep', title: 'Semgrep', groups: ['xss', 'injection', 'request', 'crypto', 'config', 'ci', 'secrets'], network: 'downloads the rule packs from the Semgrep registry',
    install: 'brew install semgrep, or pipx install semgrep', minutes: 9 },
  { id: 'osv-scanner', title: 'osv-scanner', groups: ['deps'], network: 'queries osv.dev',
    install: 'brew install osv-scanner, or go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest', minutes: 5 },
  { id: 'gitleaks', title: 'Gitleaks', groups: ['secrets'], install: 'brew install gitleaks', minutes: 5 },
  { id: 'trufflehog', title: 'TruffleHog', groups: ['secrets'], install: 'brew install trufflehog', minutes: 5 },
];

export const SEMGREP_CONFIGS = ['p/owasp-top-ten', 'p/security-audit', 'p/secrets'];

/** True when `name` is an executable on PATH (PATHEXT on Windows). */
export function onPath(name, { env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, name + e);
      if (!exists(p)) continue;
      if (platform === 'win32') return true;
      try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return true; } catch { /* not executable */ }
    }
  }
  return false;
}

function defaultExec(cmd, args, { cwd, timeout }) {
  const r = spawnSync(cmd, args, { cwd, timeout, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: r.error?.code === 'ETIMEDOUT', error: r.error && r.error.code !== 'ETIMEDOUT' ? r.error.message : null };
}

const firstLine = (s) => String(s || '').trim().split('\n').find((l) => l.trim())?.trim().slice(0, 160) || '';
const skippedDir = (rel) => rel.split('/').some((seg, i, all) => SKIP_DIRS.has(seg) || SKIP_DIRS.has(all.slice(0, i + 1).join('/')));

/** Path relative to root with forward slashes; null when it is outside. */
export function relTo(root, p) {
  if (!p) return null;
  let s = String(p).replace(/^file:\/\//, '');
  if (!path.isAbsolute(s)) s = path.resolve(root, s);
  const rel = path.relative(root, s);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

const SEMGREP_SEV = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };

/** Semgrep JSON -> hits by check. */
export function parseSemgrep(json, root) {
  const out = [];
  for (const r of json?.results || []) {
    const file = relTo(root, r.path);
    if (!file || skippedDir(file)) continue;
    const secret = /secret|token|password|credential|api.?key|private.?key/i.test(r.check_id);
    const lines = String(r.extra?.lines || '').trim();
    const text = secret || !lines || /requires login/i.test(lines) ? `(${secret ? 'line not stored: secrets rule' : 'match'}) ${firstLine(r.extra?.message)}` : lines.split('\n')[0].slice(0, 300);
    out.push({ rule: r.check_id, severity: SEMGREP_SEV[r.extra?.severity] || 'medium', message: firstLine(r.extra?.message), fix: r.extra?.fix || r.extra?.metadata?.fix || '', cwe: [].concat(r.extra?.metadata?.cwe || []).slice(0, 2), file, line: r.start?.line || 0, text });
  }
  return { hits: out, errors: (json?.errors || []).length };
}

/** gitleaks JSON report (with --redact) -> hits. */
export function parseGitleaks(json, root) {
  const out = [];
  for (const f of Array.isArray(json) ? json : []) {
    const file = relTo(root, f.File) || String(f.File || '');
    if (!file || skippedDir(file)) continue;
    const commit = f.Commit ? ` (commit ${String(f.Commit).slice(0, 10)}${f.Date ? ` ${String(f.Date).slice(0, 10)}` : ''})` : '';
    out.push({ rule: f.RuleID || 'secret', severity: 'high', message: f.Description || f.RuleID || 'secret', file, line: f.StartLine || 0, commit: f.Commit ? String(f.Commit).slice(0, 10) : null, text: `${f.Description || f.RuleID}${commit}` });
  }
  return { hits: out };
}

/** TruffleHog JSON lines -> hits. The raw secret is reduced to a redacted prefix here and never kept. */
export function parseTrufflehog(stdout, root) {
  const out = [];
  const seen = new Set();
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j.DetectorName && !j.DetectorType) continue;
    const d = j.SourceMetadata?.Data || {};
    const src = d.Git || d.Filesystem || {};
    const file = relTo(root, src.file) || String(src.file || '');
    if (!file || skippedDir(file)) continue;
    const raw = String(j.Raw || j.Redacted || '');
    const match = raw ? redact(raw) : null;
    const key = `${j.DetectorName}|${file}|${match}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const commit = src.commit ? String(src.commit).slice(0, 10) : null;
    out.push({ rule: String(j.DetectorName || j.DetectorType), severity: 'high', message: `${j.DetectorName} credential (not verified)`, file, line: src.line || 0, commit, match, text: `${j.DetectorName} credential${commit ? ` (commit ${commit}${src.timestamp ? ` ${String(src.timestamp).slice(0, 10)}` : ''})` : ''}: ${match || ''}`.trim() });
  }
  return { hits: out };
}

const OSV_LEVEL = (score) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'unknown';
  return n >= 9 ? 'critical' : n >= 7 ? 'high' : n >= 4 ? 'moderate' : 'low';
};

/**
 * osv-scanner JSON -> hits for package versions the lockfile lookup did not already report
 * (`known`: Set of "ecosystem|name|version|id" in lower case, with aliases).
 */
export function parseOsvScanner(json, root, known = new Set()) {
  const out = [];
  for (const res of json?.results || []) {
    const file = relTo(root, res.source?.path) || String(res.source?.path || '');
    if (file && skippedDir(file)) continue;
    for (const p of res.packages || []) {
      const { name, version, ecosystem } = p.package || {};
      const groups = p.groups?.length ? p.groups : (p.vulnerabilities || []).map((v) => ({ ids: [v.id, ...(v.aliases || [])] }));
      for (const g of groups) {
        const ids = g.ids || [];
        const k = (id) => `${String(ecosystem).toLowerCase()}|${String(name).toLowerCase()}|${version}|${String(id).toLowerCase()}`;
        if (ids.some((id) => known.has(k(id)))) continue;
        const main = ids.find((id) => id.startsWith('GHSA-')) || ids[0];
        const v = (p.vulnerabilities || []).find((x) => ids.includes(x.id));
        const level = OSV_LEVEL(g.max_severity);
        out.push({ rule: level, severity: level === 'critical' || level === 'high' ? 'high' : level === 'low' ? 'low' : 'medium', message: v?.summary || main, file: file || '(lockfile)', line: 0, text: `${ecosystem} ${name}@${version} ${main}${ids.length > 1 ? ` (+${ids.length - 1} alias)` : ''}: ${String(v?.summary || '').slice(0, 120)}`.trim(), url: `https://osv.dev/vulnerability/${main}` });
      }
    }
  }
  return { hits: out };
}

const row = (tool, status, evidence, extra = {}) => ({ id: `tools.${tool.id}`, group: 'tools', status, title: tool.title, evidence, fix: '', install: tool.install, ...extra });
const notRun = (tool, because, extra = {}) => {
  const r = notChecked(row(tool, 'info', '', extra), because);
  r.evidence = r.evidence.replace(/; seen: $/, '');
  return r;
};
const parseJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

/** Runs one tool. Returns { row, hits }. */
export function runTool(tool, { root, git, offline = false, tmp, exec = defaultExec, which = onPath, known } = {}) {
  if (!which(tool.id)) return { row: notRun(tool, `${tool.id} is not installed`), hits: [] };
  if (offline && tool.network) return { row: notRun(tool, `--offline: it ${tool.network}`), hits: [] };
  const timeout = tool.minutes * 60000;
  const out = path.join(tmp, `${tool.id}.json`);
  const go = (args) => exec(tool.id, args, { cwd: root, timeout });
  const failed = (r, cmd) => (r.timedOut
    ? notRun(tool, `timed out after ${tool.minutes} min`, { command: cmd })
    : notRun(tool, `it failed (exit ${r.status ?? '?'}): ${firstLine(r.error || r.stderr) || 'no output'}`, { command: cmd }));

  if (tool.id === 'semgrep') {
    const args = ['scan', ...SEMGREP_CONFIGS.flatMap((c) => ['--config', c]), '--json', '--quiet', '--metrics=off', '--output', out, root];
    const r = go(args);
    const json = readJson(out) ?? parseJson(r.stdout);
    if (!json) return { row: failed(r, `semgrep ${args.join(' ')}`), hits: [] };
    const { hits, errors } = parseSemgrep(json, root);
    return { row: row(tool, 'pass', `ran ${SEMGREP_CONFIGS.join(', ')}: ${hits.length} result(s)${errors ? `, ${errors} file(s) it could not parse` : ''}`), hits };
  }
  if (tool.id === 'osv-scanner') {
    // v2 takes a `scan source` sub-command; v1 takes the flags directly.
    const attempts = [['scan', 'source', '-r', '--format', 'json', root], ['--format', 'json', '-r', root]];
    let last = null;
    for (const args of attempts) {
      const r = go(args);
      last = { r, args };
      if (r.timedOut) break;
      const json = parseJson(r.stdout);
      if (json && Array.isArray(json.results)) {
        const { hits } = parseOsvScanner(json, root, known);
        const packages = json.results.reduce((n, x) => n + (x.packages || []).length, 0);
        return { row: row(tool, 'pass', `${json.results.length} source(s), ${packages} vulnerable package version(s); ${hits.length} not already found by the lockfile lookup`), hits };
      }
      if (/no package sources found|no lockfiles/i.test(r.stderr)) return { row: row(tool, 'pass', 'no package sources it knows'), hits: [] };
    }
    return { row: failed(last.r, `osv-scanner ${last.args.join(' ')}`), hits: [] };
  }
  if (tool.id === 'gitleaks') {
    const common = ['--report-format', 'json', '--report-path', out, '--redact', '--no-banner', '--exit-code', '0'];
    // gitleaks 8.19+ has `git` and `dir`; older releases only `detect`.
    const attempts = git
      ? [['git', ...common, root], ['detect', '--source', root, ...common]]
      : [['dir', ...common, root], ['detect', '--no-git', '--source', root, ...common]];
    let last = null;
    for (const args of attempts) {
      try { fs.rmSync(out, { force: true }); } catch { /* none */ }
      const r = go(args);
      last = { r, args };
      if (r.timedOut) break;
      const json = readJson(out);
      if (Array.isArray(json)) {
        const { hits } = parseGitleaks(json, root);
        return { row: row(tool, 'pass', `${git ? 'working tree and every commit' : 'folder'}: ${hits.length} secret(s), redacted`), hits };
      }
    }
    return { row: failed(last.r, `gitleaks ${last.args.join(' ')}`), hits: [] };
  }
  if (tool.id === 'trufflehog') {
    const args = git
      ? ['git', `file://${root}`, '--json', '--no-verification', '--no-update']
      : ['filesystem', root, '--json', '--no-verification', '--no-update'];
    const r = go(args);
    if (r.timedOut || (r.status !== 0 && r.status !== 183 && !r.stdout.includes('"DetectorName"'))) return { row: failed(r, `trufflehog ${args.join(' ')}`), hits: [] };
    const { hits } = parseTrufflehog(r.stdout, root);
    return { row: row(tool, 'pass', `${git ? 'git history' : 'folder'}, verification off: ${hits.length} credential(s), redacted`), hits };
  }
  return { row: notRun(tool, 'unknown tool'), hits: [] };
}

const RULE_TEXT = {
  semgrep: { review: 'A Semgrep match: open it in context like a scanner hit and merge it with the scanner\'s own hit on the same line.', group: 'semgrep' },
  gitleaks: { review: 'A Gitleaks secret (redacted). Check whether it is live or public by design; one in an old commit still needs rotating.', group: 'secrets' },
  trufflehog: { review: 'A TruffleHog credential (not verified, redacted). Check whether it is live or public by design; one in an old commit still needs rotating.', group: 'secrets' },
  'osv-scanner': { review: 'A known-vulnerable package version that osv-scanner found and the lockfile lookup did not (often a transitive or an ecosystem the scanner does not parse).', group: 'deps' },
};

/** Tool hits -> scanner rules (deep: true), merging away hits the scanner already has on the same line. */
export function toolRules(toolId, hits, existing = []) {
  const taken = new Set(existing.map((h) => `${h.file}:${h.line}`));
  const byRule = new Map();
  for (const h of hits) {
    if (toolId !== 'semgrep' && toolId !== 'osv-scanner' && h.line && taken.has(`${h.file}:${h.line}`) && !h.commit) continue;
    const id = `${toolId}:${h.rule}`;
    if (!byRule.has(id)) byRule.set(id, { id, group: RULE_TEXT[toolId].group, severity: h.severity, title: toolId === 'osv-scanner' ? `Vulnerable packages (${h.rule}) found by osv-scanner only` : `${h.message}`.slice(0, 120), review: RULE_TEXT[toolId].review, fix: h.fix || (toolId === 'osv-scanner' ? 'Upgrade to a fixed version (see the advisory).' : toolId === 'semgrep' ? '' : 'Rotate, then remove; purge history if the repo is or was public.'), tool: toolId, deep: true, hits: [] });
    const r = byRule.get(id);
    r.hits.push({ file: h.file, line: h.line, text: h.text, ...(h.match ? { match: h.match } : {}), ...(h.commit ? { commit: h.commit } : {}), ...(h.url ? { url: h.url } : {}), inTest: false });
  }
  return [...byRule.values()];
}

/** Runs every tool the groups call for. { rows, rules }. */
export function runTools({ root, git, offline = false, on = () => true, exec, which, known, existingSecretHits = [], log = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-security-tools-'));
  const rows = [];
  const rules = [];
  try {
    for (const tool of TOOLS) {
      if (!tool.groups.some(on)) { rows.push(notRun(tool, `--only/--skip leave out ${tool.groups.join(', ')}`)); continue; }
      log(`deep: ${tool.id}`);
      const { row: r, hits } = runTool(tool, { root, git, offline, tmp, exec, which, known });
      rows.push(r);
      rules.push(...toolRules(tool.id, hits, existingSecretHits));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { rows, rules };
}
