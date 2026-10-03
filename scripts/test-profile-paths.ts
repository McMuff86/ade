/**
 * Goal 34.6 H1c: explicit profile paths must not move the profile.
 *
 * Before H1c each store derived its location from Electron's
 * app.getPath('userData'); now index.ts derives them once through
 * host/profilePaths.ts. This suite pins every derivation to the old formula
 * (including the personal ~/.config/ade profile and an ADE_USER_DATA_DIR
 * override), proves the stores write where they did, and that a missing path
 * or encryptor fails instead of falling back to Electron. The Electron
 * workflow driver additionally compares app.getPath('userData') of a real run
 * with where the config is written.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, photosDir, profilePaths } from '../src/main/host/profilePaths';
import { ConfigStore } from '../src/main/config/store';
import { HarnessCredentialService } from '../src/main/settings/HarnessCredentialService';
import { importPhoto } from '../src/main/photos';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

const personal = join(homedir(), '.config', 'ade');
for (const [label, userData] of [['personal profile ~/.config/ade', personal], ['ADE_USER_DATA_DIR override', '/tmp/ade-isolated/profile']] as const) {
  const paths = profilePaths(userData);
  // The formulas the stores used before H1c (ipc.ts, store.ts, identity.ts, photos.ts).
  check(`${label}: profileDir equals join(userData, 'ade')`, paths.profileDir === join(userData, 'ade'));
  check(`${label}: config path equals join(userData, 'ade', 'config.json')`, configPath(paths) === join(userData, 'ade', 'config.json'));
  check(`${label}: photos dir equals join(userData, 'ade', 'photos')`, photosDir(paths) === join(userData, 'ade', 'photos'));
  check(`${label}: userData is passed through unchanged`, paths.userData === userData);
}
check('the personal profile resolves to ~/.config/ade/ade/config.json as before', configPath(profilePaths(personal)) === join(homedir(), '.config', 'ade', 'ade', 'config.json'));

const root = mkdtempSync(join(tmpdir(), 'ade-profile-paths-'));
try {
  const paths = profilePaths(join(root, 'userData'));
  const store = new ConfigStore(configPath(paths));
  store.save({ settings: { ...store.get().settings, claudeAccountUsage: true } });
  check('ConfigStore writes exactly the derived config path', existsSync(join(root, 'userData', 'ade', 'config.json')));
  const encryptor = { available: () => true, encrypt: (v: string) => Buffer.from(`enc:${v}`), decrypt: (b: Buffer) => b.toString().slice(4) };
  new HarnessCredentialService(paths.userData, encryptor).set('codex', 'sk-test-profile-paths');
  check('harness credentials stay at <userData>/ade/harness-credentials.json',
    existsSync(join(root, 'userData', 'ade', 'harness-credentials.json'))
    && !readFileSync(join(root, 'userData', 'ade', 'harness-credentials.json'), 'utf8').includes('sk-test-profile-paths'));
  const { file } = importPhoto({ mime: 'image/png', bytesBase64: Buffer.from('png-bytes').toString('base64') }, photosDir(paths));
  check('imported photos land in the derived photos dir', existsSync(join(root, 'userData', 'ade', 'photos', file)));

  check('negative: an empty user-data directory is refused', throws(() => profilePaths('')));
  check('negative: ConfigStore without a path throws instead of asking Electron', throws(() => new ConfigStore('' as string)));
  check('negative: harness credentials without an encryptor throw instead of loading safeStorage',
    throws(() => new HarnessCredentialService(paths.userData, undefined as never)));

  const index = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const overrideAt = index.indexOf("app.setPath('userData', userDataOverride)");
  const derivedAt = index.indexOf("profilePaths(app.getPath('userData'))");
  check('index.ts derives the profile from app.getPath("userData") after applying ADE_USER_DATA_DIR',
    overrideAt > 0 && derivedAt > overrideAt && index.includes('new ConfigStore(configPath(paths))'));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
