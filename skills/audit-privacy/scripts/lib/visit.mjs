// One scenario in its own browser context: load the page as a new visitor, record every request
// (iframes included), then optionally make a consent choice and record what follows.
import { findBanner, clickBanner, cmpApi, pageFacts, PATTERNS, POLICY_PATTERN } from './inpage.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (fn, ...args) => `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;

/**
 * openContext(browser, { headers }) -> page handle with:
 *   goto(url), settle(), facts(), banner(), click(kind), api(choice), cookies(), screenshot(),
 *   requests (live array), mark() (start a new phase), close()
 */
export async function openContext(b, { headers = {}, siteHosts = [], log = () => {} } = {}) {
  const { browserContextId } = await b.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const sessions = new Set([sessionId]);
  const frames = new Map(); // child sessionId -> url
  const requests = [];
  let phase = 'load';
  let lastActivity = Date.now();
  const offs = [];

  const enable = async (sid) => {
    await Promise.all([
      b.send('Network.enable', {}, sid),
      b.send('Page.enable', {}, sid).catch(() => {}),
      b.send('Runtime.enable', {}, sid).catch(() => {}),
      b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid).catch(() => {}),
    ]);
    // Headers go to the audited site only (a WAF bypass rule), never to third parties.
    if (Object.keys(headers).length) {
      await b.send('Fetch.enable', { patterns: siteHosts.map((h) => ({ urlPattern: `*://${h}/*` })) }, sid).catch(() => {});
    }
  };
  offs.push(b.on('Target.attachedToTarget', async (p, parent) => {
    if (!sessions.has(parent)) return;
    sessions.add(p.sessionId);
    frames.set(p.sessionId, p.targetInfo?.url || '');
    try { await enable(p.sessionId); } catch { /* frame went away */ }
    b.send('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {});
  }));
  offs.push(b.on('Fetch.requestPaused', (p, sid) => {
    if (!sessions.has(sid)) return;
    const merged = Object.entries({ ...p.request.headers, ...headers }).map(([name, value]) => ({ name, value: String(value) }));
    b.send('Fetch.continueRequest', { requestId: p.requestId, headers: merged }, sid).catch(() => {});
  }));
  offs.push(b.on('Network.requestWillBeSent', (p, sid) => {
    if (!sessions.has(sid)) return;
    lastActivity = Date.now();
    requests.push({ phase, url: p.request.url, method: p.request.method, type: p.type || null, frame: sid === sessionId ? 'top' : 'iframe', postData: p.request.hasPostData ? true : undefined });
  }));
  offs.push(b.on('Network.loadingFinished', (p, sid) => { if (sessions.has(sid)) lastActivity = Date.now(); }));

  await enable(sessionId);
  await b.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});

  const evalIn = async (sid, expression, ms = 10000) => {
    const r = await b.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sid, ms);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
    return r.result.value;
  };

  /** Network quiet for `quiet` ms, at most `max` ms. */
  async function settle({ quiet = 2000, max = 12000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < max) {
      await sleep(250);
      if (Date.now() - lastActivity >= quiet) return;
    }
  }

  async function goto(url, { timeout = 45000, extraWait = 3000 } = {}) {
    let done;
    const loaded = new Promise((r) => { done = r; });
    const off = b.on('Page.loadEventFired', (_, sid) => { if (sid === sessionId) done(); });
    const nav = await b.send('Page.navigate', { url }, sessionId, timeout);
    if (nav.errorText) { off(); throw new Error(`${url}: ${nav.errorText}`); }
    await Promise.race([loaded, sleep(timeout)]);
    off();
    await settle();
    await sleep(extraWait); // CMPs and tag managers often fire a moment after load
    await settle();
  }

  /** Banner buttons in the top frame, else in the first iframe that has them (Sourcepoint, TrustArc). */
  async function banner() {
    const order = [sessionId, ...[...sessions].filter((s) => s !== sessionId)];
    for (const sid of order) {
      try {
        const r = await evalIn(sid, call(findBanner, PATTERNS), 8000);
        if (r && r.found) return { ...r, sid, frame: sid === sessionId ? 'top' : frames.get(sid) || 'iframe' };
      } catch { /* detached or cross-origin without a session */ }
    }
    return { found: false, accept: [], reject: [], selection: [], settings: [], save: [], text: '', checked: 0 };
  }

  const click = async (sid, kind) => evalIn(sid, call(clickBanner, kind)).catch(() => false);
  const api = async (choice) => evalIn(sessionId, call(cmpApi, choice)).catch(() => null);
  const facts = async () => evalIn(sessionId, call(pageFacts, POLICY_PATTERN, PATTERNS.container), 15000);
  const text = async () => evalIn(sessionId, '(document.body && document.body.innerText || "").replace(/[ \\t]+/g, " ")', 15000);
  const cookies = async () => (await b.send('Storage.getCookies', { browserContextId })).cookies;
  const html = async () => evalIn(sessionId, 'document.documentElement.outerHTML.slice(0, 2000000)');
  async function screenshot() {
    const r = await b.send('Page.captureScreenshot', { format: 'png' }, sessionId, 20000);
    return Buffer.from(r.data, 'base64');
  }
  async function reload() {
    let done;
    const loaded = new Promise((r) => { done = r; });
    const off = b.on('Page.loadEventFired', (_, sid) => { if (sid === sessionId) done(); });
    await b.send('Page.reload', {}, sessionId);
    await Promise.race([loaded, sleep(30000)]);
    off();
    await settle();
    await sleep(2000);
    await settle();
  }
  const mark = (name) => { phase = name; lastActivity = Date.now(); };
  async function close() {
    for (const off of offs) off();
    await b.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
  return { goto, settle, banner, click, api, facts, text, cookies, html, screenshot, reload, mark, close, requests, log };
}

/**
 * choose(page, choice) -> { method, steps: [] } — make the choice the way a visitor would:
 * the first-layer button, else settings then reject/save, else the CMP's API (and say so).
 */
export async function choose(page, choice) {
  const steps = [];
  const first = await page.banner();
  if (!first.found) return { method: null, steps: ['no banner found'] };
  if (first[choice].length) {
    page.mark(`after-${choice}`);
    await page.click(first.sid, choice);
    steps.push(`clicked "${first[choice][0].text}" on the first layer`);
    return { method: 'first-layer', steps };
  }
  if (choice === 'reject' && first.selection?.length && !first.checked) {
    page.mark('after-reject');
    await page.click(first.sid, 'selection');
    steps.push(`no reject button; clicked "${first.selection[0].text}" with only necessary cookies ticked`);
    return { method: 'first-layer-selection', steps };
  }
  if (choice === 'reject' && first.settings.length) {
    await page.click(first.sid, 'settings');
    steps.push(`no reject button on the first layer; opened "${first.settings[0].text}"`);
    await sleep(1500);
    const second = await page.banner();
    if (second.reject.length) {
      page.mark('after-reject');
      await page.click(second.sid, 'reject');
      steps.push(`clicked "${second.reject[0].text}" on the second layer`);
      return { method: 'second-layer', steps, prechecked: second.checked };
    }
    if (second.save.length) {
      page.mark('after-reject');
      await page.click(second.sid, 'save');
      steps.push(`saved the second layer as it opened ("${second.save[0].text}")${second.checked ? `, with ${second.checked} option(s) already switched on` : ''}`);
      return { method: 'second-layer-save', steps, prechecked: second.checked };
    }
  }
  page.mark(`after-${choice}`);
  const viaApi = await page.api(choice);
  if (viaApi) { steps.push(`no usable button; used the consent tool's API (${viaApi})`); return { method: 'api', steps }; }
  steps.push(`could not ${choice}: no button and no known consent API`);
  return { method: null, steps };
}
