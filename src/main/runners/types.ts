export interface WorkerRunInput {
  task: string;
  cwd: string;
  /** may the worker change files? false = read-only review / research */
  write: boolean;
  resume?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onText: (text: string) => void;
  onTool: (text: string) => void;
}

export interface WorkerResult {
  ok: boolean;
  output: string;
  sessionId?: string;
  error?: string;
  tokens?: number;
  /** only Claude reports dollars; Codex and Antigravity report tokens */
  costUsd?: number;
}

/** Appended to every worker task so returns are easy for the chair to review. */
export const RETURN_FORMAT = `

When you finish, end your reply with a short section:
RESULT: what you did or found, in 1-3 sentences.
FILES: each file you created or changed, or "none".
CONFIDENCE: high, medium or low, and what you did not verify.
HANDOFF: decisions, open issues, and exact file:line pointers the next person needs.`;

/** Runners report a skill load through onTool with this prefix; the chair turns it into a skill event. */
export const SKILL_PREFIX = 'skill:';

/** Codex and Antigravity load a skill by reading its SKILL.md; returns the skill's folder name. */
export function skillFromPath(s: string): string | null {
  // JSON-escaped paths double their backslashes, so treat any run of slashes as one separator
  const m = s.match(/[\\/]+skills[\\/]+(?:[^\\/\s"']+[\\/]+)*?([^\\/\s"']+)[\\/]+SKILL\.md/i);
  return m ? m[1] : null;
}
