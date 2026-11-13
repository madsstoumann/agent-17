/**
 * GEO (generative engine optimisation): how the site presents itself to AI search and answer
 * engines. llms.txt and llms-full.txt (llmstxt.org), ai.txt, AI crawler rules and Content-Signal
 * lines in robots.txt, and the entity markup answer engines lean on.
 *
 * Zero dependencies. Node >= 22. `fetchGeo` does the I/O and never throws; the rest is pure.
 */
import { result } from './checks.mjs';
import { isAllowed } from './robotsmatch.mjs';
import { isoDate } from './content.mjs';
import { headThenGet } from './crawl.mjs';

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
      const r = await headThenGet(http, url);
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
  const blockedAll = parsed && !isAllowed(parsed, '/', 'audit-seo-nobody');
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

// ---------------------------------------------------------------- what AI crawlers actually get

/**
 * User agents for the access test, as each crawler sends it. Googlebot is the control: no site
 * means to refuse Google, so a refused Googlebot user agent means the edge checks bots by IP
 * address, and every refusal from this machine is then inconclusive.
 */
export const BOT_UAS = [
  { agent: 'OAI-SearchBot', kind: 'answer', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot' },
  { agent: 'ChatGPT-User', kind: 'answer', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot' },
  { agent: 'Claude-SearchBot', kind: 'answer', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)' },
  { agent: 'Claude-User', kind: 'answer', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +https://www.anthropic.com)' },
  { agent: 'PerplexityBot', kind: 'answer', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)' },
  { agent: 'Perplexity-User', kind: 'answer', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)' },
  { agent: 'bingbot', kind: 'search', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/131.0.0.0 Safari/537.36' },
  { agent: 'GPTBot', kind: 'training', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot' },
  { agent: 'ClaudeBot', kind: 'training', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' },
  { agent: 'Googlebot', kind: 'control', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36' },
];

const textWords = (html) => {
  const body = String(html || '').replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const t = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
};

/** One fetch as the verdict needs it: refused (status, challenge or a stub of the page) or not. */
export function judgeFetch(res, baselineWords, challengeVendor = () => null) {
  if (!res || res.status === 0) return { refused: true, why: res?.error || 'no answer' };
  if (res.status >= 400) return { refused: true, why: `HTTP ${res.status}` };
  const vendor = challengeVendor(res.status, res.body, res.headers || {});
  if (vendor) return { refused: true, why: `${vendor} challenge` };
  const w = textWords(res.body);
  if (baselineWords >= 100 && w < baselineWords * 0.3) return { refused: true, why: `${w} words instead of ${baselineWords}` };
  return { refused: false, why: `HTTP ${res.status}, ${w} words` };
}

/**
 * Fetches each of `urls` once as a browser (the baseline) and once per crawler in BOT_UAS that
 * robots.txt lets in. `http` must not send the --header bypass: the point is what the edge does
 * to a crawler. -> { pages: [{ url, baseline, bots: { <agent>: { refused, why } | { robots: true } } }] }
 */
export async function fetchBotAccess(http, urls, { robots = null, challengeVendor = () => null } = {}) {
  const pages = [];
  for (const url of urls) {
    const path = (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return '/'; } })();
    const base = await http.get(url, { redirect: 'follow', maxBytes: 2 * 1024 * 1024 });
    const baseWords = textWords(base.body);
    const baseline = judgeFetch(base, 0, challengeVendor);
    const bots = {};
    await Promise.all(BOT_UAS.map(async (b) => {
      if (robots && !isAllowed(robots, path, b.agent.toLowerCase())) { bots[b.agent] = { robots: true }; return; }
      const r = await http.get(url, { redirect: 'follow', maxBytes: 2 * 1024 * 1024, headers: { 'user-agent': b.ua } });
      bots[b.agent] = judgeFetch(r, baseWords, challengeVendor);
    }));
    pages.push({ url, baseline: { ...baseline, words: baseWords }, bots });
  }
  return { pages };
}

/** The seo.ai-bot-access row from fetchBotAccess's output (null: not run). */
export function botAccessRow(access, { skipped = null } = {}) {
  const T = 'AI crawlers at the edge';
  if (!access) return result('seo.ai-bot-access', 'skip', T, skipped || 'not run (--bot-pages 0)');
  const ok = access.pages.filter((p) => !p.baseline.refused);
  if (!ok.length) return result('seo.ai-bot-access', 'skip', T, `a browser request was refused too (${access.pages.map((p) => p.baseline.why).join(', ')}), so the crawler test says nothing; check the CDN's bot settings or the server logs`);
  const refusedBy = (agent) => ok.filter((p) => p.bots[agent]?.refused);
  const control = refusedBy('Googlebot');
  const kindOf = Object.fromEntries(BOT_UAS.map((b) => [b.agent, b.kind]));
  const refused = BOT_UAS.filter((b) => b.kind !== 'control' && refusedBy(b.agent).length).map((b) => b.agent);
  const urls = ok.flatMap((p) => Object.entries(p.bots).filter(([, v]) => v.refused).map(([agent, v]) => ({ url: p.url, note: `${agent}: ${v.why}` })));
  const pages = plural(ok.length, 'page');
  if (control.length) {
    return result('seo.ai-bot-access', 'info', T, `a Googlebot user agent from this machine was refused too, so the edge checks crawlers by IP address and the test cannot tell${refused.length ? `; also refused here: ${refused.join(', ')}` : ''}`, { fix: 'Check the CDN or WAF bot settings (Cloudflare: Security > Bots and "Block AI bots"; Vercel Firewall; Akamai Bot Manager) and the server logs for OAI-SearchBot, PerplexityBot and Claude-SearchBot answers.', urls });
  }
  const answer = refused.filter((a) => kindOf[a] === 'answer' || kindOf[a] === 'search');
  const training = refused.filter((a) => kindOf[a] === 'training');
  if (answer.length) {
    return result('seo.ai-bot-access', 'warn', T, `robots.txt lets them in, but the edge refuses ${answer.join(', ')} on ${plural(new Set(urls.filter((u) => answer.includes(u.note.split(':')[0])).map((u) => u.url)).size, 'page')} of ${ok.length}, while a Googlebot user agent gets the page${training.length ? `; training crawlers refused too: ${training.join(', ')}` : ''}`, { fix: 'A CDN or WAF rule is blocking AI search crawlers by user agent (Cloudflare "Block AI bots" or AI Crawl Control, a Vercel or Akamai bot rule, a security plugin). Allow the search and user-triggered crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User) and bingbot, and keep blocking only the training crawlers if that is the policy. Confirm in the CDN logs afterwards: the real crawlers come from published IP ranges.', urls });
  }
  if (training.length) return result('seo.ai-bot-access', 'info', T, `AI search crawlers get the page on ${pages}; the edge refuses training crawlers (a policy choice): ${training.join(', ')}`, { urls });
  return result('seo.ai-bot-access', 'pass', T, `every AI crawler user agent got the same page as a browser on ${pages}${ok.some((p) => Object.values(p.bots).some((v) => v.robots)) ? ' (crawlers robots.txt shuts out were not fetched)' : ''}`);
}

// ---------------------------------------------------------------- the page as a crawler without JavaScript reads it

/**
 * seo.ai-rendered-text: served HTML against the rendered page. `render` is seo.mjs's render
 * summary; pages carry `renderedWords` and `renderedHeadings` when Chrome measured them.
 */
export function renderedTextRow({ pages = [], render = null }) {
  const T = 'Text without JavaScript';
  if (!render?.ran) return result('seo.ai-rendered-text', 'skip', T, render?.error ? `not rendered: ${render.error}` : 'not rendered (--render-pages 0)');
  const measured = pages.filter((p) => Number.isFinite(p.renderedWords));
  if (!measured.length) return result('seo.ai-rendered-text', 'skip', T, 'Chrome rendered no page it could measure');
  const lossOf = (p) => (p.renderedWords ? 1 - Math.min(p.words || 0, p.renderedWords) / p.renderedWords : 0);
  const losing = measured.filter((p) => p.renderedWords - (p.words || 0) >= 100 && lossOf(p) >= 0.5);
  const empty = losing.filter((p) => lossOf(p) >= 0.8);
  const note = (p) => `served ${p.words || 0} words, ${p.renderedWords} after JavaScript (${Math.round((1 - lossOf(p)) * 100)}% in the HTML)${p.renderedHeadings > (p.sig?.headingsAll ?? 0) ? `; headings ${p.sig?.headingsAll ?? 0} → ${p.renderedHeadings}` : ''}`;
  const urls = losing.map((p) => ({ url: p.url, note: note(p) }));
  const fix = 'GPTBot, ClaudeBot, PerplexityBot and most AI answer crawlers read the served HTML and do not run JavaScript, so text the browser builds is invisible to them (Googlebot renders, most others do not). Render the main content on the server (SSR or static generation; in a headless CMS front end, server components or prerendering), or at least serve the headline, intro and key facts in the HTML.';
  if (empty.length && empty.length >= measured.length / 2) return result('seo.ai-rendered-text', 'fail', T, `${plural(empty.length, 'page')} of ${measured.length} rendered serve less than a fifth of their text without JavaScript: the site builds its content in the browser`, { fix, urls });
  if (losing.length) return result('seo.ai-rendered-text', 'warn', T, `${plural(losing.length, 'page')} of ${measured.length} rendered serve less than half of their text without JavaScript`, { fix, urls });
  const share = Math.round((measured.reduce((n, p) => n + Math.min(p.words || 0, p.renderedWords), 0) / Math.max(1, measured.reduce((n, p) => n + p.renderedWords, 0))) * 100);
  return result('seo.ai-rendered-text', 'pass', T, `the served HTML holds ${share}% of the rendered text on ${plural(measured.length, 'page')} checked in Chrome`);
}

// ---------------------------------------------------------------- freshness, authorship and structure

const MONTH = 30 * 24 * 3600 * 1000;
const isIndexable = (p) => p.status >= 200 && p.status < 300 && p.title !== undefined && !p.noindex && p.sig;

const NEWS_SECTION = /^(news|nyheder|nyhed|blog|blogs|insights?|articles?|press|press-releases?|presse|pressemeddelelser|stories|perspectives|thought-leadership)$/i;
const LISTING = /^(tag|tags|category|categories|author|authors|page|side|archive|arkiv|topics?)$/i;
const YEAR_SEG = /^(19|20)\d\d$/;

/**
 * newsUrl(url) -> null | { dated }: a page under a news, blog or insights section with a slug of its
 * own (not the section index, a year listing, a tag or a page number). `dated` when a /YYYY/ segment
 * sits in the path, as in /about-us/news/2022/Example-signs-new-partner.
 */
export function newsUrl(url) {
  let segs;
  try { segs = new URL(url).pathname.split('/').filter(Boolean); } catch { return null; }
  const i = segs.findIndex((x) => NEWS_SECTION.test(x));
  if (i < 0) return null;
  const rest = segs.slice(i + 1);
  const last = rest[rest.length - 1];
  if (!rest.length || YEAR_SEG.test(last) || /^\d{1,3}$/.test(last) || rest.some((x) => LISTING.test(x))) return null;
  return { dated: rest.some((x) => YEAR_SEG.test(x)) };
}

/**
 * A page with no article markup that still reads as one: a news/blog/insights URL with a year in
 * the path or a date written on the page. Sitecore and other CMS news templates often ship this way.
 */
export function articleLikeWithoutMarkup(p) {
  if (p.sig?.articleLike) return false;
  const n = newsUrl(p.url);
  return Boolean(n && (n.dated || p.sig?.visibleDate));
}

/** seo.freshness, seo.author and seo.sitemap-lastmod. `today` is YYYY-MM-DD (for tests). */
export function freshnessRows({ pages = [], sitemap = null, today = new Date().toISOString().slice(0, 10) }) {
  const out = [];
  const idx = pages.filter(isIndexable);
  const implicit = new Set(idx.filter(articleLikeWithoutMarkup));
  const articles = idx.filter((p) => p.sig.articleLike || implicit.has(p));
  const now = new Date(today).getTime();
  const dated = (p) => p.sig.modified || p.sig.published;
  if (articles.length) {
    const undated = articles.filter((p) => !dated(p));
    const undatedImplicit = undated.filter((p) => implicit.has(p));
    const stale = articles.filter((p) => dated(p) && now - new Date(dated(p)).getTime() > 24 * MONTH);
    const noModified = articles.filter((p) => p.sig.published && !p.sig.modified);
    const detail = `${articles.length - undated.length} of ${plural(articles.length, 'article page')} carry a machine-readable date${noModified.length ? `, ${noModified.length} without dateModified` : ''}${stale.length ? `; ${stale.length} last dated over two years ago` : ''}${undatedImplicit.length ? `; ${plural(undatedImplicit.length, 'article-like page')} (news URL${undatedImplicit.some((p) => p.sig.visibleDate) ? ', date shown as plain text' : ''}) without a machine-readable date and without article markup` : ''}`;
    const note = (p) => (implicit.has(p) ? `article-like, no article markup${p.sig.visibleDate ? `; the page shows "${p.sig.visibleDate}" as plain text` : ''}` : 'no date in JSON-LD, meta or <time>');
    out.push(undated.length
      ? result('seo.freshness', 'warn', 'Dates on articles', detail, { fix: 'Answer engines prefer content they can date. Put datePublished and dateModified in the Article (or BlogPosting/NewsArticle) JSON-LD, or article:published_time and article:modified_time meta tags, and show the date on the page in a <time datetime> element. Update dateModified only when the content really changes.', urls: undated.map((p) => ({ url: p.url, note: note(p) })) })
      : result('seo.freshness', stale.length || noModified.length ? 'info' : 'pass', 'Dates on articles', detail, { urls: [...stale.map((p) => ({ url: p.url, note: `dated ${dated(p)}` })), ...noModified.filter((p) => !stale.includes(p)).map((p) => ({ url: p.url, note: `published ${p.sig.published}, no dateModified` }))] }));
    const anonymous = articles.filter((p) => !p.sig.author);
    out.push(anonymous.length
      ? result('seo.author', anonymous.length === articles.length ? 'warn' : 'info', 'Authors on articles', `${plural(anonymous.length, 'article page')} of ${articles.length} name no author (JSON-LD author, meta author or rel=author)`, { fix: 'Name the author: an author property (Person with name and url, or the Organization) in the Article JSON-LD, and a visible byline linking to an author page. AI answers and Google weigh who stands behind a text.', urls: anonymous.map((p) => ({ url: p.url })) })
      : result('seo.author', 'pass', 'Authors on articles', `every article page (${articles.length}) names its author`));
  } else if (idx.length) {
    const withDate = idx.filter(dated).length;
    out.push(result('seo.freshness', 'info', 'Dates on articles', `no article pages recognised among ${plural(idx.length, 'indexable page')} (Article/BlogPosting JSON-LD, og:type article, a dated <article>, or a news/blog URL with a date); ${withDate} carry a machine-readable date`, { fix: 'If the site has news, insights or blog pages, mark them up as Article (or BlogPosting/NewsArticle) with datePublished, dateModified and author, so search and AI engines can tell them from evergreen pages and date them.' }));
  }

  if (sitemap && sitemap.urls?.length) {
    const lm = Object.values(sitemap.lastmod || {});
    const total = sitemap.urls.length;
    const days = new Set(lm.map((d) => isoDate(d)).filter(Boolean));
    if (!lm.length) out.push(result('seo.sitemap-lastmod', 'info', 'Sitemap lastmod', `none of the ${total} sitemap URLs has a <lastmod>`, { fix: 'Add an accurate <lastmod> per URL (the date the content last changed). Bing, which feeds ChatGPT search and Copilot, uses it to decide what to recrawl; Google uses it when it is consistently right.' }));
    else if (lm.length >= 10 && days.size === 1) out.push(result('seo.sitemap-lastmod', 'warn', 'Sitemap lastmod', `all ${lm.length} <lastmod> dates are the same day (${[...days][0]}): the sitemap stamps its build time, not when pages changed`, { fix: 'Set <lastmod> from each page\'s own last content change. A date that changes on every build teaches crawlers to ignore it.' }));
    else out.push(result('seo.sitemap-lastmod', 'pass', 'Sitemap lastmod', `${lm.length} of ${total} sitemap URLs carry <lastmod> (${days.size} distinct days)`));
  }
  return out;
}

/** seo.answer-structure: how quotable the pages are. Always info: a guide, never a fail. */
export function answerStructureRow({ pages = [] }) {
  const idx = pages.filter(isIndexable).filter((p) => (p.words || 0) >= 150);
  if (!idx.length) return null;
  const q = idx.filter((p) => p.sig.questionHeadings > 0);
  const lists = idx.filter((p) => p.sig.lists > 0 || p.sig.tables > 0);
  const walls = idx.filter((p) => p.sig.paragraphs && p.sig.longParagraphs / p.sig.paragraphs >= 0.5);
  const flat = idx.filter((p) => !p.sig.headings && (p.words || 0) >= 300);
  return result('seo.answer-structure', 'info', 'Answer-friendly structure', `${plural(idx.length, 'page')} with text: question headings on ${q.length}, lists or tables on ${lists.length}, mostly paragraphs over 120 words on ${walls.length}, no subheadings on ${flat.length} of the long ones`, {
    fix: 'AI answers quote passages that stand on their own: a heading that asks or names the question, a direct one- or two-sentence answer under it, then the detail; facts as lists or tables; paragraphs short enough to lift. Start with the pages listed (walls of text and long pages without subheadings).',
    urls: [...flat.map((p) => ({ url: p.url, note: `${p.words} words, no subheadings` })), ...walls.filter((p) => !flat.includes(p)).map((p) => ({ url: p.url, note: `${p.sig.longParagraphs} of ${p.sig.paragraphs} paragraphs over 120 words` }))],
  });
}

/** seo.schema-opportunities: markup the pages look like they could carry and do not. Info. */
export function schemaOpportunitiesRow({ pages = [] }) {
  const idx = pages.filter(isIndexable);
  if (!idx.length) return null;
  const types = (p) => new Set((p.jsonLd || []).flatMap((j) => j.types || []));
  const hits = [];
  for (const p of idx) {
    const t = types(p);
    const notes = [];
    if ((p.sig.articleLike || articleLikeWithoutMarkup(p)) && ![...t].some((x) => /Article|BlogPosting|Report/.test(x))) notes.push('Article');
    if (p.sig.questionHeadings >= 3 && !t.has('FAQPage') && !t.has('QAPage')) notes.push(`FAQPage (${p.sig.questionHeadings} questions)`);
    if (p.sig.breadcrumbNav && !t.has('BreadcrumbList')) notes.push('BreadcrumbList');
    if (notes.length) hits.push({ url: p.url, note: notes.join(', ') });
  }
  const count = (name) => hits.filter((h) => h.note.includes(name)).length;
  if (!hits.length) return result('seo.schema-opportunities', 'pass', 'Structured data opportunities', `no page looks like an article, FAQ or breadcrumb trail without the matching markup (${plural(idx.length, 'page')})`);
  return result('seo.schema-opportunities', 'info', 'Structured data opportunities', `pages that look like they could carry more markup: Article ${count('Article')}, FAQPage ${count('FAQPage')}, BreadcrumbList ${count('BreadcrumbList')}`, {
    fix: 'Article (with datePublished, dateModified, author) on articles; BreadcrumbList where a breadcrumb trail is shown; FAQPage where a page answers several questions. Google no longer shows FAQ rich results (since May 2026), but the markup still tells AI engines which text answers which question. Mark up only what is visible on the page.',
    urls: hits,
  });
}

/**
 * seo.snippet-controls: indexable pages that keep their text out of quoted AI answers. Google applies
 * nosnippet, max-snippet and data-nosnippet to AI Overviews and AI Mode as well as to snippets
 * (developers.google.com/search/docs/crawling-indexing/robots-meta-tag). `p.snippet` and
 * `p.nosnippetWords` come from the crawl's page records.
 */
export function snippetControlsRow({ pages = [] }) {
  const T = 'Snippet controls (AI Overviews, AI Mode)';
  const idx = pages.filter((p) => p.status >= 200 && p.status < 300 && p.title !== undefined && !p.noindex);
  if (!idx.length) return result('seo.snippet-controls', 'skip', T, 'no indexable page crawled');
  const hiddenShare = (p) => (p.nosnippetWords && p.words ? p.nosnippetWords / Math.max(p.words, p.nosnippetWords) : 0);
  const blocked = idx.filter((p) => p.snippet === 'nosnippet' || p.snippet === 'max-snippet:0' || hiddenShare(p) >= 0.5);
  const limited = idx.filter((p) => !blocked.includes(p) && (/^max-snippet:\d+$/.test(p.snippet || '') || p.nosnippetWords));
  const note = (p) => [p.snippet, p.nosnippetWords ? `${p.nosnippetWords} of ${Math.max(p.words, p.nosnippetWords)} words in data-nosnippet` : ''].filter(Boolean).join('; ');
  const sent = [...new Set([...blocked, ...limited].map((p) => p.snippet).filter(Boolean))];
  const usesAttr = [...blocked, ...limited].some((p) => p.nosnippetWords);
  const what = [...sent, ...(usesAttr ? ['data-nosnippet'] : [])].join(', ');
  if (blocked.length) return result('seo.snippet-controls', 'warn', T, `${plural(blocked.length, 'indexable page')} of ${idx.length} ${blocked.length === 1 ? 'keeps its' : 'keep their'} text out of snippets and AI answers (${what})`, { fix: `Google uses neither snippets nor AI Overviews and AI Mode input from text under ${what}. Remove it from pages that should be quoted, or keep it to the parts that must not be (a price, a login box). It is the right choice only for content that should be indexed but never shown.`, urls: [...blocked, ...limited].map((p) => ({ url: p.url, note: note(p) })) });
  if (limited.length) return result('seo.snippet-controls', 'info', T, `${plural(limited.length, 'indexable page')} ${limited.length === 1 ? 'limits' : 'limit'} snippet text (${what}); AI Overviews and AI Mode quote no more than that`, { urls: limited.map((p) => ({ url: p.url, note: note(p) })) });
  return result('seo.snippet-controls', 'pass', T, `no nosnippet, max-snippet or data-nosnippet on ${plural(idx.length, 'indexable page')}`);
}

/** seo.bingbot: bingbot in robots.txt, plus whether the start page carries Bing's site verification. */
export function bingRow({ robots = {}, start = null }) {
  const parsed = robots.parsed || null;
  if (!parsed) return null;
  const blocked = !isAllowed(parsed, '/', 'bingbot');
  const verified = start?.sig?.bingVerify;
  if (blocked) return result('seo.bingbot', 'warn', 'Bing (feeds ChatGPT search and Copilot)', 'robots.txt blocks bingbot', { fix: 'Allow bingbot. ChatGPT search and Microsoft Copilot draw on Bing\'s index, so a site Bing cannot crawl is missing from them too.', urls: [{ url: '/robots.txt', note: 'bingbot: Disallow /' }] });
  return result('seo.bingbot', 'info', 'Bing (feeds ChatGPT search and Copilot)', `bingbot allowed${verified ? '; the start page carries a Bing Webmaster Tools verification tag' : '; no Bing verification tag on the start page (it may be verified by DNS or a file instead)'}`, { fix: 'Verify the site in Bing Webmaster Tools, submit the sitemap there, and turn on IndexNow (a CMS plugin, or Cloudflare Crawler Hints) so changes reach Bing, ChatGPT search and Copilot within hours. IndexNow cannot be seen from outside; ask whoever runs the site.' });
}

// ---------------------------------------------------------------- the GEO view and its score

/**
 * Rows from the other areas that decide what AI crawlers can reach and read: robots.txt, noindex,
 * the sitemap (and what it wrongly lists), canonicals, JSON-LD, titles, h1, lang.
 */
export const GEO_RELATED = new Set([
  'seo.start', 'seo.robots-txt', 'seo.noindex', 'seo.thin', 'seo.h1', 'seo.lang', 'seo.title-duplicate',
  'seo.sitemap', 'seo.sitemap-noindex', 'seo.sitemap-blocked',
  'seo.canonical-host', 'seo.canonical-target',
  'seo.jsonld-parse', 'seo.jsonld-coverage', 'seo.jsonld-client-side', 'seo.schema-validator', 'seo.rich-required',
  'seo.js-signals',
]);
export const isGeoRow = (r) => r.area === 'geo' || GEO_RELATED.has(r.id);

/**
 * Info rows that point at something missing (markup, a file, dates) rather than just describing the
 * site. They count ¾ in the score instead of a full pass, and the report lists them as opportunities.
 */
const OPPORTUNITY_IDS = new Set(['seo.llms-txt', 'seo.schema-opportunities', 'seo.freshness', 'seo.author', 'seo.sitemap-lastmod', 'seo.jsonld-coverage', 'seo.entity-markup']);
export const isOpportunity = (r) => r.status === 'info' && OPPORTUNITY_IDS.has(r.id) && Boolean(r.fix);
export const OPPORTUNITY_WEIGHT = 0.75;

/**
 * GEO readiness: 0–100 over the GEO rows (pass and plain info 1, an info opportunity ¾, warn ½,
 * fail 0; skipped rows are left out). A summary of the rows, not a prediction of AI visibility.
 * -> { score, counted, counts: { pass, info, warn, fail, skip }, opportunities: [{ id, title }] }
 *    or null when no row counts.
 */
export function geoScore(rows) {
  const geo = rows.filter(isGeoRow);
  const counts = { pass: 0, info: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of geo) counts[r.status] = (counts[r.status] || 0) + 1;
  const counted = geo.filter((r) => r.status !== 'skip');
  if (!counted.length) return null;
  const weight = (r) => (isOpportunity(r) ? OPPORTUNITY_WEIGHT : ({ pass: 1, info: 1, warn: 0.5, fail: 0 }[r.status] ?? 0));
  const pts = counted.reduce((n, r) => n + weight(r), 0);
  const opportunities = counted.filter(isOpportunity).map((r) => ({ id: r.id, title: r.title }));
  return { score: Math.round((pts / counted.length) * 100), counted: counted.length, counts, opportunities };
}
