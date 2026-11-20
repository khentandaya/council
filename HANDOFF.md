# Council: handoff

Last updated 2026-11-20. Read README.md first for what Council is and how to run it.

## State
- Git: one commit on `master`, `bed065d` ("Build Council: Claude chairs Codex, Antigravity and Claude workers"). There is no remote.
- **Everything below is uncommitted** in the working tree (about 20 modified files plus the new `src/main/usage.ts`). The last type check (`npx tsc --noEmit -p .`) passed after each change.
- The installer in `dist/` is from the first commit. It does **not** include any of the work below.

## Uncommitted work

### 1. Owner review fixes
- **Clipped model menu:** popovers now flip upward and clamp to the window (`src/renderer/dom.ts` `popover`). The prompt-bar chips no longer wrap (container queries in `styles.css`).
- **5-hour and weekly usage per office:** two pixel "fuel tanks" in each room (`office/scene.ts` `drawTanks`, `TANKS`). Each tank's liquid level shows how much of the limit is left. Hovering shows a card with the full numbers and reset times (`office/overlay.ts`). Data comes from `src/main/usage.ts`:
  - Claude: the Agent SDK's `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`, called on an idle query that never sends a prompt. It takes about 2 seconds and costs no tokens.
  - Codex: `rate_limits` from the newest file in `~/.codex/sessions/**/rollout-*.jsonl`. `primary` is the 5-hour window and `secondary` the weekly one, matched by `window_minutes`.
  - Antigravity: no quota is available. The CLI doesn't report one, so the tanks show "?" and Council shows the tokens it measured instead.
- **Session context %:** session rows in the sidebar show a gauge estimated from the JSONL tail (`sessions.ts` `estimateContext`). The prompt bar has an exact meter from `getContextUsage` on a resumed idle query (`usage.ts` `sessionContext`), which updates live during runs.
- **Skills:** skills are detected for the chair and Claude workers (the `Skill` tool), and for Codex and Antigravity (a read of `.../skills/<name>/SKILL.md`, `runners/types.ts` `skillFromPath`). They show in the transcript, on task cards, in the answer footer, and as office speech bubbles.
- A Codex review found 7 bugs (races in `refreshUsage`/`refreshContext`, the Codex window mapping, a stale hover card, a timer leak). All 7 are fixed.

### 2. Mandatory pipeline (owner request: the chair plans, workers execute)
- `src/main/chair.ts`:
  - A new `submit_plan` tool. Steps carry the worker, tier, why, write, and `depends_on`.
  - `gate()` refuses any delegation without a plan, and any step sent to a worker other than the one the plan names.
  - The chair gets only the tools `Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch` and `Skill`. A PreToolUse hook denies everything else, even if the user's own settings allow it.
  - A Stop hook blocks the chair from finishing until there is a plan and every step has been dispatched. After 2 blocks it lets the chair finish and logs that the plan is incomplete.
- UI: a live Plan card in the transcript (`ui/drawer.ts` `planCard`), a "Planning" state in the status pill and the ledger, and dotted outline cards on the office task board for planned steps (`scene.ts`). The demo run in `mock.ts` follows the pipeline.

## Verified
- Real harness run: a trivial question went plan, then Haiku worker, then chair review, then answer.
- Real harness run: a prompt telling the chair to run a command itself. The chair refused and planned a worker step. The run was then cut off because the Claude 5-hour limit was reached.
- Real reads: Claude usage (`team` plan, 5h 7% / weekly 2%), Codex usage (5h 2% / weekly 39%), exact context 45% on a 1M-token session.
- Demo screenshots (1440x900): the usage tanks, the hover card, the upward model menu, the context meter, the skill entries.

## Not verified
- The plan card and the planned board cards have not been seen in the real app (the screenshot runs were interrupted).
- The installer has not been rebuilt with these changes.
- No full real run of a multi-step plan with parallel workers under the new pipeline.

## Next steps
1. `npm run dev`. Run one multi-step prompt and look at the plan card, the board cards, the tanks and the context meter.
2. Fix the out-of-date README bullet "Permissions" in the How the council works section. The chair no longer asks before commands or edits, because it can't run them; it only asks before WebFetch.
3. Commit, then `npm run dist` to rebuild the installer.
4. Optional: a design finish review of the new UI pieces (the earlier review's open items: one bookkeeping step was skipped and DESIGN.md was never written).

## Gotchas
- PowerShell 5 writes a BOM. `config.ts` strips it, but write JSON with Node to be safe.
- Child CLIs must get `cleanEnv()`. Otherwise a parent Claude Code session's variables leak in and the child thinks it is a nested session.
- Headless `agy` can't ask for approval, so its allowed commands come from `agyAllowCommands` in `%APPDATA%\Council\config.json`.
- `scripts/harness.ts "<prompt>" <folder>` runs the chair without the UI. Its permission prompts are auto-denied.
- Scratch files go in `.tmp/`, which is ignored by git.
