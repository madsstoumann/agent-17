/**
 * How far a detected library version is behind the latest release on npm. Looks up
 * registry.npmjs.org only, never the site. Says nothing about vulnerabilities: that is
 * audit-security's job.
 */

// npm packages for technologies whose signature has no `npm` field (it is only set where a
// CDN URL can name the package).
const PACKAGES = {
  'Next.js': 'next', Nuxt: 'nuxt', Gatsby: 'gatsby', Astro: 'astro', SvelteKit: '@sveltejs/kit', Remix: '@remix-run/react',
  Angular: '@angular/core', AngularJS: 'angular', Svelte: 'svelte', Solid: 'solid-js', Qwik: '@builder.io/qwik',
  'Ember.js': 'ember-source', Lit: 'lit', Stencil: '@stencil/core', 'Hotwire Turbo': '@hotwired/turbo', Stimulus: '@hotwired/stimulus',
  'Material UI (MUI)': '@mui/material', 'Chakra UI': '@chakra-ui/react', Vuetify: 'vuetify', 'Ant Design': 'antd',
  'core-js': 'core-js', Modernizr: 'modernizr', Docusaurus: '@docusaurus/core', VitePress: 'vitepress', Eleventy: '@11ty/eleventy',
};

export const packageFor = (t) => t.npm || PACKAGES[t.name] || null;

const parts = (v) => String(v).replace(/[-+].*$/, '').split('.').map((n) => Number.parseInt(n, 10));

/** 'major' | 'minor' | 'patch' when `current` is behind `latest`, 'current' when not, null when unclear. */
export function behind(current, latest) {
  if (!current || !latest) return null;
  const c = parts(current); const l = parts(latest);
  if (c.some(Number.isNaN) || l.some(Number.isNaN)) return null;
  const level = ['major', 'minor', 'patch'];
  for (let i = 0; i < 3; i++) {
    if (c[i] === undefined) return 'current'; // "3" or "3.7": as precise as the evidence allows
    if ((c[i] ?? 0) < (l[i] ?? 0)) return level[i];
    if ((c[i] ?? 0) > (l[i] ?? 0)) return 'current';
  }
  return 'current';
}

async function npmLatest(pkg, timeout) {
  const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) return null;
  const j = await res.json();
  return typeof j.version === 'string' ? j.version : null;
}

/**
 * Sets `latest` and `behind` on every technology with a version and a known npm package,
 * in place. One registry request per package, however many sites use it.
 */
export async function addLatest(results, { timeout = 10000, lookup = npmLatest, log = () => {} } = {}) {
  const techs = results.flatMap((r) => r.technologies || []).filter((t) => t.version && packageFor(t));
  const pkgs = [...new Set(techs.map(packageFor))];
  const latest = new Map();
  await Promise.all(pkgs.map(async (p) => {
    try { latest.set(p, await lookup(p, timeout)); } catch (e) { log(`  npm ${p}: ${e.cause?.code || e.message}`); }
  }));
  for (const t of techs) {
    const l = latest.get(packageFor(t));
    if (!l) continue;
    t.latest = l;
    t.behind = behind(t.version, l);
  }
  return pkgs.length;
}
