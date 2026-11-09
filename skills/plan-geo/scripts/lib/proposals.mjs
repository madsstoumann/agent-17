/**
 * proposals.md: the client-facing summary of a plan-geo run. Assembled from what the scripts
 * measured (inventory.json, markup/check.json) and what Claude wrote (summary.md,
 * site-profile.md, content/questions.csv, content/briefs/, tasks.json).
 *
 * Zero dependencies. Node >= 22. Pure.
 */

export const STATUSES = ['answered', 'partial', 'missing'];
export const INTENTS = ['definition', 'comparison', 'how-to', 'fit', 'pricing', 'proof', 'trust', 'other'];
export const QUESTION_COLUMNS = ['question', 'intent', 'status', 'page', 'brief'];

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

/**
 * readQuestions(csvText) -> { questions: [{ question, intent, status, page, brief }], errors }
 * The header row names the columns; question and status are required.
 */
export function readQuestions(text) {
  const rows = parseCsv(text);
  const errors = [];
  if (!rows.length) return { questions: [], errors: ['questions.csv is empty'] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  for (const c of ['question', 'status']) if (!head.includes(c)) errors.push(`questions.csv has no "${c}" column`);
  if (errors.length) return { questions: [], errors };
  const questions = rows.slice(1).map((r, i) => {
    const o = Object.fromEntries(head.map((h, j) => [h, (r[j] || '').trim()]));
    const q = { question: o.question, intent: (o.intent || 'other').toLowerCase(), status: (o.status || '').toLowerCase(), page: o.page || '', brief: o.brief || '' };
    if (!q.question) errors.push(`questions.csv row ${i + 2}: no question`);
    if (!STATUSES.includes(q.status)) errors.push(`questions.csv row ${i + 2}: status "${o.status}" is not one of ${STATUSES.join(', ')}`);
    if (!INTENTS.includes(q.intent)) errors.push(`questions.csv row ${i + 2}: intent "${o.intent}" is not one of ${INTENTS.join(', ')}`);
    if (q.status !== 'missing' && !q.page) errors.push(`questions.csv row ${i + 2}: status ${q.status} needs the page that answers it`);
    return q;
  });
  return { questions, errors };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const pathOf = (u) => { try { const x = new URL(u); return x.pathname; } catch { return u; } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const markupNow = (m) => Object.entries(m || {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(', ') || 'none';

/**
 * renderProposals({ inventory, check, questions, briefs, summary, profile, plan, version, date }) -> markdown
 * `briefs` are file names under content/briefs/; `plan` the validated tasks plan (or null).
 */
export function renderProposals({ inventory, check = null, questions = [], briefs = [], summary = '', profile = '', plan = null, samples = false, version, date = new Date() }) {
  const out = [];
  const host = inventory.host;
  out.push(`# GEO plan: ${host}`, '');
  out.push(`${date.toISOString().slice(0, 10)} · plan-geo ${version} · from an audit-seo crawl of ${plural(inventory.crawled, 'page')} (${inventory.indexable} indexable${inventory.truncated ? ', capped' : ''}) · ${plural(inventory.templates.length, 'template')} · ${plural(inventory.sample.length, 'page')} read in full`, '');
  out.push('A plan, not an audit: it proposes markup and content. It does not measure whether AI engines cite the site.', '');
  if (summary.trim()) out.push(summary.trim().replace(/^# .*\n+/, ''), '');

  if (profile.trim()) out.push('## About the site', '', profile.trim().replace(/^# .*\n+/, '').replace(/^(#{2,5}) /gm, '#$1 '), '');

  out.push('## Markup by template', '');
  out.push('| Template | Pages | Type | Markup now | Proposed | Draft | Check |', '| --- | ---: | --- | --- | --- | --- | --- |');
  // A draft belongs to a template by its slug, "site" to the start page, a page slug to that page's template.
  const pageTemplate = new Map((inventory.sample || []).map((s) => [s.slug, s.template]));
  const byTemplate = new Map();
  for (const d of check?.drafts || []) {
    const key = d.slug === 'site' ? 'home' : inventory.templates.find((t) => t.slug === d.slug)?.key || pageTemplate.get(d.slug) || null;
    if (key) (byTemplate.get(key) || byTemplate.set(key, []).get(key)).push(d);
  }
  const status = (d) => (d.parseError ? 'does not parse' : [d.notOnPage.length ? `${d.notOnPage.length} not on page` : null, d.validator?.errors ? `${d.validator.errors} validator errors` : null, d.required.length ? `rich result needs ${d.required.length} more` : null].filter(Boolean).join(', ') || 'passes');
  for (const t of inventory.templates) {
    const ds = byTemplate.get(t.key) || [];
    const proposed = ds.length ? [...new Set(ds.flatMap((d) => d.types))].join(', ') : `not drafted (usual: ${t.types.join(', ').replace(/\|/g, ' or ')})`;
    out.push(`| ${cell(t.key)} | ${t.pages} | ${cell(t.type)} | ${cell(markupNow(t.markup))} | ${cell(proposed)} | ${ds.map((d) => `[${d.file.replace(/^markup\//, '')}](${d.file})`).join(', ')} | ${ds.map(status).join('; ')} |`);
  }
  out.push('');
  if (samples) out.push('Each draft merged with the site graph, as a page to paste into Google\'s Rich Results Test or validator.schema.org: [samples/README.md](samples/README.md).', '');
  const flagged = (check?.drafts || []).filter((d) => d.notOnPage.length);
  if (flagged.length) {
    out.push('Values a draft uses that the page does not show. Fix the page or drop the value before the markup ships:', '');
    for (const d of flagged) for (const f of d.notOnPage.slice(0, 8)) out.push(`- \`${d.file}\` ${f.path}: "${cell(f.value)}" (${f.reason})`);
    out.push('');
  }

  if (questions.length) {
    const n = (s) => questions.filter((q) => q.status === s).length;
    out.push('## Questions and content gaps', '');
    out.push(`${plural(questions.length, 'question')} people are likely to ask AI engines about this field: ${n('answered')} answered on the site, ${n('partial')} partly, ${n('missing')} not at all.`, '');
    out.push('| Question | Intent | Status | Answered on | Brief |', '| --- | --- | --- | --- | --- |');
    const order = { missing: 0, partial: 1, answered: 2 };
    for (const q of [...questions].sort((a, b) => order[a.status] - order[b.status])) {
      out.push(`| ${cell(q.question)} | ${q.intent} | ${q.status} | ${q.page ? cell(pathOf(q.page)) : ''} | ${q.brief ? `[${cell(q.brief.replace(/^.*\//, ''))}](content/briefs/${q.brief.replace(/^.*\//, '')})` : ''} |`);
    }
    out.push('');
  }

  if (briefs.length) out.push('## Content briefs', '', ...briefs.map((b) => `- [${b}](content/briefs/${b})`), '');

  if (plan) {
    const agent = plan.tasks.filter((t) => t.owner === 'agent').length;
    out.push('## Tasks', '', `${plural(plan.tasks.length, 'task')}: ${agent} for an agent (markup and modules in the site's code), ${plan.tasks.length - agent} for people (content and decisions). See [fix/TODO.md](fix/TODO.md); run the agent tasks with \`/skills:audit-fix\` on this folder.`, '');
  }

  out.push('## Not covered', '',
    '- Whether ChatGPT, Perplexity, Gemini or Google AI Overviews cite the site today. Test the questions above in each engine, or with a visibility tracker, before and after the work.',
    '- Rankings, traffic and Search Console data. With `--queries` the question list starts from real searches; without it the questions are an informed guess from the site and its industry.',
    '- Rich results: FAQ rich results are limited to government and health sites and HowTo is retired. The markup is for meaning, not for snippets.',
    '');
  return out.join('\n');
}
