// Turns per-page results into site-wide issues (one per rule, with every page it fails on),
// review items, a status per WCAG criterion, and the tasks.json draft audit-all's fix plan reads.
import { CRITERIA, criteriaFor, enClause, scFromAxeTags, scFromHtmlcsCode, scLabel } from './wcag.mjs';

export const SEVERITIES = ['blocker', 'high', 'medium', 'low'];
const AXE_SEVERITY = { critical: 'high', serious: 'high', moderate: 'medium', minor: 'low' };
const MAX_SAMPLES = 6;

// Rules an agent can fix with a local, mechanical edit.
const HAIKU_RULES = new Set(['html-has-lang', 'html-lang-valid', 'html-xml-lang-mismatch', 'valid-lang', 'document-title', 'meta-viewport', 'meta-viewport-large', 'frame-title', 'input-image-alt', 'image-alt', 'role-img-alt', 'svg-img-alt', 'area-alt', 'object-alt', 'duplicate-id', 'duplicate-id-aria', 'meta-refresh']);

// Concrete fixes for the rules that come up most; the rest get axe's help text and link.
const FIX = {
  'color-contrast': 'Raise the contrast of the listed text to at least 4.5:1 (3:1 for 24px+ or 19px+ bold text). Fix it in the design tokens or the shared CSS rather than per element, and check hover, focus and disabled states too.',
  'image-alt': 'Give each image an alt that says what it shows or does; decorative images get alt="". Check that CMS image fields require alt text.',
  'link-name': 'Give each link text that says where it goes: visible text, or aria-label on icon-only links (and aria-hidden="true" on the icon).',
  'button-name': 'Give each button an accessible name: visible text, or aria-label on icon-only buttons.',
  label: 'Associate a visible <label for> with each form field (or wrap it); placeholder text is not a label.',
  'select-name': 'Associate a visible <label for> with each select.',
  'html-has-lang': 'Set lang on <html> to the page language (lang="da", lang="en").',
  'html-lang-valid': 'Use a valid BCP 47 code in <html lang> (da, en, en-GB).',
  'document-title': 'Give every page a unique, descriptive <title>.',
  'meta-viewport': 'Remove maximum-scale and user-scalable=no from the viewport meta tag so users can zoom.',
  'meta-viewport-large': 'Remove maximum-scale from the viewport meta tag, or set it to 5 or more.',
  'heading-order': 'Keep heading levels in order (h1, h2, h3) without skipping; style with CSS instead of picking a level for its size.',
  'landmark-one-main': 'Wrap the main content in one <main> element.',
  region: 'Put all content inside landmarks (<header>, <nav>, <main>, <footer>).',
  bypass: 'Add a "Skip to content" link as the first focusable element, pointing at <main id="…">.',
  'aria-allowed-attr': 'Remove ARIA attributes the element\'s role does not support.',
  'aria-required-children': 'Give the role the child roles it needs (a role="list" needs role="listitem" children), or use native HTML.',
  'aria-hidden-focus': 'Content inside aria-hidden="true" must not be focusable: add tabindex="-1" or inert, or drop aria-hidden.',
  'nested-interactive': 'Do not put links or buttons inside other links or buttons; restructure the card so one element is interactive.',
  'target-size': 'Make touch targets at least 24×24 CSS px, or space them so a 24px circle around each does not overlap its neighbours.',
  'list': 'Only <li> (or script/template) inside <ul> and <ol>.',
  'listitem': 'Put <li> elements inside a <ul> or <ol>.',
  'frame-title': 'Give each iframe a title that says what it holds.',
  'duplicate-id-aria': 'Make IDs referenced by aria-labelledby, aria-describedby or label[for] unique.',
  'scrollable-region-focusable': 'Make scrollable regions keyboard-reachable: tabindex="0" plus a role and a label.',
  'autocomplete-valid': 'Use valid autocomplete tokens on personal-data fields (name, email, tel, street-address).',
};

const severityRank = (s) => SEVERITIES.indexOf(s);
const lower = (s) => SEVERITIES[Math.min(severityRank(s) + 1, SEVERITIES.length - 1)];

function addIssue(map, key, base, page, nodes, count) {
  const issue = map.get(key) || map.set(key, { key, ...base, pages: [], count: 0, samples: [] }).get(key);
  if (!issue.pages.includes(page)) issue.pages.push(page);
  issue.count += count ?? nodes.length;
  for (const n of nodes) if (issue.samples.length < MAX_SAMPLES) issue.samples.push({ page, ...n });
  return issue;
}

/**
 * pages: [{ url, error?, axe?, htmlcs?, keyboard?, reflow?, textSpacing? }]
 * Returns { issues, review, bestPractice, criteria, counts }.
 */
export function aggregate(pages, { level = 'AA', axeCoverage = [], statement = null, startUrl = null } = {}) {
  const issues = new Map();
  const review = new Map();
  const best = new Map();
  for (const p of pages) {
    if (p.error) continue;
    const axeScOnPage = new Set();
    for (const v of p.axe?.violations || []) {
      const sc = scFromAxeTags(v.tags);
      const target = sc.length ? issues : best;
      sc.forEach((s) => axeScOnPage.add(s));
      addIssue(target, `axe:${v.id}`, {
        engine: 'axe-core', rule: v.id, title: v.help, description: v.description, helpUrl: v.helpUrl,
        impact: v.impact, severity: AXE_SEVERITY[v.impact] || 'medium', sc,
        fix: FIX[v.id] || `${v.description}. See ${v.helpUrl}`,
      }, p.url, v.nodes, v.count);
    }
    for (const v of p.axe?.incomplete || []) {
      addIssue(review, `axe:${v.id}`, { engine: 'axe-core', rule: v.id, title: v.help, helpUrl: v.helpUrl, sc: scFromAxeTags(v.tags), why: 'axe could not decide automatically' }, p.url, v.nodes, v.count);
    }
    for (const e of p.htmlcs?.errors || []) {
      const sc = scFromHtmlcsCode(e.code);
      if (sc && axeScOnPage.has(sc)) continue; // axe already fails this criterion here
      const technique = String(e.code).split('.').slice(4).join('.');
      const generic = genericMessage(e.msg);
      // 4.1.1 Parsing is obsolete in WCAG 2.2 (EN 301 549 v3.2.1 still lists it): best practice.
      addIssue(sc === '4.1.1' ? best : issues, `htmlcs:${sc}:${technique}`, {
        engine: 'HTML_CodeSniffer', rule: e.code, title: generic.split(/(?<=\.)\s/)[0].slice(0, 140), description: generic,
        helpUrl: sc ? `https://www.w3.org/WAI/WCAG22/Understanding/${slug(sc)}` : null,
        impact: null, severity: 'medium', sc: sc ? [sc] : [], fix: e.msg,
      }, p.url, e.nodes, e.count);
    }
    const k = p.keyboard;
    if (k) {
      if (k.trap?.verdict === 'trap') {
        addIssue(issues, 'kbd:trap', {
          engine: 'keyboard', rule: 'keyboard-trap', title: 'Keyboard focus gets stuck', severity: 'blocker', sc: ['2.1.2'],
          description: `Tab cycles between ${k.trap.size} elements and never leaves them; Escape does not release it.`,
          fix: 'Find the script that moves focus back (a focus-trap library, a carousel or a menu that is not open) and only trap focus inside an open modal, releasing it on Escape and on close.',
        }, p.url, k.trap.stops.map(node));
      } else if (k.trap?.verdict === 'modal-held') {
        addIssue(review, 'kbd:modal', { engine: 'keyboard', rule: 'modal-holds-focus', title: 'A dialog holds focus and Escape does not close it', sc: ['2.1.2'], why: 'fine if a close button in the dialog works from the keyboard; check it' }, p.url, k.trap.stops.slice(0, 3).map(node));
      } else if (k.trap?.verdict === 'contained') {
        addIssue(review, 'kbd:loop', { engine: 'keyboard', rule: 'focus-loop', title: 'Tab cycles inside a component until Escape is pressed', sc: ['2.1.2', '2.4.3'], why: 'often a carousel that moves focus back to its first slide; check that Tab alone can move past it' }, p.url, k.trap.stops.slice(0, 3).map(node));
      } else if (k.trap?.verdict === 'wraps') {
        addIssue(review, 'kbd:wraps', { engine: 'keyboard', rule: 'focus-wraps', title: 'Tab wraps from the last element to the first without leaving the page', sc: ['2.1.2'], why: 'users can still leave with the browser\'s own keys, but it is unusual' }, p.url, []);
      }
      if (k.noIndicator.length) {
        addIssue(issues, 'kbd:no-indicator', {
          engine: 'keyboard', rule: 'focus-not-visible', title: 'No visible focus indicator', severity: 'high', sc: ['2.4.7'],
          description: 'These elements look the same focused as unfocused: no outline, shadow, border or colour change.',
          fix: 'Remove outline: none / outline: 0 without a replacement, and add a :focus-visible style (for example outline: 2px solid currentColor; outline-offset: 2px) in the shared CSS.',
        }, p.url, k.noIndicator.map(node));
      }
      if (k.hidden.length) {
        addIssue(issues, 'kbd:hidden', {
          engine: 'keyboard', rule: 'focus-hidden', title: 'Focus moves to elements you cannot see', severity: 'medium', sc: ['2.4.7', '2.4.3'],
          description: 'Tab lands on elements that are off-screen, zero-sized, transparent or hidden, usually links in a closed menu or slider.',
          fix: 'Hide closed menus, off-screen slides and collapsed panels with display: none, the hidden attribute or inert, not just transform, opacity or off-screen positioning.',
        }, p.url, k.hidden.map(node));
      }
      if (k.obscured.length) {
        addIssue(issues, 'kbd:obscured', {
          engine: 'keyboard', rule: 'focus-obscured', title: 'Focused elements are covered by other content', severity: 'medium', sc: ['2.4.11'],
          description: 'The focused element\'s centre is covered by another element, typically a sticky header or a cookie banner.',
          fix: 'Add scroll-padding-top equal to the sticky header height on html, and make sure cookie banners and chat widgets do not cover focused content (or take focus while open).',
        }, p.url, k.obscured.map((s) => ({ ...node(s), summary: `covered by ${s.by}` })));
      }
      if (k.overlay) {
        addIssue(review, 'kbd:overlay', {
          engine: 'keyboard', rule: 'overlay-covers-focus', title: k.overlay.consent ? 'The cookie banner covers the page while Tab moves behind it' : 'An overlay covers the page while Tab moves behind it', sc: ['2.4.11', '2.4.3'],
          why: `${k.overlay.count} focused elements were under ${k.overlay.by}. A banner that takes focus while open, or does not cover content, avoids this; the other keyboard results ran with it open`,
        }, p.url, [{ target: k.overlay.by, summary: `covers ${k.overlay.count} focused elements` }], k.overlay.count);
      }
      if (k.customControls?.length) {
        addIssue(review, 'kbd:custom-controls', { engine: 'keyboard', rule: 'custom-control-focus', title: 'Custom checkboxes or radios: the real input is hidden', sc: ['2.4.7'], why: 'check that the visible control shows focus' }, p.url, k.customControls.map(node));
      }
      if (k.skipLink && !k.skipLink.found) {
        addIssue(review, 'kbd:skip', { engine: 'keyboard', rule: 'no-skip-link', title: 'First Tab stop is not a skip link', sc: ['2.4.1'], why: 'landmarks can satisfy 2.4.1, but a skip link is what keyboard users expect' }, p.url, [node(k.skipLink.first)]);
      }
      for (const j of k.jumps.slice(0, 2)) {
        addIssue(review, 'kbd:jump', { engine: 'keyboard', rule: 'focus-order-jump', title: 'Focus order jumps back up the page', sc: ['2.4.3'], why: 'check that the order still makes sense' }, p.url, [{ ...node(j.to), summary: `after ${j.from.path}, ${j.up}px higher` }]);
      }
    }
    if (p.reflow?.overflow) {
      addIssue(issues, 'reflow', {
        engine: 'layout', rule: 'reflow-320', title: 'Content scrolls sideways at 320 px width', severity: 'medium', sc: ['1.4.10'],
        description: `At 320 CSS px (400% zoom on a 1280 px screen) the page is ${p.reflow.scrollWidth}px wide.`,
        fix: 'Find the fixed-width or non-wrapping elements listed (min-width, white-space: nowrap, wide images, 100vw plus padding) and let them shrink or wrap; tables and code may scroll inside their own container.',
      }, p.url, p.reflow.wide.map((w) => ({ target: w.target, summary: `${w.width}px wide, ends at ${w.right}px` })));
    }
    if (p.textSpacing?.clipped) {
      addIssue(review, 'text-spacing', { engine: 'layout', rule: 'text-spacing', title: 'Text may be clipped with increased text spacing', sc: ['1.4.12'], why: 'containers with overflow hidden now hold more text than fits; look at them with the spacing applied' }, p.url, p.textSpacing.samples.map((s) => ({ target: s.target, summary: s.text })), p.textSpacing.clipped);
    }
  }
  if (startUrl && statement === null) {
    review.set('statement', { key: 'statement', engine: 'page', rule: 'accessibility-statement', title: 'No link to an accessibility statement on the start page', sc: [], why: 'required for Danish public bodies (was.digst.dk) and expected under the European Accessibility Act', pages: [startUrl], count: 1, samples: [] });
  }

  const issueList = [...issues.values()].map(finish).sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.pages.length - a.pages.length || b.count - a.count);
  issueList.forEach((i, n) => { i.id = `A${n + 1}`; });
  const reviewList = [...review.values()].map(finish).sort((a, b) => b.pages.length - a.pages.length || b.count - a.count);
  const bestList = [...best.values()].map((b) => ({ ...finish(b), severity: lower(b.severity) })).sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count);

  const failed = new Set(issueList.flatMap((i) => i.sc));
  const toReview = new Set(reviewList.flatMap((i) => i.sc));
  const automated = new Set([...axeCoverage, '2.1.2', '2.4.7', '2.4.11', '1.4.10']);
  const criteria = criteriaFor(level).map((c) => ({
    ...c,
    en: enClause(c.sc),
    status: failed.has(c.sc) ? 'fail' : toReview.has(c.sc) ? 'review' : automated.has(c.sc) ? 'pass' : 'manual',
    issues: issueList.filter((i) => i.sc.includes(c.sc)).map((i) => i.id),
  }));

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, issueList.filter((i) => i.severity === s).length]));
  const counts = {
    issues: issueList.length,
    ...bySeverity,
    review: reviewList.length,
    bestPractice: bestList.length,
    criteriaFailed: criteria.filter((c) => c.status === 'fail').length,
    criteriaReview: criteria.filter((c) => c.status === 'review').length,
    elements: issueList.reduce((n, i) => n + i.count, 0),
    pages: pages.filter((p) => !p.error).length,
    pagesFailed: pages.filter((p) => p.error).length,
  };
  return { issues: issueList, review: reviewList, bestPractice: bestList, criteria, counts };
}

/** HTML_CodeSniffer messages quote element-specific values ("…" ids, ratios); drop them for a rule title. */
export const genericMessage = (msg) => String(msg).replace(/\s+/g, ' ').replace(/"([^"]{21,}|[^"]*\d[^"]*)"/g, '"…"').replace(/ratio of at least ([\d.]+:1), but text in this element has a contrast ratio of [\d.]+:1/, 'ratio of at least $1').trim();

function finish(i) {
  return { ...i, en: (i.sc || []).map(enClause).filter(Boolean) };
}

const node = (s) => ({ target: s.path, html: s.html, summary: s.name ? `"${s.name}"` : '' });

const slug = (sc) => (CRITERIA[sc]?.name || sc).toLowerCase().replace(/\(|\)|,/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const understandingUrl = (sc) => `https://www.w3.org/WAI/WCAG22/Understanding/${slug(sc)}`;

/**
 * The fix-plan draft in audit-all's tasks.json shape: one task per issue. Without `repo` the tasks
 * are for a person (audit-all turns them into agent tasks when a repo holds the templates).
 */
export function toTasks(issues, { subject, repo = null, repoPath = null } = {}) {
  const tasks = issues.map((i) => {
    const pages = i.pages.length;
    const where = i.samples.slice(0, 3).map((s) => s.target).filter(Boolean).map((t) => `\`${t}\``).join(', ');
    const t = {
      id: i.id,
      title: `${i.title}${i.sc.length ? ` (WCAG ${i.sc.join(', ')})` : ''}`,
      severity: i.severity,
      owner: repo ? 'agent' : 'human',
      sources: ['a11y'],
      area: 'accessibility',
      evidence: `${i.count} element${i.count === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'} (${i.engine}${i.rule ? `: ${i.rule}` : ''})${where ? `, for example ${where}` : ''}. First seen on ${i.pages[0]}.`,
      fix: i.fix,
      verify: `Re-run a11y-audit on ${i.pages.slice(0, 3).join(', ')}${pages > 3 ? ' and the rest' : ''}: ${i.rule || i.key} no longer reported.`,
      refs: ['a11y-audit/report.md'],
    };
    if (repo) {
      t.repo = repo;
      t.model = HAIKU_RULES.has(i.rule) ? 'haiku' : 'sonnet';
    }
    return t;
  });
  return { subject, ...(repo && repoPath ? { repos: { [repo]: repoPath } } : {}), tasks };
}

export { scLabel };
