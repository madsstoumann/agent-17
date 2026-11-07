/**
 * report.md from the audit's results. Plain tables, numbers first; the enable steps that apply are
 * listed with the findings that call for them, so the person can pick by number.
 */
import { byLevel, countLevels, levelNote } from './levels.mjs';
import { tokens } from './markdown.mjs';

export const STEPS = {
  E1: { title: 'Frontmatter on every memory', does: 'Adds name, description and type (and tier, source, verified) to memory files that lack them. Text below the frontmatter is not touched.', checks: ['M8', 'M9'] },
  E2: { title: 'An index within budget', does: 'Rewrites MEMORY.md as one pointer line per file, under the load limit; text that was rule or fact moves into the file the line points at, verbatim.', checks: ['M1', 'M2', 'M3', 'M4'] },
  E3: { title: 'In-band memory rules', does: 'Adds the short Memory block (references/in-band-rules.md) to CLAUDE.md, or writes a CLAUDE.md that holds it.', checks: ['I0', 'E3'] },
  E4: { title: 'A slim always-read layer', does: 'Keeps what is always true in CLAUDE.md / AGENTS.md; moves reference to docs or path-scoped .claude/rules/<area>.md, verbatim, with a one-line pointer left behind.', checks: ['I1', 'I2', 'I5', 'I6'] },
  E5: { title: 'Skills for repeated procedures', does: 'Writes the picked skill candidates as .claude/skills/<name>/SKILL.md and replaces the steps in the instructions with one line naming the skill.', checks: ['P1'] },
  E6: { title: 'Docs that point at the right files', does: 'Rewrites paths to moved files, moves plans marked built into the archive (fixing every link), lists orphan docs for the owner. Deletes nothing.', checks: ['I3', 'D1', 'D3', 'S4'] },
  E7: { title: 'Versions and safe writes', does: 'Snapshots the store before every change (snapshot.mjs) and checks a file\'s sha256 before rewriting it; optional: a git branch for a team store.', checks: [] },
  E8: { title: 'Dreaming', does: 'Installs .claude/skills/memory-dream/ and STEERING.md, and offers a weekly schedule. A dream run proposes changes with evidence; a person accepts them.', checks: ['E8'] },
};

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const LABEL = { error: 'Error', warn: 'Warning', info: 'Info' };

/** The steps a result calls for, with the finding ids behind each. E7 always applies. */
export function stepsFor(findings) {
  const ids = new Set(findings.map((x) => x.id));
  return Object.entries(STEPS)
    .map(([id, s]) => ({ id, ...s, because: s.checks.filter((c) => ids.has(c)) }))
    .filter((s) => s.id === 'E7' || s.because.length);
}

export function renderReport(r, { levels } = {}) {
  const L = [];
  const shown = byLevel(r.findings, levels, (x) => x.level);
  const c = countLevels(r.findings, (x) => x.level);
  L.push(`# Memory audit: ${r.project}`, '');
  L.push(`${r.date} · ${r.root}${r.memory?.dir ? ` · memory ${r.memory.dir}` : ''}`, '');
  const note = levelNote(levels, { hidden: r.findings.length - shown.length });
  if (note) L.push(note, '');
  L.push(`**${c.error} error${c.error === 1 ? '' : 's'} · ${c.warn} warning${c.warn === 1 ? '' : 's'} · ${c.info} info**`, '');
  if (r.since) L.push(`Since the last run (${r.since.date}): errors ${r.since.error} → ${c.error}, warnings ${r.since.warn} → ${c.warn}, info ${r.since.info} → ${c.info}.`, '');

  L.push('## The layers', '', '| Layer | Measured | Budget |', '|---|---|---|');
  const i = r.instructions;
  if (i) {
    const files = i.loaded.map((x) => `\`${x.rel}\``).join(', ') || 'none';
    L.push(`| Loaded at every start | ${i.total.lines} lines, ${kb(i.total.bytes)}, about ${tokens(i.total.bytes).toLocaleString('en')} tokens (${files}) | under ${r.opts.budgetLines} lines |`);
    if (i.agents) L.push(`| AGENTS.md | ${i.agents.lines} lines, ${kb(i.agents.bytes)}, ${i.agents.imported ? 'imported by CLAUDE.md' : 'not imported (read only when told)'} | under ${r.opts.budgetLines} lines |`);
    L.push(`| Rules in .claude/rules | ${i.rules.length} (${i.rules.filter((x) => x.scoped).length} path-scoped) | scoped by \`paths:\` where they apply to some files |`);
    L.push(`| Rule bullets in the always-read layer | ${i.bullets} (${i.longBullets} over ${kb(r.opts.ruleBytes)}) | one line each |`);
  }
  if (r.skills) L.push(`| Project skills | ${r.skills.count} | SKILL.md under 500 lines |`);
  if (r.docs) L.push(`| Other markdown | ${r.docs.files} files, ${kb(r.docs.bytes)}; ${r.docs.moved} paths to moved files, ${r.docs.missing} to missing ones; ${r.docs.orphans} docs nothing links to | links resolve |`);
  if (r.docs?.plans?.length) {
    const p = (s) => r.docs.plans.filter((x) => x.status === s).length;
    L.push(`| Plans | ${r.docs.plans.length}: ${p('built')} say built, ${p('open')} say not built, ${p('unknown')} say neither | built plans in the archive |`);
  }
  const m = r.memory;
  if (m) {
    L.push(`| Memory files | ${m.files} files, ${kb(m.bytes)}; types ${Object.entries(m.types).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ')} | under ${kb(r.opts.memoryFileBytes)} each |`);
    if (m.index) L.push(`| MEMORY.md | ${m.index.lines} lines, ${kb(m.index.bytes)}, ${m.index.longLines} lines over ${r.opts.longLine} characters | under ${r.opts.indexLines} lines and ${kb(r.opts.indexWarnBytes)} |`);
    L.push(`| Memory links | ${m.indexed} indexed, ${m.unindexed} not in the index, ${m.orphans} linked from nowhere, ${m.broken} broken links, ${m.duplicates} near-duplicate pairs | none |`);
  } else L.push('| Memory | no memory folder found | |');
  if (r.transcripts) L.push(`| Sessions read | ${r.transcripts.sessions} (${String(r.transcripts.from || '').slice(0, 10)} to ${String(r.transcripts.to || '').slice(0, 10)}), ${r.transcripts.prompts} prompts, ${r.transcripts.corrections.length} corrections | |`);
  else L.push('| Sessions read | none (no transcripts found; pass --transcripts DIR) | |');
  L.push('');

  L.push('## Findings', '');
  if (!shown.length) L.push('None at this level.', '');
  else {
    L.push('| Level | Check | What | Where | Fix |', '|---|---|---|---|---|');
    for (const x of shown) L.push(`| ${LABEL[x.level]} | ${x.id} | ${esc(x.title)} | ${esc(x.where)} | ${esc(x.fix)} |`);
    L.push('');
  }

  const steps = stepsFor(r.findings);
  L.push('## Enable steps that apply', '', 'Pick by number; nothing changes before you do.', '', '| # | Step | What it changes | Because of |', '|---|---|---|---|');
  steps.forEach((s, k) => L.push(`| ${k + 1} | ${s.id} ${s.title} | ${esc(s.does)} | ${s.because.join(', ') || 'always'} |`));
  L.push('');

  const moved = r.findings.filter((x) => x.detail?.moved?.length);
  if (moved.length) {
    L.push('## Paths to moved files', '', '| File | Written | Now at |', '|---|---|---|');
    for (const x of moved) for (const [from, to] of x.detail.moved) L.push(`| ${esc(x.where)} | \`${esc(from)}\` | \`${esc(to)}\` |`);
    L.push('');
  }

  if (r.candidates?.length) {
    L.push('## Skill candidates', '', '| Procedure | Where it lives now | Sessions | Commands | A skill covers it |', '|---|---|---|---|---|');
    for (const c of r.candidates) L.push(`| ${esc(c.name)} | ${esc(c.where || 'sessions')} | ${c.sessions == null ? '' : `${c.sessions} of ${c.of}`} | ${esc(c.commands.map((x) => `\`${x}\``).join('<br>'))} | ${c.covered ? 'yes' : 'no'} |`);
    L.push('');
  }

  if (i?.sections?.length) {
    L.push('## Biggest sections of the always-read layer', '', '| File | Section | Lines | Size |', '|---|---|---|---|');
    for (const s of [...i.sections].sort((a, b) => b.bytes - a.bytes).slice(0, 10)) L.push(`| ${s.rel}:${s.line} | ${esc(s.title)} | ${s.lines} | ${kb(s.bytes)} |`);
    L.push('');
  }

  if (r.docs?.plans?.length) {
    L.push('## Plans', '', '| Plan | Header says |', '|---|---|');
    for (const p of r.docs.plans) L.push(`| ${p.path} | ${p.status === 'built' ? 'built' : p.status === 'open' ? 'not built' : 'neither'} |`);
    L.push('');
  }

  if (r.transcripts?.corrections?.length) {
    L.push('## Corrections in the sessions', '', 'What the person pushed back on. A dream run turns repeated ones into feedback memories.', '', '| Session | When | Said |', '|---|---|---|');
    for (const x of r.transcripts.corrections.slice(0, 25)) L.push(`| ${x.session.slice(0, 8)} | ${String(x.t || '').slice(0, 16)} | ${esc(x.text)} |`);
    L.push('');
  }
  if (r.transcripts?.reads?.length) {
    L.push('## Files most sessions open', '', 'A file read in most sessions belongs in the always-read layer as a pointer, or its point in a rule.', '', '| File | Sessions |', '|---|---|');
    for (const x of r.transcripts.reads.slice(0, 15)) L.push(`| ${esc(x.file)} | ${x.sessions} of ${r.transcripts.sessions} |`);
    L.push('');
  }
  return L.join('\n');
}
