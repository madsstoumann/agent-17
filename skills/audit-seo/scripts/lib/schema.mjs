/**
 * validator.schema.org: POST url= (or html= for a private host, a local file or a page rendered
 * in Chrome) and read the JSON answer behind its )]}' guard.
 *
 * Shared: audit-seo and audit-launch carry identical copies of this file (a test in each skill
 * checks it). Change both together.
 *
 * Zero dependencies (no imports, so either skill's http.mjs fits). Node >= 22. Never throws.
 * `http` is any object with post(url, { headers, body, timeout, maxBytes }) answering
 * { status, ok, body, error? }.
 */
const MB = 1024 * 1024;
export const SCHEMA_VALIDATOR = 'https://validator.schema.org/validate';

/** stripGuard(text) -> text without a leading )]}' line. */
export function stripGuard(text) {
  return String(text ?? '').replace(/^\)\]\}'\r?\n?/, '');
}

/** One validator node -> { types, errors, warnings }; property errors carry their property, nested ones a dotted path. */
function summariseNode(node, prefix = '') {
  const types = (node.types || []).map((t) => t?.value).filter(Boolean);
  const errors = []; const warnings = [];
  const add = (e, property) => {
    const item = { type: e?.errorType || 'ERROR', args: Array.isArray(e?.args) ? e.args : [], property, severe: e?.isSevere !== false };
    (item.severe ? errors : warnings).push(item);
  };
  for (const e of node.errors || []) add(e, prefix || null);
  for (const p of node.properties || []) for (const e of p.errors || []) add(e, `${prefix}${p.pred ?? ''}`);
  for (const p of node.nodeProperties || []) {
    const name = `${prefix}${p.pred ?? ''}`;
    for (const e of p.errors || []) add(e, name);
    if (p.target) {
      const inner = summariseNode(p.target, `${name}.`);
      errors.push(...inner.errors); warnings.push(...inner.warnings);
    }
  }
  return { types, errors, warnings };
}

/**
 * parseSchemaAnswer(text) -> { objects, errors, warnings, types, nodes, raw } or { error }.
 * `raw` is the parsed JSON minus its echoed `html`.
 */
export function parseSchemaAnswer(text) {
  let json;
  try { json = JSON.parse(stripGuard(text)); } catch (e) { return { error: `not a JSON answer from the validator (${e.message})` }; }
  if (!json || typeof json !== 'object') return { error: 'not a JSON answer from the validator (empty)' };
  const { html: _echoed, ...raw } = json;
  const nodes = []; const types = [];
  for (const group of raw.tripleGroups || []) {
    for (const n of group.nodes || []) {
      const node = summariseNode(n);
      nodes.push(node);
      for (const t of node.types) if (!types.includes(t)) types.push(t);
    }
  }
  return { objects: raw.numObjects ?? nodes.length, errors: raw.totalNumErrors ?? 0, warnings: raw.totalNumWarnings ?? 0, types, nodes, raw };
}

/**
 * schemaValidate(http, { url, html, timeout = 60000 })
 *   -> { ok, status, mode: 'url'|'html', objects, errors, warnings, types: string[],
 *        nodes: [{ types: string[], errors: [{ type, args, property, severe }], warnings: [same] }],
 *        raw, error? }
 * With `html` the markup is posted (nothing is fetched by the validator); else `url` is sent.
 */
export async function schemaValidate(http, { url, html, timeout = 60000 } = {}) {
  const mode = html != null ? 'html' : 'url';
  const failed = (status, error) => ({ ok: false, status, mode, objects: 0, errors: 0, warnings: 0, types: [], nodes: [], raw: null, error });
  if (mode === 'url' && !url) return failed(0, 'url or html required');
  const body = mode === 'html' ? `html=${encodeURIComponent(String(html))}` : `url=${encodeURIComponent(url)}`;
  let res;
  try {
    res = await http.post(SCHEMA_VALIDATOR, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, timeout, maxBytes: 16 * MB });
  } catch (e) { return failed(0, e?.message || String(e)); }
  if (!res || res.status === 0) return failed(0, res?.error || 'network failure');
  if (!res.ok) return failed(res.status, `HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`);
  const parsed = parseSchemaAnswer(res.body);
  return parsed.error ? failed(res.status, parsed.error) : { ok: true, status: res.status, mode, ...parsed };
}

/** schemaLink(url) -> the validator's page for a public URL, for a human to open. */
export const schemaLink = (url) => `https://validator.schema.org/#url=${encodeURIComponent(url)}`;
