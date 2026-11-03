/**
 * What a project's sessions did, read from Claude Code transcripts (one .jsonl per session): the
 * person's prompts, their corrections, the commands that ran and the files that were read. Counts
 * are per session (a command run ten times in one session counts once), which is what tells a
 * habit from a one-off.
 *
 * Also reads exported event pages (JSON arrays or JSON lines of { user|assistant: {...} } or
 * { data: {...} }), so cloud sessions read through an events API can be counted the same way.
 */
import fs from 'node:fs';
import path from 'node:path';

const NOISE = new Set(['cd', 'ls', 'cat', 'echo', 'printf', 'head', 'tail', 'grep', 'rg', 'sed', 'awk', 'find', 'wc', 'sort', 'uniq', 'cut', 'tr', 'sleep', 'true', 'false', 'test', 'pwd', 'export', 'set', 'source', 'which', 'xargs', 'tee', 'diff', 'cmp', 'jq', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod', 'date', 'du', 'df', 'basename', 'dirname', 'for', 'do', 'done', 'if', 'then', 'fi', 'while', 'python3 -c', 'node -e']);
const SUBCOMMAND = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'dotnet', 'docker', 'gh', 'kubectl', 'cargo', 'go', 'make', 'claude', 'uv', 'pip', 'brew']);
const VALUE_FLAGS = new Set(['-C', '--prefix', '--project', '-p', '--git-dir', '--work-tree', '-c', '--cwd', '--dir', '-f', '--file', '-w', '--workspace', '--filter']);
const CORRECTION = /^(no\b|nope\b|don'?t\b|do not\b|stop\b|wrong\b|not (that|this|like)\b|instead\b|why (did|do) you\b|never\b|always\b|please don'?t\b|that'?s not\b|you (should|shouldn'?t|forgot|missed)\b|actually\b|undo\b|revert\b)/i;

/** The command's habit signature: `git commit`, `python3 scripts/catch-up.py`, `npm run build`. Null for shell plumbing. */
export function signature(segment) {
  const words = segment.trim().replace(/^((sudo|env|nohup|time)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const [cmd, ...rest] = words;
  const base = path.basename(cmd);
  if (NOISE.has(base) || base.length < 2 || !/^[A-Za-z.\/][\w.\/+-]*$/.test(cmd) || /^(function|case|esac|elif|else|until|select|time|exec|eval|return|exit|continue|break|local|declare|read|wait|trap|shift|alias|unset|\.)$/.test(base)) return null;
  if (/^(python3?|node|bash|sh|deno|bun|ts-node|tsx|ruby|php)$/.test(base)) {
    const script = rest.find((w) => !w.startsWith('-'));
    if (!script || /^-[ce]$/.test(rest[0] || '') || !/^[\w.\/@+-]+$/.test(script)) return null;
    return `${base} ${script.replace(/^\.\//, '')}`;
  }
  if (SUBCOMMAND.has(base)) {
    const sub = [];
    for (let i = 0; i < rest.length; i++) {
      if (VALUE_FLAGS.has(rest[i])) { i++; continue; }
      if (!rest[i].startsWith('-') && /^[\w.:@\/-]+$/.test(rest[i])) sub.push(rest[i]);
    }
    if (base === 'npm' && sub[0] === 'run' && sub[1]) return `npm run ${sub[1]}`;
    if (base === 'dotnet' && sub[0] === 'run') return 'dotnet run';
    return sub[0] ? `${base} ${sub[0]}` : base;
  }
  return base.startsWith('./') || cmd.includes('/') ? cmd.replace(/^\.\//, '') : base;
}

/** Splits a shell command on newlines, && || ; and |, after dropping heredoc bodies, quoted text and $( ) substitutions. */
export function segments(command) {
  let s = String(command ?? '');
  s = s.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, ' ');
  s = s.replace(/'[^']*'|"(?:\\.|[^"\\])*"|`[^`]*`|\$\((?:[^()]|\([^()]*\))*\)/g, '""');
  return s.split(/\n|&&|\|\||;|\|/).map((x) => x.trim()).filter(Boolean);
}

/** The text a person typed in a user message, or null when it is a tool result or injected context. */
export function humanText(content) {
  let text = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return null;
    text = content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  }
  if (!text) return null;
  const inMessage = [...text.matchAll(/<message\b[^>]*>([\s\S]*?)<\/message>/g)].map((m) => m[1]);
  if (inMessage.length) text = inMessage.join('\n');
  text = text.replace(/<(system-reminder|session-context|system-note|command-[\w-]+|local-command-[\w-]+)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').trim();
  if (!text || /^(Caveat:|\[Request interrupted)/.test(text)) return null;
  return text;
}

function unwrap(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.data && typeof o.data === 'object') o = { ...o.data, timestamp: o.timestamp || o.data.timestamp };
  if (o.type === 'user' || o.type === 'assistant') return o;
  for (const k of ['user', 'assistant']) if (o[k] && typeof o[k] === 'object') return { type: k, message: o[k].message || o[k], timestamp: o.timestamp, isSidechain: o[k].isSidechain };
  return null;
}

/** Reads one transcript (a .jsonl file or a JSON array file) into { id, start, end, prompts, corrections, commands, reads, skills }. */
export function readSession(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let events;
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) { try { events = JSON.parse(trimmed); } catch { events = []; } } else {
    events = [];
    for (const l of raw.split('\n')) { if (!l.trim()) continue; try { events.push(JSON.parse(l)); } catch { /* partial line */ } }
  }
  const s = { id: path.basename(file).replace(/\.(jsonl|json)$/, ''), file, start: null, end: null, prompts: [], corrections: [], commands: new Set(), reads: new Set(), skills: new Set() };
  for (const ev of events) {
    const e = unwrap(ev);
    if (!e || e.isSidechain) continue;
    const t = e.timestamp || ev.timestamp || null;
    if (t) { if (!s.start || t < s.start) s.start = t; if (!s.end || t > s.end) s.end = t; }
    const content = e.message?.content;
    if (e.type === 'user') {
      const text = humanText(content);
      if (text) {
        s.prompts.push({ t, text: text.slice(0, 400) });
        if (CORRECTION.test(text)) s.corrections.push({ t, text: text.replace(/\s+/g, ' ').slice(0, 200) });
      }
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== 'tool_use') continue;
        const input = b.input || {};
        if (b.name === 'Bash' && input.command) for (const seg of segments(input.command)) { const sig = signature(seg); if (sig) s.commands.add(sig); }
        if ((b.name === 'Read' || b.name === 'Edit' || b.name === 'Write') && input.file_path) s.reads.add(input.file_path);
        if (b.name === 'Skill' && input.skill) s.skills.add(input.skill);
      }
    }
  }
  return s;
}

/** Sessions in a folder (or a list of files), newest first, optionally since a date. */
export function readSessions(input, { since = null } = {}) {
  const files = Array.isArray(input) ? input : fs.readdirSync(input).filter((f) => /\.(jsonl|json)$/.test(f)).map((f) => path.join(input, f));
  return files.map((file) => { try { return readSession(file); } catch { return null; } })
    .filter((s) => s && (s.prompts.length || s.commands.size) && (!since || (s.end && s.end >= since)))
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

/** Per-session counts across sessions: commands, files read, skills, and every correction with its session. */
export function summarise(sessions, { root = null, minSessions = 2 } = {}) {
  const count = (pick) => {
    const m = new Map();
    for (const s of sessions) for (const x of pick(s)) m.set(x, (m.get(x) || 0) + 1);
    return [...m].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
  };
  const relTo = (p) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);
  return {
    sessions: sessions.length,
    from: sessions.at(-1)?.start || null,
    to: sessions[0]?.end || null,
    prompts: sessions.reduce((a, s) => a + s.prompts.length, 0),
    commands: count((s) => s.commands).filter((x) => x.n >= minSessions).map(({ k, n }) => ({ command: k, sessions: n })),
    reads: count((s) => [...s.reads].map(relTo)).filter((x) => x.n >= minSessions).slice(0, 40).map(({ k, n }) => ({ file: k, sessions: n })),
    skills: count((s) => s.skills).map(({ k, n }) => ({ skill: k, sessions: n })),
    corrections: sessions.flatMap((s) => s.corrections.map((c) => ({ session: s.id, t: c.t, text: c.text }))),
  };
}
