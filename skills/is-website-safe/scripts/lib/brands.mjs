// Brands that phishing and fake shops copy most, with their official domains, and the lookalike
// tests: typos, homoglyphs (paypa1, pаypal with a Cyrillic а), the brand plus extra words
// (paypal-secure-login), the brand on another TLD, and the brand's domain used as a subdomain
// (paypal.com.verify-account.xyz).
//
// Each brand: { name, domains: [official registrable domains], labels?: [distinctive names, default
// the first domain's label], cc?: true when the brand runs country sites (apple.dk, ikea.se) so the
// brand name on a two-letter country TLD is probably theirs, words?: [extra names seen in page titles] }.
// Keep labels distinctive: a short generic word ("post", "bank") would match half the web.

export const BRANDS = [
  // Payments, banks, crypto
  { name: 'PayPal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com'], cc: true },
  { name: 'Stripe', domains: ['stripe.com'] },
  { name: 'Klarna', domains: ['klarna.com'], cc: true },
  { name: 'MobilePay', domains: ['mobilepay.dk', 'mobilepay.fi', 'mobilepay.nu'] },
  { name: 'Vipps', domains: ['vipps.no', 'vippsmobilepay.com'], words: ['Vipps MobilePay'] },
  { name: 'Revolut', domains: ['revolut.com'] },
  { name: 'Wise', domains: ['wise.com', 'transferwise.com'], labels: ['transferwise'] },
  { name: 'Visa', domains: ['visa.com'], cc: true, labels: [] },
  { name: 'Mastercard', domains: ['mastercard.com', 'mastercard.us'], cc: true },
  { name: 'American Express', domains: ['americanexpress.com', 'amex.com'], labels: ['americanexpress'] },
  { name: 'Danske Bank', domains: ['danskebank.dk', 'danskebank.com', 'danskebank.se', 'danskebank.no', 'danskebank.fi'] },
  { name: 'Nordea', domains: ['nordea.dk', 'nordea.com', 'nordea.se', 'nordea.no', 'nordea.fi'] },
  { name: 'Jyske Bank', domains: ['jyskebank.dk'] },
  { name: 'Nykredit', domains: ['nykredit.dk', 'nykredit.com'] },
  { name: 'Sydbank', domains: ['sydbank.dk'] },
  { name: 'Spar Nord', domains: ['sparnord.dk'] },
  { name: 'Arbejdernes Landsbank', domains: ['al-bank.dk'], labels: ['arbejderneslandsbank'] },
  { name: 'Lunar', domains: ['lunar.app'], labels: [] },
  { name: 'Handelsbanken', domains: ['handelsbanken.dk', 'handelsbanken.se', 'handelsbanken.com', 'handelsbanken.no', 'handelsbanken.co.uk'] },
  { name: 'SEB', domains: ['seb.se', 'sebgroup.com'], labels: ['sebgroup'] },
  { name: 'Swedbank', domains: ['swedbank.se', 'swedbank.com'] },
  { name: 'DNB', domains: ['dnb.no'], labels: [] },
  { name: 'HSBC', domains: ['hsbc.com', 'hsbc.co.uk'], cc: true },
  { name: 'Barclays', domains: ['barclays.co.uk', 'barclays.com'] },
  { name: 'Santander', domains: ['santander.com', 'santander.co.uk'], cc: true },
  { name: 'ING', domains: ['ing.com', 'ing.nl', 'ing.de'], labels: [] },
  { name: 'Chase', domains: ['chase.com'], labels: [] },
  { name: 'Wells Fargo', domains: ['wellsfargo.com'] },
  { name: 'Bank of America', domains: ['bankofamerica.com'] },
  { name: 'Coinbase', domains: ['coinbase.com'] },
  { name: 'Binance', domains: ['binance.com'] },
  { name: 'Kraken', domains: ['kraken.com'] },
  { name: 'MetaMask', domains: ['metamask.io'] },
  { name: 'Ledger', domains: ['ledger.com'], labels: [] },
  { name: 'Trezor', domains: ['trezor.io'] },
  // Danish and Nordic public services
  { name: 'MitID', domains: ['mitid.dk'] },
  { name: 'NemID', domains: ['nemid.nu'] },
  { name: 'borger.dk', domains: ['borger.dk'] },
  { name: 'Skattestyrelsen', domains: ['skat.dk', 'sktst.dk'], labels: ['skattestyrelsen'], words: ['SKAT'] },
  { name: 'e-Boks', domains: ['e-boks.dk', 'e-boks.com'], labels: ['eboks', 'e-boks'] },
  { name: 'Digital Post', domains: ['digitalpost.dk', 'mit.dk'], labels: ['digitalpost'] },
  { name: 'Udbetaling Danmark', domains: ['atp.dk'], labels: ['udbetalingdanmark'] },
  { name: 'Sundhed.dk', domains: ['sundhed.dk'], labels: ['sundhed'] },
  { name: 'Politi', domains: ['politi.dk'], labels: [] },
  { name: 'Skatteverket', domains: ['skatteverket.se'] },
  { name: 'BankID', domains: ['bankid.com', 'bankid.no'] },
  { name: 'HMRC', domains: ['gov.uk'], labels: ['hmrc'] },
  { name: 'IRS', domains: ['irs.gov'], labels: [] },
  // Parcels and post
  { name: 'PostNord', domains: ['postnord.dk', 'postnord.com', 'postnord.se', 'postnord.no', 'postnord.fi'] },
  { name: 'GLS', domains: ['gls-group.com', 'gls-group.eu', 'gls.dk'], labels: ['gls-group'] },
  { name: 'DAO', domains: ['dao.as'], labels: [] },
  { name: 'Bring', domains: ['bring.dk', 'bring.no', 'bring.com', 'bring.se'], labels: [] },
  { name: 'DHL', domains: ['dhl.com', 'dhl.de', 'dhl.dk'], cc: true },
  { name: 'UPS', domains: ['ups.com'], cc: true },
  { name: 'FedEx', domains: ['fedex.com'] },
  { name: 'USPS', domains: ['usps.com'] },
  { name: 'Royal Mail', domains: ['royalmail.com'] },
  { name: 'Evri', domains: ['evri.com'] },
  { name: 'Posten', domains: ['posten.se', 'posten.no'], labels: [] },
  { name: 'Deutsche Post', domains: ['deutschepost.de'] },
  // Tech, mail, cloud
  { name: 'Microsoft', domains: ['microsoft.com', 'microsoftonline.com', 'live.com', 'office.com', 'outlook.com', 'office365.com', 'sharepoint.com', 'onedrive.com', 'msn.com', 'azure.com', 'xbox.com'], labels: ['microsoft', 'microsoftonline', 'office365', 'onedrive', 'outlook', 'sharepoint'] },
  { name: 'Apple', domains: ['apple.com', 'icloud.com', 'apple.news'], labels: ['apple', 'icloud', 'appleid'], cc: true },
  { name: 'Google', domains: ['google.com', 'gmail.com', 'youtube.com', 'googleusercontent.com', 'gstatic.com', 'withgoogle.com'], labels: ['google', 'gmail', 'youtube'], cc: true },
  { name: 'Amazon', domains: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.se', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.pl', 'amazon.co.jp', 'amazon.ca', 'amazon.com.au', 'aws.amazon.com', 'amazonaws.com', 'primevideo.com', 'media-amazon.com'], labels: ['amazon', 'primevideo'], cc: true },
  { name: 'Meta', domains: ['facebook.com', 'instagram.com', 'whatsapp.com', 'meta.com', 'fb.com', 'messenger.com', 'fbcdn.net', 'threads.net'], labels: ['facebook', 'instagram', 'whatsapp', 'messenger'] },
  { name: 'X (Twitter)', domains: ['x.com', 'twitter.com'], labels: ['twitter'] },
  { name: 'LinkedIn', domains: ['linkedin.com'] },
  { name: 'TikTok', domains: ['tiktok.com'] },
  { name: 'Snapchat', domains: ['snapchat.com'] },
  { name: 'Discord', domains: ['discord.com', 'discord.gg', 'discordapp.com'] },
  { name: 'Telegram', domains: ['telegram.org', 't.me'] },
  { name: 'Steam', domains: ['steampowered.com', 'steamcommunity.com'], labels: ['steampowered', 'steamcommunity'] },
  { name: 'Epic Games', domains: ['epicgames.com'] },
  { name: 'Roblox', domains: ['roblox.com'] },
  { name: 'Netflix', domains: ['netflix.com'], cc: true },
  { name: 'Spotify', domains: ['spotify.com'] },
  { name: 'Disney+', domains: ['disneyplus.com'] },
  { name: 'HBO Max', domains: ['max.com', 'hbomax.com'], labels: ['hbomax'] },
  { name: 'Viaplay', domains: ['viaplay.dk', 'viaplay.com', 'viaplay.se', 'viaplay.no'] },
  { name: 'TV 2', domains: ['tv2.dk'], labels: [] },
  { name: 'Adobe', domains: ['adobe.com'] },
  { name: 'Dropbox', domains: ['dropbox.com'] },
  { name: 'DocuSign', domains: ['docusign.com', 'docusign.net'] },
  { name: 'WeTransfer', domains: ['wetransfer.com', 'we.tl'] },
  { name: 'Zoom', domains: ['zoom.us', 'zoom.com'], labels: [] },
  { name: 'Slack', domains: ['slack.com'] },
  { name: 'GitHub', domains: ['github.com'] },
  { name: 'OpenAI', domains: ['openai.com', 'chatgpt.com'], labels: ['openai', 'chatgpt'] },
  { name: 'Anthropic', domains: ['anthropic.com', 'claude.ai', 'claude.com'] },
  { name: 'Yahoo', domains: ['yahoo.com'], cc: true },
  { name: 'Booking.com', domains: ['booking.com'] },
  { name: 'Airbnb', domains: ['airbnb.com'], cc: true },
  { name: 'Uber', domains: ['uber.com'], labels: [] },
  { name: 'Wolt', domains: ['wolt.com'] },
  { name: 'Just Eat', domains: ['just-eat.dk', 'just-eat.co.uk', 'justeat.com'], labels: ['justeat', 'just-eat'] },
  // Telecom and utilities (DK)
  { name: 'TDC', domains: ['tdc.dk', 'yousee.dk', 'nuuday.dk'], labels: ['yousee'] },
  { name: 'Telenor', domains: ['telenor.dk', 'telenor.com', 'telenor.no', 'telenor.se'] },
  { name: 'Telia', domains: ['telia.dk', 'telia.se', 'telia.no', 'telia.fi', 'teliacompany.com'] },
  { name: '3 (Three)', domains: ['3.dk'], labels: [] },
  { name: 'Norlys', domains: ['norlys.dk'] },
  { name: 'Ørsted', domains: ['orsted.dk', 'orsted.com'], labels: ['orsted'] },
  { name: 'Andel Energi', domains: ['andelenergi.dk'] },
  // Shops that fake webshops copy
  { name: 'IKEA', domains: ['ikea.com'], cc: true },
  { name: 'Zalando', domains: ['zalando.dk', 'zalando.com', 'zalando.de', 'zalando.se', 'zalando.co.uk'], cc: true },
  { name: 'H&M', domains: ['hm.com'], labels: [] },
  { name: 'Nike', domains: ['nike.com'], cc: true },
  { name: 'Adidas', domains: ['adidas.com', 'adidas.dk', 'adidas.de'], cc: true },
  { name: 'Pandora', domains: ['pandora.net'], labels: [] },
  { name: 'LEGO', domains: ['lego.com'], labels: [] },
  { name: 'Royal Copenhagen', domains: ['royalcopenhagen.com'] },
  { name: 'Georg Jensen', domains: ['georgjensen.com'] },
  { name: 'Bang & Olufsen', domains: ['bang-olufsen.com'], labels: ['bang-olufsen', 'bangolufsen'] },
  { name: 'Ecco', domains: ['ecco.com'], labels: [] },
  { name: 'Normal', domains: ['normal.dk'], labels: [] },
  { name: 'Matas', domains: ['matas.dk'] },
  { name: 'Elgiganten', domains: ['elgiganten.dk', 'elgiganten.se'] },
  { name: 'Power', domains: ['power.dk'], labels: [] },
  { name: 'Proshop', domains: ['proshop.dk'] },
  { name: 'Bilka', domains: ['bilka.dk'] },
  { name: 'Salling', domains: ['salling.dk', 'sallinggroup.com'], labels: ['sallinggroup'] },
  { name: 'Føtex', domains: ['foetex.dk'], labels: ['foetex'] },
  { name: 'Netto', domains: ['netto.dk', 'netto.de'], labels: [] },
  { name: 'Coop', domains: ['coop.dk'], labels: [] },
  { name: 'Rema 1000', domains: ['rema1000.dk'] },
  { name: 'Lidl', domains: ['lidl.dk', 'lidl.de', 'lidl.com'], cc: true },
  { name: 'Jysk', domains: ['jysk.dk', 'jysk.com'], cc: true, labels: [] },
  { name: 'Temu', domains: ['temu.com'] },
  { name: 'Shein', domains: ['shein.com'] },
  { name: 'AliExpress', domains: ['aliexpress.com'] },
  { name: 'eBay', domains: ['ebay.com', 'ebay.co.uk', 'ebay.de'], cc: true },
  { name: 'Etsy', domains: ['etsy.com'] },
  { name: 'Walmart', domains: ['walmart.com'] },
  { name: 'Costco', domains: ['costco.com'] },
  { name: 'Best Buy', domains: ['bestbuy.com'] },
  { name: 'DBA', domains: ['dba.dk'], labels: [] },
  { name: 'Blocket', domains: ['blocket.se'] },
  { name: 'Finn', domains: ['finn.no'], labels: [] },
  { name: 'Ray-Ban', domains: ['ray-ban.com'], labels: ['rayban', 'ray-ban'] },
  { name: 'Rolex', domains: ['rolex.com'] },
  { name: 'Louis Vuitton', domains: ['louisvuitton.com'] },
  { name: 'Gucci', domains: ['gucci.com'] },
  { name: 'Moncler', domains: ['moncler.com'] },
  { name: 'Canada Goose', domains: ['canadagoose.com'] },
  { name: 'The North Face', domains: ['thenorthface.com'] },
  { name: 'Ticketmaster', domains: ['ticketmaster.com', 'ticketmaster.dk', 'ticketmaster.co.uk'], cc: true },
  // Travel
  { name: 'SAS', domains: ['flysas.com'], labels: ['flysas'] },
  { name: 'Norwegian', domains: ['norwegian.com', 'norwegian.no'], labels: [] },
  { name: 'Ryanair', domains: ['ryanair.com'] },
  { name: 'DSB', domains: ['dsb.dk'], labels: [] },
  { name: 'Rejsekort', domains: ['rejsekort.dk'] },
  { name: 'Expedia', domains: ['expedia.com'], cc: true },
];

for (const b of BRANDS) {
  const first = b.domains[0].split('.')[0];
  b.labels = b.labels ? [...new Set(b.labels)] : [first];
}

// Characters that look like Latin letters, and digit/letter swaps used in typosquats.
const CONFUSABLE = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ԁ: 'd', ɡ: 'g', ӏ: 'l', һ: 'h', ԛ: 'q', ԝ: 'w', ѕ: 's', ь: 'b', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
  α: 'a', ε: 'e', ο: 'o', ρ: 'p', τ: 't', υ: 'u', ν: 'v', κ: 'k', ι: 'i', χ: 'x', β: 'b',
  ı: 'i', ł: 'l', ø: 'o', ð: 'd', þ: 'p', ß: 'ss', æ: 'ae', œ: 'oe',
  0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l',
};
const SEQ = [['rn', 'm'], ['vv', 'w'], ['cl', 'd'], ['ii', 'u']];

/** The Latin "shape" of a name: diacritics stripped, confusables mapped, hyphens kept. */
export function skeleton(name) {
  let s = String(name || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  s = [...s].map((c) => CONFUSABLE[c] ?? c).join('');
  return s;
}

/** Variant skeletons with multi-letter confusables applied ("rnicrosoft" -> "microsoft"), and "l" for "i". */
function shapes(name) {
  const base = skeleton(name);
  const out = new Set([base]);
  for (const [from, to] of SEQ) if (base.includes(from)) out.add(base.split(from).join(to));
  if (base.includes('l')) out.add(base.replace(/l/g, 'i'));
  if (base.includes('i')) out.add(base.replace(/i/g, 'l'));
  return [...out];
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps). */
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const isCc = (tld) => /^[a-z]{2}$/.test(tld) || /^(co|com|net|org)\.[a-z]{2}$/.test(tld);
const under = (domain, official) => domain === official || domain.endsWith(`.${official}`);

/** officialBrand(target) -> { brand, how: 'listed'|'country' } when the domain belongs to a listed brand. */
export function officialBrand(t, brands = BRANDS) {
  for (const b of brands) {
    if (b.domains.some((d) => under(t.host, d) && registrableIs(t, d))) return { brand: b, how: 'listed' };
  }
  for (const b of brands) {
    if (b.cc && b.labels.includes(t.label) && isCc(t.tld)) return { brand: b, how: 'country' };
  }
  return null;
}

// A brand domain such as "aws.amazon.com" lists a host, not a registrable domain; a match on it
// only counts when the target's registrable domain is the brand's too.
function registrableIs(t, d) {
  return t.domain === d || d.endsWith(`.${t.domain}`) || t.domain.endsWith(`.${d}`) || t.host === d || t.host.endsWith(`.${d}`);
}

const SHORT = 5; // labels shorter than this only match exactly or by homoglyph, never by edit distance

/**
 * lookalikes(target) -> [{ brand, kind, detail, strength }] for every brand the name imitates.
 * kind: homoglyph | typo | combo | other-tld | subdomain | owner-name (on a shared host)
 * strength: 'high' (made to fool), 'medium' (could be coincidence, check), 'low'.
 */
export function lookalikes(t, brands = BRANDS) {
  if (t.ip) return [];
  const own = officialBrand(t, brands);
  const found = [];
  // Names to test: the registrable label, and on a shared host the owner's label too.
  // On a shared host the platform's own name (github.io, vercel.app) is not the site's.
  const names = t.sharedHost ? [] : [{ text: t.label, where: 'domain' }];
  if (t.sharedHost && t.ownerName !== t.sharedHost) names.push({ text: t.ownerName.split('.')[0], where: 'owner' });
  const unicodeLabel = t.punycode ? (t.unicodeHost || '').split('.').slice(0, -t.tld.split('.').length).pop() : null;
  if (unicodeLabel && names[0]?.where === 'domain') names[0].text = unicodeLabel;

  for (const b of brands) {
    if (own?.brand === b) continue;
    const hits = [];
    for (const { text, where } of names) {
      const raw = text.toLowerCase();
      const tokens = raw.split(/[-_.]+/).filter(Boolean);
      for (const label of b.labels) {
        const L = label.replace(/-/g, '');
        if (!L) continue;
        const flat = raw.replace(/-/g, '');
        const sk = shapes(raw).map((s) => s.replace(/-/g, ''));
        const skTokens = shapes(raw).flatMap((s) => s.split(/[-_.]+/));
        if (flat === L) {
          if (where === 'owner') hits.push({ kind: 'owner-name', detail: `the site is ${t.ownerName}, a free name on ${t.sharedHost}, called "${label}"`, strength: 'high' });
          else hits.push({ kind: 'other-tld', detail: `"${label}" on .${t.tld}; ${b.name} uses ${b.domains.slice(0, 3).join(', ')}`, strength: 'medium' });
          continue;
        }
        if (sk.includes(L)) { hits.push({ kind: 'homoglyph', detail: `"${text}" reads as "${label}" (${t.punycode ? 'look-alike characters' : 'swapped letters or digits'})`, strength: 'high' }); continue; }
        if (L.length >= SHORT && editDistance(flat, L, 2) <= (L.length >= 8 ? 2 : 1)) { hits.push({ kind: 'typo', detail: `"${text}" is one or two keystrokes from "${label}"`, strength: 'high' }); continue; }
        const tokenHit = tokens.includes(label) || skTokens.includes(L) || (L.length >= 6 && sk.some((s) => s.includes(L)));
        if (tokenHit) { hits.push({ kind: 'combo', detail: `"${text}" contains "${label}" plus other words`, strength: L.length >= 6 || tokens.length > 1 ? 'high' : 'medium' }); continue; }
        // Brand glued to other words: "applegiftreward", "netflixpremium" (prefix), "mypaypal" (suffix, longer brands only).
        const glued = sk.find((x) => x.startsWith(L) || (L.length >= 6 && x.endsWith(L)));
        if (L.length >= SHORT && glued) {
          const rest = glued.startsWith(L) ? glued.slice(L.length) : glued.slice(0, -L.length);
          const lure = LURE_WORDS.filter((w) => w.length >= 3 && rest.includes(w.replace('-', '')));
          hits.push({ kind: 'combo', detail: `"${text}" starts or ends with "${label}"${lure.length ? ` plus "${lure.join('", "')}"` : ''}`, strength: lure.length ? 'high' : 'medium' });
          continue;
        }
        // A four-letter brand with one letter doubled: "uspss", "dhll".
        if (L.length === 4 && flat.length === 5 && [...flat].some((c, i) => c === flat[i + 1] && flat.slice(0, i) + flat.slice(i + 1) === L)) { hits.push({ kind: 'typo', detail: `"${text}" is "${label}" with a letter doubled`, strength: 'high' }); continue; }
        // Typo inside a combo: "paypa1-secure" -> token "paypa1".
        if (L.length >= SHORT && tokens.some((tok) => tok.length >= SHORT && editDistance(tok, L, 1) <= 1)) hits.push({ kind: 'combo', detail: `"${text}" contains a misspelt "${label}"`, strength: 'high' });
      }
    }
    // The brand's own domain or name used as a subdomain label: paypal.com.secure-check.xyz, paypal.evil.xyz
    if (t.subdomain && !t.sharedHost) {
      const sub = t.subdomain.toLowerCase();
      const subTokens = sub.split(/[.-]+/);
      const usesDomain = b.domains.find((d) => sub === d || sub.endsWith(`.${d}`) || sub.includes(`${d}.`) || sub.includes(d));
      if (usesDomain) hits.push({ kind: 'subdomain', detail: `"${b.domains.find((d) => sub.includes(d))}" is only the start of the name; the site is really ${t.domain}`, strength: 'high' });
      else if (b.labels.some((l) => l.length >= 4 && subTokens.includes(l))) {
        const l = b.labels.find((x) => x.length >= 4 && subTokens.includes(x));
        hits.push({ kind: 'subdomain', detail: `"${l}" is a subdomain of ${t.domain}, which is not ${b.name}'s`, strength: l.length >= 5 ? 'high' : 'medium' });
      }
    }
    if (hits.length) {
      const rank = { high: 0, medium: 1, low: 2 };
      hits.sort((x, y) => rank[x.strength] - rank[y.strength]);
      found.push({ brand: b.name, official: b.domains, ...hits[0] });
    }
  }
  return found;
}

/** Words that phishing domains add to a brand name. */
export const LURE_WORDS = ['login', 'log-in', 'signin', 'sign-in', 'secure', 'security', 'verify', 'verification', 'account', 'accounts', 'update',
  'support', 'help', 'service', 'services', 'confirm', 'unlock', 'recover', 'recovery', 'wallet', 'refund', 'billing', 'payment', 'pay',
  'invoice', 'delivery', 'parcel', 'tracking', 'track', 'customs', 'toll', 'auth', 'id', 'portal', 'online', 'web', 'app', 'claim', 'reward',
  'bonus', 'gift', 'free', 'promo', 'sale', 'outlet', 'official', 'store', 'shop', 'udbetaling', 'tilbagebetaling', 'pakke', 'levering', 'konto', 'betaling'];

export function lureWords(t) {
  const tokens = `${t.subdomain}.${t.label}`.toLowerCase().split(/[.\-_0-9]+/).filter(Boolean);
  return [...new Set(LURE_WORDS.filter((w) => tokens.includes(w.replace('-', '')) || tokens.includes(w)).map((w) => w.replace('-', '')))];
}

/** Brands a page names in its title, site name or headline (for "this page claims to be X"). */
export function brandsNamed(text, brands = BRANDS) {
  const hay = ` ${skeleton(text).replace(/[^a-z0-9&+ .-]+/g, ' ')} `;
  const out = [];
  for (const b of brands) {
    const names = [b.name, ...(b.words || []), ...b.labels].map((n) => skeleton(n)).filter((n) => n.length >= 3);
    if (names.some((n) => new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay))) out.push(b);
  }
  return out;
}
