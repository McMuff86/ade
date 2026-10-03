// Goal 34.6 spike H0 (throwaway, not product code, not part of pnpm verify).
// RSS after repeated @napi-rs/image profile resizes. Run with --expose-gc:
//   ADE_H0_IMG=<node_modules dir> <runtime> --expose-gc image-rss.mjs <png>
import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs';
const { Transformer } = createRequire(process.env.ADE_H0_IMG + '/x.js')('@napi-rs/image');
const png = readFileSync(process.argv[2]); const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const marks = [];
for (let i = 1; i <= 300; i++) { await new Transformer(png).resize(256, 256).png(); if (i % 100 === 0) { globalThis.gc?.(); marks.push(rss()); } }
console.log(JSON.stringify({ runtime: process.versions.electron ? 'electron' : 'node', rssMbAfter100_200_300: marks }));
