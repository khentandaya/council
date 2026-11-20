// Original pixel sprites as character maps + palettes. Cached to offscreen canvases.

export type Pal = Record<string, string>;

export const SKIN = ['#f1c7a3', '#d9a37e', '#a8714f', '#7a4f35', '#e8b896', '#c48a62'];
export const HAIR = ['#2b2018', '#5a3a22', '#c9a26b', '#1d1d22', '#8c4a2f', '#d7d2c8', '#3d2a3a'];
export const SHIRT: Record<string, [string, string]> = {
  chair: ['#f2a65a', '#c47d39'],
  codex: ['#5fd3a8', '#36a07a'],
  antigravity: ['#a68cff', '#7a5fd6'],
  claude: ['#d9c7a3', '#ab9874'],
  courier: ['#8a93a6', '#646c80'],
};

/** Claude at the head desk, facing the room (12x12, desk covers the bottom). */
export const CHAIR_FRONT = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..sesssses..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
  '..cccccccc..',
  '.cccccccccc.',
  '.cCccccccCc.',
  '.cCccccccCc.',
  '.kC......Ck.',
];
export const CHAIR_FRONT_TYPE = [...CHAIR_FRONT.slice(0, 9), '.ckccccckcc.', '.cCccccccCc.', '..........'.padEnd(12, '.')];
export const CHAIR_FRONT_READ = [...CHAIR_FRONT.slice(0, 8), '.cwwwwwwwwc.', '.cwrrrrrrwc.', '.kwwwwwwwwk.', '..wrrrrrrw..'];

/** Worker seated with their back to us, facing their monitor (10x9). */
export const SEATED_BACK = [
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  '..hhhhhh..',
  '...ssss...',
  '.cccccccc.',
  'cccccccccc',
  'cCccccccCc',
];
export const SEATED_BACK_TYPE = [...SEATED_BACK.slice(0, 8), 'ccCccccCcc'];

/** Walking, front view (8x13), two frames. */
export const WALK_A = [
  '..hhhh..',
  '.hhhhhh.',
  '.hssssh.',
  '.sesses.',
  '..ssss..',
  '.cccccc.',
  'cccccccc',
  'kcccccck',
  '.cccccc.',
  '.pppppp.',
  '.pp..pp.',
  '.pp..pp.',
  '.bb..bb.',
];
export const WALK_B = [...WALK_A.slice(0, 10), '..pppp..', '..pppp..', '..bbbb..'];

export const STAMP_ACCEPT = [
  '.........',
  '.......g.',
  '......gg.',
  '.g...gg..',
  '.gg.gg...',
  '..ggg....',
  '...g.....',
  '.........',
];
export const STAMP_REDO = [
  '..yyyy...',
  '.y....y..',
  'y......y.',
  'y........',
  'y.....yyy',
  '.y.....yy',
  '..yyyy..y',
  '.........',
];
export const STAMP_ESCALATE = [
  '....r....',
  '...rrr...',
  '..rrrrr..',
  '.rr.r.rr.',
  '....r....',
  '....r....',
  '....r....',
  '.........',
];

const cache = new Map<string, HTMLCanvasElement>();

export function sprite(map: string[], pal: Pal, key: string): HTMLCanvasElement {
  const k = key + '|' + map.join('');
  const hit = cache.get(k);
  if (hit) return hit;
  const w = Math.max(...map.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w; c.height = map.length;
  const g = c.getContext('2d')!;
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    const col = pal[ch];
    if (ch === '.' || !col) return;
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }));
  cache.set(k, c);
  return c;
}

export function personPal(role: string, i: number): Pal {
  const [c, C] = SHIRT[role] ?? SHIRT.courier;
  const s = SKIN[i % SKIN.length];
  return { h: HAIR[(i * 3 + 1) % HAIR.length], s, k: s, e: '#1b1712', m: '#a35d4b', c, C, p: '#3a3e4c', b: '#1c1e25', w: '#efeae0', r: '#b9b2a4' };
}
