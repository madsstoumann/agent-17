# Third-party notices

## cloudflare/security-audit-skill

The deep review (`--deep`: [deep.md](deep.md), [deep-classes.md](deep-classes.md), and the evidence
rules that `scripts/deep-check.mjs` enforces) adapts the method and the attack classes of
Cloudflare's security-audit skill, <https://github.com/cloudflare/security-audit-skill>: the
reconnaissance and coverage ledger, the hunting method, refutation of every candidate by a fresh
agent, the confirmed / needs-validation / rejected verdicts with severity only on confirmed records,
and the severity anchors. The text here is condensed and reworded for a read-only review that never
runs the target's code, and no code was copied. The client-side checks of site mode `--deep`
follow the same skill's client-side attack classes.

```
MIT License

Copyright (c) 2025-2026 Cloudflare, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
