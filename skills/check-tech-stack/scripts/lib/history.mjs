/**
 * What changed since the last run of the same site. Each host keeps its last result in
 * <reports>/check-tech-stack/<host>/last.json, whatever folder the report itself went to.
 */
import fs from 'node:fs';
import path from 'node:path';

export const hostKey = (r) => { try { return new URL(r.finalUrl || r.url).host.replace(/[^a-z0-9.-]/gi, '_'); } catch { return null; } };
export const historyFile = (root, host) => path.join(root, 'check-tech-stack', host, 'last.json');

/** The part of a result worth comparing next time: detected technologies only. */
export function snapshot(r, { generatedAt }) {
  return {
    url: r.url, finalUrl: r.finalUrl, generatedAt, browser: !!r.browser, pages: r.pages?.length || 0,
    technologies: r.technologies.filter((t) => t.confidence === 'detected').map((t) => ({ name: t.name, category: t.category, version: t.version || null })),
  };
}

/**
 * Added, removed and version changes between two snapshots. A technology that is not seen
 * this time is only "not seen": when the last run looked harder (browser, more pages) that
 * may be the reason, and `weaker` says so.
 */
export function diff(prev, curr) {
  const before = new Map(prev.technologies.map((t) => [t.name, t]));
  const now = new Map(curr.technologies.map((t) => [t.name, t]));
  const added = curr.technologies.filter((t) => !before.has(t.name));
  const removed = prev.technologies.filter((t) => !now.has(t.name));
  const changed = curr.technologies
    .filter((t) => before.has(t.name) && t.version && before.get(t.name).version && t.version !== before.get(t.name).version)
    .map((t) => ({ name: t.name, category: t.category, from: before.get(t.name).version, to: t.version }));
  const weaker = [prev.browser && !curr.browser && 'the last run used the browser', (prev.pages || 0) > (curr.pages || 0) && 'the last run read more pages'].filter(Boolean);
  return { since: prev.generatedAt, added, removed, changed, weaker };
}

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/**
 * Compares each usable result with its host's last run (setting `r.changes`), then saves this
 * run as the new last one. Failed and blocked results are neither compared nor saved.
 */
export function compareAndSave(results, root, opts) {
  for (const r of results) {
    if (r.error || r.challenge) continue;
    const host = hostKey(r);
    if (!host) continue;
    const file = historyFile(root, host);
    const curr = snapshot(r, opts);
    const prev = read(file);
    if (prev?.technologies) r.changes = diff(prev, curr);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(curr, null, 2)}\n`);
  }
}
