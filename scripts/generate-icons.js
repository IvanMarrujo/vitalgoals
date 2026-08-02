// Zero-dependency fallback icon generator (only Node built-ins: fs, zlib). Draws a
// neon viewfinder-bracket mark on the brand navy background. The committed
// icon-192.png/icon-512.png are actually resized from the real logo
// (assets/vhg-logo.png) via Pillow — run this script only if that asset is missing.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const bg = [10, 22, 40, 255];
  const neon = [0, 200, 83, 255];
  const setPx = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = color[3];
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setPx(x, y, bg);

  const margin = Math.round(size * 0.14);
  const armLen = Math.round(size * 0.24);
  const thick = Math.max(4, Math.round(size * 0.045));
  const corners = [
    [margin, margin, 1, 1],
    [size - margin, margin, -1, 1],
    [margin, size - margin, 1, -1],
    [size - margin, size - margin, -1, -1],
  ];
  corners.forEach(([cx, cy, dx, dy]) => {
    for (let t = 0; t < thick; t++) {
      for (let l = 0; l < armLen; l++) setPx(cx + dx * l, cy + (dy > 0 ? t : -t), neon);
    }
    for (let t = 0; t < thick; t++) {
      for (let l = 0; l < armLen; l++) setPx(cx + (dx > 0 ? t : -t), cy + dy * l, neon);
    }
  });

  const cx = Math.round(size / 2), cy = Math.round(size / 2);
  const r = Math.round(size * 0.07);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y <= r * r) setPx(cx + x, cy + y, neon);
  }

  return pixels;
}

[192, 512].forEach(size => {
  const pixels = drawIcon(size);
  const png = makePNG(size, size, pixels);
  const filename = path.join(__dirname, '..', `icon-${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Generated ${filename} (${png.length} bytes)`);
});
