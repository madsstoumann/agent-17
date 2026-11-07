/**
 * The checks. Each returns { findings, summary }. A finding is
 *   { level: 'error'|'warn'|'info', source, id, title, where, fix, detail? }
 * and never carries file contents beyond a short quote, so report.json is safe to share.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, meta, wikiLinks, mdLinks, codePaths, prosePaths, sections, boldBullets, shellBlocks, shingles, jaccard, tokens } from './markdown.mjs';
import { readText, rel } from './discover.mjs';

export const DEFAULTS = {
  budgetLines: 200, // what an always-loaded instruction file should stay under
  hardLines: 600, // past this it is an error
  hardBytes: 60_000,
  indexLines: 200, // Claude Code loads the first 200 lines / 25 KB of MEMORY.md
  indexBytes: 25_000,
  indexWarnBytes: 12 * 1024,
  memoryFileBytes: 4096, // a hosted store shows the first 4 KB of a file on recall
  ruleBytes: 1024, // a rule longer than this is reference material
  longLine: 300,
  dupThreshold: 0.3,
  staleDays: 90,
  bigDocBytes: 100_000,
  minSessions: 3,
  planFolders: ['plans', 'plan', 'proposals', 'rfcs', 'specs'],
  archiveNames: ['archive', 'archived', 'old', 'done', 'history'],
  today: new Date().toISOString().slice(0, 10),
};

const MEMORY_TYPES = new Set(['user', 'feedback', 'project', 'reference']);
const NOT_ORPHANS = /^(README|CHANGELOG|LICENSE|LICENCE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|SKILL|AGENTS|CLAUDE|CLAUDE\.local|MEMORY|index)\.md$/i;
const SECRET = /(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35})/;
const RELATIVE_DATE = /\b(today|yesterday|tomorrow|last week|next week|this week|last month|next month)\b/i;

const posix = path.posix;
export const lineCount = (t) => { const s = String(t ?? ''); return s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0; };
const PLACEHOLDER = /^(x|xx|xxx|y|n|foo|bar|baz|example|sample|name|id|slug|file|your-[\w-]+|my-[\w-]+)$/i;
const f = (level, source, id, title, where, fix, detail) => ({ level, source, id, title, where, ...(fix ? { fix } : {}), ...(detail ? { detail } : {}) });
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const plural = (n, w, s = `${w}s`) => `${n} ${n === 1 ? w : s}`;
const verb = (n, one, many) => (n === 1 ? one : many);
const inArchive = (p, o) => p.split('/').slice(0, -1).some((s) => o.archiveNames.includes(s.toLowerCase()));
const inPlans = (p, o) => !inArchive(p, o) && p.split('/').slice(0, -1).some((s) => o.planFolders.includes(s.toLowerCase()));

/** Shared context: the project's files, indexes for lookups, options. */
export function makeContext({ root, files, git, ignored, lastChanged, instr, skills, memoryDir, memoryList, opts }) {
  const fileSet = new Set(files);
  const byBase = new Map();
  for (const p of files) { const b = posix.basename(p); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(p); }
  const top = new Set(files.map((p) => p.split('/')[0]));
  const instrRels = new Set([...instr.loaded.map((x) => x.rel), ...instr.rules.map((x) => x.rel), ...(instr.agents ? ['AGENTS.md'] : [])]);
  const skillRels = new Set(skills.map((s) => s.rel));
  const docs = files.filter((p) => p.endsWith('.md') && !instrRels.has(p) && !skillRels.has(p) && !p.startsWith('.claude/'));
  return { root, files, fileSet, byBase, top, git, ignored: ignored || (() => false), lastChanged: lastChanged || new Map(), instr, skills, docs, memoryDir, memoryList: memoryList || [], opts: { ...DEFAULTS, ...opts } };
}

/** 'ok' | 'skip' | { moved: path } | { missing: true } for one reference written in `fromRel`. */
export function resolveRef(ctx, ref, fromRel, { kind = 'code', external = false } = {}) {
  if (!ref || ref.startsWith('/') || /^[A-Za-z]:[\\/]/.test(ref)) return 'skip';
  if (PLACEHOLDER.test(posix.basename(ref).replace(/\.[^.]+$/, ''))) return 'skip';
  const clean = ref.replace(/\/$/, '');
  const candidates = [];
  if (!external) candidates.push(posix.normalize(posix.join(posix.dirname(fromRel), clean)));
  if (kind === 'code' || external) candidates.push(posix.normalize(clean));
  const inside = candidates.filter((c) => !c.startsWith('..'));
  if (!inside.length) return 'skip';
  for (const c of inside) {
    if (ctx.fileSet.has(c)) return 'ok';
    try { if (fs.existsSync(path.join(ctx.root, c))) return 'ok'; } catch { /* ignore */ }
  }
  // A path in backticks is only ours when it starts at a top-level name of the project, or sits
  // beside the file that names it. Anything else (an upstream file, another repo) is not checked.
  if (kind === 'code') {
    const rootRel = posix.normalize(clean);
    const besideDir = external ? null : posix.dirname(posix.normalize(posix.join(posix.dirname(fromRel), clean)));
    const ours = ctx.top.has(rootRel.split('/')[0]) || (besideDir && besideDir !== '.' && ctx.files.some((p) => p.startsWith(`${besideDir}/`)));
    if (!ours) return 'skip';
  }
  if (!clean.includes('/')) return 'skip'; // a bare file name is a mention, not a path
  if (inside.some((c) => ctx.ignored(c))) return 'skip';
  const base = posix.basename(clean);
  const same = ctx.byBase.get(base) || [];
  if (same.length && same.length <= 3) {
    // Rank the files that share the name: a folder of the same name counts 2, a folder that
    // extends or shortens one (`page` and `page-grid`) counts 1. A tie is not a guess.
    const want = clean.split('/');
    const dirs = want.slice(0, -1);
    const score = (p) => {
      const segs = p.split('/');
      let n = segs.filter((s) => want.includes(s)).length * 2;
      for (const s of segs.slice(0, -1)) if (!dirs.includes(s) && dirs.some((d) => d.length > 2 && s.length > 2 && (s.startsWith(d) || d.startsWith(s)))) n += 1;
      return n;
    };
    const ranked = same.map((p) => [p, score(p)]).sort((x, y) => y[1] - x[1]);
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return { missing: true, candidates: ranked.map(([p]) => p) };
    return { moved: ranked[0][0] };
  }
  return { missing: true };
}

/** Dead references in one markdown text, grouped as { moved: [[ref, to]], missing: [ref] }. */
export function deadRefs(ctx, text, fromRel, { external = false } = {}) {
  const moved = [];
  const missing = [];
  const seen = new Set();
  const check = (ref, kind) => {
    if (seen.has(ref)) return;
    seen.add(ref);
    const r = resolveRef(ctx, ref, fromRel, { kind, external });
    // A markdown link is relative to its file, so the fix is the path from there; a path in backticks is from the root.
    if (r?.moved) moved.push([ref, kind === 'link' && fromRel ? posix.relative(posix.dirname(fromRel), r.moved) : r.moved]);
    else if (r?.missing) missing.push(ref);
  };
  if (!external) for (const l of mdLinks(text)) check(l, 'link');
  for (const p of codePaths(text)) check(p, 'code');
  for (const p of prosePaths(text)) check(p, 'code');
  return { moved, missing };
}

// ----------------------------------------------------------------------------------------- instructions

export function checkInstructions(ctx) {
  const { instr, opts: o } = ctx;
  const findings = [];
  const loaded = instr.loaded.map((x) => ({ ...x, text: readText(x.file) || '' }));
  const alwaysRules = instr.rules.filter((r) => !r.scoped).map((r) => ({ ...r, text: readText(r.file) || '' }));
  const agents = instr.agents ? { ...instr.agents, text: readText(instr.agents.file) || '' } : null;
  const measure = (x) => ({ rel: x.rel, lines: lineCount(x.text), bytes: Buffer.byteLength(x.text) });
  const loadedFiles = [...loaded, ...alwaysRules].map(measure);
  const total = loadedFiles.reduce((a, x) => ({ lines: a.lines + x.lines, bytes: a.bytes + x.bytes }), { lines: 0, bytes: 0 });

  if (!loaded.length) {
    findings.push(f(agents ? 'warn' : 'info', 'instructions', 'I0', 'No CLAUDE.md: Claude Code starts every session without project instructions', '.', agents ? 'Add a CLAUDE.md that imports a slimmed AGENTS.md (`@AGENTS.md`)' : 'Run the enable step E3 to write a short CLAUDE.md'));
  }
  const budget = (who, lines, bytes, where) => {
    if (lines > o.hardLines || bytes > o.hardBytes) {
      findings.push(f('error', 'instructions', 'I1', `${who}: ${lines} lines, ${kb(bytes)} (about ${tokens(bytes).toLocaleString('en')} tokens), read in full at every start; aim for under ${o.budgetLines} lines`, where, 'Step E4: keep what is always true; move reference to docs or path-scoped .claude/rules, procedures to skills'));
    } else if (lines > o.budgetLines) {
      findings.push(f('warn', 'instructions', 'I1', `${who}: ${lines} lines (${kb(bytes)}); aim for under ${o.budgetLines}`, where, 'Step E4'));
    }
  };
  if (loaded.length) budget('Loaded at every start', total.lines, total.bytes, loadedFiles.map((x) => x.rel).join(', '));
  if (agents && !agents.imported) {
    const m = measure(agents);
    findings.push(f('info', 'instructions', 'I2', 'AGENTS.md is not imported by a CLAUDE.md, so Claude Code reads it only when a prompt says so', 'AGENTS.md', 'Import it from CLAUDE.md (`@AGENTS.md`) once it is within budget'));
    budget('AGENTS.md', m.lines, m.bytes, 'AGENTS.md');
  }

  const texts = [...loaded, ...alwaysRules, ...(agents && !agents.imported ? [agents] : [])];
  const bullets = [];
  const blocks = [];
  const secs = [];
  for (const x of texts) {
    for (const b of boldBullets(x.text)) bullets.push({ ...b, rel: x.rel, docs: [...new Set(codePaths(b.text).concat(mdLinks(b.text)).filter((p) => p.endsWith('.md')))] });
    for (const s of shellBlocks(x.text)) blocks.push({ ...s, rel: x.rel });
    for (const s of sections(x.text, 2)) secs.push({ ...s, rel: x.rel });
    const dead = deadRefs(ctx, x.text, x.rel);
    if (dead.moved.length) findings.push(f('warn', 'instructions', 'I3', `${plural(dead.moved.length, 'path')} ${verb(dead.moved.length, 'points', 'point')} at a file that moved`, x.rel, 'Step E6 rewrites them', { moved: dead.moved }));
    if (dead.missing.length) findings.push(f('warn', 'instructions', 'I4', `${plural(dead.missing.length, 'path')} ${verb(dead.missing.length, 'names a file that does', 'name files that do')} not exist`, x.rel, 'Check each; fix or remove the line', { missing: dead.missing }));
  }
  const long = bullets.filter((b) => b.bytes > o.ruleBytes);
  if (long.length) {
    const bytes = long.reduce((a, b) => a + b.bytes, 0);
    findings.push(f('info', 'instructions', 'I5', `${plural(long.length, 'rule')} longer than ${kb(o.ruleBytes)} (${kb(bytes)} in all): reference material in the always-read layer`, [...new Set(long.map((b) => b.rel))].join(', '), 'Step E4: one line here, the rest in a doc or a path-scoped rule', { rules: long.map((b) => ({ where: `${b.rel}:${b.line}`, title: b.title.slice(0, 90), bytes: b.bytes, docs: b.docs })) }));
  }
  const restating = bullets.filter((b) => b.docs.length);
  if (restating.length) findings.push(f('info', 'instructions', 'I6', `${plural(restating.length, 'rule')} ${verb(restating.length, 'names', 'name')} a doc that covers the same feature (${kb(restating.reduce((a, b) => a + b.bytes, 0))})`, [...new Set(restating.map((b) => b.rel))].join(', '), 'Step E4: keep the rule as one line with the link'));
  return { findings, summary: { loaded: loadedFiles, total, agents: agents ? { ...measure(agents), imported: agents.imported } : null, rules: instr.rules.map((r) => ({ rel: r.rel, scoped: r.scoped })), bullets: bullets.length, longBullets: long.length, sections: secs.map(({ rel: r, title, line, lines, bytes }) => ({ rel: r, title, line, lines, bytes })), shellBlocks: blocks } };
}

// ----------------------------------------------------------------------------------------- docs

const BUILT = /(\b(status|state)\b[^.]{0,30}\b(built|done|implemented|shipped|landed|complete|completed)\b|(^|[>*_\s])(built|landed|shipped|implemented)\s+(20\d\d|on|in|and|as)\b|\b(is|was|were|are|been|now|all)\s+(now\s+|all\s+)?(built|implemented|shipped|landed)\b)/i;
const NOT_BUILT = /(nothing\s+(here\s+)?(is\s+)?(built|implemented)|not\s+(yet\s+)?(built|run|implemented|started)|unbuilt|parked|(before|until|once)\s[^.]{0,40}\b(is|are)\s+built|a plan; nothing|investigation,? not)/i;

export function planStatus(text) {
  const head = String(text ?? '').split('\n').filter((l) => l.trim()).slice(0, 12).join(' ');
  if (NOT_BUILT.test(head)) return 'open';
  if (BUILT.test(head)) return 'built';
  return 'unknown';
}

export function checkDocs(ctx, { memoryTexts = [] } = {}) {
  const { opts: o } = ctx;
  const findings = [];
  const rows = [];
  const allTexts = new Map();
  for (const p of ctx.files.filter((x) => x.endsWith('.md'))) allTexts.set(p, readText(path.join(ctx.root, p)) || '');
  const inbound = (p) => {
    const base = posix.basename(p);
    const distinctive = (ctx.byBase.get(base) || []).length === 1 && !NOT_ORPHANS.test(base);
    const from = [];
    for (const [q, t] of allTexts) if (q !== p && (t.includes(p) || (distinctive && t.includes(base)))) from.push(q);
    for (const { name, text } of memoryTexts) if (text.includes(p) || (distinctive && text.includes(base))) from.push(`memory:${name}`);
    return from;
  };
  let moved = 0;
  let missing = 0;
  for (const p of ctx.docs) {
    const text = allTexts.get(p) ?? readText(path.join(ctx.root, p)) ?? '';
    const bytes = Buffer.byteLength(text);
    const from = inbound(p);
    const archived = inArchive(p, o) || /^(CHANGELOG|HISTORY|CHANGES)\.md$/i.test(posix.basename(p));
    const plan = inPlans(p, o) ? planStatus(text) : null;
    const dead = deadRefs(ctx, text, p);
    moved += dead.moved.length;
    missing += dead.missing.length;
    rows.push({ path: p, lines: lineCount(text), bytes, last: ctx.lastChanged.get(p) || null, inbound: from.length, archived, plan, moved: dead.moved.length, missing: dead.missing.length });
    if (dead.moved.length) findings.push(f(archived ? 'info' : 'warn', 'docs', 'D1', `${plural(dead.moved.length, 'path')} ${verb(dead.moved.length, 'points', 'point')} at a file that moved`, p, 'Step E6 rewrites them', { moved: dead.moved }));
    if (dead.missing.length && !archived && !plan) findings.push(f('info', 'docs', 'D2', `${plural(dead.missing.length, 'path')} ${verb(dead.missing.length, 'names a file that does', 'name files that do')} not exist`, p, 'Check each: renamed, retired or never built', { missing: dead.missing }));
    if (plan === 'built') findings.push(f('info', 'docs', 'D3', 'A plan whose header says it is built still sits with the open plans', p, 'Step E6 moves it to the archive and fixes every link to it'));
    if (!from.length && !archived && !NOT_ORPHANS.test(posix.basename(p))) findings.push(f('info', 'docs', 'D4', `Nothing links to this doc${rows.at(-1).last ? ` (last changed ${rows.at(-1).last})` : ''}`, p, 'Link it from where it is needed, archive it or remove it (removal only when the owner says so)'));
    if (bytes > o.bigDocBytes) findings.push(f('info', 'docs', 'D5', `${kb(bytes)}: a doc this size is read in parts or not at all`, p, 'Split by feature, or give it a contents table agents can jump from'));
  }
  return { findings, summary: { files: rows.length, bytes: rows.reduce((a, r) => a + r.bytes, 0), moved, missing, plans: rows.filter((r) => r.plan).map((r) => ({ path: r.path, status: r.plan })), orphans: rows.filter((r) => !r.inbound && !r.archived && !NOT_ORPHANS.test(posix.basename(r.path))).length, rows } };
}

// ----------------------------------------------------------------------------------------- memory

export function readMemory(ctx) {
  if (!ctx.memoryDir) return [];
  return ctx.memoryList.map((name) => {
    const text = readText(path.join(ctx.memoryDir, name)) || '';
    const fm = parseFrontmatter(text);
    let stat = null;
    try { stat = fs.statSync(path.join(ctx.memoryDir, name)); } catch { /* gone */ }
    return { name, stem: posix.basename(name, '.md'), text, fm, bytes: Buffer.byteLength(text), mtime: stat ? stat.mtime.toISOString().slice(0, 10) : null };
  });
}

export function checkMemory(ctx, mem = readMemory(ctx)) {
  const { opts: o } = ctx;
  const findings = [];
  if (!ctx.memoryDir) return { findings: [f('info', 'memory', 'M0', 'No memory folder found for this project', '.', 'Pass --memory DIR, or step E1 creates one')], summary: null };
  const index = mem.find((m) => m.name === 'MEMORY.md');
  const notes = mem.filter((m) => m !== index);
  const names = new Map();
  for (const m of notes) { names.set(m.stem, m); const n = meta(m.fm.data, 'name'); if (n) names.set(String(n), m); }
  const linksOf = (m) => [...wikiLinks(m.text), ...mdLinks(m.text).filter((l) => l.endsWith('.md')).map((l) => posix.basename(l, '.md'))];

  let index$ = null;
  if (!index) findings.push(f('warn', 'memory', 'M1', 'No MEMORY.md index: nothing tells a new session which memories exist', ctx.memoryDir, 'Step E2 writes one'));
  else {
    const lines = index.text.split('\n');
    const longLines = lines.filter((l) => l.length > o.longLine);
    const n = lineCount(index.text);
    index$ = { lines: n, bytes: index.bytes, longLines: longLines.length };
    if (n > o.indexLines || index.bytes > o.indexBytes) findings.push(f('error', 'memory', 'M2', `MEMORY.md is ${n} lines, ${kb(index.bytes)}: past ${o.indexLines} lines or ${kb(o.indexBytes)} the rest is not loaded`, 'MEMORY.md', 'Step E2: one pointer line per file; rules move into their files'));
    else if (index.bytes > o.indexWarnBytes) findings.push(f('warn', 'memory', 'M2', `MEMORY.md is ${kb(index.bytes)}, loaded into every session; aim for under ${kb(o.indexWarnBytes)}`, 'MEMORY.md', 'Step E2'));
    if (longLines.length) findings.push(f('warn', 'memory', 'M3', `${plural(longLines.length, 'line')} in the index ${verb(longLines.length, 'is', 'are')} longer than ${o.longLine} characters: rule text, not pointers`, 'MEMORY.md', 'Step E2 moves the text into the file the line points at'));
  }
  const indexed = new Set(index ? linksOf(index).map((l) => names.get(l)?.name).filter(Boolean) : []);
  const linkedFrom = new Map(notes.map((m) => [m.name, 0]));
  const broken = [];
  for (const m of mem) {
    for (const l of linksOf(m)) {
      const target = names.get(l);
      if (target) { if (m !== target) linkedFrom.set(target.name, (linkedFrom.get(target.name) || 0) + 1); } else broken.push([m.name, l]);
    }
  }
  const unindexed = notes.filter((m) => !indexed.has(m.name));
  const orphans = notes.filter((m) => !linkedFrom.get(m.name));
  if (index && unindexed.length) findings.push(f('info', 'memory', 'M4', `${plural(unindexed.length, 'file')} not named in the index (found only by a link or a search)`, unindexed.map((m) => m.name).slice(0, 8).join(', ') + (unindexed.length > 8 ? ', …' : ''), 'Step E2 adds a pointer line for each', { files: unindexed.map((m) => m.name) }));
  if (orphans.length) findings.push(f('warn', 'memory', 'M5', `${plural(orphans.length, 'file')} nothing links to, not even the index`, orphans.map((m) => m.name).join(', '), 'Link or index each; a dream run proposes retiring the stale ones', { files: orphans.map((m) => m.name) }));
  if (broken.length) findings.push(f('warn', 'memory', 'M6', `${plural(broken.length, 'link')} to ${verb(broken.length, 'a memory that does', 'memories that do')} not exist`, [...new Set(broken.map((b) => b[0]))].join(', '), 'Write the missing memory or drop the link', { links: broken }));

  const noFm = [];
  const missingKeys = [];
  const badType = [];
  const noWhy = [];
  const big = [];
  const secrets = [];
  const relDates = [];
  const stale = [];
  const deadPaths = [];
  for (const m of notes) {
    if (!m.fm.raw) { noFm.push(m.name); } else {
      const miss = ['name', 'description', 'type'].filter((k) => !meta(m.fm.data, k));
      if (miss.length) missingKeys.push(`${m.name} (${miss.join(', ')})`);
      const type = meta(m.fm.data, 'type');
      if (type && !MEMORY_TYPES.has(String(type))) badType.push(`${m.name} (${type})`);
      if (type === 'feedback' && !/\*\*Why:?\*\*/i.test(m.fm.body)) noWhy.push(m.name);
      const review = meta(m.fm.data, 'review_by');
      const checked = String(meta(m.fm.data, 'verified') || meta(m.fm.data, 'modified') || '').slice(0, 10) || m.mtime;
      if (review && String(review) < o.today) stale.push(`${m.name} (review by ${review})`);
      else if (type === 'project' && checked && daysBetween(checked, o.today) > o.staleDays) stale.push(`${m.name} (last checked ${checked})`);
    }
    if (m.bytes > o.memoryFileBytes) big.push(`${m.name} (${kb(m.bytes)})`);
    if (SECRET.test(m.text)) secrets.push(m.name);
    if (RELATIVE_DATE.test(m.fm.body)) relDates.push(m.name);
    if (ctx.root) {
      const dead = deadRefs(ctx, m.text, '', { external: true });
      if (dead.moved.length || dead.missing.length) deadPaths.push({ file: m.name, ...dead });
    }
  }
  if (secrets.length) findings.push(f('error', 'memory', 'M7', `${plural(secrets.length, 'file')} ${verb(secrets.length, 'holds', 'hold')} what looks like a secret`, secrets.join(', '), 'Remove the value now (memory is read by every session and synced); rotate it'));
  if (noFm.length) findings.push(f('warn', 'memory', 'M8', `${plural(noFm.length, 'file')} without frontmatter`, noFm.join(', '), 'Step E1 adds name, description and type'));
  if (missingKeys.length) findings.push(f('warn', 'memory', 'M8', `${plural(missingKeys.length, 'file')} missing name, description or type`, missingKeys.join('; '), 'Step E1'));
  if (badType.length) findings.push(f('warn', 'memory', 'M9', `${plural(badType.length, 'file')} with a type outside user, feedback, project, reference`, badType.join('; '), 'Step E1'));
  if (noWhy.length) findings.push(f('warn', 'memory', 'M10', `${plural(noWhy.length, 'feedback file')} without a **Why:** line`, noWhy.join(', '), 'Add why the person asked for it, so a later session can judge edge cases'));
  if (big.length) findings.push(f('warn', 'memory', 'M11', `${plural(big.length, 'file')} over ${kb(o.memoryFileBytes)}: recall may show only the start`, big.join(', '), 'Split by subject or summarise'));
  if (relDates.length) findings.push(f('info', 'memory', 'M12', `${plural(relDates.length, 'file')} ${verb(relDates.length, 'uses', 'use')} relative dates (today, last week)`, relDates.join(', '), 'Write absolute dates: a memory is read weeks later'));
  if (stale.length) findings.push(f('info', 'memory', 'M13', `${plural(stale.length, 'project memory', 'project memories')} due for review`, stale.slice(0, 8).join('; ') + (stale.length > 8 ? '; …' : ''), 'A dream run checks each against the code', { files: stale }));
  if (deadPaths.length) findings.push(f('warn', 'memory', 'M14', `${plural(deadPaths.length, 'file')} ${verb(deadPaths.length, 'names', 'name')} project paths that moved or do not exist`, deadPaths.map((d) => d.file).join(', '), 'Update the path, or the memory is out of date', { files: deadPaths }));

  const dups = [];
  const sh = notes.map((m) => ({ m, s: shingles(m.fm.body) }));
  for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) {
    const score = jaccard(sh[i].s, sh[j].s);
    if (score >= o.dupThreshold) dups.push([sh[i].m.name, sh[j].m.name, Math.round(score * 100)]);
  }
  if (dups.length) findings.push(f('warn', 'memory', 'M15', `${plural(dups.length, 'pair')} of files ${verb(dups.length, 'says', 'say')} much the same`, dups.map(([a, b, s]) => `${a} ~ ${b} (${s}%)`).join('; '), 'Merge each pair into one file (a dream run proposes the merge)', { pairs: dups }));

  return {
    findings,
    summary: {
      dir: ctx.memoryDir, files: notes.length, bytes: mem.reduce((a, m) => a + m.bytes, 0), index: index$, indexed: indexed.size, unindexed: unindexed.length, orphans: orphans.length, broken: broken.length, duplicates: dups.length,
      types: Object.fromEntries([...MEMORY_TYPES, 'none'].map((t) => [t, notes.filter((m) => (meta(m.fm.data, 'type') || 'none') === t).length])),
      overSize: big.length, noFrontmatter: noFm.length,
    },
  };
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// ----------------------------------------------------------------------------------------- skills

export function checkSkills(ctx) {
  const findings = [];
  const rows = [];
  for (const s of ctx.skills) {
    const text = readText(s.file) || '';
    const { data } = parseFrontmatter(text);
    const lines = lineCount(text);
    const desc = String(data.description || '');
    rows.push({ name: s.name, lines, bytes: Buffer.byteLength(text), description: desc.length });
    if (!desc) findings.push(f('error', 'skills', 'S1', 'No description: Claude cannot tell when to use the skill', s.rel, 'Write one sentence on when to use it'));
    else if (desc.length > 1024) findings.push(f('error', 'skills', 'S1', `Description is ${desc.length} characters; the limit is 1024`, s.rel, 'Shorten it'));
    if (data.name && data.name !== s.name) findings.push(f('warn', 'skills', 'S2', `name: ${data.name} differs from its folder`, s.rel, 'Use the folder name'));
    if (lines > 500) findings.push(f('warn', 'skills', 'S3', `${lines} lines; keep SKILL.md under 500 and move detail into files it links`, s.rel, 'Split into references/'));
    const dead = deadRefs(ctx, text, s.rel);
    if (dead.moved.length) findings.push(f('warn', 'skills', 'S4', `${plural(dead.moved.length, 'path')} ${verb(dead.moved.length, 'points', 'point')} at a file that moved`, s.rel, 'Step E6', { moved: dead.moved }));
  }
  return { findings, summary: { count: rows.length, rows } };
}

// ----------------------------------------------------------------------------------------- procedures

/**
 * Skill candidates: shell blocks in the always-read layer (a procedure written into instructions),
 * and, when transcripts were read, commands that ran in at least `minSessions` sessions and that no
 * skill mentions yet.
 */
export function skillCandidates(ctx, instructions, transcripts) {
  const { opts: o } = ctx;
  const skillText = ctx.skills.map((s) => readText(s.file) || '').join('\n');
  const covered = (cmd) => {
    const token = cmd.split(/\s+/).find((w) => /[/.]/.test(w) && !/^-/.test(w));
    return token ? skillText.includes(token) : false;
  };
  const out = [];
  for (const b of instructions?.shellBlocks || []) {
    if (b.commands.length < 2) continue;
    out.push({ from: 'instructions', where: `${b.rel}:${b.line}`, name: b.heading || 'commands', commands: b.commands.slice(0, 6), sessions: null, covered: b.commands.every(covered) });
  }
  if (transcripts?.commands) {
    for (const c of transcripts.commands) {
      if (c.sessions < Math.min(o.minSessions, Math.max(2, transcripts.sessions))) continue;
      out.push({ from: 'transcripts', where: null, name: c.command, commands: [c.command], sessions: c.sessions, of: transcripts.sessions, covered: covered(c.command) });
    }
  }
  const findings = out.filter((c) => !c.covered).map((c) => f('info', 'procedures', 'P1', c.from === 'transcripts' ? `\`${c.name}\` ran in ${c.sessions} of ${c.of} sessions and no skill covers it` : `A procedure in the always-read layer: ${c.name} (${plural(c.commands.length, 'command')})`, c.where || 'transcripts', 'Step E5: make it a skill, or a script the instructions name in one line'));
  return { findings, summary: out };
}
