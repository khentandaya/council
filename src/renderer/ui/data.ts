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
export async function refreshSessions() { state.sessions = await api.listSessions(); notify('sessions'); }
export async function refreshConnections() { state.connections = await api.connections(); notify('connections'); }
