import type { CouncilEvent, Tier, Verdict, WorkerId } from '../../shared/types.ts';
import {
  CHAIR_FRONT, CHAIR_FRONT_READ, CHAIR_FRONT_TYPE, personPal, SEATED_BACK, SEATED_BACK_TYPE, sprite,
  STAMP_ACCEPT, STAMP_ESCALATE, STAMP_REDO, WALK_A, WALK_B,
} from './sprites.ts';

// ---------------------------------------------------------------------------------------------
// World: 360 x 300 native pixels, scaled by whole steps so pixels stay square and crisp.
// Top row: task board · chair's office · results lounge. Hallway. Bottom: three worker rooms.
// ---------------------------------------------------------------------------------------------
export const W = 360, H = 300;

const AGENT_COLOR: Record<string, string> = { chair: '#f2a65a', codex: '#5fd3a8', antigravity: '#a68cff', claude: '#d9c7a3' };
const VERDICT_COLOR: Record<string, string> = { accept: '#9bd77e', redo: '#ecc94b', escalate: '#f2836e', failed: '#f2836e', returned: '#b2aea5', working: '#f2a65a' };

interface Rect { x: number; y: number; w: number; h: number }
export const ROOMS: Record<'board' | 'chair' | 'lounge' | WorkerId, Rect> = {
  board: { x: 8, y: 8, w: 96, h: 108 },
  chair: { x: 108, y: 8, w: 144, h: 108 },
  lounge: { x: 256, y: 8, w: 96, h: 108 },
  codex: { x: 8, y: 150, w: 112, h: 142 },
  antigravity: { x: 124, y: 150, w: 112, h: 142 },
  claude: { x: 240, y: 150, w: 112, h: 142 },
};
const WORKERS: WorkerId[] = ['codex', 'antigravity', 'claude'];
const HALL_Y = 139;
const CHAIR_DESK = { x: 150, y: 58, w: 60 };
const CHAIR_DOOR_X = 180;
const INTRAY = { x: 199, y: 57 };
const doorX = (a: WorkerId) => ROOMS[a].x + 100;
export const deskX = (a: WorkerId, tier: Tier) => ROOMS[a].x + 6 + tier * 30;   // desk left edge, 26 wide
const DESK_Y = 166;
const WALK_Y = 200;

// ------------------------------------------------------------------ state
type DeskState = 'idle' | 'working' | 'away';
interface Desk { agent: WorkerId; tier: Tier; state: DeskState; taskId?: string; queue: string[]; model?: string; personIdx: number }
interface Walker { kind: 'courier' | 'worker'; path: [number, number][]; seg: number; t: number; speed: number; carry?: string; pal: ReturnType<typeof personPal>; onArrive?: () => void; done?: boolean; key: string }
interface Card { taskId: string; agent: WorkerId; tier: Tier; status: string; born: number }
interface Stamp { verdict: Verdict; born: number }

export interface Bubble { key: string; text: string; x: number; y: number; agent: string; at: number }

export class Office {
  private ctx: CanvasRenderingContext2D;
  private bg = document.createElement('canvas');
  private frame = document.createElement('canvas');
  private fctx: CanvasRenderingContext2D;
  private desks = new Map<string, Desk>();
  private walkers: Walker[] = [];
  private cards: Card[] = [];
  private shelf: string[] = [];        // agent per accepted result
  private stamps: Stamp[] = [];
  private intray = 0;
  private chairMode: 'idle' | 'thinking' | 'writing' | 'waiting' | 'reviewing' = 'idle';
  private bubbles = new Map<string, Bubble>();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private raf = 0;
  private last = performance.now();
  private bgHour = -1;
  scale = 1;
  offX = 0; offY = 0;
  onLayout: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.bg.width = this.frame.width = W;
    this.bg.height = this.frame.height = H;
    this.fctx = this.frame.getContext('2d')!;
    let i = 0;
    for (const a of WORKERS) for (const t of [0, 1, 2] as Tier[]) this.desks.set(`${a}:${t}`, { agent: a, tier: t, state: 'idle', queue: [], personIdx: i++ });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.last = performance.now(); });
    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- layout
  resize() {
    const wrap = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(wrap.clientWidth * dpr), ch = Math.round(wrap.clientHeight * dpr);
    this.canvas.width = cw; this.canvas.height = ch;
    const pad = 20 * dpr;
    const fit = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H);
    this.scale = fit >= 2 ? Math.floor(fit) : Math.max(0.5, fit);
    this.offX = Math.round((cw - W * this.scale) / 2);
    this.offY = Math.round((ch - H * this.scale) / 2);
    this.onLayout();
  }
  /** world px -> CSS px within the canvas wrapper */
  toCss(x: number, y: number) { const d = window.devicePixelRatio || 1; return { x: (this.offX + x * this.scale) / d, y: (this.offY + y * this.scale) / d }; }
  get unit() { return this.scale / (window.devicePixelRatio || 1); }

  // ---------------------------------------------------------------- events
  reset() {
    for (const d of this.desks.values()) { d.state = 'idle'; d.taskId = undefined; d.queue = []; d.model = undefined; }
    this.walkers = []; this.cards = []; this.shelf = []; this.stamps = []; this.intray = 0; this.chairMode = 'idle';
    this.bubbles.clear();
  }

  handle(e: CouncilEvent) {
    const now = performance.now();
    switch (e.kind) {
      case 'run_start': this.chairMode = 'thinking'; this.say('chair', 'Let me think about this…', CHAIR_DESK.x + 30, 40, 'chair'); break;
      case 'chair_text': this.chairMode = 'writing'; this.say('chair', firstSentence(e.text ?? ''), CHAIR_DESK.x + 30, 40, 'chair'); break;
      case 'chair_tool': this.chairMode = 'thinking'; break;
      case 'dispatch': {
        const a = e.agent as WorkerId, tier = (e.tier ?? 0) as Tier;
        const desk = this.desks.get(`${a}:${tier}`)!;
        desk.model = e.model;
        this.cards.push({ taskId: e.taskId!, agent: a, tier, status: 'working', born: now });
        if (this.cards.length > 16) this.cards.shift();
        this.chairMode = 'waiting';
        const dx = deskX(a, tier) + 13;
        this.walk('courier', `c-${e.taskId}`, [[CHAIR_DOOR_X, 80], [CHAIR_DOOR_X, HALL_Y], [doorX(a), HALL_Y], [doorX(a), WALK_Y], [dx, WALK_Y]], personPal('courier', 4), AGENT_COLOR[a], () => {
          if (desk.state === 'idle') { desk.state = 'working'; desk.taskId = e.taskId; }
          else desk.queue.push(e.taskId!);
          // courier heads back to the chair's office and leaves
          this.walk('courier', `cb-${e.taskId}`, [[dx, WALK_Y], [doorX(a), WALK_Y], [doorX(a), HALL_Y], [CHAIR_DOOR_X, HALL_Y], [CHAIR_DOOR_X, 112]], personPal('courier', 4));
        });
        break;
      }
      case 'worker_text':
      case 'worker_tool': {
        const a = e.agent as WorkerId, tier = (e.tier ?? 0) as Tier;
        const t = (e.text ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
        if (t) this.say(a, t, deskX(a, tier) + 13, 149, a);   // above the room sign, in the hallway
        break;
      }
      case 'worker_done':
      case 'worker_error': {
        const a = e.agent as WorkerId, tier = (e.tier ?? 0) as Tier;
        const desk = this.desks.get(`${a}:${tier}`)!;
        const card = this.cards.find((c) => c.taskId === e.taskId);
        if (card) card.status = e.kind === 'worker_done' ? 'returned' : 'failed';
        this.bubbles.delete(a);
        const go = () => {
          desk.state = 'away';
          const dx = deskX(a, tier) + 13;
          this.walk('worker', `w-${e.taskId}`, [[dx, WALK_Y - 4], [doorX(a), WALK_Y], [doorX(a), HALL_Y], [CHAIR_DOOR_X, HALL_Y], [CHAIR_DOOR_X, 84], [INTRAY.x, 84]],
            personPal(a, desk.personIdx), e.kind === 'worker_done' ? '#efeae0' : '#f2836e', () => {
              this.intray++; this.chairMode = 'reviewing';
              this.walk('worker', `wb-${e.taskId}`, [[INTRAY.x, 84], [CHAIR_DOOR_X, 84], [CHAIR_DOOR_X, HALL_Y], [doorX(a), HALL_Y], [doorX(a), WALK_Y], [dx, WALK_Y - 4]],
                personPal(a, desk.personIdx), undefined, () => {
                  const next = desk.queue.shift();
                  desk.state = next ? 'working' : 'idle'; desk.taskId = next;
                });
            });
        };
        // the card may still be in transit; let the courier land first
        if (desk.state === 'working' && desk.taskId === e.taskId) go();
        else {
          desk.queue = desk.queue.filter((q) => q !== e.taskId);
          const wait = setInterval(() => { if (desk.taskId === e.taskId && desk.state === 'working') { clearInterval(wait); go(); } else if (!this.walkers.some((w) => w.key === `c-${e.taskId}`) && desk.taskId !== e.taskId) { clearInterval(wait); } }, 120);
        }
        break;
      }
      case 'review': {
        const card = this.cards.find((c) => c.taskId === e.taskId);
        if (card && e.verdict) card.status = e.verdict;
        if (e.verdict) this.stamps.push({ verdict: e.verdict, born: now });
        if (this.stamps.length > 3) this.stamps.shift();
        this.intray = Math.max(0, this.intray - 1);
        if (e.verdict === 'accept' && card) { this.shelf.push(card.agent); if (this.shelf.length > 28) this.shelf.shift(); }
        break;
      }
      case 'run_done': this.chairMode = 'idle'; this.intray = 0; this.say('chair', 'Done. The answer is in the panel.', CHAIR_DESK.x + 30, 40, 'chair'); break;
      case 'run_error': this.chairMode = 'idle'; this.intray = 0; this.say('chair', 'That run stopped.', CHAIR_DESK.x + 30, 40, 'chair'); break;
    }
  }

  private say(key: string, text: string, x: number, y: number, agent: string) {
    this.bubbles.set(key, { key, text: text.slice(0, 64), x, y, agent, at: performance.now() });
  }

  getBubbles(): Bubble[] {
    const now = performance.now();
    for (const [k, b] of this.bubbles) if (now - b.at > (k === 'chair' ? 6000 : 9000)) this.bubbles.delete(k);
    return [...this.bubbles.values()];
  }
  deskInfo() { return [...this.desks.values()].map((d) => ({ agent: d.agent, tier: d.tier, on: d.state !== 'idle', model: d.model })); }

  private walk(kind: Walker['kind'], key: string, path: [number, number][], pal: Walker['pal'], carry?: string, onArrive?: () => void) {
    const len = path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
    // long hops stay under ~2.4s, short ones still read as a walk
    const speed = Math.max(0.09, len / 2400);
    const w: Walker = { kind, key, path, seg: 0, t: 0, speed, pal, carry, onArrive };
    if (this.reduced) { w.done = true; queueMicrotask(() => onArrive?.()); return; }
    this.walkers.push(w);
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(64, now - this.last);
    this.last = now;
    const hour = new Date().getHours();
    if (hour !== this.bgHour) { this.bgHour = hour; drawBackground(this.bg.getContext('2d')!, hour); }
    this.update(dt);
    this.draw(now);
  };

  private update(dt: number) {
    for (const w of this.walkers) {
      let move = w.speed * dt;
      while (move > 0 && !w.done) {
        const a = w.path[w.seg], b = w.path[w.seg + 1];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.0001;
        const left = segLen * (1 - w.t);
        if (move >= left) { move -= left; w.seg++; w.t = 0; if (w.seg >= w.path.length - 1) { w.done = true; w.onArrive?.(); } }
        else { w.t += move / segLen; move = 0; }
      }
    }
    this.walkers = this.walkers.filter((w) => !w.done);
  }

  private draw(now: number) {
    const g = this.fctx;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.bg, 0, 0);
    this.drawBoard(g, now);
    this.drawShelf(g);
    this.drawWindows(g, now);
    this.drawOrb(g, now);
    this.drawServerLeds(g, now);
    this.drawChair(g, now);
    for (const d of this.desks.values()) this.drawDesk(g, d, now);
    // walkers sorted by feet for depth
    const ws = this.walkers.map((w) => ({ w, p: pos(w) })).sort((a, b) => a.p[1] - b.p[1]);
    for (const { w, p } of ws) this.drawWalker(g, w, p, now);
    this.drawStamps(g, now);

    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#0f0e0d';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.frame, this.offX, this.offY, W * this.scale, H * this.scale);
  }

  // ---------------------------------------------------------------- dynamic pieces
  private drawChair(g: CanvasRenderingContext2D, now: number) {
    const pal = personPal('chair', 0);
    pal.h = '#4a3326';
    const x = CHAIR_DESK.x + 24, y = CHAIR_DESK.y - 12;
    const bob = this.chairMode === 'idle' ? (Math.floor(now / 900) % 2) : 0;
    const map = this.chairMode === 'writing' ? (Math.floor(now / 160) % 2 ? CHAIR_FRONT_TYPE : CHAIR_FRONT)
      : this.chairMode === 'reviewing' ? CHAIR_FRONT_READ : CHAIR_FRONT;
    g.drawImage(sprite(map, pal, 'chair'), x, y + bob);
    // desk front edge redrawn over the lower body
    g.fillStyle = '#8a6a4a'; g.fillRect(CHAIR_DESK.x, CHAIR_DESK.y, CHAIR_DESK.w, 1);
    g.fillStyle = '#7a5c3f'; g.fillRect(CHAIR_DESK.x, CHAIR_DESK.y + 1, CHAIR_DESK.w, 6);
    // papers on the desk: out tray stack shows tasks in flight, in tray shows returns to review
    const out = this.walkers.filter((w) => w.kind === 'courier' && !w.key.startsWith('cb')).length;
    for (let i = 0; i < Math.min(out, 4); i++) { g.fillStyle = i % 2 ? '#d8d2c4' : '#efeae0'; g.fillRect(CHAIR_DESK.x + 4, CHAIR_DESK.y + 3 - i, 8, 1); }
    for (let i = 0; i < Math.min(this.intray, 5); i++) { g.fillStyle = i % 2 ? '#d8d2c4' : '#efeae0'; g.fillRect(INTRAY.x - 2, INTRAY.y + 4 - i, 8, 1); }
    if (this.chairMode === 'thinking' || this.chairMode === 'waiting') {
      const n = Math.floor(now / 350) % 4;
      for (let i = 0; i < 3; i++) { g.fillStyle = i < n ? '#f2a65a' : '#5a4a3a'; g.fillRect(x + 13 + i * 3, y - 3 - i, 2, 2); }
    }
  }

  private drawDesk(g: CanvasRenderingContext2D, d: Desk, now: number) {
    const x = deskX(d.agent, d.tier);
    const col = AGENT_COLOR[d.agent];
    const sx = x + 7, sy = DESK_Y - 9;
    if (d.state === 'working') {
      // the signature: an agent-coloured pool of light spills from the lit desk onto the floor
      const pulse = this.reduced ? 0 : Math.sin(now / 600 + d.personIdx) * 0.03;
      for (let r = 0; r < 4; r++) {
        g.fillStyle = withAlpha(col, 0.13 - r * 0.028 + pulse);
        g.fillRect(x - 3 + r * 2, DESK_Y + 11 + r * 4, 32 - r * 4, 4);
      }
      g.fillStyle = withAlpha(col, 0.55); g.fillRect(sx - 2, sy - 2, 16, 1); g.fillRect(sx - 2, sy + 8, 16, 1); g.fillRect(sx - 2, sy - 1, 1, 9); g.fillRect(sx + 13, sy - 1, 1, 9);
    }
    // monitor screen
    if (d.state === 'working') {
      g.fillStyle = shade(col, -0.78); g.fillRect(sx, sy, 12, 7);
      const scroll = Math.floor(now / 140);
      for (let r = 0; r < 3; r++) {
        const seed = (scroll + r * 7 + d.personIdx * 3) % 11;
        g.fillStyle = r === 2 ? col : shade(col, -0.25);
        g.fillRect(sx + 1 + (seed % 3), sy + 1 + r * 2, 3 + (seed % 7), 1);
      }
      // light spill on the desk
      g.fillStyle = withAlpha(col, 0.18); g.fillRect(x + 2, DESK_Y, 22, 3);
    } else {
      g.fillStyle = '#141210'; g.fillRect(sx, sy, 12, 7);
      g.fillStyle = '#22201c'; g.fillRect(sx + 1, sy + 1, 4, 1);
    }
    // the worker (absent while walking a result over)
    if (d.state !== 'away') {
      const pal = personPal(d.agent, d.personIdx);
      const typing = d.state === 'working' && Math.floor(now / 150 + d.personIdx) % 2 === 0;
      const bob = d.state === 'idle' ? (Math.floor(now / 1400 + d.personIdx * 0.7) % 2) : 0;
      g.drawImage(sprite(typing ? SEATED_BACK_TYPE : SEATED_BACK, pal, `${d.agent}${d.personIdx}`), x + 8, DESK_Y + 6 + bob);
    }
    // chair back with tier pips
    g.fillStyle = '#2e2b28'; g.fillRect(x + 7, DESK_Y + 13, 12, 8);
    g.fillStyle = '#403b36'; g.fillRect(x + 7, DESK_Y + 13, 12, 1);
    g.fillStyle = '#201d1a'; g.fillRect(x + 12, DESK_Y + 21, 2, 3);
    for (let i = 0; i <= 2; i++) {
      g.fillStyle = i <= d.tier ? (d.state === 'working' ? col : shade(col, -0.45)) : '#403b36';
      g.fillRect(x + 9 + i * 3, DESK_Y + 16, 2, 2);
    }
    // idle desks sink back so the lit one reads from across the room
    if (d.state === 'idle') { g.fillStyle = 'rgba(12,10,8,0.38)'; g.fillRect(x - 1, DESK_Y - 11, 28, 36); }
  }

  private drawWalker(g: CanvasRenderingContext2D, w: Walker, p: [number, number], now: number) {
    const frame = Math.floor(now / 130) % 2 ? WALK_A : WALK_B;
    const x = Math.round(p[0] - 4), y = Math.round(p[1] - 13);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + 1, y + 12, 6, 2);
    g.drawImage(sprite(frame, w.pal, w.key.slice(0, 2) + w.pal.c + w.pal.h + w.pal.s), x, y);
    if (w.carry) {
      g.fillStyle = '#efeae0'; g.fillRect(x + 1, y + 6, 6, 5);
      g.fillStyle = w.carry; g.fillRect(x + 1, y + 6, 6, 1);
      g.fillStyle = '#b9b2a4'; g.fillRect(x + 2, y + 8, 4, 1);
    }
  }

  private drawBoard(g: CanvasRenderingContext2D, now: number) {
    const bx = 16, by = 24;
    this.cards.forEach((c, i) => {
      const x = bx + (i % 4) * 20, y = by + Math.floor(i / 4) * 13;
      const fresh = now - c.born < 400 && !this.reduced ? -1 : 0;
      g.fillStyle = '#efeae0'; g.fillRect(x, y + fresh, 16, 10);
      g.fillStyle = AGENT_COLOR[c.agent]; g.fillRect(x, y + fresh, 16, 2);
      g.fillStyle = '#c8402f'; g.fillRect(x + 7, y - 1 + fresh, 2, 2);
      for (let t = 0; t <= c.tier; t++) { g.fillStyle = '#8f8b83'; g.fillRect(x + 2 + t * 3, y + 6 + fresh, 2, 2); }
      const blink = c.status === 'working' && Math.floor(now / 500) % 2;
      g.fillStyle = blink ? '#efeae0' : VERDICT_COLOR[c.status] ?? '#b2aea5';
      g.fillRect(x + 11, y + 5 + fresh, 3, 3);
    });
  }

  private drawShelf(g: CanvasRenderingContext2D) {
    const x0 = 264, rows = [27, 41];
    this.shelf.forEach((a, i) => {
      const row = Math.floor(i / 14); if (row > 1) return;
      const x = x0 + (i % 14) * 5 + (i % 3 === 2 ? 1 : 0);
      g.fillStyle = AGENT_COLOR[a]; g.fillRect(x, rows[row] - 9, 4, 9);
      g.fillStyle = shade(AGENT_COLOR[a], -0.35); g.fillRect(x + 3, rows[row] - 9, 1, 9);
      g.fillStyle = '#efeae0'; g.fillRect(x + 1, rows[row] - 6, 2, 1);
    });
  }

  private drawWindows(g: CanvasRenderingContext2D, now: number) {
    // a twinkle at night, a passing cloud by day
    const hour = this.bgHour;
    for (const wx of [118, 222]) {
      if (hour < 6 || hour >= 20) { if (Math.floor(now / 700 + wx) % 5 === 0) { g.fillStyle = '#efeae0'; g.fillRect(wx + 4 + (wx % 7), 13, 1, 1); } }
      else { const cx = wx + 2 + Math.floor(now / 400) % 18; g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(cx, 13, 5, 2); }
    }
  }

  private drawOrb(g: CanvasRenderingContext2D, now: number) {
    const a = ROOMS.antigravity;
    const busy = [...this.desks.values()].some((d) => d.agent === 'antigravity' && d.state === 'working');
    const y = a.y + 104 + Math.round(Math.sin(now / (busy ? 260 : 700)) * 3);
    const x = a.x + 50;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 3, a.y + 122, 10, 2);
    g.fillStyle = busy ? '#c8b8ff' : '#7a5fd6'; g.fillRect(x - 1, y, 6, 6);
    g.fillStyle = busy ? '#efeaff' : '#a68cff'; g.fillRect(x, y + 1, 2, 2);
    g.fillStyle = '#5a46a0'; g.fillRect(x - 1, y + 5, 6, 1);
  }

  private drawServerLeds(g: CanvasRenderingContext2D, now: number) {
    const r = ROOMS.codex;
    const busy = [...this.desks.values()].some((d) => d.agent === 'codex' && d.state === 'working');
    for (let i = 0; i < 6; i++) {
      const on = busy ? (Math.floor(now / 90) + i * 5) % 7 < 3 : i % 3 === 0;
      g.fillStyle = on ? '#5fd3a8' : '#24403a';
      g.fillRect(r.x + 9 + (i % 2) * 6, r.y + 82 + Math.floor(i / 2) * 9, 2, 1);
    }
  }

  private drawStamps(g: CanvasRenderingContext2D, now: number) {
    this.stamps = this.stamps.filter((s) => now - s.born < 2600);
    this.stamps.forEach((s, i) => {
      const age = now - s.born;
      const map = s.verdict === 'accept' ? STAMP_ACCEPT : s.verdict === 'redo' ? STAMP_REDO : STAMP_ESCALATE;
      const pal = { g: '#9bd77e', y: '#ecc94b', r: '#f2836e' };
      // snap in with a small overshoot, then float up and fade
      const pop = this.reduced ? 0 : age < 120 ? -3 : age < 220 ? 1 : 0;
      const rise = this.reduced ? 0 : Math.max(0, (age - 1400) / 120);
      g.globalAlpha = age > 1800 ? Math.max(0, 1 - (age - 1800) / 800) : 1;
      const x = INTRAY.x - 2 - i * 11, y = INTRAY.y - 14 + pop - rise;
      g.fillStyle = '#efeae0'; g.fillRect(x - 1, y - 1, 11, 10);
      g.drawImage(sprite(map, pal, 'stamp'), x, y);
      g.globalAlpha = 1;
    });
  }
}

function pos(w: Walker): [number, number] {
  const a = w.path[w.seg], b = w.path[Math.min(w.seg + 1, w.path.length - 1)];
  return [a[0] + (b[0] - a[0]) * w.t, a[1] + (b[1] - a[1]) * w.t];
}
function firstSentence(s: string) { const t = s.replace(/[#*`>]/g, '').trim().split(/(?<=[.!?])\s|\n/)[0] ?? ''; return t.length > 64 ? t.slice(0, 61) + '…' : t; }

export function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
function withAlpha(hex: string, a: number) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

// ---------------------------------------------------------------------------------------------
// Static scene, redrawn once an hour (window light follows the clock).
// ---------------------------------------------------------------------------------------------
function drawBackground(g: CanvasRenderingContext2D, hour: number) {
  const R = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  R(0, 0, W, H, '#0f0e0d');
  R(4, 4, W - 8, H - 8, '#4f4a44');   // wall caps everywhere; rooms are carved out of it

  const tiles = (r: Rect, a: string, b: string, size = 8) => {
    for (let y = r.y; y < r.y + r.h; y += size) for (let x = r.x; x < r.x + r.w; x += size)
      R(x, y, Math.min(size, r.x + r.w - x), Math.min(size, r.y + r.h - y), ((x - r.x) / size + (y - r.y) / size) % 2 ? a : b);
  };
  const planks = (r: Rect, a: string, line: string) => {
    R(r.x, r.y, r.w, r.h, a);
    for (let y = r.y + 5; y < r.y + r.h; y += 6) R(r.x, y, r.w, 1, line);
    for (let y = r.y, row = 0; y < r.y + r.h; y += 6, row++) for (let x = r.x + ((row * 13) % 29); x < r.x + r.w; x += 29) R(x, y, 1, 5, line);
  };
  const carpet = (r: Rect, a: string, b: string) => {
    R(r.x, r.y, r.w, r.h, a);
    for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x + (y % 4 ? 1 : 0); x < r.x + r.w; x += 4) R(x, y, 1, 1, b);
  };
  const wallFace = (x: number, y: number, w: number, h = 14) => {
    R(x, y, w, h, '#3a3631'); R(x, y, w, 1, '#46413b'); R(x, y + h - 1, w, 1, '#282420');
  };
  const plant = (x: number, y: number) => {
    R(x + 1, y + 8, 6, 5, '#7a4f35'); R(x + 1, y + 8, 6, 1, '#9a6a48');
    R(x + 2, y + 2, 4, 6, '#3f8a4f'); R(x, y + 4, 3, 3, '#4fa35f'); R(x + 5, y + 3, 3, 4, '#357a44'); R(x + 3, y, 2, 3, '#5bb86c');
  };

  // floors
  const { board, chair, lounge, codex, antigravity, claude } = ROOMS;
  carpet(board, '#26242c', '#2c2a33');
  planks(chair, '#3a2a20', '#2f221a');
  carpet(lounge, '#26242c', '#2c2a33');
  tiles({ x: 8, y: 120, w: 344, h: 26 }, '#24221f', '#282522');
  tiles(codex, '#1d2724', '#202c28');
  tiles(antigravity, '#231f30', '#272235');
  planks(claude, '#36302a', '#2e2923');

  // wall faces
  for (const r of [board, chair, lounge]) wallFace(r.x, r.y, r.w);
  wallFace(8, 120, 344, 10);
  for (const r of [codex, antigravity, claude]) wallFace(r.x, r.y, r.w);

  // openings to the hallway: board + lounge open wide, chair has a door, worker rooms have doors
  R(40, 116, 32, 14, '#26242c'); R(40, 116, 32, 1, '#2c2a33');
  R(288, 116, 32, 14, '#26242c');
  R(CHAIR_DOOR_X - 8, 116, 16, 14, '#3a2a20'); R(CHAIR_DOOR_X - 8, 128, 16, 2, '#5c3f28');
  for (const a of WORKERS) { const dx = doorX(a); R(dx - 6, 146, 12, 18, ROOMS[a] === claude ? '#36302a' : ROOMS[a] === codex ? '#1d2724' : '#231f30'); R(dx - 6, 162, 12, 2, '#403b36'); }

  // ---- chair's office: windows, bookshelf, rug, big desk, plants, nameplate
  const sky = skyFor(hour);
  for (const wx of [118, 222]) {
    R(wx, 10, 26, 11, '#201d1a');
    sky.forEach((c, i) => R(wx + 1, 11 + i * 3, 24, i === 2 ? 3 : 3, c));
    R(wx + 12, 10, 2, 11, '#201d1a'); R(wx, 15, 26, 1, '#201d1a');
  }
  R(156, 9, 48, 20, '#4d3626'); R(156, 9, 48, 1, '#6b4c36');
  const books = ['#c96f4a', '#e3b15c', '#6b8fbf', '#9c6ab0', '#5fa37a', '#d9c7a3', '#b4483c'];
  for (let s = 0; s < 2; s++) for (let i = 0; i < 11; i++) R(158 + i * 4, 11 + s * 9, 3, 7 - ((i * 5 + s) % 3), books[(i + s * 3) % books.length]);
  R(156, 18, 48, 1, '#3a281c');
  R(128, 74, 104, 36, '#5c3f28'); R(130, 76, 100, 32, '#7a4a2c');
  for (let x = 134; x < 226; x += 6) R(x, 78, 3, 1, '#a0643a'), R(x + 3, 105, 3, 1, '#a0643a');
  R(CHAIR_DESK.x + 20, CHAIR_DESK.y - 17, 20, 12, '#2e2b28'); R(CHAIR_DESK.x + 20, CHAIR_DESK.y - 17, 20, 1, '#403b36');   // high-back chair
  R(CHAIR_DESK.x, CHAIR_DESK.y, CHAIR_DESK.w, 8, '#7a5c3f'); R(CHAIR_DESK.x, CHAIR_DESK.y, CHAIR_DESK.w, 1, '#a5835f');
  R(CHAIR_DESK.x, CHAIR_DESK.y + 8, CHAIR_DESK.w, 8, '#5e4632'); R(CHAIR_DESK.x + 2, CHAIR_DESK.y + 16, 3, 2, '#3a2a20'); R(CHAIR_DESK.x + CHAIR_DESK.w - 5, CHAIR_DESK.y + 16, 3, 2, '#3a2a20');
  R(CHAIR_DESK.x + 22, CHAIR_DESK.y + 10, 16, 4, '#c9a26b'); R(CHAIR_DESK.x + 23, CHAIR_DESK.y + 11, 14, 2, '#8a6a4a');   // nameplate
  R(CHAIR_DESK.x + 2, CHAIR_DESK.y + 2, 12, 4, '#403b36'); R(INTRAY.x - 3, INTRAY.y + 1, 10, 6, '#403b36');                   // trays
  R(CHAIR_DESK.x + 46, CHAIR_DESK.y - 4, 2, 6, '#2e2b28'); R(CHAIR_DESK.x + 44, CHAIR_DESK.y - 6, 6, 2, '#f2a65a');            // lamp
  plant(112, 92); plant(240, 92);

  // ---- task board alcove
  R(12, 20, 88, 58, '#6b4c36'); R(14, 22, 84, 54, '#a4794f');
  for (let i = 0; i < 40; i++) R(15 + ((i * 37) % 82), 23 + ((i * 23) % 52), 1, 1, '#93693f');
  R(30, 84, 40, 6, '#5f5a54'); R(30, 90, 40, 6, '#46423d'); R(33, 96, 2, 6, '#2e2b28'); R(65, 96, 2, 6, '#2e2b28');
  R(36, 81, 8, 3, '#efeae0'); R(48, 82, 3, 2, '#c96f4a');
  plant(84, 96);

  // ---- results lounge: shelf, coffee machine, cooler, couch
  R(260, 12, 88, 38, '#4d3626'); R(260, 27, 88, 2, '#6b4c36'); R(260, 41, 88, 2, '#6b4c36');
  R(264, 60, 12, 18, '#2e2b28'); R(266, 62, 8, 5, '#141210'); R(267, 70, 6, 4, '#efeae0'); R(268, 63, 2, 1, '#f2a65a');
  R(334, 56, 10, 22, '#c9cdd6'); R(334, 56, 10, 9, '#8fc4e8'); R(335, 57, 3, 5, '#b8dcf2');
  R(282, 92, 50, 14, '#6b4a6e'); R(282, 90, 50, 4, '#83608a'); R(280, 92, 4, 14, '#5a3d5c'); R(330, 92, 4, 14, '#5a3d5c');
  R(298, 80, 18, 6, '#5f5a54');
  plant(340, 96);

  // ---- hallway: plants at the ends
  plant(12, 128); plant(340, 128);

  // ---- worker rooms
  for (const a of WORKERS) {
    const r = ROOMS[a];
    for (const t of [0, 1, 2] as Tier[]) {
      const x = deskX(a, t);
      // monitor
      R(x + 6, DESK_Y - 10, 14, 9, '#1c1a18'); R(x + 12, DESK_Y - 1, 2, 2, '#2e2b28');
      // desk
      R(x, DESK_Y, 26, 6, '#5f5a54'); R(x, DESK_Y, 26, 1, '#77716a'); R(x, DESK_Y + 6, 26, 5, '#46423d');
      R(x + 9, DESK_Y + 2, 8, 2, '#2e2b28');   // keyboard
      R(x + 21, DESK_Y + 1, 3, 3, (t + a.length) % 2 ? '#efeae0' : '#c96f4a');   // mug
    }
  }
  // codex lab: server rack + workbench
  const cx = codex.x;
  R(cx + 6, codex.y + 78, 16, 32, '#1c1a18'); R(cx + 7, codex.y + 79, 14, 30, '#272420');
  for (let i = 0; i < 3; i++) R(cx + 8, codex.y + 81 + i * 9, 12, 6, '#1c1a18');
  R(cx + 40, codex.y + 92, 40, 6, '#5f5a54'); R(cx + 40, codex.y + 98, 40, 5, '#46423d'); R(cx + 46, codex.y + 88, 10, 4, '#2e2b28'); R(cx + 64, codex.y + 89, 8, 3, '#5fd3a8');
  plant(cx + 96, codex.y + 112);
  // antigravity studio: pedestal for the floating orb, easel
  const ax = antigravity.x;
  R(ax + 46, antigravity.y + 114, 12, 8, '#3a3550'); R(ax + 45, antigravity.y + 113, 14, 2, '#4d4670');
  R(ax + 10, antigravity.y + 80, 22, 18, '#efeae0'); R(ax + 12, antigravity.y + 82, 18, 14, '#d8d0f5'); R(ax + 15, antigravity.y + 86, 8, 6, '#a68cff'); R(ax + 20, antigravity.y + 98, 2, 14, '#6b4c36');
  R(ax + 76, antigravity.y + 96, 26, 12, '#4d4670'); R(ax + 76, antigravity.y + 94, 26, 3, '#5f5788');
  plant(ax + 96, antigravity.y + 112);
  // claude bullpen: couch + low table
  const lx = claude.x;
  R(lx + 10, claude.y + 96, 50, 14, '#8a6f52'); R(lx + 10, claude.y + 94, 50, 4, '#a3876a'); R(lx + 8, claude.y + 96, 4, 14, '#735b42'); R(lx + 58, claude.y + 96, 4, 14, '#735b42');
  R(lx + 22, claude.y + 116, 26, 6, '#5e4632'); R(lx + 26, claude.y + 114, 6, 3, '#efeae0');
  R(lx + 74, claude.y + 84, 14, 16, '#4d3626'); for (let i = 0; i < 3; i++) R(lx + 76 + i * 4, claude.y + 86, 3, 12, books[i + 2]);
  plant(lx + 96, claude.y + 112);
}

function skyFor(hour: number): string[] {
  if (hour < 5 || hour >= 21) return ['#0f1428', '#141b33', '#1b2340'];
  if (hour < 8) return ['#6d5a8c', '#c98a7a', '#f2a65a'];
  if (hour < 17) return ['#7fb4dc', '#8fc4e8', '#a9d3ee'];
  if (hour < 19) return ['#4a3a6e', '#c96f5a', '#f2a65a'];
  return ['#1b2340', '#3a3360', '#6d5a8c'];
}
