// 生成应用图标 public/icon.png：蓝色圆角方块 + 白色计时环 + 黄色进度弧
const zlib = require('zlib'), fs = require('fs');
const S = 256, cx = 128, cy = 128;
const px = Buffer.alloc(S * S * 4);
function set(x, y, r, g, b, a) { const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; }
function aa(dist, r, g, b) {
  const cov = Math.max(0, Math.min(1, 0.5 - dist));
  if (cov <= 0) return null; return [r, g, b, Math.round(cov * 255)];
}
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const qx = Math.max(24 - x, x - 232, 0), qy = Math.max(24 - y, y - 232, 0);
  const dRect = Math.sqrt(qx * qx + qy * qy) - 24;
  const bg = aa(dRect, 79, 124, 255);
  if (!bg) continue;
  let [r, g, b] = bg;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  const dRing = Math.abs(dist - 72) - 16;
  const ring = aa(dRing, 255, 255, 255);
  if (ring) { const k = ring[3] / 255; r = r * (1 - k) + 255 * k; g = g * (1 - k) + 255 * k; b = b * (1 - k) + 255 * k; }
  const ang = Math.atan2(-(y - cy), x - cx);
  if (dRing < 0 && ang > -Math.PI / 2 && ang < 0.25) { r = 255; g = 214; b = 79; }
  const dDot = dist - 14;
  const dot = aa(dDot, 255, 255, 255);
  if (dot) { const k = dot[3] / 255; r = r * (1 - k) + 255 * k; g = g * (1 - k) + 255 * k; b = b * (1 - k) + 255 * k; }
  set(x, y, r, g, b, 255);
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type), crcBuf = Buffer.concat([t, data]);
  let c = ~0; for (const byte of crcBuf) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  const crc = Buffer.alloc(4); crc.writeUInt32BE((~c) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(__dirname + '/public/icon.png', png);
console.log('icon.png', png.length, 'bytes');
