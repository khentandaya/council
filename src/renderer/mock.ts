// Browser-only demo bridge: used when the renderer runs outside Electron (design review, demos).
// It replays a scripted run through the same event pipeline the real app uses. Demo data, not real.
import type { CouncilApi, CouncilConfig, CouncilEvent } from '../shared/types.ts';

if (!window.council) installMock();

function installMock() {
  let seq = 0;
  const listeners = new Set<(e: CouncilEvent) => void>();
  let config: CouncilConfig = {
    profiles: [{ id: 'a', name: 'Account 1', configDir: 'C:/Users/demo/.claude' }, { id: 'b', name: 'Account 2', configDir: 'C:/Users/demo/.claude-b' }],
    activeProfileId: 'a', recentFolders: ['C:/Users/demo/code/council', 'C:/Users/demo/code/storefront'], currentFolder: 'C:/Users/demo/code/council',
    chairModel: 'opus', chairEffort: 'medium', workerTimeoutMin: 10, agyAllowCommands: [], bins: { claude: '', codex: '', agy: '' },
    pipeline: true, handoffAtPct: 20,
  };
  let timers: number[] = [];
  const pending = new Map<string, (ok: boolean) => void>();
  const emit = (runId: string, e: Omit<CouncilEvent, 'seq' | 'ts' | 'runId'>) => listeners.forEach((l) => l({ ...e, seq: ++seq, ts: Date.now(), runId }));

  const script = (runId: string, prompt: string) => {
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
    const E = (e: Omit<CouncilEvent, 'seq' | 'ts' | 'runId'>) => emit(runId, e);
    E({ kind: 'run_start', agent: 'chair', text: prompt });
    at(500, () => E({ kind: 'chair_init', agent: 'chair', model: 'claude-opus-5-5', data: { sessionId: 'demo-session', mcp: [{ name: 'github', status: 'connected' }] } }));
    at(1000, () => E({ kind: 'skill', agent: 'chair', text: 'superpowers:brainstorming' }));
    at(1200, () => E({ kind: 'context', agent: 'chair', model: 'claude-opus-5-5', data: { tokens: 384_000 } }));
    at(1400, () => E({ kind: 'chair_tool', agent: 'chair', text: 'Grep "retry" src/' }));
    at(2000, () => E({ kind: 'plan', agent: 'chair', text: 'Three separable pieces: a code fix, a bit of research and a changelog line. Each goes to the cheapest worker that does it well.', data: { rev: 1, steps: [
      { id: 's1', goal: 'Fix the spawn timeout so a timed-out child is killed once, with a test', agent: 'codex', tier: 1, why: 'Focused change in one file plus a test: Codex at medium effort', write: true },
      { id: 's2', goal: 'Find two common tray patterns for keeping an Electron app alive', agent: 'antigravity', tier: 0, why: 'Web lookup and summary: Flash low is enough', write: false },
      { id: 's3', goal: 'Draft a three-line changelog entry for the fix', agent: 'claude', tier: 0, why: 'Short writing: Haiku', write: false, depends_on: ['s1'] },
    ] } }));
    at(2400, () => E({ kind: 'chair_text', agent: 'chair', text: 'Three separable pieces here. I\'ll send the retry fix to Codex, the docs research to Antigravity, and a quick changelog to a Haiku worker.' }));
    at(3200, () => E({ kind: 'dispatch', agent: 'codex', taskId: 't1', tier: 1, model: 'codex-medium', text: 'Fix the retry loop in src/main/runners/spawn.ts so a timed-out child is killed once and the promise resolves with timedOut=true. Add a test.', data: { write: true, step: 's1' } }));
    at(3500, () => E({ kind: 'dispatch', agent: 'antigravity', taskId: 't2', tier: 0, model: 'gemini-3.8-flash-low', text: 'Find how other Electron apps keep a tray icon alive while the window is closed. Summarise the two most common patterns.', data: { write: false, step: 's2' } }));
    at(3800, () => E({ kind: 'dispatch', agent: 'claude', taskId: 't3', tier: 0, model: 'haiku', text: 'Draft a three-line changelog entry for the tray fix.', data: { write: false, step: 's3' } }));
    const codexLines = ['Reading src/main/runners/spawn.ts', '$ npm test -- spawn', 'edit src/main/runners/spawn.ts', 'Adding timeout test', '$ npm test -- spawn'];
    codexLines.forEach((t, i) => at(6200 + i * 1300, () => E({ kind: i % 2 ? 'worker_tool' : 'worker_text', agent: 'codex', taskId: 't1', tier: 1, text: t })));
    at(6600, () => E({ kind: 'worker_text', agent: 'antigravity', taskId: 't2', tier: 0, text: 'Searching: electron tray window-all-closed' }));
    at(5400, () => E({ kind: 'skill', agent: 'codex', taskId: 't1', tier: 1, text: 'test-driven-development' }));
    at(7200, () => E({ kind: 'worker_text', agent: 'claude', taskId: 't3', tier: 0, text: 'Drafting changelog…' }));
    at(7600, () => E({ kind: 'skill', agent: 'claude', taskId: 't3', tier: 0, text: 'humanizer' }));
    at(9000, () => E({ kind: 'worker_done', agent: 'claude', taskId: 't3', tier: 0, model: 'haiku', text: 'Fixed: Council keeps running in the tray while a run is in progress.\nRESULT: drafted the entry.\nFILES: none\nCONFIDENCE: high', data: { secs: 5, tokens: 3100, costUsd: 0.004 } }));
    at(11000, () => E({ kind: 'worker_done', agent: 'antigravity', taskId: 't2', tier: 0, model: 'gemini-3.8-flash-low', text: 'Two patterns: prevent quit in window-all-closed while work runs; or hide instead of close.\nRESULT: found both patterns with examples.\nFILES: none\nCONFIDENCE: medium', data: { secs: 7, tokens: 21950 } }));
    at(12800, () => E({ kind: 'review', agent: 'claude', taskId: 't3', tier: 0, verdict: 'accept', text: 'Matches the change and stays under three lines.' }));
    at(14200, () => E({ kind: 'review', agent: 'antigravity', taskId: 't2', tier: 0, verdict: 'redo', text: 'Second pattern has no source. Asked for one concrete reference.' }));
    at(14600, () => E({ kind: 'dispatch', agent: 'antigravity', taskId: 't4', tier: 1, model: 'gemini-4-neon-medium', text: 'Same question, but cite one real project for each pattern.', data: { write: false, step: 's2' } }));
    at(15200, () => E({ kind: 'chair_tool', agent: 'chair', text: 'Fetch https://www.electronjs.org/docs/latest/api/tray' }));
    at(15300, () => E({ kind: 'permission', agent: 'chair', text: 'Fetch https://www.electronjs.org/docs/latest/api/tray', data: { id: 'p1', toolName: 'WebFetch', reason: null } }));
    pending.set('p1', (ok) => {
      E({ kind: 'permission_resolved', agent: 'chair', data: { id: 'p1', allow: ok } });
      at(1200, () => E({ kind: 'worker_done', agent: 'codex', taskId: 't1', tier: 1, model: 'codex-medium', text: 'Killed the child once on timeout and resolved with timedOut=true.\nRESULT: fixed, test added and passing.\nFILES: src/main/runners/spawn.ts, test/spawn.test.ts\nCONFIDENCE: high', data: { secs: 18, tokens: 48200 } }));
      at(2600, () => E({ kind: 'dispatch', agent: 'claude', taskId: 't5', tier: 1, model: 'sonnet', text: 'Review the diff in src/main/runners/spawn.ts for races between timeout and close. Read-only.', data: { write: false, crossCheckOf: 't1' } }));
      at(4200, () => E({ kind: 'worker_done', agent: 'antigravity', taskId: 't4', tier: 1, model: 'gemini-4-neon-medium', text: 'Pattern 1: VS Code keeps running in the tray. Pattern 2: Slack hides the window on close.\nRESULT: cited one project each.\nCONFIDENCE: high', data: { secs: 9, tokens: 30400 } }));
      at(5600, () => E({ kind: 'review', agent: 'antigravity', taskId: 't4', tier: 1, verdict: 'accept', text: 'Both patterns now have a concrete example.' }));
      at(8200, () => E({ kind: 'worker_done', agent: 'claude', taskId: 't5', tier: 1, model: 'sonnet', text: 'No race: the timeout kills, close resolves once.\nRESULT: approved.\nCONFIDENCE: high', data: { secs: 6, tokens: 9800, costUsd: 0.031 } }));
      at(9400, () => E({ kind: 'review', agent: 'codex', taskId: 't1', tier: 1, verdict: 'accept', text: 'Sonnet cross-check found no race; the test covers the timeout path.' }));
      at(9800, () => E({ kind: 'review', agent: 'claude', taskId: 't5', tier: 1, verdict: 'accept', text: 'Cross-check was specific and matches the code.' }));
      at(11000, () => E({ kind: 'chair_text', agent: 'chair', text: 'All three pieces are back and checked.' }));
      at(11800, () => E({ kind: 'run_done', agent: 'chair', text: '**Done.** The spawn timeout now kills the child once and resolves with `timedOut: true`.\n\n- **Codex** (T1) fixed `spawn.ts` and added a test. Sonnet cross-checked it for races: none found.\n- **Antigravity** researched tray patterns. I sent the first answer back for a source; the T1 retry cited VS Code and Slack.\n- **Haiku** drafted the changelog line.\n\nNot verified: the installer build, which I didn\'t run.', data: { sessionId: 'demo-session', costUsd: 0.214, ms: 31000 } }));
    });
  };

  const api: CouncilApi = {
    getConfig: async () => config,
    setConfig: async (p) => (config = { ...config, ...p }),
    pickFolder: async () => null,
    listWorkerSessions: async () => [
      { sessionId: '01a1f9c2-f36d-7560-93f9-8f3340af9521', agent: 'codex', taskId: 't1', model: 'codex-medium', tier: 1, folder: config.currentFolder!, handoffPath: '', ts: Date.now() - 6 * 60_000, ok: true },
      { sessionId: '01a1f9be-bda8-75d3-82dd-1a1d9d07cd17', agent: 'codex', taskId: 't1', model: 'codex-low', tier: 0, folder: config.currentFolder!, handoffPath: '', ts: Date.now() - 9 * 60_000, ok: false },
      { sessionId: 'b3c1e0aa-0000-4000-8000-000000000004', agent: 'antigravity', taskId: 't4', model: 'gemini-3-flash', tier: 1, folder: config.currentFolder!, handoffPath: '', ts: Date.now() - 7 * 60_000, ok: true },
      { sessionId: 'c7d2f1bb-0000-4000-8000-000000000005', agent: 'claude', taskId: 't5', model: 'sonnet', tier: 1, folder: config.currentFolder!, handoffPath: '', ts: Date.now() - 5 * 60_000, ok: true },
    ],
    loadWorkerHandoff: async () => [
      '**RESULT** The spawn timeout now kills the child once and resolves with `timedOut: true`.',
      '**FILES**\n- `src/main/runners/spawn.ts` lines 24-31\n- `scripts/spawn.test.ts` (new)',
      '**CONFIDENCE** High. The new test covers the timeout path and passes.',
      '**HANDOFF** None.',
    ].join('\n\n'),
    listSessions: async () => [
      { sessionId: 'demo-session', title: 'Keep Council alive in the tray during a run', lastModified: Date.now() - 4 * 60_000, gitBranch: 'main', contextPct: 38 },
      { sessionId: 's2', title: 'Add account switcher with shared session history', lastModified: Date.now() - 3 * 3600_000, gitBranch: 'feat/accounts', contextPct: 72 },
      { sessionId: 's3', title: 'Why does agy hang without stdin closed?', lastModified: Date.now() - 26 * 3600_000, contextPct: 91 },
      { sessionId: 's4', title: 'Pixel office: tier desks and courier paths', lastModified: Date.now() - 3 * 86400_000, gitBranch: 'main', contextPct: 12 },
    ],
    loadSession: async () => [{ role: 'user', text: 'Earlier prompt from this session.' }, { role: 'assistant', text: 'Earlier answer from the chair.' }],
    accounts: async () => [{ profileId: 'a', email: 'dev@example.com', subscriptionType: 'Max', signedIn: true }, { profileId: 'b', email: 'work@example.com', subscriptionType: 'Pro', signedIn: true }],
    signIn: async () => {},
    addProfile: async () => config,
    connections: async () => [{ agent: 'chair', name: 'github', status: 'connected' }, { agent: 'chair', name: 'linear', status: 'needs-auth' }, { agent: 'codex', name: 'playwright' }, { agent: 'antigravity', name: 'figma' }],
    run: async (prompt) => { const runId = `demo-${Date.now()}`; script(runId, prompt); return { runId }; },
    stop: async () => { timers.forEach(clearTimeout); timers = []; listeners.forEach((l) => l({ seq: ++seq, ts: Date.now(), runId: 'demo', kind: 'run_error', agent: 'chair', text: 'Stopped.' })); },
    answerPermission: async (id, allow) => { pending.get(id)?.(allow); pending.delete(id); },
    usage: async () => {
      const t = Date.now(), hr = 3600_000;
      return [
        { agent: 'claude', available: true, plan: 'max', fiveHour: { usedPct: 34, resetsAt: t + 2.3 * hr }, weekly: { usedPct: 61, resetsAt: t + 70 * hr }, fetchedAt: t },
        { agent: 'codex', available: true, fiveHour: { usedPct: 81, resetsAt: t + 0.6 * hr }, weekly: { usedPct: 39, resetsAt: t + 90 * hr }, note: "From Codex's last run.", fetchedAt: t },
        { agent: 'antigravity', available: false, note: "Antigravity's CLI doesn't report its quota. Council shows the tokens it measured instead.", fetchedAt: t },
      ];
    },
    sessionContext: async () => ({ percentage: 38, totalTokens: 380_000, maxTokens: 1_000_000, model: 'claude-opus-5-5' }),
    window: () => {},
    onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  (window as any).council = api;
  (window as any).__councilDemo = (p = 'Fix the spawn timeout, research tray patterns, and write a changelog line.') => api.run(p, null);
}
