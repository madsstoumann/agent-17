#!/usr/bin/env node
/**
 * Saves a Managed Agents agent's recent sessions as event files, one per session, for a dream run.
 *
 *   node sessions-export.mjs --agent AGENT_ID --out DIR [--since YYYY-MM-DD] [--max N]
 *
 * Lists the agent's sessions (GET /v1/sessions, newest first), keeps those created on or after
 * --since (default: seven days ago), and writes each one's events (GET /v1/sessions/{id}/events,
 * every page) to DIR/<session id>.jsonl, which `transcripts.mjs --dir DIR` and `audit.mjs
 * --transcripts DIR` read. Reads the key from ANTHROPIC_API_KEY (in a Managed Agents session, a
 * vault environment_variable credential, so the sandbox only ever holds a placeholder) and never
 * prints it. ANTHROPIC_BASE_URL and ANTHROPIC_VERSION override the host and the version header.
 * Only GET requests: it changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';

const BETA = 'managed-agents-2026-04-01';

function args(argv) {
  const a = { max: '200' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (['--agent', '--out', '--since', '--max'].includes(k)) a[k.slice(2)] = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown flag ${k} (see --help)`);
  }
  return a;
}

async function get(base, pathname, query) {
  const url = new URL(pathname, base);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2026-10-21',
      'anthropic-beta': BETA,
    },
  });
  if (!res.ok) throw new Error(`GET ${url.pathname} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function* pages(base, pathname, query) {
  let page = null;
  do {
    const body = await get(base, pathname, { ...query, page });
    yield body.data || [];
    page = body.next_page || null;
  } while (page);
}

export async function exportSessions({ agent, out, since, max = 200, base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' }) {
  const from = since || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  outer: for await (const sessions of pages(base, '/v1/sessions', { agent_id: agent, order: 'desc', limit: 100 })) {
    for (const s of sessions) {
      if (String(s.created_at || '') < from) break outer;
      if (written.length >= max) break outer;
      const lines = [];
      for await (const events of pages(base, `/v1/sessions/${encodeURIComponent(s.id)}/events`, { limit: 100 })) {
        for (const e of events) lines.push(JSON.stringify(e));
      }
      const file = path.join(out, `${s.id.replace(/[^\w.-]/g, '_')}.jsonl`);
      fs.writeFileSync(file, `${lines.join('\n')}\n`);
      written.push({ id: s.id, created_at: s.created_at, events: lines.length, file });
    }
  }
  return { agent, since: from, sessions: written.length, out, written };
}

async function main(argv) {
  const a = args(argv);
  if (a.help) { process.stdout.write('node sessions-export.mjs --agent AGENT_ID --out DIR [--since YYYY-MM-DD] [--max N]\n'); return 0; }
  if (!a.agent || !a.out) throw new Error('--agent and --out are required (see --help)');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const r = await exportSessions({ agent: a.agent, out: path.resolve(a.out), since: a.since, max: Number(a.max) || 200 });
  process.stdout.write(`${JSON.stringify({ ...r, written: r.written.map(({ id, created_at, events }) => ({ id, created_at, events })) }, null, 2)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 2; });
}
