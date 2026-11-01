// The "Built with" line on the cover: what check-tech-stack found on the site, read from
// <run>/check-tech-stack*/results.json. Background for the reader, not a finding.
import fs from 'node:fs';
import path from 'node:path';

// The categories a reader asks about first, in this order.
const CATEGORIES = ['cms', 'ecommerce', 'headless-cms', 'meta-framework', 'js-framework', 'web-framework', 'hosting', 'cdn', 'tag-manager', 'analytics', 'consent'];
const MAX = 8;

const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };

/** Up to eight "Name version" labels for one site's detected technologies, most telling first. */
export function builtWith(result) {
  return (result.technologies || [])
    .filter((t) => t.confidence === 'detected' && CATEGORIES.includes(t.category))
    .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category))
    .slice(0, MAX)
    .map((t) => `${t.name}${t.version ? ` ${t.version}` : ''}`);
}

/** [{ host, items }] for every usable site in the run's check-tech-stack folders. */
export function readStack(runDir) {
  const out = [];
  for (const name of fs.readdirSync(runDir).sort()) {
    if (name !== 'check-tech-stack' && !name.startsWith('check-tech-stack-')) continue;
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(runDir, name, 'results.json'), 'utf8')); } catch { continue; }
    for (const r of doc.results || []) {
      if (r.error || r.challenge) continue;
      const items = builtWith(r);
      if (items.length) out.push({ host: hostOf(r.finalUrl || r.url), items });
    }
  }
  return out;
}

/** One line per site; the host is named only when there are several. */
export const stackLines = (stack) => stack.map((s) => `${stack.length > 1 ? `${s.host}: ` : ''}${s.items.join(' · ')}`);
