#!/usr/bin/env node
// privacy-audit: loads a site in headless Chrome as three new visitors (no choice, reject,
// accept), records every request, cookie and storage key, reads the privacy policy, and writes
// report.md, report.json, banner.png and the policy text. Read-only: it clicks the consent
// banner and follows a few internal links, nothing else.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/cdp.mjs';
import { openContext, choose } from './lib/visit.mjs';
import { analyse, SECTIONS } from './lib/analyse.mjs';
import { countStatuses, resolveOutDir, sectionTables, fixFirst, resultLine, taskCandidates, writeJson, log, GLYPH, result } from './lib/common.mjs';

export const VERSION = '1.0.0';

const USAGE = `privacy-audit ${VERSION}: GDPR / ePrivacy check of cookies, trackers and the consent banner

Usage: node scan.mjs <url> [options]

  --out DIR              Report folder (default <reports>/privacy-audit/<host>-<YYYYMMDD-HHMM>/)
  --pages N              Extra internal pages loaded before consent (default 2)
  --only S,...           Scenarios: first,reject,accept (default all three)
  --lang L               Browser language (default da-DK,da,en)
  --chrome PATH          Chrome, Chromium or Edge binary (also CHROME_PATH)
  --header "Name: value" Sent to the audited host only (WAF bypass rule); also AUDIT_HEADERS
  --no-policy            Do not open the privacy and cookie policy pages
  -h, --help
`;

export function parseArgs(argv, env = process.env) {
  const a = { url: null, out: null, pages: 2, only: ['first', 'reject', 'accept'], lang: 'da-DK,da,en', chrome: null, headers: {}, policy: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === '-h' || k === '--help') a.help = true;
    else if (k === '--out') a.out = next();
    else if (k === '--pages') a.pages = Math.max(0, Math.min(10, Number(next()) || 0));
    else if (k === '--only') a.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--lang') a.lang = next();
    else if (k === '--chrome') a.chrome = next();
    else if (k === '--header') addHeader(a.headers, next());
    else if (k === '--no-policy') a.policy = false;
    else if (k.startsWith('-')) throw new Error(`Unknown option ${k}`);
    else if (!a.url) a.url = normaliseUrl(k);
    else throw new Error(`Unexpected argument ${k}`);
  }
  for (const line of String(env.AUDIT_HEADERS || '').split('\n')) if (line.trim()) addHeader(a.headers, line);
  if (!a.only.includes('first')) a.only.unshift('first');
  return a;
}

function addHeader(headers, line) {
  const i = line.indexOf(':');
  if (i < 1) throw new Error(`--header needs "Name: value", got "${line}"`);
  headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

export const normaliseUrl = (s) => new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`).href;

/** Up to n internal pages with different first path segments, so different templates load. */
export function pickPages(links, startUrl, n) {
  const seen = new Set([new URL(startUrl).pathname.split('/')[1] || '']);
  const out = [];
  for (const href of links) {
    if (out.length >= n) break;
    let u;
    try { u = new URL(href); } catch { continue; }
    if (/\b(login|logout|signin|cart|kurv|checkout|basket|account|konto|admin|wp-admin|umbraco)\b/i.test(u.pathname)) continue;
    const seg = u.pathname.split('/')[1] || '';
    if (seen.has(seg)) continue;
    seen.add(seg);
    out.push(u.href);
  }
  return out;
}

/**
 * The privacy policy first, then a cookie policy, by link text and URL. Links on the site's own
 * domain win: a consent banner also links to Google's and other vendors' policies.
 */
export function pickPolicies(links, siteHost = '') {
  const apex = siteHost.split('.').slice(-2).join('.');
  const own = (l) => { try { const h = new URL(l.href).hostname; return h === apex || h.endsWith(`.${apex}`); } catch { return false; } };
  const isCookie = (l) => { let last = ''; try { last = new URL(l.href).pathname.split('/').filter(Boolean).pop() || ''; } catch { /* keep '' */ } return /cookie/i.test(l.text) || /cookie/i.test(last); };
  const all = [...new Map(links.filter((l) => /^https?:/.test(l.href)).map((l) => [l.href.split('#')[0], l])).values()];
  const pool = all.some(own) ? all.filter(own) : all;
  return [pool.find((l) => !isCookie(l)), pool.find(isCookie)].filter(Boolean);
}

export async function run(args, { dir, browser: given } = {}) {
  const url = args.url;
  const host = new URL(url).hostname.toLowerCase();
  const siteHosts = [host, host.startsWith('www.') ? host.slice(4) : `www.${host}`];
  const b = given || await launch({ chromePath: args.chrome, lang: args.lang });
  log(`privacy-audit ${VERSION}: ${b.version}`);
  const data = { url, host, policies: [] };
  const files = {};
  const errors = [];
  try {
    // 1. A new visitor who does nothing.
    log('first visit: no choice');
    const p = await openContext(b, { headers: args.headers, siteHosts });
    try {
      await p.goto(url);
      const [facts, banner, cookies, html] = await Promise.all([p.facts(), p.banner(), p.cookies(), p.html().catch(() => '')]);
      data.first = { requests: p.requests.filter((r) => r.phase === 'load'), cookies, facts, banner, html, pages: [] };
      if (dir) { try { fs.writeFileSync(path.join(dir, 'banner.png'), await p.screenshot()); files.screenshot = 'banner.png'; } catch (e) { errors.push(`screenshot: ${e.message}`); } }
      for (const page of pickPages(facts.internal || [], url, args.pages)) {
        log(`  before consent: ${page}`);
        p.mark(`page:${page}`);
        try { await p.goto(page, { extraWait: 1500 }); data.first.pages.push({ url: page, requests: p.requests.filter((r) => r.phase === `page:${page}`) }); } catch (e) { errors.push(`page ${page}: ${e.message}`); }
      }
      if (args.policy) {
        for (const [i, l] of pickPolicies(facts.policyLinks || [], host).entries()) {
          log(`  policy: ${l.href}`);
          p.mark(`policy:${i}`);
          try {
            await p.goto(l.href, { extraWait: 2500 });
            const text = (await p.text()).trim();
            const file = `policy-${i + 1}.txt`;
            if (dir) fs.writeFileSync(path.join(dir, file), `${l.href}\n\n${text}\n`);
            data.policies.push({ url: l.href, ok: text.length > 200, text, words: text.split(/\s+/).length, file: dir ? file : null });
          } catch (e) { data.policies.push({ url: l.href, ok: false, error: e.message }); }
        }
      }
      data.first.cookies = await p.cookies(); // everything set while browsing without a choice
    } finally { await p.close(); }

    // 2 and 3. A new visitor who rejects, and one who accepts. Each reloads after choosing,
    // because many tags only fire on the next page view.
    for (const choice of ['reject', 'accept'].filter((c) => args.only.includes(c))) {
      if (!data.first.banner?.found && !data.first.facts?.globals?.length) { data[choice] = null; continue; }
      log(`new visitor: ${choice}`);
      const q = await openContext(b, { headers: args.headers, siteHosts });
      try {
        await q.goto(url);
        const ch = await choose(q, choice);
        if (ch.method) { await q.settle(); await q.reload(); }
        const phase = `after-${choice}`;
        data[choice] = { choice: ch, requests: q.requests.filter((r) => r.phase === phase), cookies: await q.cookies(), facts: await q.facts().catch(() => null) };
      } catch (e) {
        errors.push(`${choice}: ${e.message}`);
        data[choice] = { choice: { method: null, steps: [e.message] }, requests: [], cookies: [] };
      } finally { await q.close(); }
    }
  } finally {
    if (!given) await b.close();
  }
  const results = analyse(data);
  for (const e of errors) results.push(result('consent.error', 'skip', 'Part of the run failed', e));
  return {
    tool: 'privacy-audit', version: VERSION, generatedAt: new Date().toISOString(), browser: b.version,
    target: { url, host }, counts: countStatuses(results), results, files,
    raw: { first: summariseRequests(data.first?.requests), reject: summariseRequests(data.reject?.requests), accept: summariseRequests(data.accept?.requests), cookies: { first: data.first?.cookies?.map(cookieRow), reject: data.reject?.cookies?.map(cookieRow), accept: data.accept?.cookies?.map(cookieRow) }, banner: data.first?.banner && { ...data.first.banner, sid: undefined, declaration: data.first.banner.declaration ? `${data.first.banner.declaration.length} characters` : null }, consentCommands: data.first?.facts?.consent, policies: data.policies.map(({ text, ...rest }) => rest) },
  };
}

const cookieRow = (c) => ({ name: c.name, domain: c.domain, path: c.path, expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString().slice(0, 10) : 'session', secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite || null });
const summariseRequests = (reqs) => (reqs ? reqs.map((r) => ({ url: r.url.slice(0, 300), type: r.type, frame: r.frame })) : null);

export function renderMarkdown(report) {
  const { target: t, counts, results } = report;
  const out = [`# Privacy audit — ${t.host}`, ''];
  out.push(`**Site:** ${t.url}  ·  **Date:** ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC  ·  **Tool:** privacy-audit ${report.version} · ${report.browser}`, '');
  out.push(resultLine(counts), '');
  out.push('Three new visitors in headless Chrome: one makes no choice (plus a few more pages), one rejects, one accepts; both of the latter reload after choosing. Nothing is submitted.', '');
  out.push(...fixFirst(results));
  const warns = results.filter((r) => r.status === 'warn');
  if (warns.length) {
    out.push('## Should fix', '');
    for (const r of warns) out.push(`- ⚠️ **${r.title}** — ${r.evidence}${r.fix ? ` → ${r.fix}` : ''}`);
    out.push('');
  }
  out.push(...sectionTables(results, SECTIONS));
  const ck = report.raw?.cookies || {};
  for (const [k, label] of [['first', 'before any choice'], ['accept', 'after accepting']]) {
    if (!ck[k]?.length) continue;
    out.push(`<details>`, `<summary>Cookies ${label} (${ck[k].length})</summary>`, '', '| Name | Domain | Expires | Secure | HttpOnly | SameSite |', '|---|---|---|---|---|---|');
    for (const c of ck[k]) out.push(`| ${c.name} | ${c.domain} | ${c.expires} | ${c.secure ? 'yes' : 'no'} | ${c.httpOnly ? 'yes' : 'no'} | ${c.sameSite || ''} |`);
    out.push('', '</details>', '');
  }
  out.push('## Not checked here', '', 'Security headers, cookie flags on the first response and TLS are in launch-audit and infra-audit. This is a technical check, not legal advice: whether a cookie is "strictly necessary" and whether the policy text is complete are judgement calls; the policy review below is Claude\'s reading, not a lawyer\'s.', '');
  return out.join('\n');
}

export function renderStdout(report, paths) {
  const lines = [`privacy-audit ${report.target.host}`, resultLine(report.counts).replace(/\*/g, '')];
  for (const s of ['fail', 'warn']) for (const r of report.results.filter((x) => x.status === s)) lines.push(`${GLYPH[s]} ${r.id} ${r.title}: ${r.evidence.slice(0, 240)}`);
  for (const r of report.results.filter((x) => x.status === 'skip')) lines.push(`${GLYPH.skip} ${r.id}: ${r.evidence.slice(0, 200)}`);
  for (const r of report.results.filter((x) => x.status === 'info' && (x.id === 'accept.inventory' || x.id === 'consent.cmp'))) lines.push(`${GLYPH.info} ${r.id}: ${r.evidence.slice(0, 240)}`);
  lines.push('', `report:     ${paths.md}`, `json:       ${paths.json}`);
  if (report.files.screenshot) lines.push(`screenshot: ${path.join(paths.dir, report.files.screenshot)}`);
  for (const p of report.raw.policies || []) if (p.file) lines.push(`policy:     ${path.join(paths.dir, p.file)} (${p.url})`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) { process.stdout.write(USAGE); process.exit(args.help ? 0 : 2); }
  const host = new URL(args.url).hostname;
  const dir = resolveOutDir(args.out, { skill: 'privacy-audit', name: host });
  fs.mkdirSync(dir, { recursive: true });
  log(`output: ${dir}`);
  const report = await run(args, { dir });
  report.tasks = taskCandidates(report.results, { source: 'privacy', ref: `${path.basename(dir)}/report.md` });
  const paths = { dir, md: path.join(dir, 'report.md'), json: path.join(dir, 'report.json') };
  fs.writeFileSync(paths.md, renderMarkdown(report));
  writeJson(paths.json, report);
  process.stdout.write(`${renderStdout(report, paths)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log(`privacy-audit: ${e.message}`); process.exit(1); });
}
