#!/usr/bin/env node
/**
 * plan-geo: proposes the structured data and the content a site needs to be quoted by AI answer
 * engines. Three steps, with Claude's writing in between:
 *
 *   plan.mjs extract <audit-seo run folder | audit-all run folder | report.json | url>
 *       groups the crawl into templates, reads a sample of pages in full, writes inventory.md,
 *       inventory.json and pages/<slug>.md|json into a run folder.
 *   (Claude writes site-profile.md, markup/*.jsonld, content/questions.csv, content/briefs/*.md,
 *    tasks.json and summary.md, as SKILL.md says.)
 *   plan.mjs check <run folder>    checks every markup draft: parses, Google's required and
 *       recommended properties, validator.schema.org, and that every value is on the page.
 *   plan.mjs samples <run folder>  writes samples/: each draft merged with the site graph into one
 *       @graph, as a page to paste into the Rich Results Test or validator.schema.org (optional).
 *   plan.mjs build <run folder>    runs check, then writes proposals.md and fix/TODO.md + fix/tasks/.
 *
 * Zero dependencies. Node >= 22.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { extractPage, pageDigest } from './lib/extract.mjs';
import { groupTemplates, pickSample, pageSlug, indexable } from './lib/templates.mjs';
import { verifyDraft, typesIn } from './lib/verify.mjs';
import { readQuestions, renderProposals, QUESTION_COLUMNS } from './lib/proposals.mjs';
import { richIssues, prop } from './lib/rich.mjs';
import { schemaValidate, SCHEMA_VALIDATOR } from './lib/schema.mjs';
import { launch, render, findChrome } from './lib/render.mjs';
import { targetDir, claimTarget, newRun, markRun, RUN_MARKER } from './lib/target-state.mjs';
import { writeFixPlan, validateTasks } from './lib/tasks.mjs';
import { mergeGraph, sampleHtml, injectLive, samplesReadme } from './lib/samples.mjs';

export const VERSION = '1.3.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

const HELP = `plan-geo ${VERSION}

Usage:
  plan.mjs extract <input> [--pages N] [--out DIR] [--header "Name: value"] [--no-render] [--insecure]
                   [--queries FILE] [--competitors a.com,b.com] [--repo PATH] [--only markup|content]
  plan.mjs check <run folder> [--no-remote]
  plan.mjs samples <run folder> [--live] [--header "Name: value"] [--no-remote]
  plan.mjs build <run folder> [--no-remote] [--samples [--live]]

<input> is an audit-seo run folder, an audit-all run folder, an audit-seo report.json, or a URL
(then the host's last audit-seo run is used, and audit-seo is run first when there is none).

  --pages N        Pages read in full (default 24): the start page, one per template, a second
                   page for large templates, then pages with three or more question headings.
  --out DIR        Run folder (default <reports>/plan-geo/<host>/runs/<stamp>/, or
                   <audit-all run>/plan-geo/ when the input is an audit-all run).
  --header         Extra request header for the site's host (a WAF bypass rule). Also AUDIT_HEADERS.
  --queries FILE   Search queries or questions to start the content part from (copied into the run).
  --competitors    Named alternatives comparison briefs may cover.
  --repo PATH      The site's code, so markup tasks can go to audit-fix.
  --only           markup or content: plan one part only.
  --no-render      Never use Chrome (pages whose served HTML is thin are then read as served).
  --insecure       Accept self-signed certificates (local and staging sites).
  --no-remote      Do not send drafts or samples to validator.schema.org.
  --samples        build: write samples/ first (as "plan.mjs samples") and link it from proposals.md.
  --live           samples: also fetch each draft's page and write <slug>.live.html, the live page with
                   its own JSON-LD replaced by the sample's (and a <base href> so it still loads).
`;

// ---------------------------------------------------------------- small helpers

function parseArgs(argv) {
  const o = { _: [], pages: 24, headers: {}, render: true, remote: true, insecure: false, out: null, queries: null, competitors: [], repo: null, only: null, samples: false, live: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--pages') o.pages = Math.max(1, parseInt(next(), 10) || 24);
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--header') addHeader(o.headers, next());
    else if (a === '--queries') o.queries = path.resolve(next());
    else if (a === '--competitors') o.competitors = next().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--repo') o.repo = path.resolve(next());
    else if (a === '--only') { o.only = next().toLowerCase(); if (!['markup', 'content'].includes(o.only)) throw new Error('--only must be markup or content'); }
    else if (a === '--no-render') o.render = false;
    else if (a === '--no-remote') o.remote = false;
    else if (a === '--insecure') o.insecure = true;
    else if (a === '--samples') o.samples = true;
    else if (a === '--live') o.live = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else o._.push(a);
  }
  for (const line of String(process.env.AUDIT_HEADERS || '').split(/\n|;;/)) if (line.trim()) addHeader(o.headers, line);
  return o;
}

function addHeader(h, line) {
  const i = line.indexOf(':');
  if (i < 1) throw new Error(`--header must be "Name: value", got "${line}"`);
  h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

/** <reports>: AUDIT_OUT_DIR, else the Downloads folder if it exists, else ~/audit-reports (the audit skills' rule). */
export function reportsRoot(env = process.env, home = os.homedir()) {
  if (env.AUDIT_OUT_DIR) return path.resolve(env.AUDIT_OUT_DIR.replace(/^~(?=$|\/)/, home));
  let xdg = env.XDG_DOWNLOAD_DIR;
  if (!xdg) {
    try { xdg = /^\s*XDG_DOWNLOAD_DIR\s*=\s*"?([^"\n]+)"?/m.exec(fs.readFileSync(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'user-dirs.dirs'), 'utf8'))?.[1]; } catch { xdg = null; }
  }
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const cands = [xdg && path.resolve(xdg.replace(/^\$HOME(?=$|\/)/, home)), path.join(home, 'Downloads')].filter(Boolean);
  return cands.find(isDir) || path.join(home, 'audit-reports');
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
const isSeoReport = (j) => j && j.tool === 'audit-seo' && Array.isArray(j.pages) && j.mode !== 'schema';

/** fetch with a timeout; never throws. */
async function get(url, { headers = {}, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en,da;q=0.8', 'x-audit': `plan-geo/${VERSION}`, ...headers }, signal: ctrl.signal, redirect: 'follow' });
    const body = /html|xml|text/i.test(res.headers.get('content-type') || '') ? await res.text() : '';
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, body };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, body: '', error: e?.cause?.code || e?.message || String(e) };
  } finally { clearTimeout(timer); }
}

/** The http shape schema.mjs expects (post only). */
const http = {
  async post(url, { headers = {}, body, timeout = 60000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      // PLAN_GEO_VALIDATOR points validator.schema.org posts at a stand-in (the tests count posts with it).
      if (process.env.PLAN_GEO_VALIDATOR && url === SCHEMA_VALIDATOR) url = process.env.PLAN_GEO_VALIDATOR;
      const res = await fetch(url, { method: 'POST', headers: { 'user-agent': UA, ...headers }, body, signal: ctrl.signal });
      return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (e) { return { ok: false, status: 0, body: null, error: e?.message || String(e) }; } finally { clearTimeout(timer); }
  },
};

// ---------------------------------------------------------------- extract

/** Find the audit-seo report for an input. -> { report, source, auditAllRun } or { error } */
function findReport(input, { reports }) {
  if (/^https?:\/\//i.test(input) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(input) && !fs.existsSync(input)) {
    const url = /^https?:/i.test(input) ? input : `https://${input}`;
    const host = new URL(url).host.toLowerCase();
    const state = targetDir({ reports, skill: 'audit-seo', name: host, owner: host });
    const last = path.join(state, 'last-report.json');
    const j = readJson(last);
    if (isSeoReport(j)) return { report: j, source: last, url };
    return { report: null, url, host };
  }
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) return { error: `${input} does not exist` };
  const files = fs.statSync(abs).isDirectory() ? [path.join(abs, 'report.json'), path.join(abs, 'audit-seo', 'report.json')] : [abs];
  for (const f of files) {
    const j = readJson(f);
    if (isSeoReport(j)) {
      const auditAllRun = fs.statSync(abs).isDirectory() && f === path.join(abs, 'audit-seo', 'report.json') && fs.existsSync(path.join(abs, RUN_MARKER)) ? abs : null;
      return { report: j, source: f, auditAllRun };
    }
  }
  return { error: `no audit-seo report.json in ${input} (run audit-seo first, or pass the site's URL)` };
}

/** Run the sibling audit-seo skill into <run>/audit-seo when there is no earlier run. */
function runAuditSeo(url, outDir, opts) {
  const seo = path.resolve(HERE, '..', '..', 'audit-seo', 'scripts', 'seo.mjs');
  if (!fs.existsSync(seo)) return { error: 'no earlier audit-seo run for this site, and the audit-seo skill is not installed next to plan-geo: run audit-seo on the site first' };
  log(`no earlier audit-seo run for ${url}: running audit-seo --geo first (a minute or two)`);
  const args = [seo, url, '--geo', '--external-links', '0', '--out', outDir, ...Object.entries(opts.headers).flatMap(([k, v]) => ['--header', `${k}: ${v}`]), ...(opts.insecure ? ['--insecure'] : [])];
  const r = spawnSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 900000 });
  const j = readJson(path.join(outDir, 'report.json'));
  if (r.status !== 0 || !isSeoReport(j)) return { error: `audit-seo failed (exit ${r.status}); run it on its own to see why` };
  return { report: j, source: path.join(outDir, 'report.json') };
}

async function extract(opts) {
  const input = opts._[1];
  if (!input) throw new Error('extract needs an audit-seo run folder, report.json or URL');
  const reports = reportsRoot();
  let found = findReport(input, { reports });
  if (found.error) throw new Error(found.error);

  const host = (found.report?.site?.host || found.host || new URL(found.url).host).toLowerCase();
  const target = claimTarget(targetDir({ reports, skill: 'plan-geo', name: host, owner: host }), host);
  const run = opts.out ? markRun(opts.out, { skill: 'plan-geo', host }) : found.auditAllRun ? markRun(path.join(found.auditAllRun, 'plan-geo'), { skill: 'plan-geo', host }) : newRun(target, { info: { skill: 'plan-geo', host } });
  if (!found.report) {
    found = runAuditSeo(found.url, path.join(run, 'audit-seo'), opts);
    if (found.error) throw new Error(found.error);
  }
  const report = found.report;
  const pages = report.pages || [];
  const templates = groupTemplates(pages);
  const sample = pickSample(templates, pages, { max: opts.pages });
  log(`${templates.length} templates over ${pages.filter(indexable).length} indexable pages; reading ${sample.length} pages`);

  const chrome = opts.render ? findChrome() : null;
  let browser = null;
  const siteHosts = [host, host.replace(/^www\./, ''), `www.${host.replace(/^www\./, '')}`];
  const pagesDir = path.join(run, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  const read = [];
  for (const s of sample) {
    let res = await get(s.url, { headers: opts.headers });
    let rec = res.ok && res.body ? extractPage(res.body, res.finalUrl || s.url) : null;
    let how = 'served HTML';
    if ((!rec || rec.words < 80) && chrome) {
      try {
        browser ||= await launch({ chromePath: chrome, insecure: opts.insecure });
        const r = await render(browser, s.url, { headers: opts.headers, hosts: siteHosts });
        if (r.ok) { const rr = extractPage(r.html, r.finalUrl || s.url); if (!rec || rr.words > rec.words) { rec = rr; how = 'rendered in Chrome'; } }
      } catch (e) { log(`Chrome: ${e.message}`); }
    }
    if (!rec) { log(`skip ${s.url}: ${res.error || `HTTP ${res.status}`}`); continue; }
    if (rec.hidden) how += ` + ${rec.hidden.words} words only in the Next.js payload`;
    const slug = pageSlug(s.url);
    writeJson(path.join(pagesDir, `${slug}.json`), { ...rec, template: s.template, why: s.why, how });
    fs.writeFileSync(path.join(pagesDir, `${slug}.md`), pageDigest(rec));
    read.push({ url: s.url, slug, template: s.template, why: s.why, how, words: rec.words, questions: rec.questions.length, tables: rec.tables, dates: rec.dates.length, jsonLd: [...typesIn(rec.jsonLd)] });
    log(`read ${s.url} (${rec.words} words, ${how})`);
  }
  if (browser) await browser.close();

  for (const t of templates) t.example = read.find((r) => r.template === t.key)?.slug || null;
  const home = read.find((r) => r.template === 'home');
  const homeRec = home ? readJson(path.join(pagesDir, `${home.slug}.json`)) : null;
  let queries = null;
  if (opts.queries) {
    if (!fs.existsSync(opts.queries)) throw new Error(`--queries: ${opts.queries} does not exist`);
    queries = `input-queries${path.extname(opts.queries) || '.txt'}`;
    fs.copyFileSync(opts.queries, path.join(run, queries));
  }
  const inventory = {
    tool: 'plan-geo', version: VERSION, host, url: report.site?.url || `https://${host}/`, date: new Date().toISOString(),
    source: found.source, lang: homeRec?.lang || null, crawled: pages.length, indexable: pages.filter(indexable).length,
    truncated: !!report.crawl?.truncated || !!report.truncated, target, profile: path.join(target, 'site-profile.md'),
    options: { only: opts.only, queries, competitors: opts.competitors, repo: opts.repo },
    templates, sample: read,
  };
  writeJson(path.join(run, 'inventory.json'), inventory);
  fs.writeFileSync(path.join(run, 'inventory.md'), inventoryMarkdown(inventory));

  const profileExists = fs.existsSync(inventory.profile);
  console.log(`plan-geo ${VERSION} — ${host}`);
  console.log(`From ${found.source}`);
  console.log(`${templates.length} templates, ${read.length} pages read in full; site language ${inventory.lang || 'unknown'}`);
  console.log('');
  console.log(`inventory.md   ${path.join(run, 'inventory.md')}`);
  console.log(`pages          ${pagesDir}${path.sep}`);
  if (queries) console.log(`queries        ${path.join(run, queries)}`);
  console.log(`site profile   ${inventory.profile} (${profileExists ? 'exists: reuse it, update what changed' : 'write it'})`);
  console.log(`Run folder     ${run}`);
}

function inventoryMarkdown(inv) {
  const out = [`# Inventory: ${inv.host}`, '', `${inv.indexable} indexable pages of ${inv.crawled} crawled${inv.truncated ? ' (crawl capped)' : ''}, from \`${inv.source}\`. Site language: ${inv.lang || 'unknown'}.`, ''];
  out.push('## Templates', '', 'Guessed type and usual markup are a starting point; correct them after reading the pages.', '');
  out.push('| Template | Pages | Guessed type | Usual markup | Modules to consider | Markup now | Question pages | Dated pages | Median words | Example |', '| --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | --- |');
  for (const t of inv.templates) {
    const now = Object.entries(t.markup).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
    out.push(`| ${t.key} | ${t.pages} | ${t.type} | ${t.types.join(', ')} | ${t.modules.join(', ') || ''} | ${now} | ${t.questionPages} | ${t.articleLike} | ${t.words} | ${t.example ? `pages/${t.example}.md` : ''} |`);
  }
  out.push('', '## Pages read', '', '| Page | Template | Why | Read as | Words | Questions | Table rows | Dates | JSON-LD |', '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const s of inv.sample) out.push(`| [${new URL(s.url).pathname}](pages/${s.slug}.md) | ${s.template} | ${s.why} | ${s.how} | ${s.words} | ${s.questions} | ${s.tables} | ${s.dates} | ${s.jsonLd.join(', ') || 'none'} |`);
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------- check

/**
 * The page a draft is checked against: markup/site.jsonld → the start page; <page slug> → that
 * page; else <template slug> → the template's example. A page slug wins because it is the more
 * specific name: /visit (slug "visit") and the template "visit" (example /visit/annual-pass) share
 * a name, and a draft named after a page is for that page. `template` says when a template of the
 * same name exists with another example, so check can say which one it used.
 */
export function draftPage(run, inv, slug) {
  const pages = path.join(run, 'pages');
  const t = slug === 'site' ? inv.templates.find((x) => x.key === 'home') : inv.templates.find((x) => x.slug === slug);
  const own = slug !== 'site' && fs.existsSync(path.join(pages, `${slug}.json`)) ? slug : null;
  const pageSlugName = own || t?.example || null;
  if (!pageSlugName) return null;
  return { slug: pageSlugName, page: readJson(path.join(pages, `${pageSlugName}.json`)), template: own && t?.example && t.example !== own ? { key: t.key, example: t.example } : null };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** validator.schema.org rate-limits a burst of posts (HTTP 429): wait and try again, twice. */
async function validateWithRetry(html, waits = [5000, 15000]) {
  let v = await schemaValidate(http, { html });
  for (const ms of waits) {
    if (v.ok || !/429|rate/i.test(String(v.error || ''))) break;
    log(`validator.schema.org rate limit: waiting ${ms / 1000} s`);
    await sleep(ms);
    v = await schemaValidate(http, { html });
  }
  return v;
}


/**
 * validator.schema.org answers for this run, by the SHA-256 of the posted HTML, in
 * <run>/markup/validator.json. check, samples and build share it, so a draft or sample that has not
 * changed is never posted twice (the validator rate-limits a burst with HTTP 429). Only answers
 * are kept, never failures.
 */
function validatorCache(run) {
  const file = path.join(run, 'markup', 'validator.json');
  const data = readJson(file) || {};
  const key = (html) => crypto.createHash('sha256').update(html).digest('hex');
  return {
    get: (html) => data[key(html)] || null,
    set(html, v) { data[key(html)] = v; fs.mkdirSync(path.dirname(file), { recursive: true }); writeJson(file, data); },
  };
}

const RATE = /429|rate/i;

/** Validate through the run's cache: { ok, objects, errors, warnings, messages, cached } or { ok: false, error }. */
async function validateCached(cache, html, { limited = null } = {}) {
  const hit = cache.get(html);
  if (hit) return { ...hit, ok: true, cached: true };
  if (limited) return { ok: false, error: limited };
  const v = await validateWithRetry(html);
  if (!v.ok) return { ok: false, error: v.error };
  const out = { objects: v.objects, errors: v.errors, warnings: v.warnings, messages: v.nodes.flatMap((n) => [...n.errors, ...n.warnings].map((e) => `${n.types.join('/')}: ${e.property || ''} ${e.type || ''}`.trim())).slice(0, 10) };
  cache.set(html, out);
  return { ...out, ok: true, cached: false };
}

async function check(run, opts, { quiet = false } = {}) {
  const inv = readJson(path.join(run, 'inventory.json'));
  if (!inv) throw new Error(`no inventory.json in ${run}: run "plan.mjs extract" first`);
  const dir = path.join(run, 'markup');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld')).sort() : [];
  const drafts = [];
  const cache = validatorCache(run);
  let limited = null; // after a 429 that outlasts the retries, the remaining drafts are not posted
  for (const f of files) {
    const slug = f.replace(/\.jsonld$/, '');
    const d = { file: `markup/${f}`, slug, page: null, types: [], parseError: null, notOnPage: [], required: [], recommended: [], validator: null };
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { d.parseError = e.message; drafts.push(d); continue; }
    d.types = topTypes(data);
    d.allTypes = [...typesIn(data)];
    const target = draftPage(run, inv, slug);
    if (target?.page) { d.page = target.page.url; d.notOnPage = verifyDraft(data, target.page); } else d.noPage = true;
    if (target?.template) d.alsoTemplate = target.template;
    for (const r of richIssues([data])) { for (const p of r.required) d.required.push(`${r.type}.${p}`); for (const p of r.recommended) d.recommended.push(`${r.type}.${p}`); }
    // build --samples validated each draft inside its sample a moment ago: reuse that answer.
    const fromSample = opts.sampleResults?.get(slug);
    if (opts.remote && fromSample) d.validator = { ...fromSample };
    else if (opts.remote) {
      const html = `<!doctype html><html><head><title>draft</title><script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script></head><body></body></html>`;
      const v = await validateCached(cache, html, { limited });
      const { ok, cached, ...rest } = v;
      d.validator = ok ? rest : { error: v.error };
      if (!ok && RATE.test(String(v.error || ''))) limited = `${v.error}; paste the draft into validator.schema.org by hand`;
    }
    drafts.push(d);
  }
  const result = { tool: 'plan-geo', version: VERSION, date: new Date().toISOString(), drafts };
  writeJson(path.join(dir, 'check.json'), result);
  if (!quiet) {
    console.log(`plan-geo ${VERSION} — check of ${drafts.length} draft${drafts.length === 1 ? '' : 's'}`);
    for (const d of drafts) console.log(checkLine(d));
    console.log(`\ncheck.json     ${path.join(dir, 'check.json')}`);
  }
  return result;
}

export function checkLine(d) {
  if (d.parseError) return `FAIL ${d.file}: does not parse (${d.parseError})`;
  const bits = [];
  if (d.noPage) bits.push('no page to check against (name it after a page slug, a template slug or "site")');
  // A draft named after a page is meant for that page: say what it matched, and only mention the
  // template of the same name as the other draft one could write, not as a naming mistake.
  if (d.alsoTemplate) bits.push(`checked against ${d.page}, the page it is named after, as intended; keep the file name. Only if every "${d.alsoTemplate.key}" page needs markup too, add a second draft for that, ${d.alsoTemplate.example}.jsonld, checked against the template's example`);
  if (d.notOnPage.length) bits.push(`${d.notOnPage.length} value(s) not on the page: ${d.notOnPage.slice(0, 4).map((f) => `${f.path} "${String(f.value).slice(0, 40)}"`).join('; ')}`);
  if (d.required.length) bits.push(`for Google's rich result also needs ${d.required.join(', ')} (leave out when the page does not show it)${d.slug === 'site' ? '; the site graph is on every page, so move that node to the draft for its own template' : ''}`);
  if (d.validator?.errors) bits.push(`validator.schema.org${d.validator.via ? ` (in ${d.validator.via})` : ''}: ${d.validator.errors} error(s): ${d.validator.messages.slice(0, 3).join('; ')}`);
  if (d.validator?.error) bits.push(`validator.schema.org not reached (${d.validator.error})`);
  if (d.validator && !d.validator.error && !d.validator.objects) bits.push('validator.schema.org found no objects');
  const status = d.notOnPage.length || d.validator?.errors || d.noPage ? 'WARN' : 'OK  ';
  return `${status} ${d.file} [${d.types.join(', ')}]${bits.length ? `: ${bits.join(' · ')}` : ''}${d.recommended.length ? ` (recommended: ${d.recommended.join(', ')})` : ''}`;
}

/** The types a draft declares at its top level or as @graph members (not the nested ones it mentions). */
export function topTypes(data) {
  const out = new Set();
  const add = (n) => { const t = n?.['@type']; for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string') out.add(x.replace(/^(https?:\/\/)?schema\.org\//, '')); };
  for (const block of Array.isArray(data) ? data : [data]) {
    if (Array.isArray(block?.['@graph'])) block['@graph'].forEach(add); else add(block);
  }
  return [...out];
}

// ---------------------------------------------------------------- samples

/** samples/<slug>.html for each draft: the site graph and the draft as one @graph; with --live also <slug>.live.html. */
async function samples(run, opts, { quiet = false } = {}) {
  const inv = readJson(path.join(run, 'inventory.json'));
  if (!inv) throw new Error(`no inventory.json in ${run}: run "plan.mjs extract" first`);
  const dir = path.join(run, 'markup');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld')).sort() : [];
  if (!files.length) throw new Error(`no drafts in ${dir}: write markup/*.jsonld first`);
  const parse = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { log(`skip markup/${f}: does not parse (${e.message})`); return undefined; } };
  const site = files.includes('site.jsonld') ? parse('site.jsonld') ?? null : null;
  // The start page's draft already carries the site graph; site.jsonld gets a sample of its own only without one.
  const homeSlug = inv.templates.find((t) => t.key === 'home')?.slug;
  const slugs = files.map((f) => f.replace(/\.jsonld$/, '')).filter((s) => s !== 'site' || !files.includes(`${homeSlug}.jsonld`));
  const outDir = path.join(run, 'samples');
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  const cache = validatorCache(run);
  let limited = null; // after a 429 that outlasts the retries, the remaining samples are not posted
  for (const slug of slugs) {
    const draft = slug === 'site' ? null : parse(`${slug}.jsonld`);
    if (draft === undefined) continue;
    const graph = mergeGraph(site, draft);
    const target = draftPage(run, inv, slug === homeSlug ? 'site' : slug) || draftPage(run, inv, slug);
    const page = target?.page || null;
    // The draft is checked against its page, the site graph against the start page (as check does).
    const notOnPage = page ? verifyDraft(slug === 'site' ? site : draft, page).length : null;
    const required = [...new Set(richIssues([graph]).flatMap((r) => r.required.map((p) => `${r.type}.${prop(p)}`)))];
    const notes = [
      page ? `Every value is meant to be copied from ${page.url}.` : 'No page was read for this draft, so its values are not checked against one.',
      ...(required.length ? [`Google's rich-result rules ask for ${required.join(', ')}. Left out because the page does not show it; the Rich Results Test marks that item invalid, validator.schema.org does not.`] : []),
    ];
    const html = sampleHtml({ graph, url: page?.url, title: page?.title, draft: slug === 'site' ? 'markup/site.jsonld' : `markup/${slug}.jsonld`, notes, lang: inv.lang || page?.lang || 'en' });
    const file = `${slug}.html`;
    fs.writeFileSync(path.join(outDir, file), html);
    let validator = null;
    if (opts.remote) {
      const v = await validateCached(cache, html, { limited });
      const { ok, cached, ...rest } = v;
      validator = ok ? rest : { error: v.error };
      if (!ok && RATE.test(String(v.error || ''))) limited = `${v.error}; paste the file into validator.schema.org by hand`;
    }
    let live = null; let removed = 0;
    if (opts.live && page?.url) {
      const res = await get(page.url, { headers: opts.headers });
      if (res.ok && res.body) {
        const injected = injectLive(res.body, { graph, url: res.finalUrl || page.url });
        live = `${slug}.live.html`; removed = injected.removed;
        fs.writeFileSync(path.join(outDir, live), injected.html);
      } else log(`live copy of ${page.url} skipped: ${res.error || `HTTP ${res.status}`}`);
    }
    rows.push({ slug, file, live, url: page?.url || null, types: topTypes(graph), validator, required, notOnPage, removed });
  }
  fs.writeFileSync(path.join(outDir, 'README.md'), samplesReadme({ host: inv.host, rows, live: opts.live }));
  if (!quiet) {
    console.log(`plan-geo ${VERSION} — ${rows.length} sample${rows.length === 1 ? '' : 's'}`);
    for (const r of rows) {
      const bits = [r.validator == null ? null : r.validator.error ? `validator.schema.org not reached (${r.validator.error})` : `validator.schema.org: ${r.validator.errors} errors, ${r.validator.warnings} warnings`, r.required.length ? `rich result needs ${r.required.join(', ')}` : null, r.notOnPage ? `${r.notOnPage} value(s) not on the page` : null, r.live ? `live copy: ${r.live}${r.removed ? ` (${r.removed} JSON-LD block(s) of the page replaced)` : ''}` : null].filter(Boolean);
      console.log(`${(r.validator?.errors || r.notOnPage) ? 'WARN' : 'OK  '} samples/${r.file} [${r.types.join(', ')}]${bits.length ? `: ${bits.join(' · ')}` : ''}`);
    }
    console.log(`\nsamples        ${path.join(outDir, 'README.md')}`);
  }
  return rows;
}

// ---------------------------------------------------------------- build

async function build(run, opts) {
  const inv = readJson(path.join(run, 'inventory.json'));
  if (!inv) throw new Error(`no inventory.json in ${run}: run "plan.mjs extract" first`);
  const problems = [];
  // With --samples, samples go first and check reuses their validator answers: each sample holds
  // the draft (merged with the site graph), and posting every draft again right after hits HTTP 429.
  const sampleResults = new Map();
  if (opts.samples) {
    const rows = await samples(run, opts, { quiet: true });
    const homeSlug = inv.templates.find((t) => t.key === 'home')?.slug;
    for (const r of rows) {
      if (!r.validator || r.validator.error) continue;
      const v = { ...r.validator, via: `samples/${r.file}` };
      sampleResults.set(r.slug, v);
      // The start page's sample carries the site graph too.
      if (r.slug === homeSlug && !sampleResults.has('site')) sampleResults.set('site', v);
    }
  }
  const checked = await check(run, { ...opts, sampleResults }, { quiet: true });
  const hasSamples = fs.existsSync(path.join(run, 'samples', 'README.md'));

  const qFile = path.join(run, 'content', 'questions.csv');
  let questions = [];
  if (fs.existsSync(qFile)) {
    const q = readQuestions(readText(qFile));
    questions = q.questions;
    problems.push(...q.errors);
  } else if (inv.options?.only !== 'markup') problems.push(`no content/questions.csv (columns: ${QUESTION_COLUMNS.join(', ')})`);
  const briefDir = path.join(run, 'content', 'briefs');
  const briefs = fs.existsSync(briefDir) ? fs.readdirSync(briefDir).filter((f) => f.endsWith('.md')).sort() : [];
  for (const q of questions) if (q.brief && !briefs.includes(q.brief.replace(/^.*\//, ''))) problems.push(`questions.csv names brief "${q.brief}", which is not in content/briefs/`);

  // The profile lives in the target folder so the next run reuses it; the run keeps a copy.
  const profile = readText(inv.profile) || readText(path.join(run, 'site-profile.md'));
  if (!profile) problems.push(`no site profile at ${inv.profile}`);
  else fs.writeFileSync(path.join(run, 'site-profile.md'), profile);
  const summary = readText(path.join(run, 'summary.md'));
  if (!summary) problems.push('no summary.md (the verdict-free "do this first" paragraph for proposals.md)');

  let plan = null;
  const fix = writeFixPlan(run, { subject: inv.host });
  if (fix.written) plan = fix.plan;
  else if (fix.errors?.length) problems.push(...fix.errors.map((e) => `tasks.json: ${e}`));
  else problems.push('no tasks.json: no fix plan written');
  for (const w of fix.warnings || []) log(`tasks.json: ${w}`);

  const md = renderProposals({ inventory: inv, check: checked, questions, briefs, summary, profile, plan, samples: hasSamples, version: VERSION });
  fs.writeFileSync(path.join(run, 'proposals.md'), md);
  writeJson(path.join(inv.target, 'last-plan.json'), { date: new Date().toISOString(), run, templates: inv.templates.length, drafts: checked.drafts.map((d) => ({ file: d.file, types: d.types })), questions: questions.map((q) => ({ question: q.question, status: q.status })) });

  console.log(`plan-geo ${VERSION} — ${inv.host}`);
  for (const d of checked.drafts) console.log(checkLine(d));
  const n = (s) => questions.filter((q) => q.status === s).length;
  if (questions.length) console.log(`Questions: ${questions.length} (${n('answered')} answered, ${n('partial')} partly, ${n('missing')} missing); ${briefs.length} brief(s)`);
  if (plan) console.log(`Tasks: ${plan.tasks.length} (${plan.tasks.filter((t) => t.owner === 'agent').length} for agents)`);
  for (const p of problems) console.log(`NOTE ${p}`);
  console.log('');
  console.log(`proposals.md   ${path.join(run, 'proposals.md')}`);
  if (plan) console.log(`fix/TODO.md    ${fix.todo}`);
  if (hasSamples) console.log(`samples        ${path.join(run, 'samples', 'README.md')}`);
  console.log(`Run folder     ${run}`);
}

// ---------------------------------------------------------------- main

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const cmd = opts._[0];
  if (opts.help || !cmd) { console.log(HELP); return; }
  if (cmd === 'extract') return extract(opts);
  const run = opts._[1] && path.resolve(opts._[1]);
  if (!run || !fs.existsSync(run)) throw new Error(`${cmd} needs the run folder that "extract" printed`);
  if (cmd === 'check') return check(run, opts);
  if (cmd === 'samples') return samples(run, opts);
  if (cmd === 'build') return build(run, opts);
  throw new Error(`unknown command "${cmd}" (extract, check, samples or build)`);
}

export { validateTasks };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log(`plan-geo: ${e.message}`); process.exit(1); });
}
