// Goal 34.6 spike H0 (throwaway, not product code, not part of pnpm verify).
// Classifies Secret Service access for a would-be host process as
// available / locked / unavailable, without a kernel-keyring fallback.
//
//   ADE_H0_KEYRING=<path to @napi-rs/keyring> node keyring-probe.mjs [--write]
//
// Without --write it only looks up an entry that never exists. With --write it
// stores, reads back and deletes one own entry (service "ade-h0-spike").
// Prints one JSON line; never prints a secret.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const started = Date.now();
const out = {
  runtime: process.versions.electron ? `electron-run-as-node ${process.versions.electron}` : `node ${process.versions.node}`,
  pid: process.pid,
  busAddressSet: Boolean(process.env.DBUS_SESSION_BUS_ADDRESS),
  context: process.env.ADE_H0_CONTEXT ?? 'unlabelled',
};

function classify(error) {
  const text = String(error?.message ?? error);
  if (/\blocked\b|\bprompt|dismissed/i.test(text) && !/did not receive a reply/i.test(text)) return 'locked';
  return 'unavailable';
}

try {
  const { AsyncEntry } = require(process.env.ADE_H0_KEYRING ?? '@napi-rs/keyring');
  const options = { linux: { store: 'secret-service' } };
  const user = `probe-${process.pid}`;
  const entry = new AsyncEntry('ade-h0-spike', user, options);
  const missing = await entry.getPassword();
  out.lookup = missing == null ? `ok-empty(${missing === null ? 'null' : 'undefined'})` : 'unexpected-value';
  if (process.argv.includes('--write')) {
    const value = randomBytes(32).toString('base64');
    await entry.setPassword(value);
    out.roundTrip = (await entry.getPassword()) === value ? 'ok' : 'mismatch';
    out.deleted = await entry.deletePassword();
    out.afterDelete = (await entry.getPassword()) == null ? 'gone' : 'still-present';
  }
  out.state = 'available';
} catch (error) {
  out.state = classify(error);
  out.error = String(error?.message ?? error).slice(0, 300);
}
out.ms = Date.now() - started;
console.log(JSON.stringify(out));
