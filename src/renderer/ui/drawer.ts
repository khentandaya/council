import { AlertTriangle, ArrowDownLeft, ListChecks, ArrowUpRight, Check, CornerUpLeft, PanelRightClose, Redo2, ShieldCheck, Sparkles, Terminal, TrendingUp } from 'lucide';
import type { WorkerId } from '../../shared/types.ts';
import { clear, fmtSecs, fmtTokens, h, icon } from '../dom.ts';
import { md } from '../md.ts';
import { notify, state, subscribe, type Entry, type Plan, type Task } from '../store.ts';
import { AGENT_NAME } from './data.ts';
import { shortModel, tierBadge } from './stage.ts';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const VERDICT_ICON = { accept: Check, redo: Redo2, escalate: TrendingUp } as const;
const VERDICT_LABEL = { accept: 'Accepted', redo: 'Redo', escalate: 'Escalate', working: 'Working', returned: 'Awaiting review', failed: 'Failed' } as const;

export function mountDrawer(el: HTMLElement) {
  const tTranscript = h('button', { class: 'tab', role: 'tab', id: 'tab-transcript', 'aria-controls': 'feed' }, 'Transcript');
  const tTasks = h('button', { class: 'tab', role: 'tab', id: 'tab-tasks', 'aria-controls': 'feed' });
  const tHandoff = h('button', { class: 'tab', role: 'tab', id: 'tab-handoff', 'aria-controls': 'feed', hidden: true }, 'Handoff');
  const collapse = h('button', { class: 'icon-btn', title: 'Hide side panel', 'aria-label': 'Hide side panel', onclick: () => document.getElementById('app')!.classList.add('drawer-collapsed') }, icon(PanelRightClose, 16));
  const feed = h('div', { class: 'feed', id: 'feed', role: 'tabpanel' });
  el.append(h('div', { class: 'tabs', role: 'tablist' }, tTranscript, tTasks, tHandoff, h('span', { class: 'grow' }), collapse), feed);
  tTranscript.addEventListener('click', () => { state.drawerTab = 'transcript'; notify('drawer'); });
  tTasks.addEventListener('click', () => { state.drawerTab = 'tasks'; notify('drawer'); });
  tHandoff.addEventListener('click', () => { state.drawerTab = 'handoff'; notify('drawer'); });

  let rendered = 0;          // transcript entries already in the DOM (append-only)
  const openOutputs = new Set<string>();

  let shown: Entry[] = [];   // the entry objects currently in the DOM, in order
  const nearBottom =() => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

  const renderTabs = () => {
    tTranscript.setAttribute('aria-selected', String(state.drawerTab === 'transcript'));
    tTasks.setAttribute('aria-selected', String(state.drawerTab === 'tasks'));
    tHandoff.hidden = !state.workerHandoff;
    tHandoff.setAttribute('aria-selected', String(state.drawerTab === 'handoff'));
    feed.setAttribute('aria-labelledby', `tab-${state.drawerTab}`);
    const n = state.tasks.size;
    clear(tTasks, 'Tasks', n ? h('span', { class: 'count num' }, String(n)) : null);
  };

  const renderHandoff = () => {
    const { session, output } = state.workerHandoff!;
    feed.dataset.view = 'handoff';
    const head = h('div', { class: 'handoff-head', 'data-agent': session.agent },
      who(session.agent, `${AGENT_NAME[session.agent]} · ${session.taskId.toUpperCase()}`, session.ts),
      h('div', { class: 'handoff-meta' }, tierBadge(session),
        h('span', { class: `verdict ${session.ok ? 'accept' : 'failed'}` }, session.ok ? 'Done' : 'Failed'),
        h('span', { class: 'sid', title: session.sessionId }, session.sessionId.startsWith('handoff:') ? 'no session ID' : session.sessionId.slice(0, 8)),
        h('button', { class: 'btn sm', onclick: () => { state.drawerTab = 'transcript'; notify('drawer'); } }, icon(CornerUpLeft, 13), 'Transcript')));
    clear(feed, head,
      output ? h('div', { class: 'prose handoff-output', html: md(output) }) : h('div', { class: 'feed-empty', role: 'status' },
        output === undefined ? 'Loading handoff…' : output === null ? 'Handoff is unavailable.' : 'This handoff has no output.'));
    feed.scrollTop = 0;
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
      if (state.drawerTab === 'handoff') renderHandoff();
      else if (state.drawerTab === 'tasks') renderTasks(); else renderTranscript(true);
    }
    if (t === 'tasks') { renderTabs(); if (state.drawerTab === 'tasks') renderTasks(); else if (state.drawerTab === 'transcript') refreshPlanCards(); }
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
          h('span', null, `${[...state.tasks.values()].filter((t) => t.runId === state.runId).length} delegated`),
          skillsUsed().length ? h('span', { title: skillsUsed().join(', ') }, `${skillsUsed().length} skill${skillsUsed().length > 1 ? 's' : ''}: ${skillsUsed().join(', ')}`) : null));
    case 'error':
      return h('div', { class: 'e e-error', role: 'alert' }, e.text);
    case 'notice':
      return h('div', { class: 'e e-notice' }, e.text);
    case 'plan':
      return planCard(e.plan);
    case 'skill': {
      const t = e.taskId ? state.tasks.get(e.taskId) : undefined;
      const who = e.agent === 'chair' ? 'Claude (chair)' : `${AGENT_NAME[e.agent]}${t ? ` · ${e.taskId}` : ''}`;
      return h('div', { class: 'e e-skill', 'data-agent': e.agent }, icon(Sparkles, 13, 'ic'),
        h('span', { class: 'skill-chip' }, e.name), h('span', { class: 'by' }, `loaded by ${who}`), h('time', { class: 'num' }, time(e.ts)));
    }
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
    t.skills.length ? h('div', { class: 'skills' }, icon(Sparkles, 12), t.skills.map((n) => h('span', { class: 'skill-chip' }, n))) : null,
    t.error ? h('div', { class: 'reason', style: 'color:var(--danger)' }, t.error) : null,
    t.reason ? h('div', { class: 'reason' }, t.reason) : null,
    details,
    h('div', { class: 'foot num' }, h('span', null, t.id), h('span', null, shortModel(t.model)), h('span', null, fmtSecs(elapsed)),
      t.tokens ? h('span', null, `${fmtTokens(t.tokens)} tok`) : null, t.costUsd ? h('span', null, `$${t.costUsd.toFixed(3)}`) : null,
      t.write ? null : h('span', null, 'read-only')));
}

/** Distinct skills loaded in this conversation, in first-use order. */
function skillsUsed(): string[] {
  return [...new Set(state.entries.filter((e): e is Extract<Entry, { kind: 'skill' }> => e.kind === 'skill').map((e) => e.name))];
}

// ---------------------------------------------------------------- plan card
type StepStatus = 'planned' | Task['status'];
const STEP_LABEL: Record<StepStatus, string> = {
  planned: 'Planned', working: 'Working', returned: 'Awaiting review', failed: 'Failed', accept: 'Accepted', redo: 'Redo', escalate: 'Escalate',
};

/** A step's status is its latest task's (cross-checks don't count), or "planned" until dispatched. */
function stepStatus(stepId: string): { status: StepStatus; task?: Task } {
  const ts = [...state.tasks.values()].filter((t) => t.step === stepId && !t.checks);
  const t = ts[ts.length - 1];
  return t ? { status: t.status, task: t } : { status: 'planned' };
}

const planCards = new Map<HTMLElement, Plan>();

function planCard(plan: Plan): HTMLElement {
  const el = h('div', { class: 'e e-plan' });
  planCards.set(el, plan);
  fillPlan(el, plan);
  return el;
}

function fillPlan(el: HTMLElement, plan: Plan) {
  const latest = state.plan?.rev === plan.rev && state.plan.ts === plan.ts;
  const done = plan.steps.filter((s) => stepStatus(s.id).status === 'accept').length;
  clear(el,
    h('div', { class: 'plan-head' }, icon(ListChecks, 15), h('span', { class: 't' }, plan.rev > 1 ? `Plan, revision ${plan.rev}` : 'Plan'),
      h('span', { class: 'n num' }, latest ? `${done}/${plan.steps.length} accepted` : 'superseded'), h('time', { class: 'num' }, time(plan.ts))),
    plan.summary ? h('div', { class: 'plan-sum' }, plan.summary) : null,
    h('ol', { class: `plan-steps${latest ? '' : ' old'}` }, plan.steps.map((s) => {
      const { status, task } = stepStatus(s.id);
      return h('li', { class: `step ${status}`, 'data-agent': s.agent },
        h('span', { class: 'sid num' }, s.id),
        h('div', { class: 'body' },
          h('div', { class: 'goal' }, s.goal),
          h('div', { class: 'meta' }, h('span', { class: 'sw' }), AGENT_NAME[s.agent], tierBadge({ tier: s.tier, model: task?.model ?? '' }, true),
            s.write ? null : h('span', null, 'read-only'),
            s.depends_on?.length ? h('span', null, `after ${s.depends_on.join(', ')}`) : null),
          h('div', { class: 'why' }, s.why)),
        latest ? h('span', { class: `verdict ${status === 'planned' ? 'planned' : status}` }, STEP_LABEL[status]) : null);
    })));
}

function refreshPlanCards() {
  for (const [el, plan] of planCards) {
    if (!el.isConnected) { planCards.delete(el); continue; }
    fillPlan(el, plan);
  }
}
