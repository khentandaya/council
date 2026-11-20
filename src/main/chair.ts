import { createSdkMcpServer, query, tool, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { cleanEnv } from './env.ts';
import { runAgy } from './runners/agy.ts';
import { runClaudeWorker } from './runners/claude.ts';
import { runCodex } from './runners/codex.ts';
import type { WorkerResult } from './runners/types.ts';
import type { AgentId, CouncilConfig, CouncilEvent, PermissionRequest, Profile, Tier, WorkerId } from '../shared/types.ts';

export type Emit = (e: Omit<CouncilEvent, 'seq' | 'ts' | 'runId'>) => void;

export interface ChairDeps {
  config: CouncilConfig;
  profile: Profile;
  cwd: string;
  emit: Emit;
  askPermission: (req: PermissionRequest) => Promise<{ allow: boolean; always: boolean }>;
  signal: AbortSignal;
}

const AGY_MODELS = {
  'gemini-3.8-flash-low': 0, 'gemini-3.8-flash-medium': 0, 'gemini-3.8-flash-high': 1,
  'gemini-4-neon-medium': 1, 'gemini-4-neon-high': 1,
  'gemini-4-argon-high': 2, 'gemini-4-hydrogen-high': 2,
} as const satisfies Record<string, Tier>;
type AgyModel = keyof typeof AGY_MODELS;
const CODEX_TIER = { low: 0, medium: 1, high: 2 } as const;
const CLAUDE_TIER = { haiku: 0, sonnet: 1, opus: 2 } as const;

const MAX_RETURN = 16_000;
/** Keep Council's tools loaded up front instead of behind tool search. readOnlyHint is what lets
 *  Claude Code run several delegations at once; the chair prompt keeps writers off shared files. */
const LOAD = { alwaysLoad: true, annotations: { readOnlyHint: true } };

export const CHAIR_PROMPT = `
# You are the chair of Council

The user talks only to you. Behind you are three rooms of workers you can hand tasks to:
- ask_codex: OpenAI Codex. Strong at focused code changes, tests, refactors, shell-heavy work in the repo.
- ask_antigravity: Google Antigravity (Gemini). Strong at broad research, reading big codebases, web lookups, UI and browser work, alternative designs.
- ask_claude: a separate Claude (haiku / sonnet / opus) with its own fresh context. Good for writing, careful reasoning, and reviewing other workers' output.

Your job is to get the user the best result for the least spend. Your default role is planner and reviewer, not doer.

## Model ladder: never overkill
Pick the lowest tier that can plausibly do the job well.
| tier | use for | codex | antigravity | claude |
| 0 trivial | renames, lookups, summaries, boilerplate, simple questions | effort low | gemini-3.8-flash-low/medium | haiku |
| 1 normal | a feature in 1-3 files, tests, refactors, a focused investigation | effort medium | gemini-3.8-flash-high, gemini-4-neon-medium/high | sonnet |
| 2 hard | architecture, gnarly bugs, cross-cutting changes, security-sensitive work | effort high | gemini-4-argon-high, gemini-4-hydrogen-high | opus |
Escalate one tier only after a review finds the work wrong or shallow. Say why when you start at tier 2.

## How to work
1. Small questions and tiny edits you can answer directly yourself: just do it, without delegating.
2. Otherwise split the request into tasks, each self-contained: give the worker the goal, the relevant files or context, and what done looks like. Workers do not see this conversation.
3. Independent tasks can be dispatched in parallel (several tool calls in one message). Two workers must never edit the same files at the same time.
4. Set write=false for research, review and planning tasks, so the worker cannot change files.
5. After every return, call review with accept, redo (same tier, with what to fix) or escalate (next tier up). Check claims against the actual files when it matters; do not rubber-stamp.
6. Cross-check: for risky output (non-trivial code changes, security, factual claims the user will rely on), ask a DIFFERENT worker than the author to review it with write=false and cross_check_of set to the author's task_id, at the lowest tier that can judge it.
7. Do not send the same job to two workers unless you want them compared on purpose.
8. To continue a worker's earlier task with its context, pass that task's session id as resume.
9. Finish with a clear answer for the user: what was done, by whom, what you verified, and anything still open.
`;

export async function runChair(prompt: string, resume: string | null, d: ChairDeps): Promise<{ sessionId?: string; result?: string }> {
  const { config, profile, emit, signal } = d;
  const timeoutMs = config.workerTimeoutMin * 60_000;
  const alwaysAllow = new Set<string>();
  const tasks = new Map<string, { agent: WorkerId; tier: Tier }>();
  let n = 0;

  /** wraps a worker call: emits dispatch/progress/done events and formats the return for the chair */
  async function delegate(agent: WorkerId, tier: Tier, model: string, task: string, write: boolean,
    a: { resume?: string; cross_check_of?: string }, run: (h: { onText: (t: string) => void; onTool: (t: string) => void }) => Promise<WorkerResult>) {
    const taskId = `t${++n}`;
    tasks.set(taskId, { agent, tier });
    const checks = a.cross_check_of && tasks.has(a.cross_check_of) ? a.cross_check_of : null;
    emit({ kind: 'dispatch', agent, taskId, tier, model, text: task, data: { write, resume: a.resume ?? null, crossCheckOf: checks } });
    const started = Date.now();
    const r = await run({
      onText: (t) => emit({ kind: 'worker_text', agent, taskId, tier, text: t.slice(-600) }),
      onTool: (t) => emit({ kind: 'worker_tool', agent, taskId, tier, text: t.slice(0, 200) }),
    });
    const secs = Math.round((Date.now() - started) / 1000);
    if (r.ok) emit({ kind: 'worker_done', agent, taskId, tier, model, text: r.output, data: { sessionId: r.sessionId ?? null, secs, tokens: r.tokens ?? null, costUsd: r.costUsd ?? null } });
    else emit({ kind: 'worker_error', agent, taskId, tier, model, text: r.error, data: { sessionId: r.sessionId ?? null, secs, partial: r.output } });

    const body = r.output.length > MAX_RETURN ? r.output.slice(0, MAX_RETURN) + '\n...[truncated]' : r.output;
    const head = `task_id: ${taskId}\nworker: ${agent} (${model}, tier ${tier})\nsession: ${r.sessionId ?? 'n/a'}\nstatus: ${r.ok ? 'ok' : 'FAILED: ' + r.error}\ntime: ${secs}s`;
    return { content: [{ type: 'text' as const, text: `${head}\n---\n${body || '(no output)'}` }], isError: !r.ok };
  }

  const common = {
    task: z.string().describe('Self-contained instructions: goal, context, files, definition of done.'),
    write: z.boolean().describe('true if the worker may change files; false for research/review/planning.'),
    resume: z.string().optional().describe('Session id from an earlier task to continue with its context.'),
    cross_check_of: z.string().optional().describe('When this task reviews another worker\'s output, that task\'s task_id.'),
  };
  const base = (resumeId?: string, write = false) => ({ cwd: d.cwd, write, resume: resumeId, timeoutMs, signal });

  const council = createSdkMcpServer({
    name: 'council',
    version: '1.0.0',
    tools: [
      tool('ask_codex', 'Hand a task to OpenAI Codex. Choose effort by the model ladder.', {
        ...common, effort: z.enum(['low', 'medium', 'high']),
      }, async (a) => delegate('codex', CODEX_TIER[a.effort], `codex-${a.effort}`, a.task, a.write, a,
        (h) => runCodex(config.bins.codex, a.effort, { ...base(a.resume, a.write), task: a.task, ...h })), LOAD),

      tool('ask_antigravity', 'Hand a task to Google Antigravity. Choose the model by the model ladder.', {
        ...common, model: z.enum(Object.keys(AGY_MODELS) as [AgyModel, ...AgyModel[]]),
      }, async (a) => delegate('antigravity', AGY_MODELS[a.model], a.model, a.task, a.write, a,
        (h) => runAgy(config.bins.agy, a.model, config.agyAllowCommands, { ...base(a.resume, a.write), task: a.task, ...h })), LOAD),

      tool('ask_claude', 'Hand a task to a separate Claude worker with a fresh context. Choose the model by the model ladder.', {
        ...common, model: z.enum(['haiku', 'sonnet', 'opus']),
      }, async (a) => delegate('claude', CLAUDE_TIER[a.model], a.model, a.task, a.write, a,
        (h) => runClaudeWorker(config.bins.claude, profile.configDir, a.model, { ...base(a.resume, a.write), task: a.task, ...h })), LOAD),

      tool('review', 'Record your verdict on a returned task before acting on it.', {
        task_id: z.string(),
        verdict: z.enum(['accept', 'redo', 'escalate']),
        reason: z.string().describe('One or two sentences: what you checked and why this verdict.'),
      }, async (a) => {
        const t = tasks.get(a.task_id);
        emit({ kind: 'review', agent: (t?.agent ?? 'chair') as AgentId, taskId: a.task_id, tier: t?.tier, verdict: a.verdict, text: a.reason });
        return { content: [{ type: 'text' as const, text: `recorded: ${a.task_id} ${a.verdict}` }] };
      }, LOAD),
    ],
  });

  const canUseTool = async (toolName: string, input: Record<string, unknown>, opts: { decisionReason?: string; signal: AbortSignal }): Promise<PermissionResult> => {
    // Council's own tools are always allowed (listing them in allowedTools would bypass this callback)
    if (toolName.startsWith('mcp__council__') || alwaysAllow.has(toolName)) return { behavior: 'allow', updatedInput: input };
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const summary = describeTool(toolName, input);
    emit({ kind: 'permission', agent: 'chair', text: summary, data: { id, toolName, reason: opts.decisionReason ?? null } });
    const ans = await d.askPermission({ id, toolName, summary, reason: opts.decisionReason });
    emit({ kind: 'permission_resolved', agent: 'chair', data: { id, allow: ans.allow } });
    if (ans.allow && ans.always) alwaysAllow.add(toolName);
    return ans.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user declined this action.' };
  };

  const ac = new AbortController();
  signal.addEventListener('abort', () => ac.abort(), { once: true });

  let sessionId: string | undefined;
  let result: string | undefined;
  const q = query({
    prompt,
    options: {
      cwd: d.cwd,
      resume: resume ?? undefined,
      model: config.chairModel,
      effort: config.chairEffort,
      pathToClaudeCodeExecutable: config.bins.claude || undefined,
      env: cleanEnv({ CLAUDE_CONFIG_DIR: profile.configDir }),
      abortController: ac,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: CHAIR_PROMPT },
      mcpServers: { council },
      // delegation must go through Council's rooms so it's visible and tier-routed
      disallowedTools: ['Agent', 'Task'],
      permissionMode: 'default',
      canUseTool,
    },
  });

  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') {
      sessionId = m.session_id;
      emit({ kind: 'chair_init', agent: 'chair', model: m.model, data: { sessionId, mcp: m.mcp_servers, cwd: m.cwd } });
    } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text.trim()) emit({ kind: 'chair_text', agent: 'chair', text: b.text });
        else if (b.type === 'tool_use' && !b.name.startsWith('mcp__council__')) {
          emit({ kind: 'chair_tool', agent: 'chair', text: describeTool(b.name, b.input as Record<string, unknown>) });
        }
      }
    } else if (m.type === 'result') {
      if (m.subtype === 'success' && !m.is_error) {
        result = m.result;
        emit({ kind: 'run_done', agent: 'chair', text: m.result, data: { sessionId, costUsd: m.total_cost_usd, ms: m.duration_ms } });
      } else {
        emit({ kind: 'run_error', agent: 'chair', text: m.subtype === 'success' ? m.result : m.subtype, data: { sessionId } });
      }
    }
  }
  return { sessionId, result };
}

function describeTool(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Bash': return `Run: ${s('command')}`;
    case 'Edit': case 'Write': case 'NotebookEdit': return `${name} ${s('file_path') || s('notebook_path')}`;
    case 'Read': return `Read ${s('file_path')}`;
    case 'Glob': case 'Grep': return `${name} ${s('pattern')}`;
    case 'WebFetch': return `Fetch ${s('url')}`;
    case 'WebSearch': return `Search "${s('query')}"`;
    default: return `${name} ${JSON.stringify(input).slice(0, 160)}`;
  }
}
