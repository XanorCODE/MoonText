// Рисует иконки MoonText (серп луны) без внешних зависимостей: build/icon.png, build/icon.ico, build/tray.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });

function png(w, h, rgba) {
  const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** background: true — чёрная скруглённая плитка, иначе прозрачный фон. */
function render(size, background) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;
  const cx = 0.5, cy = 0.5, R = 0.31;                 // диск луны
  const bx = 0.66, by = 0.42, BR = 0.27;              // вырез → серп
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let rr = 0, gg = 0, bb = 0, aa = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + .5) / SS) / size, v = (y + (sy + .5) / SS) / size;
      let r = 0, g = 0, b = 0, a = 0;
      if (background) {                                // скруглённый квадрат
        const k = 0.22, dx = Math.max(Math.abs(u - .5) - (.5 - k), 0), dy = Math.max(Math.abs(v - .5) - (.5 - k), 0);
        if (dx * dx + dy * dy <= k * k) { const t = v; r = 14 + 14 * (1 - t); g = r; b = 20 + 18 * (1 - t); a = 1; }
      }
      const inMoon = (u - cx) ** 2 + (v - cy) ** 2 <= R * R && (u - bx) ** 2 + (v - by) ** 2 > BR * BR;
      if (inMoon) {
        const l = 0.78 + 0.22 * (1 - Math.hypot(u - .38, v - .4) / R);
        r = g = 235 * Math.min(1, l) + 20; b = 245 * Math.min(1, l) + 10; a = 1;
      }
      rr += r * a; gg += g * a; bb += b * a; aa += a;
    }
    const n = SS * SS, i = (y * size + x) * 4;
    buf[i] = aa ? Math.min(255, rr / aa) : 0; buf[i + 1] = aa ? Math.min(255, gg / aa) : 0; buf[i + 2] = aa ? Math.min(255, bb / aa) : 0;
    buf[i + 3] = Math.round(255 * aa / n);
  }
  return png(size, size, buf);
}

const big = render(256, true);
fs.writeFileSync(path.join(out, 'icon.png'), big);
fs.writeFileSync(path.join(out, 'tray.png'), render(32, false));

// ICO с PNG-кадрами
const sizes = [16, 32, 48, 64, 128, 256];
const frames = sizes.map(s => s === 256 ? big : render(s, true));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
let offset = 6 + 16 * frames.length;
const dir = frames.map((f, i) => {
  const e = Buffer.alloc(16);
  e[0] = sizes[i] === 256 ? 0 : sizes[i]; e[1] = e[0]; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(f.length, 8); e.writeUInt32LE(offset, 12); offset += f.length;
  return e;
});
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, ...dir, ...frames]));
console.log('icons written to', out);
