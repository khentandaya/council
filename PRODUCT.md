# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app for Windows; the UI is web technology inside a native frameless window.)

## Stack

Electron + TypeScript, electron-vite, PixiJS for the office canvas, plain DOM + CSS for the shell. Claude Agent SDK in the main process. Chosen by Claude and approved by the user in the build plan.

## Users

A developer who has paid subscriptions for Claude (two accounts), Codex and Antigravity, using Council on their own Windows PC for real coding and research work. Built for that one person first, but meant to be shareable later: first-run setup and labels must make sense to someone who didn't build it.

## Product Purpose

One place to give a prompt where Claude chairs: it decides what to do itself and what to hand to Codex, Antigravity or a separate Claude worker, routes each task to the cheapest model tier that can do it well, and reviews every return (with cross-checks by a different agent for risky output) before answering. Success means better results than any single agent, with spend kept in proportion to the task.

## Positioning

The council is real: actual Codex, Antigravity and Claude CLIs with the user's own logins, MCP connections, skills and sessions, orchestrated by a Claude chair, and shown as a living pixel-art office where you watch tasks walk between rooms.

## Operating Context

- Runs against a chosen workspace folder; every agent works in that folder.
- Resumes existing Claude sessions for that folder; switches between two Claude accounts (profiles with their own config dir).
- Long runs (minutes); the user glances at it while doing other things, so the tray and notifications matter.
- The chair asks permission before shell commands and file edits it does itself.

## Capabilities and Constraints

- Agents: chair (Claude, Agent SDK), Codex (`codex exec`), Antigravity (`agy -p`), Claude workers (haiku/sonnet/opus).
- Model tiers: 0 trivial, 1 normal, 2 hard. Escalation only after a failed review.
- At a glance during a run the user wants all three: who is doing what (agent, task, tier), result quality (review verdicts, redos, cross-checks), and spend (tokens / cost per agent and per run).
- Cost: Claude reports USD per run; Codex and Antigravity report tokens only. Never invent dollar figures for them.

## Brand Commitments

- Name: Council.
- Agent identity colors are binding: Claude amber, Codex mint, Antigravity violet, Claude workers sand.
- The office is original pixel art. No copied game assets or recognisable game look.

## Evidence on Hand

None yet (new product). Do not fabricate usage stats, testimonials or benchmarks.

## Product Principles

1. The chair is accountable: every delegated result is reviewed before it reaches the user.
2. Never overkill: the cheapest capable tier first, and the UI makes tier choices visible.
3. Reuse what the user already has: logins, folders, sessions, MCP connections.
4. Glanceable, not noisy: state is readable from across the desk; detail is one click away.
5. The office is a truthful view of the run, never a decoration that drifts from what is actually happening.
