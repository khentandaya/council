import { createSdkMcpServer, query, tool, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { cleanEnv } from './env.ts';
import { HANDOFFS_DIR, recordWorkerSession } from './workers.ts';
import { runAgy } from './runners/agy.ts';
import { runClaudeWorker } from './runners/claude.ts';
import { runCodex } from './runners/codex.ts';
import { SKILL_PREFIX, type WorkerResult } from './runners/types.ts';
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

/** The only built-in tools the chair gets: enough to plan and to check returns, nothing that executes. */
const CHAIR_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill']);

interface PlanStep { id: string; goal: string; agent: WorkerId; tier: number; why: string; write: boolean; depends_on?: string[]; dispatched: boolean }
/** Keep Council's tools loaded up front instead of behind tool search. readOnlyHint is what lets
 *  Claude Code run several delegations at once; the chair prompt keeps writers off shared files. */
const LOAD = { alwaysLoad: true, annotations: { readOnlyHint: true } };

function chairPrompt(pipeline: boolean) {
  return `
# You are the chair of Council

The user talks only to you. Behind you are three rooms of workers:
- ask_codex: OpenAI Codex. Strong at focused code changes, tests, refactors, shell-heavy work in the repo.
- ask_antigravity: Google Antigravity (Gemini). Strong at broad research, reading big codebases, web lookups, UI and browser work, alternative designs.
- ask_claude: a separate Claude (haiku / sonnet / opus) with a fresh context. Good for writing, careful reasoning, and reviewing other workers' output.

## You plan and review. You never execute.
You cannot run commands, edit files or use connected services: those tools are switched off for you.
You may read files (Read, Glob, Grep) and search the web, only to plan well and to check what workers return.
Every piece of work, however small (even a one-line answer), is done by a worker.
Worker returns are summaries; the full output is in the handoff file path given. Read it only when the summary is not enough to review.

## The pipeline${pipeline ? `: every prompt, in this order
1. Understand: read just enough of the project to plan well.
2. Plan: call submit_plan. Break the request into steps. For each step, name the worker and tier best suited to it and say why in one line. Mark which steps depend on which; independent steps run in parallel.
3. Execute: dispatch each step with ask_codex / ask_antigravity / ask_claude, passing its step id. A step must go to the worker the plan names; to change that, call submit_plan again with the revised plan first.
4. Review: after every return, call review with accept, redo (same tier, with what to fix) or escalate (next tier up). For risky output (non-trivial code changes, security, facts the user will rely on), dispatch a read-only cross-check to a DIFFERENT worker with cross_check_of set to the author's task_id.
5. Answer: tell the user what was done, by whom, what was verified, and anything still open.` : `
Plan in your head, then delegate. submit_plan is optional.`}

## Model ladder: never overkill
Pick the lowest tier that can plausibly do the step well.
| tier | use for | codex | antigravity | claude |
| 0 trivial | renames, lookups, summaries, boilerplate, simple questions | effort low | gemini-3.8-flash-low/medium | haiku |
| 1 normal | a feature in 1-3 files, tests, refactors, a focused investigation | effort medium | gemini-3.8-flash-high, gemini-4-neon-medium/high | sonnet |
| 2 hard | architecture, gnarly bugs, cross-cutting changes, security-sensitive work | effort high | gemini-4-argon-high, gemini-4-hydrogen-high | opus |
Escalate one tier only after a review finds the work wrong or shallow. Say why when you plan a step at tier 2.

## Writing tasks
- Each task is self-contained: goal, relevant files and context, and what done looks like. Workers do not see this conversation.
- Set write=false for research, review and planning steps so the worker cannot change files.
- Two workers must never edit the same files at the same time.
- To continue a worker's earlier task with its context, pass that task's session id as resume.
`;
}

export async function runChair(prompt: string, resume: string | null, d: ChairDeps): Promise<{ sessionId?: string; result?: string }> {
  const { config, profile, emit, signal } = d;
  const run = Date.now().toString();
  const handoffDir = join(HANDOFFS_DIR, run);
  let sessionId = resume ?? undefined;
  const timeoutMs = config.workerTimeoutMin * 60_000;
  const alwaysAllow = new Set<string>();
  const tasks = new Map<string, { agent: WorkerId; tier: Tier; step?: string }>();
  let n = 0;
  /** the current plan; delegation is refused until one exists */
  let plan: { rev: number; steps: Map<string, PlanStep> } | null = null;
  const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

  /** Pipeline gate: a task needs a plan, and must go to the worker its step names. */
  function gate(agent: WorkerId, a: { step?: string; cross_check_of?: string }): string | null {
    if (!config.pipeline) return null;
    if (!plan) return 'No plan yet. Call submit_plan first: break the request into steps and choose a worker and tier for each.';
    if (a.cross_check_of && tasks.has(a.cross_check_of)) return null;   // a review of finished work
    const ids = [...plan.steps.keys()].join(', ');
    if (!a.step) return `Pass the step id this task carries out (one of: ${ids}).`;
    const st = plan.steps.get(a.step);
    if (!st) return `Step "${a.step}" is not in the plan (${ids}). Revise the plan with submit_plan to add it.`;
    if (st.agent !== agent) return `Step ${a.step} is planned for ${st.agent}. Call submit_plan with a revised plan to hand it to ${agent} instead.`;
    return null;
  }

  /** wraps a worker call: emits dispatch/progress/done events and formats the return for the chair */
  async function delegate(agent: WorkerId, tier: Tier, model: string, task: string, write: boolean,
    a: { resume?: string; cross_check_of?: string; step?: string }, exec: (h: { onText: (t: string) => void; onTool: (t: string) => void }) => Promise<WorkerResult>) {
    const refused = gate(agent, a);
    if (refused) return fail(refused);
    const taskId = `t${++n}`;
    const checks = a.cross_check_of && tasks.has(a.cross_check_of) ? a.cross_check_of : null;
    const step = a.step && plan?.steps.has(a.step) ? a.step : checks ? tasks.get(checks)?.step : undefined;
    tasks.set(taskId, { agent, tier, step });
    if (step && plan?.steps.has(step)) plan.steps.get(step)!.dispatched = true;
    emit({ kind: 'dispatch', agent, taskId, tier, model, text: task, data: { write, resume: a.resume ?? null, crossCheckOf: checks, step: step ?? null } });
    const started = Date.now();
    const r = await exec({
      onText: (t) => emit({ kind: 'worker_text', agent, taskId, tier, text: t.slice(-600) }),
      onTool: (t) => t.startsWith(SKILL_PREFIX)
        ? emit({ kind: 'skill', agent, taskId, tier, text: t.slice(SKILL_PREFIX.length) })
        : emit({ kind: 'worker_tool', agent, taskId, tier, text: t.slice(0, 200) }),
    });
    const secs = Math.round((Date.now() - started) / 1000);
    const dir = join(handoffDir, agent);
    const path = join(dir, `${taskId}.md`);
    let footer = `\nfull output: ${path} (Read it only if the summary is not enough)`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path, r.output, 'utf8');
    } catch (err) {
      footer = `\nCould not save full output: ${err}`;
    }
    try {
      // A worker that exits before reporting a session ID still has a handoff.
      await recordWorkerSession({ sessionId: r.sessionId ?? `handoff:${run}/${taskId}`, agent, taskId, model, tier,
        chairSessionId: sessionId, folder: d.cwd, handoffPath: path, ts: Date.now(), ok: r.ok });
    } catch (err) {
      emit({ kind: 'chair_tool', agent: 'chair', text: `Could not save worker session ${taskId}: ${err}` });
    }
    if (r.ok) emit({ kind: 'worker_done', agent, taskId, tier, model, text: r.output, data: { sessionId: r.sessionId ?? null, secs, tokens: r.tokens ?? null, costUsd: r.costUsd ?? null } });
    else emit({ kind: 'worker_error', agent, taskId, tier, model, text: r.error, data: { sessionId: r.sessionId ?? null, secs, partial: r.output } });
    const head = `task_id: ${taskId}\nworker: ${agent} (${model}, tier ${tier})\nsession: ${r.sessionId ?? 'n/a'}\nstatus: ${r.ok ? 'ok' : 'FAILED: ' + r.error}\ntime: ${secs}s`;
    const summaryStart = [...r.output.matchAll(/^[\t *#-]*RESULT:/gm)].at(-1)?.index;
    const body = summaryStart === undefined ? r.output.slice(-2_000) : r.output.slice(summaryStart).trim();
    footer = footer.slice(0, MAX_RETURN);
    const text = `${head}\n---\n${body || '(no output)'}`.slice(0, MAX_RETURN - footer.length) + footer;
    return { content: [{ type: 'text' as const, text }], isError: !r.ok };
  }

  const common = {
    task: z.string().describe('Self-contained instructions: goal, context, files, definition of done.'),
    write: z.boolean().describe('true if the worker may change files; false for research/review/planning.'),
    resume: z.string().optional().describe('Session id from an earlier task to continue with its context.'),
    cross_check_of: z.string().optional().describe('When this task reviews another worker\'s output, that task\'s task_id.'),
    step: z.string().optional().describe(config.pipeline ? 'The plan step id this task carries out (required unless cross_check_of is set).' : 'Optional plan step id.'),
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

      tool('submit_plan', config.pipeline ? 'Required first step for every prompt: your plan. Call again to revise it.' : 'Optionally record or revise a plan.', {
        summary: z.string().describe('One or two sentences: what the user wants and how you will get it done.'),
        steps: z.array(z.object({
          id: z.string().describe('Short id, e.g. s1.'),
          goal: z.string().describe('What this step produces.'),
          agent: z.enum(['codex', 'antigravity', 'claude']),
          tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
          why: z.string().describe('One line: why this worker and tier fit the step.'),
          write: z.boolean().describe('Will this step change files?'),
          depends_on: z.array(z.string()).optional().describe('Step ids that must finish first.'),
        })).min(1),
      }, async (a) => {
        const ids = new Set<string>();
        for (const st of a.steps) {
          if (ids.has(st.id)) return fail(`Duplicate step id "${st.id}".`);
          ids.add(st.id);
        }
        for (const st of a.steps) for (const dep of st.depends_on ?? []) {
          if (!ids.has(dep)) return fail(`Step ${st.id} depends on unknown step "${dep}".`);
        }
        const prev = plan?.steps;
        plan = { rev: (plan?.rev ?? 0) + 1, steps: new Map(a.steps.map((st) => [st.id, { ...st, dispatched: prev?.get(st.id)?.dispatched ?? false }])) };
        emit({ kind: 'plan', agent: 'chair', text: a.summary, data: { rev: plan.rev, steps: a.steps } });
        return { content: [{ type: 'text' as const, text: `plan v${plan.rev} recorded with ${a.steps.length} step(s). Dispatch each step with its step id.` }] };
      }, LOAD),

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
    if (toolName === 'Read' && typeof input.file_path === 'string') {
      const path = resolve(d.cwd, input.file_path);
      const prefix = HANDOFFS_DIR + sep;
      const inHandoffs = process.platform === 'win32'
        ? path.toLowerCase().startsWith(prefix.toLowerCase())
        : path.startsWith(prefix);
      if (inHandoffs) return { behavior: 'allow', updatedInput: input };
    }
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

  let result: string | undefined;
  let stopBlocks = 0;
  const q = query({
    prompt,
    options: {
      cwd: d.cwd,
      settingSources: ['project', 'local'],
      resume: resume ?? undefined,
      model: config.chairModel,
      effort: config.chairEffort,
      pathToClaudeCodeExecutable: config.bins.claude || undefined,
      env: cleanEnv({ CLAUDE_CONFIG_DIR: profile.configDir }),
      abortController: ac,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: chairPrompt(config.pipeline) },
      mcpServers: { council },
      // The chair plans and reviews; it never executes. Only read-only tools are loaded,
      // and the PreToolUse hook enforces it even against the user's own allow rules.
      tools: [...CHAIR_TOOLS],
      disallowedTools: ['Agent', 'Task', 'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
      hooks: {
        PreToolUse: [{ hooks: [async (input) => {
          const name = (input as { tool_name?: string }).tool_name ?? '';
          if (name.startsWith('mcp__council__') || CHAIR_TOOLS.has(name)) return {};
          emit({ kind: 'chair_tool', agent: 'chair', text: `Blocked ${name}: the chair doesn't execute` });
          return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const,
            permissionDecisionReason: 'The chair never executes. Put this in a plan step and hand it to codex, antigravity or claude.' } };
        }] }],
        // the run can't end until the pipeline ran: a plan, and every planned step dispatched
        Stop: [{ hooks: [async () => {
          if (!config.pipeline) return {};
          const missing = plan ? [...plan.steps.values()].filter((st) => !st.dispatched).map((st) => st.id) : [];
          const why = !plan ? 'You have not submitted a plan. Every prompt goes through the pipeline: submit_plan, dispatch each step to a worker, review, then answer.'
            : missing.length ? `Steps ${missing.join(', ')} were never dispatched. Dispatch them, or call submit_plan with a revised plan that drops them.`
            : null;
          if (!why) return {};
          if (++stopBlocks > 2) {
            emit({ kind: 'chair_tool', agent: 'chair', text: 'Pipeline incomplete: the chair finished without running every planned step' });
            return {};
          }
          return { decision: 'block' as const, reason: why };
        }] }],
      },
      permissionMode: 'default',
      canUseTool,
    },
  });

  let lastCtx = 0;
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') {
      sessionId = m.session_id;
      emit({ kind: 'chair_init', agent: 'chair', model: m.model, data: { sessionId, mcp: m.mcp_servers, cwd: m.cwd } });
    } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
      // everything the model read for this reply = the session's current context size
      const u = m.message.usage as { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
      const ctx = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
      if (ctx > 0 && ctx !== lastCtx) { lastCtx = ctx; emit({ kind: 'context', agent: 'chair', model: m.message.model, data: { tokens: ctx } }); }
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text.trim()) emit({ kind: 'chair_text', agent: 'chair', text: b.text });
        else if (b.type === 'tool_use' && b.name === 'Skill') {
          emit({ kind: 'skill', agent: 'chair', text: skillName(b.input) });
        } else if (b.type === 'tool_use' && !b.name.startsWith('mcp__council__')) {
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

export function skillName(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  return String(i.skill ?? i.name ?? i.command ?? 'unknown');
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
