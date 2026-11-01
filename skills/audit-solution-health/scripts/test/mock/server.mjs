// Mock provider for the end-to-end test: a "DAWA" endpoint that sends RFC 9745/8594 deprecation headers,
// a PSP health endpoint, and the HTML pages in this folder as watch pages.
// Usage: node server.mjs [port]   (prints "mock up <port>" when listening)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8787);
const pages = process.env.MOCK_PAGES_DIR || here;

createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/adgangsadresser') {
    res.writeHead(200, {
      'content-type': 'application/json',
      Deprecation: '@1751320800', // 2025-06-30T22:00:00Z, RFC 9745 structured-field date
      Sunset: 'Wed, 01 Jul 2026 00:00:00 GMT',
      Link: `<https://adressevaelger.dk>; rel="successor-version", <http://127.0.0.1:${port}/docs>; rel="deprecation"`,
    });
    return res.end('[]');
  }
  if (u.pathname === '/psp/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  const f = join(pages, `${u.pathname === '/' ? 'index' : u.pathname.slice(1)}.html`);
  if (existsSync(f)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(readFileSync(f)); }
  res.writeHead(404); res.end('not found');
}).listen(port, '127.0.0.1', () => console.log(`mock up ${port}`));
