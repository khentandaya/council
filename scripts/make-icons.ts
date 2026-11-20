// Generates resources/icon.png (256), tray.png / tray-busy.png (32) as pixel art.
// node scripts/make-icons.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type RGBA = [number, number, number, number];
const hex = (h: string, a = 255): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const C = {
  clear: [0, 0, 0, 0] as RGBA, bg: hex('#15171d'), bgEdge: hex('#262a33'), wood: hex('#8a5a35'), woodHi: hex('#b07a4a'),
  woodLo: hex('#5c3a22'), amber: hex('#f2a65a'), mint: hex('#5fd3a8'), violet: hex('#a68cff'), sand: hex('#d9c7a3'), grey: hex('#4a4f5c'),
};

function draw(size: number, busy: boolean, withBg: boolean): RGBA[] {
  const px: RGBA[] = Array.from({ length: size * size }, () => C.clear);
  const set = (x: number, y: number, c: RGBA) => { if (x >= 0 && y >= 0 && x < size && y < size) px[y * size + x] = c; };
  const s = size / 32; // design grid is 32x32
  const cx = 15.5, cy = 16.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = (x + 0.5) / s - 0.5, gy = (y + 0.5) / s - 0.5;
    if (withBg) {
      const r = 6, inX = Math.max(r - gx, gx - (31 - r), 0), inY = Math.max(r - gy, gy - (31 - r), 0);
      const d = Math.hypot(inX, inY);
      if (d <= r) set(x, y, d > r - 1.2 ? C.bgEdge : C.bg);
    }
    const d = Math.hypot(gx - cx, (gy - cy) * 1.15);
    if (d <= 9.5 && d > 5.5) set(x, y, gy < cy - 3 ? C.woodHi : gy > cy + 4 ? C.woodLo : C.wood);
  }
  const seat = (gx: number, gy: number, c: RGBA, r = 2) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (Math.abs(x) + Math.abs(y) > r + 0.5) continue;
      for (let sy = 0; sy < s; sy++) for (let sx = 0; sx < s; sx++) set(Math.floor((gx + x) * s + sx), Math.floor((gy + y) * s + sy), c);
    }
  };
  seat(15.5, 5, C.amber, 3);                                  // the chair, at the head
  const others = [[4, 20, C.mint], [27, 20, C.violet], [15.5, 27, C.sand]] as const;
  for (const [x, y, c] of others) seat(x, y, busy || withBg ? c : C.grey);
  if (busy || withBg) seat(15.5, 16.5, C.amber, 1);           // a task on the table
  return px;
}

function png(size: number, px: RGBA[]): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) Buffer.from(px[y * size + x]).copy(raw, y * (size * 4 + 1) + 1 + x * 4);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('resources', { recursive: true });
writeFileSync('resources/icon.png', png(256, draw(256, true, true)));
writeFileSync('resources/tray.png', png(32, draw(32, false, false)));
writeFileSync('resources/tray-busy.png', png(32, draw(32, true, false)));
console.log('icons written to resources/');
