// Small zero-dependency Markdown parser for the reports the audit skills write: headings,
// paragraphs, lists (nested, ordered, task items), tables, fenced code, blockquotes, rules,
// and inline code, links, bold, italic, strikethrough. Raw HTML is escaped, never passed through.

const STATUS_EMOJI = [
  [/(?:🔴|❌|⛔|🚫)\uFE0F?/gu, 'fail'],
  [/(?:🟠|🟡|⚠)\uFE0F?/gu, 'warn'],
  [/(?:🟢|✅|✔)\uFE0F?/gu, 'pass'],
  [/(?:ℹ|⚪|⚫|🔵|⏭)\uFE0F?/gu, 'info'],
];

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline Markdown -> HTML. Status emoji become typographic marks (`<span class="mk fail">`). */
export function inline(text) {
  const codes = [];
  let s = String(text).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => {
    codes.push(`<code>${escapeHtml(c.trim())}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt) => alt);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, t, u) => `<a href="${safeUrl(u)}">${t}</a>`);
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u) => `<a href="${safeUrl(u)}">${u}</a>`);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?![\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  for (const [re, cls] of STATUS_EMOJI) s = s.replace(re, `<span class="mk ${cls}" role="img" aria-label="${cls}"></span>`);
  // Long unbroken tokens (URLs, hostnames) may break anywhere; ordinary words keep normal wrapping.
  s = s.split(/(<[^>]+>)/).map((part) => (part.startsWith('<') ? part : part.replace(/[^\s\u0000]{28,}/g, (w) => `<span class="brk">${w}</span>`))).join('');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return s;
}

function safeUrl(u) {
  const url = u.replace(/&amp;/g, '&');
  if (/^(javascript|data|vbscript):/i.test(url)) return '#';
  return escapeHtml(url);
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) => {
  const t = l.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '', inCode = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '`') inCode = !inCode;
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
};
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;

/** Markdown -> array of blocks: {type:'heading',level,text} | {type:'para',lines} | {type:'list',ordered,start,items} |
 *  {type:'table',head,align,rows} | {type:'code',lang,text} | {type:'quote',blocks} | {type:'hr'} */
export function parseBlocks(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  return parseLines(lines);
}

function parseLines(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang: fence[2] || '', text: body.join('\n') });
      continue;
    }

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); i++; continue; }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', blocks: parseLines(body) });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ type: 'table', head, align, rows });
      continue;
    }

    if (LIST_RE.test(line)) {
      const [block, next] = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push({ type: 'para', lines: para });
  }
  return blocks;
}

function startsBlock(lines, i) {
  const l = lines[i];
  return /^\s{0,3}#{1,6}\s/.test(l) || /^\s*(```|~~~)/.test(l) || /^\s*>/.test(l) || LIST_RE.test(l)
    || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l) || (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]));
}

function parseList(lines, start) {
  const first = lines[start].match(LIST_RE);
  const base = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const block = { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_RE);
    if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
    let text = m[3];
    let task = null;
    const t = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (t) { task = t[1].toLowerCase() === 'x'; text = t[2]; }
    const body = [text];
    i++;
    // Continuation lines and nested content: indented deeper than the marker, or lazy continuation.
    const childLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        if (i + 1 < lines.length && lines[i + 1].trim() && indentOf(lines[i + 1]) > base) { childLines.push(''); i++; continue; }
        break;
      }
      if (indentOf(l) > base) { childLines.push(l); i++; continue; }
      if (!LIST_RE.test(l) && !startsBlock(lines, i) && !childLines.length) { body.push(l.trim()); i++; continue; }
      break;
    }
    const minIndent = Math.min(...childLines.filter((l) => l.trim()).map(indentOf), Infinity);
    const children = [];
    if (childLines.length) {
      const dedented = childLines.map((l) => l.slice(Math.min(minIndent, indentOf(l))));
      // Leading non-list lines continue the item's own text.
      while (dedented.length && dedented[0].trim() && !LIST_RE.test(dedented[0]) && !/^\s*(```|~~~|>|\|)/.test(dedented[0])) body.push(dedented.shift().trim());
      children.push(...parseLines(dedented));
    }
    block.items.push({ text: body, task, children });
    if (i < lines.length && !lines[i].trim()) {
      // A blank line between items keeps the list going.
      if (i + 1 < lines.length && LIST_RE.test(lines[i + 1]) && indentOf(lines[i + 1]) === base) { i++; continue; }
      break;
    }
  }
  return [block, i];
}

/** Join paragraph lines. Report lines like `**Site:** …` are meant as separate lines, so a line break
 *  is kept before a line that starts with bold or after one ending in two spaces or a backslash. */
export function joinLines(lines) {
  let out = '';
  lines.forEach((l, n) => {
    if (n === 0) { out = inline(l.replace(/\s*\\$|\s{2,}$/, '').trim()); return; }
    const prev = lines[n - 1];
    const hard = /\s{2,}$|\\$/.test(prev) || /^\s*\*\*/.test(l);
    out += (hard ? '<br>' : ' ') + inline(l.replace(/\s*\\$|\s{2,}$/, '').trim());
  });
  return out;
}

export function renderBlocks(blocks, { headingOffset = 0 } = {}) {
  return blocks.map((b) => renderBlock(b, headingOffset)).join('\n');
}

function renderBlock(b, off) {
  switch (b.type) {
    case 'heading': {
      const lvl = Math.min(6, b.level + off);
      return `<h${lvl}>${inline(b.text)}</h${lvl}>`;
    }
    case 'para': return `<p>${joinLines(b.lines)}</p>`;
    case 'hr': return '<hr>';
    case 'code': return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
    case 'quote': return `<blockquote>${renderBlocks(b.blocks, { headingOffset: off })}</blockquote>`;
    case 'table': {
      // A column with no header whose cells are only status marks becomes a narrow flag column.
      const flag = b.head.map((h, i) => !h.trim() && b.rows.length > 0 && b.rows.every((r) => /^(<span class="mk [a-z]+"[^>]*><\/span>)?$/.test(inline(r[i] ?? '').trim())));
      const al = (i) => {
        const cls = [flag[i] ? 'flag' : null, b.align[i] === 'right' ? 'num' : b.align[i] === 'center' ? 'center' : null].filter(Boolean);
        return cls.length ? ` class="${cls.join(' ')}"` : '';
      };
      const head = b.head.map((c, i) => `<th${al(i)}>${inline(c)}</th>`).join('');
      const rows = b.rows.map((r) => `<tr>${b.head.map((_, i) => `<td${al(i)}>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('\n');
      return `<div class="tbl-wrap"><table><thead><tr>${head}</tr></thead><tbody>\n${rows}\n</tbody></table></div>`;
    }
    case 'list': {
      const tasks = b.items.some((it) => it.task !== null);
      const tag = b.ordered ? 'ol' : 'ul';
      const startAttr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      const items = b.items.map((it) => {
        const cls = it.task === null ? '' : ` class="task${it.task ? ' done' : ''}"`;
        const kids = it.children.length ? renderBlocks(it.children, { headingOffset: off }) : '';
        return `<li${cls}>${joinLines(it.text)}${kids}</li>`;
      }).join('\n');
      return `<${tag}${startAttr}${tasks ? ' class="checklist"' : ''}>\n${items}\n</${tag}>`;
    }
    default: return '';
  }
}

/** Plain text of an inline Markdown string (for labels and extraction). */
export function plain(text) {
  return String(text)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, '$1$2')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
