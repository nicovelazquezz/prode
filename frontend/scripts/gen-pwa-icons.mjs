// Generate placeholder PWA icons from a solid background + centered text "P26".
// This is a one-shot script — outputs PNGs into public/. Re-run if you tweak
// the design tokens below, or replace these PNGs with real artwork from the
// designer (TODO: client to provide final icons with the Tiro Federal crest).
//
// Usage:  node scripts/gen-pwa-icons.mjs
//
// NOTE: We avoid a heavy `sharp` dep. Instead we hand-encode a PNG (uncompressed
// raw IDAT via zlib) drawing a flat background; the "P26" mark is omitted from
// the PNG itself (would need a font rasterizer). For visual identity in dev we
// rely on the manifest theme color — clients see a blue square. Replace before
// production launch.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { Buffer } from "node:buffer";

// Brand color from spec (--color-fwc-blue-deep equivalent).
const BG = { r: 0x05, g: 0x09, b: 0x0e, a: 0xff };

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size, color) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // IDAT — each scanline prefixed with a 0x00 (None) filter byte
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const off = y * stride + 1 + x * 4;
      raw[off] = color.r;
      raw[off + 1] = color.g;
      raw[off + 2] = color.b;
      raw[off + 3] = color.a;
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const here = new URL(".", import.meta.url).pathname;
const outDir = resolve(here, "../public");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-512-maskable.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const t of targets) {
  const png = makePng(t.size, BG);
  const out = resolve(outDir, t.name);
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`wrote ${t.name} (${t.size}x${t.size}, ${png.length} bytes)`);
}
