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
CONFIDENCE: high, medium or low, and what you did not verify.`;
