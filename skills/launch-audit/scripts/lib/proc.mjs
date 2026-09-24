/**
 * Run an external command with a hard deadline. On timeout the whole process
 * group is SIGKILLed (Chrome and npx spawn children that would otherwise linger).
 * Never throws: { code, stdout, stderr, timedOut, ms, error? }.
 */
import { spawn } from 'node:child_process';

export function runCommand(cmd, args = [], { timeout = 60000, cwd, env, maxBuffer = 16 * 1024 * 1024, input } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = ''; let stderr = ''; let timedOut = false; let settled = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, ms: 0, error: e.message });
      return;
    }
    const kill = () => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    child.stdout.on('data', (d) => { if (stdout.length < maxBuffer) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < maxBuffer) stderr += d; });
    child.on('error', (e) => finish({ code: null, stdout, stderr, timedOut, ms: Date.now() - started, error: e.message }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut, ms: Date.now() - started, ...(timedOut ? { error: `timed out after ${timeout} ms` } : {}) }));
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}
