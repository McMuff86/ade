import { mkdtempSync, readFileSync, rmSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { request, type IncomingMessage } from 'node:http';
import { BrowserSessions, SESSION_TTL_MS, PAIRING_TTL_MS } from '../src/main/remote/BrowserSessions';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, signRequest, sha256Hex } from '../src/main/remote/authorization';
import { parseMobileOrigin } from '../src/main/remote/hostApiConfig';
import { TailscaleService } from '../src/main/remote/TailscaleService';
import { RemoteDeviceStore } from '../src/main/remote/RemoteDeviceStore';
import { CHANNEL_POLICY } from '../src/main/ipcPolicy';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { RemoteApiError } from '../src/main/application/AdeApplicationService';
import { createMobileFixture, fixtureProtection } from './helpers/mobileFixture';
import { MobileAccessController } from '../src/main/remote/MobileAccessController';
import { createServer } from 'node:net';

let passed = 0; let failed = 0;
function check(label: string, condition: boolean): void { if (condition) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } }
function rejects(label: string, action: () => unknown, code?: string): void {
  try { action(); check(label, false); } catch (error) { check(label, !code || (error instanceof RemoteApiError && error.code === code)); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-mobile-protocol-'));
const origin = 'https://ade-mobile.fixture.ts.net';
const fixture = createMobileFixture(root);
let now = Date.now();
const sessions = new BrowserSessions(fixture.devices, () => now);
const server = new HostApiServer(fixture.application, { port: 0, requireDeviceReads: true, heartbeatMs: 30,
  authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, fixture.devices),
  browser: { origin, sessions, assets: new Map([['/', { body: Buffer.from('<html>Public ADE shell</html>'), contentType: 'text/html' }]]) },
  audit: (entry) => fixture.devices.audit(entry) });
let port = 0;
let cookie = ''; let csrf = '';
const id = 'phone'; const secret = 's'.repeat(43);
function headers(path: string, method = 'GET', body = '', key = '', identity = id, deviceSecret = secret): Record<string, string> {
  const timestamp = String(Date.now());
  return { host: new URL(origin).host, origin, cookie, 'x-ade-csrf': csrf, 'x-ade-device': identity, 'x-ade-timestamp': timestamp,
    'x-ade-signature': signRequest(deviceSecret, { method, path, timestamp, idempotencyKey: key, bodySha256: sha256Hex(body) }),
    ...(key ? { 'idempotency-key': key } : {}), ...(method === 'POST' ? { 'content-length': String(Buffer.byteLength(body)), ...(body ? { 'content-type': 'application/json' } : {}) } : {}) };
}
async function http(path: string, method = 'GET', body = '', override: Record<string, string | undefined> = {}) {
  return new Promise<{ status: number; body: string; headers: IncomingMessage['headers'] }>((resolveRequest, reject) => {
    const cleanHeaders = Object.fromEntries(Object.entries({ ...headers(path, method, body), ...override }).filter(([, value]) => value !== undefined));
    const req = request({ host: '127.0.0.1', port, path, method, headers: cleanHeaders }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolveRequest({ status: res.statusCode!, body: text, headers: res.headers }));
    });
    req.on('error', reject); req.end(body);
  });
}
function useSession(response: Awaited<ReturnType<typeof http>>): void {
  cookie = response.headers['set-cookie']![0]!.split(';')[0]!; csrf = JSON.parse(response.body).csrf;
}

void (async () => {
  port = (await server.start()).port;
  for (const value of ['http://ade-mobile.fixture.ts.net', 'https://example.com', `${origin}/path`, `${origin}/`, `${origin}?token=x`, 'https://user@ade-mobile.fixture.ts.net']) {
    rejects('origin refuses non-private or ambiguous address', () => parseMobileOrigin(value));
  }
  check('exact Tailscale HTTPS origin is accepted', parseMobileOrigin(origin) === origin);
  check('public app shell contains no private data', (await http('/')).body.includes('Public ADE shell'));
  check('unpaired device cannot read the catalog', (await http('/api/v1/catalog')).status === 401);
  check('foreign origin is refused before pairing', (await http('/api/v1/pair', 'POST', '{}', { origin: 'https://evil.example' })).status === 403);
  check('missing mutation origin is refused', (await http('/api/v1/pair', 'POST', '{}', { origin: undefined })).status === 403);
  check('unknown host is refused even with forwarded host', (await http('/', 'GET', '', { host: 'evil.example', 'x-forwarded-host': new URL(origin).host })).status === 400);
  check('cross-site fetch metadata is refused', (await http('/', 'GET', '', { 'sec-fetch-site': 'cross-site' })).status === 403);
  check('public Funnel request is refused even with the expected host', (await http('/', 'GET', '', { 'tailscale-funnel-request': '?1' })).status === 403);
  check('static traversal is not served', (await http('/../package.json')).status === 404);
  check('pairing is unavailable through the legacy loopback interface', (await http('/api/v1/pair', 'POST', '{}',
    { host: `127.0.0.1:${port}`, origin: undefined, authorization: `Bearer ${'t'.repeat(32)}` })).status === 404);
  const stale = sessions.beginPairing(origin); now += PAIRING_TTL_MS;
  rejects('expired challenge cannot enroll a device', () => sessions.pair({ challenge: stale.code, deviceId: id, name: 'Phone', secret }), 'pairing_expired');
  const replaced = sessions.beginPairing(origin); const challenge = sessions.beginPairing(origin);
  rejects('new pairing invalidates the previous challenge', () => sessions.pair({ challenge: replaced.code, deviceId: id, name: 'Phone', secret }), 'pairing_expired');
  const body = JSON.stringify({ challenge: challenge.code, deviceId: id, name: 'My Phone', secret });
  const pair = await http('/api/v1/pair', 'POST', body); useSession(pair);
  check('single-use pairing persists a separate device', pair.status === 200 && fixture.devices.inventory().devices[0]?.name === 'My Phone');
  check('session cookie has Secure, HttpOnly, Strict and host-only prefix', /__Host-ade-session=.*; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800/.test(pair.headers['set-cookie']![0]!));
  check('pairing returns no device secret or listener token', !pair.body.includes(secret) && !pair.body.includes('t'.repeat(32)));
  check('pairing replay is refused', (await http('/api/v1/pair', 'POST', body)).status === 401);
  check('paired signed session can read catalog', (await http('/api/v1/catalog')).body.includes('Mobile project'));
  const catalogName = fixture.store.config.agents[0]!.name;
  fixture.store.config.agents[0]!.name = 'Agent at C:\\Users\\secret\\project token=private-value';
  const unsafeCatalog = await http('/api/v1/catalog');
  check('catalog free text is wire-redacted as well as projected', !unsafeCatalog.body.includes('Users') && !unsafeCatalog.body.includes('private-value'));
  fixture.store.config.agents[0]!.name = catalogName;
  check('cookie without device signature cannot read data', (await http('/api/v1/catalog', 'GET', '', { 'x-ade-signature': 'v1=bad' })).status === 401);
  check('device signature without session cannot read data', (await http('/api/v1/catalog', 'GET', '', { cookie: '' })).status === 401);
  const taskBody = JSON.stringify({ agentId: 'builder', repositoryId: 'repo', prompt: 'Test mobile task', name: 'Protocol task' });
  const taskKey = 'mobile-task-0001';
  const taskHeaders = headers('/api/v1/tasks', 'POST', taskBody, taskKey);
  check('command without CSRF has no effect', (await http('/api/v1/tasks', 'POST', taskBody, { ...taskHeaders, 'x-ade-csrf': '' })).status === 403 && fixture.launched.length === 0);
  check('body signature mismatch has no effect', (await http('/api/v1/tasks', 'POST', taskBody + ' ', { ...taskHeaders, 'content-length': String(Buffer.byteLength(taskBody) + 1) })).status === 401 && fixture.launched.length === 0);
  const [submitted, duplicate] = await Promise.all([http('/api/v1/tasks', 'POST', taskBody, taskHeaders), http('/api/v1/tasks', 'POST', taskBody, taskHeaders)]);
  check('concurrent browser retry launches exactly one task', submitted.status === 200 && duplicate.status === 200 && fixture.launched.length === 1);
  check('private workspace paths do not reach browser response', !submitted.body.includes(root) && !submitted.body.includes('workspaceDir'));
  check('a short prompt cannot escape through an automatic task title', !submitted.body.includes('Test mobile task') && JSON.parse(submitted.body).run.name === 'Protocol task');
  const mismatch = JSON.stringify({ agentId: 'builder', repositoryId: 'repo', prompt: 'Different task' });
  check('same key with changed payload is rejected', (await http('/api/v1/tasks', 'POST', mismatch, headers('/api/v1/tasks', 'POST', mismatch, taskKey))).status === 409);
  const runId = JSON.parse(submitted.body).run.id as string;
  const cancelPath = `/api/v1/runs/${runId}/cancel`;
  check('signed browser cancellation reaches the coordinator', (await http(cancelPath, 'POST', '', headers(cancelPath, 'POST', '', 'mobile-cancel-01'))).status === 200);
  fixture.store.config.journalRetention.prunedSeq = fixture.application.journalCursor();
  let resetFrame = '';
  await new Promise<void>((done, reject) => {
    const path = '/api/v1/events?cursor=1';
    const req = request({ host: '127.0.0.1', port, path, headers: { ...headers(path), accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8'); res.on('data', (chunk) => { resetFrame += chunk; if (resetFrame.includes('event: snapshot')) { res.destroy(); done(); } });
      res.on('error', () => undefined);
    }); req.on('error', reject); req.end();
  });
  check('cursor behind archived records gets an authoritative snapshot', resetFrame.includes('event: snapshot'));
  let streamClosed = false; let stream: IncomingMessage | undefined;
  await new Promise<void>((resolveStream, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/v1/events', headers: { ...headers('/api/v1/events'), accept: 'text/event-stream' } }, (res) => {
      stream = res; res.on('data', () => resolveStream()); res.on('close', () => { streamClosed = true; });
    }); req.on('error', reject); req.end();
  });
  check('paired browser opens a real event stream', server.streamClientCount() === 1);
  fixture.devices.revoke(id);
  await new Promise((resolveWait) => setTimeout(resolveWait, 60));
  check('desktop revocation closes the browser stream immediately', streamClosed && server.streamClientCount() === 0);
  stream?.destroy();
  check('revoked browser cannot authenticate a new session', (await http('/api/v1/session', 'POST')).status === 401);
  let limited = false;
  for (let attempt = 0; attempt < 31; attempt++) if ((await http('/api/v1/pair', 'POST', body)).status === 429) limited = true;
  check('pairing attempts are rate-limited with a bounded counter', limited);
  const restored = new RemoteDeviceStore(join(root, 'remote'), fixtureProtection);
  check('revocation survives host restart', restored.activeDevices().length === 0 && restored.inventory().devices[0]?.revokedAt !== null);
  const next = sessions.beginPairing(origin);
  const tablet = sessions.pair({ challenge: next.code, deviceId: 'tablet', name: 'Tablet', secret: 'z'.repeat(43) });
  check('another device can still pair after revocation', tablet.info.deviceId === 'tablet');
  const previous = tablet.cookie;
  const rotated = sessions.issue('tablet', previous);
  check('authentication rotates and invalidates the previous session', !sessions.get(previous, 'tablet') && !!sessions.get(rotated.cookie, 'tablet'));
  const activeSession = sessions.get(rotated.cookie, 'tablet')!;
  rejects('CSRF token from another session cannot authorize a mutation', () => sessions.requireCsrf(activeSession, csrf), 'csrf_required');
  rejects('non-ASCII CSRF cannot bypass constant-time comparison', () => sessions.requireCsrf(activeSession, 'ü'.repeat(43)), 'csrf_required');
  now += SESSION_TTL_MS;
  check('expired session fails closed', !sessions.get(rotated.cookie, 'tablet'));
  const logs = readFileSync(fixture.devices.auditPath, 'utf8');
  check('durable audit includes pairing, authentication, command and revocation', ['device:pair', 'session:authenticate', 'runTask:submit', 'device:revoke'].every((item) => logs.includes(item)));
  check('audit contains no pairing challenge, key, session cookie or prompt', ![challenge.code, secret, cookie, 'Test mobile task'].some((item) => logs.includes(item)));
  appendFileSync(fixture.devices.auditPath, 'torn');
  rejects('audit failure prevents new session issuance', () => sessions.issue('tablet'));
  check('audit failure disables all active device proofs', fixture.devices.activeDevices().length === 0);

  for (const channel of ['mobileAccess:status', 'mobileAccess:setEnabled', 'mobileAccess:pair', 'mobileAccess:cancelPair'] as const) {
    check('mobile lifecycle stays desktop-only', CHANNEL_POLICY[channel].surface === 'desktop');
  }
  rejects('mobile configuration rejects arbitrary ports', () => assertIpcPayload('mobileAccess:setEnabled', { enabled: true, port: 8080 }));
  rejects('mobile configuration requires boolean opt-in', () => assertIpcPayload('mobileAccess:setEnabled', { enabled: 'true' }));

  let config: Record<string, unknown> = {};
  const calls: string[][] = [];
  const tailscale = new TailscaleService(async (args) => {
    calls.push([...args]);
    if (args[0] === 'status') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'ade-mobile.fixture.ts.net.', Online: true } });
    if (args[1] === 'status') return JSON.stringify(config);
    if (args.includes('off')) config = {};
    else config = { TCP: { '443': { HTTPS: true } }, Web: { 'ade-mobile.fixture.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4317' } } } } };
    return '';
  });
  check('connected Tailscale without a route is ready for opt-in', (await tailscale.inspect(4317)).state === 'ready');
  await tailscale.enable(4317);
  check('enable uses fixed argv and a loopback target', calls.some((args) => args.join(' ') === 'serve --bg --https=443 http://127.0.0.1:4317'));
  check('enable verifies the exact HTTPS proxy', (await tailscale.inspect(4317)).serving);
  config.AllowFunnel = { 'ade-mobile.fixture.ts.net:443': true };
  check('Funnel is rejected', (await tailscale.inspect(4317)).state === 'conflict');
  const count = calls.filter((args) => args.includes('off')).length;
  await tailscale.disable(4317);
  check('disable preserves conflicting configuration', calls.filter((args) => args.includes('off')).length === count);
  delete config.AllowFunnel;
  await tailscale.disable(4317);
  check('disable only removes the matching HTTPS service', calls.some((args) => args.join(' ') === 'serve --https=443 off'));
  config = { TCP: { '443': { HTTPS: true } }, Web: { 'ade-mobile.fixture.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } };
  check('unrelated HTTPS route is never overwritten', (await tailscale.inspect(4317)).state === 'conflict');
  check('missing Tailscale has an actionable state', (await new TailscaleService(async () => { throw new Error('tailscale_missing'); }).inspect(4317)).state === 'missing');
  const positive = new RemoteDeviceStore(join(root, 'positive'), fixtureProtection);
  positive.enroll('positive', 'Final positive control', 'p'.repeat(43));
  check('final positive pairing persists after negative controls', new RemoteDeviceStore(join(root, 'positive'), fixtureProtection).activeDevices().length === 1);

  const assets = join(root, 'shell'); mkdirSync(assets); writeFileSync(join(assets, 'index.html'), '<html>Fixture shell</html>'); writeFileSync(join(assets, 'sw.js'), '// fixture');
  const reservation = createServer(); await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const reserved = reservation.address(); if (!reserved || typeof reserved === 'string') throw new Error('no reserved port');
  const controllerPort = reserved.port; await new Promise<void>((done) => reservation.close(() => done()));
  let serving = false;
  const controllerTail = new TailscaleService(async (args) => {
    if (args[0] === 'status') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'ade-mobile.fixture.ts.net.', Online: true } });
    if (args[1] === 'status') return JSON.stringify(serving ? { TCP: { '443': { HTTPS: true } }, Web: { 'ade-mobile.fixture.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${controllerPort}` } } } } } : {});
    serving = !args.includes('off'); return '';
  });
  let httpsVerified = false;
  let controller = new MobileAccessController(fixture.application, positive, assets, controllerTail, controllerPort, false, async () => httpsVerified);
  try {
    check('controller defaults to disabled without configuring Tailscale', !(await controller.status()).enabled && !serving);
    check('explicit enable confirms listener and private proxy', (await controller.setEnabled(true)).listening && serving);
    check('configured route never claims verified HTTPS after a failed probe', (await controller.status()).https === 'unreachable');
    httpsVerified = true;
    check('a final positive certificate probe marks HTTPS verified', (await controller.setEnabled(true)).https === 'verified');
    await controller.dispose();
    check('shutdown leaves explicit opt-in and owned route durable', positive.mobilePreferences().enabled && positive.mobilePreferences().ownsServe && serving);
    controller = new MobileAccessController(fixture.application, positive, assets, controllerTail, controllerPort, false, async () => httpsVerified);
    await controller.restore();
    check('restart restores the enabled listener and pairing service', (await controller.status()).listening && (await controller.beginPairing()).url.startsWith(origin));
    await controller.dispose();
    const collision = createServer();
    await new Promise<void>((done) => collision.listen(controllerPort, '127.0.0.1', done));
    controller = new MobileAccessController(fixture.application, positive, assets, controllerTail, controllerPort, false, async () => httpsVerified, 25);
    try {
      await controller.restore();
      const blocked = await controller.status();
      check('startup collision preserves opt-in but does not claim a listener', blocked.enabled && !blocked.listening && blocked.message.includes('EADDRINUSE'));
    } finally { await new Promise<void>((done) => collision.close(() => done())); }
    const recoveryDeadline = Date.now() + 3_000;
    while (!(await controller.status()).listening && Date.now() < recoveryDeadline) await new Promise((done) => setTimeout(done, 30));
    const recovered = await controller.status();
    check('persisted opt-in automatically recovers after a startup port collision', recovered.listening && recovered.https === 'verified');
    check('startup recovery retains the same paired identity', positive.activeDevices()[0]?.id === 'positive');
    check('disable stops listener and removes only its owned route', !(await controller.setEnabled(false)).enabled && !serving);
    check('opt-out survives vault reload', !new RemoteDeviceStore(join(root, 'positive'), fixtureProtection).mobilePreferences().enabled);
  } finally { await controller.dispose(); }
})().catch((error) => { failed++; console.error(error); }).finally(async () => {
  sessions.dispose(); await server.stop();
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('unexpected fixture root');
  rmSync(root, { recursive: true, force: true });
  console.log(`\nMobile access: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
