---
version: 1
slug: "src-renderer-index-html"
primary_target: "src/renderer/index.html"
related_targets: []
---

# Council main window

Scope: the single main window of the Council desktop app. Mode: Operate.
Job: give the chair a prompt, watch the council work, approve risky actions, read the reviewed answer, resume sessions, switch account and folder.
At a glance: who is doing what (agent, task, tier), result quality (verdicts, redos, cross-checks), spend (tokens, and $ where Claude reports it).
Constraints: pinned in the approved plan; agent colours are brand commitments; office is a truthful view of the run.

## Direction contract

THESIS: A calm graphite workstation around a living pixel office; the office is the status display, so it replaces the usual spinner-and-log dashboard instead of decorating it.
OWN-WORLD: Warm-tinted graphite surfaces, hairline borders, warm off-white text; four agent colours (Claude amber, Codex mint, Antigravity violet, workers sand) do every state job: dots, ledger columns, card stripes, office floors. Inter for UI with tabular numerals, Silkscreen only on office signage and bubbles. Lucide icons, one stroke.
STORY: You type a prompt; Claude at the head desk thinks, cards walk to the rooms whose tier desks light up, results walk back, stamps land, the answer appears in the drawer.
FIRST VIEWPORT: Titlebar (mark, folder, status, account, window controls); left session rail; centre: office canvas with the four-column ledger under it and the prompt bar docked at the bottom; right drawer with Transcript and Tasks tabs.
FORM: pinned by the user in the approved plan, so the concept roll was deliberately skipped; the pinned plan governs. seed: none (roll skipped: direction pinned by user)
SIGNATURE: tier desks: each room has T0/T1/T2 workstations, so model choice is visible as which desk lights up.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
