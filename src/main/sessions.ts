import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanEnv } from './env.ts';
import { workerSessions } from './workers.ts';
import type { AccountSummary, Connection, CouncilConfig, Profile, SessionSummary } from '../shared/types.ts';

/** The SDK's session helpers read CLAUDE_CONFIG_DIR from this process's env. */
function useProfile(p: Profile) { process.env.CLAUDE_CONFIG_DIR = p.configDir; }

export async function folderSessions(p: Profile, folder: string): Promise<SessionSummary[]> {
  useProfile(p);
  const list = await listSessions({ dir: folder, includeWorktrees: false });
  const workers = await workerSessions();
  return list
    .filter((s) => !Object.hasOwn(workers, s.sessionId))
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 60)
    .map((s) => ({ sessionId: s.sessionId, title: (s.customTitle || s.summary || s.firstPrompt || 'Untitled').slice(0, 120), lastModified: s.lastModified, gitBranch: s.gitBranch,
      contextPct: sessionContextPct(p, folder, s.sessionId) }));
}

export function sessionContextPct(p: Profile, folder: string, sessionId: string): number | undefined {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return undefined;
  return estimateContext(join(p.configDir, 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`));
}

/** Context window per model. Current Claude models default to 1M; older ones to 200k unless [1m]. */
function contextWindow(model: string) {
  if (/\[1m\]/i.test(model) || /claude-(opus|sonnet|haiku|fable|mythos)-5/.test(model)) return 1_000_000;
  return 200_000;
}

/** Cheap list estimate: tokens the session's last top-level reply read, over its model's window. */
function estimateContext(file: string): number | undefined {
  let fd: number | undefined;
  try {
    const size = statSync(file).size;
    const len = Math.min(size, 160 * 1024);
    const buf = Buffer.alloc(len);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l.includes('"type":"assistant"') || !l.includes('"usage"')) continue;
      try {
        const j = JSON.parse(l);
        if (j.isSidechain) continue;
        const u = j.message?.usage ?? {};
        const t = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        if (t > 0) return Math.min(100, Math.round((t / contextWindow(String(j.message?.model ?? ''))) * 100));
      } catch { /* partial line */ }
    }
  } catch { /* no file */ } finally { if (fd !== undefined) closeSync(fd); }
  return undefined;
}

export async function sessionTranscript(p: Profile, folder: string, sessionId: string) {
  useProfile(p);
  const msgs = await getSessionMessages(sessionId, { dir: folder });
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const m of msgs) {
    if (m.parent_tool_use_id || (m.type !== 'user' && m.type !== 'assistant')) continue;
    const c = (m.message as any)?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : '';
    if (text.trim() && !text.startsWith('<')) out.push({ role: m.type, text });
  }
  return out;
}

/** Folders you've used in Council, then folders Claude has sessions in (newest first). */
export async function knownFolders(cfg: CouncilConfig, p: Profile): Promise<string[]> {
  const seen = new Set(cfg.recentFolders.map((f) => f.toLowerCase()));
  const out = [...cfg.recentFolders];
  try {
    useProfile(p);
    const all = await listSessions({ limit: 300 });
    for (const s of all.sort((a, b) => b.lastModified - a.lastModified)) {
      const cwd = s.cwd;
      if (cwd && !seen.has(cwd.toLowerCase()) && existsSync(cwd)) { seen.add(cwd.toLowerCase()); out.push(cwd); }
      if (out.length >= 15) break;
    }
  } catch { /* no history */ }
  return out;
}

export function accountSummaries(cfg: CouncilConfig): AccountSummary[] {
  return cfg.profiles.map((p) => {
    let email: string | undefined, subscriptionType: string | undefined;
    for (const f of [join(p.configDir, '.claude.json'), ...(p.configDir === join(homedir(), '.claude') ? [join(homedir(), '.claude.json')] : [])]) {
      try {
        const j = JSON.parse(readFileSync(f, 'utf8'));
        email ??= j.oauthAccount?.emailAddress;
        const org = j.oauthAccount?.organizationType as string | undefined;   // e.g. claude_max, claude_team
        if (org && !subscriptionType) subscriptionType = org.replace(/^claude_/, '').replace(/^\w/, (c) => c.toUpperCase());
      } catch { /* missing */ }
    }
    const signedIn = existsSync(join(p.configDir, '.credentials.json')) || !!email;
    return { profileId: p.id, email, subscriptionType, signedIn };
  });
}

/** New account profile with its own config dir. Its projects/ folder is a junction to the
 *  first profile's, so session history is shared between your accounts. */
export function createProfile(cfg: CouncilConfig, name: string): Profile {
  const n = cfg.profiles.length + 1;
  let id = String.fromCharCode(96 + n);
  while (cfg.profiles.some((p) => p.id === id)) id += 'x';
  const configDir = join(homedir(), `.claude-${id}`);
  mkdirSync(configDir, { recursive: true });
  const shared = join(cfg.profiles[0].configDir, 'projects');
  const mine = join(configDir, 'projects');
  if (!existsSync(mine) && existsSync(shared)) {
    try { symlinkSync(shared, mine, 'junction'); } catch { /* fall back to separate history */ }
  }
  return { id, name: name || `Account ${n}`, configDir };
}

/** Opens a console running `claude /login` for that profile; the user finishes sign-in there. */
export function openSignIn(bin: string, p: Profile) {
  spawn('cmd.exe', ['/c', 'start', '"Council sign-in"', 'cmd', '/k', `"${bin}"`, '/login'], {
    env: cleanEnv({ CLAUDE_CONFIG_DIR: p.configDir }),
    detached: true, stdio: 'ignore', windowsVerbatimArguments: true,
  }).unref();
}

/** MCP connections each CLI already has configured (names only; the chair reports live status). */
export function configuredConnections(p: Profile, folder: string | null): Connection[] {
  const out: Connection[] = [];
  const add = (agent: Connection['agent'], obj: unknown) => { if (obj && typeof obj === 'object') for (const name of Object.keys(obj)) out.push({ agent, name }); };
  try {
    const j = JSON.parse(readFileSync(join(p.configDir, '.claude.json'), 'utf8'));
    add('chair', j.mcpServers);
    if (folder) add('chair', j.projects?.[folder.replace(/\\/g, '/')]?.mcpServers ?? j.projects?.[folder]?.mcpServers);
  } catch { /* none */ }
  try {
    const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
    for (const m of toml.matchAll(/^\[mcp_servers\.("?)([^\]".]+)\1\]/gm)) out.push({ agent: 'codex', name: m[2] });
  } catch { /* none */ }
  try {
    for (const f of ['mcp_config.json', 'settings.json']) {
      const file = join(homedir(), '.gemini', 'antigravity', f);
      if (existsSync(file)) add('antigravity', JSON.parse(readFileSync(file, 'utf8')).mcpServers);
    }
  } catch { /* none */ }
  return out;
}
