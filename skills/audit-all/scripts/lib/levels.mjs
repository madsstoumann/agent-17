/**
 * Output levels and the compact console list, shared by every skill that writes a report.
 * Skills install separately, so each carries an identical copy of this file
 * (audit-all/scripts/test/levels.test.mjs checks the copies match). Pure apart from scratchDir().
 *
 * One scale for all skills: error, warning, info. Passes and skipped checks have no level and show
 * only with --level all (the default, which is the full report as before).
 *
 *   error    fail, blocker, critical, urgent, high, red, error
 *   warning  warn, warning, medium, moderate, low, amber, review
 *   info     info, notice, unknown
 *
 * The level filters what people read (the console list, report.md and the PDF, fix/TODO.md).
 * It never filters saved data: report.json, findings.json, tasks.json and last-report.json stay
 * complete, so the next run's "Since last run" compares like with like.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LEVELS = ['error', 'warn', 'info'];
const WORDS = {
  error: 'error', errors: 'error', err: 'error', fail: 'error', fails: 'error',
  warn: 'warn', warns: 'warn', warning: 'warn', warnings: 'warn',
  info: 'info', infos: 'info', notice: 'info',
};
const LABELS = { error: 'ERROR', warn: 'WARN', info: 'INFO' };

const ERROR_WORDS = new Set(['fail', 'failed', 'error', 'blocker', 'critical', 'urgent', 'high', 'red', 'serious']);
const WARN_WORDS = new Set(['warn', 'warning', 'medium', 'moderate', 'low', 'amber', 'review', 'minor']);
const INFO_WORDS = new Set(['info', 'notice', 'unknown', 'manual']);
const NO_LEVEL = new Set(['pass', 'passed', 'ok', 'green', 'skip', 'skipped', 'ignored', 'accepted', 'fixed']);

/**
 * parseLevel('error,warn') -> { all, error, warn, info, label, words }
 * Accepts a comma list of error(s) / warn(ing)(s) / info, or all (the default). Throws on anything else.
 */
export function parseLevel(value) {
  const parts = String(value ?? 'all').toLowerCase().split(/[\s,+]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.includes('all')) {
    if (parts.some((p) => p !== 'all')) throw new Error('--level all cannot be combined with other levels');
    return { all: true, error: true, warn: true, info: true, label: 'all', words: 'all' };
  }
  const picked = new Set();
  for (const p of parts) {
    const w = WORDS[p];
    if (!w) throw new Error(`--level must be a comma list of error, warn, info, or all (got "${p}")`);
    picked.add(w);
  }
  const lv = { all: false, error: picked.has('error'), warn: picked.has('warn'), info: picked.has('info') };
  const names = LEVELS.filter((l) => lv[l]);
  lv.words = names.join(',');
  lv.label = names.length === 3 ? 'errors, warnings and info'
    : names.map((l) => ({ error: 'errors', warn: 'warnings', info: 'info' })[l]).join(' and ') + (names.length === 1 ? ' only' : '');
  return lv;
}

/** The level of one word (a status, severity or traffic light), or null for pass/skip/unknown words. */
export function levelOfWord(word) {
  const w = String(word ?? '').toLowerCase().trim();
  if (ERROR_WORDS.has(w)) return 'error';
  if (WARN_WORDS.has(w)) return 'warn';
  if (INFO_WORDS.has(w)) return 'info';
  return null;
}

/**
 * The level of a finding, row or task. A check status (pass/warn/fail/info/skip) wins, because a
 * passing check with a severity attached is still a pass; then severity; then level (red/amber/green).
 */
export function levelOf(item) {
  if (!item || typeof item !== 'object') return levelOfWord(item);
  const status = String(item.status ?? '').toLowerCase();
  if (status && (NO_LEVEL.has(status) || ['fail', 'failed', 'warn', 'warning', 'info', 'error'].includes(status))) {
    return NO_LEVEL.has(status) ? null : levelOfWord(status);
  }
  for (const key of ['severity', 'level', 'impact']) {
    const v = item[key];
    if (v == null || v === '') continue;
    if (NO_LEVEL.has(String(v).toLowerCase())) return null;
    const l = levelOfWord(v);
    if (l) return l;
  }
  return status ? levelOfWord(status) : null;
}

/** Whether the chosen levels show this item. --level all shows everything, passes included. */
export function shows(levels, item, level = levelOf(item)) {
  if (!levels || levels.all) return true;
  return Boolean(level && levels[level]);
}

/** The items the chosen levels show. `get` maps an item to its level when levelOf does not fit. */
export function byLevel(items, levels, get = levelOf) {
  if (!levels || levels.all) return [...(items || [])];
  return (items || []).filter((i) => shows(levels, i, get(i)));
}

/** { error, warn, info } counts. */
export function countLevels(items, get = levelOf) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const i of items || []) { const l = get(i); if (l) c[l]++; }
  return c;
}

/** One line for report.md under the title when a level is set; empty for --level all. */
export function levelNote(levels, { hidden = 0, where = 'report.json' } = {}) {
  if (!levels || levels.all) return '';
  return `> Showing ${levels.label} (\`--level ${levels.words}\`)${hidden ? `; ${hidden} other row${hidden === 1 ? '' : 's'} hidden` : ''}. The full results are in ${where}.`;
}

const pad = (s, n) => (String(s).length >= n ? String(s) : String(s) + ' '.repeat(n - String(s).length));
const RANK = { error: 0, warn: 1, info: 2 };

/**
 * The compact console list: one line per issue, errors first.
 *   consoleList({ title, items: [{ level, source, id, title, where }], levels })
 *   ERROR  security  S3  Hard-coded API key · src/config.js:12
 * Items without a level (passes) never appear. `max` caps the lines; the rest are counted.
 */
export function consoleList({ title = '', items = [], levels, max = 500 } = {}) {
  const lv = levels || parseLevel('all');
  const all = items.filter((i) => i && i.level);
  const shown = all.filter((i) => lv.all || lv[i.level]).sort((a, b) => RANK[a.level] - RANK[b.level]);
  const c = countLevels(all, (i) => i.level);
  const lines = [];
  const counts = `${c.error} error${c.error === 1 ? '' : 's'} · ${c.warn} warning${c.warn === 1 ? '' : 's'} · ${c.info} info`;
  lines.push(`${title}${title ? ' — ' : ''}${counts}${lv.all ? '' : ` — showing ${lv.label}`}`);
  if (!shown.length) { lines.push(lv.all ? 'No issues.' : `No ${lv.label.replace(/ only$/, '')}.`); return lines.join('\n'); }
  const wSrc = Math.min(16, Math.max(0, ...shown.map((i) => String(i.source || '').length)));
  const wId = Math.min(24, Math.max(0, ...shown.map((i) => String(i.id || '').length)));
  for (const i of shown.slice(0, max)) {
    const t = String(i.title || '').replace(/\s+/g, ' ').trim();
    const where = i.where ? ` · ${String(i.where).replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`${pad(LABELS[i.level], 5)}  ${wSrc ? `${pad(i.source || '', wSrc)}  ` : ''}${wId ? `${pad(i.id || '', wId)}  ` : ''}${t}${where}`.trimEnd());
  }
  if (shown.length > max) lines.push(`+${shown.length - max} more`);
  return lines.join('\n');
}

/**
 * --console without --report: the run's files go to a scratch folder in the system temp folder,
 * so no report.md or run folder is left in the reports folder. The skill removes it when it is
 * done; audit-privacy and audit-security keep it for the files Claude reads afterwards (policy
 * text, findings.json) and leave it to the system's temp cleanup. The target folder
 * (last-report.json, notes.md) is still written, so the next run can compare.
 */
export function scratchDir(skill) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${skill}-console-`));
}

/** Removes only the folder scratchDir() made for this run. */
export function removeScratch(dir) {
  if (dir && path.basename(dir).includes('-console-') && path.dirname(dir) === os.tmpdir()) fs.rmSync(dir, { recursive: true, force: true });
}
