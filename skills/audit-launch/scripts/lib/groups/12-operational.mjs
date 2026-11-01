/**
 * 12. Operational readiness — nothing here can be tested from outside; the
 * report renders these as a checklist so they are not forgotten on launch day.
 */
import { result } from '../registry.mjs';

const ITEMS = [
  ['uptime', 'Uptime monitoring', 'A monitor (UptimeRobot, Better Stack, Cloudflare health check) watches the production URL and alerts a person.'],
  ['error-tracking', 'Error tracking', 'The production DSN (Sentry or similar) receives events from the live domain, not the staging project.'],
  ['analytics', 'Analytics on the production domain', 'The production property receives data from the live hostname; staging traffic is filtered out.'],
  ['certificate', 'Certificate renewal', 'Renewal is automatic, and an expiry alert exists in case it is not.'],
  ['dns-ttl', 'DNS TTL before the switch', 'TTLs on the records that change at launch are lowered (300 s) a day ahead, and raised again after.'],
  ['redirect-map', 'Redirects from the old site', 'Every old URL with traffic or backlinks 301s to its new page (run with --old-sitemap when that lands).'],
  ['search-console', 'Search Console', 'Ownership verified for the live domain; the sitemap submitted on launch day; the old property\'s change-of-address done if the domain moved.'],
  ['social-cache', 'Social share caches', 'LinkedIn Post Inspector and Facebook Sharing Debugger re-scraped so previews shared during staging update.'],
  ['backups', 'Backups', 'A restore has been rehearsed, not only configured, for the CMS database and media.'],
  ['cdn-purge', 'CDN purge', 'The cache is purged after the final deploy; stale staging HTML is not what visitors see first.'],
  ['waf', 'WAF and rate limiting', 'Bot protection is on for production, with the audit/monitoring IPs allowlisted.'],
  ['forms-email', 'Forms and transactional email', 'Every form on the site has been submitted once on production and the email arrived (SPF/DMARC pass).'],
  ['legal', 'Legal pages', 'Privacy policy, cookie policy and imprint are live, linked from the footer, and the consent tool matches what the site loads.'],
  ['404-monitoring', 'Post-launch 404 monitoring', 'Someone watches Search Console / server logs for 404s in the first two weeks.'],
];

export default {
  id: 'ops',
  title: 'Operational readiness',
  phase: 'B',
  budget: 5000,
  async run() {
    return ITEMS.map(([id, title, text]) => result(`ops.${id}`, 'info', title, text));
  },
};
