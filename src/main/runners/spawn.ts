import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { cleanEnv, launchSpec } from '../env.ts';

export interface SpawnOpts {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  onJson: (obj: any) => void;
}

/** Runs a CLI that prints one JSON object per line. Resolves with exit info;
 *  never rejects, so a failing worker becomes a reportable result, not a crash. */
export function spawnJsonLines(o: SpawnOpts): Promise<{ code: number | null; stderr: string; timedOut: boolean; aborted: boolean }> {
  return new Promise((resolve) => {
    const l = launchSpec(o.bin, o.args);
    const child = spawn(l.cmd, l.args, {
      cwd: o.cwd,
      env: cleanEnv({ ...o.env, ...l.env }),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdin.end(); // both CLIs wait on stdin otherwise

    let stderr = '';
    let timedOut = false;
    let aborted = false;
    const kill = () => { try { child.kill(); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
    const onAbort = () => { aborted = true; kill(); };
    o.signal?.addEventListener('abort', onAbort, { once: true });

    createInterface({ input: child.stdout }).on('line', (line) => {
      const s = line.trim();
      if (!s.startsWith('{')) return;
      try { o.onJson(JSON.parse(s)); } catch { /* partial or non-JSON line */ }
    });
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });

    const done = (code: number | null) => {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stderr, timedOut, aborted });
    };
    child.on('error', (err) => { stderr += String(err); done(-1); });
    child.on('close', done);
  });
}
