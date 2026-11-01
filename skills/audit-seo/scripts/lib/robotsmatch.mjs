/**
 * Is a path allowed for every crawler (the `*` group)? RFC 9309 matching: the longest
 * matching rule wins, Allow wins a tie, `*` matches any run of characters and a trailing
 * `$` anchors the end.
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import { groupFor } from './robots.mjs';

function ruleRegex(rule) {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** isAllowed(parsedRobots, '/path?query', agent = '*') -> boolean. No robots or no group: allowed. */
export function isAllowed(parsed, pathAndQuery, agent = '*') {
  const group = parsed ? groupFor(parsed, agent) : null;
  if (!group) return true;
  let path = String(pathAndQuery || '/');
  try { path = decodeURI(path); } catch { /* keep as is */ }
  let best = { len: -1, allow: true };
  for (const [rules, allow] of [[group.allow, true], [group.disallow, false]]) {
    for (const rule of rules) {
      let r = rule;
      try { r = decodeURI(rule); } catch { /* keep as is */ }
      if (!ruleRegex(r).test(path)) continue;
      const len = r.length;
      if (len > best.len || (len === best.len && allow)) best = { len, allow };
    }
  }
  return best.allow;
}
