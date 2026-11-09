/**
 * Sample pages for showing a JSON-LD draft in Google's Rich Results Test (Code tab) or
 * validator.schema.org (Code snippet tab): the site graph and a template draft merged into the one
 * @graph the page would carry, wrapped in a small HTML page. With a copy of the live page, the
 * same graph replaces the page's own JSON-LD, so the sample looks like the page after the work.
 *
 * Zero dependencies. Node >= 22. Pure.
 */

const LD_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>[\s\S]*?<\/script\s*>/gi;

/** The nodes of a JSON-LD value: @graph members, array items, or the object itself, without @context. */
export function nodesOf(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(nodesOf);
  if (Array.isArray(value['@graph'])) return value['@graph'].flatMap(nodesOf);
  const { '@context': _ctx, ...node } = value;
  return Object.keys(node).length ? [node] : [];
}

/**
 * mergeGraph(site, draft) -> { '@context', '@graph' }: the site graph's nodes first, then the
 * draft's. A draft node with the same @id as a site node is merged into it (the draft's
 * properties win), as an about page that adds founding facts to #organization does.
 */
export function mergeGraph(site, draft) {
  const out = [];
  const byId = new Map();
  for (const node of [...nodesOf(site), ...nodesOf(draft)]) {
    const id = node['@id'];
    if (id && byId.has(id)) {
      const i = byId.get(id);
      out[i] = { ...out[i], ...node };
    } else {
      if (id) byId.set(id, out.length);
      out.push({ ...node });
    }
  }
  return { '@context': 'https://schema.org', '@graph': out };
}

/** JSON for inside a <script>: "<" escaped, so text in the graph cannot close the tag. */
export const scriptJson = (graph) => JSON.stringify(graph, null, 2).replace(/</g, '\\u003c');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * sampleHtml({ graph, url, title, draft, notes, lang }) -> a standalone page: the graph in <head>,
 * and in <body> what the sample is, which page it is for and how to test it.
 */
export function sampleHtml({ graph, url = null, title = null, draft = null, notes = [], lang = 'en' }) {
  const name = title || url || draft || 'JSON-LD sample';
  const body = [
    `<h1>Sample: ${esc(name)}</h1>`,
    `<p>The structured data proposed for ${url ? `<a href="${esc(url)}">${esc(url)}</a>` : 'this page'}${draft ? `, from <code>${esc(draft)}</code>` : ''}, merged with the site graph into the one JSON-LD block the page would carry.</p>`,
    '<p>Paste this whole file into Google\'s Rich Results Test (<a href="https://search.google.com/test/rich-results">search.google.com/test/rich-results</a>, Code tab) or the schema.org validator (<a href="https://validator.schema.org">validator.schema.org</a>, Code snippet tab).</p>',
    notes.length ? `<ul>\n${notes.map((n) => `<li>${esc(n)}</li>`).join('\n')}\n</ul>` : '',
  ].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="${esc(lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sample: ${esc(name)}</title>
<script type="application/ld+json">
${scriptJson(graph)}
</script>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/**
 * injectLive(html, { graph, url }) -> { html, removed }: the live page with its own JSON-LD blocks
 * removed (the draft is the proposed markup for the whole page), the graph added before </head>,
 * and a <base href> so its stylesheets, images and links still load from the site.
 */
export function injectLive(html, { graph, url }) {
  let src = String(html || '');
  let removed = 0;
  src = src.replace(LD_SCRIPT, () => { removed++; return ''; });
  const script = `<script type="application/ld+json">\n${scriptJson(graph)}\n</script>\n`;
  const base = /<base\b[^>]*href/i.test(src) || !url ? '' : `<base href="${esc(url)}">\n`;
  const head = src.match(/<head\b[^>]*>/i);
  if (head) {
    const at = head.index + head[0].length;
    src = `${src.slice(0, at)}\n${base}${src.slice(at)}`;
    const close = src.search(/<\/head\s*>/i);
    src = close >= 0 ? `${src.slice(0, close)}${script}${src.slice(close)}` : src.replace(base, `${base}${script}`);
  } else {
    src = `<head>\n${base}${script}</head>\n${src}`;
  }
  return { html: src, removed };
}

/** samplesReadme({ host, rows, live }) -> samples/README.md. rows: [{ file, live, url, types, validator, required, notOnPage, removed }] */
export function samplesReadme({ host, rows, live = false, date = new Date() }) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const v = (r) => (r.validator == null ? 'not checked (--no-remote)' : r.validator.error ? `not reached (${r.validator.error})` : `${r.validator.errors} errors, ${r.validator.warnings} warnings`);
  const g = (r) => (r.required.length ? `needs ${r.required.join(', ')} for the rich result` : 'nothing missing');
  const out = [
    `# JSON-LD samples: ${host}`, '',
    `${date.toISOString().slice(0, 10)} · One file per draft in \`markup/\`, merged with \`markup/site.jsonld\` into the one JSON-LD block the page would carry.`, '',
    '## How to show them', '',
    '1. Open a file and copy all of it.',
    '2. Paste it into Google\'s Rich Results Test (https://search.google.com/test/rich-results, *Code* tab) or the schema.org validator (https://validator.schema.org, *Code snippet* tab).',
    live ? '3. The `.live.html` files are the live page with its own JSON-LD replaced by the sample\'s and a `<base href>`, so the page still loads its styles and images when opened in a browser.' : '',
    '', '| Sample | Page | Types | validator.schema.org | Google\'s rich-result rules | Values not on the page |', '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| [${cell(r.file)}](${r.file})${r.live ? ` · [live](${r.live})` : ''} | ${cell(r.url || '')} | ${cell(r.types.join(', '))} | ${cell(v(r))} | ${cell(g(r))} | ${r.notOnPage ? r.notOnPage : 0} |`),
    '',
    'A missing rich-result property the page does not show (a price, a rating) stays missing: the markup is for meaning, and the Rich Results Test then marks that item invalid. Values not on the page must be removed from the draft, or the page must show them first, before a sample goes to the client.',
    '',
  ];
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
