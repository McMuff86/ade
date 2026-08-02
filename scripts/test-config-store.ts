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
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/main/config/store';

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
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`\nConfig store checks: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

run();
