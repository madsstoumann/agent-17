/**
 * Turns detection results into report.md and the short stdout summary.
 * One site: a table per category with evidence. Several sites: a comparison
 * matrix and a "how many sites use X" table first, then each site's details.
 */
import { CATEGORIES } from './signatures.mjs';

// Columns for the batch matrix: the questions people ask first about a site.
const MATRIX = [
  ['CMS', ['cms', 'ecommerce', 'headless-cms']],
  ['Framework', ['meta-framework', 'js-framework']],
  ['Backend', ['web-framework', 'language', 'web-server']],
  ['Hosting / CDN', ['hosting', 'cdn']],
  ['Analytics & tags', ['analytics', 'tag-manager']],
  ['Consent', ['consent']],
];

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const label = (t) => `${t.name}${t.version ? ` ${t.version}` : ''}`;
const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };

export function siteLine(r) {
  if (r.error) return `${hostOf(r.url)}: failed (${r.error})`;
  const detected = r.technologies.filter((t) => t.confidence === 'detected');
  const parts = MATRIX.map(([name, cats]) => {
    const hits = detected.filter((t) => cats.includes(t.category)).map(label);
    return hits.length ? `${name}: ${hits.join(', ')}` : null;
  }).filter(Boolean);
  const rest = detected.filter((t) => !MATRIX.some(([, cats]) => cats.includes(t.category))).length;
  return `${hostOf(r.finalUrl || r.url)} (${r.status}${r.challenge ? `, ${r.challenge}` : ''}): ${parts.join(' · ') || 'nothing recognised'}${rest ? ` · +${rest} more` : ''}`;
}

function siteSection(r, level = '##') {
  const L = [];
  L.push(`${level} ${hostOf(r.finalUrl || r.url)}`, '');
  if (r.error) { L.push(`Could not analyse ${r.url}: ${r.error}`, ''); return L; }
  L.push(`- URL: ${r.url}${r.finalUrl && r.finalUrl !== r.url ? ` → ${r.finalUrl}` : ''} (HTTP ${r.status})`);
  if (r.redirects?.length) L.push(`- Redirects: ${r.redirects.map((h) => `${h.status} ${h.url}`).join(' → ')}`);
  if (r.title) L.push(`- Title: ${esc(r.title)}`);
  L.push(`- Evidence: ${r.assetStats.scripts} scripts and ${r.assetStats.styles} stylesheets referenced, ${r.assetStats.fetched} same-site assets read${r.browser ? ', rendered in a headless browser' : ', raw HTML only (pass --browser for tags injected by JavaScript)'}`);
  L.push('');
  if (r.challenge) L.push(`> **Blocked:** the server answered with a ${r.challenge}, so only the protection layer (CDN, WAF) is visible below. This is not the site's stack.`, '');
  const detected = r.technologies.filter((t) => t.confidence === 'detected');
  const possible = r.technologies.filter((t) => t.confidence === 'possible');
  if (!detected.length) L.push('_No technology recognised with confidence._', '');
  else {
    L.push('| Category | Technology | Version / ID | Evidence |', '|---|---|---|---|');
    for (const t of detected) L.push(`| ${t.categoryLabel} | ${esc(t.name)} | ${esc(t.version || (t.ids || []).join(', ') || '')} | ${esc(t.evidence.join('; '))} |`);
    L.push('');
  }
  if (possible.length) {
    L.push('Possible (weak evidence only, verify before relying on it):', '');
    for (const t of possible) L.push(`- ${esc(t.name)} (${t.categoryLabel}): ${esc(t.evidence.join('; '))}`);
    L.push('');
  }
  if (r.errors?.length) { L.push(`Not checked: ${esc(r.errors.slice(0, 5).join('; '))}${r.errors.length > 5 ? ` (+${r.errors.length - 5} more)` : ''}`, ''); }
  return L;
}

export function markdown(results, { generatedAt = new Date().toISOString(), version } = {}) {
  const L = [];
  // Blocked sites only show their protection layer, so they stay out of the usage counts.
  const ok = results.filter((r) => !r.error && !r.challenge);
  L.push(results.length === 1 ? `# Tech stack: ${hostOf(results[0].finalUrl || results[0].url)}` : `# Tech stack: ${results.length} sites`, '');
  L.push(`Generated ${generatedAt} by the \`tech-stack\` skill${version ? ` ${version}` : ''}. Detection is passive: one page per site plus the scripts and stylesheets it loads from its own domain. A missing technology is not proof it is absent.`, '');

  if (results.length > 1) {
    L.push('## Comparison', '');
    L.push(`| Site | ${MATRIX.map(([n]) => n).join(' | ')} |`, `|---|${MATRIX.map(() => '---').join('|')}|`);
    for (const r of results) {
      if (r.error) { L.push(`| ${esc(hostOf(r.url))} | ${MATRIX.map((_, i) => (i ? '' : `failed: ${esc(r.error)}`)).join(' | ')} |`); continue; }
      const d = r.technologies.filter((t) => t.confidence === 'detected');
      L.push(`| ${esc(hostOf(r.finalUrl || r.url))}${r.challenge ? ' (blocked)' : ''} | ${MATRIX.map(([, cats]) => esc(d.filter((t) => cats.includes(t.category)).map(label).join(', '))).join(' | ')} |`);
    }
    L.push('');
    L.push('## Usage across sites', '');
    const count = new Map();
    for (const r of ok) for (const t of r.technologies.filter((x) => x.confidence === 'detected')) {
      const c = count.get(t.name) || { t, sites: [] };
      c.sites.push(hostOf(r.finalUrl || r.url) + (t.version ? ` (${t.version})` : ''));
      count.set(t.name, c);
    }
    const order = Object.keys(CATEGORIES);
    const rows = [...count.values()].sort((a, b) => order.indexOf(a.t.category) - order.indexOf(b.t.category) || b.sites.length - a.sites.length || a.t.name.localeCompare(b.t.name));
    L.push('| Category | Technology | Sites | Where |', '|---|---|---|---|');
    for (const { t, sites } of rows) L.push(`| ${t.categoryLabel} | ${esc(t.name)} | ${sites.length}/${ok.length} | ${esc(sites.join(', '))} |`);
    L.push('');
  }

  for (const r of results) L.push(...siteSection(r));
  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
