// Goal 34.6 spike H0 (throwaway, not product code, not part of pnpm verify).
// Resolves node-pty the way a host entry inside the given app root would
// (a repository checkout or a packaged resources/app.asar), spawns a PTY and
// measures write -> echo round trips through the PTY line discipline.
//
//   ADE_H0_APP=<app root or .../resources/app.asar> <runtime> pty-probe.mjs [samples]
//
// Prints one JSON line.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const appRoot = process.env.ADE_H0_APP;
if (!appRoot) throw new Error('ADE_H0_APP is required');
const samples = Number(process.argv[2] ?? 200);
const requireFromApp = createRequire(join(appRoot, 'package.json'));
const out = {
  runtime: process.versions.electron ? `electron-run-as-node ${process.versions.electron}` : `node ${process.versions.node}`,
  appRoot: appRoot.endsWith('.asar') ? 'packaged-asar' : 'checkout',
};

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];

try {
  const resolved = requireFromApp.resolve('node-pty');
  out.resolvedInsideAsar = resolved.includes('app.asar');
  const pty = requireFromApp('node-pty');
  // `cat` echoes each line back; with ICANON and ECHO the line discipline also
  // echoes typed characters immediately, which is what we time.
  const term = pty.spawn('/bin/cat', [], { name: 'xterm-256color', cols: 80, rows: 24, env: { PATH: process.env.PATH ?? '/usr/bin' } });
  out.ptyPid = term.pid > 0;
  let buffer = '';
  let waiter = null;
  term.onData((data) => {
    buffer += data;
    if (waiter && buffer.includes(waiter.token)) { const w = waiter; waiter = null; w.resolve(); }
  });
  const roundTrip = (token) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no echo for ${token}`)), 2000);
    waiter = { token, resolve: () => { clearTimeout(timer); resolve(); } };
    term.write(token);
  });
  const times = [];
  for (let i = 0; i < samples; i += 1) {
    const token = `k${i.toString(36)}z`;
    const t0 = process.hrtime.bigint();
    await roundTrip(token);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (i % 20 === 19) { term.write('\r'); buffer = ''; }
  }
  term.kill();
  times.sort((a, b) => a - b);
  out.samples = times.length;
  out.echoMs = { p50: +pct(times, 0.5).toFixed(3), p95: +pct(times, 0.95).toFixed(3), max: +times.at(-1).toFixed(3) };
  out.state = 'ok';
} catch (error) {
  out.state = 'failed';
  out.error = String(error?.message ?? error).slice(0, 300);
}
console.log(JSON.stringify(out));
process.exit(0);
