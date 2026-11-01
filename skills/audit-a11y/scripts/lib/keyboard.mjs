// The keyboard pass: Tab through a page from the top, then read the walk for traps, missing skip
// links, invisible or obscured focus and big jumps in focus order. The walk itself needs a browser;
// `analyseWalk` is pure so it can be tested on recorded walks.
import { inPage, focusSnapshot, resetFocus, tabbableCount } from './probes.mjs';

const keyOf = (s) => (s.none ? '<document>' : s.uid ?? s.path);

/**
 * Tab up to `maxTabs` times. Stops when focus leaves the document after visiting something (the
 * normal end), or when it comes back to a stop already seen without leaving (a possible trap).
 * Then presses Escape and tries a few more Tabs to see whether the loop lets go.
 */
export async function walk(page, { maxTabs = 200 } = {}) {
  await page.eval(inPage(resetFocus));
  const expected = await page.eval(inPage(tabbableCount));
  const stops = [];
  const seen = new Map();
  let loop = null;
  let ended = 'max';
  for (let i = 0; i < maxTabs; i++) {
    await page.key('Tab');
    const s = await page.eval(inPage(focusSnapshot)).catch((e) => ({ error: e.message }));
    if (s.error) { ended = 'error'; stops.push(s); break; }
    const prev = stops[stops.length - 1];
    if (s.iframe && prev && keyOf(prev) === keyOf(s)) continue; // moving inside an iframe
    if (s.none) {
      if (stops.some((x) => !x.none)) { ended = 'left-document'; break; }
      continue;
    }
    const k = keyOf(s);
    if (seen.has(k)) {
      loop = { from: seen.get(k), to: stops.length };
      ended = 'loop';
      break;
    }
    seen.set(k, stops.length);
    stops.push(s);
  }
  let escape = null;
  if (loop) {
    await page.key('Escape');
    const cycle = new Set(stops.slice(loop.from).map(keyOf));
    escape = 'held';
    for (let i = 0; i < cycle.size + 2; i++) {
      await page.key('Tab');
      const s = await page.eval(inPage(focusSnapshot)).catch(() => ({ none: true }));
      if (s.none || !cycle.has(keyOf(s))) { escape = 'released'; break; }
    }
  }
  return { stops, expected, ended, loop, escape };
}

/** Findings from one walk: { stops, trap, skipLink, hidden, noIndicator, obscured, jumps, positiveTabindex, ... }. */
export function analyseWalk(w, { viewportHeight = 900 } = {}) {
  const stops = w.stops.filter((s) => !s.none && !s.error);
  const out = {
    count: stops.length,
    expected: w.expected,
    ended: w.ended,
    trap: null,
    skipLink: null,
    hidden: [],
    customControls: [],
    noIndicator: [],
    obscured: [],
    jumps: [],
    overlay: null,
    positiveTabindex: stops.filter((s) => Number(s.tabindex) > 0).map(slim),
  };
  if (w.loop) {
    const cycle = w.stops.slice(w.loop.from).filter((s) => !s.none);
    const dialog = cycle.find((s) => s.inDialog)?.inDialog || null;
    const wholePage = w.loop.from === 0 && cycle.length >= stops.length * 0.9;
    out.trap = {
      size: cycle.length,
      dialog,
      wholePage,
      released: w.escape === 'released',
      stops: cycle.slice(0, 8).map(slim),
      // A modal that keeps focus is fine when Escape (or a close button) lets go.
      verdict: w.escape === 'released' ? 'contained' : dialog ? 'modal-held' : wholePage ? 'wraps' : 'trap',
    };
  }
  // The first stop outside a cookie banner: banners often come first in the DOM, by design.
  const first = stops.find((s) => !s.inConsent) || stops[0];
  if (first) {
    const isSkip = first.tag === 'a' && /^#./.test(first.href || '') && /skip|spring|gå til|hop|main|indhold|content|hovedindhold/i.test(`${first.name} ${first.href}`);
    out.skipLink = { found: isSkip, first: slim(first) };
  }
  for (const s of stops) {
    // A visually hidden native checkbox or radio styled through its label is a common, valid
    // pattern; whether the label shows focus needs a person.
    if (!s.visible && s.customControl) out.customControls.push(slim(s));
    else if (!s.visible) out.hidden.push(slim(s));
    else if (!s.indicator) out.noIndicator.push(slim(s));
    if (s.visible && s.obscuredBy) out.obscured.push({ ...slim(s), by: s.obscuredBy });
  }
  // One element covering most of the walk is an overlay left open (usually the cookie banner):
  // report it once instead of once per covered stop.
  const by = {};
  for (const o of out.obscured) by[o.by] = (by[o.by] || 0) + 1;
  const [top, n] = Object.entries(by).sort((a, b) => b[1] - a[1])[0] || [];
  if (top && n >= 5 && n >= stops.filter((s) => s.visible).length * 0.5) {
    out.overlay = { by: top, count: n, consent: /cookie|consent|coi|cmp|onetrust|cookiebot|usercentrics|didomi|gdpr|samtykke/i.test(top) };
    out.obscured = out.obscured.filter((o) => o.by !== top);
  }
  // Focus going back up the page by more than a screen, between two visible stops.
  const visible = stops.filter((s) => s.visible && s.h > 0);
  for (let i = 1; i < visible.length; i++) {
    const a = visible[i - 1]; const b = visible[i];
    if (a.y - b.y > viewportHeight) out.jumps.push({ from: slim(a), to: slim(b), up: a.y - b.y });
  }
  return out;
}

const slim = (s) => ({ path: s.path, tag: s.tag, name: s.name, html: s.html });
