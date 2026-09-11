#!/usr/bin/env node
// Run once: node generate-icons.js
//
// Draws the Yoda Mail mascot — an original hooded-sage-with-a-letter pixel
// sprite — and writes every PNG the extension needs:
//
//   icons/icon16.png    toolbar icon
//   icons/icon48.png    extensions page
//   icons/icon128.png   store / install dialog
//   assets/mascot.png   the floating head injected into Gmail (160px, retina)
//
// The sprite is authored once on a 16x16 grid and upscaled by whole-number
// factors, so every output stays crisp pixel art. Pure Node — no dependencies.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── The sprite ───────────────────────────────────────────────────────────────
// . transparent   # outline      G hood/robe    D robe shadow
// K cowl void     L glowing eye  E letter       S letter fold

const SPRITE = [
  '......####......',
  '.....######.....',
  '....##GGGG##....',
  '...##GGGGGG##...',
  '..##GG####GG##..',
  '..#GG#KKKK#GG#..',
  '..#GG#LKKL#GG#..',
  '..#GG#KKKK#GG#..',
  '..#GGG#KK#GGG#..',
  '..#GGGG##GGGG#..',
  '.#GGGGGGGGGGGG#.',
  '#GGGDDDDDDDDGGG#',
  '#GGG########GGG#',
  '#GGG#SEEEES#GGG#',
  '#GGG#ESSSSE#GGG#',
  '#GGG########GGG#',
];

const PALETTE = {
  '.': [0, 0, 0, 0],
  '#': [11, 15, 20, 255],
  G: [78, 204, 163, 255],
  D: [42, 125, 95, 255],
  K: [7, 16, 25, 255],
  L: [124, 255, 196, 255],
  E: [242, 236, 208, 255],
  S: [201, 193, 155, 255],
};

const GRID = SPRITE.length;

SPRITE.forEach((row, y) => {
  if (row.length !== GRID) {
    throw new Error(`sprite row ${y} is ${row.length} cells, expected ${GRID}`);
  }
  for (const ch of row) {
    if (!(ch in PALETTE)) throw new Error(`sprite row ${y} uses unknown cell "${ch}"`);
  }
});

// ─── Minimal PNG encoder ──────────────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, pixels) {
  // One filter byte (0 = None) per scanline, then raw RGBA.
  const stride = size * 4;
  const raw = Buffer.alloc(size * (1 + stride));
  for (let y = 0; y < size; y++) {
    const at = y * (1 + stride);
    raw[at] = 0;
    pixels.copy(raw, at + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(size) {
  if (size % GRID !== 0) {
    throw new Error(`${size}px is not a whole multiple of the ${GRID}px sprite grid`);
  }
  const scale = size / GRID;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    const row = SPRITE[Math.floor(y / scale)];
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = PALETTE[row[Math.floor(x / scale)]];
      const i = (y * size + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
  return encodePNG(size, pixels);
}

const OUTPUTS = [
  ['icons/icon16.png', 16],
  ['icons/icon48.png', 48],
  ['icons/icon128.png', 128],
  ['assets/mascot.png', 160],
];

for (const [file, size] of OUTPUTS) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(size));
  console.log(`${file.padEnd(20)} ${size}x${size}  ✓`);
}

console.log('\nDone. Reload the extension in chrome://extensions to see the new art.');
