import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, CornerUpLeft, PanelRightClose, Redo2, ShieldCheck, Terminal, TrendingUp } from 'lucide';
import type { WorkerId } from '../../shared/types.ts';
import { clear, fmtSecs, fmtTokens, h, icon } from '../dom.ts';
import { md } from '../md.ts';
import { notify, state, subscribe, type Entry, type Task } from '../store.ts';
import { AGENT_NAME } from './data.ts';
import { shortModel, tierBadge } from './stage.ts';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const VERDICT_ICON = { accept: Check, redo: Redo2, escalate: TrendingUp } as const;
const VERDICT_LABEL = { accept: 'Accepted', redo: 'Redo', escalate: 'Escalate', working: 'Working', returned: 'Awaiting review', failed: 'Failed' } as const;

export function mountDrawer(el: HTMLElement) {
  const tTranscript = h('button', { class: 'tab', role: 'tab', id: 'tab-transcript', 'aria-controls': 'feed' }, 'Transcript');
  const tTasks = h('button', { class: 'tab', role: 'tab', id: 'tab-tasks', 'aria-controls': 'feed' });
  const collapse = h('button', { class: 'icon-btn', title: 'Hide side panel', 'aria-label': 'Hide side panel', onclick: () => document.getElementById('app')!.classList.add('drawer-collapsed') }, icon(PanelRightClose, 16));
  const feed = h('div', { class: 'feed', id: 'feed', role: 'tabpanel' });
  el.append(h('div', { class: 'tabs', role: 'tablist' }, tTranscript, tTasks, h('span', { class: 'grow' }), collapse), feed);
  tTranscript.addEventListener('click', () => { state.drawerTab = 'transcript'; notify('drawer'); });
  tTasks.addEventListener('click', () => { state.drawerTab = 'tasks'; notify('drawer'); });

  let rendered = 0;          // transcript entries already in the DOM (append-only)
  const openOutputs = new Set<string>();

  let shown: Entry[] = [];   // the entry objects currently in the DOM, in order
  const nearBottom =() => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

  const renderTabs = () => {
    tTranscript.setAttribute('aria-selected', String(state.drawerTab === 'transcript'));
    tTasks.setAttribute('aria-selected', String(state.drawerTab === 'tasks'));
    const n = state.tasks.size;
    clear(tTasks, 'Tasks', n ? h('span', { class: 'count num' }, String(n)) : null);
  };

  const renderTranscript = (full: boolean) => {
    if (full || rendered > state.entries.length || feed.dataset.view !== 'transcript') {
      feed.dataset.view = 'transcript'; rendered = 0; feed.replaceChildren();
    }
    if (!state.entries.length) {
      clear(feed, h('div', { class: 'feed-empty' }, h('strong', null, 'Nothing here yet'),
        'Give the chair a task. Its thinking, the work it hands out and its reviews appear here.'));
      rendered = 0;
      return;
    }
    if (rendered === 0) { feed.replaceChildren(); shown = []; }
    // an entry that was replaced (e.g. the chair's last message folded into the answer) re-renders from there
    let diverge = 0;
    while (diverge < rendered && shown[diverge] === state.entries[diverge]) diverge++;
    if (diverge < rendered) { while (feed.children.length > diverge) feed.lastElementChild!.remove(); shown.length = diverge; rendered = diverge; }
    const stick = nearBottom() || rendered === 0;
    for (; rendered < state.entries.length; rendered++) { feed.append(entry(state.entries[rendered])); shown.push(state.entries[rendered]); }
    if (stick) feed.scrollTop = feed.scrollHeight;
  };

  const renderTasks = () => {
    feed.dataset.view = 'tasks';
    const scroll = feed.scrollTop;
    const filter = state.focusAgent;
    const all = [...state.tasks.values()].reverse();
    const list = filter ? all.filter((t) => t.agent === filter) : all;
    const chip = (a: WorkerId | null, label: string) => h('button', {
      class: 'filter', 'aria-pressed': String(filter === a), 'data-agent': a ?? undefined,
      onclick: () => { state.focusAgent = a; notify('drawer'); },
    }, a ? h('span', { class: 'sw' }) : null, label, h('span', { class: 'num', style: 'color:var(--text-3)' }, String(a ? all.filter((t) => t.agent === a).length : all.length)));
    clear(feed,
      h('div', { class: 'filters' }, chip(null, 'All'), chip('codex', 'Codex'), chip('antigravity', 'Antigravity'), chip('claude', 'Claude')),
      list.length ? list.map((t) => taskCard(t, openOutputs)) : h('div', { class: 'feed-empty' }, h('strong', null, filter ? `No ${AGENT_NAME[filter]} tasks yet` : 'No tasks yet'),
        'When the chair hands out work, each task shows up here with its tier, live output and verdict.'));
    feed.scrollTop = scroll;
  };

  subscribe((t) => {
    if (t === 'drawer') {
      renderTabs();
      if (state.drawerTab === 'tasks') renderTasks(); else renderTranscript(true);
    }
    if (t === 'tasks') { renderTabs(); if (state.drawerTab === 'tasks') renderTasks(); }
    if (t === 'entries' && state.drawerTab === 'transcript') renderTranscript(false);
  });
  renderTabs(); renderTranscript(true);
}

function who(agent: Task['agent'] | 'chair' | 'you', label: string, ts?: number) {
  return h('div', { class: 'e-who', 'data-agent': agent === 'you' ? undefined : agent }, agent === 'you' ? null : h('span', { class: 'sw' }), label, ts ? h('time', null, time(ts)) : null);
}

function entry(e: Entry): HTMLElement {
  switch (e.kind) {
    case 'user':
      return h('div', { class: 'e e-user' }, who('you', 'You', e.ts), h('div', { class: 'prose' }, e.text));
    case 'history':
      return e.role === 'user'
        ? h('div', { class: 'e e-user' }, who('you', 'You'), h('div', { class: 'prose', html: md(e.text) }))
        : h('div', { class: 'e' }, who('chair', 'Claude'), h('div', { class: 'prose', html: md(e.text) }));
    case 'chair':
      return h('div', { class: 'e' }, who('chair', 'Claude', e.ts), h('div', { class: 'prose', html: md(e.text) }));
    case 'tool':
      return h('div', { class: 'e e-tool', title: e.text }, icon(Terminal, 13), h('span', null, e.text));
    case 'dispatch': {
      const t = state.tasks.get(e.taskId)!;
      return h('div', { class: 'e e-row', 'data-agent': t.agent },
        icon(ArrowUpRight, 16, 'ic'),
        h('div', null, h('div', { class: 'title' }, `To ${AGENT_NAME[t.agent]}`, tierBadge(t),
          t.checks ? h('span', { class: 'verdict xcheck' }, icon(ShieldCheck, 12), `Cross-check of ${t.checks}`) : t.write ? null : h('span', { class: 'verdict working' }, 'read-only')),
          h('div', { class: 'sub' }, t.brief)),
        h('span', { class: 'meta num' }, `${t.id} · ${time(e.ts)}`));
    }
    case 'return': {
      const t = state.tasks.get(e.taskId)!;
      const failed = t.status === 'failed';
      const meta = [t.secs !== undefined ? fmtSecs(t.secs) : '', t.tokens ? `${fmtTokens(t.tokens)} tok` : '', t.costUsd ? `$${t.costUsd.toFixed(3)}` : ''].filter(Boolean).join(' · ');
      return h('div', { class: `e e-row${failed ? ' fail' : ''}`, 'data-agent': t.agent },
        failed ? icon(AlertTriangle, 16, 'ic') : icon(ArrowDownLeft, 16, 'ic'),
        h('div', null,
          h('div', { class: 'title' }, failed ? `${AGENT_NAME[t.agent]} failed` : `${AGENT_NAME[t.agent]} returned ${t.id}`),
          failed ? h('div', { class: 'sub', style: 'color:var(--danger)' }, t.error ?? '') : h('div', { class: 'sub' }, resultLine(t.output)),
          t.output ? h('details', null, h('summary', null, 'Full output'), h('div', { class: 'mono-out' }, t.output)) : null),
        h('span', { class: 'meta num' }, meta));
    }
    case 'review': {
      const t = state.tasks.get(e.taskId);
      return h('div', { class: 'e e-row', 'data-agent': t?.agent ?? 'chair' },
        icon(CornerUpLeft, 16, 'ic'),
        h('div', null, h('div', { class: 'title' }, verdictChip(e.verdict), t ? `${t.id} from ${AGENT_NAME[t.agent]}` : e.taskId, ...checkedBy(e.taskId)), h('div', { class: 'sub' }, e.text)),
        h('span', { class: 'meta num' }, time(e.ts)));
    }
    case 'final':
      return h('div', { class: 'e e-final' }, who('chair', 'Answer', e.ts), h('div', { class: 'prose', html: md(e.text) }),
        h('div', { class: 'foot num' },
          e.ms ? h('span', null, `Took ${fmtSecs(Math.round(e.ms / 1000))}`) : null,
          e.costUsd !== undefined ? h('span', null, `Chair $${e.costUsd.toFixed(3)}`) : null,
          h('span', null, `${[...state.tasks.values()].filter((t) => t.runId === state.runId).length} delegated`)));
    case 'error':
      return h('div', { class: 'e e-error', role: 'alert' }, e.text);
    case 'notice':
      return h('div', { class: 'e e-notice' }, e.text);
  }
}

/** "Cross-checked by Sonnet" chips for every task that reviewed this one */
function checkedBy(taskId: string) {
  return [...state.tasks.values()].filter((c) => c.checks === taskId).map((c) =>
    h('span', { class: 'verdict xcheck', title: `${c.id} reviewed this read-only` }, icon(ShieldCheck, 12), `Cross-checked by ${c.agent === 'claude' ? shortModel(c.model) : AGENT_NAME[c.agent]}`));
}

function verdictChip(v: keyof typeof VERDICT_LABEL) {
  const ic = (VERDICT_ICON as Record<string, typeof Check>)[v];
  return h('span', { class: `verdict ${v}` }, ic ? icon(ic, 12) : null, VERDICT_LABEL[v]);
}

/** The RESULT: line workers are asked to end with, else the first meaningful line. */
function resultLine(out: string) {
  const m = out.match(/RESULT:\s*(.+)/i);
  return (m?.[1] ?? out.trim().split('\n').find((l) => l.trim()) ?? '').slice(0, 300);
}

function taskCard(t: Task, open: Set<string>) {
  const elapsed = t.secs ?? Math.round((Date.now() - t.startedAt) / 1000);
  const details = t.output ? h('details', { open: open.has(t.id) }, h('summary', { style: 'font-size:11.5px;color:var(--text-3);margin-top:8px' }, 'Full output'), h('div', { class: 'mono-out' }, t.output)) : null;
  details?.addEventListener('toggle', () => { (details as HTMLDetailsElement).open ? open.add(t.id) : open.delete(t.id); });
  return h('div', { class: 'task', 'data-agent': t.agent },
    h('div', { class: 'top' }, h('span', { class: 'sw' }), h('span', { class: 'who' }, AGENT_NAME[t.agent]), tierBadge(t), h('span', { class: 'grow' }), ...checkedBy(t.id), verdictChip(t.status)),
    t.checks ? h('div', { class: 'reason' }, icon(ShieldCheck, 12), ` Cross-check of ${t.checks}`) : null,
    h('div', { class: 'brief' }, t.brief),
    t.status === 'working' && t.live ? h('div', { class: 'live' }, t.live.slice(-700)) : null,
    t.status === 'working' && t.lastTool ? h('div', { class: 'tool' }, t.lastTool) : null,
    t.error ? h('div', { class: 'reason', style: 'color:var(--danger)' }, t.error) : null,
    t.reason ? h('div', { class: 'reason' }, t.reason) : null,
    details,
    h('div', { class: 'foot num' }, h('span', null, t.id), h('span', null, shortModel(t.model)), h('span', null, fmtSecs(elapsed)),
      t.tokens ? h('span', null, `${fmtTokens(t.tokens)} tok`) : null, t.costUsd ? h('span', null, `$${t.costUsd.toFixed(3)}`) : null,
      t.write ? null : h('span', null, 'read-only')));
}
