import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPng(width, height, getPixelRgba) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA color type
  ihdrData.writeUInt8(0, 10); // Compression
  ihdrData.writeUInt8(0, 11); // Filter
  ihdrData.writeUInt8(0, 12); // Interlace

  const ihdr = makeChunk('IHDR', ihdrData);

  // Scanlines (filter byte 0 + RGBA)
  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines.writeUInt8(0, offset++); // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixelRgba(x, y, width, height);
      rawScanlines.writeUInt8(r, offset++);
      rawScanlines.writeUInt8(g, offset++);
      rawScanlines.writeUInt8(b, offset++);
      rawScanlines.writeUInt8(a, offset++);
    }
  }

  const compressed = zlib.deflateSync(rawScanlines);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

// Simple CRC32 implementation
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

// Icon design: Modern vibrant indigo-violet gradient with glowing speech bubble / spark
function getPixel(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.44;
  const dist = Math.hypot(x - cx, y - cy);

  // Rounded squircle container
  const cornerR = w * 0.22;
  const clampedX = Math.max(cornerR, Math.min(w - cornerR, x));
  const clampedY = Math.max(cornerR, Math.min(h - cornerR, y));
  const distCorner = Math.hypot(x - clampedX, y - clampedY);

  const inBounds = (x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2 && distCorner <= cornerR);
  if (!inBounds) {
    return [0, 0, 0, 0];
  }

  // Smooth antialiased edge
  let alpha = 255;
  if (distCorner > cornerR - 1.2) {
    alpha = Math.max(0, Math.min(255, Math.round((cornerR - distCorner + 0.2) * 255)));
  }

  // Gradient background: Electric Indigo (79, 70, 229) to Radiant Purple (147, 51, 234)
  const gradT = (x + y) / (w + h);
  let red = Math.round(79 + (147 - 79) * gradT);
  let green = Math.round(70 + (51 - 70) * gradT);
  let blue = Math.round(229 + (234 - 229) * gradT);

  // Inner Chat Bubble / Spark Glyph
  const bubbleCx = cx;
  const bubbleCy = cy * 0.95;
  const bubbleR = w * 0.26;
  const dBubble = Math.hypot(x - bubbleCx, y - bubbleCy);

  // Draw white chat bubble
  if (dBubble < bubbleR) {
    return [255, 255, 255, alpha];
  }
  // Draw bubble tail
  const tailX = x - (cx - bubbleR * 0.4);
  const tailY = y - (cy + bubbleR * 0.6);
  if (tailX >= 0 && tailX <= w * 0.15 && tailY >= 0 && tailY <= h * 0.15 && (tailX + tailY) <= w * 0.16) {
    return [255, 255, 255, alpha];
  }

  return [red, green, blue, alpha];
}

const outDir = path.resolve('public/icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const pngBuf = createPng(size, size, getPixel);
  const filePath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, pngBuf);
  console.log(`Generated ${filePath} (${size}x${size}, ${pngBuf.length} bytes)`);
}
