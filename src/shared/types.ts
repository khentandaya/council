// Shared between main, preload and renderer. Keep it dependency-free.

export type AgentId = 'chair' | 'codex' | 'antigravity' | 'claude';
export type WorkerId = Exclude<AgentId, 'chair'>;
export type Tier = 0 | 1 | 2;
export type Verdict = 'accept' | 'redo' | 'escalate';

export type EventKind =
  | 'run_start'      // user prompt accepted, chair starting
  | 'chair_init'     // chair session ready (model, mcp servers, account)
  | 'chair_text'     // chair said something
  | 'chair_tool'     // chair used one of its own built-in tools
  | 'dispatch'       // chair handed a task to a worker
  | 'worker_text'    // worker streamed output
  | 'worker_tool'    // worker used a tool / ran a command
  | 'worker_done'    // worker returned its result
  | 'worker_error'   // worker failed or timed out
  | 'review'         // chair judged a returned task
  | 'permission'     // chair needs the user to approve a tool call
  | 'permission_resolved'
  | 'run_done'       // chair produced its final answer
  | 'run_error';

export interface CouncilEvent {
  seq: number;
  runId: string;
  ts: number;
  kind: EventKind;
  agent: AgentId;
  taskId?: string;
  tier?: Tier;
  model?: string;
  text?: string;
  verdict?: Verdict;
  /** extra structured payload, kind-specific */
  data?: Record<string, unknown>;
}

export interface Profile {
  id: string;
  name: string;
  /** CLAUDE_CONFIG_DIR for this account */
  configDir: string;
}

export interface CouncilConfig {
  profiles: Profile[];
  activeProfileId: string;
  recentFolders: string[];
  currentFolder: string | null;
  chairModel: string;   // alias or full id
  chairEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  workerTimeoutMin: number;
  /** command prefixes Antigravity may run headless, e.g. "git status", "npm test" */
  agyAllowCommands: string[];
  bins: { claude: string; codex: string; agy: string };
}

export interface AccountSummary {
  profileId: string;
  email?: string;
  subscriptionType?: string;
  signedIn: boolean;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  lastModified: number;
  gitBranch?: string;
}

export interface Connection {
  agent: AgentId;
  name: string;
  status?: string;
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  summary: string;
  reason?: string;
}

/** The typed bridge exposed to the renderer as window.council */
export interface CouncilApi {
  getConfig(): Promise<CouncilConfig>;
  setConfig(patch: Partial<CouncilConfig>): Promise<CouncilConfig>;
  pickFolder(): Promise<string | null>;
  listSessions(): Promise<SessionSummary[]>;
  accounts(): Promise<AccountSummary[]>;
  signIn(profileId: string): Promise<void>;
  addProfile(name: string): Promise<CouncilConfig>;
  connections(): Promise<Connection[]>;
  run(prompt: string, resumeSessionId: string | null): Promise<{ runId: string }>;
  stop(): Promise<void>;
  answerPermission(id: string, allow: boolean, always: boolean): Promise<void>;
  loadSession(sessionId: string): Promise<{ role: 'user' | 'assistant'; text: string }[]>;
  window(action: 'min' | 'max' | 'close'): void;
  onEvent(cb: (e: CouncilEvent) => void): () => void;
}
