import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { findChrome, launch, render, TEXT_MEASURE } from '../lib/render.mjs';

// The words "Text without JavaScript" compares with the served HTML: a consent manager's container
// (Cookie Information mounts its whole cookie policy in #cookie-information-template-wrapper) and
// hidden text are not text a reader sees.
const PAGE = `<!doctype html><html lang="da"><head><title>Example</title></head><body>
<main><h1>Velkommen</h1><p>one two three four five six seven eight nine ten</p>
<details><summary>Spørgsmål</summary><p>closed accordion words here</p></details>
<div style="display:none"><h2>Hidden heading</h2><p>hidden hidden hidden hidden</p></div></main>
<script>
  const w = document.createElement('div');
  w.id = 'cookie-information-template-wrapper';
  w.innerHTML = '<div id="coiOverlay"><h2>Cookies</h2><p>' + 'cookie '.repeat(400) + '</p><h3>Cookiepolitik</h3><h3>Om cookies</h3></div>';
  document.body.appendChild(w);
  const ot = document.createElement('div'); ot.id = 'onetrust-banner-sdk'; ot.textContent = 'consent '.repeat(50); document.body.appendChild(ot);
</script></body></html>`;

test('TEXT_MEASURE leaves out consent managers (Cookie Information included) and hidden text', { timeout: 60000 }, async (t) => {
  const chrome = findChrome();
  if (!chrome) { t.skip('no Chrome'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-seo-render-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, PAGE);
  const browser = await launch({ chromePath: chrome });
  try {
    const r = await render(browser, pathToFileURL(file).toString(), { measure: TEXT_MEASURE, settleMs: 200 });
    assert.ok(r.ok, r.error);
    // "Velkommen" + ten words + "Spørgsmål" (the summary of a closed <details> shows; its body does not).
    assert.equal(r.measured.words, 12);
    assert.equal(r.measured.headings, 1, 'only the visible h1: not the consent headings, not the hidden h2');
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
