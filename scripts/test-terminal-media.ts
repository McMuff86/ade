import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomFillSync } from 'node:crypto';
import { PNG } from 'pngjs';
import { TerminalImageStore } from '../src/main/application/TerminalImageStore';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { terminalWebLinks, completeTerminalLink } from '../src/shared/terminalLinks';
import { terminalPngDimensions } from '../src/shared/terminalImages';
import { ProtectedPromptWriter } from '../src/main/pty/ProtectedPromptWriter';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteTerminalService } from '../src/main/application/RemoteTerminalService';
import { AdeApplicationService, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { HostRestartController } from '../src/main/application/HostRestartController';
import type { MobileTerminalState } from '../src/shared/remote';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer, sha256Hex, signRequest } from '../src/main/remote/authorization';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function refuses(name: string, action: () => unknown, message?: RegExp) {
  try { await action(); } catch (error) { check(name, !message || message.test(String(error))); return; } throw new Error(`${name}: unexpectedly accepted`);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-terminal-media-')));
let terminal: RemoteTerminalService | undefined;
let server: HostApiServer | undefined;
let fixture: ReturnType<typeof createRemoteWorkspaceFixture> | undefined;
void (async () => {
  check('URLs retain query, fragment and balanced parentheses', terminalWebLinks('Siehe https://example.org/a(b)?x=2#result.')[0]?.href === 'https://example.org/a(b)?x=2#result');
  check('Markdown closing punctuation is excluded', terminalWebLinks('[Öffnen](https://example.org/a).')[0]?.text === 'https://example.org/a');
  check('only HTTP(S) visible URLs become links', terminalWebLinks('javascript:alert(1) file:///C:/foo data:text/html,test').length === 0);
  check('embedded credentials and redacted paths stay plain text', terminalWebLinks('https://secret@example.org/a https://example.org/[redacted]').length === 0);
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.1', 'http://[::1]:8000', 'http://0.0.0.0', 'http://dev.localhost', 'http://localhost.:5173']) check('loopback addresses require an explicit tablet address', terminalWebLinks(url)[0]?.local === true);
  check('private reachable project addresses remain clickable', terminalWebLinks('https://pc.example.ts.net/rhino')[0]?.local === false);
  check('link lists have a bounded size', terminalWebLinks(Array(200).fill('https://example.org').join(' ')).length === 100);
  check('wrapped URL prefix resolves to the complete visible link', completeTerminalLink(terminalWebLinks('https://example.org/long')[0]!, 'https://example.org/long-address')?.href === 'https://example.org/long-address');
  check('ambiguous wrapped URLs cannot open a truncated destination', !completeTerminalLink(terminalWebLinks('https://example.org/long')[0]!, 'https://example.org/long-one https://example.org/long-two'));
  const png = new PNG({ width: 32, height: 32 }); png.data.fill(255); const bytes = PNG.sync.write(png);
  const images = new TerminalImageStore(join(root, 'images'), new ExecutionBackendService(), value => PNG.sync.write(PNG.sync.read(value)));
  await refuses('non-image data rejected before storage', () => images.put('owner', 'terminal', 'native', Buffer.from('not png'), () => {}));
  const bomb = Buffer.from(bytes); bomb.writeUInt32BE(100000, 16);
  await refuses('oversized dimensions rejected before decoding', () => terminalPngDimensions(bomb));
  let allowed = true; const authorize = () => { if (!allowed) throw new Error('revoked'); };
  const image = await images.put('owner', 'terminal', 'native', bytes, authorize);
  check('upload returns only bounded image metadata', image.width === 32 && image.height === 32 && !JSON.stringify(image).includes(root));
  const file = await images.path('owner', 'terminal', 'native', image.id);
  check('stored PNG is readable and normalized', PNG.sync.read(readFileSync(file)).width === 32);
  await refuses('another device cannot use an image', () => images.path('other', 'terminal', 'native', image.id));
  await refuses('another session cannot use an image', () => images.path('owner', 'other', 'native', image.id));
  await refuses('another backend cannot use an image', () => images.path('owner', 'terminal', 'wsl:Ubuntu', image.id));
  const alias = join(root, 'hardlink.png'); linkSync(file, alias);
  await refuses('hardlinked images are refused before delivery', () => images.path('owner', 'terminal', 'native', image.id)); unlinkSync(alias);
  const original = readFileSync(file); writeFileSync(file, Buffer.alloc(original.length));
  await refuses('changed image is refused before delivery', () => images.path('owner', 'terminal', 'native', image.id)); writeFileSync(file, original);
  allowed = false;
  await refuses('revoked ownership prevents upload', () => images.put('owner', 'terminal', 'native', bytes, authorize)); allowed = true;
  check('positive image still valid after negative controls', (await images.path('owner', 'terminal', 'native', image.id)) === file);
  if (process.argv.includes('--wsl')) {
    const backend = 'wsl:Ubuntu' as const;
    const staged = await images.put('owner', 'wsl-terminal', backend, bytes, authorize);
    check('real WSL backend stores a PNG in its own private filesystem', /^\/tmp\/ade-terminal-images-\d+\//.test(await images.path('owner', 'wsl-terminal', backend, staged.id)));
    await refuses('WSL image cannot be used by another session', () => images.path('owner', 'other', backend, staged.id));
  }
  const parts: string[] = []; let step = 0;
  const writer = new ProtectedPromptWriter({ check: authorize, write: (_id, text) => { parts.push(text); } }, async () => { step++; });
  await writer.write('session', ['\x1b[200~image.png\x1b[201~', '\x1b[200~Was ist zu sehen?\x1b[201~\r'], authorize);
  check('image and message are separate pastes followed by one delayed Enter', parts.length === 3 && parts[2] === '\r' && step === 2);
  const revokedWriter = new ProtectedPromptWriter({ check: authorize, write: (_id, text) => { parts.push(text); } }, async () => { allowed = false; });
  await refuses('revocation between image and message prevents further input', () => revokedWriter.write('session', ['image', 'message'], authorize)); allowed = true;
  check('partially delivered attachment cannot submit a message', parts.length === 4 && parts.at(-1) === 'image');

  fixture = createRemoteWorkspaceFixture(join(root, 'fixture'));
  const { store, devices, sessions, workbench, ledger, gate } = fixture;
  devices.enroll('tablet', 'Tablet', 'd'.repeat(40)); devices.enroll('other', 'Other', 'e'.repeat(40));
  for (const id of ['tablet', 'other']) devices.setAdminScopes(id, ['catalog:write', 'workspace:read', 'terminal:control']);
  const context = (id = 'tablet'): RemoteCommandContext => ({ principal: { id, kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices().find(item => item.id === id)!.scopes) }, idempotencyKey: randomUUID(), requestId: 'media-test' });
  const repo = (await fixture.application.administer(context(), { operation: 'project-create', input: { name: 'Images' } })).created!.id;
  const selection = { agentId: 'builder', repositoryId: repo };
  await fixture.application.administer(context(), { operation: 'workspace-prepare', input: selection });
  const binding = store.get().workspaceBindings.find(item => item.repositoryId === repo)!;
  const writes: (string | readonly string[])[] = [];
  terminal = new RemoteTerminalService(workbench, { list: () => sessions,
    create: async (agentId, repositoryId, workspaceBindingId) => {
      const session = { id: 'simage', agentId, repositoryId: repositoryId!, workspaceBindingId, workspaceDir: binding.workspaceDir, runtime: 'codex' as const,
        executionBackend: 'native' as const, kind: 'interactive' as const, title: 'Codex', status: 'running' as const, createdAt: Date.now() };
      sessions.push(session); return session;
    }, attach: () => ({ replayBase64: '', sequence: 1 }), resize: () => {}, kill: () => {}, write: () => {},
    promptCapability: () => ({ available: true }), writePrompt: async (_id, value, authorize) => { await authorize(); writes.push(value); },
  }, id => devices.activeDevices().some(item => item.id === id && item.scopes.includes('terminal:control')), entry => devices.audit(entry), undefined, undefined, undefined, images);
  const application = new AdeApplicationService(store, fixture.orchestration, { status: () => ({ active: 0, queued: 0, maxActive: 4 }) }, {
    terminals: terminal, deviceActive: id => devices.activeDevices().some(item => item.id === id),
    administration: { ledger, restart: new HostRestartController(gate, () => [], () => {}, 'fixture', true) },
  });
  const opened = await application.remoteTerminal(context(), { ...selection, operation: 'open', mode: 'codex' }, 'command') as { terminalId: string };
  const state = await application.remoteTerminal(context(), { ...selection, terminalId: opened.terminalId }, 'query') as MobileTerminalState;
  const target = { ...selection, terminalId: opened.terminalId, leaseId: state.leaseId! };
  check('Codex exposes image capability', state.imageCapability?.available === true);
  const payload = { ...target, pngBase64: bytes.toString('base64') }; const uploadContext = context();
  await refuses('upload requires device proof', () => application.remoteTerminalImage({ ...context(), principal: { ...context().principal, proof: 'bearer' } } as unknown as RemoteCommandContext, payload));
  await refuses('upload requires an idempotency key', () => application.remoteTerminalImage({ ...context(), idempotencyKey: undefined }, payload));
  await refuses('caller-selected destination paths are refused', () => application.remoteTerminalImage(context(), { ...payload, path: 'outside.png' }));
  await refuses('another device cannot upload into the input lease', () => application.remoteTerminalImage(context('other'), payload));
  const uploaded = await application.remoteTerminalImage(uploadContext, payload);
  const replayed = await application.remoteTerminalImage(uploadContext, payload);
  check('upload replay preserves one ID and does not duplicate files', uploaded.id === replayed.id && replayed.replayed && readdirSync(join(root, 'images')).length === 2);
  await refuses('upload key cannot be reused for another payload', () => application.remoteTerminalImage(uploadContext, { ...payload, pngBase64: Buffer.concat([bytes, Buffer.from('x')]).toString('base64') }));
  const prompt = { ...target, sequence: 1, text: 'Was ist auf diesem Screenshot?', mode: 'submit', cols: 80, rows: 24, imageIds: [uploaded.id] };
  const promptContext = context();
  await application.remotePrompt(promptContext, prompt);
  check('image path stays in main and precedes the message in one protected write', Array.isArray(writes[0]) && writes[0].length === 2 && writes[0][0].includes(uploaded.id) && writes[0][1].endsWith('\x1b[201~\r'));
  await application.remotePrompt(promptContext, prompt);
  check('prompt replay cannot attach or submit twice', writes.length === 1);
  await refuses('changed attachment cannot reuse prompt receipt', () => application.remotePrompt(promptContext, { ...prompt, imageIds: [image.id] }));
  await refuses('unknown attachment cannot submit', () => application.remotePrompt(context(), { ...prompt, sequence: 2, imageIds: [randomUUID()] }));
  sessions[0]!.runtime = 'claude';
  await refuses('unverified runtime image delivery fails closed', () => application.remoteTerminalImage(context(), payload)); sessions[0]!.runtime = 'codex';
  await application.remotePrompt(context(), { ...prompt, sequence: 2 });
  check('final authorized positive image prompt succeeds', writes.length === 2);
  const log = readFileSync(join(root, 'fixture', 'remote', 'commands.json'), 'utf8');
  check('durable receipts contain neither image bytes nor host paths', !log.includes(payload.pngBase64) && !log.includes(root.replace(/\\/g, '\\\\')));
  server = new HostApiServer(application, { authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, devices), port: 0 });
  const address = await server.start();
  const post = (path: string, body: unknown, key = randomUUID()) => {
    const serialized = JSON.stringify(body); const timestamp = String(Date.now());
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', body: serialized, headers: {
      authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json', 'x-ade-device': 'tablet', 'x-ade-timestamp': timestamp,
      'idempotency-key': key, 'x-ade-signature': signRequest('d'.repeat(40), { method: 'POST', path, timestamp, idempotencyKey: key, bodySha256: sha256Hex(serialized) }),
    } });
  };
  const noise = new PNG({ width: 180, height: 180 }); randomFillSync(noise.data); const pngBase64 = PNG.sync.write(noise).toString('base64');
  const httpImage = await post('/api/v1/terminal/images', { ...target, pngBase64 });
  check('signed image HTTP endpoint accepts an image above the ordinary JSON limit', httpImage.status === 200 && pngBase64.length > 65536);
  check('ordinary terminal input retains the 64 KiB limit', (await post('/api/v1/terminal/input', { data: pngBase64 })).status === 413);
  check('invalid PNG payload is rejected by the host decoder', (await post('/api/v1/terminal/images', { ...target, pngBase64: 'A'.repeat(80) })).status === 422);
  devices.setAdminScopes('tablet', ['workspace:read']);
  check('revoked terminal permission blocks image upload over HTTP', (await post('/api/v1/terminal/images', payload)).status === 403);
  devices.setAdminScopes('tablet', ['workspace:read', 'terminal:control']);
  check('final HTTP positive control passes after rejection', (await post('/api/v1/terminal/images', payload)).status === 200);
  console.log(`Terminal media: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Terminal media: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await server?.stop(); terminal?.dispose(); fixture?.workbench.dispose(); rmSync(root, { recursive: true, force: true }); });
