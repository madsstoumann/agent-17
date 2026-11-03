import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signature, segments, humanText, readSessions, summarise } from '../lib/transcripts.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts');

test('signature names the habit, not the arguments', () => {
  assert.equal(signature('python3 scripts/catch-up.py --delete-stale'), 'python3 scripts/catch-up.py');
  assert.equal(signature('git -C /repo commit -m x'), 'git commit');
  assert.equal(signature('npm run build -- --watch'), 'npm run build');
  assert.equal(signature('FOO=1 nohup dotnet run --project umbraco'), 'dotnet run');
  assert.equal(signature('./deploy.sh prod'), 'deploy.sh');
  assert.equal(signature('python3 -c "print(1)"'), null);
  assert.equal(signature('grep -n x file'), null);
  assert.equal(signature('}'), null);
});

test('segments drops heredoc bodies and quoted text', () => {
  assert.deepEqual(segments('cd x && npm test | tee log; git status'), ['cd x', 'npm test', 'tee log', 'git status']);
  assert.deepEqual(segments('cat > f <<EOF\nrm -rf /\nEOF\ngit commit -m "a\nb"'), ['cat > f', 'git commit -m ""']);
});

test('humanText keeps what the person typed and drops tool results and injected context', () => {
  assert.equal(humanText('Ship it'), 'Ship it');
  assert.equal(humanText([{ type: 'tool_result', content: 'x' }]), null);
  assert.equal(humanText('<system-reminder>x</system-reminder>Run tests'), 'Run tests');
  assert.equal(humanText('<wake><message id="1">Status?</message></wake>'), 'Status?');
});

test('sessions: per-session counts, corrections, files and skills; sidechains ignored', () => {
  const sessions = readSessions(DIR);
  assert.equal(sessions.length, 3);
  const s = summarise(sessions, { root: '/repo', minSessions: 2 });
  assert.deepEqual(s.commands, [{ command: 'python3 scripts/run.py', sessions: 3 }]);
  assert.deepEqual(s.reads, [{ file: 'AGENTS.md', sessions: 3 }]);
  assert.deepEqual(s.skills, [{ skill: 'deploy', sessions: 1 }]);
  assert.equal(s.corrections.length, 1);
  assert.match(s.corrections[0].text, /Friday/);
  assert.ok(!sessions.some((x) => [...x.commands].some((c) => c.includes('secret-subagent-only'))));
  assert.equal(readSessions(DIR, { since: '2026-10-02' }).length, 2);
});

test('exported event pages (a JSON array of { data: { user|assistant } }) read the same way', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emm-events-'));
  fs.writeFileSync(path.join(dir, 'cloud.json'), JSON.stringify([
    { id: 'e1', data: { user: { message: { content: 'Please merge' } }, timestamp: '2026-11-01T10:00:00Z' } },
    { id: 'e2', data: { assistant: { message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'python3 scripts/catch-up.py' } }] } } } },
  ]));
  const [s] = readSessions(dir);
  assert.equal(s.prompts[0].text, 'Please merge');
  assert.deepEqual([...s.commands], ['python3 scripts/catch-up.py']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Managed Agents session events (a list page or JSON lines) read the same way', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emm-managed-'));
  const events = [
    { id: 'sevt_1', type: 'user.message', content: [{ type: 'text', text: "Don't deploy on Fridays" }], processed_at: '2026-11-02T09:00:00Z' },
    { id: 'sevt_2', type: 'agent.message', content: [{ type: 'text', text: 'Understood.' }], processed_at: '2026-11-02T09:00:05Z' },
    { id: 'sevt_3', type: 'agent.tool_use', name: 'bash', input: { command: 'cd /workspace && npm run build' }, processed_at: '2026-11-02T09:00:10Z' },
    { id: 'sevt_4', type: 'agent.tool_use', name: 'read', input: { file_path: '/workspace/AGENTS.md' }, processed_at: '2026-11-02T09:00:12Z' },
    { id: 'sevt_5', type: 'span.model_request_end', model_usage: { input_tokens: 10 }, processed_at: '2026-11-02T09:00:13Z' },
  ];
  fs.writeFileSync(path.join(dir, 'sesn_page.json'), JSON.stringify({ data: events, next_page: null }, null, 2));
  fs.writeFileSync(path.join(dir, 'sesn_lines.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  const sessions = readSessions(dir);
  assert.equal(sessions.length, 2);
  for (const s of sessions) {
    assert.deepEqual(s.prompts.map((p) => p.text), ["Don't deploy on Fridays"]);
    assert.equal(s.corrections.length, 1);
    assert.deepEqual([...s.commands], ['npm run build']);
    assert.deepEqual([...s.reads], ['/workspace/AGENTS.md']);
    assert.equal(s.start, '2026-11-02T09:00:00Z');
    assert.equal(s.end, '2026-11-02T09:00:13Z');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
