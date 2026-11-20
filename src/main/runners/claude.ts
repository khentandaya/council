import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanEnv } from '../env.ts';
import { RETURN_FORMAT, SKILL_PREFIX, type WorkerResult, type WorkerRunInput } from './types.ts';

/** A separate Claude (haiku / sonnet / opus) doing a delegated task with its own context. */
export async function runClaudeWorker(bin: string, configDir: string, model: string, i: WorkerRunInput): Promise<WorkerResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), i.timeoutMs);
  const onAbort = () => ac.abort();
  i.signal?.addEventListener('abort', onAbort, { once: true });

  let sessionId: string | undefined = i.resume;
  let output = '';
  let costUsd: number | undefined;
  let tokens: number | undefined;
  try {
    const q = query({
      prompt: i.task + RETURN_FORMAT,
      options: {
        cwd: i.cwd,
        settingSources: ['project', 'local'],
        model,
        resume: i.resume,
        pathToClaudeCodeExecutable: bin || undefined,
        env: cleanEnv({ CLAUDE_CONFIG_DIR: configDir }),
        abortController: ac,
        // read-only workers can't touch files; writers may edit, but shell stays off
        permissionMode: i.write ? 'acceptEdits' : 'plan',
        disallowedTools: i.write ? ['Bash'] : ['Bash', 'Write', 'Edit', 'NotebookEdit'],
        effort: model === 'opus' ? 'high' : 'medium',
      },
    });
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
      else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message.content) {
          if (b.type === 'text' && b.text.trim()) i.onText(b.text);
          else if (b.type === 'tool_use') i.onTool(b.name === 'Skill' ? SKILL_PREFIX + String((b.input as any)?.skill ?? (b.input as any)?.name ?? 'unknown') : b.name);
        }
      } else if (m.type === 'result') {
        costUsd = m.total_cost_usd;
        tokens = (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0) + (m.usage?.cache_read_input_tokens ?? 0);
        if (m.subtype === 'success' && !m.is_error) output = m.result;
        else return { ok: false, output, sessionId, error: m.subtype === 'success' ? m.result : m.subtype };
      }
    }
    return { ok: !!output, output, sessionId, tokens, costUsd, error: output ? undefined : 'no result' };
  } catch (err) {
    const msg = ac.signal.aborted ? (i.signal?.aborted ? 'stopped by user' : 'timed out') : String(err);
    return { ok: false, output, sessionId, error: msg };
  } finally {
    clearTimeout(timer);
    i.signal?.removeEventListener('abort', onAbort);
  }
}
