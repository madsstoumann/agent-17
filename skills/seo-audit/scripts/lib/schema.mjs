/**
 * validator.schema.org, the service the validate-schema skill uses: POST url= (or html= for a
 * private host) and read the JSON answer behind its )]}' guard. Adapted from
 * launch-audit/scripts/lib/services.mjs.
 *
 * Zero dependencies. Node >= 22. Never throws.
 */
const MB = 1024 * 1024;

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

/** parseSchemaAnswer(text) -> { objects, errors, warnings, types, nodes } or { error }. */
export function parseSchemaAnswer(text) {
  let json;
  try { json = JSON.parse(String(text || '').replace(/^\)\]\}'\s*\n?/, '')); } catch (e) { return { error: `not a JSON answer from the validator (${e.message})` }; }
  if (!json || typeof json !== 'object') return { error: 'empty answer from the validator' };
  const nodes = []; const types = [];
  for (const group of json.tripleGroups || []) {
    for (const n of group.nodes || []) {
      const node = summariseNode(n);
      nodes.push(node);
      for (const t of node.types) if (!types.includes(t)) types.push(t);
    }
  }
  return { objects: json.numObjects ?? nodes.length, errors: json.totalNumErrors ?? 0, warnings: json.totalNumWarnings ?? 0, types, nodes };
}

/** schemaValidate(http, { url, html }) -> { ok, objects, errors, warnings, types, nodes, error? } */
export async function schemaValidate(http, { url, html, timeout = 60000 } = {}) {
  const body = html != null ? `html=${encodeURIComponent(String(html))}` : `url=${encodeURIComponent(url)}`;
  const res = await http.post('https://validator.schema.org/validate', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, timeout, maxBytes: 16 * MB });
  if (res.status === 0) return { ok: false, error: res.error || 'network failure' };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}` };
  const parsed = parseSchemaAnswer(res.body);
  return parsed.error ? { ok: false, error: parsed.error } : { ok: true, ...parsed };
}
