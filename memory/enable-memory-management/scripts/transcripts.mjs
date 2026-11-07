#!/usr/bin/env node
/**
 * What the project's sessions did, for a dream run: counts across sessions and one digest per session.
 *
 *   node transcripts.mjs [--root DIR] [--dir DIR] [--since YYYY-MM-DD] [--out FILE] [--min N]
 *
 * --dir defaults to Claude Code's transcript folder for --root. It also reads exported event pages
 * (.json or .jsonl), so sessions fetched through an events API count the same way. Prints the
 * summary; --out also writes { summary, sessions } with each session's prompts, corrections,
 * commands, files and skills, which is what the dream run hands to its reviewers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { transcriptsDir } from './lib/discover.mjs';
import { readSessions, summarise } from './lib/transcripts.mjs';

function main(argv) {
  const a = { root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (['--root', '--dir', '--since', '--out', '--min'].includes(k)) a[k.slice(2)] = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown flag ${k} (see --help)`);
  }
  if (a.help) { process.stdout.write('node transcripts.mjs [--root DIR] [--dir DIR] [--since YYYY-MM-DD] [--out FILE] [--min N]\n'); return 0; }
  const root = path.resolve(a.root);
  const dir = transcriptsDir(root, { explicit: a.dir });
  if (!dir || !fs.existsSync(dir)) throw new Error(`No transcripts found for ${root}; pass --dir`);
  const sessions = readSessions(dir, { since: a.since || null });
  const summary = { dir, ...summarise(sessions, { root, minSessions: Number(a.min) || Math.min(3, Math.max(2, sessions.length)) }) };
  if (a.out) {
    const digest = sessions.map((s) => ({ id: s.id, start: s.start, end: s.end, prompts: s.prompts, corrections: s.corrections, commands: [...s.commands], files: [...s.reads].map((p) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)), skills: [...s.skills] }));
    fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
    fs.writeFileSync(a.out, `${JSON.stringify({ summary, sessions: digest }, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

try { process.exitCode = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 2; }
