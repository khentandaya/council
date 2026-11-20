import type { AgentId } from '../../shared/types.ts';
import { notify, state } from '../store.ts';

const api = window.council;

export const AGENT_NAME: Record<AgentId, string> = {
  chair: 'Claude', codex: 'Codex', antigravity: 'Antigravity', claude: 'Claude workers',
};
export const AGENT_ROLE: Record<AgentId, string> = {
  chair: 'Chair', codex: 'Lab', antigravity: 'Studio', claude: 'Bullpen',
};

export async function refreshConfig() { state.config = await api.getConfig(); notify('config'); }
export async function refreshAccounts() { state.accounts = await api.accounts(); notify('accounts'); }
let sessionRequest = 0;
export async function refreshSessions() {
  const request = ++sessionRequest;
  const [sessions, workers] = await Promise.all([api.listSessions(), api.listWorkerSessions().catch(() => [])]);
  if (request !== sessionRequest) return;
  state.sessions = sessions;
  state.workerSessions = workers;
  notify('sessions');
}
export async function refreshConnections() { state.connections = await api.connections(); notify('connections'); }

let usageBusy = false;
let usageQueued: boolean | null = null;   // a refresh asked for while one was running (true = forced)
export async function refreshUsage(force = false) {
  if (usageBusy) { usageQueued = usageQueued || force; return; }
  usageBusy = true;
  const profile = state.config?.activeProfileId;
  try {
    const u = await api.usage(force);
    // an account switch mid-request makes this reading stale; the queued refresh fetches the new one
    if (profile === state.config?.activeProfileId) { state.usage = u; notify('usage'); }
  } catch { /* keep the last reading */ } finally {
    usageBusy = false;
    if (usageQueued !== null) { const f = usageQueued; usageQueued = null; refreshUsage(f); }
  }
}

/** Bumped by any newer context reading (a live estimate or another fetch), so a slow fetch can't overwrite it. */
let contextGen = 0;
export function bumpContext() { contextGen++; }

/** Exact context reading for the current chair session (about 2s; nothing is sent to the model). */
export async function refreshContext() {
  const id = state.resumeId;
  if (!id) { state.context = null; notify('context'); return; }
  const gen = ++contextGen;
  state.context = { ...(state.context ?? { pct: null, tokens: 0, max: null, exact: false }), loading: true };
  notify('context');
  const c = await api.sessionContext(id).catch(() => null);
  if (state.resumeId !== id || gen !== contextGen) {   // switched sessions, or a newer reading landed
    if (state.context?.loading) { state.context = { ...state.context, loading: false }; notify('context'); }
    return;
  }
  state.context = c ? { pct: c.percentage, tokens: c.totalTokens, max: c.maxTokens, model: c.model, exact: true } : { ...state.context!, loading: false };
  notify('context');
}

export function fmtReset(at: number | null): string {
  if (!at) return 'reset time unknown';
  const m = Math.round((at - Date.now()) / 60000);
  if (m <= 0) return 'resets now';
  if (m < 60) return `resets in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `resets in ${h}h ${m % 60}m`;
  return `resets ${new Date(at).toLocaleDateString(undefined, { weekday: 'short' })} ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
