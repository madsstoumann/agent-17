import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderStdout, escapeCell, buildManualLinks, scoreboardRows, STATUS_GLYPH } from '../lib/report.mjs';
import { result } from '../lib/registry.mjs';

function sample({ production }) {
  return {
    schemaVersion: 1, tool: 'launch-audit', version: '1.0.0', generatedAt: '2026-09-24T06:05:00.000Z', durationMs: 123456,
    input: { url: 'https://dev.example.com/', env: production ? 'production' : 'dev', envSource: production ? 'auto' : 'flag', envReason: production ? 'no staging marker in hostname' : 'given on the command line', production, productionHost: 'www.example.com' },
    site: { finalUrl: 'https://dev.example.com/', host: 'dev.example.com', ip: '1.2.3.4', server: 'cloudflare', httpVersion: '2', lighthouse: { runner: 'local', version: '13.5.0' } },
    counts: { pass: 3, warn: 2, fail: 1, info: 2, skip: 1 },
    blockers: production ? ['exposed.secret-files'] : ['exposed.secret-files'],
    beforeProduction: production ? [] : [{ id: 'crawl.meta-robots', title: 'Meta robots', originalStatus: 'fail', evidence: 'noindex, nofollow', fix: 'Remove noindex' }],
    scoreboard: {
      lighthouse: { runner: 'local', version: '13.5.0', mobile: { performance: 71, accessibility: 95, bestPractices: 100, seo: 69, agentic: '1/2', seoNoindexAffected: true }, desktop: null },
      cwvLab: { LCP: { display: '3.1 s', rating: 'warn' }, CLS: { display: '0.02', rating: 'pass' }, TBT: { display: '450 ms', rating: 'warn' } },
      cwvField: null,
      headersGrade: { grade: 'A', estimated: true, link: 'https://securityheaders.com/?q=x' },
      headersScraped: null,
      observatory: { grade: 'B', score: 70, passed: 9, total: 12, link: 'https://developer.mozilla.org/en-US/observatory/analyze?host=x' },
      w3c: { errors: 128, warnings: 7, distinct: 12, link: 'https://validator.w3.org/nu/?doc=x' },
      schema: { objects: 1, errors: 0, warnings: 0, types: ['WebSite'], link: 'https://validator.schema.org/#url=x' },
      tls: { protocol: 'TLSv1.3', issuer: "Let's Encrypt", daysLeft: 61 },
    },
    results: [
      result('crawl.meta-robots', production ? 'fail' : 'info', 'Meta robots', 'noindex | nofollow', { fix: 'Remove noindex', beforeProduction: true, ...(production ? { blocker: true } : {}) }),
      result('crawl.title', 'pass', 'Title', 'IO Interactive'),
      result('exposed.secret-files', 'fail', 'Secret files', '/.env served (200)', { fix: 'Block it', blocker: true }),
      result('headers.observatory', 'warn', 'MDN Observatory', 'B (70)', { link: 'https://developer.mozilla.org/en-US/observatory/analyze?host=x' }),
      result('headers.securityheaders-scrape', 'skip', 'securityheaders.com grade', 'Cloudflare challenge blocked the headless browser'),
      result('perf.lighthouse-mobile', 'warn', 'Lighthouse (mobile)', 'Perf 71'),
      result('ops.uptime', 'info', 'Uptime monitoring', 'Confirm a monitor watches the production URL'),
      result('ops.errors', 'info', 'Error tracking', 'Confirm the production DSN'),
      result('a11y.page', 'pass', 'Accessibility (page)', '96', { subject: 'https://dev.example.com/about' }),
    ],
    pages: [{ url: 'https://dev.example.com/', status: 200, title: 'Home', h1Count: 1, imgNoAlt: 0, mixedContent: 0 }],
    manual: buildManualLinks({ url: 'https://dev.example.com/', host: 'dev.example.com' }),
    raw: { lighthouse: ['lighthouse-mobile.json'], w3c: 'w3c.json' },
    timings: { crawl: 1200 },
    diff: null,
  };
}

test('escapeCell escapes pipes and newlines and truncates', () => {
  assert.equal(escapeCell('a|b\nc'), 'a\\|b<br>c');
  assert.equal(escapeCell('x'.repeat(300)).length, 241);
  assert.equal(escapeCell(null), '');
});

test('renderMarkdown on a dev report has the Before production checklist and no blockers section', () => {
  const md = renderMarkdown(sample({ production: false }));
  assert.match(md, /^# Launch audit — dev\.example\.com/);
  assert.match(md, /Environment:\*\* dev \(from --env\)/);
  assert.ok(md.includes('## Before production'), 'before production section');
  assert.ok(md.includes('- [ ] **Meta robots** — noindex, nofollow → Remove noindex'));
  assert.ok(md.includes('## Launch blockers'), 'a real blocker (secret file) is listed even on dev');
  assert.ok(md.includes('SEO 69 (depressed by noindex'), 'seo annotation');
  const order = ['## 1. Crawlability', '## 2. Redirects', '## 3. Real 404s', '## 4. TLS, DNS & email', '## 5. Exposed files', '## 6. Security headers', '## 7. Caching', '## 8. Performance', '## 9. Accessibility', '## 10. Privacy', '## 11. Links', '## 12. Operational readiness', '## Manual checks'];
  let last = -1;
  for (const h of order) { const i = md.indexOf(h); assert.ok(i > last, `${h} in order`); last = i; }
  assert.ok(md.includes('noindex \\| nofollow'), 'pipe escaped');
  assert.ok(md.includes('- [ ] Uptime monitoring'), 'ops as checklist');
  assert.ok(md.includes('| ⏭️ | securityheaders.com grade |'), 'skip glyph row');
  assert.ok(md.includes('(page: https://dev.example.com/about)') || md.includes('https://dev.example.com/about'), 'subject shown');
  assert.ok(!md.includes('## Since last run'));
  assert.ok(md.includes('securityheaders.com/?q='), 'manual link');
  assert.ok(md.includes('<details>'), 'appendix');
});

test('renderMarkdown on a production report has blockers and no Before production section', () => {
  const md = renderMarkdown(sample({ production: true }));
  assert.ok(md.includes('## Launch blockers'));
  assert.ok(!md.includes('## Before production'));
  assert.match(md, /Environment:\*\* production \(auto from hostname — pass --env to override\)/);
});

test('renderMarkdown renders the diff section when present', () => {
  const r = sample({ production: true });
  r.diff = { prevGeneratedAt: '2026-09-20T10:00:00Z', fixed: [{ key: 'a.one', title: 'One', from: 'fail', to: 'pass' }], regressed: [], newFindings: [], removed: [], unchanged: 4, scores: [{ key: 'w3c.errors', from: 128, to: 12, delta: -116 }], envChanged: null };
  const md = renderMarkdown(r);
  assert.ok(md.includes('## Since last run'));
  assert.ok(md.includes('One'));
  assert.ok(md.includes('w3c.errors'));
});

test('renderStdout is compact, lists fails and warns, caps warnings and ends with the paths', () => {
  const r = sample({ production: false });
  for (let i = 0; i < 50; i++) r.results.push(result('links.external-broken', 'warn', `Broken ${i}`, 'x'));
  const out = renderStdout(r, { reportMd: '/tmp/x/report.md', reportJson: '/tmp/x/report.json', maxWarns: 5 });
  const lines = out.split('\n');
  assert.ok(lines.length < 40, `short: ${lines.length}`);
  assert.ok(out.includes('FAIL exposed.secret-files'));
  assert.ok(out.includes('+47 more warnings'));
  assert.ok(out.includes('Before production (1)'));
  assert.ok(out.includes('Skipped: headers.securityheaders-scrape'));
  assert.equal(lines.at(-2), 'Report: /tmp/x/report.md');
  assert.equal(lines.at(-1), 'JSON: /tmp/x/report.json');
});

test('scoreboardRows and manual links', () => {
  const rows = scoreboardRows(sample({ production: false }));
  assert.ok(rows.find((r) => r.label === 'Lighthouse (mobile)'));
  assert.ok(rows.find((r) => r.label.startsWith('Core Web Vitals (field')).value.includes('PSI_API_KEY'));
  const links = buildManualLinks({ url: 'https://a.b/c?d=1', host: 'a.b' });
  assert.ok(links.every((l) => l.title && l.url && l.why));
  assert.ok(links.find((l) => l.url.includes('securityheaders.com/?q=https%3A%2F%2Fa.b%2Fc%3Fd%3D1')));
  assert.equal(Object.keys(STATUS_GLYPH).length, 5);
});
