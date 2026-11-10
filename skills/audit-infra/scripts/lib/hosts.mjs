/**
 * Who owns a host name, from the Public Suffix List (publicsuffix.org, vendored as psl.dat.gz) and
 * hosts.json (platform facts the list does not hold). Shared by audit-launch, audit-security and
 * audit-infra as identical copies (tested); update the list with tools/psl/update.mjs.
 *
 *   publicSuffix('a.b.example.co.uk')      -> { suffix: 'co.uk', private: false }
 *   publicSuffix('x.vercel.app')           -> { suffix: 'vercel.app', private: true }
 *   registrableDomain('a.b.example.co.uk') -> 'example.co.uk'
 *   subLabels('a.b.example.co.uk')         -> ['a', 'b']
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { domainToASCII } from 'node:url';

const HERE = new URL('.', import.meta.url);
let RULES = null;

function load() {
  if (RULES) return RULES;
  RULES = new Map();
  let priv = false;
  const text = gunzipSync(readFileSync(new URL('psl.dat.gz', HERE))).toString('utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.includes('===BEGIN PRIVATE DOMAINS===')) priv = true;
    if (!line || line.startsWith('//')) continue;
    const rule = line.split(/\s/)[0];
    const exception = rule.startsWith('!');
    const body = exception ? rule.slice(1) : rule;
    const ascii = body.split('.').map((l) => (l === '*' ? '*' : domainToASCII(l) || l)).join('.');
    RULES.set(exception ? `!${ascii}` : ascii, priv);
  }
  return RULES;
}

export const HOSTS = JSON.parse(readFileSync(new URL('hosts.json', HERE), 'utf8'));

const clean = (host) => String(host || '').toLowerCase().trim().replace(/:\d+$/, '').replace(/\.$/, '').replace(/^\[|\]$/g, '');
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');

/**
 * The public suffix of a host: the longest PSL rule that matches (exceptions and wildcards applied),
 * else its last label. `icann: true` uses only the ICANN section (the DNS zone apex view: a
 * platform's own domain, not its customers' sub-domains). null for an IP or an empty host.
 */
export function publicSuffix(host, { icann = false } = {}) {
  const h = clean(host);
  if (!h || isIp(h)) return null;
  const rules = load();
  const labels = h.split('.');
  for (let i = 0; i < labels.length; i++) {
    const name = labels.slice(i).join('.');
    const priv = (r) => rules.get(r);
    const ok = (r) => rules.has(r) && !(icann && priv(r));
    if (ok(`!${name}`)) return { suffix: labels.slice(i + 1).join('.'), private: priv(`!${name}`) };
    if (ok(name)) return { suffix: name, private: priv(name) };
    if (i + 1 < labels.length && ok(`*.${labels.slice(i + 1).join('.')}`)) return { suffix: name, private: priv(`*.${labels.slice(i + 1).join('.')}`) };
  }
  return { suffix: labels.at(-1), private: false };
}

/** The registrable domain (the public suffix and one label more), or null when the host is a public suffix itself. */
export function registrableDomain(host, opts = {}) {
  const h = clean(host);
  const ps = publicSuffix(h, opts);
  if (!ps || h === ps.suffix) return null;
  const rest = h.slice(0, -(ps.suffix.length + 1)).split('.');
  return `${rest.at(-1)}.${ps.suffix}`;
}

/** The labels below the registrable domain, outermost first: 'a.b.example.co.uk' -> ['a', 'b']. */
export function subLabels(host, opts = {}) {
  const h = clean(host);
  const reg = registrableDomain(h, opts);
  if (!reg || h === reg) return [];
  return h.slice(0, -(reg.length + 1)).split('.');
}

/** True when the name is a public suffix (anyone can register or deploy below it): 'vercel.app', 'co.uk', 'com'. */
export function isPublicSuffix(name) {
  const h = clean(name);
  const ps = publicSuffix(h);
  return !!ps && ps.suffix === h;
}

/**
 * The platform that owns a host's name when the host is an address on someone else's domain: a PSL
 * private-section suffix ('x.vercel.app' -> 'vercel.app') or a platform in hosts.json that the list
 * does not hold ('x.euwest01.umbraco.io' -> 'umbraco.io'). null for a site's own domain.
 */
export function platformOf(host) {
  const h = clean(host);
  if (!h || isIp(h)) return null;
  const ps = publicSuffix(h);
  if (ps && ps.private) return ps.suffix;
  return HOSTS.platforms.find((p) => h === p || h.endsWith(`.${p}`)) || null;
}

const STAGING_WORD = new RegExp(`^(?:${HOSTS.stagingWords.join('|')})$`, 'i');

/**
 * The label that marks a non-production host, or null. Only labels below the registrable domain
 * count, each split on - and _ ('dev.example.com', 'site-stage.example.co.uk', 'stage-x.region.platform.io'):
 * a site whose own name is the word ('dev.<tld>', 'demo-shop.<tld>') is not a staging host.
 */
export function stagingLabel(host) {
  for (const label of subLabels(host)) {
    if (label === 'www') continue;
    if (label.split(/[-_]/).some((p) => STAGING_WORD.test(p))) return label;
  }
  return null;
}

/** True when the host is a deployment platform's preview or default address (hosts.json previewSuffixes). */
export function isPreviewPlatform(host) {
  const h = clean(host);
  return HOSTS.previewSuffixes.some((s) => h === s || h.endsWith(`.${s}`));
}
