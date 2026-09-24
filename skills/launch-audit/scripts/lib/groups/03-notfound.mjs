/**
 * 3. Real 404s — a missing page must answer 404 (or 410), not 200 ("soft 404")
 * and not a redirect to the homepage.
 */
import { result } from '../registry.mjs';
import { sameUrlModuloSlash } from '../http.mjs';
import { extractMeta, stripTags } from '../html.mjs';

const NOT_FOUND_WORDS = /not found|page (could not be|cannot be|can't be) found|404|doesn'?t exist|does not exist|findes ikke|siden blev ikke fundet|kunne ikke findes|no encontrada|nicht gefunden|introuvable/i;
const PLATFORM_DEFAULT = /<center>nginx<\/center>|IIS Web Core|<title>404 Not Found<\/title>\s*<\/head>\s*<body>\s*<center>|The resource you are looking for has been removed|Apache\/[\d.]+ \(.*\) Server at|<title>Error<\/title><\/head><body><pre>Cannot GET/i;

export default {
  id: 'notfound',
  title: 'Real 404s',
  phase: 'B',
  budget: 45000,
  async run(ctx) {
    const { http, origin, finalUrl } = ctx;
    const out = [];
    const probe = `${origin}/launch-audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await http.get(probe, { redirect: 'follow', maxBytes: 256 * 1024 });
    const html = /text\/html/i.test(res.contentType) && res.body ? res.body : '';
    const meta = html ? extractMeta(html, probe) : null;
    const text = html ? stripTags(html).slice(0, 4000) : '';
    const saysNotFound = NOT_FOUND_WORDS.test(meta?.title || '') || NOT_FOUND_WORDS.test(text);

    if (res.status === 0) {
      out.push(result('notfound.random-path', 'skip', 'Unknown URL answers 404', `no response: ${res.error}`));
      return out;
    }
    if (res.status === 404 || res.status === 410) {
      out.push(result('notfound.random-path', 'pass', 'Unknown URL answers 404', `${res.status} for a random path${meta?.title ? ` — "${meta.title}"` : ''}`));
    } else if (res.status === 200 && sameUrlModuloSlash(res.finalUrl, finalUrl)) {
      out.push(result('notfound.random-path', 'warn', 'Unknown URL answers 404', `a random path redirects to the homepage (200 at ${res.finalUrl})`, { fix: 'Answer 404 for unknown URLs; redirecting everything to the front page hides broken links from Search Console and users.' }));
    } else if (res.status === 200 && saysNotFound) {
      out.push(result('notfound.random-path', 'warn', 'Unknown URL answers 404', `soft 404: a "not found" page is served with status 200${meta?.title ? ` ("${meta.title}")` : ''}`, { fix: 'Keep the page, change the status code to 404 so search engines drop the URL instead of indexing the error page.' }));
    } else if (res.status === 200) {
      out.push(result('notfound.random-path', 'fail', 'Unknown URL answers 404', `soft 404: a random path returns 200${meta?.title ? ` ("${meta.title}")` : ''}`, { fix: 'Return 404 for unknown URLs (SPA catch-all routes and CMS fallbacks often answer 200 for everything).' }));
    } else if (res.status >= 500) {
      out.push(result('notfound.random-path', 'fail', 'Unknown URL answers 404', `a random path returns ${res.status}`, { fix: 'The not-found path throws; fix the error handler so unknown URLs answer 404.' }));
    } else {
      out.push(result('notfound.random-path', 'info', 'Unknown URL answers 404', `a random path returns ${res.status} (final URL ${res.finalUrl})`));
    }

    if (html) {
      const custom = html.length > 1500 && !PLATFORM_DEFAULT.test(html);
      const links = (html.match(/<a\s/gi) || []).length;
      out.push(result('notfound.custom-page', custom ? 'pass' : 'info', 'Custom not-found page',
        custom ? `branded page with ${links} links${meta?.title ? ` — "${meta.title}"` : ''}` : 'the platform\'s default error page is served',
        { fix: custom ? '' : 'Design a not-found page with navigation and a search box; it is the page a broken link lands on.' }));
    }
    return out;
  },
};
