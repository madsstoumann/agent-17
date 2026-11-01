// Turning what the user typed into the names the checks need: the host, the registrable domain
// (what someone actually registered and owns), and, on a shared host such as vercel.app, the part
// of the name the site's owner controls.
import { domainToUnicode } from 'node:url';

// Second-level public suffixes that matter in practice. Not the whole Public Suffix List, but
// enough for the country domains spoofs and webshops use.
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'gov.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.za', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'net.in', 'org.in',
  'com.br', 'net.br', 'com.mx', 'com.ar', 'com.co', 'com.tr', 'com.cn', 'com.hk', 'com.tw', 'com.sg', 'com.my', 'com.ph',
  'com.pl', 'com.ua', 'com.ru', 'co.il', 'co.id', 'com.vn', 'com.pk', 'com.ng', 'com.eg', 'com.sa', 'co.th', 'in.th',
  'gov.dk', 'co.at', 'or.at', 'com.es', 'com.pt', 'com.gr', 'com.ro', 'co.hu', 'com.de', 'com.se', 'co.no', 'com.cy', 'com.mt',
]);

/**
 * Shared hosting, site builders, free subdomains, tunnels and file shares. A name under one of
 * these belongs to whoever made the site; the platform's own age and reputation say nothing about
 * it. Each entry acts like a public suffix: the label in front of it is the "owner" part.
 */
export const SHARED_HOSTS = [
  'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'github.io', 'gitlab.io', 'web.app', 'firebaseapp.com', 'appspot.com',
  'herokuapp.com', 'onrender.com', 'fly.dev', 'railway.app', 'glitch.me', 'repl.co', 'replit.app', 'replit.dev', 'surge.sh',
  'azurewebsites.net', 'azurestaticapps.net', 'cloudfront.net', 'amazonaws.com', 's3.amazonaws.com', 'ondigitalocean.app',
  'blogspot.com', 'wordpress.com', 'wixsite.com', 'wix.com', 'weebly.com', 'square.site', 'squarespace.com', 'webflow.io',
  'myshopify.com', 'godaddysites.com', 'jimdofree.com', 'jimdosite.com', 'site123.me', 'mystrikingly.com', 'carrd.co',
  'framer.website', 'framer.app', 'notion.site', 'gitbook.io', 'hubspotpagebuilder.com', 'hs-sites.com', 'webnode.page',
  'tilda.ws', 'yolasite.com', 'ucoz.net', '000webhostapp.com', 'epizy.com', 'rf.gd', 'freecluster.eu',
  'ngrok.io', 'ngrok-free.app', 'ngrok.app', 'trycloudflare.com', 'loca.lt', 'serveo.net',
  'duckdns.org', 'no-ip.org', 'ddns.net', 'hopto.org', 'zapto.org', 'sytes.net', 'freedns.org', 'mooo.com',
  'ipfs.io', 'dweb.link', 'w3s.link', 'fleek.co', 'r2.dev', 'b-cdn.net', 'web.core.windows.net', 'blob.core.windows.net',
  'firebasestorage.googleapis.com', 'storage.googleapis.com', 'translate.goog', 'sharepoint.com', 'my.canva.site', 'canva.site',
];

/** Hosts whose whole name is a page on someone else's service (forms, file shares, link pages). */
export const SHARED_PAGES = ['sites.google.com', 'docs.google.com', 'forms.gle', 'script.google.com', 'forms.office.com', 'linktr.ee',
  'sharemyhtml.com', 'jsfiddle.net', 'codepen.io', 'pastebin.com', 'telegra.ph', 'dropbox.com', 'dl.dropboxusercontent.com',
  'onedrive.live.com', '1drv.ms', 'mega.nz', 'wetransfer.com', 'we.tl'];

export const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 's.id', 'rb.gy',
  't.ly', 'shorturl.at', 'tiny.cc', 'lnkd.in', 'qrco.de', 'bl.ink', 'short.io', 'shorte.st', 'adf.ly'];

const under = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);

/** "paypal.com.evil.xyz" -> "evil.xyz"; "shop.example.co.uk" -> "example.co.uk". */
export function registrableOf(host) {
  const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  return SECOND_LEVEL.has(labels.slice(-2).join('.')) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

export const suffixOf = (domain) => {
  const d = registrableOf(domain);
  return d.slice(d.indexOf('.') + 1);
};

/**
 * parseTarget("https://Paypal.com.verify-acc.xyz/login?x=1") -> {
 *   input, url, host, unicodeHost, punycode, domain, label, tld, subdomain, path,
 *   sharedHost (e.g. "vercel.app" or null), ownerName (the name the site's owner controls),
 *   sharedPage, shortener }
 */
export function parseTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('no URL or domain given');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u;
  try { u = new URL(withScheme); } catch { throw new Error(`not a URL or domain: ${raw}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`only http and https URLs can be checked, not ${u.protocol}`);
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.')) throw new Error(`not a public domain: ${host}`);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return { input: raw, url: u.href, host, unicodeHost: host, punycode: false, ip: true, domain: host, label: host, tld: '', subdomain: '', path: u.pathname + u.search, sharedHost: null, ownerName: host, sharedPage: false, shortener: false };
  }
  const sharedHost = SHARED_HOSTS.filter((s) => under(host, s)).sort((a, b) => b.length - a.length)[0] || null;
  const domain = registrableOf(host);
  const tld = suffixOf(domain);
  const label = domain.slice(0, -(tld.length + 1));
  const bare = host.replace(/^www\./, '');
  const subdomain = host === domain ? '' : host.slice(0, -(domain.length + 1));
  // On a shared host the owner controls "<name>.vercel.app"; their own label is the one before the suffix.
  const ownerName = sharedHost && host !== sharedHost ? `${host.slice(0, -(sharedHost.length + 1)).split('.').pop()}.${sharedHost}` : domain;
  return {
    input: raw,
    url: u.href,
    host,
    bareHost: bare,
    unicodeHost: domainToUnicode(host) || host,
    punycode: host.split('.').some((l) => l.startsWith('xn--')),
    ip: false,
    domain,
    label,
    tld,
    subdomain,
    path: u.pathname + u.search,
    sharedHost,
    ownerName,
    sharedPage: SHARED_PAGES.some((s) => under(host, s)),
    shortener: SHORTENERS.some((s) => under(host, s)),
  };
}

/** Scripts used in a label, for mixed-script (homograph) detection. */
export function scriptsOf(text) {
  const out = new Set();
  for (const ch of String(text)) {
    if (/[a-z0-9-]/i.test(ch)) { if (/[a-z]/i.test(ch)) out.add('Latin'); continue; }
    if (/\p{Script=Latin}/u.test(ch)) out.add('Latin');
    else if (/\p{Script=Cyrillic}/u.test(ch)) out.add('Cyrillic');
    else if (/\p{Script=Greek}/u.test(ch)) out.add('Greek');
    else if (/\p{Script=Armenian}/u.test(ch)) out.add('Armenian');
    else if (/\p{Script=Han}/u.test(ch)) out.add('Han');
    else if (/\p{Script=Arabic}/u.test(ch)) out.add('Arabic');
    else if (/\p{Script=Hebrew}/u.test(ch)) out.add('Hebrew');
    else if (/\p{L}/u.test(ch)) out.add('Other');
  }
  return [...out];
}
