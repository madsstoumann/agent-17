#!/usr/bin/env node
// Phase 3: external APIs listed in .solution-health/manifest.json.
//  - probe: status code, redirects, RFC 9745 Deprecation / RFC 8594 Sunset / Link headers
//  - watch pages + feeds: normalized text, hashed and diffed against the last accepted snapshot,
//    keyword scan (EN + DA). Changed pages get a diff file for Claude to read and judge.
// Usage: node apis.mjs [--root <dir>] [--only "<api name>"]
// Writes run/apis.json, run/changes/*.md and run/pending-snapshots/*.txt (accepted by finalize.mjs).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs, paths, readJson, writeJson, safeFetch, mapLimit, sha256, slug, daysUntil, loadManifest, loadState, ensureDirs, log, nowIso,
  DEFAULT_KEYWORDS, keywordRegex, splitSentences } from './lib.mjs';

const args = parseArgs();
const p = paths(args);
ensureDirs(p);
const manifest = loadManifest(p);
if (!manifest) { log(`No manifest at ${p.manifest}. Copy templates/manifest.example.json there first (or let Claude create it).`); process.exit(2); }
const state = loadState(p);
const discovery = readJson(join(p.runDir, 'discovery.json'));
const changesDir = join(p.runDir, 'changes');
const pendingDir = join(p.runDir, 'pending-snapshots');
mkdirSync(changesDir, { recursive: true });
mkdirSync(pendingDir, { recursive: true });
const sunsetWarnDays = manifest.apiSunsetWarnDays ?? 180;

function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, (m) => (/(deprecat|sunset|lukker|nedluk|udfas)/i.test(m) ? m : ' ')) // drop chrome unless it carries a notice
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br|dd|dt|blockquote|pre|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&aelig;/gi, 'æ').replace(/&oslash;/gi, 'ø').replace(/&aring;/gi, 'å').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
// Remove volatile bits (dates in footers, build ids, counters) so a hash change means a content change.
const stable = (t) => t.replace(/\b(?:copyright|©)\s*\d{4}(?:\s*[-–]\s*\d{4})?/gi, '').replace(/\b[0-9a-f]{20,}\b/gi, '').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '');

function parseDeprecation(h) {
  const out = {};
  if (h.deprecation) {
    const v = h.deprecation.trim();
    out.deprecation = v;
    const m = v.match(/^@(\d+)$/); // RFC 9745: structured-field date (unix seconds)
    out.deprecationDate = m ? new Date(Number(m[1]) * 1000).toISOString() : v === 'true' ? 'yes (no date)' : (Number.isNaN(Date.parse(v)) ? v : new Date(v).toISOString());
  }
  if (h.sunset) { out.sunset = h.sunset; const d = Date.parse(h.sunset); if (!Number.isNaN(d)) out.sunsetDate = new Date(d).toISOString(); }
  if (h.link) {
    const rels = {};
    for (const part of h.link.split(/,(?=\s*<)/)) {
      const m = part.match(/<([^>]+)>\s*;(.*)/); if (!m) continue;
      const rel = (m[2].match(/rel="?([^";]+)"?/i) || [])[1];
      if (rel && /deprecation|sunset|successor-version|latest-version|alternate/i.test(rel)) rels[rel] = m[1];
    }
    if (Object.keys(rels).length) out.links = rels;
  }
  for (const k of ['warning', 'x-api-deprecated', 'x-deprecated', 'api-deprecated-versions', 'x-api-warn']) if (h[k]) (out.other ||= {})[k] = h[k];
  return out;
}

async function probe(api) {
  if (!api.probe) return null;
  const spec = typeof api.probe === 'string' ? { url: api.probe } : api.probe;
  const headers = { ...(spec.headers || {}) };
  // Secrets come from env vars, never from the committed manifest: "headers": {"x-api-key": "$DAWA_KEY"}
  for (const [k, v] of Object.entries(headers)) if (typeof v === 'string' && v.startsWith('$')) headers[k] = process.env[v.slice(1)] || '';
  let res = await safeFetch(spec.url, { method: spec.method || 'GET', headers, timeoutMs: 20_000 });
  const finalHost = (() => { try { return new URL(res.url).host; } catch { return null; } })();
  const origHost = new URL(spec.url).host;
  const r = { url: spec.url, status: res.status, finalUrl: res.url, redirectedOffHost: !!finalHost && finalHost !== origHost, error: res.error || null, ...parseDeprecation(res.headers) };
  const body = (res.text || '').slice(0, 4000);
  if (body && /(deprecat|sunset|end of life|no longer|lukk|nedluk|udfas|ophør|erstat)/i.test(body)) r.bodyHint = body.replace(/\s+/g, ' ').slice(0, 400);
  if (spec.expectStatus && res.status !== spec.expectStatus) r.unexpectedStatus = `expected ${spec.expectStatus}`;
  return r;
}

async function watch(api, url, kwRe, isFeed) {
  const key = sha256(url).slice(0, 16);
  const name = `${slug(api.name)}--${slug(url).slice(0, 50)}--${key.slice(0, 6)}`;
  const prev = state.apis?.[api.name]?.pages?.[url] || null;
  const res = await safeFetch(url, { timeoutMs: 25_000 });
  const page = { url, status: res.status, error: res.error || null, finalUrl: res.url, snapshotName: name };
  if (!res.ok || !res.text) {
    page.change = res.status === 404 || res.status === 410 ? 'gone' : 'unreachable';
    return page;
  }
  const ctype = res.headers['content-type'] || '';
  const text = /html|xml/i.test(ctype) || /^\s*</.test(res.text) ? htmlToText(res.text) : res.text;
  const hash = sha256(stable(text));
  page.hash = hash;
  page.title = (res.text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || null;
  page.length = text.length;
  if (text.length < 300) page.thin = true; // probably rendered client-side: the hash would watch an empty shell
  writeFileSync(join(pendingDir, `${name}.txt`), text);

  const snapFile = join(p.snapshotDir, `${name}.txt`);
  const oldText = existsSync(snapFile) ? readFileSync(snapFile, 'utf8') : null;
  const sentences = splitSentences(text);
  const oldSet = new Set(oldText ? splitSentences(oldText) : []);
  const hits = sentences.filter((s) => kwRe.test(s));
  page.keywordHits = hits.length;
  page.newKeywordHits = oldText ? hits.filter((s) => !oldSet.has(s)) : hits;

  if (!prev && !oldText) page.change = 'baseline';
  else if (prev?.hash === hash) page.change = 'unchanged';
  else page.change = 'changed';

  if (page.change === 'changed' || page.change === 'baseline') {
    const added = oldText ? sentences.filter((s) => !oldSet.has(s)) : [];
    const newSet = new Set(sentences);
    const removed = oldText ? [...oldSet].filter((s) => !newSet.has(s)) : [];
    page.addedSentences = added.length; page.removedSentences = removed.length;
    // Only hand Claude something to read when it matters: any change, or a baseline that already mentions deprecation.
    if (page.change === 'changed' || hits.length) {
      const md = [
        `# ${api.name} — ${page.change === 'baseline' ? 'first snapshot' : 'page changed'}`,
        `URL: ${url}${isFeed ? ' (feed)' : ''}`,
        `Fetched: ${nowIso()}  Previous check: ${prev?.checkedAt || 'never'}`,
        api.notes ? `Context from manifest: ${api.notes}` : null,
        '',
        `## Sentences matching deprecation keywords (${page.newKeywordHits.length} new of ${hits.length})`,
        ...(page.newKeywordHits.length ? page.newKeywordHits.slice(0, 40).map((s) => `- ${s}`) : ['(none new)']),
        '',
        ...(oldText ? [`## Added text (${added.length} sentences)`, ...added.slice(0, 120).map((s) => `+ ${s}`), '', `## Removed text (${removed.length} sentences)`, ...removed.slice(0, 60).map((s) => `- ${s}`)] : ['## Page text (first 6000 chars)', text.slice(0, 6000)]),
      ].filter((l) => l !== null).join('\n');
      writeFileSync(join(changesDir, `${name}.md`), md);
      page.changeFile = relative(p.root, join(changesDir, `${name}.md`));
      page.needsReview = true;
    }
  }
  return page;
}

const apis = args.only ? manifest.apis.filter((a) => a.name === args.only) : manifest.apis;
const results = await mapLimit(apis, 4, async (api) => {
  const kwRe = keywordRegex([...DEFAULT_KEYWORDS, ...(manifest.keywords?.extra || []), ...(api.keywords || [])]);
  const r = { name: api.name, hosts: api.hosts || [], owner: api.owner || null, status: api.status || 'active', replacement: api.replacement || null, manifestSunset: api.sunset || null };
  r.codeRefs = (discovery?.hosts || []).filter((h) => (api.hosts || []).map((x) => x.toLowerCase()).includes(h.host)).reduce((n, h) => n + h.fileCount, 0);
  r.codeFiles = (discovery?.hosts || []).filter((h) => (api.hosts || []).map((x) => x.toLowerCase()).includes(h.host)).flatMap((h) => h.files).slice(0, 10);
  r.probe = await probe(api);
  r.pages = [];
  for (const url of api.watch || []) r.pages.push(await watch(api, url, kwRe, false));
  for (const url of api.feeds || []) r.pages.push(await watch(api, url, kwRe, true));

  // Verdict
  const reasons = []; let level = 'green';
  const bump = (l) => { const o = { green: 0, info: 1, unknown: 1, amber: 2, red: 3 }; if (o[l] > o[level]) level = l; };
  const pr = r.probe;
  if (pr) {
    if (pr.status === 410) { bump('red'); reasons.push('probe returns 410 Gone'); }
    else if (pr.status === 404) { bump('red'); reasons.push('probe returns 404'); }
    else if (pr.status === 0) { bump('amber'); reasons.push(`probe unreachable (${pr.error})`); }
    else if (pr.status >= 500) { bump('amber'); reasons.push(`probe returns ${pr.status}`); }
    else if (pr.status === 401 || pr.status === 403) { bump('info'); reasons.push(`probe returns ${pr.status} (auth/IP restricted — set probe headers via env vars, or treat as reachable)`); }
    if (pr.deprecation) { bump('red'); reasons.push(`Deprecation header: ${pr.deprecationDate || pr.deprecation}`); }
    if (pr.sunsetDate) { const d = daysUntil(pr.sunsetDate); bump(d !== null && d <= sunsetWarnDays ? 'red' : 'amber'); reasons.push(`Sunset header: ${pr.sunsetDate.slice(0, 10)}${d !== null ? ` (${d < 0 ? `${-d} days ago` : `in ${d} days`})` : ''}`); }
    if (pr.links) reasons.push(`Link: ${Object.entries(pr.links).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
    if (pr.other) { bump('amber'); reasons.push(`deprecation-style headers: ${JSON.stringify(pr.other)}`); }
    if (pr.redirectedOffHost) { bump('amber'); reasons.push(`probe redirects to another host: ${pr.finalUrl}`); }
    if (pr.bodyHint) { bump('amber'); reasons.push(`response body mentions deprecation: "${pr.bodyHint.slice(0, 160)}…"`); }
  }
  if (api.sunset) {
    const d = daysUntil(api.sunset);
    if (d !== null && d < 0) { bump(r.codeRefs > 0 ? 'red' : 'info'); reasons.push(`known shutdown date ${api.sunset} has passed${r.codeRefs ? ` — still referenced in ${r.codeRefs} file(s)` : ' — no code references found'}`); }
    else if (d !== null && d <= sunsetWarnDays) { bump('red'); reasons.push(`known shutdown date ${api.sunset} (in ${d} days)`); }
    else if (d !== null) { bump('amber'); reasons.push(`known shutdown date ${api.sunset} (in ${d} days)`); }
  }
  if (api.status === 'replaced' && r.codeRefs > 0) { bump('red'); reasons.push(`marked replaced, but host still referenced in ${r.codeRefs} file(s)`); }
  for (const pg of r.pages) {
    if (pg.change === 'gone') { bump('amber'); reasons.push(`watch page now ${pg.status}: ${pg.url}`); }
    if (pg.change === 'unreachable') { bump('unknown'); reasons.push(`watch page unreachable: ${pg.url} (${pg.error || pg.status})`); }
    if (pg.thin) { bump('amber'); reasons.push(`watch page has almost no text (${pg.length} chars; JS-rendered?) — pick another URL or an RSS/changelog feed: ${pg.url}`); }
    if (pg.newKeywordHits?.length) { bump('amber'); reasons.push(`${pg.newKeywordHits.length} new deprecation-keyword sentence(s) on ${pg.url}`); }
    else if (pg.change === 'changed') { bump('info'); reasons.push(`page changed: ${pg.url}`); }
  }
  if (!(api.watch || []).length && !(api.feeds || []).length) { bump('info'); reasons.push('no watch page configured — add the provider\'s status/changelog/docs page'); }
  if (r.codeRefs === 0 && discovery) reasons.push('host not found in code (removed? or built at runtime)');
  r.verdict = { level, reasons, needsReview: r.pages.some((pg) => pg.needsReview) };
  return r;
});

// Hosts in code that nobody is watching
const untracked = (discovery?.hosts || []).filter((h) => h.status === 'untracked').map((h) => ({ host: h.host, priority: h.priority, fileCount: h.fileCount, files: h.files.slice(0, 5), samples: h.samples.slice(0, 3) }));

writeJson(join(p.runDir, 'apis.json'), { generatedAt: nowIso(), apis: results, untrackedHosts: untracked });
const order = { red: 0, amber: 1, unknown: 2, info: 3, green: 4 };
results.sort((a, b) => order[a.verdict.level] - order[b.verdict.level]);
log(`External APIs: ${results.length} tracked, ${untracked.length} untracked hosts in code (${untracked.filter((u) => u.priority === 'high').length} high priority)`);
for (const r of results) log(`  [${r.verdict.level}] ${r.name}${r.verdict.needsReview ? '  ← READ CHANGE FILE' : ''} — ${r.verdict.reasons.join('; ') || 'ok'}`);
const toRead = results.flatMap((r) => r.pages.filter((pg) => pg.needsReview).map((pg) => pg.changeFile));
if (toRead.length) { log('Change files for Claude to read and assess:'); for (const f of toRead) log(`  ${f}`); }
log(`→ ${relative(p.root, p.runDir)}/apis.json`);
