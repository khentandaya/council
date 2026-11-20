import type { WorkerId } from '../../shared/types.ts';
import { clear, h } from '../dom.ts';
import { notify, state } from '../store.ts';
import { shortModel } from '../ui/stage.ts';
import { deskX, Office, ROOMS, TANK_GAP, TANK_H, TANK_W, TANKS, type TankRoom } from './scene.ts';
import { fmtReset } from '../ui/data.ts';
import { fmtTokens } from '../dom.ts';
import type { UsageWindow } from '../../shared/types.ts';

const SIGNS: { text: string; x: number; y: number; agent?: string; align?: 'left' | 'center' }[] = [
  { text: 'TASK BOARD', x: 56, y: 12, align: 'center' },
  { text: 'RESULTS', x: 304, y: 51, align: 'center' },
  { text: 'CODEX LAB', x: ROOMS.codex.x + 4, y: 151, agent: 'codex', align: 'left' },
  { text: 'ANTIGRAVITY', x: ROOMS.antigravity.x + 4, y: 151, agent: 'antigravity', align: 'left' },
  { text: 'CLAUDE BULLPEN', x: ROOMS.claude.x + 4, y: 151, agent: 'claude', align: 'left' },
];

/** Re-renders the open usage card when fresh numbers arrive (set once the overlay mounts). */
let refreshCard = () => {};
export function refreshUsageCard() { refreshCard(); }

/** Desk plaques have ~10 characters: gemini-3.8-flash-low -> FLASH-LOW, codex-medium -> EFFORT MED */
function deskModel(m: string) {
  return shortModel(m).replace(/^[\d.]+-/, '').replace(/medium/, 'med').toUpperCase().slice(0, 10);
}

/** DOM layer over the canvas: pixel-font signage at whole-pixel sizes, speech bubbles, click targets. */
export function mountOverlay(root: HTMLElement, office: Office) {
  const signs = SIGNS.map((s) => {
    const el = h('div', { class: 'o-label', 'data-agent': s.agent }, s.text);
    if (s.align === 'left') el.style.transform = 'none';
    if (!s.agent) el.style.color = '#b2aea5';
    root.append(el);
    return { s, el };
  });
  const deskLabels = office.deskInfo().map((d) => {
    const el = h('div', { class: 'o-desk', 'data-agent': d.agent });
    root.append(el);
    return { d, el };
  });
  const hits = (['chair', 'codex', 'antigravity', 'claude'] as const).map((a) => {
    const el = h('div', { class: 'o-hit', 'data-agent': a, title: a === 'chair' ? 'Show transcript' : `Show ${a} tasks` });
    el.addEventListener('click', () => {
      if (a === 'chair') { state.drawerTab = 'transcript'; state.focusAgent = null; }
      else { state.drawerTab = 'tasks'; state.focusAgent = a as WorkerId; }
      document.getElementById('app')!.classList.remove('drawer-collapsed');
      notify('drawer');
    });
    root.append(el);
    return { a, el };
  });
  const bubbleEls = new Map<string, HTMLElement>();

  // usage tanks: a hover card with the full reading
  let openRoom: TankRoom | null = null, openAnchor: HTMLElement | null = null;
  refreshCard = () => { if (openRoom && openAnchor) { fillCard(openRoom); placeCard(openAnchor); } };
  const card = h('div', { class: 'usage-card', role: 'tooltip' });
  card.hidden = true;
  const tankHits = TANKS.map((t) => {
    const el = h('div', { class: 'o-tank', 'data-agent': t.room, tabindex: '0', 'aria-label': `Plan usage for ${t.room}` });
    const show = () => { openRoom = t.room; openAnchor = el; fillCard(t.room); placeCard(el); card.hidden = false; };
    const hide = () => { card.hidden = true; openRoom = null; };
    el.addEventListener('mouseenter', show); el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide);
    root.append(el);
    return { t, el };
  });
  root.append(card);

  const fillCard = (room: TankRoom) => {
    const u = office.usageFor(room);
    const name = room === 'codex' ? 'Codex' : room === 'antigravity' ? 'Antigravity' : 'Claude';
    const row = (label: string, w?: UsageWindow) => {
      if (!w) return h('div', { class: 'u-row' }, h('span', { class: 'u-k' }, label), h('span', { class: 'u-none' }, 'not reported'));
      const left = Math.max(0, 100 - w.usedPct);
      const lvl = left <= 10 ? 'hot' : left <= 25 ? 'warm' : '';
      return h('div', { class: `u-row ${lvl}` }, h('span', { class: 'u-k' }, label),
        h('span', { class: 'u-bar' }, h('span', { style: `width:${Math.min(100, w.usedPct)}%` })),
        h('span', { class: 'u-v num' }, `${Math.round(w.usedPct)}% used`),
        h('span', { class: 'u-reset' }, fmtReset(w.resetsAt)));
    };
    const measured = room === 'antigravity' ? state.spend.antigravity.tokens : 0;
    clear(card,
      h('div', { class: 'u-head', 'data-agent': room }, h('span', { class: 'sw' }), `${name} plan`, u?.plan ? h('span', { class: 'u-plan' }, u.plan) : null),
      ...(u?.available ? [row('5-hour', u.fiveHour), row('Weekly', u.weekly)] : []),
      u && !u.available ? h('div', { class: 'u-note' }, u.note ?? 'Not reported.') : null,
      !u ? h('div', { class: 'u-note' }, 'Reading usage…') : null,
      room === 'antigravity' ? h('div', { class: 'u-note num' }, `Measured this conversation: ${fmtTokens(measured)} tokens.`) : null,
      room === 'chair' || room === 'claude' ? h('div', { class: 'u-foot' }, 'The chair and Claude workers share this account.') : null,
      u?.available && u.note ? h('div', { class: 'u-foot' }, u.note) : null,
      h('div', { class: 'u-foot' }, 'Tank level = what is left. Left tank 5-hour, right tank weekly.'));
  };
  const placeCard = (anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect(), base = root.getBoundingClientRect();
    const w = 264;
    const left = Math.min(Math.max(8, r.left - base.left + r.width / 2 - w / 2), base.width - w - 8);
    card.style.left = `${left}px`;
    // above the tanks when it fits, otherwise below them
    card.hidden = false;
    const ch = card.offsetHeight;
    const above = r.top - base.top - 8 - ch >= 8;
    card.classList.toggle('below', !above);
    card.style.top = above ? `${r.top - base.top - 8}px` : `${r.bottom - base.top + 8}px`;
  };

  const layout = () => {
    const u = office.unit;
    const dpr = window.devicePixelRatio || 1;
    // pixel font only renders crisp at multiples of 8 device px
    const px = (8 * Math.max(1, Math.ceil(office.scale / 2))) / dpr;
    root.style.setProperty('--px', `${px}px`);
    root.style.setProperty('--u', `${u}px`);
    for (const { s, el } of signs) { const p = office.toCss(s.x, s.y); el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
    for (const { t, el } of tankHits) {
      const p = office.toCss(t.x - 2, t.y - 10), q = office.toCss(t.x + TANK_GAP + TANK_W + 2, t.y + TANK_H + 10);
      Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${q.x - p.x}px`, height: `${q.y - p.y}px` });
    }
    for (const { a, el } of hits) {
      const r = ROOMS[a];
      const p = office.toCss(r.x, r.y), q = office.toCss(r.x + r.w, r.y + r.h);
      Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${q.x - p.x}px`, height: `${q.y - p.y}px` });
    }
    tick();
  };

  const tick = () => {
    const info = office.deskInfo();
    deskLabels.forEach(({ el }, i) => {
      const d = info[i];
      const p = office.toCss(deskX(d.agent, d.tier) + 13, 192);
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      el.classList.toggle('on', d.on);
      const label = d.on && d.model ? `T${d.tier}\n${deskModel(d.model)}` : `T${d.tier}`;
      if (el.textContent !== label) { el.textContent = label; el.style.whiteSpace = 'pre'; }
    });
    const live = new Set<string>();
    for (const b of office.getBubbles()) {
      live.add(b.key);
      let el = bubbleEls.get(b.key);
      if (!el) { el = h('div', { class: 'o-bubble', 'data-agent': b.agent, role: 'presentation' }); bubbleEls.set(b.key, el); root.append(el); }
      if (el.textContent !== b.text) el.textContent = b.text;
      // keep the bubble inside the office walls
      const p = office.toCss(b.x, b.y);
      const lo = office.toCss(6, 0).x, hi = office.toCss(354, 0).x, half = el.offsetWidth / 2;
      el.style.left = `${Math.min(Math.max(p.x, lo + half), hi - half)}px`; el.style.top = `${p.y}px`;
    }
    for (const [k, el] of bubbleEls) if (!live.has(k)) { el.remove(); bubbleEls.delete(k); }
    for (const { a, el } of hits) el.classList.toggle('focus', state.drawerTab === 'tasks' && state.focusAgent === a);
  };

  office.onLayout = layout;
  layout();
  setInterval(tick, 200);
}
