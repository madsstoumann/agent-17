// What the hosts and cookies seen in the browser are: vendor, purpose and where the vendor is
// established. Static lists, so a miss is "unclassified", never "fine". Countries are the
// vendor's EU-facing legal entity's parent; EEA = no third-country transfer by the vendor itself.

export const EEA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']);
// Third countries with an EU adequacy decision (the transfer itself needs no extra safeguard).
export const ADEQUATE = new Set(['CH', 'GB', 'JP', 'KR', 'NZ', 'IL', 'CA', 'AR', 'UY', 'AD', 'FO', 'GG', 'IM', 'JE']);

/** Categories that need consent before they load (ePrivacy Art. 5(3) and GDPR Art. 6). */
export const CONSENT_CATEGORIES = new Set(['analytics', 'ads', 'session-replay', 'marketing', 'social', 'embed', 'fonts']);

const T = (re, vendor, category, country) => ({ re, vendor, category, country });
export const VENDORS = [
  T(/(^|\.)googletagmanager\.com$/, 'Google Tag Manager', 'tag-manager', 'US'),
  T(/(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$/, 'Google Analytics', 'analytics', 'US'),
  T(/(^|\.)doubleclick\.net$|(^|\.)googlesyndication\.com$|(^|\.)googleadservices\.com$|(^|\.)googleads\.g\.doubleclick\.net$|(^|\.)adservice\.google\./, 'Google Ads', 'ads', 'US'),
  T(/(^|\.)fonts\.googleapis\.com$|(^|\.)fonts\.gstatic\.com$/, 'Google Fonts', 'fonts', 'US'),
  T(/(^|\.)maps\.googleapis\.com$|(^|\.)maps\.gstatic\.com$/, 'Google Maps', 'embed', 'US'),
  T(/(^|\.)youtube\.com$|(^|\.)ytimg\.com$|(^|\.)googlevideo\.com$/, 'YouTube', 'embed', 'US'),
  T(/(^|\.)youtube-nocookie\.com$/, 'YouTube (no-cookie)', 'embed', 'US'),
  T(/(^|\.)google\.com$|(^|\.)gstatic\.com$|(^|\.)recaptcha\.net$/, 'Google (reCAPTCHA, Maps, sign-in)', 'embed', 'US'),
  T(/(^|\.)facebook\.net$|(^|\.)facebook\.com$|(^|\.)fbcdn\.net$|(^|\.)instagram\.com$/, 'Meta', 'ads', 'US'),
  T(/(^|\.)hotjar\.com$|(^|\.)hotjar\.io$/, 'Hotjar', 'session-replay', 'MT'),
  T(/(^|\.)clarity\.ms$/, 'Microsoft Clarity', 'session-replay', 'US'),
  T(/(^|\.)bat\.bing\.com$|(^|\.)bing\.com$/, 'Microsoft Ads (UET)', 'ads', 'US'),
  T(/(^|\.)fullstory\.com$/, 'FullStory', 'session-replay', 'US'),
  T(/(^|\.)mouseflow\.com$/, 'Mouseflow', 'session-replay', 'DK'),
  T(/(^|\.)crazyegg\.com$/, 'Crazy Egg', 'session-replay', 'US'),
  T(/(^|\.)licdn\.com$|(^|\.)linkedin\.com$/, 'LinkedIn', 'ads', 'US'),
  T(/(^|\.)tiktok\.com$|(^|\.)tiktokcdn\.com$|(^|\.)ttwstatic\.com$/, 'TikTok', 'ads', 'CN'),
  T(/(^|\.)snapchat\.com$|(^|\.)sc-static\.net$/, 'Snap', 'ads', 'US'),
  T(/(^|\.)pinterest\.com$|(^|\.)pinimg\.com$|(^|\.)pinterest\.[a-z.]+$/, 'Pinterest', 'ads', 'US'),
  T(/(^|\.)redditstatic\.com$|(^|\.)reddit\.com$/, 'Reddit', 'ads', 'US'),
  T(/(^|\.)ads-twitter\.com$|(^|\.)twitter\.com$|(^|\.)x\.com$|(^|\.)t\.co$/, 'X (Twitter)', 'ads', 'US'),
  T(/(^|\.)criteo\.(com|net)$/, 'Criteo', 'ads', 'FR'),
  T(/(^|\.)adform\.net$|(^|\.)adformdsp\.net$/, 'Adform', 'ads', 'DK'),
  T(/(^|\.)taboola\.com$/, 'Taboola', 'ads', 'US'),
  T(/(^|\.)outbrain\.com$/, 'Outbrain', 'ads', 'US'),
  T(/(^|\.)demdex\.net$|(^|\.)omtrdc\.net$|(^|\.)adobedc\.net$|(^|\.)2o7\.net$|(^|\.)everesttech\.net$/, 'Adobe Experience Cloud', 'analytics', 'US'),
  T(/(^|\.)segment\.(com|io)$/, 'Segment', 'analytics', 'US'),
  T(/(^|\.)mixpanel\.com$/, 'Mixpanel', 'analytics', 'US'),
  T(/(^|\.)amplitude\.com$/, 'Amplitude', 'analytics', 'US'),
  T(/(^|\.)heap(analytics)?\.(com|io)$/, 'Heap', 'analytics', 'US'),
  T(/(^|\.)matomo\.cloud$/, 'Matomo Cloud', 'analytics', 'NZ'),
  T(/(^|\.)piwik\.pro$/, 'Piwik PRO', 'analytics', 'PL'),
  T(/(^|\.)plausible\.io$/, 'Plausible', 'analytics-cookieless', 'EE'),
  T(/(^|\.)simpleanalytics(cdn)?\.com$/, 'Simple Analytics', 'analytics-cookieless', 'NL'),
  T(/(^|\.)usefathom\.com$/, 'Fathom', 'analytics-cookieless', 'CA'),
  T(/(^|\.)static\.cloudflareinsights\.com$|(^|\.)cloudflareinsights\.com$/, 'Cloudflare Web Analytics', 'analytics-cookieless', 'US'),
  T(/(^|\.)vercel-insights\.com$|(^|\.)va\.vercel-scripts\.com$/, 'Vercel Analytics', 'analytics-cookieless', 'US'),
  T(/(^|\.)siteimproveanalytics\.(com|io)$|(^|\.)siteimprove\.(com|net)$/, 'Siteimprove', 'analytics', 'DK'),
  T(/(^|\.)hs-scripts\.com$|(^|\.)hubspot\.com$|(^|\.)hsforms\.(net|com)$|(^|\.)hs-analytics\.net$|(^|\.)hs-banner\.com$|(^|\.)hscollectedforms\.net$|(^|\.)usemessages\.com$/, 'HubSpot', 'marketing', 'US'),
  T(/(^|\.)pardot\.com$|(^|\.)salesforce\.com$|(^|\.)force\.com$/, 'Salesforce', 'marketing', 'US'),
  T(/(^|\.)klaviyo\.com$/, 'Klaviyo', 'marketing', 'US'),
  T(/(^|\.)chimpstatic\.com$|(^|\.)list-manage\.com$|(^|\.)mailchimp\.com$/, 'Mailchimp', 'marketing', 'US'),
  T(/(^|\.)leadinfo\.(com|net)$/, 'Leadinfo', 'marketing', 'NL'),
  T(/(^|\.)leadfeeder\.com$|(^|\.)lfeeder\.com$/, 'Leadfeeder (Dealfront)', 'marketing', 'FI'),
  T(/(^|\.)intercom(cdn)?\.(io|com)$|(^|\.)intercomassets\.com$/, 'Intercom', 'marketing', 'US'),
  T(/(^|\.)zdassets\.com$|(^|\.)zendesk\.com$/, 'Zendesk', 'support', 'US'),
  T(/(^|\.)trustpilot\.(com|net)$/, 'Trustpilot', 'embed', 'DK'),
  T(/(^|\.)vimeo\.com$|(^|\.)vimeocdn\.com$/, 'Vimeo', 'embed', 'US'),
  T(/(^|\.)typeform\.com$/, 'Typeform', 'embed', 'ES'),
  T(/(^|\.)mc\.yandex\.(ru|com)$|(^|\.)yandex\.(ru|com)$/, 'Yandex Metrica', 'analytics', 'RU'),
  T(/(^|\.)hm\.baidu\.com$/, 'Baidu Analytics', 'analytics', 'CN'),
  T(/(^|\.)sentry\.io$|(^|\.)sentry-cdn\.com$/, 'Sentry', 'error-tracking', 'US'),
  T(/(^|\.)nr-data\.net$|(^|\.)newrelic\.com$/, 'New Relic', 'error-tracking', 'US'),
  T(/(^|\.)cookiebot\.(com|eu)$|(^|\.)usercentrics\.(eu|com)$/, 'Usercentrics / Cookiebot', 'consent', 'DE'),
  T(/(^|\.)cookielaw\.org$|(^|\.)onetrust\.(com|io)$/, 'OneTrust', 'consent', 'US'),
  T(/(^|\.)cookieinformation\.com$/, 'Cookie Information', 'consent', 'DK'),
  T(/(^|\.)privacy-center\.org$|(^|\.)didomi\.io$/, 'Didomi', 'consent', 'FR'),
  T(/(^|\.)cdn-cookieyes\.com$|(^|\.)cookieyes\.com$/, 'CookieYes', 'consent', 'GB'),
  T(/(^|\.)consensu\.org$/, 'IAB TCF vendor list', 'consent', null),
  T(/(^|\.)jsdelivr\.net$|(^|\.)unpkg\.com$|(^|\.)cdnjs\.cloudflare\.com$|(^|\.)ajax\.googleapis\.com$|(^|\.)code\.jquery\.com$/, 'Public JS CDN', 'cdn', null),
  T(/(^|\.)use\.typekit\.net$|(^|\.)p\.typekit\.net$/, 'Adobe Fonts', 'fonts', 'US'),
  T(/(^|\.)cloudinary\.com$|(^|\.)imgix\.net$/, 'Image CDN', 'cdn', 'US'),
];

/** host -> { vendor, category, country } | null */
export function classifyHost(host) {
  const h = String(host || '').toLowerCase();
  const v = VENDORS.find((x) => x.re.test(h));
  return v ? { vendor: v.vendor, category: v.category, country: v.country } : null;
}

// `on`: the cookie domain the name must come from, for names too generic to trust alone (SID, fr, uid).
const C = (re, vendor, purpose, country = null, on = null) => ({ re, vendor, purpose, country, on });
export const COOKIES = [
  // Strictly necessary: infrastructure, sessions, CSRF, load balancing, the consent record itself.
  C(/^(__cf_bm|cf_clearance|__cflb|_cfuvid|__cfruid|__cfwaitingroom)$/, 'Cloudflare', 'necessary', 'US'),
  C(/^(AWSALB|AWSALBCORS|AWSALBTG|AWSALBTGCORS|AWSELB)$/, 'AWS load balancer', 'necessary', 'US'),
  C(/^(ARRAffinity|ARRAffinitySameSite|TiPMix|x-ms-routing-name)$/, 'Azure App Service', 'necessary', 'US'),
  C(/^(incap_ses_.*|visid_incap_.*|nlbi_.*|reese84)$/, 'Imperva', 'necessary', 'US'),
  C(/^(_vcrcs|__vercel_live_token|_vercel_jwt)$/, 'Vercel', 'necessary', 'US'),
  C(/^(PHPSESSID|ASP\.NET_SessionId|JSESSIONID|\.AspNetCore\.(Session|Antiforgery.*|Cookies|Identity.*)|__RequestVerificationToken.*|XSRF-TOKEN|_csrf|csrftoken|.*csrf.*|connect\.sid|sessionid|laravel_session|UMB_UCONTEXT|UMB-XSRF-.*|UMB_SESSION|SC_ANALYTICS_GLOBAL_COOKIE_DISABLED|ASP\.NET_SessionId_.*)$/i, 'Session / CSRF', 'necessary'),
  C(/^(__Host-.*|__Secure-next-auth.*|next-auth\..*|_shopify_essential|cart|cart_sig|secure_customer_sig|_secure_session_id|wordpress_test_cookie|wp-settings-.*|wordpress_logged_in_.*)$/, 'Session', 'necessary'),
  C(/^(CookieConsent|CookieConsentBulkSetting-.*|OptanonConsent|OptanonAlertBoxClosed|eupubconsent-v2|euconsent-v2|CookieInformation(Consent|Config).*|uc_settings|uc_user_interaction|didomi_token|cookieyes-consent|cmplz_.*|klaro|borlabs-cookie|cookie_consent.*|cookieconsent_status|consentUUID|_sp_.*|usprivacy|OTAdditionalConsentString|consentmanager|__cmpconsent.*|cookiefirst-consent|CookieScriptConsent|axeptio_.*|tarteaucitron|moove_gdpr_popup|gdpr.*consent.*)$/i, 'Consent record', 'necessary'),
  C(/^(lang|language|locale|NEXT_LOCALE|i18n_redirected|i18next|currency|country|region|wp-wpml_current_language|pll_language|_icl_current_language)$/i, 'Language / region', 'preferences'),
  // Statistics
  C(/^(_ga|_ga_.*|_gid|_gat.*|_dc_gtm_.*|__utm[a-z]|_gac_.*|FPID|FPLC|FPAU|FPGCLAW)$/, 'Google Analytics', 'statistics', 'US'),
  C(/^(_hj.*)$/, 'Hotjar', 'statistics', 'MT'),
  C(/^(_clck|_clsk)$/, 'Microsoft Clarity', 'statistics', 'US'),
  C(/^(CLID|ANONCHK|SM|MR|SRM_B|MUID)$/, 'Microsoft Clarity', 'statistics', 'US', /(^|\.)(clarity\.ms|bing\.com)$/),
  C(/^(_pk_id.*|_pk_ses.*|_pk_ref.*|_pk_cvar.*|MATOMO_SESSID|mtm_.*)$/, 'Matomo', 'statistics'),
  C(/^(nmstat|siteimproveses|sz_.*)$/, 'Siteimprove', 'statistics', 'DK'),
  C(/^(mp_.*_mixpanel)$/, 'Mixpanel', 'statistics', 'US'),
  C(/^(amplitude_id.*|AMP_.*)$/, 'Amplitude', 'statistics', 'US'),
  C(/^(ajs_anonymous_id|ajs_user_id|ajs_group_id)$/, 'Segment', 'statistics', 'US'),
  C(/^(s_cc|s_sq|s_vi|s_fid|s_ecid|AMCV_.*|AMCVS_.*|mbox|at_check|demdex|dpm|dextp)$/, 'Adobe', 'statistics', 'US'),
  C(/^(_shopify_y|_shopify_s|_shopify_sa_p|_shopify_sa_t|_orig_referrer|_landing_page)$/, 'Shopify analytics', 'statistics', 'CA'),
  C(/^(_ce\.s|_ce\.clock_.*|_CEFT|cebs|cebsp_.*|_ce\.irv)$/, 'Crazy Egg', 'statistics', 'US'),
  C(/^(mf_.*|mf_user)$/, 'Mouseflow', 'statistics', 'DK'),
  C(/^(vuid)$/, 'Vimeo', 'statistics', 'US'),
  C(/^(_sp_id\..*|_sp_ses\..*)$/, 'Snowplow', 'statistics'),
  // Marketing
  C(/^(_gcl_.*|__gads|__gpi|__eoi)$/, 'Google Ads', 'marketing', 'US'),
  C(/^(IDE|test_cookie|DSID|NID|AEC|1P_JAR|ANID|FLC|RUL|__Secure-3PSID.*|__Secure-3PAPISID|__Secure-1PSID.*|SAPISID|APISID|SSID|HSID|SID|SIDCC|__Secure-ENID|OTZ|SOCS)$/, 'Google', 'marketing', 'US', /(^|\.)(google\.[a-z.]+|doubleclick\.net|youtube\.com)$/),
  C(/^(_fbp|_fbc)$/, 'Meta', 'marketing', 'US'),
  C(/^(fr|datr|sb|wd|xs|c_user)$/, 'Meta', 'marketing', 'US', /(^|\.)(facebook\.com|instagram\.com)$/),
  C(/^(_uetsid|_uetvid|_uetmsclkid)$/, 'Microsoft Ads', 'marketing', 'US'),
  C(/^(MSPTC|_EDGE_S|_EDGE_V|SRCHD|SRCHUID|SRCHUSR|_SS)$/, 'Microsoft Ads', 'marketing', 'US', /(^|\.)bing\.com$/),
  C(/^(li_sugr|bcookie|bscookie|lidc|UserMatchHistory|AnalyticsSyncHistory|li_gc|_guid|lang_li|li_mc|ln_or|li_fat_id|li_giant|lms_ads|lms_analytics)$/, 'LinkedIn', 'marketing', 'US'),
  C(/^(_ttp|_tt_enable_cookie|tt_.*|ttwid|tt_chain_token)$/, 'TikTok', 'marketing', 'CN'),
  C(/^(_pin_unauth|_pinterest_.*|_routing_id|_pinterest_ct_ua)$/, 'Pinterest', 'marketing', 'US'),
  C(/^(_scid|_scid_r|sc_at|_sctr|X-AB)$/, 'Snap', 'marketing', 'US'),
  C(/^(_rdt_uuid|_rdt_em)$/, 'Reddit', 'marketing', 'US'),
  C(/^(personalization_id|guest_id|guest_id_ads|guest_id_marketing|muc_ads)$/, 'X (Twitter)', 'marketing', 'US'),
  C(/^(__hstc|hubspotutk|__hssc|__hssrc|messagesUtk|__hs_.*)$/, 'HubSpot', 'marketing', 'US'),
  C(/^(visitor_id\d+.*|pardot|lpv\d+)$/, 'Salesforce Pardot', 'marketing', 'US'),
  C(/^(__kla_id)$/, 'Klaviyo', 'marketing', 'US'),
  C(/^(_li_dcdm_c|_lc2_fpi|_lc2_fpi_meta)$/, 'LiveConnect', 'marketing', 'US'),
  C(/^(cto_bundle|cto_bidid|criteo_.*)$/, 'Criteo', 'marketing', 'FR'),
  C(/^(_leadinfo.*|_lfa|_lfa_.*)$/, 'Lead tracking', 'marketing'),
  C(/^(YSC|VISITOR_INFO1_LIVE|VISITOR_PRIVACY_METADATA|__Secure-YEC|__Secure-ROLLOUT_TOKEN|LOGIN_INFO)$/, 'YouTube', 'marketing', 'US'),
  C(/^(PREF)$/, 'YouTube', 'marketing', 'US', /(^|\.)youtube\.com$/),
  C(/^(intercom-.*)$/, 'Intercom', 'marketing', 'US'),
];

/**
 * classifyCookie({ name, domain }, siteHost) -> { vendor, purpose, country, firstParty }
 * purpose: necessary | preferences | statistics | marketing | unclassified
 */
export function classifyCookie(cookie, siteHost = '') {
  const name = String(cookie.name || '');
  const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  const site = siteApex(siteHost);
  const firstParty = !domain || domain === site || domain.endsWith(`.${site}`) || siteHost.endsWith(domain);
  const hit = COOKIES.find((c) => c.re.test(name) && (!c.on || c.on.test(domain)));
  if (hit) return { vendor: hit.vendor, purpose: hit.purpose, country: hit.country, firstParty };
  // A cookie set by a known tracker domain inherits its category.
  const host = classifyHost(domain);
  if (host && !firstParty) return { vendor: host.vendor, purpose: ['analytics', 'session-replay'].includes(host.category) ? 'statistics' : host.category === 'consent' || host.category === 'cdn' ? 'necessary' : 'marketing', country: host.country, firstParty };
  return { vendor: null, purpose: 'unclassified', country: null, firstParty };
}

export const needsConsent = (purpose) => purpose === 'statistics' || purpose === 'marketing';

export function siteApex(host) {
  const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const two = labels.slice(-2).join('.');
  return /^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(two) ? labels.slice(-3).join('.') : two;
}

export const CMP_SIGNATURES = [
  { name: 'Cookiebot', re: /consent\.cookiebot\.(com|eu)|Cookiebot\b|CybotCookiebot/i },
  { name: 'Usercentrics', re: /usercentrics/i },
  { name: 'OneTrust', re: /onetrust|optanon|cookielaw\.org/i },
  { name: 'Cookie Information', re: /cookieinformation\.com|coi-banner|CookieInformation/i },
  { name: 'Didomi', re: /didomi/i },
  { name: 'Klaro', re: /klaro/i },
  { name: 'CookieYes', re: /cookieyes|cky-consent/i },
  { name: 'Complianz', re: /complianz|cmplz/i },
  { name: 'Borlabs Cookie', re: /borlabs/i },
  { name: 'CookieFirst', re: /cookiefirst/i },
  { name: 'Osano', re: /osano/i },
  { name: 'TrustArc', re: /trustarc|truste\.com/i },
  { name: 'Sourcepoint', re: /sourcepoint|sp-prod\.net|privacy-mgmt\.com/i },
  { name: 'Quantcast Choice', re: /quantcast\.mgr\.consensu|quantcast choice/i },
  { name: 'consentmanager', re: /consentmanager\.net/i },
  { name: 'Axeptio', re: /axeptio/i },
  { name: 'Iubenda', re: /iubenda/i },
  { name: 'Termly', re: /termly/i },
];

export function detectCmp(text) {
  return CMP_SIGNATURES.find((c) => c.re.test(text || ''))?.name || null;
}

/**
 * Google tag hits carry what Consent Mode told Google: gcs=G1<ad_storage><analytics_storage>
 * (G100 = both denied), in the query or as ;gcs= in Floodlight paths. null for non-Google URLs
 * and for requests that carry no consent state (script downloads).
 */
export function googleConsentState(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|googleadservices\.com|google\.[a-z.]+)$/.test(u.hostname)) return null;
  const params = new Map(u.searchParams);
  for (const part of u.pathname.split(';').slice(1)) { const i = part.indexOf('='); if (i > 0) params.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1))); }
  const gcs = params.get('gcs');
  const m = /^G1([01-])([01-])$/.exec(gcs || '');
  if (!m && !params.has('pscdl')) return null;
  return { gcs: gcs || null, ads: m ? m[1] === '1' : null, analytics: m ? m[2] === '1' : null, denied: m ? m[1] !== '1' && m[2] !== '1' : params.get('pscdl') === 'denied' };
}
