/** Persisted folder identities survive a changed mount device number (btrfs) but still catch a replaced folder. */
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyIdentity, stableIdentity } from '../src/main/repositories/directoryIdentity';
import { projectRootIdentity } from '../src/main/settings/ProjectDefaultsService';
import { normalizeConfig } from '../src/main/orchestration/migrate';
import { DEFAULT_CONFIG, type AdeConfig } from '../src/shared/types';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const root = mkdtempSync(join(tmpdir(), 'ade-identity-'));
try {
  const folder = join(root, 'Work'); mkdirSync(folder);
  const stat = lstatSync(folder);
  const birthKnown = stat.birthtimeMs > 0;

  check('a different mount device number keeps the identity when a creation time exists',
    stableIdentity({ dev: 55, ino: 10464, birthtimeMs: 1790627279355.2158 }) === stableIdentity({ dev: 57, ino: 10464, birthtimeMs: 1790627279355.2158 }));
  check('without a creation time the device number stays part of the identity',
    stableIdentity({ dev: 55, ino: 10464, birthtimeMs: 0 }) !== stableIdentity({ dev: 57, ino: 10464, birthtimeMs: 0 }));
  check('another inode is another folder', stableIdentity({ dev: 55, ino: 1, birthtimeMs: 5 }) !== stableIdentity({ dev: 55, ino: 2, birthtimeMs: 5 }));
  check('another creation time is another folder', stableIdentity({ dev: 55, ino: 1, birthtimeMs: 5 }) !== stableIdentity({ dev: 55, ino: 1, birthtimeMs: 6 }));

  const current = projectRootIdentity(folder);
  check('projectRootIdentity uses the stable form of the real folder', current === stableIdentity(stat));
  // The reported case: stored with dev 55 before a reboot, mounted as dev 57 now.
  const storedBeforeReboot = `${stat.dev + 2}:${stat.ino}:${stat.birthtimeMs}`;
  check('a legacy identity from another mount device matches the folder after migration',
    !birthKnown || migrateLegacyIdentity(storedBeforeReboot) === current);
  rmSync(folder, { recursive: true }); mkdirSync(folder);
  check('negative control: a folder recreated at the same path is still rejected', projectRootIdentity(folder) !== current);
  check('negative control: the migrated legacy identity does not match the replacement either',
    migrateLegacyIdentity(storedBeforeReboot) !== projectRootIdentity(folder));

  check('legacy directory identity drops the device number', migrateLegacyIdentity('55:10464:1790627279355.2158') === '10464:1790627279355.2158');
  check('legacy Git link file identity drops the device number',
    migrateLegacyIdentity('55:77:1790627279355.2158:41:1790627280000.5') === '77:1790627279355.2158:41:1790627280000.5');
  check('identities without a creation time are kept unchanged', migrateLegacyIdentity('55:10464:0') === '55:10464:0'
    && migrateLegacyIdentity('55:77:0:41:1790627280000') === '55:77:0:41:1790627280000');
  check('migration is idempotent', migrateLegacyIdentity('10464:1790627279355.2158') === '10464:1790627279355.2158'
    && migrateLegacyIdentity('77:1790627279355.2158:41:1790627280000.5') === '77:1790627279355.2158:41:1790627280000.5');
  check('unrecognised values are not rewritten', ['fixture', '', 'a:b:c', '1:2:3:4'].every((value) => migrateLegacyIdentity(value) === value));

  const workspace = {
    id: 'w1', repositoryId: 'r1', workspaceDir: '/home/u/Work/p', gitDirectory: '/home/u/Work/p/.git', kind: 'checkout', createdAt: 1,
    directoryIdentity: '55:10:1790627279355.2158', gitDirectoryIdentity: '55:11:1790627279356.5',
    gitPointerIdentity: '55:11:1790627279356.5', commonGitIdentity: '55:11:1790627279356.5',
  } as unknown as AdeConfig['projectWorkspaces'][number];
  const settled = normalizeConfig(normalizeConfig(structuredClone(DEFAULT_CONFIG)).config).config;
  const legacy: AdeConfig = { ...structuredClone(settled), projectWorkspaces: [workspace],
    settings: { ...settled.settings, projectDefaults: { rootPath: '/home/u/Work', rootIdentity: '55:10464:1790627279355.2158' } } };
  const migrated = normalizeConfig(legacy);
  check('config load rewrites the stored project root identity', migrated.config.settings.projectDefaults?.rootIdentity === '10464:1790627279355.2158');
  check('config load rewrites all stored workspace identities',
    migrated.config.projectWorkspaces[0]!.directoryIdentity === '10:1790627279355.2158'
    && migrated.config.projectWorkspaces[0]!.gitDirectoryIdentity === '11:1790627279356.5'
    && migrated.config.projectWorkspaces[0]!.gitPointerIdentity === '11:1790627279356.5'
    && migrated.config.projectWorkspaces[0]!.commonGitIdentity === '11:1790627279356.5');
  check('the rewritten identities are persisted once', migrated.migrated);
  check('other workspace and project default fields are kept', migrated.config.projectWorkspaces[0]!.workspaceDir === '/home/u/Work/p'
    && migrated.config.settings.projectDefaults?.rootPath === '/home/u/Work');
  check('an already migrated config is not marked for another write', !normalizeConfig(structuredClone(migrated.config)).migrated);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`Directory identity: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
