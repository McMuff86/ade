/**
 * Focused config-store durability checks.
 *
 * The config file is the only copy of the agent catalog, repository bindings,
 * the run journal and the publication audit. These checks pin the contract
 * that loading it can never destroy it: only a missing file seeds defaults,
 * every other failure preserves the original first, and a failed preservation
 * turns the store read-only.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, validateCompleteConfig } from '../src/main/config/store';
import { DEFAULT_CONFIG } from '../src/shared/types';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

function rejects(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

/** Each case gets its own config directory so quarantine names cannot collide. */
function caseDir(scratch: string, name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'config.json');
}

function quarantinedFiles(configPath: string): string[] {
  const dir = join(configPath, '..', 'corrupt');
  return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).sort() : [];
}

function run(): void {
  const scratch = mkdtempSync(join(tmpdir(), 'ade-config-store-'));
  try {
    /* -------------------------------------------------- first run and reload */

    const seedPath = caseDir(scratch, 'seed');
    const seeded = new ConfigStore(seedPath);
    check('a missing config file seeds defaults and writes them',
      seeded.getLoadFailure() === null
        && !seeded.readOnly
        && existsSync(seedPath)
        && seeded.get().categories.length === 0);

    seeded.save({ settings: { theme: 'light' } });
    const reloaded = new ConfigStore(seedPath);
    check('a valid config file reloads without a failure and keeps its values',
      reloaded.getLoadFailure() === null
        && reloaded.get().settings.theme === 'light'
        && quarantinedFiles(seedPath).length === 0);

    check('atomic writes leave no temp files behind',
      readdirSync(join(seedPath, '..')).every((entry) => !entry.endsWith('.tmp')));

    /* -------------------------------------------------------- malformed JSON */

    const malformedPath = caseDir(scratch, 'malformed');
    const malformedBytes = '{"categories": [{"id": "keep-me"}], "runs": [], ';
    writeFileSync(malformedPath, malformedBytes, 'utf8');
    const malformed = new ConfigStore(malformedPath);
    const malformedFailure = malformed.getLoadFailure();
    const malformedCopies = quarantinedFiles(malformedPath);
    check('invalid JSON is reported as malformed rather than silently discarded',
      malformedFailure?.reason === 'malformed'
        && malformedFailure.readOnly === false
        && malformedFailure.quarantinedTo === `corrupt/${malformedCopies[0]}`,
      malformedFailure);
    check('the original bytes are preserved byte-identically before defaults are seeded',
      malformedCopies.length === 1
        && readFileSync(join(malformedPath, '..', 'corrupt', malformedCopies[0]!), 'utf8')
          === malformedBytes);
    check('defaults reach disk only after the original is safe',
      (JSON.parse(readFileSync(malformedPath, 'utf8')) as { categories: unknown[] })
        .categories.length === 0
        && malformed.save({ settings: { theme: 'dark' } }).settings.theme === 'dark');
    check('the reported cause carries no absolute config path',
      !malformedFailure!.detail.includes(scratch)
        && malformedFailure!.detail.length > 0,
      malformedFailure?.detail);

    /* ------------------------------------------- valid JSON, refused content */

    const incompatiblePath = caseDir(scratch, 'incompatible');
    // `category.agents` must be iterable; a category with a repoPath reaches
    // the repository-scope migration, which throws on this record.
    writeFileSync(incompatiblePath, JSON.stringify({
      categories: [{ id: 'c1', name: 'Broken', kind: 'plain', repoPath: '/tmp/repo', agents: 42 }],
      agents: [],
      runs: [],
    }), 'utf8');
    const incompatible = new ConfigStore(incompatiblePath);
    check('a record that normalization refuses is quarantined, not overwritten in place',
      incompatible.getLoadFailure()?.reason === 'incompatible'
        && incompatible.getLoadFailure()?.readOnly === false
        && quarantinedFiles(incompatiblePath).length === 1
        && incompatible.get().categories.length === 0,
      incompatible.getLoadFailure());

    /* ------------------------------------------------------ unreadable entry */

    const unreadablePath = caseDir(scratch, 'unreadable');
    mkdirSync(unreadablePath); // reading it fails with EISDIR, not ENOENT
    const unreadable = new ConfigStore(unreadablePath);
    check('an unreadable config entry is preserved and reported',
      unreadable.getLoadFailure()?.reason === 'unreadable'
        && unreadable.getLoadFailure()?.readOnly === false
        && quarantinedFiles(unreadablePath).length === 1,
      unreadable.getLoadFailure());

    /* ------------------------------------- preservation impossible: read-only */

    const lockedPath = caseDir(scratch, 'locked');
    const lockedBytes = '{ this is not json';
    writeFileSync(lockedPath, lockedBytes, 'utf8');
    // A plain file where the quarantine directory belongs makes preservation
    // fail deterministically on every platform.
    writeFileSync(join(lockedPath, '..', 'corrupt'), 'blocked\n', 'utf8');
    const locked = new ConfigStore(lockedPath);
    const lockedFailure = locked.getLoadFailure();
    check('a failed preservation turns the store read-only instead of overwriting',
      lockedFailure?.readOnly === true
        && lockedFailure.quarantinedTo === null
        && locked.readOnly
        && readFileSync(lockedPath, 'utf8') === lockedBytes);
    check('a read-only store refuses every write and keeps the original intact',
      rejects(() => locked.save({ settings: { theme: 'dark' } }))
        && readFileSync(lockedPath, 'utf8') === lockedBytes
        && locked.get().settings.theme === 'dark');

    /* ------------------------------------------------- repeated quarantining */

    const repeatPath = caseDir(scratch, 'repeat');
    writeFileSync(repeatPath, 'first broken', 'utf8');
    new ConfigStore(repeatPath);
    writeFileSync(repeatPath, 'second broken', 'utf8');
    new ConfigStore(repeatPath);
    const repeats = quarantinedFiles(repeatPath);
    check('a second quarantine never overwrites the first',
      repeats.length === 2
        && new Set(repeats.map((name) => readFileSync(
          join(repeatPath, '..', 'corrupt', name), 'utf8'))).size === 2,
      repeats);

    /* ------------------------------------------- planted temp-file symlinks */

    // A config.json that is really a symlink must be refused, never followed:
    // following it would let anyone who can write the profile directory
    // redirect both the read and the subsequent atomic publish at a file
    // outside the profile. Measured on Windows: a bare writeFileSync through a
    // planted symlink writes the link's target, and O_CREAT|O_EXCL still
    // succeeds through a *dangling* symlink — which is why the store verifies
    // the descriptor it opened instead of trusting the open to have failed.
    const plantedDir = join(scratch, 'planted');
    mkdirSync(plantedDir, { recursive: true });
    const plantedPath = join(plantedDir, 'config.json');
    const victim = join(scratch, 'victim-outside-profile.json');
    writeFileSync(victim, 'UNTOUCHED', 'utf8');
    let symlinksUsable = true;
    try {
      symlinkSync(victim, plantedPath);
    } catch {
      // Unprivileged Windows without Developer Mode cannot create symlinks.
      symlinksUsable = false;
    }
    if (symlinksUsable) {
      const store = new ConfigStore(plantedPath);
      store.save({ settings: { ...store.get().settings, theme: 'light' } });
      check('a config.json that is a symlink is quarantined, never followed',
        readFileSync(victim, 'utf8') === 'UNTOUCHED'
          && store.getLoadFailure()?.reason === 'unreadable'
          && quarantinedFiles(plantedPath).length === 1);
      check('the republished config is a plain file, not a link',
        !lstatSync(plantedPath).isSymbolicLink()
          && readFileSync(plantedPath, 'utf8').includes('"theme": "light"'));
    } else {
      console.log('  --  planted config symlink (skipped: symlinks need Developer Mode)');
    }

    /* ------------------------------------------------- catalog reconciliation */

    // The rail and the graph both enumerate agents through category.agents, so
    // an agent no category reaches is invisible in the app while
    // validateCompleteConfig still refuses it — which blocks every workspace
    // import, because the importer validates the current config first.
    const catalogPath = caseDir(scratch, 'catalog');
    const damaged = {
      ...structuredClone(DEFAULT_CONFIG),
      categories: [
        { id: 'cat-a', name: 'Alpha', agents: ['agent-a', 'agent-vanished'] },
        { id: 'cat-b', name: 'Beta', agents: ['agent-relinked'] },
      ],
      agents: [
        { id: 'agent-a', categoryId: 'cat-a', name: 'A', runtime: 'shell', permissionMode: 'default', workspaceDir: 'C:/w/a', memoryDir: 'C:/w/a/m' },
        { id: 'agent-relinked', categoryId: 'cat-gone', name: 'Relinked', runtime: 'shell', permissionMode: 'default', workspaceDir: 'C:/w/r', memoryDir: 'C:/w/r/m' },
        { id: 'agent-orphan', categoryId: 'cat-gone', name: 'Orphan', runtime: 'shell', permissionMode: 'default', workspaceDir: 'C:/w/o', memoryDir: 'C:/w/o/m' },
      ],
    };
    writeFileSync(catalogPath, `${JSON.stringify(damaged, null, 2)}\n`, 'utf8');
    const repaired = new ConfigStore(catalogPath).get();

    check('an agent no category can reach is removed from the catalog',
      repaired.agents.every((agent) => agent.id !== 'agent-orphan'));
    check('the orphaned record is preserved, not destroyed', (() => {
      const files = quarantinedFiles(catalogPath).filter((name) => name.startsWith('orphaned-agents-'));
      if (files.length !== 1) return false;
      const kept = JSON.parse(readFileSync(
        join(catalogPath, '..', 'corrupt', files[0]!), 'utf8',
      )) as Array<{ id: string }>;
      return kept.length === 1 && kept[0]?.id === 'agent-orphan';
    })());
    check('an agent its category still lists is re-linked rather than removed',
      repaired.agents.find((agent) => agent.id === 'agent-relinked')?.categoryId === 'cat-b');
    check('a membership entry naming no agent is dropped',
      repaired.categories.find((category) => category.id === 'cat-a')?.agents
        .includes('agent-vanished') === false);
    check('the repair is durable and leaves a config that validates',
      new ConfigStore(catalogPath).get().agents.length === 2
        && !rejects(() => validateCompleteConfig(new ConfigStore(catalogPath).get())));

    /* ---------------------------------------------------- bounded disk read */

    const oversizePath = caseDir(scratch, 'oversize');
    writeFileSync(oversizePath, `{"padding":"${'a'.repeat(9 * 1024 * 1024)}"}`, 'utf8');
    const oversize = new ConfigStore(oversizePath);
    check('a config file beyond the 8 MiB bound is quarantined, not loaded',
      oversize.getLoadFailure()?.reason === 'unreadable'
        && quarantinedFiles(oversizePath).length === 1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`\nConfig store checks: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

run();
