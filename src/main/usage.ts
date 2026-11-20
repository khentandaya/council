import { query } from '@anthropic-ai/claude-agent-sdk';
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanEnv } from './env.ts';
import type { AgentUsage, ContextInfo, Profile, UsageWindow } from '../shared/types.ts';

/** Opens a Claude session that never sends a prompt, so control requests (usage, context)
 *  can be answered without a model turn. Takes about 2 seconds. */
async function withIdleClaude(bin: string, p: Profile, extra: { cwd?: string; resume?: string; settingSources?: [] }, fn: (q: any) => Promise<any>): Promise<any> {
  let release!: () => void;
  const idle = new Promise<void>((r) => (release = r));
  async function* never(): AsyncGenerator<never> { await idle; }
  const q = query({
    prompt: never() as any,
    options: { ...extra, pathToClaudeCodeExecutable: bin || undefined, env: cleanEnv({ CLAUDE_CONFIG_DIR: p.configDir }) },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), 20_000); });
  try { return await Promise.race([fn(q), timeout]); }
  finally { clearTimeout(timer); release(); try { q.close(); } catch { /* already closed */ } }
}

const win = (w: { utilization: number | null; resets_at: string | null } | null | undefined): UsageWindow | undefined =>
  w && w.utilization !== null ? { usedPct: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : null } : undefined;

async function claudeUsage(bin: string, p: Profile): Promise<AgentUsage> {
  const fetchedAt = Date.now();
  try {
    const u = await withIdleClaude(bin, p, { settingSources: [] }, (q) => q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));
    if (!u.rate_limits_available || !u.rate_limits) return { agent: 'claude', available: false, note: 'This account has no plan limits (API key or cloud provider).', fetchedAt };
    return { agent: 'claude', available: true, fiveHour: win(u.rate_limits.five_hour), weekly: win(u.rate_limits.seven_day), plan: u.subscription_type ?? undefined, fetchedAt };
  } catch (err) {
    return { agent: 'claude', available: false, note: `Could not read Claude usage: ${String((err as Error).message ?? err).slice(0, 120)}`, fetchedAt };
  }
}

/** Codex writes its plan limits into every session log; the newest log has the freshest numbers. */
function codexUsage(): AgentUsage {
  const fetchedAt = Date.now();
  const root = join(homedir(), '.codex', 'sessions');
  try {
    // sessions/YYYY/MM/DD/rollout-*.jsonl: walk the newest day folders first
    const newest = (d: string) => readdirSync(d).sort().reverse();
    for (const y of newest(root)) for (const m of newest(join(root, y))) for (const d of newest(join(root, y, m))) {
      const dir = join(root, y, m, d);
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const { f, t } of files) {
        const rl = lastRateLimits(f);
        if (!rl) continue;
        const w = (x: any): UsageWindow | undefined => x && typeof x.used_percent === 'number' ? { usedPct: x.used_percent, resetsAt: x.resets_at ? x.resets_at * 1000 : null } : undefined;
        // primary = 5-hour (300 min), secondary = weekly (10080 min). Trust window_minutes when present;
        // fall back to position only for a window that doesn't say its length.
        const wins = [rl.primary, rl.secondary].filter(Boolean);
        const pick = (mins: number, pos: any) => wins.find((x: any) => x.window_minutes === mins) ?? (pos && pos.window_minutes == null ? pos : undefined);
        const five = pick(300, rl.primary);
        const week = pick(10080, rl.secondary);
        // a window that already reset since this log was written is back at 0
        const fresh = (u?: UsageWindow) => u && u.resetsAt && u.resetsAt < Date.now() ? { usedPct: 0, resetsAt: null } : u;
        return { agent: 'codex', available: true, fiveHour: fresh(w(five)), weekly: fresh(w(week)), note: `From Codex's last run (${new Date(t).toLocaleString()}).`, fetchedAt };
      }
    }
  } catch { /* no sessions */ }
  return { agent: 'codex', available: false, note: 'No Codex runs found yet. Limits appear after the first Codex task.', fetchedAt };
}

function lastRateLimits(file: string): any | null {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const l of lines) {
      if (!l.includes('"rate_limits"')) continue;
      try {
        const j = JSON.parse(l);
        const rl = j.payload?.rate_limits ?? j.rate_limits ?? j.msg?.rate_limits;
        // skip other buckets (e.g. "premium") and snapshots that carry no window
        if (rl && (rl.limit_id == null || rl.limit_id === 'codex') && (rl.primary || rl.secondary)) return rl;
      } catch { /* partial first line */ }
    }
    return null;
  } finally { closeSync(fd); }
}

const AGY: Omit<AgentUsage, 'fetchedAt'> = {
  agent: 'antigravity', available: false,
  note: "Antigravity's CLI doesn't report its quota. Council shows the tokens it measured instead.",
};

const cache = new Map<string, { at: number; v: AgentUsage[] }>();

export async function allUsage(bin: string, p: Profile, force = false): Promise<AgentUsage[]> {
  const hit = cache.get(p.id);
  if (hit && !force && Date.now() - hit.at < 90_000) return hit.v;
  const v = [await claudeUsage(bin, p), codexUsage(), { ...AGY, fetchedAt: Date.now() }];
  cache.set(p.id, { at: Date.now(), v });
  return v;
}

/** Exact context use of a saved chair session, read without sending anything to it. */
export async function sessionContext(bin: string, p: Profile, cwd: string, sessionId: string): Promise<ContextInfo | null> {
  try {
    const c = await withIdleClaude(bin, p, { cwd, resume: sessionId }, (q) => q.getContextUsage({ detail: 'summary' }));
    return { percentage: c.percentage, totalTokens: c.totalTokens, maxTokens: c.maxTokens, model: c.model };
  } catch { return null; }
}
