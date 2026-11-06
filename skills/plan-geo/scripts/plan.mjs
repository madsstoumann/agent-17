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
 *   plan.mjs build <run folder>    runs check, then writes proposals.md and fix/TODO.md + fix/tasks/.
 *
 * Zero dependencies. Node >= 22.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { extractPage, pageDigest } from './lib/extract.mjs';
import { groupTemplates, pickSample, pageSlug, indexable } from './lib/templates.mjs';
import { verifyDraft, typesIn } from './lib/verify.mjs';
import { readQuestions, renderProposals, QUESTION_COLUMNS } from './lib/proposals.mjs';
import { richIssues } from './lib/rich.mjs';
import { schemaValidate } from './lib/schema.mjs';
import { launch, render, findChrome } from './lib/render.mjs';
import { targetDir, claimTarget, newRun, markRun, RUN_MARKER } from './lib/target-state.mjs';
import { writeFixPlan, validateTasks } from './lib/tasks.mjs';

export const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

const HELP = `plan-geo ${VERSION}

Usage:
  plan.mjs extract <input> [--pages N] [--out DIR] [--header "Name: value"] [--no-render] [--insecure]
                   [--queries FILE] [--competitors a.com,b.com] [--repo PATH] [--only markup|content]
  plan.mjs check <run folder> [--no-remote]
  plan.mjs build <run folder> [--no-remote]

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
  --no-remote      Do not send drafts to validator.schema.org.
`;

// ---------------------------------------------------------------- small helpers

function parseArgs(argv) {
  const o = { _: [], pages: 24, headers: {}, render: true, remote: true, insecure: false, out: null, queries: null, competitors: [], repo: null, only: null };
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

/** The page a draft is checked against: markup/site.jsonld → the start page; <template slug> → its example; <page slug> → that page. */
function draftPage(run, inv, slug) {
  const pages = path.join(run, 'pages');
  const t = slug === 'site' ? inv.templates.find((x) => x.key === 'home') : inv.templates.find((x) => x.slug === slug);
  const pageSlugName = t?.example || (fs.existsSync(path.join(pages, `${slug}.json`)) ? slug : null);
  return pageSlugName ? { slug: pageSlugName, page: readJson(path.join(pages, `${pageSlugName}.json`)) } : null;
}

async function check(run, opts, { quiet = false } = {}) {
  const inv = readJson(path.join(run, 'inventory.json'));
  if (!inv) throw new Error(`no inventory.json in ${run}: run "plan.mjs extract" first`);
  const dir = path.join(run, 'markup');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonld')).sort() : [];
  const drafts = [];
  for (const f of files) {
    const slug = f.replace(/\.jsonld$/, '');
    const d = { file: `markup/${f}`, slug, page: null, types: [], parseError: null, notOnPage: [], required: [], recommended: [], validator: null };
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { d.parseError = e.message; drafts.push(d); continue; }
    d.types = topTypes(data);
    d.allTypes = [...typesIn(data)];
    const target = draftPage(run, inv, slug);
    if (target?.page) { d.page = target.page.url; d.notOnPage = verifyDraft(data, target.page); } else d.noPage = true;
    for (const r of richIssues([data])) { for (const p of r.required) d.required.push(`${r.type}.${p}`); for (const p of r.recommended) d.recommended.push(`${r.type}.${p}`); }
    if (opts.remote) {
      const html = `<!doctype html><html><head><title>draft</title><script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script></head><body></body></html>`;
      const v = await schemaValidate(http, { html });
      d.validator = v.ok ? { objects: v.objects, errors: v.errors, warnings: v.warnings, messages: v.nodes.flatMap((n) => [...n.errors, ...n.warnings].map((e) => `${n.types.join('/')}: ${e.property || ''} ${e.type || ''}`.trim())).slice(0, 10) } : { error: v.error };
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

function checkLine(d) {
  if (d.parseError) return `FAIL ${d.file}: does not parse (${d.parseError})`;
  const bits = [];
  if (d.noPage) bits.push('no page to check against (name it after a template slug, a page slug or "site")');
  if (d.notOnPage.length) bits.push(`${d.notOnPage.length} value(s) not on the page: ${d.notOnPage.slice(0, 4).map((f) => `${f.path} "${String(f.value).slice(0, 40)}"`).join('; ')}`);
  if (d.required.length) bits.push(`for Google's rich result also needs ${d.required.join(', ')} (leave out when the page does not show it)`);
  if (d.validator?.errors) bits.push(`validator.schema.org: ${d.validator.errors} error(s): ${d.validator.messages.slice(0, 3).join('; ')}`);
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

// ---------------------------------------------------------------- build

async function build(run, opts) {
  const inv = readJson(path.join(run, 'inventory.json'));
  if (!inv) throw new Error(`no inventory.json in ${run}: run "plan.mjs extract" first`);
  const problems = [];
  const checked = await check(run, opts, { quiet: true });

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

  const md = renderProposals({ inventory: inv, check: checked, questions, briefs, summary, profile, plan, version: VERSION });
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
  if (cmd === 'build') return build(run, opts);
  throw new Error(`unknown command "${cmd}" (extract, check or build)`);
}

export { validateTasks };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log(`plan-geo: ${e.message}`); process.exit(1); });
}
