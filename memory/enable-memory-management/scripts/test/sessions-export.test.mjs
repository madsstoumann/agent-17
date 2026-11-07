import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { exportSessions } from '../sessions-export.mjs';
import { readSessions } from '../lib/transcripts.mjs';

test('sessions-export: follows next_page, stops at --since, writes events the transcript reader counts', async () => {
  const seen = [];
  const sessions = [
    { id: 'sesn_3', created_at: '2026-11-02T08:00:00Z' },
    { id: 'sesn_2', created_at: '2026-10-30T08:00:00Z' },
    { id: 'sesn_1', created_at: '2026-10-20T08:00:00Z' },
  ];
  const events = (id) => [
    { id: `${id}_a`, type: 'user.message', content: [{ type: 'text', text: `Run the build (${id})` }], processed_at: '2026-11-02T08:00:01Z' },
    { id: `${id}_b`, type: 'agent.tool_use', name: 'bash', input: { command: 'npm run build' }, processed_at: '2026-11-02T08:00:02Z' },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), key: req.headers['x-api-key'], beta: req.headers['anthropic-beta'], method: req.method });
    let body;
    if (url.pathname === '/v1/sessions') {
      const page = url.searchParams.get('page');
      body = page ? { data: sessions.slice(1), next_page: null } : { data: sessions.slice(0, 1), next_page: 'p2' };
    } else {
      const id = url.pathname.split('/')[3];
      const all = events(id);
      body = url.searchParams.get('page') ? { data: all.slice(1), next_page: null } : { data: all.slice(0, 1), next_page: 'e2' };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'emm-export-'));
  const before = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'placeholder';
  try {
    const r = await exportSessions({ agent: 'agent_x', out, since: '2026-10-25', base: `http://127.0.0.1:${server.address().port}` });
    assert.deepEqual(r.written.map((w) => w.id), ['sesn_3', 'sesn_2']);
    assert.ok(seen.every((s) => s.method === 'GET' && s.key === 'placeholder' && s.beta === 'managed-agents-2026-04-01'));
    assert.equal(seen[0].query.agent_id, 'agent_x');
    const read = readSessions(out);
    assert.equal(read.length, 2);
    assert.ok(read.every((s) => s.prompts.length === 1 && [...s.commands][0] === 'npm run build'));
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before;
    server.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
});
