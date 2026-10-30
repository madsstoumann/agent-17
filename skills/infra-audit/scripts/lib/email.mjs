// Mail authentication for the email domain: SPF (followed through every include), DMARC
// (including external report destinations), DKIM, MTA-STS, TLS-RPT and BIMI.

const SPF_RE = /^v=spf1(\s|$)/i;
const LOOKUP = /^[-~?+]?(include:|a(?=$|[:/])|mx(?=$|[:/])|ptr(?=$|:)|exists:)/i;

/**
 * spfTree(domain, resolver) -> { record, records, terminal, lookups, voids, includes: [{ domain, record, error }], problems: [] }
 * Counts DNS-querying terms across the whole include/redirect tree, the way receivers do
 * (RFC 7208 §4.6.4: more than 10 is a permerror; more than 2 void lookups too).
 */
export async function spfTree(domain, resolver, { maxDepth = 10 } = {}) {
  const out = { domain, record: null, records: [], terminal: null, lookups: 0, voids: 0, includes: [], problems: [] };
  const top = await txtSpf(domain, resolver);
  out.records = top.records;
  if (top.error) { out.problems.push(top.error); return out; }
  if (!top.records.length) return out;
  if (top.records.length > 1) { out.problems.push(`${top.records.length} SPF records on ${domain}; receivers treat several as a permanent error`); return out; }
  out.record = top.records[0];
  const seen = new Set([domain]);
  async function walk(record, depth, isTop) {
    for (const term of record.split(/\s+/).slice(1)) {
      const all = /^([-~?+]?)all$/i.exec(term);
      if (all) { if (isTop) out.terminal = `${all[1] || '+'}all`; continue; }
      if (/^ptr/i.test(term.replace(/^[-~?+]/, ''))) out.problems.push(`"${term}" uses ptr, which RFC 7208 says not to use`);
      const redirect = /^redirect=(.+)$/i.exec(term);
      const include = /^[-~?+]?include:(.+)$/i.exec(term);
      if (LOOKUP.test(term) || redirect) out.lookups++;
      const target = (include || redirect)?.[1];
      if (!target) continue;
      if (seen.has(target) || depth >= maxDepth) { if (seen.has(target)) out.problems.push(`include loop at ${target}`); continue; }
      seen.add(target);
      const sub = await txtSpf(target, resolver);
      const rec = sub.records[0] || null;
      out.includes.push({ domain: target, record: rec, error: sub.error || (sub.records.length ? null : 'no SPF record') });
      if (!rec) { out.voids++; out.problems.push(`${include ? 'include' : 'redirect'}:${target} has no SPF record (a permanent error for receivers)`); continue; }
      if (redirect && isTop && !out.terminal) {
        const t = /(?:^|\s)([-~?+]?)all(?:\s|$)/i.exec(rec);
        if (t) out.terminal = `${t[1] || '+'}all (via redirect)`;
      }
      await walk(rec, depth + 1, false);
    }
  }
  await walk(out.record, 0, true);
  return out;
}

async function txtSpf(name, resolver) {
  try {
    const r = await resolver.query(name, 'TXT');
    if (!r.ok) return { records: [], error: `TXT ${name}: ${r.error}` };
    return { records: r.answers.filter((a) => a.type === 'TXT').map((a) => a.data.trim()).filter((t) => SPF_RE.test(t)) };
  } catch (e) { return { records: [], error: e.message }; }
}

/** spf tree -> { status, evidence, fix } */
export function judgeSpf(t, { hasMx }) {
  if (!t.records.length && !t.problems.length) {
    return hasMx
      ? { status: 'warn', evidence: 'no SPF record, but the domain receives mail', fix: 'Publish one TXT `v=spf1 include:<your mail provider> -all`.' }
      : { status: 'info', evidence: 'no SPF record and no MX', fix: 'If the domain never sends mail, publish `v=spf1 -all` so nobody can send as it.' };
  }
  if (!t.record) return { status: 'fail', evidence: t.problems.join('; '), fix: 'Keep exactly one v=spf1 TXT record.' };
  const notes = [`${t.terminal || 'no all'}`, `${t.lookups} DNS lookup${t.lookups === 1 ? '' : 's'} across ${t.includes.length} include${t.includes.length === 1 ? '' : 's'}`];
  const fixes = [];
  let status = 'pass';
  if (t.lookups > 10) { status = 'fail'; fixes.push('Cut the tree to 10 lookups or fewer (drop unused includes, or flatten one); past 10 receivers return permerror and SPF fails for all mail'); }
  if (t.voids > 2) { status = 'fail'; fixes.push('Remove includes that point at names with no SPF record'); }
  else if (t.voids) { status = status === 'fail' ? status : 'warn'; fixes.push('Remove includes that point at names with no SPF record'); }
  if (!t.terminal) { status = status === 'fail' ? status : 'warn'; fixes.push('End the record with -all or ~all'); }
  else if (/^\+all|^\?all/.test(t.terminal)) { status = 'fail'; fixes.push(`Replace ${t.terminal}: it lets any server send as the domain`); }
  if (t.problems.length && status === 'pass') status = 'warn';
  return { status, evidence: `\`${t.record}\` (${notes.join(', ')})${t.problems.length ? `; ${t.problems.join('; ')}` : ''}`, fix: fixes.join('; ') };
}

export function parseTags(record) {
  const tags = {};
  for (const part of String(record).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return tags;
}

/**
 * dmarc(domain, resolver) -> { status, evidence, fix, record, tags, external: [{ domain, authorized }] }
 * External rua/ruf destinations must publish <domain>._report._dmarc.<dest> (RFC 7489 §7.1),
 * or receivers drop the reports.
 */
export async function dmarc(domain, resolver, { hasMx }) {
  const r = await resolver.query(`_dmarc.${domain}`, 'TXT');
  if (!r.ok) return { status: 'skip', evidence: `lookup failed: ${r.error}` };
  const recs = r.answers.filter((a) => a.type === 'TXT' && /^v\s*=\s*DMARC1/i.test(a.data)).map((a) => a.data);
  if (!recs.length) return { status: hasMx ? 'fail' : 'warn', evidence: `no DMARC record at _dmarc.${domain}`, fix: `Publish \`v=DMARC1; p=none; rua=mailto:dmarc@${domain}\`, read the reports for a few weeks, then move to p=quarantine and p=reject.` };
  if (recs.length > 1) return { status: 'fail', evidence: `${recs.length} DMARC records; receivers ignore all of them`, fix: 'Keep one.' };
  const tags = parseTags(recs[0]);
  const p = (tags.p || '').toLowerCase();
  const sp = (tags.sp || p).toLowerCase();
  const pct = tags.pct ? Number(tags.pct) : 100;
  const dests = [tags.rua, tags.ruf].filter(Boolean).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  const external = [];
  for (const d of dests) {
    const m = /^mailto:[^@]+@([^!\s]+)/i.exec(d);
    if (!m) continue;
    const dest = m[1].toLowerCase();
    if (dest === domain || dest.endsWith(`.${domain}`) || domain.endsWith(`.${dest}`)) continue;
    if (external.some((e) => e.domain === dest)) continue;
    const auth = await resolver.query(`${domain}._report._dmarc.${dest}`, 'TXT');
    external.push({ domain: dest, authorized: auth.ok ? auth.answers.some((a) => /^v=DMARC1/i.test(a.data)) : null });
  }
  const fixes = [];
  let status = 'pass';
  if (!['none', 'quarantine', 'reject'].includes(p)) { status = 'fail'; fixes.push('Add a valid p= tag; without it the record is ignored'); }
  else if (p === 'none') { status = 'warn'; fixes.push('p=none only monitors: move to p=quarantine, then p=reject once the reports are clean'); }
  if (sp === 'none' && p !== 'none') { status = status === 'fail' ? status : 'warn'; fixes.push('sp=none leaves subdomains open to spoofing'); }
  if (pct < 100) { status = status === 'fail' ? status : 'warn'; fixes.push(`pct=${pct} filters only part of the forged mail`); }
  if (!tags.rua) fixes.push('Add rua=mailto:… to receive aggregate reports');
  const unauth = external.filter((e) => e.authorized === false);
  if (unauth.length) { status = status === 'fail' ? status : 'warn'; fixes.push(`${unauth.map((e) => e.domain).join(', ')} must publish \`${domain}._report._dmarc.<dest>\` TXT "v=DMARC1", or reports to it are dropped`); }
  const bits = [`p=${p || '?'}`, sp !== p ? `sp=${sp}` : '', pct < 100 ? `pct=${pct}` : '', tags.adkim === 's' ? 'adkim=s' : '', tags.aspf === 's' ? 'aspf=s' : '', tags.rua ? `rua ${tags.rua}` : 'no rua'].filter(Boolean);
  return { status, evidence: bits.join(', '), fix: fixes.join('; '), record: recs[0], tags, external };
}

export const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'k1', 'k2', 'k3', 'mail', 'dkim', 's1', 's2', 'mxvault', 'mandrill', 'smtp', 'sig1', 'protonmail', 'hs1', 'hs2', 'zendesk1', 'cm', 'mailjet', 'sendgrid', 'em', 'scph0920'];

/** Approximate RSA key size from the base64 p= length of a DKIM record. */
export function dkimKeyBits(record) {
  const p = parseTags(record).p;
  if (!p) return { revoked: true, bits: null };
  const bytes = Buffer.from(p.replace(/\s+/g, ''), 'base64').length;
  if (/k=ed25519/i.test(record)) return { revoked: false, bits: 256, type: 'ed25519' };
  // SubjectPublicKeyInfo overhead is ~38 bytes for RSA keys of 1024 bits and up.
  const bits = bytes > 40 ? Math.round(((bytes - 38) * 8) / 256) * 256 : bytes * 8;
  return { revoked: false, bits, type: 'rsa' };
}

export async function dkim(domain, resolver, { selectors = DKIM_SELECTORS } = {}) {
  const found = [];
  await Promise.all(selectors.map(async (s) => {
    const r = await resolver.query(`${s}._domainkey.${domain}`, 'TXT');
    if (!r.ok) return;
    const rec = r.answers.filter((a) => a.type === 'TXT').map((a) => a.data).find((t) => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(t));
    if (rec) found.push({ selector: s, record: rec, ...dkimKeyBits(rec) });
  }));
  return found.sort((a, b) => a.selector.localeCompare(b.selector));
}

/** MTA-STS: _mta-sts TXT plus the policy file; testing mode is info, enforce passes. */
export async function mtaSts(domain, resolver, { fetch: fetchImpl = globalThis.fetch, timeout = 10000 } = {}) {
  const r = await resolver.query(`_mta-sts.${domain}`, 'TXT');
  const txt = r.ok ? r.answers.filter((a) => a.type === 'TXT').map((a) => a.data).find((t) => /^v=STSv1/i.test(t)) : null;
  if (!txt) return { present: false };
  const url = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
  try {
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if (res.status !== 200) return { present: true, txt, url, error: `policy file answered ${res.status}` };
    const body = await res.text();
    const policy = {};
    const mx = [];
    for (const line of body.split(/\r?\n/)) {
      const m = /^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i.exec(line);
      if (!m) continue;
      if (m[1].toLowerCase() === 'mx') mx.push(m[2].toLowerCase()); else policy[m[1].toLowerCase()] = m[2];
    }
    return { present: true, txt, url, mode: (policy.mode || '').toLowerCase(), maxAge: Number(policy.max_age) || null, mx };
  } catch (e) {
    return { present: true, txt, url, error: e.cause?.code || e.message };
  }
}

/** Does an MTA-STS mx pattern ("*.mail.protection.outlook.com") cover an MX host? */
export const stsCovers = (patterns, host) => patterns.some((p) => p === host || (p.startsWith('*.') && host.endsWith(p.slice(1)) && host.split('.').length === p.split('.').length));
