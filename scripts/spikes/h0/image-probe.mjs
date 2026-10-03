// Goal 34.6 spike H0 (throwaway, not product code, not part of pnpm verify).
// Compares nativeImage replacements on the three operations ADE's host needs
// (src/main/ipc.ts: organizer size check, terminal image -> PNG, profile photo
// square resize to 256/128/64 PNG <= 32 KB) plus malformed inputs.
//
//   ADE_H0_IMG=<node_modules dir> <runtime> image-probe.mjs <sharp|napi|jimp> <png> <jpeg>
//
// Prints one JSON line.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const [lib, pngPath, jpegPath] = process.argv.slice(2);
const req = createRequire(join(process.env.ADE_H0_IMG, 'x.js'));
const PROFILE_LIMIT = 32 * 1024;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) { c = (crc ^ byte) & 0xff; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// A PNG header announcing 100000 x 100000 RGBA with a tiny, incomplete IDAT.
function bombPng() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(100000, 0); ihdr.writeUInt32BE(100000, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(4096))), chunk('IEND', Buffer.alloc(0))]);
}

const adapters = {
  sharp: () => {
    const sharp = req('sharp');
    return {
      size: async (b) => { const m = await sharp(b).metadata(); return [m.width, m.height]; },
      png: async (b) => sharp(b).png().toBuffer(),
      square: async (b, s) => sharp(b).resize(s, s, { fit: 'fill' }).png().toBuffer(),
    };
  },
  napi: () => {
    const { Transformer } = req('@napi-rs/image');
    return {
      size: async (b) => { const m = await new Transformer(b).metadata(); return [m.width, m.height]; },
      png: async (b) => Buffer.from(await new Transformer(b).png()),
      square: async (b, s) => Buffer.from(await new Transformer(b).resize(s, s).png()),
    };
  },
  jimp: () => {
    const { Jimp } = req('jimp');
    return {
      size: async (b) => { const i = await Jimp.read(b); return [i.width, i.height]; },
      png: async (b) => (await Jimp.read(b)).getBuffer('image/png'),
      square: async (b, s) => { const i = await Jimp.read(b); i.resize({ w: s, h: s }); return i.getBuffer('image/png'); },
    };
  },
};

const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function timed(fn, runs = 7) {
  const times = []; let result;
  for (let i = 0; i < runs; i += 1) { const t0 = performance.now(); result = await fn(); times.push(performance.now() - t0); }
  return { ms: +median(times).toFixed(2), result };
}
async function profile(a, b) {
  for (const size of [256, 128, 64]) { const out = await a.square(b, size); if (out.length <= PROFILE_LIMIT) return { size, bytes: out.length }; }
  throw new Error('too big');
}
async function rejects(fn) {
  const t0 = performance.now();
  try { await fn(); return { rejected: false, ms: +(performance.now() - t0).toFixed(1) }; }
  catch (e) { return { rejected: true, ms: +(performance.now() - t0).toFixed(1), error: String(e.message).slice(0, 90) }; }
}

const out = { lib, runtime: process.versions.electron ? `electron-run-as-node ${process.versions.electron}` : `node ${process.versions.node}` };
try {
  const t0 = performance.now(); const a = adapters[lib](); out.loadMs = +(performance.now() - t0).toFixed(1);
  const png = readFileSync(pngPath); const jpeg = readFileSync(jpegPath);
  out.pngSize = (await timed(() => a.size(png))).result;
  out.jpegSize = (await timed(() => a.size(jpeg))).result;
  const jpegToPng = await timed(() => a.png(jpeg)); out.jpegToPng = { ms: jpegToPng.ms, bytes: jpegToPng.result.length };
  const pngToPng = await timed(() => a.png(png)); out.pngToPng = { ms: pngToPng.ms, bytes: pngToPng.result.length };
  const prof = await timed(() => profile(a, png)); out.profileFromPng = { ms: prof.ms, ...prof.result };
  const profJ = await timed(() => profile(a, jpeg)); out.profileFromJpeg = { ms: profJ.ms, ...profJ.result };
  out.truncated = await rejects(() => a.png(png.subarray(0, Math.floor(png.length / 3))));
  out.randomBytes = await rejects(() => a.size(Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251))));
  out.bomb = await rejects(() => a.png(bombPng()));
  out.state = 'ok';
} catch (e) { out.state = 'failed'; out.error = String(e?.message ?? e).slice(0, 200); }
out.peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
console.log(JSON.stringify(out));
