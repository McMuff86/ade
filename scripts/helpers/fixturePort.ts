import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';

/**
 * Loopback port for a fixture listener that ADE binds later than the driver
 * picks it. listen(0) hands out a port from the kernel's ephemeral range, and
 * between release and ADE's bind the kernel may give the same port to another
 * process (3 Oct 2026, conversation-electron: setEnabled → EADDRINUSE, pair →
 * "zuerst die mobile Verbindung aktivieren"). Below the ephemeral range the
 * kernel never assigns ports by itself. Bounds come from ip_local_port_range;
 * without it (Windows) the listen(0) reservation is kept.
 */
export async function fixturePort(): Promise<number> {
  const free = (candidate: number) => new Promise<boolean>((done) => {
    const probe = createServer(); probe.once('error', () => done(false));
    probe.listen(candidate, '127.0.0.1', () => probe.close(() => done(true)));
  });
  const range = '/proc/sys/net/ipv4/ip_local_port_range';
  if (!existsSync(range)) {
    const reservation = createServer();
    await new Promise<void>((done, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done); });
    const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    await new Promise<void>(done => reservation.close(() => done())); return address.port;
  }
  const ephemeralLow = Number(readFileSync(range, 'utf8').trim().split(/\s+/)[0]);
  const min = Math.max(1024, ephemeralLow - 12768); const max = ephemeralLow - 1;
  const tried: number[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = min + Math.floor(Math.random() * (max - min + 1)); tried.push(candidate);
    if (await free(candidate)) return candidate;
  }
  throw new Error(`No free fixture port in ${min}-${max} below the ephemeral range; tried ${tried.join(', ')}`);
}
