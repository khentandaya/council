import { spawnJsonLines } from './spawn.ts';
import { RETURN_FORMAT, SKILL_PREFIX, skillFromPath, type WorkerResult, type WorkerRunInput } from './types.ts';

export async function runCodex(bin: string, effort: 'low' | 'medium' | 'high', i: WorkerRunInput): Promise<WorkerResult> {
  const common = ['--json', '--skip-git-repo-check', '-c', `model_reasoning_effort="${effort}"`];
  const args = i.resume
    ? ['exec', 'resume', i.resume, ...common, i.task + RETURN_FORMAT]
    : ['exec', ...common, '-s', i.write ? 'workspace-write' : 'read-only', '-C', i.cwd, i.task + RETURN_FORMAT];

  let sessionId: string | undefined = i.resume;
  let last = '';
  let tokens = 0;
  let failure = '';

  const r = await spawnJsonLines({
    bin, args, cwd: i.cwd, timeoutMs: i.timeoutMs, signal: i.signal,
    onJson: (e) => {
      if (e.type === 'thread.started') sessionId = e.thread_id;
      else if (e.type === 'item.completed' || e.type === 'item.started') {
        const it = e.item ?? {};
        if (it.type === 'agent_message' && e.type === 'item.completed') { last = it.text ?? ''; i.onText(last); }
        else if (it.type === 'command_execution' && e.type === 'item.started') {
          const sk = skillFromPath(String(it.command ?? ''));
          i.onTool(sk ? SKILL_PREFIX + sk : `$ ${it.command ?? ''}`);
        }
        else if (it.type === 'file_change' && e.type === 'item.completed') i.onTool(`edit ${(it.changes ?? []).map((c: any) => c.path).join(', ')}`);
        else if (it.type === 'reasoning' && it.text) i.onText(it.text);
      } else if (e.type === 'turn.completed') tokens = (e.usage?.input_tokens ?? 0) + (e.usage?.output_tokens ?? 0);
      else if (e.type === 'turn.failed' || e.type === 'error') failure = e.error?.message ?? e.message ?? 'codex failed';
    },
  });

  if (r.aborted) return { ok: false, output: last, sessionId, error: 'stopped by user' };
  if (r.timedOut) return { ok: false, output: last, sessionId, error: `timed out after ${Math.round(i.timeoutMs / 60000)} min` };
  if (failure || (r.code !== 0 && !last)) return { ok: false, output: last, sessionId, error: failure || r.stderr.trim() || `exit ${r.code}` };
  return { ok: true, output: last, sessionId, tokens };
}
