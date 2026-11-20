import { ArrowUp, Check, ChevronDown, ShieldAlert, Square } from 'lucide';
import type { AgentId, WorkerId } from '../../shared/types.ts';
import { clear, fmtTokens, h, icon, popover } from '../dom.ts';
import { notify, state, subscribe, type Task } from '../store.ts';
import { AGENT_NAME } from './data.ts';

const api = window.council;
const WORKERS: WorkerId[] = ['codex', 'antigravity', 'claude'];

export function pips(tier: number) {
  return h('span', { class: 'pips', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { class: i <= tier ? 'on' : '' })));
}
export function tierBadge(t: Pick<Task, 'tier' | 'model'>, compact = false) {
  return h('span', { class: 'tier-badge', title: `Tier ${t.tier}: ${t.model}` }, pips(t.tier), `T${t.tier}`,
    compact ? null : h('span', { style: 'font-weight:500;opacity:.85' }, shortModel(t.model)));
}
export function shortModel(m: string) {
  return m.replace(/^gemini-/, '').replace(/^claude-/, '').replace(/^codex-/, 'effort ');
}

// ---------- ledger: who's doing what, quality, spend ----------
export function mountLedger(el: HTMLElement) {
  const cols = new Map<AgentId, HTMLElement>();
  const chair = h('div', { class: 'lg', 'data-agent': 'chair' });
  cols.set('chair', chair);
  el.append(chair);
  for (const a of WORKERS) {
    const b = h('button', {
      class: 'lg', 'data-agent': a, title: `Show ${AGENT_NAME[a]} tasks`,
      onclick: () => { state.focusAgent = state.focusAgent === a ? null : a; state.drawerTab = 'tasks'; document.getElementById('app')!.classList.remove('drawer-collapsed'); notify('drawer'); },
    });
    cols.set(a, b); el.append(b);
  }

  const render = () => {
    const sp = state.spend.chair;
    const chairNow = !state.running ? (state.entries.length ? 'Ready for a follow-up' : 'Waiting for your prompt')
      : ({ idle: 'Working', thinking: 'Thinking it through', writing: 'Writing', waiting: 'Waiting on workers', reviewing: 'Reviewing a return' } as const)[state.chair];
    const allCost = sp.costUsd + state.spend.claude.costUsd;
    const sentBack = state.spend.codex.redo + state.spend.antigravity.redo + state.spend.claude.redo;
    const xchecks = [...state.tasks.values()].filter((t) => t.checks).length;
    chair.classList.toggle('busy', state.running);
    clear(chair,
      h('div', { class: 'head' }, h('span', { class: 'sw' }), 'Claude', h('span', { class: 'role', style: 'color:var(--text-3);font-weight:500' }, 'chair'),
        state.chairModel ? h('span', { class: 'tier-badge tier' }, shortModel(state.chairModel)) : null),
      h('div', { class: 'now' }, chairNow),
      h('div', { class: 'stats num' },
        h('span', { title: 'Claude spend this conversation (chair + Claude workers)' }, h('b', null, `$${allCost.toFixed(2)}`)),
        h('span', { title: 'Returns the chair accepted' }, h('b', null, String(reviews('accept'))), ' ok'),
        h('span', { class: sentBack ? 'warn' : '', title: 'Returns sent back for a redo or a higher tier' }, h('b', null, String(sentBack)), ' redo'),
        h('span', { title: 'Returns checked by a different agent' }, h('b', null, String(xchecks)), ' x-check')));

    for (const a of WORKERS) {
      const el = cols.get(a)!;
      const s = state.spend[a];
      const working = [...state.tasks.values()].filter((t) => t.agent === a && t.status === 'working');
      const lead = working.sort((x, y) => y.tier - x.tier)[0];
      el.classList.toggle('busy', !!lead);
      el.classList.toggle('focus', state.focusAgent === a);
      const now = lead ? (lead.lastTool || firstLine(lead.live) || firstLine(lead.brief)) : s.tasks ? 'Idle' : 'No tasks yet';
      clear(el,
        h('div', { class: 'head' }, h('span', { class: 'sw' }), AGENT_NAME[a], lead ? h('span', { class: 'tier' }, tierBadge(lead, true)) : null),
        h('div', { class: 'now', title: now }, lead ? `${shortModel(lead.model)} · ` : '', working.length > 1 ? `${working.length} tasks · ${now}` : now),
        h('div', { class: 'stats num' },
          h('span', { title: 'Tasks returned / handed out' }, h('b', null, `${s.done}/${s.tasks}`), h('span', { class: 'lbl' }, ' done')),
          h('span', { class: s.redo ? 'warn' : '', title: 'Returns sent back for a redo or a higher tier' }, h('b', null, String(s.redo)), ' redo'),
          h('span', { title: a === 'claude' ? `tokens reported by Claude; $${s.costUsd.toFixed(3)}, included in the chair's total` : 'tokens reported by the CLI (no dollar figure is reported)' }, h('b', null, fmtTokens(s.tokens)), ' tok')));
    }
  };
  const reviews = (v: string) => [...state.tasks.values()].filter((t) => t.status === v).length;
  subscribe((t) => { if (t === 'tasks' || t === 'spend' || t === 'run' || t === 'drawer' || t === 'entries') render(); });
  render();
}
const firstLine = (s: string) => s.trim().split('\n').filter(Boolean).pop()?.slice(0, 140) ?? '';

// ---------- dock: permission requests ----------
export function mountDock(el: HTMLElement) {
  subscribe((t) => {
    if (t !== 'permissions') return;
    clear(el, state.permissions.map((p) => h('div', { class: 'perm', role: 'alertdialog', 'aria-label': 'Approval needed' },
      icon(ShieldAlert, 18, 'ic'),
      h('div', { class: 'what' }, h('div', { class: 'k' }, `Claude wants to use ${p.toolName}`), h('code', { title: p.summary }, p.summary)),
      h('div', { class: 'acts' },
        h('button', { class: 'btn sm ghost', onclick: () => api.answerPermission(p.id, false, false) }, 'Deny'),
        h('button', { class: 'btn sm', title: `Allow every ${p.toolName} call for the rest of this run`, onclick: () => api.answerPermission(p.id, true, true) }, `Always allow ${p.toolName}`),
        h('button', { class: 'btn sm primary', onclick: () => api.answerPermission(p.id, true, false) }, 'Allow once')))));
    (el.querySelector('.btn.primary') as HTMLElement | null)?.focus();
  });
}

// ---------- prompt bar ----------
const MODELS = [['opus', 'Opus'], ['sonnet', 'Sonnet']] as const;
const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

export function mountPromptbar(el: HTMLElement) {
  const ta = h('textarea', { rows: 1, 'aria-label': 'Prompt for the council', spellcheck: true });
  const chairChip = h('button', { class: 'chip', 'aria-haspopup': 'menu', title: 'Chair model and effort' });
  const ctx = h('span', { class: 'hint' });
  const send = h('button', { class: 'btn primary send', 'aria-label': 'Send to the chair', title: 'Send (Enter)' }, icon(ArrowUp, 17));
  const stop = h('button', { class: 'btn send stop danger', title: 'Stop the run (Esc while typing here)', style: 'display:none' }, icon(Square, 12), 'Stop');
  el.append(h('div', { class: 'composer' }, ta, h('div', { class: 'row' }, chairChip, ctx, h('span', { class: 'grow' }), h('span', { class: 'hint' }, h('span', { class: 'kbd' }, 'Shift'), '+', h('span', { class: 'kbd' }, 'Enter'), 'new line', h('span', { style: 'width:8px' }), h('span', { class: 'kbd' }, 'Ctrl'), '+', h('span', { class: 'kbd' }, 'K'), 'focus'), send, stop)));

  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`; };
  ta.addEventListener('input', () => { grow(); render(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && state.running) { e.preventDefault(); api.stop(); }
  });
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ta.focus(); } });
  send.addEventListener('click', submit);
  stop.addEventListener('click', () => api.stop());

  async function submit() {
    const text = ta.value.trim();
    if (!text || state.running || !state.config?.currentFolder) return;
    ta.value = ''; grow();
    try { await api.run(text, state.resumeId); }
    catch (err) {
      state.entries.push({ kind: 'error', text: String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), ts: Date.now() });
      ta.value = text; notify('entries');
    }
  }

  chairChip.addEventListener('click', () => {
    const c = state.config!;
    const set = async (patch: Partial<typeof c>) => { close(); state.config = await api.setConfig(patch); notify('config'); };
    const close = popover(chairChip, h('div', null,
      h('div', { class: 'menu-label' }, 'Chair model'),
      ...MODELS.map(([id, name]) => h('button', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': c.chairModel === id, onclick: () => set({ chairModel: id }) },
        h('span', { class: 'grow' }, h('span', { class: 'main' }, name), h('span', { class: 'sub' }, id === 'opus' ? 'Best judgment for planning and review' : 'Cheaper chair for routine work')),
        c.chairModel === id ? icon(Check, 15, 'check') : null)),
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'menu-label' }, 'Chair effort'),
      ...EFFORTS.map((ef) => h('button', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': c.chairEffort === ef, onclick: () => set({ chairEffort: ef }) },
        h('span', { class: 'grow' }, ef[0].toUpperCase() + ef.slice(1)), c.chairEffort === ef ? icon(Check, 15, 'check') : null)),
    ));
  });

  const render = () => {
    const c = state.config;
    const noFolder = !c?.currentFolder;
    ta.disabled = noFolder;
    ta.placeholder = noFolder ? 'Open a folder first, then give the council a task' : state.running ? 'The council is working. Press Esc or Stop to end the run.' : state.resumeId ? 'Follow up with the chair…' : 'What should the council work on?';
    send.style.display = state.running ? 'none' : '';
    stop.style.display = state.running ? '' : 'none';
    send.disabled = noFolder || !ta.value.trim();
    if (c) clear(chairChip, h('span', { class: 'sw' }), `Chair · ${c.chairModel[0].toUpperCase()}${c.chairModel.slice(1)} · ${c.chairEffort}`, icon(ChevronDown, 13));
    ctx.textContent = state.resumeId ? (state.sessionTitle ? `Continuing "${state.sessionTitle.slice(0, 48)}${state.sessionTitle.length > 48 ? '…' : ''}"` : 'Continuing this session') : 'New session';
  };
  subscribe((t) => { if (t === 'config' || t === 'run' || t === 'sessions') render(); });
  render();
}
