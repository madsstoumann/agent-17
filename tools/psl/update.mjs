#!/usr/bin/env node
// Refreshes the vendored Public Suffix List (psl.dat.gz) in every skill that carries lib/hosts.mjs.
//   node tools/psl/update.mjs
// Then run those skills' tests and add a changelog line ("Public Suffix List updated").
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
const res = await fetch('https://publicsuffix.org/list/public_suffix_list.dat');
if (!res.ok) throw new Error(`publicsuffix.org answered ${res.status}`);
const text = await res.text();
if (!text.includes('===BEGIN PRIVATE DOMAINS===')) throw new Error('unexpected list format');
const gz = gzipSync(Buffer.from(text), { level: 9 });
for (const skill of readdirSync(ROOT)) {
  const lib = join(ROOT, skill, 'scripts', 'lib');
  if (!existsSync(join(lib, 'hosts.mjs'))) continue;
  writeFileSync(join(lib, 'psl.dat.gz'), gz);
  console.log(`updated ${skill}/scripts/lib/psl.dat.gz`);
}
