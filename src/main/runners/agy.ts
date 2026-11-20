import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { spawnJsonLines } from './spawn.ts';
import { RETURN_FORMAT, type WorkerResult, type WorkerRunInput } from './types.ts';

/** Headless agy can't ask for approval, so anything not pre-allowed is denied.
 *  Rules are prefix matches: command(git status) allows `git status ...`. */
function settingsFile(allowCommands: string[]) {
  mkdirSync(DATA_DIR, { recursive: true });
  const f = join(DATA_DIR, 'agy-settings.json');
  writeFileSync(f, JSON.stringify({ permissions: { allow: allowCommands.map((c) => `command(${c})`) } }, null, 2));
  return f;
}

export async function runAgy(bin: string, model: string, allowCommands: string[], i: WorkerRunInput): Promise<WorkerResult> {
  const args = [
    '-p', i.task + RETURN_FORMAT,
    '--output-format', 'stream-json',
    '--model', model,
    '--settings', settingsFile(allowCommands),
    '--print-timeout', `${Math.round(i.timeoutMs / 1000)}s`,
  ];
  // accept-edits: may change files, commands only from the allow-list.
  // default mode: every edit needs approval, which headless denies, so the task stays read-only.
  if (i.write) args.push('--mode', 'accept-edits');
  if (i.resume) args.push('--conversation', i.resume);

  let sessionId: string | undefined = i.resume;
  let text = '';
  let final = '';
  let status = '';
  let tokens = 0;

  const r = await spawnJsonLines({
    bin, args, cwd: i.cwd, timeoutMs: i.timeoutMs + 15_000, signal: i.signal,
    onJson: (e) => {
      if (e.event === 'init') sessionId = e.conversation_id;
      else if (e.event === 'step_update') {
        const s = e.step_update ?? {};
        if (s.step_type === 'agent_response' && s.text_delta) { text += s.text_delta; i.onText(text); }
        else if (s.state === 'ACTIVE' && s.step_type && s.step_type !== 'agent_response' && s.step_type !== 'user_input') {
          i.onTool(String(s.tool_name ?? s.step_type).replace(/_/g, ' '));
        }
      } else if (e.event === 'result') {
        final = e.result?.response ?? text;
        status = e.result?.status ?? '';
        tokens = e.result?.usage?.total_tokens ?? 0;
        const denied = (e.result?.denied_actions ?? []) as { action: string; display_name?: string }[];
        if (denied.length) i.onTool(`denied: ${denied.map((d) => d.display_name ?? d.action).join(', ')} (add it to Antigravity's allowed commands in settings)`);
      }
    },
  });

  const output = (final || text).trim();
  if (r.aborted) return { ok: false, output, sessionId, error: 'stopped by user' };
  if (r.timedOut) return { ok: false, output, sessionId, error: 'timed out' };
  if (status && status !== 'SUCCESS') return { ok: false, output, sessionId, error: `antigravity status ${status}` };
  if (!output) return { ok: false, output, sessionId, error: r.stderr.trim() || `exit ${r.code}` };
  return { ok: true, output, sessionId, tokens };
}
