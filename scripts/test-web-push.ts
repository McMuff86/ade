import { createCipheriv, createDecipheriv, createECDH, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { PushStore } from '../src/main/notifications/PushStore';
import { WebPushService } from '../src/main/notifications/WebPushService';
import { validPushCommand, validPushSubscription } from '../src/main/notifications/pushValidation';
import { encryptedPushRequest, sendWebPush } from '../src/main/notifications/pushTransport';
import { PUSH_WORKER } from '../build/pushWorker';
import type { MobilePushCommand, MobilePushPayload, MobilePushSubscription } from '../src/shared/remote';
import type { RunEvent } from '../src/shared/types';
import type { DeviceSecretProtection } from '../src/main/remote/RemoteDeviceStore';
import { AdeApplicationService, RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { RemoteCommandLedger } from '../src/main/application/RemoteCommandLedger';
import { HostOperationGate } from '../src/main/application/HostOperationGate';
import { HostRestartController } from '../src/main/application/HostRestartController';
import { createMobileFixture } from './helpers/mobileFixture';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
const refuses = async (name: string, action: () => unknown, code?: string) => { try { await action(); check(name, false); } catch (e) { check(name, !code || e instanceof RemoteApiError && e.code === code); } };
const root = mkdtempSync(join(tmpdir(), 'ade-web-push-'));
const key = randomBytes(32);
const protection: DeviceSecretProtection = { available: () => true, encrypt: value => {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
}, decrypt: value => { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(); } };
const receiver = createECDH('prime256v1'); receiver.generateKeys(); const auth = randomBytes(16);
const subscription: MobilePushSubscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture-private-endpoint', keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
const enable: MobilePushCommand = { operation: 'enable', subscription, preferences: { question: true, error: true, result: true }, locale: 'de' };
void (async () => {
  check('Chrome subscription accepts only canonical keys and a valid P-256 point', validPushCommand(enable));
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/a', 'https://localhost/fcm/send/a', 'https://127.0.0.1/fcm/send/a',
    'https://fcm.googleapis.com.evil.test/fcm/send/a', 'https://fcm.googleapis.com:8443/fcm/send/a', 'https://user:secret@fcm.googleapis.com/fcm/send/a',
    'https://fcm.googleapis.com/fcm/send/a#secret', 'https://fcm.googleapis.com/fcm/send/a?redirect=local']) {
    check('subscription rejects SSRF or ambiguous URL variant', !validPushSubscription({ ...subscription, endpoint }));
  }
  check('device cannot name another identity in a notification command', !validPushCommand({ ...enable, deviceId: 'other' }));
  check('empty preferences and extra fields fail closed', !validPushCommand({ ...enable, preferences: { question: false, error: false, result: false } }) && !validPushCommand({ operation: 'test', commandId: 'injected' }));
  check('invalid curve point is rejected before sending', !validPushSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString('base64url') } }));
  const file = join(root, 'push.json'); let vault = new PushStore(file, protection);
  check('fresh vault creates a durable VAPID key without any subscription', vault.available() && vault.get().devices.length === 0);
  const publicKey = vault.get().keys.publicKey;
  check('VAPID keys persist across host restart', new PushStore(file, protection).get().keys.publicKey === publicKey);
  check('missing OS key protection disables push only', !new PushStore(join(root, 'locked.json'), { ...protection, available: () => false }).available());
  let now = 100_000; let cursor = 0; const events: RunEvent[] = []; let active = true; let allowed = true;
  let completed = true;
  const source = { cursor: () => cursor, completed: () => completed, events: (after: number) => ({ events: events.filter(e => e.seq > after).slice(0, 100), nextCursor: cursor }), active: () => active, allowed: () => allowed };
  const add = (type: RunEvent['type'], runId = 'run-one') => events.push({ id: randomUUID(), seq: ++cursor, type, runId, createdAt: now, data: { prompt: 'PRIVATE PROMPT', path: '/home/private/project', name: 'Secret project' } });
  const sent: MobilePushPayload[] = []; let response = 201; let fail = false;
  const transport = async (_s: MobilePushSubscription, payload: MobilePushPayload) => { sent.push(payload); if (fail) throw new Error(subscription.endpoint); return response; };
  let push = new WebPushService(vault, source, transport, () => now);
  add('question.requested'); await push.poll(); check('no opt-in means no outgoing notification', sent.length === 0);
  await push.command('tablet', enable); await push.poll(); check('opt-in starts at the current cursor without notifying old work', sent.length === 0);
  completed = false; add('task.completed'); await push.poll(); check('intermediate task completion does not pretend the run is finished', sent.length === 0); completed = true;
  add('question.requested'); add('task.failed'); add('run.failed'); add('run.completed'); await push.poll();
  check('confirmed question, coalesced error and completed result are sent once each', sent.length === 3 && sent.map(p => p.kind).join() === 'question,error,result');
  check('payload contains no work text, name, path or native PTY ID', !JSON.stringify(sent).includes('PRIVATE') && !JSON.stringify(sent).includes('Secret') && !JSON.stringify(sent).includes('/home'));
  check('provider acceptance is recorded without claiming tablet delivery', push.status('tablet').last?.outcome === 'accepted');
  const disk = readFileSync(file, 'utf8');
  check('push endpoint, browser key and private VAPID key are encrypted at rest', !disk.includes(subscription.endpoint) && !disk.includes(subscription.keys.auth) && !disk.includes(vault.get().keys.privateKey));
  await push.poll(); check('repeated observation does not resend the same journal event', sent.length === 3);
  push.dispose(); vault = new PushStore(file, protection); push = new WebPushService(vault, source, transport, () => now); await push.poll();
  check('restart preserves delivery cursor and deduplication', sent.length === 3);
  add('question.requested'); await push.poll(); check('nearby duplicate questions are coalesced', sent.length === 3);
  now += 31_000; add('question.requested'); await push.poll(); check('a later confirmed question can notify again', sent.length === 4);
  allowed = false; add('run.completed', 'denied'); await push.poll(); check('current resource denial suppresses delivery', sent.length === 4);
  allowed = true; await push.poll(); check('restoring a grant does not replay previously denied events', sent.length === 4);
  fail = true; now += 31_000; add('run.failed'); await push.poll(); check('transport failure is isolated and visible', push.status('tablet').last?.outcome === 'failed');
  const count = sent.length; fail = false; await push.poll(); check('uncertain provider acceptance is not automatically retried', sent.length === count);
  await push.command('tablet', { operation: 'test' }); check('explicit test sends a neutral test payload', sent.at(-1)?.kind === 'test' && sent.at(-1)?.runId === null);
  await refuses('test requests are bounded by a persisted cooldown', () => push.command('tablet', { operation: 'test' }));
  await push.command('tablet', { operation: 'disable' }); add('run.completed'); await push.poll(); check('disabling stops subsequent deliveries', !push.status('tablet').enabled && sent.length === count + 1);
  await push.command('tablet', enable); response = 410; now += 31_000; add('question.requested'); await push.poll(); check('expired provider endpoint disables the subscription', !push.status('tablet').enabled); response = 201;
  await push.command('tablet', enable); active = false; add('run.completed'); await push.poll(); check('revoked device is removed before sending', !push.status('tablet').enabled); active = true;
  let release!: () => void; let aborted = false;
  const delayed = new WebPushService(vault, source, async (_sub, payload, _keys, signal) => { sent.push(payload); signal.addEventListener('abort', () => { aborted = true; }); await new Promise<void>(done => { release = done; }); return 201; }, () => now);
  await delayed.command('tablet', enable); now += 31_000; add('question.requested'); add('run.completed');
  const pending = delayed.poll(); await Promise.resolve(); active = false; delayed.authorityChanged('tablet'); release(); await pending;
  check('revocation aborts an in-flight request and prevents the remaining batch', aborted && !delayed.status('tablet').enabled && sent.at(-1)?.kind === 'question');
  delayed.dispose(); active = true;

  const payload: MobilePushPayload = { version: 1, kind: 'question', locale: 'de', tag: 'a'.repeat(32), runId: 'run-one' };
  const request = encryptedPushRequest(subscription, payload, vault.get().keys);
  const require = createRequire(import.meta.url); const ece = createRequire(require.resolve('web-push'))('http_ece') as { decrypt(body: Buffer, options: object): Buffer };
  const decoded = ece.decrypt(request.body!, { version: 'aes128gcm', privateKey: receiver, authSecret: auth });
  check('actual RFC encryption round-trips to the browser key and hides cleartext', decoded.toString() === JSON.stringify(payload) && !request.body!.includes(Buffer.from('run-one')));
  check('outgoing request uses VAPID and a bounded five-minute TTL', !!request.headers.Authorization && Number(request.headers.TTL) === 300);
  const controller = new AbortController(); controller.abort(); await refuses('cancelled transport never opens an outbound request', () => sendWebPush(subscription, payload, vault.get().keys, controller.signal));

  const fixture = createMobileFixture(join(root, 'api')); fixture.devices.enroll('tablet', 'Tablet', 's'.repeat(40));
  const ledger = new RemoteCommandLedger(join(root, 'api', 'remote', 'commands.json'), e => fixture.devices.audit(e), id => fixture.devices.activeDevices().some(d => d.id === id));
  const gate = new HostOperationGate();
  const app = new AdeApplicationService(fixture.store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    notifications: push, activity: gate, deviceActive: id => fixture.devices.activeDevices().some(d => d.id === id),
    administration: { ledger, restart: new HostRestartController(new HostOperationGate(), () => [], () => {}, 'fixture', true) },
  });
  const context = (): RemoteCommandContext => ({ principal: { kind: 'device', proof: 'device-signature', id: 'tablet', scopes: new Set(['read', 'runs:write']) }, idempotencyKey: randomUUID(), requestId: 'push-test' });
  await refuses('host without push support reports unavailable without revoking browser identity', () => fixture.application.notificationStatus(context().principal), 'unavailable');
  await refuses('notification status rejects bearer-only access', () => app.notificationStatus({ ...context().principal, proof: 'bearer' }), 'device_proof_required');
  await refuses('notification command requires idempotency key', () => app.notificationCommand({ ...context(), idempotencyKey: undefined }, enable), 'idempotency_key_required');
  await refuses('notification command rejects extra authority fields', () => app.notificationCommand(context(), { ...enable, deviceId: 'victim' }), 'invalid_payload');
  await refuses('read-only devices cannot alter notification settings', () => app.notificationCommand({ ...context(), principal: { ...context().principal, scopes: new Set(['read']) } }, enable), 'scope_not_granted');
  const ctx = context(); await app.notificationCommand(ctx, enable); const generation = vault.get().devices[0].generation; await app.notificationCommand(ctx, enable);
  check('lost configuration reply replays the receipt without resubscribing', vault.get().devices[0].generation === generation);
  check('command ledger stores no subscription secrets', !readFileSync(join(root, 'api', 'remote', 'commands.json'), 'utf8').includes(subscription.endpoint));
  await refuses('same idempotency key cannot switch from enable to disable', () => app.notificationCommand(ctx, { operation: 'disable' }), 'idempotency_key_reused');
  gate.reserve(); await refuses('activation fence blocks new notification mutations', () => app.notificationCommand(context(), { operation: 'disable' }), 'command_rejected');
  check('blocked activation mutation preserves the subscription', push.status('tablet').enabled); gate.release();
  fixture.devices.revoke('tablet'); await refuses('device revocation defeats a completed command replay', () => app.notificationCommand(ctx, enable), 'scope_not_granted');

  const handlers: Record<string, (event: any) => void> = {}; const notices: any[] = []; const opened: string[] = [];
  const worker = { location: { origin: 'https://ade.fixture.ts.net:8443' }, addEventListener: (name: string, fn: (event: any) => void) => { handlers[name] = fn; },
    registration: { showNotification: async (title: string, options: object) => { notices.push({ title, ...options }); } },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } } };
  runInNewContext(PUSH_WORKER, { self: worker, URL });
  let wait: Promise<unknown> | undefined;
  handlers.push({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => { wait = p; } }); await wait;
  check('shipped worker renders only neutral lock-screen text', notices.length === 1 && notices[0].title === 'ADE' && notices[0].body === 'ADE benötigt deine Aufmerksamkeit.' && !JSON.stringify(notices[0]).includes('PRIVATE'));
  handlers.push({ data: { json: () => ({ ...payload, body: 'SECRET' }) }, waitUntil: () => {} });
  check('worker rejects unexpected notification content fields', notices.length === 1);
  handlers.notificationclick({ notification: { data: notices[0].data, close: () => {} }, waitUntil: (p: Promise<unknown>) => { wait = p; } }); await wait;
  check('click opens same-origin detail hint without credentials or commands', opened[0] === 'https://ade.fixture.ts.net:8443/#notice=run:run-one');
  handlers.notificationclick({ notification: { data: { version: 1, runId: 'https://evil.test' }, close: () => {} }, waitUntil: () => {} });
  check('worker refuses external or malformed click targets', opened.length === 1);
  push.dispose();
  writeFileSync(join(root, 'corrupt.json'), '{broken'); check('corrupt vault fails closed without replacing it', !new PushStore(join(root, 'corrupt.json'), protection).available() && readFileSync(join(root, 'corrupt.json'), 'utf8') === '{broken');
  if (process.platform !== 'win32') { symlinkSync(file, join(root, 'link.json')); check('linked push vault fails closed', !new PushStore(join(root, 'link.json'), protection).available()); }
})().catch(error => { failed++; console.error(error); }).finally(() => { rmSync(root, { recursive: true, force: true }); console.log(`Web push: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0; });
