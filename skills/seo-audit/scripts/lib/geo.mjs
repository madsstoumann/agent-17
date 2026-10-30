/**
 * GEO (generative engine optimisation): how the site presents itself to AI search and answer
 * engines. llms.txt and llms-full.txt (llmstxt.org), ai.txt, AI crawler rules and Content-Signal
 * lines in robots.txt, and the entity markup answer engines lean on.
 *
 * Zero dependencies. Node >= 22. `fetchGeo` does the I/O and never throws; the rest is pure.
 */
import { result } from './checks.mjs';
import { isAllowed } from './robotsmatch.mjs';

/**
 * AI crawlers by what blocking them costs. `answer` bots fetch pages to cite them in AI search
 * and chat answers; blocking them keeps the site out of those answers. `training` bots collect
 * training data; blocking them is a policy choice and costs no visibility.
 */
export const AI_BOTS = [
  { agent: 'OAI-SearchBot', owner: 'OpenAI', kind: 'answer' },
  { agent: 'ChatGPT-User', owner: 'OpenAI', kind: 'answer' },
  { agent: 'Claude-SearchBot', owner: 'Anthropic', kind: 'answer' },
  { agent: 'Claude-User', owner: 'Anthropic', kind: 'answer' },
  { agent: 'PerplexityBot', owner: 'Perplexity', kind: 'answer' },
  { agent: 'Perplexity-User', owner: 'Perplexity', kind: 'answer' },
  { agent: 'GPTBot', owner: 'OpenAI', kind: 'training' },
  { agent: 'ClaudeBot', owner: 'Anthropic', kind: 'training' },
  { agent: 'Google-Extended', owner: 'Google (Gemini)', kind: 'training' },
  { agent: 'Applebot-Extended', owner: 'Apple', kind: 'training' },
  { agent: 'CCBot', owner: 'Common Crawl', kind: 'training' },
  { agent: 'Meta-ExternalAgent', owner: 'Meta', kind: 'training' },
  { agent: 'Bytespider', owner: 'ByteDance', kind: 'training' },
  { agent: 'Amazonbot', owner: 'Amazon', kind: 'training' },
];

const ENTITY_TYPES = /^(Organization|Corporation|LocalBusiness|NGO|EducationalOrganization|GovernmentOrganization|Museum|Store|Restaurant|Hotel|MedicalOrganization|Person|.*Organization)$/;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A 200 that is a real text file, not the site's HTML 404 page served with 200. */
function textFile(res) {
  if (!res || res.status !== 200 || !res.body) return null;
  if (/text\/html/i.test(res.contentType || '') || /^\s*<(!doctype|html)/i.test(res.body)) return null;
  return res.body;
}

/**
 * llms.txt structure (llmstxt.org): an H1 with the site name (required), an optional
 * blockquote summary, then H2 sections of Markdown link lists.
 * @returns {{ title: string|null, summary: boolean, sections: string[], links: Array<{ text: string, url: string }> }}
 */
export function parseLlmsTxt(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const first = lines.find((l) => l.trim());
  const title = first && /^#\s+\S/.test(first) ? first.replace(/^#\s+/, '').trim() : null;
  const summary = lines.some((l) => /^>\s*\S/.test(l));
  const sections = lines.filter((l) => /^##\s+\S/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());
  const links = [];
  for (const m of String(text || '').matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) links.push({ text: m[1], url: m[2] });
  return { title, summary, sections, links };
}

/** `Content-Signal:` lines (contentsignals.org) from the raw robots.txt. */
export function contentSignals(robotsText) {
  return String(robotsText || '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter((l) => /^content-signal\s*:/i.test(l)).map((l) => l.replace(/^content-signal\s*:\s*/i, ''));
}

/**
 * Fetches /llms.txt, /llms-full.txt and /ai.txt, and checks up to `maxLinks` same-site links
 * listed in llms.txt.
 */
export async function fetchGeo(http, origin, { maxLinks = 20 } = {}) {
  const get = (p) => http.get(`${origin}${p}`, { redirect: 'follow', maxBytes: 2 * 1024 * 1024, timeout: 15000 });
  const [llms, full, ai] = await Promise.all([get('/llms.txt'), get('/llms-full.txt'), get('/ai.txt')]);
  const out = {
    llms: { status: llms.status, text: textFile(llms), error: llms.error || null },
    llmsFull: { status: full.status, bytes: textFile(full)?.length || 0, present: !!textFile(full) },
    aiTxt: { status: ai.status, present: !!textFile(ai) },
    linkChecks: [],
  };
  if (out.llms.text) {
    const host = new URL(origin).host;
    const own = parseLlmsTxt(out.llms.text).links
      .map((l) => { try { return new URL(l.url, origin).toString(); } catch { return null; } })
      .filter((u) => u && new URL(u).host === host);
    for (const url of [...new Set(own)].slice(0, maxLinks)) {
      let r = await http.head(url, { redirect: 'follow', timeout: 10000 });
      if (r.status === 405 || r.status === 403 || r.status === 0) r = await http.get(url, { redirect: 'follow', timeout: 10000, maxBytes: 0 });
      out.linkChecks.push({ url, status: r.status, error: r.error || null });
    }
  }
  return out;
}

/**
 * GEO rows. `robots` is { status, parsed } as seo.mjs builds it, `robotsText` the raw file,
 * `geo` the output of fetchGeo (null when not fetched), `start` the start page record.
 */
export function geoChecks({ robots = {}, robotsText = '', geo = null, start = null }) {
  const out = [];
  const parsed = robots.parsed || null;

  // AI crawlers in robots.txt. groupFor falls back to `*`, so `Disallow: /` for everyone shows up
  // here too; seo.robots-txt already flags that, so it is named rather than repeated per bot.
  const blockedAll = parsed && !isAllowed(parsed, '/', 'seo-audit-nobody');
  const blocked = AI_BOTS.filter((b) => parsed && !isAllowed(parsed, '/', b.agent.toLowerCase()));
  const answer = blocked.filter((b) => b.kind === 'answer');
  const training = blocked.filter((b) => b.kind === 'training');
  const named = AI_BOTS.filter((b) => parsed?.groups?.some((g) => g.agents.includes(b.agent.toLowerCase())));
  const list = (bs) => bs.map((b) => `${b.agent} (${b.owner})`).join(', ');
  if (!parsed && (robots.status === 404 || robots.status === 410)) out.push(result('seo.ai-crawlers', 'info', 'AI crawlers in robots.txt', `no robots.txt (${robots.status}): every AI crawler may fetch every page`));
  else if (!parsed) out.push(result('seo.ai-crawlers', 'skip', 'AI crawlers in robots.txt', `robots.txt not readable (${robots.status || robots.error || 'no answer'}), so the AI crawler rules are unknown`));
  else if (blockedAll) out.push(result('seo.ai-crawlers', 'info', 'AI crawlers in robots.txt', `robots.txt blocks every crawler, AI crawlers included${named.length ? `; ${plural(named.length, 'AI crawler')} named in their own groups` : ''} (see the robots.txt row)`));
  else if (answer.length) out.push(result('seo.ai-crawlers', 'warn', 'AI crawlers in robots.txt', `blocks ${plural(answer.length, 'AI search crawler')}: ${list(answer)}${training.length ? `; also ${plural(training.length, 'training crawler')}` : ''}`, { fix: 'These crawlers fetch pages to cite them in ChatGPT, Claude and Perplexity answers; blocking them keeps the site out of those answers. Allow them, and block only the training crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot) if the goal is to opt out of training.', urls: answer.map((b) => ({ url: '/robots.txt', note: `${b.agent}: Disallow /` })) }));
  else out.push(result('seo.ai-crawlers', training.length ? 'info' : 'pass', 'AI crawlers in robots.txt', training.length ? `AI search crawlers allowed; ${plural(training.length, 'training crawler')} blocked (a policy choice): ${list(training)}` : `every AI crawler allowed${named.length ? ` (${plural(named.length, 'named group')})` : ' (none named, the * group applies)'}`));

  const signals = contentSignals(robotsText);
  if (signals.length) out.push(result('seo.content-signal', 'info', 'Content-Signal in robots.txt', signals.slice(0, 3).join(' | ')));

  if (!geo) {
    out.push(result('seo.llms-txt', 'skip', 'llms.txt', 'not fetched'));
  } else if (!geo.llms.text) {
    out.push(result('seo.llms-txt', 'info', 'llms.txt', `no /llms.txt (${geo.llms.status || geo.llms.error || 'no answer'})`, { fix: 'Optional. A Markdown index at /llms.txt (an H1 with the site name, a one-line > summary, then ## sections listing the key pages as links) gives AI tools a clean map of the site. Few AI search engines read it yet, so treat it as cheap insurance, not a ranking factor.' }));
  } else {
    const l = parseLlmsTxt(geo.llms.text);
    const problems = [];
    if (!l.title) problems.push('does not start with an H1 (# Site name)');
    if (!l.links.length) problems.push('lists no links');
    const broken = geo.linkChecks.filter((c) => c.status === 0 || c.status >= 400);
    if (broken.length) problems.push(`${plural(broken.length, 'broken link')} of ${geo.linkChecks.length} checked`);
    const desc = `"${l.title || '(no title)'}", ${plural(l.sections.length, 'section')}, ${plural(l.links.length, 'link')}${l.summary ? ', summary' : ', no summary'}`;
    out.push(problems.length
      ? result('seo.llms-txt', 'warn', 'llms.txt', `${desc}: ${problems.join('; ')}`, { fix: 'Follow the llmstxt.org format: H1 with the site name first, an optional > summary, then ## sections of [title](url): note links. Remove or fix links that no longer resolve.', urls: broken.map((c) => ({ url: c.url, note: c.error || `HTTP ${c.status}` })) })
      : result('seo.llms-txt', 'pass', 'llms.txt', desc));
  }
  if (geo) {
    out.push(result('seo.llms-full', 'info', 'llms-full.txt', geo.llmsFull.present ? `present, ${Math.round(geo.llmsFull.bytes / 1024)} kB` : `none (${geo.llmsFull.status || 'no answer'}); optional, the full text of the key pages in one file`));
    if (geo.aiTxt.present) out.push(result('seo.ai-txt', 'info', 'ai.txt', 'present (Spawning ai.txt: rules for AI training on the site\'s media)'));
  }

  // Entity markup: answer engines lean on Organization/WebSite with sameAs to know who is speaking.
  if (start && start.title !== undefined) {
    const types = new Set((start.jsonLd || []).flatMap((j) => j.types || []));
    const entity = [...types].some((t) => ENTITY_TYPES.test(t));
    const site = types.has('WebSite');
    const missing = [!entity && 'Organization (or LocalBusiness/Person)', !site && 'WebSite'].filter(Boolean);
    out.push(missing.length
      ? result('seo.entity-markup', 'warn', 'Entity markup for answer engines', `start page has no ${missing.join(' and no ')} JSON-LD`, { fix: 'Add Organization (or LocalBusiness) with name, url, logo and sameAs links to the official profiles, plus WebSite with name and url, on the start page. AI answers and knowledge panels use it to tie the site to the brand.', urls: [{ url: start.url }] })
      : result('seo.entity-markup', 'pass', 'Entity markup for answer engines', `start page: ${[...types].filter((t) => ENTITY_TYPES.test(t) || t === 'WebSite').join(', ')}`));
  }
  return out;
}
