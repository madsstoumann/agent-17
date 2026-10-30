// Functions that run inside the audited page. Each is serialised with `inPage(fn, arg)` and
// evaluated over CDP, so they must not close over anything in this module.

/** `(fn)(arg)` as an expression for Runtime.evaluate. */
export const inPage = (fn, arg) => `(${fn})(${JSON.stringify(arg ?? null)})`;

/** Defines window.__a11yPath(el): a short, stable CSS path for an element. Run once per page. */
export function installHelpers() {
  if (window.__a11yPath) return true;
  window.__a11yPath = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 12) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift(`#${node.id}`); break; }
      let part = node.localName;
      const cls = [...node.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) part += `.${cls.join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === node.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (parts.length >= 4) { try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch { /* odd class */ } }
      node = parent;
    }
    return parts.join(' > ');
  };
  // Element identity for the keyboard walk: paths can repeat across look-alike components.
  const ids = new WeakMap();
  let next = 0;
  window.__a11yUid = (el) => { if (!ids.has(el)) ids.set(el, ++next); return ids.get(el); };
  // The outermost fixed or sticky box around an element: what a banner or header "is".
  window.__a11yFixedRoot = (el) => {
    let found = null;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (/fixed|sticky/.test(getComputedStyle(n).position)) found = n;
    return found;
  };
  window.__a11yConsent = (el) => !!el && /cookie|consent|coi|cmp|onetrust|cookiebot|usercentrics|didomi|gdpr|samtykke/i.test(`${el.id} ${el.className} ${el.getAttribute('aria-label') || ''}`);
  window.__a11ySnippet = (el) => (el && el.outerHTML ? el.outerHTML.replace(/\s+/g, ' ').slice(0, 220) : null);
  return true;
}

/** Run axe-core (already injected) with the given tags; returns violations and incompletes, trimmed. */
export async function runAxe({ tags, maxNodes }) {
  const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
  const trim = (list) => list.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    description: v.description,
    helpUrl: v.helpUrl,
    tags: v.tags,
    count: v.nodes.length,
    nodes: v.nodes.slice(0, maxNodes).map((n) => ({
      target: n.target.flat().join(' '),
      html: String(n.html || '').replace(/\s+/g, ' ').slice(0, 220),
      summary: String(n.failureSummary || '').replace(/^Fix (any|all) of the following:\s*/i, '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' / '),
    })),
  }));
  return { violations: trim(r.violations), incomplete: trim(r.incomplete), passes: r.passes ? r.passes.length : null };
}

/** Run HTML_CodeSniffer (already injected) for a standard; returns errors and a warning summary. */
export function runHtmlcs({ standard, maxNodes }) {
  return new Promise((resolve) => {
    window.HTMLCS.process(standard, document, () => {
      const msgs = window.HTMLCS.getMessages();
      const group = (type) => {
        const by = {};
        for (const m of msgs.filter((x) => x.type === type)) {
          // HTML_CodeSniffer does not decode the fragment: href="#%C3%A5rskort" points at id="årskort".
          if (/NoSuchID$/.test(m.code) && m.element && m.element.hash) {
            try { if (document.getElementById(decodeURIComponent(m.element.hash.slice(1)))) continue; } catch { /* bad escape */ }
          }
          const g = by[m.code] || (by[m.code] = { code: m.code, msg: m.msg, count: 0, nodes: [] });
          g.count++;
          if (g.nodes.length < maxNodes && m.element && m.element.nodeType === 1) g.nodes.push({ target: window.__a11yPath(m.element), html: window.__a11ySnippet(m.element) });
        }
        return Object.values(by);
      };
      resolve({ errors: group(1), warnings: group(2) });
    }, () => resolve({ errors: [], warnings: [], failed: true }));
  });
}

/** Where focus is now, with what a keyboard user would see. */
export async function focusSnapshot() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { none: true };
  if (el.localName === 'iframe') return { iframe: true, uid: window.__a11yUid(el), path: window.__a11yPath(el), tag: 'iframe' };
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const seen = () => {
    const box = el.getBoundingClientRect();
    let faded = false;
    for (let n = el; n && n !== document.body; n = n.parentElement) { const st = getComputedStyle(n); if (Number(st.opacity) <= 0.05 || st.visibility === 'hidden') { faded = true; break; } }
    return { box, ok: box.width > 0 && box.height > 0 && !faded && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth };
  };
  let v = seen();
  // Scroll-triggered fade-ins start when the element scrolls into view: give them a moment.
  if (!v.ok) { await new Promise((res) => setTimeout(res, 700)); v = seen(); }
  const r = v.box;
  const visible = v.ok;
  const cs = getComputedStyle(el);
  const name = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.value || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  // Focus indicator: compare the focused look with the same element blurred.
  const look = (e) => {
    const s = getComputedStyle(e); const b = getComputedStyle(e, '::before'); const a = getComputedStyle(e, '::after');
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderWidth, s.backgroundColor, s.color, s.textDecorationLine, s.transform, b.content, b.boxShadow, b.backgroundColor, b.borderColor, a.content, a.boxShadow, a.backgroundColor, a.borderColor].join('|');
  };
  const focused = look(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  let changes = outline;
  if (!outline) {
    const keep = el;
    keep.blur();
    const blurred = look(keep);
    keep.focus({ preventScroll: true });
    changes = blurred !== focused || document.activeElement !== keep;
  }
  // Obscured: what sits on top of the element's centre (sticky headers, cookie banners).
  let obscuredBy = null;
  if (visible) {
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      const root = window.__a11yFixedRoot(top);
      obscuredBy = window.__a11yPath(root && !root.contains(el) ? root : top);
    }
  }
  const fixed = window.__a11yFixedRoot(el);
  const inConsent = window.__a11yConsent(fixed) || window.__a11yConsent(el.closest('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]'));
  const customControl = el.localName === 'input' && /^(checkbox|radio)$/.test(el.type) && !!(el.labels && el.labels.length);
  const dialog = el.closest('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
  return {
    uid: window.__a11yUid(el),
    path: window.__a11yPath(el),
    tag: el.localName,
    inConsent,
    role: el.getAttribute('role'),
    name,
    href: el.getAttribute('href'),
    tabindex: el.getAttribute('tabindex'),
    x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height),
    visible,
    customControl,
    indicator: changes,
    obscuredBy,
    inDialog: dialog ? window.__a11yPath(dialog) : null,
    html: window.__a11ySnippet(el),
  };
}

/** Reset focus to the top of the document before a tab walk. */
export function resetFocus() {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  window.scrollTo(0, 0);
  const t = document.createElement('div');
  t.tabIndex = -1;
  t.setAttribute('data-a11y-audit-start', '');
  t.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;';
  document.body.prepend(t);
  t.focus();
  t.remove();
  return true;
}

/** Count of what should be reachable by Tab (a rough tabbable query). */
export function tabbableCount() {
  const sel = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable=""], [contenteditable="true"], [tabindex]';
  return [...document.querySelectorAll(sel)].filter((el) => {
    if (el.disabled || el.getAttribute('tabindex') === '-1' || el.closest('[inert]')) return false;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden';
  }).length;
}

/** WCAG 1.4.10 at the current viewport: horizontal overflow and the elements that cause it. */
export function reflowCheck() {
  const vw = document.documentElement.clientWidth;
  const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  // html and body may be overflow: hidden while a cookie banner locks scrolling; they do not count.
  const scrollsX = (e) => { for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  const wide = [];
  if (sw > vw + 1) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0 && r.height > 0 && !scrollsX(el) && !['table', 'pre', 'code', 'svg', 'video', 'canvas', 'iframe', 'map'].includes(el.localName)) {
        const parentToo = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1;
        if (!parentToo || el.parentElement === document.body) wide.push({ target: window.__a11yPath(el), width: Math.round(r.width), right: Math.round(r.right) });
      }
      if (wide.length >= 5) break;
    }
  }
  return { viewport: vw, scrollWidth: sw, overflow: sw > vw + 1, wide };
}

/** WCAG 1.4.12: apply the text-spacing bookmarklet values and list containers that now clip text. */
export function textSpacingCheck() {
  const style = document.createElement('style');
  style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
  const textOf = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2);
  const clipping = () => [...document.body.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    if (!/hidden|clip/.test(cs.overflow + cs.overflowY + cs.overflowX) || !textOf(el)) return false;
    return el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
  });
  const before = new Set(clipping());
  document.head.appendChild(style);
  const after = clipping().filter((el) => !before.has(el));
  const out = after.slice(0, 5).map((el) => ({ target: window.__a11yPath(el), text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 60) }));
  style.remove();
  return { clipped: after.length, samples: out };
}

/** Same-origin links on the page, for picking pages when there is no sitemap. */
export function pageLinks() {
  const out = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (u.origin !== location.origin) continue;
      u.hash = '';
      out.add(u.href);
    } catch { /* bad href */ }
  }
  return [...out];
}

/** A link to an accessibility statement (EAA, the Danish webtilgængelighedslov, was.digst.dk). */
export function statementLink() {
  const re = /tilg(æ|ae)ngelighedserkl(æ|ae)ring|accessibility[ -]statement|was\.digst\.dk|tilg(æ|ae)ngelighed|accessibility|barrierefreiheit|tillgänglighetsredogörelse|tilgjengelighetserklæring/i;
  for (const a of document.querySelectorAll('a[href]')) {
    const text = `${a.innerText} ${a.getAttribute('href')} ${a.getAttribute('aria-label') || ''}`;
    if (re.test(text)) return { href: a.href, text: a.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) };
  }
  return null;
}
