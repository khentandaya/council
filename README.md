# Council

A Windows desktop app where **Claude chairs a council of AI agents**. You give one prompt to Claude. It decides what to do itself and what to hand to **Codex**, **Antigravity**, or a separate **Claude worker** (Haiku / Sonnet / Opus). It routes each task to the cheapest model tier that can do it well, and reviews every return before answering you. You watch it all happen in a pixel-art office.

## What you need

| Agent | Must be installed and signed in |
|---|---|
| Claude (chair + workers) | Claude Code (`claude.exe` in `%USERPROFILE%\.local\bin`). If it's missing, Council falls back to the copy bundled with the Agent SDK. |
| Codex | `npm i -g @openai/codex`, then sign in once with `codex` |
| Antigravity | `agy` CLI (`%LOCALAPPDATA%\agy\bin\agy.exe`), signed in |

Council runs these CLIs as you, so your logins, MCP servers, skills, and CLAUDE.md / AGENTS.md files all apply.

## Run it

```powershell
npm install
npm run dev        # development window with hot reload
npm run dist       # builds dist\Council Setup <version>.exe
```

`npx vite src/renderer` serves the UI in a browser with a scripted **demo run** (no agents are called). In the browser console, call `__councilDemo()` to start it.

## How the council works

- **Model ladder.** Tier 0 (trivial) uses haiku, gemini-3.8-flash-low, or codex effort low. Tier 1 uses sonnet, flash-high/neon, or codex medium. Tier 2 uses opus, argon/hydrogen-high, or codex high. The chair starts at the lowest plausible tier and escalates only after a failed review. In the office, each room has a T0, T1 and T2 desk, and the desk that lights up shows which tier is working.
- **Review.** Every return gets a verdict: accept, redo, or escalate. For risky output, the chair asks a *different* agent to cross-check it read-only.
- **Read-only vs write.** The chair marks each task. Codex runs with `-s read-only` or `-s workspace-write`. Antigravity runs in default mode (edits are refused) or `accept-edits`. Claude workers never get a shell.
- **Permissions.** When the chair wants to run a command or edit a file itself, Council asks you first (Allow once / Always allow / Deny).
- **Antigravity commands.** Headless `agy` can't ask for approval, so it may only run the command prefixes listed in `agyAllowCommands` in `%APPDATA%\Council\config.json`. The defaults are read-only (`cat`, `rg`, `git status`, …). Add entries like `npm test` to let it run more.

## Accounts, folders, sessions

- **Two Claude accounts.** Use the account menu (top right) → *Add another account…*. Council creates a separate config folder (`~/.claude-b`) and opens a console where you run `/login` with the other account. Its `projects/` folder is linked to your main account's, so both accounts see the same session history. Switch accounts at any time between runs.
- **Folders.** The folder menu lists folders you've used in Council, plus folders Claude has sessions in.
- **Sessions.** The sidebar lists Claude sessions for the current folder. Click one to resume it, and follow-ups continue that session.

## Where things live

- Settings: `%APPDATA%\Council\config.json`
- Run logs (replayable event streams): `%APPDATA%\Council\runs\*.jsonl`
- Main process: `src/main` (chair, runners, sessions). UI: `src/renderer` (office canvas in `office/`).
