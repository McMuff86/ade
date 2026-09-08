import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { validateAvatarPng } from '../src/main/application/RemoteProfileService';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean): void => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, action: () => unknown, code?: string): Promise<void> {
  try { await action(); check(name, false); } catch (error) { check(name, !code || error instanceof RemoteApiError && error.code === code); }
}
const root = mkdtempSync(join(tmpdir(), 'ade-profile-'));
void (async () => {
  const { application: app, store, devices } = createRemoteWorkspaceFixture(root);
  devices.enroll('tablet', 'Tablet', 'd'.repeat(40));
  const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature',
    scopes: new Set(devices.activeDevices().find((device) => device.id === 'tablet')!.scopes) }, idempotencyKey: randomUUID(), requestId: 'profile-test' });
  const original = store.get().agents.find((agent) => agent.id === 'builder')!;
  const initial = app.queryProfile(context(), { agentId: 'builder' });
  check('paired device can read bounded profile metadata', initial.agent.name === 'Builder' && /^[a-f0-9]{64}$/.test(initial.revision));
  const input = { agentId: 'builder', revision: initial.revision, name: 'Remote Builder', role: 'Reviewer' };
  await refuses('profile mutation needs separate desktop grant', () => app.updateProfile(context(), input), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['profiles:write']);
  store.save({ runWorkspaceLeases: [{ id: 'lease', runId: 'run', participantId: 'participant', agentId: 'builder', workspaceDir: original.workspaceDir!,
    isRepo: false, branch: '', commonGitDir: '', baseSha: '', status: 'active', acquiredAt: Date.now() }] });
  await refuses('active managed identity cannot change its profile', () => app.updateProfile(context(), input), 'command_rejected');
  store.save({ runWorkspaceLeases: [] });
  for (const extra of [{ customCommand: 'injected' }, { runtime: 'shell' }, { memoryDir: root }, { photo: { bytesBase64: 'bad', path: root } }]) {
    await refuses('profile refuses arbitrary configuration or photo path', () => app.updateProfile(context(), { ...input, ...extra }), 'invalid_payload');
  }
  const png = new PNG({ width: 32, height: 32 }); png.data.fill(140); const bytes = PNG.sync.write(png);
  writeFileSync(join(original.memoryDir, 'AGENTS.md'), '# Operator-owned guidance\nKeep this instruction.\n');
  const photoInput = { ...input, photo: { bytesBase64: bytes.toString('base64') } }; const photoContext = context();
  await app.updateProfile(photoContext, photoInput); const profile = app.queryProfile(context(), { agentId: 'builder' });
  check('photo upload updates shared agent profile with an opaque revision', profile.agent.name === 'Remote Builder' && profile.agent.role === 'Reviewer' && !!profile.agent.photoVersion && profile.revision !== initial.revision);
  check('photo read is a valid bounded PNG projection', !!profile.photo && profile.photo.mime === 'image/png' && Buffer.from(profile.photo.bytesBase64, 'base64').length < 32 * 1024);
  const updated = store.get().agents.find((agent) => agent.id === 'builder')!;
  check('profile edit preserves runtime, command, identity and memory', updated.id === original.id && updated.runtime === original.runtime && updated.customCommand === original.customCommand && updated.memoryDir === original.memoryDir);
  const instructions = readFileSync(join(original.memoryDir, 'AGENTS.md'), 'utf8');
  check('profile update synchronizes durable role instructions and preserves operator text', instructions.includes('Remote Builder') && instructions.includes('Reviewer') && instructions.includes('Keep this instruction.'));
  check('catalog contains photo version rather than storage filename', !!app.catalog().agents.find((agent) => agent.id === 'builder')!.photoVersion && !JSON.stringify(app.catalog()).includes(updated.photo!));
  const replay = await app.updateProfile(photoContext, photoInput);
  check('duplicate upload creates exactly one stored image', replay.replayed && readdirSync(join(root, 'photos')).length === 1);
  await refuses('stale profile revision cannot overwrite a newer edit', () => app.updateProfile(context(), input), 'command_rejected');
  await refuses('SVG cannot masquerade as a PNG upload', () => app.updateProfile(context(), { ...input, revision: profile.revision, photo: { bytesBase64: Buffer.from('<svg onload="x"/>').toString('base64') } }), 'command_rejected');
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  await refuses('invalid PNG checksum is rejected before native decode', () => validateAvatarPng(corrupt), 'command_rejected');
  const huge = Buffer.from(bytes); huge.writeUInt32BE(1000000, 16);
  await refuses('oversized dimensions rejected before decompression', () => validateAvatarPng(huge), 'command_rejected');
  await refuses('trailing data cannot be smuggled with photo', () => validateAvatarPng(Buffer.concat([bytes, Buffer.from('private metadata')])), 'command_rejected');
  const linkedMemory = join(root, 'linked-memory'); symlinkSync(original.memoryDir, linkedMemory, process.platform === 'win32' ? 'junction' : 'dir');
  store.save({ agents: store.get().agents.map((agent) => agent.id === 'builder' ? { ...agent, memoryDir: linkedMemory } : agent) });
  await refuses('linked instruction directory blocks profile writes', () => app.updateProfile(context(), { ...input, revision: profile.revision }), 'command_rejected');
  store.save({ agents: store.get().agents.map((agent) => agent.id === 'builder' ? { ...agent, memoryDir: original.memoryDir } : agent) });
  const stale = context(); devices.revoke('tablet');
  await refuses('revoked device cannot read a profile using stale principal', () => app.queryProfile(stale, { agentId: 'builder' }), 'unknown_device');
  await refuses('revoked device cannot mutate profile', () => app.updateProfile(stale, { ...input, revision: profile.revision }), 'scope_not_granted');
  devices.enroll('second', 'Second', 'e'.repeat(40)); devices.setAdminScopes('second', ['profiles:write']);
  const second: RemoteCommandContext = { ...stale, principal: { id: 'second', kind: 'device', proof: 'device-signature', scopes: new Set(['read', 'profiles:write']) }, idempotencyKey: randomUUID() };
  await app.updateProfile(second, { ...input, revision: profile.revision, photo: null });
  check('final positive removal restores initials without deleting shared image storage', !app.queryProfile(second, { agentId: 'builder' }).photo && !store.get().agents.find((agent) => agent.id === 'builder')!.photo);
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  rmSync(root, { recursive: true, force: true }); console.log(`Remote profiles: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
