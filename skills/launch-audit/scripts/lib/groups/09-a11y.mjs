/**
 * 9. Accessibility — Lighthouse's automated checks per audited page (they
 * catch roughly a third of real issues) plus the manual pass that catches the rest.
 */
import { result } from '../registry.mjs';
import { scoreVerdict } from '../lighthouse.mjs';

const MANUAL = [
  ['keyboard', 'Keyboard-only pass', 'Tab through the main flows: every control reachable, focus visible, no traps, Escape closes overlays.'],
  ['skip-link', 'Skip link and landmarks', 'A "skip to content" link is the first Tab stop; header/nav/main/footer landmarks exist once.'],
  ['screen-reader', 'Screen reader pass', 'VoiceOver (macOS) or NVDA on the homepage, a form and a card list: headings, labels, image alternatives make sense read aloud.'],
  ['zoom', '200 % zoom / 320 px width', 'Nothing clipped, no horizontal scroll, text reflows.'],
  ['motion', 'Reduced motion', 'prefers-reduced-motion stops autoplaying carousels, parallax and video.'],
  ['forms', 'Forms', 'Every input has a visible label, errors are announced and described in text, not colour alone.'],
  ['contrast-states', 'Contrast in every state', 'Hover, focus and disabled states also meet 4.5:1 / 3:1 — Lighthouse tests the resting state only.'],
];

const failing = (s) => (s?.failingAudits?.accessibility || []).slice(0, 8).map((a) => `${a.title}${a.count ? ` (${a.count})` : ''}`).join(' · ');

export default {
  id: 'a11y',
  title: 'Accessibility',
  phase: 'C',
  budget: 15000,
  async run(ctx) {
    const { lh } = ctx;
    const out = [];
    const m = lh?.mobile || lh?.desktop;
    if (!m) {
      out.push(result('a11y.lighthouse', 'skip', 'Lighthouse accessibility', lh?.errors?.length ? lh.errors.join('; ') : 'no Lighthouse result'));
    } else {
      const score = m.scores.accessibility;
      const v = score == null ? 'info' : score >= 90 ? 'pass' : 'warn';
      out.push(result('a11y.lighthouse', v, 'Lighthouse accessibility (start page)', `${score ?? 'n/a'}/100${failing(m) ? ` — failing: ${failing(m)}` : ''}`, { fix: v === 'pass' ? '' : 'Fix the listed audits first (alt text, contrast, link names, form labels are the usual four), then do the manual pass.' }));
      for (const p of lh.pages || []) {
        const s = p.summary; const sc = s.scores.accessibility;
        out.push(result('a11y.page', sc == null ? 'info' : sc >= 90 ? 'pass' : 'warn', 'Lighthouse accessibility (page)', `${sc ?? 'n/a'}/100${failing(s) ? ` — ${failing(s)}` : ''}`, { subject: p.url }));
      }
    }
    for (const [id, title, text] of MANUAL) out.push(result(`a11y.manual-${id}`, 'info', title, text));
    out.push(result('a11y.eaa', 'info', 'European Accessibility Act', 'In force since 28 June 2025 for consumer-facing services in the EU: WCAG 2.1 AA (EN 301 549) is the expected bar, and an accessibility statement page is customary.', { link: 'https://www.w3.org/WAI/standards-guidelines/wcag/' }));
    return out;
  },
};
