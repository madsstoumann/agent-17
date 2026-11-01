// From facts to a verdict. Signals are danger (one is enough: the verdict is Dangerous whatever
// else looks fine), warn, info or good. The 0-100 score is supporting detail and is capped by the
// verdict, so good DNS and an old domain can never outvote a blocklist hit or a PayPal lookalike.

export const VERDICTS = {
  dangerous: 'Dangerous: do not log in, pay or download',
  suspicious: 'Suspicious: treat as fake until proven otherwise',
  caution: 'Caution: one thing to check before trusting it',
  'likely-safe': 'Likely safe',
  trusted: 'Trusted',
  unknown: 'Unknown: no red flags, but too little history to vouch for it',
};
const CAP = { dangerous: 10, suspicious: 35, caution: 60, unknown: 65, 'likely-safe': 85, trusted: 100 };
const FLOOR = { trusted: 80, 'likely-safe': 60 };

const sig = (id, level, title, evidence, weight = 0) => ({ id, level, title, evidence, weight });
const age = (d) => (d == null ? 'unknown' : d === 1 ? '1 day' : d < 60 ? `${d} days` : d < 730 ? `${Math.round(d / 30)} months` : `${(d / 365).toFixed(1).replace(/\.0$/, '')} years`);

/**
 * judge(facts) -> { verdict, label, score, signals }
 * facts: { target, landing, official, lookalikes, lures, registration, ct, wayback, tranco, protective,
 *          openphish, safeBrowsing, virusTotal, urlhaus, urlscan, page, pageBrands, faviconMatch,
 *          brandAssets, cloaking, trustpilot, asn }
 */
export function judge(f) {
  const s = [];
  const t = f.landing || f.target;
  const p = f.page && f.page.ok !== false ? f.page : null;
  const asks = p ? [p.password && 'a password', p.card && 'card details', p.cpr && 'a CPR/ID number', p.otp && 'a one-time code'].filter(Boolean) : [];
  const ageDays = f.registration?.ageDays ?? null;
  const young = (ageDays != null && ageDays < 365) || (ageDays == null && f.ct?.firstDays != null && f.ct.firstDays < 365);
  const shared = Boolean(t.sharedHost || t.sharedPage);
  // A brand's own domain or a top-100k site: page wording (crypto, "account locked" help texts) is not a scam signal there.
  const established = f.official?.how === 'listed' || (f.tranco?.rank && f.tranco.rank <= 100000);
  const pageLevel = (lvl) => (established ? 'info' : lvl);

  // ---- Where the link goes
  if (f.landing && f.landing.domain !== f.target.domain) {
    s.push(sig('redirect', f.target.shortener ? 'info' : 'warn', 'Sends you to another domain', `${f.target.host} → ${f.landing.host}${f.target.shortener ? ' (a link shortener; the checks below are for where it lands)' : ''}`, f.target.shortener ? 0 : 5));
  }

  // ---- Is it the real thing, or a copy?
  if (f.official) {
    if (f.official.how === 'listed') s.push(sig('brand.official', 'good', `Official ${f.official.brand.name} domain`, `${t.domain} is one of ${f.official.brand.name}'s own domains`, 40));
    else s.push(sig('brand.country', 'good', `${f.official.brand.name}'s name on a country domain`, `${t.domain} is probably ${f.official.brand.name}'s ${t.tld} site; confirm it is linked from ${f.official.brand.domains[0]}`, 10));
  }
  for (const l of (f.lookalikes || []).slice(0, 3)) {
    const sameBrandOnPage = (f.pageBrands || []).some((b) => b.name === l.brand);
    const copies = [
      young && !shared && `the domain is ${age(ageDays ?? f.ct?.firstDays)} old`,
      shared && `it is a free page on ${t.sharedHost || t.host} that anyone can set up in minutes`,
      asks.length && `the page asks for ${asks.join(' and ')}`,
      sameBrandOnPage && `the page calls itself ${l.brand}`,
      f.faviconMatch === l.brand && `it uses ${l.brand}'s own icon`,
      (f.brandAssets?.[l.brand] || 0) >= 3 && `it loads ${f.brandAssets[l.brand]} files from ${l.brand}'s servers`,
    ].filter(Boolean);
    const lures = f.lures?.length ? ` with "${f.lures.join('", "')}"` : '';
    const strongCopy = copies.some((c) => /asks for|calls itself|own icon|loads/.test(c));
    if (l.strength === 'high' && (copies.length || lures)) s.push(sig(`lookalike.${l.kind}`, 'danger', `Imitates ${l.brand}`, `${l.detail}${lures}; ${copies.length ? copies.join(', ') : 'made to look like the brand'}. ${l.brand}'s real site: ${l.official[0]}`, 50));
    else if (strongCopy) s.push(sig(`lookalike.${l.kind}`, 'danger', `Imitates ${l.brand}`, `${l.detail}; ${copies.join(', ')}. ${l.brand}'s real site: ${l.official[0]}`, 50));
    else if (established) s.push(sig(`lookalike.${l.kind}`, 'info', `Name resembles ${l.brand}`, `${l.detail}; a long-established, widely visited site, so probably a coincidence or a partner`, 0));
    else s.push(sig(`lookalike.${l.kind}`, 'warn', `Name resembles ${l.brand}`, `${l.detail}${lures}. ${l.brand}'s real site: ${l.official[0]}. Not necessarily fake, but check it is linked from there.`, l.strength === 'high' ? 25 : 12));
  }
  const imitated = new Set((f.lookalikes || []).map((l) => l.brand));
  for (const b of f.pageBrands || []) {
    if (imitated.has(b.name) || f.official?.brand?.name === b.name) continue;
    const clone = f.faviconMatch === b.name || (f.brandAssets?.[b.name] || 0) >= 3;
    if (asks.length && (clone || p.password || p.card)) s.push(sig('brand.claimed', 'danger', `Presents itself as ${b.name} on an unrelated domain`, `the page title says ${b.name} and asks for ${asks.join(' and ')}, but ${t.domain} is not one of ${b.name}'s domains (${b.domains.slice(0, 3).join(', ')})`, 50));
    else if (clone) s.push(sig('brand.copy', 'warn', `Looks like a copy of ${b.name}`, `${f.faviconMatch === b.name ? `same icon as ${b.domains[0]}` : `loads ${f.brandAssets[b.name]} files from ${b.name}`}, on ${t.domain}`, 20));
    else s.push(sig('brand.mentioned', 'info', `Mentions ${b.name}`, `the title names ${b.name}; fine for a reseller or article, not for a login or payment page`, 0));
  }
  if (t.punycode) {
    const mixed = (f.scripts || []).length > 1;
    s.push(sig('name.punycode', mixed ? 'warn' : 'info', mixed ? 'Mixes alphabets in the name' : 'International domain name', `${t.host} displays as ${t.unicodeHost}${mixed ? ` (${f.scripts.join(' + ')}), a classic look-alike trick` : ''}`, mixed ? 20 : 0));
  }

  // ---- Already reported?
  const hits = [];
  if (f.protective?.blockedBy?.length) hits.push(`blocked by ${f.protective.blockedBy.join(' and ')}`);
  if (f.openphish?.hits?.length) hits.push(`on the OpenPhish feed (${f.openphish.hits[0]})`);
  if (f.safeBrowsing?.threats?.length) hits.push(`Google Safe Browsing: ${f.safeBrowsing.threats.join(', ').toLowerCase()}`);
  if (f.urlhaus?.listed && f.urlhaus.online) hits.push(`URLhaus: ${f.urlhaus.online} live malware URLs`);
  if (f.virusTotal?.malicious >= 2) hits.push(`VirusTotal: ${f.virusTotal.malicious} engines say malicious`);
  if (hits.length) s.push(sig('blocklist', 'danger', 'Already reported as dangerous', hits.join('; '), 60));
  if (f.urlhaus?.listed && !f.urlhaus.online) s.push(sig('blocklist.urlhaus-old', 'warn', 'Has hosted malware before', `URLhaus lists ${f.urlhaus.urls} URLs on this host, none online now`, 15));
  if (f.virusTotal?.ok && f.virusTotal.malicious < 2 && (f.virusTotal.malicious + f.virusTotal.suspicious) > 0) s.push(sig('blocklist.vt-minor', 'warn', 'One security vendor objects', `VirusTotal: ${f.virusTotal.engines.join('; ')}`, 8));
  if (f.urlscan?.malicious > 0) s.push(sig('blocklist.urlscan', 'warn', 'Earlier scans flagged it', `${f.urlscan.malicious} of ${f.urlscan.total} urlscan.io scans marked malicious`, 15));
  const checkedLists = [f.protective?.checked?.length && f.protective.checked.join(' and '), f.openphish?.ok && 'OpenPhish', f.safeBrowsing?.ok && 'Google Safe Browsing', f.urlhaus?.ok && 'URLhaus', f.virusTotal?.ok && 'VirusTotal'].filter(Boolean);
  if (!hits.length && checkedLists.length) s.push(sig('blocklist.clean', 'good', 'Not on any blocklist checked', `${checkedLists.join(', ')}. New phishing sites are often not listed yet, so this proves little on its own.`, 5));

  // ---- History
  if (shared) {
    s.push(sig('host.shared', asks.length ? 'warn' : 'info', `Free page on ${t.sharedHost || t.host}`, `anyone can publish here in minutes; the platform's age and reputation say nothing about this site${asks.length ? `, and it asks for ${asks.join(' and ')}` : ''}`, asks.length ? 20 : 0));
  } else if (ageDays == null) {
    const seen = [f.ct?.firstSeen, f.wayback?.firstSnapshot].filter(Boolean).sort()[0];
    const d = seen ? Math.floor(((f.now ? new Date(f.now) : new Date()) - new Date(seen)) / 86400000) : null;
    if (d != null && d >= 1825) s.push(sig('age.online', 'good', 'Online for years', `first seen ${seen.slice(0, 10)} (certificate logs and the Wayback Machine; the registration date was not available)`, 12));
    else if (d != null && d >= 365) s.push(sig('age.online', 'good', 'Online for over a year', `first seen ${seen.slice(0, 10)} (registration date not available)`, 6));
  } else {
    if (ageDays < 30) s.push(sig('age', 'warn', 'Registered in the last month', `${t.domain} was registered ${age(ageDays)} ago (${f.registration.created.slice(0, 10)})`, 25));
    else if (ageDays < 90) s.push(sig('age', 'warn', 'Registered recently', `${age(ageDays)} ago (${f.registration.created.slice(0, 10)})`, 15));
    else if (ageDays < 365) s.push(sig('age', 'info', 'Less than a year old', `registered ${f.registration.created.slice(0, 10)}`, 0));
    else if (ageDays >= 1825) s.push(sig('age', 'good', 'Registered for years', `since ${f.registration.created.slice(0, 10)} (${age(ageDays)})`, 15));
    else s.push(sig('age', 'good', 'Registered for over a year', `since ${f.registration.created.slice(0, 10)} (${age(ageDays)})`, 8));
  }
  if (!shared && f.ct?.firstDays != null && f.ct.firstDays < 30 && (ageDays == null || ageDays >= 30)) s.push(sig('ct.new', 'warn', 'First HTTPS certificate is brand new', `first certificate ${f.ct.firstSeen.slice(0, 10)}: the site went live ${age(f.ct.firstDays)} ago`, 10));
  if (!shared && f.wayback?.firstDays != null && ageDays != null && f.wayback.firstDays - ageDays > 365) s.push(sig('history.reregistered', p?.shop ? 'warn' : 'info', 'Domain changed hands', `archived since ${f.wayback.firstSnapshot.slice(0, 4)} but registered anew ${f.registration.created.slice(0, 10)}: its old reputation belongs to a previous owner`, p?.shop ? 10 : 0));
  const status = f.registration?.status || [];
  if (status.some((x) => /hold/.test(x))) s.push(sig('registry.hold', 'warn', 'Suspended by the registry', `domain status: ${status.join(', ')} (registries put abused domains on hold)`, 20));
  if (f.tranco?.rank) {
    const r = f.tranco.rank;
    if (r <= 10000) s.push(sig('popularity', 'good', 'One of the most visited sites', `Tranco rank ${r.toLocaleString('en')}`, 20));
    else if (r <= 100000) s.push(sig('popularity', 'good', 'Widely visited', `Tranco rank ${r.toLocaleString('en')}`, 12));
    else if (r <= 1000000) s.push(sig('popularity', 'good', 'In the top million sites', `Tranco rank ${r.toLocaleString('en')}`, 4));
  }

  // ---- The page
  if (f.page && f.page.ok === false) s.push(sig('page.unreachable', 'info', 'Page could not be loaded', f.page.error, 0));
  if (p) {
    if (p.exfil?.length && asks.length) s.push(sig('page.exfil', 'danger', 'Sends what you type to a chat bot or form service', `${p.exfil.join(', ')} on a page asking for ${asks.join(' and ')}: a phishing kit pattern`, 50));
    else if (p.exfil?.length) s.push(sig('page.exfil', 'info', 'Uses a third-party form or IP lookup service', p.exfil.join(', '), 0));
    if (p.offsiteForms?.length && asks.length) s.push(sig('page.offsite-form', 'warn', 'Login or payment form posts to another site', p.offsiteForms.join(', '), 20));
    if (f.cloaking?.differs) s.push(sig('page.cloaking', 'warn', 'Shows scanners a different page', f.cloaking.note, 15));
    if (p.urgency) s.push(sig('page.urgency', asks.length ? pageLevel('warn') : 'info', 'Pressure wording', `"${p.urgency}"`, asks.length && !established ? 10 : 0));
    if (p.shop && !established) {
      if (p.pay.bankTransferOnly) s.push(sig('shop.payment', 'warn', 'Asks for bank transfer or similar only', 'no buyer protection; fake shops prefer it', 20));
      if (p.pay.crypto) s.push(sig('shop.crypto', 'warn', 'Takes crypto payment', 'no way to get money back', 15));
      if (p.freeMail.length) s.push(sig('shop.free-mail', 'warn', 'Shop contact is a free mail address', p.freeMail.join(', '), 10));
      if (!p.cvr.length && !p.policyLinks.terms && !p.policyLinks.returns) s.push(sig('shop.no-company', 'warn', 'No company details or terms', 'no CVR/VAT number, terms or returns policy found on the page (EU law requires them)', 10));
      if (p.discount >= 5) s.push(sig('shop.discounts', 'warn', 'Discounts too good to be true', `${p.discount} discounts of 50-90%`, 10));
      if (p.cvr.length) s.push(sig('shop.cvr', 'info', 'States a company number', `CVR/VAT ${p.cvr.join(', ')}: look it up on datacvr.virk.dk and check the name and address match`, 0));
    }
    if (p.trustpilotLink && f.trustpilotDomain && p.trustpilotLink.replace(/^www\./, '') !== f.trustpilotDomain.replace(/^www\./, '')) s.push(sig('reviews.borrowed', 'warn', 'Trustpilot badge points at another site', `the badge links to trustpilot.com/review/${p.trustpilotLink}`, 15));
  }

  // ---- Reviews
  const tp = f.trustpilot;
  if (tp?.ok && tp.found && tp.rating != null) {
    if (tp.rating >= 4 && tp.reviews >= 100) s.push(sig('reviews', 'good', 'Good Trustpilot rating', `${tp.rating}/5 from ${tp.reviews.toLocaleString('en')} reviews`, 10));
    else if (tp.rating <= 2.5 && tp.reviews >= 10) s.push(sig('reviews', 'warn', 'Poor Trustpilot rating', `${tp.rating}/5 from ${tp.reviews} reviews; read the newest for "never received" or "scam"`, 15));
    else s.push(sig('reviews', 'info', 'Trustpilot', `${tp.rating}/5 from ${tp.reviews} reviews`, 0));
  } else if (tp?.ok && !tp.found) s.push(sig('reviews', 'info', 'No Trustpilot page for this exact domain', 'neither good nor bad on its own', 0));

  if (f.asn) s.push(sig('hosting', 'info', 'Hosting network', `AS${f.asn.asn} ${f.asn.name || ''} (${f.asn.country})`.trim(), 0));

  return decide(s, f);
}

export function decide(signals, f = {}) {
  const n = (lvl) => signals.filter((x) => x.level === lvl);
  const danger = n('danger'); const warn = n('warn'); const good = n('good');
  const warnWeight = warn.reduce((a, x) => a + x.weight, 0);
  let verdict;
  if (danger.length) verdict = 'dangerous';
  else if (signals.some((x) => x.id === 'brand.official')) verdict = 'trusted';
  else if (warn.length >= 2 || warn.some((x) => x.weight >= 20)) verdict = 'suspicious';
  else if (warn.length === 1) verdict = 'caution';
  else if (signals.some((x) => x.id === 'brand.official') || good.some((x) => x.id === 'popularity' && x.weight >= 12)) verdict = 'trusted';
  else if (good.filter((x) => x.id !== 'blocklist.clean').reduce((a, x) => a + x.weight, 0) >= 15) verdict = 'likely-safe';
  else verdict = 'unknown';
  let score = 50 + good.reduce((a, x) => a + x.weight, 0) - warnWeight - danger.length * 40;
  score = Math.max(0, Math.min(CAP[verdict], Math.max(FLOOR[verdict] || 0, score)));
  const order = { danger: 0, warn: 1, good: 2, info: 3 };
  return { verdict, label: VERDICTS[verdict], score: Math.round(score), signals: [...signals].sort((a, b) => order[a.level] - order[b.level] || b.weight - a.weight) };
}
