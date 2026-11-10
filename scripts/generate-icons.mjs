// Erzeugt die Pixel-Icons (PNG) ohne externe Abhängigkeiten.
// Aufruf: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const palette = {
  '.': [20, 16, 14],
  d: [122, 82, 50],
  D: [94, 63, 37],
  L: [148, 105, 63],
  y: [255, 243, 168],
  g: [245, 197, 66],
  o: [184, 134, 11],
  h: [242, 194, 48],
  w: [255, 251, 208],
  k: [34, 32, 52],
};

// 16x16: Erdblock mit einem Goldklumpen und dem Licht einer Grubenlampe
const art = [
  'dddddddddddddddd',
  'dDdddLdddddDdddd',
  'dddLdddddDdddLdd',
  'dddddddgggdddddd',
  'dLdddggyyggdddDd',
  'ddDdggyyggogdddd',
  'dddggyyggooddLdd',
  'ddDggygggoodddDd',
  'dddgggggoooddddd',
  'dddddggooodddddd',
  'dLdddDdddddLdddd',
  'dddddddddddddddd',
  'dDdddddhhhhddddd',
  'dddLddhhhhhhwddd',
  'dddddddkkkkkdDdd',
  'dddddddddddddddd',
];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, scale, pad) {
  // scale: Pixelgröße der 16x16-Grafik; pad: Rand in Pixeln (für maskable-Safe-Zone)
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const artSize = 16 * scale;
  const start = Math.floor((size - artSize) / 2);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const ax = Math.floor((x - start) / scale);
      const ay = Math.floor((y - start) / scale);
      let col = palette['.'];
      if (ax >= 0 && ax < 16 && ay >= 0 && ay < 16) col = palette[art[ay][ax]] ?? palette['.'];
      // dünner Rahmen um die Grafik
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = col[0];
      raw[o + 1] = col[1];
      raw[o + 2] = col[2];
    }
  }
  void pad;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = [
  ['icon-512.png', 512, 32],
  ['icon-192.png', 192, 12],
  // maskable: Motiv auf ~70 % verkleinert, damit der Rand beim Zuschneiden bleibt
  ['icon-maskable-512.png', 512, 22],
  ['apple-touch-icon.png', 180, 11],
  ['favicon-32.png', 32, 2],
];
for (const [name, size, scale] of files) {
  writeFileSync(join(out, name), png(size, scale, 0));
  console.log('geschrieben:', name);
}
