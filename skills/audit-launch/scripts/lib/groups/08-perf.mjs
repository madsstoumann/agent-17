/**
 * 8. Performance — Lighthouse (local or PageSpeed Insights) on the start URL
 * mobile + desktop and on a few sampled pages, so a slow template does not hide
 * behind a fast homepage.
 */
import { result } from '../registry.mjs';
import { scoreVerdict, cwvRating } from '../lighthouse.mjs';

const RATING = { pass: 'good', warn: 'needs improvement', fail: 'poor' };
const fmtScores = (s, { annotateSeo }) => `Perf ${s.scores.performance ?? 'n/a'} · A11y ${s.scores.accessibility ?? 'n/a'} · Best practices ${s.scores.bestPractices ?? 'n/a'} · SEO ${s.scores.seo ?? 'n/a'}${s.seoNoindexAffected ? (annotateSeo ? ' (depressed by noindex — expected on dev; re-run on production)' : ' (page is noindex)') : ''}${s.agentic ? ` · Agentic ${s.agentic.passed}/${s.agentic.total}` : ''}`;
const fmtMetric = (m) => (m && m.display != null ? m.display : 'n/a');

function scoreboardEntry(s) {
  if (!s) return null;
  return { performance: s.scores.performance, accessibility: s.scores.accessibility, bestPractices: s.scores.bestPractices, seo: s.scores.seo, agentic: s.agentic ? `${s.agentic.passed}/${s.agentic.total}` : null, seoNoindexAffected: Boolean(s.seoNoindexAffected) };
}

export default {
  id: 'perf',
  title: 'Performance',
  phase: 'C',
  budget: 30000,
  async run(ctx) {
    const { lh, production } = ctx;
    const out = [];
    const annotateSeo = !production;
    ctx.scoreboard.lighthouse = { runner: lh?.runner || 'off', version: lh?.version || null, mobile: scoreboardEntry(lh?.mobile), desktop: scoreboardEntry(lh?.desktop) };
    if (!lh || lh.runner === 'off' || (!lh.mobile && !lh.desktop)) {
      const why = lh?.errors?.length ? lh.errors.join('; ') : ctx.opts.lighthouse === 'off' ? '--lighthouse off' : 'no Lighthouse result';
      out.push(result('perf.lighthouse-mobile', 'skip', 'Lighthouse (mobile)', why, { fix: 'Install Chrome or set PSI_API_KEY (free Google Cloud key for the PageSpeed Insights API) and re-run.' }));
      return out;
    }
    const src = lh.runner === 'psi' ? 'PageSpeed Insights API' : `local Lighthouse ${lh.version || ''}`.trim();
    for (const [key, s, label] of [['mobile', lh.mobile, 'Lighthouse (mobile)'], ['desktop', lh.desktop, 'Lighthouse (desktop)']]) {
      if (!s) { out.push(result(`perf.lighthouse-${key}`, 'skip', label, lh.errors.find((e) => e.includes(key)) || 'no result')); continue; }
      const v = scoreVerdict(s.scores.performance) || 'info';
      out.push(result(`perf.lighthouse-${key}`, v, label, `${fmtScores(s, { annotateSeo })} — ${src}`, { fix: v === 'pass' ? '' : 'See the opportunities row; LCP and TBT are usually image delivery, render-blocking CSS/JS and third-party scripts.', link: lh.runner === 'psi' ? `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(ctx.finalUrl)}&form_factor=${key}` : undefined }));
    }
    const m = lh.mobile || lh.desktop;
    const lab = {};
    let worst = 'pass';
    for (const k of ['LCP', 'CLS', 'TBT', 'INP', 'FCP', 'SI']) {
      const mm = m.metrics?.[k];
      if (!mm || mm.value == null) continue;
      const r = cwvRating(k, mm.value);
      lab[k] = { value: mm.value, display: mm.display, rating: r };
      if (r === 'fail') worst = 'fail'; else if (r === 'warn' && worst !== 'fail') worst = 'warn';
    }
    ctx.scoreboard.cwvLab = { LCP: lab.LCP, CLS: lab.CLS, TBT: lab.TBT, ...(lab.INP ? { INP: lab.INP } : {}) };
    out.push(result('perf.cwv-lab', worst, 'Core Web Vitals (lab, mobile)', ['LCP', 'CLS', 'TBT', 'FCP', 'SI'].filter((k) => lab[k]).map((k) => `${k} ${lab[k].display} (${RATING[lab[k].rating]})`).join(' · ') || 'no metrics', { fix: worst === 'pass' ? '' : 'Targets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms (INP ≤ 200 ms in the field).' }));
    if (m.field) {
      const f = m.field;
      const fm = {};
      for (const k of ['LCP', 'INP', 'CLS', 'FCP', 'TTFB']) if (f[k]?.p75 != null) fm[k] = { display: `${k === 'CLS' ? f[k].p75 / 100 : `${f[k].p75} ms`}`, rating: f[k].category === 'FAST' ? 'pass' : f[k].category === 'AVERAGE' ? 'warn' : 'fail' };
      ctx.scoreboard.cwvField = { metrics: fm, overall: f.overall };
      out.push(result('perf.cwv-field', f.overall === 'FAST' ? 'pass' : f.overall === 'AVERAGE' ? 'warn' : f.overall ? 'fail' : 'info', 'Core Web Vitals (field, CrUX)', Object.entries(fm).map(([k, v]) => `${k} ${v.display} (${RATING[v.rating]})`).join(' · ') + (f.overall ? ` — overall ${f.overall}` : ''), { fix: '' }));
    } else {
      ctx.scoreboard.cwvField = null;
      out.push(result('perf.cwv-field', 'info', 'Core Web Vitals (field, CrUX)', lh.runner === 'psi' ? 'no field data yet (not enough Chrome traffic on this URL — normal before launch)' : 'not available from a local run; set PSI_API_KEY to get CrUX field data'));
    }
    if (m.opportunities?.length) {
      out.push(result('perf.opportunities', 'info', 'Top opportunities (mobile)', m.opportunities.slice(0, 8).map((o) => `${o.title}${o.displayValue ? ` — ${o.displayValue}` : o.savingsMs ? ` — ~${Math.round(o.savingsMs)} ms` : ''}`).join(' · '), { data: { opportunities: m.opportunities } }));
    }
    if (m.thirdParties?.length) {
      const blocking = m.thirdParties.reduce((a, t) => a + (t.blockingMs || 0), 0);
      out.push(result('perf.third-parties', blocking > 250 ? 'warn' : 'info', 'Third-party cost', `${m.thirdParties.length} third parties, ${Math.round(blocking)} ms main-thread blocking: ${m.thirdParties.slice(0, 6).map((t) => `${t.entity}${t.blockingMs ? ` ${Math.round(t.blockingMs)} ms` : ''}`).join(', ')}`, { fix: blocking > 250 ? 'Load tag managers, chat widgets and embeds after consent/interaction, or facade them.' : '' }));
    }
    for (const p of lh.pages || []) {
      const s = p.summary;
      const v = scoreVerdict(s.scores.performance) || 'info';
      out.push(result('perf.page', v, 'Lighthouse (page, mobile)', fmtScores(s, { annotateSeo }), { subject: p.url, fix: v === 'pass' ? '' : (s.opportunities?.[0] ? `Start with: ${s.opportunities[0].title}` : '') }));
    }
    if (m.agentic) {
      const a = m.agentic;
      const states = Object.entries(a.audits || {}).map(([id, x]) => `${id}: ${x.score === 1 ? 'pass' : x.score === 0 ? 'fail' : x.displayValue || 'n/a'}`).join(' · ');
      out.push(result('perf.agentic', 'info', 'Agentic browsing (Lighthouse)', `${a.passed}/${a.total} — ${states}`, { fix: 'Experimental category: an llms.txt and a clean accessibility tree help AI agents; not a launch requirement.' }));
    }
    if (lh.errors?.length) out.push(result('perf.notes', 'info', 'Lighthouse notes', lh.errors.join('; ')));
    return out;
  },
};
