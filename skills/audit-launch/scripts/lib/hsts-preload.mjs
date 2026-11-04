// HSTS preload: is the domain on the browsers' preload list, could it be, and does the header
// still meet the list's requirements? Shared by audit-launch and audit-infra: skills install
// separately, so each carries an identical copy of this file (audit-launch's
// services.test.mjs checks the copies). Change one, copy it to the other.
//
// Sources: hstspreload.org's API (status + preloadable), and when that does not answer, the
// Chromium source list (net/http/transport_security_state_static.json, ~10 MB), which is what
// Chrome, Edge, Firefox and Safari build their lists from. Plain fetch, no dependencies,
// never throws.

export const PRELOAD_MIN_AGE = 31536000;
export const CHROMIUM_LIST_URL = 'https://chromium.googlesource.com/chromium/src/+/main/net/http/transport_security_state_static.json?format=TEXT';
const UA = 'Mozilla/5.0 (compatible; hsts-preload-check)';

/** parseHstsHeader(raw) -> { maxAge, includeSubDomains, preload } | null when there is no header. */
export function parseHstsHeader(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !String(v).trim()) return null;
  const out = { maxAge: null, includeSubDomains: false, preload: false };
  for (const part of String(v).split(';')) {
    const [k, val] = part.trim().split('=');
    const key = (k || '').trim().toLowerCase();
    if (key === 'max-age') out.maxAge = Number(String(val ?? '').trim().replace(/^"|"$/g, '')) || 0;
    else if (key === 'includesubdomains') out.includeSubDomains = true;
    else if (key === 'preload') out.preload = true;
  }
  return out;
}

/** headerEligibility(raw | parsed) -> { eligible, issues: string[] }: the three header requirements of the list. */
export function headerEligibility(h) {
  const p = h && typeof h === 'object' && !Array.isArray(h) ? h : parseHstsHeader(h);
  if (!p) return { eligible: false, issues: ['no Strict-Transport-Security header'] };
  const issues = [];
  if (!(p.maxAge >= PRELOAD_MIN_AGE)) issues.push(`max-age ${p.maxAge ?? 'missing'} (needs ≥ ${PRELOAD_MIN_AGE}, one year)`);
  if (!p.includeSubDomains) issues.push('includeSubDomains missing');
  if (!p.preload) issues.push('preload directive missing');
  return { eligible: issues.length === 0, issues };
}

/**
 * chromiumLookup(host, listText) -> { found, entry, preloadedDomain }
 * The list is JSON with // comment lines. A host is covered by its own force-https entry, or by a
 * parent entry with include_subdomains.
 */
export function chromiumLookup(host, listText) {
  const entries = typeof listText === 'string' ? parseChromiumList(listText) : listText;
  const byName = entries instanceof Map ? entries : new Map(entries.map((e) => [String(e.name).toLowerCase(), e]));
  const labels = String(host).toLowerCase().replace(/\.$/, '').split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join('.');
    const e = byName.get(name);
    if (e && e.mode === 'force-https' && (i === 0 || e.include_subdomains)) return { found: true, entry: e, preloadedDomain: name };
  }
  return { found: false, entry: null, preloadedDomain: null };
}

export function parseChromiumList(text) {
  const json = String(text).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return JSON.parse(json).entries || [];
}

async function getJson(fetchImpl, url, timeout) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const errText = (e) => e?.cause?.code || e?.message || String(e);

/**
 * preloadLookup(host, { apex, fetch, timeout, chromium })
 *   -> { ok, source: 'hstspreload.org'|'chromium'|null, status, preloadedDomain, errors: [], warnings: [], error? }
 *
 * status is hstspreload.org's word ('preloaded', 'pending', 'unknown', 'rejected', 'removed' …);
 * from the Chromium list only 'preloaded' or 'unknown'. errors/warnings come from the
 * preloadable endpoint for the apex (only registered domains can be submitted).
 */
export async function preloadLookup(host, { apex = host, fetch: fetchImpl = globalThis.fetch, timeout = 20000, chromium = true } = {}) {
  const out = { ok: false, source: null, status: 'unknown', preloadedDomain: null, errors: [], warnings: [] };
  const problems = [];
  const [st, pr] = await Promise.allSettled([
    getJson(fetchImpl, `https://hstspreload.org/api/v2/status?domain=${encodeURIComponent(host)}`, timeout),
    getJson(fetchImpl, `https://hstspreload.org/api/v2/preloadable?domain=${encodeURIComponent(apex)}`, timeout),
  ]);
  if (st.status === 'fulfilled' && st.value && typeof st.value === 'object' && st.value.status) {
    Object.assign(out, { ok: true, source: 'hstspreload.org', status: String(st.value.status), preloadedDomain: st.value.preloadedDomain || null });
  } else problems.push(`hstspreload.org status: ${st.status === 'rejected' ? errText(st.reason) : 'no status in the answer'}`);
  if (pr.status === 'fulfilled' && pr.value && typeof pr.value === 'object') {
    out.errors = Array.isArray(pr.value.errors) ? pr.value.errors : [];
    out.warnings = Array.isArray(pr.value.warnings) ? pr.value.warnings : [];
  } else if (pr.status === 'rejected') problems.push(`hstspreload.org preloadable: ${errText(pr.reason)}`);

  if (!out.ok && chromium) {
    try {
      const res = await fetchImpl(CHROMIUM_LIST_URL, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(Math.max(timeout, 60000)) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = Buffer.from((await res.text()).replace(/\s+/g, ''), 'base64').toString('utf8');
      const hit = chromiumLookup(host, text);
      Object.assign(out, { ok: true, source: 'chromium', status: hit.found ? 'preloaded' : 'unknown', preloadedDomain: hit.preloadedDomain });
    } catch (e) {
      problems.push(`Chromium list: ${errText(e)}`);
    }
  }
  if (problems.length) out.error = problems.join('; ');
  return out;
}

const listed = (xs) => xs.map((x) => x.summary || x.message || x.code || JSON.stringify(x)).join('; ');

/**
 * preloadVerdict({ host, header, lookup }) -> { status: 'pass'|'warn'|'info'|'skip', text, fix }
 * One wording for both skills.
 *  - on the list and the header still qualifies: pass
 *  - on the list but the header no longer qualifies: warn (dropping preload invites removal)
 *  - pending with preloadable errors: warn (the submission will be rejected)
 *  - not on the list: info (preloading is optional and hard to undo)
 *  - neither source answered: skip
 */
export function preloadVerdict({ host, header, lookup }) {
  const elig = headerEligibility(header);
  const headerText = elig.eligible ? 'header meets the preload requirements' : `header not preload-eligible: ${elig.issues.join(', ')}`;
  if (!lookup?.ok) return { status: 'skip', text: `could not check the preload list (${lookup?.error || 'no answer'}); ${headerText}`, fix: '' };
  const src = lookup.source === 'chromium' ? 'Chromium preload list (hstspreload.org did not answer)' : 'hstspreload.org';
  const via = lookup.preloadedDomain && lookup.preloadedDomain !== host ? ` via ${lookup.preloadedDomain}` : '';
  const errs = lookup.errors?.length ? `; hstspreload.org reports: ${listed(lookup.errors)}` : '';
  if (lookup.status === 'preloaded') {
    if (elig.eligible) return { status: 'pass', text: `preloaded${via} (${src}); ${headerText}`, fix: '' };
    return { status: 'warn', text: `preloaded${via} (${src}), but the ${headerText}`, fix: 'Browsers keep forcing https from the list, but keep max-age ≥ 31536000, includeSubDomains and preload in the header: a domain that drops them can be taken off the list.' };
  }
  if (lookup.status === 'pending') {
    return errs
      ? { status: 'warn', text: `submitted, pending (${src})${errs}`, fix: 'Fix the errors hstspreload.org lists, or the pending submission is dropped.' }
      : { status: 'info', text: `submitted, pending (${src}); ${headerText}. Browsers pick it up with a later release.`, fix: '' };
  }
  const word = lookup.status === 'unknown' ? 'not on the preload list' : `preload list status: ${lookup.status}`;
  return {
    status: 'info',
    text: `${word} (${src}); ${headerText}${errs}`,
    fix: elig.eligible && !errs ? 'Optional: submit the apex at hstspreload.org once every subdomain is https-only (removal takes months).' : 'Optional: preloading needs max-age ≥ 31536000, includeSubDomains and preload on the apex, an http→https redirect, and every subdomain on https.',
  };
}
