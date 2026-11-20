import { Check, ChevronDown, ChevronRight, FolderOpen, GitBranch, LogIn, Minus, PanelRight, RefreshCw, Square, SquarePen, UserPlus, X } from 'lucide';
import iconUrl from '../../../resources/icon.png';
import type { WorkerSession } from '../../shared/types.ts';
import { basename, clear, h, icon, popover, relTime } from '../dom.ts';
import { notify, resetConversation, state, subscribe } from '../store.ts';
import { shortModel, tierBadge } from './stage.ts';
import { AGENT_NAME, refreshAccounts, refreshConfig, refreshConnections, refreshContext, refreshSessions, refreshUsage } from './data.ts';

const api = window.council;

export function mountTitlebar(el: HTMLElement) {
  const folderBtn = h('button', { class: 'tb-btn', 'aria-haspopup': 'menu' });
  const status = h('div', { class: 'status-pill', role: 'status', 'aria-live': 'polite' });
  const acctBtn = h('button', { class: 'tb-btn', 'aria-haspopup': 'menu' });
  const drawerBtn = h('button', { class: 'icon-btn', title: 'Toggle side panel', 'aria-label': 'Toggle side panel', onclick: () => document.getElementById('app')!.classList.toggle('drawer-collapsed') }, icon(PanelRight, 16));

  el.append(
    h('div', { class: 'mark' }, h('img', { src: iconUrl, alt: '' }), h('span', null, 'Council')),
    folderBtn, h('div', { class: 'spacer' }), status, h('div', { class: 'spacer' }), acctBtn, drawerBtn,
    h('div', { class: 'win-ctrls' },
      h('button', { 'aria-label': 'Minimize', onclick: () => api.window('min') }, icon(Minus, 16)),
      h('button', { 'aria-label': 'Maximize', onclick: () => api.window('max') }, icon(Square, 13)),
      h('button', { class: 'close', 'aria-label': 'Close', onclick: () => api.window('close') }, icon(X, 16)),
    ),
  );

  folderBtn.addEventListener('click', () => {
    const c = state.config!;
    const pickNew = async () => { close(); const f = await api.pickFolder(); if (f) await switchFolder(f, false); };
    const items = c.recentFolders.slice(0, 10).map((f) => h('button', {
      class: 'menu-item', role: 'menuitem', title: f, disabled: state.running,
      onclick: () => { close(); switchFolder(f, true); },
    }, h('span', { class: 'grow' }, h('span', { class: 'main' }, basename(f)), h('span', { class: 'sub' }, f)),
      f === c.currentFolder ? icon(Check, 15, 'check') : null));
    const close = popover(folderBtn, h('div', null,
      items.length ? h('div', { class: 'menu-label' }, 'Recent folders') : null, ...items,
      items.length ? h('div', { class: 'menu-sep' }) : null,
      h('button', { class: 'menu-item', role: 'menuitem', disabled: state.running, onclick: pickNew }, icon(FolderOpen, 15), h('span', { class: 'grow' }, 'Open folder…')),
    ));
  });

  acctBtn.addEventListener('click', () => {
    const c = state.config!;
    const rows = c.profiles.map((p) => {
      const a = state.accounts.find((x) => x.profileId === p.id);
      const pick = async () => {
        close();
        if (!a?.signedIn) { await api.signIn(p.id); return; }
        if (p.id === c.activeProfileId) return;
        state.config = await api.setConfig({ activeProfileId: p.id });
        notify('config');
        refreshSessions(); refreshConnections(); refreshUsage(true);
      };
      return h('button', { class: 'menu-item', role: 'menuitem', disabled: state.running, onclick: pick },
        h('span', { class: `avatar${p.id === c.profiles[0].id ? '' : ' alt'}` }, initial(a?.email ?? p.name)),
        h('span', { class: 'grow' }, h('span', { class: 'main' }, a?.email ?? p.name),
          h('span', { class: 'sub' }, a?.signedIn ? `${p.name}${a.subscriptionType ? ` · ${a.subscriptionType}` : ''}` : `${p.name} · not signed in`)),
        a?.signedIn ? (p.id === c.activeProfileId ? icon(Check, 15, 'check') : null) : icon(LogIn, 15));
    });
    const addAcct = async () => {
      close();
      state.config = await api.addProfile(`Account ${state.config!.profiles.length + 1}`);
      const p = state.config.profiles[state.config.profiles.length - 1];
      await api.signIn(p.id);
      notify('config'); refreshAccounts();
    };
    const close = popover(acctBtn, h('div', null,
      h('div', { class: 'menu-label' }, 'Claude account for the chair and Claude workers'), ...rows,
      h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item', role: 'menuitem', onclick: addAcct }, icon(UserPlus, 15), h('span', { class: 'grow' }, 'Add another account…')),
      h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { close(); refreshAccounts(); } }, icon(RefreshCw, 15), h('span', { class: 'grow' }, 'I finished signing in, refresh')),
    ), 'right');
  });

  let timer: number | undefined;
  const renderStatus = () => {
    const out = [...state.tasks.values()].filter((t) => t.status === 'working').length;
    const perms = state.permissions.length;
    status.className = `status-pill${perms ? ' attn' : state.running ? ' live' : ''}`;
    let text = 'Idle';
    if (perms) text = `Needs your OK (${perms})`;
    else if (state.running) {
      const s = Math.round((Date.now() - (state.runStartedAt ?? Date.now())) / 1000);
      const phase = out ? `${out} task${out > 1 ? 's' : ''} out` : ({ planning: 'Chair planning', thinking: 'Chair thinking', writing: 'Chair writing', waiting: 'Waiting on workers', reviewing: 'Chair reviewing', idle: 'Working' } as const)[state.chair];
      text = `${phase} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    clear(status, h('span', { class: 'dot' }), h('span', { class: 'num' }, text));
    if (state.running && !timer) timer = window.setInterval(renderStatus, 1000);
    if (!state.running && timer) { clearInterval(timer); timer = undefined; }
  };

  const renderFolder = () => {
    const f = state.config?.currentFolder;
    folderBtn.title = f ?? 'Open a folder';
    clear(folderBtn, icon(FolderOpen, 15), h('span', { class: 'label' }, f ? h('strong', null, basename(f)) : 'Open a folder'), icon(ChevronDown, 14));
  };
  const renderAcct = () => {
    const c = state.config; if (!c) return;
    const p = c.profiles.find((x) => x.id === c.activeProfileId) ?? c.profiles[0];
    const a = state.accounts.find((x) => x.profileId === p.id);
    acctBtn.title = 'Switch Claude account';
    clear(acctBtn, h('span', { class: `avatar${p.id === c.profiles[0].id ? '' : ' alt'}` }, initial(a?.email ?? p.name)),
      h('span', { class: 'label' }, a?.email ?? (a?.signedIn === false ? `${p.name} (sign in)` : p.name)), icon(ChevronDown, 14));
  };

  subscribe((t) => {
    if (t === 'config') { renderFolder(); renderAcct(); }
    if (t === 'accounts') renderAcct();
    if (t === 'run' || t === 'tasks' || t === 'permissions') renderStatus();
  });
  renderFolder(); renderStatus();
}

async function switchFolder(folder: string, save: boolean) {
  if (save) state.config = await api.setConfig({ currentFolder: folder });
  await refreshConfig();
  state.resumeId = null; state.sessionTitle = null;
  state.sessions = []; state.workerSessions = [];
  resetConversation();
  notify('config', 'run');
  refreshSessions(); refreshConnections();
}

const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();

export function mountSidebar(el: HTMLElement) {
  const list = h('div', { role: 'list', 'aria-label': 'Sessions' });
  const workers = h('details', { class: 'worker-sessions' });
  const newBtn = h('button', { class: 'icon-btn', title: 'New session', 'aria-label': 'New session', onclick: newSession }, icon(SquarePen, 16));
  const conns = h('details', { class: 'connections' });
  el.append(h('div', { class: 'side-head' }, h('h2', null, 'Sessions'), newBtn), h('div', { class: 'session-list' }, list, workers), conns);

  const renderSessions = () => {
    newBtn.disabled = state.running;
    if (!state.config?.currentFolder) {
      clear(list, h('div', { class: 'side-empty' }, 'Pick the folder the council should work in. Its Claude sessions show up here.',
        h('div', null, h('button', { class: 'btn sm', onclick: async () => { const f = await api.pickFolder(); if (f) switchFolder(f, false); } }, icon(FolderOpen, 14), 'Open folder…'))));
      return;
    }
    if (!state.sessions.length) {
      clear(list, h('div', { class: 'side-empty' }, 'No sessions in this folder yet. Your first prompt starts one.'));
      return;
    }
    clear(list, state.sessions.map((s) => h('button', {
      class: `session${s.sessionId === state.resumeId ? ' active' : ''}`, role: 'listitem', disabled: state.running,
      title: s.title, onclick: () => openSession(s.sessionId, s.title),
    }, h('span', { class: 't' }, s.title),
      h('span', { class: 'm' }, h('span', { class: 'num' }, relTime(s.lastModified)),
        s.gitBranch ? h('span', { class: 'branch' }, icon(GitBranch, 11), s.gitBranch) : null,
        ctxGauge(s.sessionId === state.resumeId && state.context?.pct != null ? state.context.pct : s.contextPct, s.sessionId === state.resumeId && !!state.context?.exact)))));
  };

  const renderWorkers = () => {
    workers.hidden = !state.config?.currentFolder;
    const open = workers.open;
    const shownId = state.drawerTab === 'handoff' ? state.workerHandoff?.session.sessionId : undefined;
    const order = ['codex', 'antigravity', 'claude'] as const;
    const groups = order.map((agent) => {
      const sessions = state.workerSessions.filter((s) => s.agent === agent);
      if (!sessions.length) return null;
      return h('div', { class: 'worker-group', 'data-agent': agent },
        h('div', { class: 'worker-agent' }, h('span', { class: 'sw' }), AGENT_NAME[agent], h('span', { class: 'num' }, String(sessions.length))),
        sessions.map((s) => h('button', {
          class: `session worker${s.sessionId === shownId ? ' active' : ''}`, title: `${s.taskId.toUpperCase()} · ${s.model} · ${new Date(s.ts).toLocaleString()}`,
          onclick: () => openWorkerHandoff(s),
        },
          h('span', { class: 't' }, h('span', { class: 'task-id' }, s.taskId.toUpperCase()), shortModel(s.model)),
          h('span', { class: 'm' }, tierBadge(s, true),
            h('time', { class: 'num', datetime: new Date(s.ts).toISOString() }, relTime(s.ts)),
            h('span', { class: `verdict ${s.ok ? 'accept' : 'failed'}` }, s.ok ? 'Done' : 'Failed')))));
    });
    clear(workers, h('summary', null, icon(ChevronRight, 14, 'chev'), 'Worker sessions',
      h('span', { class: 'count num' }, String(state.workerSessions.length))),
      state.workerSessions.length ? groups : h('div', { class: 'side-empty' }, 'No worker sessions in this folder yet.'));
    workers.open = open;
  };

  const renderConns = () => {
    const open = conns.open;
    const order = ['chair', 'codex', 'antigravity'] as const;
    const rows = order.flatMap((agent) => state.connections.filter((c) => c.agent === agent).map((c) =>
      h('div', { class: 'conn', 'data-agent': agent, title: `${AGENT_NAME[agent]}: ${c.name}` },
        h('span', { class: 'dot' }), h('span', { class: 'name' }, c.name),
        c.status ? h('span', { class: `st${/fail|error|needs/i.test(c.status) ? ' bad' : ''}` }, c.status) : h('span', { class: 'st' }, agent === 'chair' ? 'claude' : agent))));
    clear(conns, h('summary', null, icon(ChevronRight, 14, 'chev'), 'Connections', h('span', { class: 'count num' }, String(state.connections.length))),
      rows.length ? rows : h('div', { class: 'side-empty' }, 'No MCP servers configured for these agents.'));
    conns.open = open;
  };

  subscribe((t) => {
    if (t === 'sessions' || t === 'config' || t === 'run' || t === 'context') renderSessions();
    if (t === 'sessions' || t === 'config' || t === 'drawer') renderWorkers();
    if (t === 'connections') renderConns();
  });
  renderSessions(); renderWorkers(); renderConns();
}

async function openWorkerHandoff(session: WorkerSession) {
  const view = { session, output: undefined as string | null | undefined };
  state.workerHandoff = view;
  state.drawerTab = 'handoff';
  document.getElementById('app')!.classList.remove('drawer-collapsed');
  notify('drawer');
  view.output = await api.loadWorkerHandoff(session.sessionId).catch(() => null);
  if (state.workerHandoff === view && state.drawerTab === 'handoff') notify('drawer');
}

function newSession() {
  if (state.running) return;
  state.resumeId = null; state.sessionTitle = null;
  resetConversation();
  notify('sessions', 'run');
  document.querySelector<HTMLTextAreaElement>('#promptbar textarea')?.focus();
}

async function openSession(id: string, title: string) {
  if (state.running) return;
  resetConversation();
  state.resumeId = id; state.sessionTitle = title;
  const msgs = await api.loadSession(id);
  state.entries = msgs.slice(-40).map((m) => ({ kind: 'history' as const, role: m.role, text: m.text }));
  state.entries.unshift({ kind: 'notice', text: msgs.length > 40 ? `Resuming session · showing last 40 of ${msgs.length} messages` : 'Resuming session', ts: Date.now() });
  state.drawerTab = 'transcript';
  notify('entries', 'sessions', 'run', 'drawer');
  refreshContext();
}

export { newSession };

/** Small context gauge for a session row: a 5-cell bar that warms as the window fills. */
function ctxGauge(pct: number | undefined | null, exact: boolean) {
  if (pct == null) return null;
  const level = pct >= 80 ? 'hot' : pct >= 60 ? 'warm' : '';
  return h('span', { class: `ctx-gauge ${level}`, title: `Context ${pct}% full${exact ? '' : ' (estimated from the last reply)'}` },
    h('span', { class: 'cells', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4].map((i) => h('i', { class: pct > i * 20 ? 'on' : '' }))),
    h('span', { class: 'num' }, `${pct}%`));
}
