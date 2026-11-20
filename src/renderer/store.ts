import type { AccountSummary, AgentId, AgentUsage, Connection, CouncilConfig, CouncilEvent, PermissionRequest, SessionSummary, Tier, Verdict, WorkerId, WorkerSession } from '../shared/types.ts';

export type TaskStatus = 'working' | 'returned' | 'failed' | Verdict;

export interface Task {
  id: string;
  runId: string;
  agent: WorkerId;
  tier: Tier;
  model: string;
  brief: string;
  write: boolean;
  /** task id this one cross-checks, when it reviews another worker's output */
  checks?: string;
  status: TaskStatus;
  live: string;
  lastTool: string;
  output: string;
  error?: string;
  reason?: string;
  startedAt: number;
  secs?: number;
  tokens?: number;
  costUsd?: number;
  /** skills this worker loaded */
  skills: string[];
  /** the plan step this task carries out */
  step?: string;
}

export interface PlanStep { id: string; goal: string; agent: WorkerId; tier: Tier; why: string; write: boolean; depends_on?: string[] }
export interface Plan { rev: number; summary: string; steps: PlanStep[]; ts: number }

export type Entry =
  | { kind: 'user'; text: string; ts: number }
  | { kind: 'chair'; text: string; ts: number }
  | { kind: 'history'; role: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; text: string; ts: number }
  | { kind: 'dispatch'; taskId: string; ts: number }
  | { kind: 'return'; taskId: string; ts: number }
  | { kind: 'review'; taskId: string; verdict: Verdict; text: string; ts: number }
  | { kind: 'final'; text: string; costUsd?: number; ms?: number; ts: number }
  | { kind: 'error'; text: string; ts: number }
  | { kind: 'notice'; text: string; ts: number }
  | { kind: 'skill'; agent: AgentId; name: string; taskId?: string; ts: number }
  | { kind: 'plan'; plan: Plan; ts: number };

export type ChairState = 'idle' | 'planning' | 'thinking' | 'writing' | 'waiting' | 'reviewing';

export interface Spend { tasks: number; done: number; redo: number; tokens: number; costUsd: number }

export interface State {
  config: CouncilConfig | null;
  accounts: AccountSummary[];
  sessions: SessionSummary[];
  workerSessions: WorkerSession[];
  connections: Connection[];
  resumeId: string | null;
  sessionTitle: string | null;
  running: boolean;
  runId: string | null;
  runStartedAt: number | null;
  chair: ChairState;
  chairModel: string | null;
  entries: Entry[];
  tasks: Map<string, Task>;
  permissions: PermissionRequest[];
  spend: Record<AgentId, Spend>;
  drawerTab: 'transcript' | 'tasks' | 'handoff';
  workerHandoff: { session: WorkerSession; output?: string | null } | null;
  focusAgent: WorkerId | null;
  usage: AgentUsage[];
  /** the chair's current plan for this run */
  plan: Plan | null;
  /** chair session context: exact after a fetch, a live estimate mid-run */
  context: { pct: number | null; tokens: number; max: number | null; model?: string; exact: boolean; loading?: boolean } | null;
}

const zeroSpend = (): Spend => ({ tasks: 0, done: 0, redo: 0, tokens: 0, costUsd: 0 });

export const state: State = {
  config: null, accounts: [], sessions: [], workerSessions: [], connections: [],
  resumeId: null, sessionTitle: null,
  running: false, runId: null, runStartedAt: null,
  chair: 'idle', chairModel: null,
  entries: [], tasks: new Map(), permissions: [],
  spend: { chair: zeroSpend(), codex: zeroSpend(), antigravity: zeroSpend(), claude: zeroSpend() },
  drawerTab: 'transcript', workerHandoff: null, focusAgent: null,
  usage: [], context: null, plan: null,
};

type Listener = (topic: Topic) => void;
export type Topic = 'config' | 'accounts' | 'sessions' | 'connections' | 'run' | 'entries' | 'tasks' | 'permissions' | 'spend' | 'drawer' | 'usage' | 'context';
const listeners = new Set<Listener>();
export const subscribe = (l: Listener) => { listeners.add(l); return () => listeners.delete(l); };

let pending = new Set<Topic>();
let scheduled = false;
/** Batches notifications to one per animation frame; worker_text can arrive many times a second. */
export function notify(...topics: Topic[]) {
  topics.forEach((t) => pending.add(t));
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const ts = pending; pending = new Set();
    for (const t of ts) for (const l of listeners) l(t);
  });
}

/** Context window by model, used until an exact reading arrives. Current Claude models default to 1M. */
export function windowFor(model: string): number | null {
  if (/\[1m\]/i.test(model) || /claude-(opus|sonnet|haiku|fable|mythos)-5/.test(model)) return 1_000_000;
  return model ? 200_000 : null;
}

export function resetConversation() {
  if (state.workerHandoff) {
    state.workerHandoff = null;
    if (state.drawerTab === 'handoff') state.drawerTab = 'transcript';
    notify('drawer');
  }
  state.entries = [];
  state.tasks = new Map();
  state.spend = { chair: zeroSpend(), codex: zeroSpend(), antigravity: zeroSpend(), claude: zeroSpend() };
  state.context = null;
  notify('entries', 'tasks', 'spend', 'context');
}

export function apply(e: CouncilEvent) {
  const ts = e.ts;
  switch (e.kind) {
    case 'run_start':
      state.running = true; state.runId = e.runId; state.runStartedAt = ts; state.chair = 'planning'; state.plan = null;
      state.entries.push({ kind: 'user', text: e.text ?? '', ts });
      notify('run', 'entries');
      break;
    case 'chair_init': {
      state.chairModel = e.model ?? null;
      const sid = e.data?.sessionId as string | undefined;
      if (sid) state.resumeId = sid;
      notify('run');
      break;
    }
    case 'chair_text':
      state.chair = 'writing';
      state.entries.push({ kind: 'chair', text: e.text ?? '', ts });
      notify('run', 'entries');
      break;
    case 'chair_tool':
      state.chair = state.plan ? 'thinking' : 'planning';
      state.entries.push({ kind: 'tool', text: e.text ?? '', ts });
      notify('run', 'entries');
      break;
    case 'dispatch': {
      const t: Task = {
        id: e.taskId!, runId: e.runId, agent: e.agent as WorkerId, tier: e.tier ?? 0, model: e.model ?? '',
        brief: e.text ?? '', write: !!e.data?.write, step: (e.data?.step as string | null) ?? undefined, checks: (e.data?.crossCheckOf as string | null) ?? undefined, status: 'working', live: '', lastTool: '', output: '', startedAt: ts, skills: [],
      };
      state.tasks.set(t.id, t);
      state.spend[t.agent].tasks++;
      state.chair = 'waiting';
      state.entries.push({ kind: 'dispatch', taskId: t.id, ts });
      notify('run', 'entries', 'tasks', 'spend');
      break;
    }
    case 'worker_text': {
      const t = state.tasks.get(e.taskId!); if (!t) break;
      t.live = e.text ?? '';
      notify('tasks');
      break;
    }
    case 'worker_tool': {
      const t = state.tasks.get(e.taskId!); if (!t) break;
      t.lastTool = e.text ?? '';
      notify('tasks');
      break;
    }
    case 'worker_done':
    case 'worker_error': {
      const t = state.tasks.get(e.taskId!); if (!t) break;
      const ok = e.kind === 'worker_done';
      t.status = ok ? 'returned' : 'failed';
      t.output = ok ? e.text ?? '' : String(e.data?.partial ?? '');
      t.error = ok ? undefined : e.text;
      t.secs = e.data?.secs as number | undefined;
      t.tokens = (e.data?.tokens as number | null) ?? undefined;
      t.costUsd = (e.data?.costUsd as number | null) ?? undefined;
      const sp = state.spend[t.agent];
      if (ok) sp.done++;
      sp.tokens += t.tokens ?? 0;
      sp.costUsd += t.costUsd ?? 0;
      state.chair = 'reviewing';
      state.entries.push({ kind: 'return', taskId: t.id, ts });
      notify('run', 'entries', 'tasks', 'spend');
      break;
    }
    case 'review': {
      const t = state.tasks.get(e.taskId!);
      if (t && e.verdict) {
        t.status = e.verdict; t.reason = e.text;
        if (e.verdict !== 'accept') state.spend[t.agent].redo++;
      }
      state.entries.push({ kind: 'review', taskId: e.taskId!, verdict: e.verdict!, text: e.text ?? '', ts });
      notify('entries', 'tasks', 'spend');
      break;
    }
    case 'permission':
      state.permissions.push({ id: e.data!.id as string, toolName: e.data!.toolName as string, summary: e.text ?? '', reason: (e.data!.reason as string) ?? undefined });
      notify('permissions');
      break;
    case 'permission_resolved':
      state.permissions = state.permissions.filter((p) => p.id !== e.data?.id);
      notify('permissions');
      break;
    case 'plan': {
      const plan: Plan = { rev: Number(e.data?.rev ?? 1), summary: e.text ?? '', steps: (e.data?.steps as PlanStep[]) ?? [], ts };
      state.plan = plan;
      state.chair = 'thinking';
      state.entries.push({ kind: 'plan', plan, ts });
      notify('run', 'entries', 'tasks');
      break;
    }
    case 'skill': {
      const name = e.text ?? 'unknown';
      const t = e.taskId ? state.tasks.get(e.taskId) : undefined;
      if (t && !t.skills.includes(name)) t.skills.push(name);
      state.entries.push({ kind: 'skill', agent: e.agent, name, taskId: e.taskId, ts });
      notify('entries', 'tasks');
      break;
    }
    case 'context': {
      const tokens = Number(e.data?.tokens ?? 0);
      const prev = state.context;
      const max = prev?.max && (!prev.model || !e.model || prev.model === e.model) ? prev.max : windowFor(e.model ?? '');
      state.context = { tokens, max, pct: max ? Math.min(100, Math.round((tokens / max) * 100)) : null, model: e.model, exact: false };
      notify('context');
      break;
    }
    case 'run_done':
      state.running = false; state.chair = 'idle';
      state.spend.chair.costUsd += (e.data?.costUsd as number) ?? 0;
      // the SDK's result repeats the chair's last message; show it once, as the answer
      { const last = state.entries[state.entries.length - 1];
        if (last?.kind === 'chair' && (e.text ?? '').trim().endsWith(last.text.trim())) state.entries.pop(); }
      state.entries.push({ kind: 'final', text: e.text ?? '', costUsd: e.data?.costUsd as number, ms: e.data?.ms as number, ts });
      notify('run', 'entries', 'spend', 'sessions');
      break;
    case 'run_error':
      state.running = false; state.chair = 'idle'; state.permissions = [];
      state.entries.push({ kind: 'error', text: e.text ?? 'The run failed.', ts });
      for (const t of state.tasks.values()) if (t.status === 'working') { t.status = 'failed'; t.error = 'run ended'; }
      notify('run', 'entries', 'tasks', 'permissions');
      break;
  }
}
