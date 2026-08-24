/*!
 * 生成扩展图标（纯 Node 实现，无第三方依赖）：
 * 粉底圆角矩形 + 白色播放三角，与 B 站品牌色 #FB7299 一致。
 * 用法：node tools/gen_icons.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[off++] = r;
      raw[off++] = g;
      raw[off++] = b;
      raw[off++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

function makeIcon(size) {
  const bg = [251, 114, 153]; // #FB7299
  const white = [255, 255, 255];
  const m = Math.max(1, size * 0.04); // 外边距
  const r = Math.max(2, size * 0.2); // 圆角半径
  const x0 = m;
  const y0 = m;
  const x1 = size - m;
  const y1 = size - m;

  const inRound = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  const pts = [
    [size * 0.4, size * 0.28],
    [size * 0.4, size * 0.72],
    [size * 0.72, size * 0.5]
  ];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inTri = (x, y) => {
    const d1 = cross(pts[0], pts[1], [x, y]);
    const d2 = cross(pts[1], pts[2], [x, y]);
    const d3 = cross(pts[2], pts[0], [x, y]);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (!inRound(px, py)) return [0, 0, 0, 0];
    if (inTri(px, py)) return white.concat(255);
    return bg.concat(255);
  };
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  const file = path.join(outDir, 'icon' + s + '.png');
  writePng(file, s, makeIcon(s));
  console.log('written', file);
}
