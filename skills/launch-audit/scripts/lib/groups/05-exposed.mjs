/**
 * 5. Exposed files & admin paths — well-known paths only, one request each,
 * sequential, and a 200 counts only when the body proves the file is real
 * (SPA and CMS catch-alls answer 200 for anything).
 */
import { result } from '../registry.mjs';

const isJsonWith = (keys) => (body) => {
  try { const j = JSON.parse(body); return j && typeof j === 'object' && keys.some((k) => k in j); } catch { return false; }
};

/** path, what proves it, what it leaks */
const SECRET_PROBES = [
  { path: '/.git/HEAD', test: (b) => /^ref:\s*refs\//.test(b), leak: 'the git repository (source code and history)' },
  { path: '/.git/config', test: (b) => /\[core\]|\[remote /.test(b), leak: 'git config with remote URLs' },
  { path: '/.env', test: (b) => /^[A-Z_][A-Z0-9_]*=/m.test(b) && !/<html/i.test(b), leak: 'environment variables (keys, connection strings)' },
  { path: '/appsettings.json', test: isJsonWith(['ConnectionStrings', 'Logging', 'Umbraco', 'AllowedHosts']), leak: 'ASP.NET settings incl. connection strings' },
  { path: '/appsettings.Development.json', test: isJsonWith(['ConnectionStrings', 'Logging', 'Umbraco']), leak: 'ASP.NET development settings' },
  { path: '/web.config', test: (b) => /<configuration[\s>]/i.test(b), leak: 'IIS configuration' },
  { path: '/.DS_Store', test: (b, h, buf) => buf && buf.length > 8 && buf.readUInt32BE(0) === 1 && buf.toString('latin1', 4, 8) === 'Bud1', leak: 'directory listings from macOS' },
  { path: '/wp-config.php', test: (b) => /DB_NAME|DB_PASSWORD/.test(b), leak: 'WordPress database credentials' },
  { path: '/.htaccess', test: (b) => /RewriteEngine|<IfModule|AuthType/i.test(b) && !/<html/i.test(b), leak: 'Apache rules' },
  { path: '/phpinfo.php', test: (b) => /PHP Version|phpinfo\(\)/i.test(b), leak: 'PHP configuration' },
  { path: '/server-status', test: (b) => /Apache Server Status/i.test(b), leak: 'Apache server status' },
  { path: '/composer.json', test: isJsonWith(['require', 'autoload']), leak: 'PHP dependency manifest', disclosure: true },
  { path: '/package.json', test: isJsonWith(['dependencies', 'devDependencies', 'scripts']), leak: 'Node dependency manifest', disclosure: true },
  { path: '/.well-known/openid-configuration', test: () => false, leak: '' },
];

const ADMIN_PROBES = [
  { path: '/umbraco', name: 'Umbraco backoffice' },
  { path: '/sitecore', name: 'Sitecore login' },
  { path: '/wp-admin', name: 'WordPress admin' },
  { path: '/wp-login.php', name: 'WordPress login' },
  { path: '/admin', name: '/admin' },
  { path: '/administrator', name: 'Joomla admin' },
  { path: '/episerver', name: 'Optimizely (Episerver) admin' },
  { path: '/_layouts/15/settings.aspx', name: 'SharePoint settings' },
];
const LOGIN_MARK = /<input[^>]+type=["']?password|umbraco|sitecore|wp-login|login|log in|sign in|adgangskode/i;

function parseSecurityTxt(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const fields = {};
  for (const l of lines) {
    const m = l.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    (fields[k] ||= []).push(m[2].trim());
  }
  return fields;
}

export default {
  id: 'exposed',
  title: 'Exposed files & admin paths',
  phase: 'B',
  budget: 90000,
  async run(ctx) {
    const { http, origin } = ctx;
    const out = [];
    const hits = []; const disclosures = []; const checked = [];
    for (const p of SECRET_PROBES) {
      if (!p.leak) continue;
      const res = await http.get(origin + p.path, { redirect: 'manual', maxBytes: 64 * 1024, as: 'buffer', retry: 0 });
      const body = res.body ? res.body.toString('utf8') : '';
      const real = res.status === 200 && p.test(body, res.headers, res.body);
      checked.push({ path: p.path, status: res.status, real });
      if (real) (p.disclosure ? disclosures : hits).push(`${p.path} (${p.leak})`);
    }
    // Secrets and server config are blockers; a dependency manifest only tells an attacker which versions to look up.
    out.push(hits.length
      ? result('exposed.secret-files', 'fail', 'Secret files reachable', hits.join('; '), { fix: 'Block these paths at the web server / CDN and rotate any credential they contain — assume it has been read.', blocker: true, data: { checked } })
      : result('exposed.secret-files', 'pass', 'Secret files reachable', `${checked.length} well-known paths probed (.git, .env, appsettings.json, web.config, …); none served a real file`, { data: { checked } }));
    if (disclosures.length) out.push(result('exposed.manifests', 'warn', 'Dependency manifests reachable', disclosures.join('; '), { fix: 'Exclude package.json / composer.json from the deployed files or block them; they list exact library versions for anyone hunting known CVEs.' }));

    const reachable = [];
    for (const p of ADMIN_PROBES) {
      const res = await http.get(origin + p.path, { redirect: 'manual', maxBytes: 64 * 1024, retry: 0 });
      const loc = res.headers.location || '';
      const isLogin = (res.status === 200 && LOGIN_MARK.test(res.body || '')) || (res.status >= 300 && res.status < 400 && /login|umbraco|sitecore|signin|auth/i.test(loc));
      if (isLogin) reachable.push(`${p.name} (${p.path} → ${res.status}${loc ? ` ${loc}` : ''})`);
    }
    out.push(reachable.length
      ? result('exposed.admin-paths', 'warn', 'Backoffice reachable from the internet', reachable.join('; '), { fix: 'Restrict the backoffice to office/VPN IPs or put it behind Cloudflare Access / MFA; at minimum confirm rate limiting on the login.', beforeProduction: true })
      : result('exposed.admin-paths', 'pass', 'Backoffice reachable from the internet', 'no known CMS login answered on this host'));

    const st = await http.get(`${origin}/.well-known/security.txt`, { redirect: 'follow', maxBytes: 32 * 1024 });
    const legacy = st.status !== 200 ? await http.get(`${origin}/security.txt`, { redirect: 'follow', maxBytes: 32 * 1024 }) : null;
    const body = st.status === 200 ? st.body : (legacy?.status === 200 ? legacy.body : null);
    if (body && /text\/plain/i.test((st.status === 200 ? st : legacy).contentType) && /contact:/i.test(body)) {
      const f = parseSecurityTxt(body);
      const issues = [];
      if (!f.contact) issues.push('no Contact');
      if (!f.expires) issues.push('no Expires (required by RFC 9116)');
      else {
        const exp = new Date(f.expires[0]);
        if (Number.isNaN(exp.getTime())) issues.push('Expires is not an ISO date');
        else if (exp < new Date()) issues.push(`expired ${f.expires[0]}`);
        else if (exp - Date.now() > 366 * 86400000) issues.push('Expires more than a year ahead (should be under a year)');
      }
      if (st.status !== 200) issues.push('served at /security.txt only — RFC 9116 wants /.well-known/security.txt');
      out.push(result('exposed.security-txt', issues.length ? 'warn' : 'pass', 'security.txt', issues.length ? issues.join('; ') : `Contact ${f.contact[0]}${f.expires ? `, expires ${f.expires[0]}` : ''}`, { fix: issues.length ? 'Fix the fields; securitytxt.org generates a valid file.' : '', link: 'https://securitytxt.org/' }));
    } else {
      out.push(result('exposed.security-txt', 'info', 'security.txt', 'no /.well-known/security.txt — researchers who find a hole have nobody to tell', { fix: 'Add one (Contact:, Expires:, Preferred-Languages:); securitytxt.org generates it.', link: 'https://securitytxt.org/' }));
    }
    return out;
  },
};
