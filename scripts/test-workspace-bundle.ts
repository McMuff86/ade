import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  linkSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportProfileWorkspaceBundle } from '../src/main/portability/ProfileMigrationSource';
import { ConfigStore, validateCompleteConfig } from '../src/main/config/store';
import {
  exportWorkspaceBundle,
  normalizeRepositoryRemote,
  type WorkspaceBundleResourceReader,
} from '../src/main/portability/WorkspaceBundleExporter';
import {
  planWorkspaceImport,
  type WorkspaceImportMappings,
  type WorkspaceTargetProbe,
} from '../src/main/portability/WorkspaceImportPlanner';
import { TargetPathProbe } from '../src/main/portability/TargetPathProbe';
import { WorkspaceImportService } from '../src/main/portability/WorkspaceImportService';
import { ExecutionBackendHomeProvisioner } from '../src/main/portability/ExecutionBackendHomeProvisioner';
import type { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import {
  parseWorkspaceBundle,
  parseSerializedWorkspaceBundle,
  serializeWorkspaceBundle,
  WORKSPACE_BUNDLE_MAX_PORTABLE_MEMORY_BYTES,
  type AdeWorkspaceBundleV1,
} from '../src/shared/workspaceBundle';
import { DEFAULT_CONFIG, type AdeConfig } from '../src/shared/types';
import { managedProfileSupport } from '../src/main/portability/managed/ManagedHost';

let passed = 0;
let failed = 0;
let skipped = 0;

/**
 * The managed-profile reader/writer is descriptor-anchored through
 * /proc/self/fd with O_NOFOLLOW and refuses to run anywhere else
 * (ProfileMigrationSource.createProfileRootAnchor). Groups that exercise it
 * are announced as skipped rather than silently dropped, so a Windows run
 * still states what it did not cover.
 */
const IS_LINUX = process.platform === 'linux';
const MANAGED = managedProfileSupport(process.platform);

function skip(group: string, reason: string): void {
  skipped += 1;
  console.log(`  --  ${group} (skipped: ${reason})`);
}

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

function rejects(label: string, operation: () => unknown, message: RegExp): void {
  try {
    operation();
    check(label, false, 'operation unexpectedly succeeded');
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    check(label, message.test(text), text);
  }
}

async function rejectsAsync(label: string, operation: () => Promise<unknown>, message: RegExp): Promise<void> {
  try {
    await operation();
    check(label, false, 'operation unexpectedly succeeded');
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    check(label, message.test(text), text);
  }
}

function sampleConfig(): AdeConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    categories: [{
      id: 'category-builders',
      name: 'Builders',
      agents: ['agent-one'],
      defaultRepositoryId: 'repo-one',
      kind: 'team',
    }],
    repositories: [{
      id: 'repo-one',
      name: 'RhinoClaw',
      rootPath: 'C:\\Users\\Example\\repos\\RhinoClaw',
      commonGitDir: 'C:\\Users\\Example\\repos\\RhinoClaw\\.git',
      executionBackend: 'native',
      verified: true,
      createdAt: 1,
    }],
    agents: [{
      id: 'agent-one',
      categoryId: 'category-builders',
      name: 'Builder',
      role: 'Implementation',
      runtime: 'codex',
      permissionMode: 'accept-edits',
      customCommand: 'codex --config token=must-not-export',
      codexModel: 'gpt-5.6-sol',
      codexReasoningEffort: 'high',
      workspaceDir: 'C:\\Users\\Example\\AppData\\Roaming\\ADE\\ade\\agents\\agent-one\\workspace',
      homeWorkspaceDir: 'C:\\Users\\Example\\AppData\\Roaming\\ADE\\ade\\agents\\agent-one\\workspace',
      defaultRepositoryId: 'repo-one',
      memoryDir: 'C:\\Users\\Example\\AppData\\Roaming\\ADE\\ade\\agents\\agent-one\\memory',
      photo: 'builder.png',
      dashboardUrl: 'https://example.invalid/?token=must-not-export',
      dashboardCommand: 'dashboard --token must-not-export',
      teamRole: 'worker',
    }],
    workspaceBindings: [{
      id: 'binding-one',
      agentId: 'agent-one',
      repositoryId: 'repo-one',
      workspaceDir: 'C:\\Users\\Example\\repos\\.ade-worktrees\\builder',
      branch: 'ade/builder',
      executionBackend: 'native',
      status: 'ready',
      createdAt: 1,
      lastUsedAt: 1,
    }],
    agentTemplates: [{
      id: 'template-one',
      name: 'Builder template',
      role: 'Implementation',
      photo: 'builder.png',
      runtime: 'codex',
      permissionMode: 'accept-edits',
      codexModel: 'gpt-5.6-sol',
      codexReasoningEffort: 'high',
      memorySeed: { memory: 'template memory\n', user: 'template user\n' },
      createdAt: 1,
      updatedAt: 1,
    }],
    runs: [{
      id: 'run-one',
      name: 'Do not export',
      goal: 'contains runtime state',
      status: 'running',
      mode: 'managed',
      phase: 'working',
      createdAt: 1,
      updatedAt: 1,
      budget: {
        maxConcurrentTasks: 1,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxCostUsd: null,
        maxApprovals: 1,
      },
    }],
  };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function sampleResources(): WorkspaceBundleResourceReader {
  return {
    repositoryRemote: () => 'https://user:password@github.com/McMuff86/RhinoClaw.git?token=secret#fragment',
    photo: (file) => file === 'builder.png' ? { bytes: PNG, mime: 'image/png' } : null,
    memory: (_agentId, target) => Buffer.from(
      target === 'memory' ? 'portable memory\n' : 'portable user\n',
    ),
  };
}

function validBundle(): AdeWorkspaceBundleV1 {
  return exportWorkspaceBundle(sampleConfig(), {
    sourcePlatform: 'win32',
    exportedAt: '2026-07-31T10:00:00.000Z',
    includeMemory: true,
    includePhotos: true,
    resources: sampleResources(),
  }).bundle;
}

function testSchemaAndExporter(): void {
  const result = exportWorkspaceBundle(sampleConfig(), {
    sourcePlatform: 'win32',
    exportedAt: '2026-07-31T10:00:00.000Z',
    includeMemory: true,
    includePhotos: true,
    resources: sampleResources(),
  });
  const bundle = parseWorkspaceBundle(JSON.parse(serializeWorkspaceBundle(result.bundle)));

  check('V1 bundle round-trips through strict runtime validation',
    bundle.format === 'ade-workspace-bundle' && bundle.version === 1);

  // An agent whose category is gone cannot be reached in ADE at all — the rail
  // and the graph both list agents through category.agents — so the user has no
  // way to repair it and an export that failed on it would be a dead end.
  const orphanConfig = sampleConfig();
  orphanConfig.agents.push({
    ...structuredClone(orphanConfig.agents[0]!),
    id: 'orphan-agent', name: 'Orphaned Agent', categoryId: 'category-that-was-deleted',
  });
  const orphanExport = exportWorkspaceBundle(orphanConfig, {
    sourcePlatform: 'win32', exportedAt: '2026-07-31T10:00:00.000Z',
  });
  const orphanBundle = parseWorkspaceBundle(JSON.parse(serializeWorkspaceBundle(orphanExport.bundle)));
  check('an agent whose category no longer exists is omitted instead of failing the export',
    orphanBundle.agents.every((agent) => agent.id !== 'orphan-agent')
      && orphanBundle.agents.length === sampleConfig().agents.length);
  check('the omitted agent is named in a notice rather than dropped silently',
    orphanExport.warnings.some((notice) => notice.code === 'agent-unreachable-omitted'
      && notice.subjectId === 'orphan-agent'
      && notice.message.includes('Orphaned Agent')));

  // Membership is rebuilt from the agents themselves, so neither direction of a
  // half-broken link can produce an unparseable bundle.
  const membershipConfig = sampleConfig();
  membershipConfig.categories[0]!.agents = ['agent-that-was-deleted', 'agent-one'];
  const membershipExport = exportWorkspaceBundle(membershipConfig, {
    sourcePlatform: 'win32', exportedAt: '2026-07-31T10:00:00.000Z',
  });
  const membershipBundle = parseWorkspaceBundle(
    JSON.parse(serializeWorkspaceBundle(membershipExport.bundle)),
  );
  check('a category listing an agent that no longer exists still exports',
    membershipBundle.categories[0]?.agentIds.includes('agent-one') === true
      && membershipBundle.categories[0]?.agentIds.includes('agent-that-was-deleted') === false);

  const unlistedConfig = sampleConfig();
  unlistedConfig.categories[0]!.agents = [];
  const unlistedBundle = parseWorkspaceBundle(JSON.parse(serializeWorkspaceBundle(
    exportWorkspaceBundle(unlistedConfig, {
      sourcePlatform: 'win32', exportedAt: '2026-07-31T10:00:00.000Z',
    }).bundle,
  )));
  check('an agent missing from its own category membership is restored on export',
    unlistedBundle.categories[0]?.agentIds.includes('agent-one') === true);
  check('category ordering and logical default repository survive export',
    bundle.categories[0]?.agentIds[0] === 'agent-one'
      && bundle.categories[0]?.defaultRepositoryId === 'repo-one');
  check('agent runtime, role, model and logical repository survive export',
    bundle.agents[0]?.runtime === 'codex'
      && bundle.agents[0]?.role === 'Implementation'
      && bundle.agents[0]?.codexModel === 'gpt-5.6-sol'
      && bundle.agents[0]?.defaultRepositoryId === 'repo-one');
  check('host paths, bindings, run state and dashboard/custom commands are structurally absent',
    !serializeWorkspaceBundle(bundle).includes('C:\\\\Users')
      && !serializeWorkspaceBundle(bundle).includes('binding-one')
      && !serializeWorkspaceBundle(bundle).includes('run-one')
      && !serializeWorkspaceBundle(bundle).includes('must-not-export'));
  check('remote identity is sanitized and normalized',
    bundle.repositories[0]?.remoteIdentity === 'github.com/McMuff86/RhinoClaw');
  check('remote normalization preserves non-default ports',
    normalizeRepositoryRemote('https://git.example:8443/Org/Repo.git') === 'git.example:8443/Org/Repo');
  check('remote normalization strips only the exact lowercase Git transport suffix',
    normalizeRepositoryRemote('https://git.example/Org/Repo.GIT') === 'git.example/Org/Repo.GIT');
  for (const remote of [
    'https://git..example/Org/Repo',
    'https://-git.example/Org/Repo',
    'https://git.example-/Org/Repo',
    'ssh://git.example:99999/Org/Repo',
  ]) {
    check(`remote normalization rejects malformed authority ${remote}`,
      normalizeRepositoryRemote(remote) === undefined);
  }
  check('memory is included only through the explicit option',
    bundle.agents[0]?.memory?.memory === 'portable memory\n');
  check('photo is embedded with a verified digest',
    bundle.assets.length === 1
      && bundle.assets[0]?.sha256 === createHash('sha256').update(PNG).digest('hex'));
  const malformedImages = [
    { mime: 'image/jpeg' as const, bytes: Buffer.from([0xff, 0xd8]) },
    { mime: 'image/png' as const, bytes: Buffer.from([0x89, 0x50, 0x4e]) },
    { mime: 'image/webp' as const, bytes: Buffer.from('RIFFWEBP') },
    { mime: 'image/gif' as 'image/webp', bytes: Buffer.from('RIFFxxxxWEBP') },
  ];
  for (const resource of malformedImages) {
    const malformedImageExport = exportWorkspaceBundle(sampleConfig(), {
      sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
      resources: { ...sampleResources(), photo: () => resource },
    });
    check(`truncated ${resource.mime} resources are warned and omitted`,
      malformedImageExport.bundle.assets.length === 0
        && malformedImageExport.warnings.some((warning) => warning.code === 'photo-unavailable'));
  }
  check('export reports deliberately omitted sensitive settings',
    result.warnings.some((warning) => warning.code === 'agent-settings-omitted'));
  check('templates are exported with independent memory seeds',
    bundle.agentTemplates[0]?.memorySeed.memory === 'template memory\n');

  const withoutOptional = exportWorkspaceBundle(sampleConfig(), {
    sourcePlatform: 'linux',
    exportedAt: '2026-07-31T10:00:00.000Z',
  }).bundle;
  check('memory and photos are opt-in',
    withoutOptional.assets.length === 0 && withoutOptional.agents[0]?.memory === undefined);

  const semanticA = serializeWorkspaceBundle(validBundle());
  const semanticB = serializeWorkspaceBundle(validBundle());
  check('same explicit export input produces deterministic JSON', semanticA === semanticB);

  const wrongVersion = structuredClone(bundle) as unknown as Record<string, unknown>;
  wrongVersion.version = 2;
  rejects('unknown bundle versions fail closed', () => parseWorkspaceBundle(wrongVersion), /version/i);

  const duplicateAgent = structuredClone(bundle);
  duplicateAgent.agents.push(structuredClone(duplicateAgent.agents[0]!));
  rejects('duplicate logical ids fail closed', () => parseWorkspaceBundle(duplicateAgent), /duplicate/i);

  const dangling = structuredClone(bundle);
  dangling.agents[0]!.defaultRepositoryId = 'missing-repository';
  rejects('dangling logical references fail closed', () => parseWorkspaceBundle(dangling), /repository/i);

  const unknownKey = structuredClone(bundle) as unknown as Record<string, unknown>;
  unknownKey.credentials = { token: 'forbidden' };
  rejects('credential-shaped unknown top-level fields are rejected',
    () => parseWorkspaceBundle(unknownKey), /unknown|field|key/i);

  const oversized = structuredClone(bundle);
  oversized.agents[0]!.name = 'x'.repeat(300);
  rejects('oversized fields fail closed', () => parseWorkspaceBundle(oversized), /name|length|character/i);

  const numericString = structuredClone(bundle) as unknown as { settings: { memory: { memoryCharLimit: unknown } } };
  numericString.settings.memory.memoryCharLimit = '1';
  rejects('numeric settings require JSON numbers without coercion',
    () => parseWorkspaceBundle(numericString), /memory|number|limit/i);

  const missingMembership = structuredClone(bundle);
  missingMembership.categories[0]!.agentIds = [];
  rejects('agent category membership must be reciprocal',
    () => parseWorkspaceBundle(missingMembership), /category|membership|agent/i);

  const duplicateMembership = structuredClone(bundle);
  duplicateMembership.categories[0]!.agentIds.push('agent-one');
  rejects('duplicate category membership fails closed',
    () => parseWorkspaceBundle(duplicateMembership), /duplicate membership/i);

  const wrongMagic = structuredClone(bundle);
  const invalidPhoto = Buffer.from('this is not a png');
  wrongMagic.assets[0]!.dataBase64 = invalidPhoto.toString('base64');
  wrongMagic.assets[0]!.sha256 = createHash('sha256').update(invalidPhoto).digest('hex');
  rejects('embedded image bytes must match the declared MIME type',
    () => parseWorkspaceBundle(wrongMagic), /MIME|image/i);

  const permissiveDate = structuredClone(bundle);
  permissiveDate.exportedAt = 'July 31, 2026';
  rejects('export timestamps require canonical ISO-8601 UTC form',
    () => parseWorkspaceBundle(permissiveDate), /exportedAt|timestamp|ISO/i);

  const aggregate = structuredClone(bundle);
  aggregate.assets = [];
  for (let index = 0; index < 7; index += 1) {
    const bytes = Buffer.alloc(2 * 1024 * 1024, index);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    aggregate.assets.push({
      id: `bulk-${index}`,
      kind: 'photo',
      mime: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      dataBase64: bytes.toString('base64'),
    });
  }
  rejects('aggregate decoded asset budgets are enforced during object validation',
    () => parseWorkspaceBundle(aggregate), /aggregate decoded asset size/i);

  const aggregateMemory = structuredClone(bundle);
  aggregateMemory.agentTemplates = Array.from({ length: 70 }, (_, index) => ({
    ...structuredClone(bundle.agentTemplates[0]!),
    id: `template-${index}`,
    memorySeed: { memory: 'm'.repeat(32_000), user: 'u'.repeat(32_000) },
  }));
  rejects('aggregate portable memory budgets are enforced during object validation',
    () => parseWorkspaceBundle(aggregateMemory), /aggregate portable memory/i);
  rejects('serialized input size is rejected before JSON parsing',
    () => parseSerializedWorkspaceBundle(' '.repeat(13 * 1024 * 1024)), /size|limit/i);

  const templateHeavy = sampleConfig();
  templateHeavy.agentTemplates[0]!.memorySeed.memory = 'm'.repeat(40_000);
  const templateResult = exportWorkspaceBundle(templateHeavy, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z',
  });
  check('template memory truncation is reported',
    templateResult.warnings.some((warning) => warning.code === 'template-memory-truncated'));

  const manyPhotos = structuredClone(DEFAULT_CONFIG);
  manyPhotos.categories = Array.from({ length: 20 }, (_, index) => ({
    id: `category-${index}`, name: `Category ${index}`, agents: [], photo: `photo-${index}.png`,
  }));
  let photoReads = 0;
  const boundedExport = exportWorkspaceBundle(manyPhotos, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    resources: {
      photo: () => {
        photoReads += 1;
        const bytes = Buffer.alloc(1024 * 1024);
        Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
        bytes[bytes.length - 1] = photoReads;
        return { bytes, mime: 'image/png' };
      },
    },
  });
  check('exporter stops reading photos when the aggregate asset budget is exhausted',
    photoReads === 4
      && boundedExport.warnings.some((warning) => warning.code === 'asset-budget-exhausted'));

  let duplicatePhotoReads = 0;
  const duplicateBytes = Buffer.alloc(1024 * 1024);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(duplicateBytes);
  const duplicatePhotoExport = exportWorkspaceBundle(manyPhotos, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    resources: {
      photo: () => {
        duplicatePhotoReads += 1;
        return { bytes: duplicateBytes, mime: 'image/png' };
      },
    },
  });
  check('duplicate photo content still consumes the fetched-byte budget',
    duplicatePhotoReads === 4 && duplicatePhotoExport.bundle.assets.length === 1
      && duplicatePhotoExport.warnings.some((warning) => warning.code === 'asset-budget-exhausted'));

  const repeatedInvalidPhotos = structuredClone(DEFAULT_CONFIG);
  repeatedInvalidPhotos.categories = Array.from({ length: 500 }, (_, index) => ({
    id: `invalid-photo-category-${index}`, name: `Invalid photo category ${index}`, agents: [], photo: 'missing.png',
  }));
  let invalidPhotoReads = 0;
  const repeatedInvalidPhotoExport = exportWorkspaceBundle(repeatedInvalidPhotos, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    resources: { photo: () => { invalidPhotoReads += 1; return null; } },
  });
  check('invalid photo names are negatively cached across repeated references',
    invalidPhotoReads === 1
      && repeatedInvalidPhotoExport.warnings.filter((warning) => warning.code === 'photo-unavailable').length === 1);

  let nullPhotoReads = 0;
  const nullPhotoExport = exportWorkspaceBundle(manyPhotos, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    resources: { photo: () => { nullPhotoReads += 1; return null; } },
  });
  check('null photo results consume conservative aggregate reader reservations',
    nullPhotoReads === 4
      && nullPhotoExport.warnings.some((warning) => warning.code === 'asset-budget-exhausted'));

  let oversizedPhotoReads = 0;
  const oversizedPhotoExport = exportWorkspaceBundle(manyPhotos, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    resources: {
      photo: (_file, maxBytes) => {
        oversizedPhotoReads += 1;
        return { bytes: Buffer.alloc(maxBytes + 1, 0x70), mime: 'image/png' };
      },
    },
  });
  check('photo readers that violate the byte contract fail closed after one bounded probe',
    oversizedPhotoReads === 1
      && oversizedPhotoExport.bundle.assets.length === 0
      && oversizedPhotoExport.warnings.some((warning) => warning.code === 'asset-budget-exhausted'));

  const manyMemory = sampleConfig();
  manyMemory.agents = Array.from({ length: 100 }, (_, index) => ({
    ...structuredClone(manyMemory.agents[0]!), id: `memory-agent-${index}`, name: `Memory ${index}`,
  }));
  manyMemory.categories[0]!.agents = manyMemory.agents.map((agent) => agent.id);
  let memoryReads = 0;
  let memoryFetchedBytes = 0;
  const boundedMemoryExport = exportWorkspaceBundle(manyMemory, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includeMemory: true,
    resources: {
      memory: (_agentId, _target, maxBytes) => {
        memoryReads += 1;
        memoryFetchedBytes += maxBytes;
        return Buffer.alloc(maxBytes, 0x6d);
      },
    },
  });
  check('exporter stops reading memory when the aggregate portable memory budget is exhausted',
    memoryReads === 33 && memoryFetchedBytes === WORKSPACE_BUNDLE_MAX_PORTABLE_MEMORY_BYTES
      && boundedMemoryExport.warnings.some((warning) => warning.code === 'memory-budget-exhausted'));

  let nullMemoryReads = 0;
  const nullMemoryExport = exportWorkspaceBundle(manyMemory, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includeMemory: true,
    resources: { memory: () => { nullMemoryReads += 1; return null; } },
  });
  check('null memory results consume conservative aggregate reader reservations',
    nullMemoryReads === 33
      && nullMemoryExport.warnings.some((warning) => warning.code === 'memory-budget-exhausted'));

  let oversizedMemoryReads = 0;
  const oversizedMemoryExport = exportWorkspaceBundle(sampleConfig(), {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includeMemory: true,
    resources: {
      memory: (_agentId, _target, maxBytes) => {
        oversizedMemoryReads += 1;
        return Buffer.alloc(maxBytes + 1, 0x6d);
      },
    },
  });
  check('memory readers that violate the byte contract fail closed after one bounded probe',
    oversizedMemoryReads === 1
      && oversizedMemoryExport.bundle.agents[0]?.memory?.memory === ''
      && oversizedMemoryExport.warnings.some((warning) => warning.code === 'memory-budget-exhausted'));

  const combinedBudgetConfig = sampleConfig();
  for (const category of combinedBudgetConfig.categories) category.photo = undefined;
  for (const agent of combinedBudgetConfig.agents) agent.photo = undefined;
  combinedBudgetConfig.agentTemplates = Array.from({ length: 63 }, (_, index) => ({
    ...structuredClone(combinedBudgetConfig.agentTemplates[0]!),
    id: `combined-template-${index}`,
    name: `Combined template ${index}`,
    photo: index < 4 ? `combined-${index}.png` : undefined,
    memorySeed: { memory: 'm'.repeat(32_000), user: 'u'.repeat(32_000) },
  }));
  const combinedBudgetExport = exportWorkspaceBundle(combinedBudgetConfig, {
    sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z',
    includePhotos: true, includeMemory: true,
    resources: {
      photo: (file, maxBytes) => {
        const bytes = Buffer.alloc(maxBytes);
        PNG.copy(bytes, 0);
        bytes[bytes.length - 1] = Number(file.match(/(\d+)/)?.[1] ?? 0) + 1;
        return { bytes, mime: 'image/png' };
      },
    },
  });
  let combinedSerialized = '';
  try {
    combinedSerialized = serializeWorkspaceBundle(combinedBudgetExport.bundle);
  } catch {
    combinedSerialized = '';
  }
  check('successful maximum photo-plus-memory exports remain serializable',
    combinedSerialized.length > 0
      && combinedBudgetExport.warnings.some((warning) => warning.code === 'serialization-budget-exhausted'),
    JSON.stringify({
      serializedLength: combinedSerialized.length,
      assets: combinedBudgetExport.bundle.assets.length,
      warnings: combinedBudgetExport.warnings.map((warning) => warning.code),
    }));
}

function testProfileSource(): void {
  const root = mkdtempSync(join(tmpdir(), 'ade-profile-source-'));
  try {
    const userData = join(root, 'ADE');
    const adeDir = join(userData, 'ade');
    const memoryDir = join(adeDir, 'agents', 'agent-one', 'memory');
    mkdirSync(join(adeDir, 'photos'), { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
    const configPath = join(adeDir, 'config.json');
    writeFileSync(configPath, `${JSON.stringify(sampleConfig(), null, 2)}\n`, 'utf8');
    writeFileSync(join(adeDir, 'photos', 'builder.png'), PNG);
    writeFileSync(join(memoryDir, 'MEMORY.md'), 'profile memory\n', 'utf8');
    writeFileSync(join(memoryDir, 'USER.md'), 'profile user\n', 'utf8');
    writeFileSync(join(adeDir, 'harness-credentials.json'), '{"must":"remain untouched"}\n', 'utf8');
    const beforeConfig = readFileSync(configPath);
    const beforeCredentials = readFileSync(join(adeDir, 'harness-credentials.json'));
    const openedPaths: string[] = [];

    const result = exportProfileWorkspaceBundle(userData, {
      sourcePlatform: 'win32',
      exportedAt: '2026-07-31T10:00:00.000Z',
      includeMemory: true,
      includePhotos: true,
      repositoryRemote: () => 'git@github.com:McMuff86/RhinoClaw.git',
      auditFileOpen: (path) => openedPaths.push(path),
    });
    check('profile directory resolves ADE/ade/config.json without modifying it',
      result.bundle.agents[0]?.memory?.memory === 'profile memory\n'
        && Buffer.compare(beforeConfig, readFileSync(configPath)) === 0);
    check('profile migration never reads or modifies credential storage',
      Buffer.compare(beforeCredentials, readFileSync(join(adeDir, 'harness-credentials.json'))) === 0
        && openedPaths.every((path) => !path.endsWith('harness-credentials.json')));
    check('profile photos are read only from the managed photos directory', result.bundle.assets.length === 1);

    const unsupportedPhotoConfig = sampleConfig();
    unsupportedPhotoConfig.categories[0]!.photo = 'category.txt';
    unsupportedPhotoConfig.agents[0]!.photo = 'agent.txt';
    unsupportedPhotoConfig.agentTemplates[0]!.photo = 'template.txt';
    for (const file of ['category.txt', 'agent.txt', 'template.txt']) {
      writeFileSync(join(adeDir, 'photos', file), Buffer.alloc(1_024, 0x61));
    }
    writeFileSync(configPath, `${JSON.stringify(unsupportedPhotoConfig)}\n`);
    const unsupportedPhotoOpens: string[] = [];
    const unsupportedPhotoResult = exportProfileWorkspaceBundle(userData, {
      sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
      auditFileOpen: (path) => unsupportedPhotoOpens.push(path),
    });
    check('unsupported photo extensions are rejected before managed files are opened',
      unsupportedPhotoResult.bundle.assets.length === 0
        && unsupportedPhotoOpens.every((path) => !path.endsWith('.txt')));
    writeFileSync(configPath, beforeConfig);

    const malformedCallbackConfig = structuredClone(sampleConfig()) as unknown as Record<string, unknown>;
    ((malformedCallbackConfig.repositories as Array<Record<string, unknown>>)[0]!).id = 42;
    writeFileSync(configPath, `${JSON.stringify(malformedCallbackConfig)}\n`);
    let malformedRemoteCalls = 0;
    rejects('malformed source identities fail before repository or resource callbacks',
      () => exportProfileWorkspaceBundle(userData, {
        sourcePlatform: 'linux',
        repositoryRemote: () => { malformedRemoteCalls += 1; return null; },
      }), /workspace bundle|invalid format/i);
    check('malformed source profiles invoke no repository callbacks', malformedRemoteCalls === 0);
    writeFileSync(configPath, beforeConfig);

    const malformedPhotoConfig = structuredClone(sampleConfig()) as unknown as Record<string, unknown>;
    ((malformedPhotoConfig.categories as Array<Record<string, unknown>>)[0]!).photo = 42;
    writeFileSync(configPath, `${JSON.stringify(malformedPhotoConfig)}\n`);
    let malformedPhotoRemoteCalls = 0;
    rejects('malformed photo references fail before optional callbacks',
      () => exportProfileWorkspaceBundle(userData, {
        sourcePlatform: 'linux', includePhotos: true,
        repositoryRemote: () => { malformedPhotoRemoteCalls += 1; return null; },
      }), /photo.*managed filename/i);
    check('malformed photo references invoke no repository callbacks', malformedPhotoRemoteCalls === 0);
    writeFileSync(configPath, beforeConfig);

    const symlinkConfig = structuredClone(sampleConfig());
    symlinkConfig.agents[0]!.photo = '../outside.png';
    writeFileSync(configPath, `${JSON.stringify(symlinkConfig, null, 2)}\n`, 'utf8');
    rejects('asset path traversal is rejected before resource callbacks',
      () => exportProfileWorkspaceBundle(configPath, {
        sourcePlatform: 'win32',
        exportedAt: '2026-07-31T10:00:00.000Z',
        includePhotos: true,
      }), /photo.*managed filename/i);

    rejects('missing profile source fails with an actionable error',
      () => exportProfileWorkspaceBundle(join(root, 'missing'), {
        sourcePlatform: 'linux',
        exportedAt: '2026-07-31T10:00:00.000Z',
      }), /config|profile|exist/i);

    const stat = statSync(configPath);
    check('profile source remains a regular file after migration reads',
      stat.isFile() && realpathSync(configPath).startsWith(realpathSync(root)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testProfileSourceBoundaries(): void {
  const root = mkdtempSync(join(tmpdir(), 'ade-profile-boundary-'));
  try {
    const selected = join(root, 'selected');
    const adeDir = join(selected, 'ade');
    const outside = join(root, 'outside');
    mkdirSync(adeDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const outsideConfig = join(outside, 'config.json');
    writeFileSync(outsideConfig, `${JSON.stringify(sampleConfig())}\n`, 'utf8');
    symlinkSync(outsideConfig, join(adeDir, 'config.json'));
    rejects('profile migration rejects a symlinked config.json',
      () => exportProfileWorkspaceBundle(selected, {
        sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z',
      }), /symlink|profile|config/i);

    rmSync(join(adeDir, 'config.json'));
    writeFileSync(join(adeDir, 'config.json'), `${JSON.stringify(sampleConfig())}\n`, 'utf8');
    writeFileSync(join(outside, 'builder.png'), PNG);
    symlinkSync(outside, join(adeDir, 'photos'));
    const escaped = exportProfileWorkspaceBundle(selected, {
      sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    });
    check('profile migration refuses a symlinked managed photos root',
      escaped.bundle.assets.length === 0
        && escaped.warnings.some((warning) => warning.code === 'photo-unavailable'));

    const outsideMemory = join(outside, 'agent-one', 'memory');
    mkdirSync(outsideMemory, { recursive: true });
    writeFileSync(join(outsideMemory, 'MEMORY.md'), 'must not escape\n');
    writeFileSync(join(outsideMemory, 'USER.md'), 'must not escape\n');
    symlinkSync(outside, join(adeDir, 'agents'));
    const escapedMemory = exportProfileWorkspaceBundle(selected, {
      sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includeMemory: true,
    });
    check('profile migration refuses a symlinked managed agents root',
      escapedMemory.bundle.agents[0]?.memory?.memory === ''
        && escapedMemory.bundle.agents[0]?.memory?.user === '');
    rmSync(join(adeDir, 'agents'));

    rmSync(join(adeDir, 'photos'));
    mkdirSync(join(adeDir, 'photos'));
    linkSync(join(outside, 'builder.png'), join(adeDir, 'photos', 'builder.png'));
    const hardLinked = exportProfileWorkspaceBundle(selected, {
      sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    });
    check('profile migration refuses multiply-linked managed files',
      hardLinked.bundle.assets.length === 0
        && hardLinked.warnings.some((warning) => warning.code === 'photo-unavailable'));
    rmSync(join(adeDir, 'photos', 'builder.png'));

    writeFileSync(join(adeDir, 'photos', 'builder.png'), Buffer.alloc(2 * 1024 * 1024 + 1));
    const oversized = exportProfileWorkspaceBundle(selected, {
      sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z', includePhotos: true,
    });
    check('oversized managed resources are skipped with a bounded warning',
      oversized.bundle.assets.length === 0
        && oversized.warnings.some((warning) => warning.code === 'photo-unavailable'));

    const invalidBackendConfig = sampleConfig();
    invalidBackendConfig.repositories[0]!.executionBackend = 'docker:bad' as 'native';
    writeFileSync(join(adeDir, 'config.json'), `${JSON.stringify(invalidBackendConfig)}\n`);
    rejects('profile migration rejects explicitly invalid legacy backend identifiers',
      () => exportProfileWorkspaceBundle(selected, {
        sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z',
      }), /backend/i);

    const malformedContainers: Array<[string, unknown]> = [
      ['repositories', {}], ['categories', 'bad'], ['agents', 7],
      ['agentTemplates', false], ['settings', 'bad'],
    ];
    for (const [field, malformed] of malformedContainers) {
      const malformedConfig = sampleConfig() as unknown as Record<string, unknown>;
      malformedConfig[field] = malformed;
      writeFileSync(join(adeDir, 'config.json'), `${JSON.stringify(malformedConfig)}\n`);
      rejects(`profile migration rejects an explicitly malformed ${field} container`,
        () => exportProfileWorkspaceBundle(selected, {
          sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z',
        }), /bounded array|settings|profile/i);
    }

    const malformedSettings: Array<[string, unknown]> = [
      ['memory', null],
      ['theme', 'system'],
      ['memory.enabled', { ...sampleConfig().settings.memory, enabled: 'yes' }],
      ['memory.memoryCharLimit', { ...sampleConfig().settings.memory, memoryCharLimit: -1 }],
    ];
    for (const [label, malformed] of malformedSettings) {
      const malformedConfig = sampleConfig();
      if (label === 'theme') malformedConfig.settings.theme = malformed as 'dark';
      else malformedConfig.settings.memory = malformed as AdeConfig['settings']['memory'];
      writeFileSync(join(adeDir, 'config.json'), `${JSON.stringify(malformedConfig)}\n`);
      rejects(`profile migration rejects explicitly malformed settings.${label}`,
        () => exportProfileWorkspaceBundle(selected, {
          sourcePlatform: 'linux', exportedAt: '2026-07-31T10:00:00.000Z',
        }), /settings\.memory|settings\.theme|profile/i);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testProfileRootSwap(): void {
  const root = mkdtempSync(join(tmpdir(), 'ade-profile-root-swap-'));
  const selected = join(root, 'selected');
  const adeDir = join(selected, 'ade');
  const movedAdeDir = join(selected, 'ade-original');
  const outside = join(root, 'outside');
  try {
    mkdirSync(adeDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const originalConfig = sampleConfig();
    const replacementConfig = sampleConfig();
    replacementConfig.agents[0]!.name = 'Replacement Agent';
    writeFileSync(join(adeDir, 'config.json'), `${JSON.stringify(originalConfig)}\n`);
    writeFileSync(join(outside, 'config.json'), `${JSON.stringify(replacementConfig)}\n`);
    let swapped = false;
    const exported = exportProfileWorkspaceBundle(selected, {
        sourcePlatform: 'linux',
        exportedAt: '2026-07-31T10:00:00.000Z',
        auditFileOpen: (path) => {
          if (swapped || !path.endsWith('config.json')) return;
          swapped = true;
          renameSync(adeDir, movedAdeDir);
          symlinkSync(outside, adeDir);
        },
      });
    check('descriptor-relative profile reads ignore a transient pathname-root replacement',
      exported.bundle.agents[0]?.name === originalConfig.agents[0]?.name
        && exported.bundle.agents[0]?.name !== replacementConfig.agents[0]?.name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function testImportPlanner(): Promise<void> {
  const bundle = validBundle();
  const mappings: WorkspaceImportMappings = {
    repositories: {
      'repo-one': { backend: 'native', path: '/home/target/projects/RhinoClaw' },
    },
    agentHomes: {
      'agent-one': { backend: 'native', path: '/home/target/.config/ade/agents/agent-one/workspace' },
    },
  };
  const probe: WorkspaceTargetProbe = {
    repository: async (_source, target) => ({
      ok: true,
      canonicalPath: target.path,
      commonGitDir: `${target.path}/.git`,
      remoteIdentity: 'github.com/McMuff86/RhinoClaw',
    }),
    agentHome: async (target) => ({ ok: true, canonicalPath: target.path }),
    canonicalPath: async (target) => ({ ok: true, canonicalPath: target.path }),
  };
  const target = structuredClone(DEFAULT_CONFIG);
  const plan = await planWorkspaceImport(bundle, target, mappings, probe, { hostPlatform: 'linux' });
  check('verified repository and agent-home mappings become ready',
    plan.repositories[0]?.status === 'ready' && plan.agentHomes[0]?.status === 'ready');
  check('planner allocates target ids and preserves internal logical relationships',
    Boolean(plan.idMap.agents['agent-one'])
      && Boolean(plan.idMap.repositories['repo-one'])
      && plan.idMap.agents['agent-one'] !== 'agent-one');
  check('plan token is deterministic for the same bundle, target and decisions',
    plan.token === (await planWorkspaceImport(bundle, target, mappings, probe, { hostPlatform: 'linux' })).token);

  const missing = await planWorkspaceImport(bundle, target, {
    repositories: {}, agentHomes: {},
  }, probe, { hostPlatform: 'linux' });
  check('unmapped paths remain actionable instead of silently falling back',
    missing.repositories[0]?.status === 'needs-mapping'
      && missing.agentHomes[0]?.status === 'needs-mapping');

  const wrongRemote: WorkspaceTargetProbe = {
    ...probe,
    repository: async (_source, targetMapping) => ({
      ok: true,
      canonicalPath: targetMapping.path,
      remoteIdentity: 'github.com/other/project',
    }),
  };
  const mismatch = await planWorkspaceImport(bundle, target, mappings, wrongRemote, { hostPlatform: 'linux' });
  check('wrong repository identity is invalid with remediation',
    mismatch.repositories[0]?.status === 'invalid'
      && /remote|repository/i.test(mismatch.repositories[0]?.reason ?? '')
      && Boolean(mismatch.repositories[0]?.remediation));

  const unsupported = await planWorkspaceImport(bundle, target, {
    ...mappings,
    repositories: { 'repo-one': { backend: 'wsl:Ubuntu', path: '/home/target/project' } },
  }, probe, { hostPlatform: 'linux' });
  check('native Linux rejects Windows-only WSL backend mappings',
    unsupported.repositories[0]?.status === 'invalid'
      && /backend|WSL/i.test(unsupported.repositories[0]?.reason ?? ''));

  const collisionTarget = structuredClone(DEFAULT_CONFIG);
  collisionTarget.categories = [{ id: 'existing-category', name: 'Builders', agents: [] }];
  collisionTarget.agents = [{
    id: 'existing-agent', categoryId: 'existing-category', name: 'Builder', runtime: 'codex',
    permissionMode: 'default', workspaceDir: '/tmp/existing', memoryDir: '/tmp/existing-memory',
  }];
  const collision = await planWorkspaceImport(bundle, collisionTarget, mappings, probe, { hostPlatform: 'linux' });
  check('identity name collisions require an explicit decision',
    collision.categories[0]?.status === 'conflict' && collision.agents[0]?.status === 'conflict');
  const renamed = await planWorkspaceImport(bundle, collisionTarget, {
    ...mappings,
    names: {
      categories: { [bundle.categories[0]!.id]: 'Imported Builders' },
      agents: { [bundle.agents[0]!.id]: 'Imported Builder' },
    },
  }, probe, { hostPlatform: 'linux' });
  check('explicit rename decisions resolve identity collisions and bind the selected names',
    renamed.categories[0]?.status === 'ready'
      && renamed.categories[0]?.name === 'Imported Builders'
      && renamed.agents[0]?.status === 'ready'
      && renamed.agents[0]?.name === 'Imported Builder');

  const duplicateMappingsBundle = structuredClone(bundle);
  duplicateMappingsBundle.repositories.push({
    id: 'repo-two', name: 'Clone', sourceBackend: 'native', sourcePathStyle: 'windows',
    sourceLeafName: 'Clone', remoteIdentity: 'github.com/McMuff86/Other',
  });
  const matchingRemoteProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async (source, targetMapping) => ({
      ok: true, canonicalPath: targetMapping.path, commonGitDir: `${targetMapping.path}/.git`,
      remoteIdentity: source.remoteIdentity,
    }),
  };
  const duplicateMappingPlan = await planWorkspaceImport(duplicateMappingsBundle, target, {
    ...mappings,
    repositories: {
      ...mappings.repositories,
      'repo-two': { backend: 'native', path: '/home/target/projects/RhinoClaw' },
    },
  }, matchingRemoteProbe, { hostPlatform: 'linux' });
  check('two source repositories cannot map to one canonical target path',
    duplicateMappingPlan.repositories.every((item) => item.status === 'conflict'));

  const mismatchingDuplicateProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async (_source, targetMapping) => ({
      ok: true,
      canonicalPath: targetMapping.path,
      commonGitDir: `${targetMapping.path}/.git`,
      remoteIdentity: 'github.com/Unrelated/Repository',
    }),
  };
  const mismatchingDuplicatePlan = await planWorkspaceImport(duplicateMappingsBundle, target, {
    ...mappings,
    repositories: {
      'repo-one': { backend: 'native', path: '/home/target/projects/shared' },
      'repo-two': { backend: 'native', path: '/home/target/projects/shared' },
    },
  }, mismatchingDuplicateProbe, { hostPlatform: 'linux' });
  check('remote mismatches remain invalid when repository mappings also collide',
    mismatchingDuplicatePlan.repositories.every((item) => item.status === 'invalid'
      && item.reason?.includes('remote does not match')));

  await rejectsAsync('planner rejects a malformed bundle before probing targets',
    () => planWorkspaceImport({ ...bundle, version: 2 } as unknown as AdeWorkspaceBundleV1,
      target, mappings, probe, { hostPlatform: 'linux' }), /version/i);

  const reserved = structuredClone(bundle);
  reserved.repositories[0]!.id = 'constructor';
  reserved.categories[0]!.defaultRepositoryId = 'constructor';
  reserved.agents[0]!.defaultRepositoryId = 'constructor';
  const reservedPlan = await planWorkspaceImport(reserved, target, {
    repositories: {}, agentHomes: {},
  }, probe, { hostPlatform: 'linux' });
  check('reserved object-property ids remain unmapped without prototype lookup',
    reservedPlan.repositories[0]?.status === 'needs-mapping');

  const invalidBackend = await planWorkspaceImport(bundle, target, {
    ...mappings,
    repositories: {
      'repo-one': { backend: 'docker:invalid' as 'native', path: '/home/target/project' },
    },
  }, probe, { hostPlatform: 'linux' });
  check('malformed mapping backends fail closed instead of normalizing to native',
    invalidBackend.repositories[0]?.status === 'invalid'
      && /backend/i.test(invalidBackend.repositories[0]?.reason ?? ''));

  const missingRemoteProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async (_source, targetMapping) => ({ ok: true, canonicalPath: targetMapping.path }),
  };
  const missingRemote = await planWorkspaceImport(bundle, target, mappings, missingRemoteProbe, {
    hostPlatform: 'linux',
  });
  check('an exported remote identity requires a verifiable target remote',
    missingRemote.repositories[0]?.status === 'invalid');

  const malformedProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async () => ({
      ok: true, canonicalPath: null as unknown as string,
      remoteIdentity: 'github.com/McMuff86/RhinoClaw',
    }),
  };
  const malformedProbePlan = await planWorkspaceImport(bundle, target, mappings, malformedProbe, {
    hostPlatform: 'linux',
  });
  check('malformed successful probe results fail closed without throwing',
    malformedProbePlan.repositories[0]?.status === 'invalid');

  const malformedRemoteProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async (_source, targetMapping) => ({
      ok: true,
      canonicalPath: targetMapping.path,
      remoteIdentity: 42 as unknown as string,
    }),
  };
  const malformedRemote = await planWorkspaceImport(bundle, target, mappings, malformedRemoteProbe, {
    hostPlatform: 'linux',
  });
  check('malformed probe remote identities become invalid plan items instead of throwing',
    malformedRemote.repositories[0]?.status === 'invalid');

  for (const remoteIdentity of [
    'git.example:0/Org/Repo',
    'git.example:065535/Org/Repo',
    'git.example:65536/Org/Repo',
    'git.example:99999/Org/Repo',
    'git..example/Org/Repo',
    '-git.example/Org/Repo',
    'git.example-/Org/Repo',
  ]) {
    const bundleWithoutRemote = structuredClone(bundle);
    delete bundleWithoutRemote.repositories[0]!.remoteIdentity;
    const malformedAuthorityPlan = await planWorkspaceImport(bundleWithoutRemote, target, mappings, {
      ...probe,
      repository: async (_source, mappedTarget) => ({
        ok: true, canonicalPath: mappedTarget.path, commonGitDir: `${mappedTarget.path}/.git`, remoteIdentity,
      }),
    }, { hostPlatform: 'linux' });
    check(`probe remote authority ${remoteIdentity} fails closed`,
      malformedAuthorityPlan.repositories.every((item) => item.status === 'invalid'));
  }
  const validMaxPortBundle = structuredClone(bundle);
  delete validMaxPortBundle.repositories[0]!.remoteIdentity;
  const validMaxPortPlan = await planWorkspaceImport(validMaxPortBundle, target, mappings, {
    ...probe,
    repository: async (_source, mappedTarget) => ({
      ok: true, canonicalPath: mappedTarget.path, commonGitDir: `${mappedTarget.path}/.git`,
      remoteIdentity: 'git.example:65535/Org/Repo',
    }),
  }, { hostPlatform: 'linux' });
  check('probe remote authority accepts port 65535',
    validMaxPortPlan.repositories.every((item) => item.status === 'ready'));

  const remotePathCaseProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async (_source, targetMapping) => ({
      ok: true,
      canonicalPath: targetMapping.path,
      remoteIdentity: 'github.com/mcmuff86/rhinoclaw',
    }),
  };
  const remotePathCase = await planWorkspaceImport(bundle, target, mappings, remotePathCaseProbe, {
    hostPlatform: 'linux',
  });
  check('repository remote host matching is case-insensitive but namespace paths remain case-sensitive',
    remotePathCase.repositories[0]?.status === 'invalid');

  const extraMappingField = await planWorkspaceImport(bundle, target, {
    ...mappings,
    repositories: {
      'repo-one': {
        backend: 'native', path: '/repo', unexpected: true,
      } as unknown as WorkspaceImportMappings['repositories'][string],
    },
  }, probe, { hostPlatform: 'linux' });
  check('mapping entries with unknown fields fail closed',
    extraMappingField.repositories[0]?.status === 'invalid');

  await rejectsAsync('mapping containers reject unknown source ids',
    () => planWorkspaceImport(bundle, target, {
      repositories: { ...mappings.repositories, unknown: { backend: 'native', path: '/tmp' } },
      agentHomes: mappings.agentHomes,
    }, probe, { hostPlatform: 'linux' }), /unknown|mapping/i);

  const twoAgents = structuredClone(bundle);
  twoAgents.agents.push({ ...structuredClone(twoAgents.agents[0]!), id: 'agent-two', name: 'Second' });
  twoAgents.categories[0]!.agentIds.push('agent-two');
  const duplicateHome = await planWorkspaceImport(twoAgents, target, {
    repositories: mappings.repositories,
    agentHomes: {
      'agent-one': { backend: 'native', path: '/home/target/shared' },
      'agent-two': { backend: 'native', path: '/home/target/shared' },
    },
  }, probe, { hostPlatform: 'linux' });
  check('duplicate canonical agent homes are conflicts',
    duplicateHome.agentHomes.every((item) => item.status === 'conflict'));

  const repositoryHomeOverlap = await planWorkspaceImport(bundle, target, {
    repositories: { 'repo-one': { backend: 'native', path: '/home/target/shared' } },
    agentHomes: { 'agent-one': { backend: 'native', path: '/home/target/shared/agent' } },
  }, probe, { hostPlatform: 'linux' });
  check('agent homes cannot overlap mapped repositories',
    repositoryHomeOverlap.agentHomes[0]?.status === 'conflict');

  const worktreeCommonDirProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async (source, targetMapping) => ({
      ok: true,
      canonicalPath: targetMapping.path,
      commonGitDir: '/home/target/shared-git/repo-one',
      remoteIdentity: source.remoteIdentity,
    }),
    agentHome: async () => ({
      ok: true,
      canonicalPath: '/home/target/shared-git/repo-one/imported-agent',
      occupancy: 'absent',
    }),
  };
  const worktreeCommonDirOverlap = await planWorkspaceImport(
    bundle, target, mappings, worktreeCommonDirProbe, { hostPlatform: 'linux' },
  );
  check('agent homes cannot overlap a mapped repository commonGitDir',
    worktreeCommonDirOverlap.repositories[0]?.status === 'conflict'
      && worktreeCommonDirOverlap.agentHomes[0]?.status === 'conflict');

  const caseProbe: WorkspaceTargetProbe = {
    repository: async (source, targetMapping) => ({
      ok: true, canonicalPath: targetMapping.path, commonGitDir: `${targetMapping.path}/.git`,
      remoteIdentity: source.remoteIdentity,
    }),
    agentHome: async (targetMapping) => ({ ok: true, canonicalPath: targetMapping.path }),
    canonicalPath: async (targetMapping) => ({ ok: true, canonicalPath: targetMapping.path }),
  };
  const wslCase = await planWorkspaceImport(twoAgents, target, {
    repositories: { 'repo-one': { backend: 'wsl:Ubuntu', path: '/repo' } },
    agentHomes: {
      'agent-one': { backend: 'wsl:Ubuntu', path: '/home/Foo' },
      'agent-two': { backend: 'wsl:Ubuntu', path: '/home/foo' },
    },
  }, caseProbe, { hostPlatform: 'win32' });
  check('WSL canonical paths remain case-sensitive on a Windows host',
    wslCase.agentHomes.every((item) => item.status === 'ready'));

  const wslAlias = await planWorkspaceImport(twoAgents, target, {
    repositories: { 'repo-one': { backend: 'wsl:Ubuntu', path: '/repo' } },
    agentHomes: {
      'agent-one': { backend: 'wsl:Ubuntu', path: '/home/shared' },
      'agent-two': { backend: 'wsl:ubuntu', path: '/home/shared' },
    },
  }, caseProbe, { hostPlatform: 'win32' });
  check('WSL distribution aliases compare case-insensitively for overlap detection',
    wslAlias.agentHomes.every((item) => item.status === 'conflict'));

  const nestedRepositories = structuredClone(bundle);
  nestedRepositories.repositories.push({
    ...structuredClone(nestedRepositories.repositories[0]!), id: 'repo-two', name: 'Nested',
  });
  const nestedRepositoryPlan = await planWorkspaceImport(nestedRepositories, target, {
    repositories: {
      'repo-one': { backend: 'native', path: '/repo' },
      'repo-two': { backend: 'native', path: '/repo/nested' },
    },
    agentHomes: { 'agent-one': { backend: 'native', path: '/homes/agent-one' } },
  }, caseProbe, { hostPlatform: 'linux' });
  check('nested repository mappings are overlapping conflicts',
    nestedRepositoryPlan.repositories.every((item) => item.status === 'conflict'));

  const tripleOverlapBundle = structuredClone(duplicateMappingsBundle);
  tripleOverlapBundle.repositories.push({
    id: 'repo-three', name: 'Nested clone', sourceBackend: 'native', sourcePathStyle: 'windows',
    sourceLeafName: 'NestedClone', remoteIdentity: 'github.com/McMuff86/Third',
  });
  const tripleOverlapPlan = await planWorkspaceImport(tripleOverlapBundle, target, {
    repositories: {
      'repo-one': { backend: 'native', path: '/triple' },
      'repo-two': { backend: 'native', path: '/triple' },
      'repo-three': { backend: 'native', path: '/triple/nested' },
    },
    agentHomes: { 'agent-one': { backend: 'native', path: '/homes/agent-one' } },
  }, caseProbe, { hostPlatform: 'linux' });
  check('path-collision graphs include items already marked as conflicts',
    tripleOverlapPlan.repositories.every((item) => item.status === 'conflict'
      && item.reason === 'Imported target mappings resolve to duplicate or overlapping paths.'));

  const rootHomePlan = await planWorkspaceImport(bundle, target, {
    repositories: { 'repo-one': { backend: 'native', path: '/repo' } },
    agentHomes: { 'agent-one': { backend: 'native', path: '/' } },
  }, caseProbe, { hostPlatform: 'linux' });
  check('filesystem roots overlap every target on the same backend volume',
    rootHomePlan.repositories[0]?.status === 'conflict'
      && rootHomePlan.agentHomes[0]?.status === 'conflict');

  const dotSegmentHomes = await planWorkspaceImport(twoAgents, target, {
    repositories: { 'repo-one': { backend: 'native', path: '/repo' } },
    agentHomes: {
      'agent-one': { backend: 'native', path: '/a/../same' },
      'agent-two': { backend: 'native', path: '/b/../same' },
    },
  }, caseProbe, { hostPlatform: 'linux' });
  check('probe paths containing dot segments are rejected as non-canonical',
    dotSegmentHomes.agentHomes.every((item) => item.status === 'invalid'));

  const portBundle = structuredClone(bundle);
  portBundle.repositories[0]!.remoteIdentity = 'git.example:8443/Org/Repo';
  const portProbe: WorkspaceTargetProbe = {
    ...probe,
    repository: async (_source, targetMapping) => ({
      ok: true, canonicalPath: targetMapping.path, remoteIdentity: 'git.example/Org/Repo',
    }),
  };
  const portPlan = await planWorkspaceImport(portBundle, target, mappings, portProbe, {
    hostPlatform: 'linux',
  });
  check('repository identities on distinct non-default ports never match',
    portPlan.repositories[0]?.status === 'invalid');

  const occupiedRepositoryTarget = structuredClone(DEFAULT_CONFIG);
  occupiedRepositoryTarget.repositories = [{
    ...structuredClone(sampleConfig().repositories[0]!),
    id: 'existing-repository',
    rootPath: '/srv/rhinoclaw',
    commonGitDir: '/srv/rhinoclaw/.git',
    executionBackend: 'native',
  }];
  const occupiedRepositoryPlan = await planWorkspaceImport(
    bundle, occupiedRepositoryTarget, mappings, probe, { hostPlatform: 'linux' },
  );
  check('mapped repositories conflict with matching existing target repositories',
    occupiedRepositoryPlan.repositories.every((item) => item.status === 'conflict'));
  const reusedRepositoryTarget = structuredClone(DEFAULT_CONFIG);
  reusedRepositoryTarget.repositories = [{
    ...structuredClone(sampleConfig().repositories[0]!),
    id: 'existing-repository',
    rootPath: mappings.repositories[bundle.repositories[0]!.id]!.path,
    commonGitDir: `${mappings.repositories[bundle.repositories[0]!.id]!.path}/.git`,
    executionBackend: 'native',
  }];
  const reusedRepositoryPlan = await planWorkspaceImport(
    bundle, reusedRepositoryTarget, mappings, probe, { hostPlatform: 'linux' },
  );
  check('an exact verified mapping explicitly reuses an existing target repository',
    reusedRepositoryPlan.repositories[0]?.status === 'reused'
      && reusedRepositoryPlan.repositories[0]?.targetId === 'existing-repository'
      && reusedRepositoryPlan.idMap.repositories[bundle.repositories[0]!.id] === 'existing-repository',
    reusedRepositoryPlan.repositories[0]);
  check('plan tokens bind the relevant target occupancy snapshot',
    occupiedRepositoryPlan.targetStateHash !== plan.targetStateHash
      && occupiedRepositoryPlan.token !== plan.token);

  const orderedOccupancyTarget = structuredClone(DEFAULT_CONFIG);
  orderedOccupancyTarget.repositories = [
    {
      ...structuredClone(sampleConfig().repositories[0]!), id: 'existing-b', name: 'Existing B',
      rootPath: '/home/target/projects/RhinoClaw', commonGitDir: '/home/target/projects/RhinoClaw/.git',
      executionBackend: 'native',
    },
    {
      ...structuredClone(sampleConfig().repositories[0]!), id: 'existing-a', name: 'Existing A',
      rootPath: '/home/target/projects/RhinoClaw', commonGitDir: '/home/target/projects/RhinoClaw/.git',
      executionBackend: 'native',
    },
  ];
  const orderedOccupancyPlan = await planWorkspaceImport(
    bundle, orderedOccupancyTarget, mappings, probe, { hostPlatform: 'linux' },
  );
  orderedOccupancyTarget.repositories.reverse();
  const reversedOccupancyPlan = await planWorkspaceImport(
    bundle, orderedOccupancyTarget, mappings, probe, { hostPlatform: 'linux' },
  );
  check('existing collision witnesses and tokens are independent of target array order',
    orderedOccupancyPlan.targetStateHash === reversedOccupancyPlan.targetStateHash
      && orderedOccupancyPlan.token === reversedOccupancyPlan.token
      && orderedOccupancyPlan.repositories[0]?.reason === reversedOccupancyPlan.repositories[0]?.reason);

  const duplicateRepositoryIds = structuredClone(sampleConfig());
  duplicateRepositoryIds.repositories.push({
    ...structuredClone(duplicateRepositoryIds.repositories[0]!), name: 'Duplicate repository id',
  });
  await rejectsAsync('duplicate target repository ids fail closed',
    () => planWorkspaceImport(bundle, duplicateRepositoryIds, mappings, probe, { hostPlatform: 'linux' }),
    /target repositories contains duplicate ids/i);
  const duplicateCategoryIds = structuredClone(sampleConfig());
  duplicateCategoryIds.categories.push({
    ...structuredClone(duplicateCategoryIds.categories[0]!), name: 'Duplicate category id',
  });
  await rejectsAsync('duplicate target category ids fail closed',
    () => planWorkspaceImport(bundle, duplicateCategoryIds, mappings, probe, { hostPlatform: 'linux' }),
    /target categories contains duplicate ids/i);
  const duplicateAgentIds = structuredClone(sampleConfig());
  duplicateAgentIds.agents.push({
    ...structuredClone(duplicateAgentIds.agents[0]!), name: 'Duplicate agent id',
  });
  await rejectsAsync('duplicate target agent ids fail closed',
    () => planWorkspaceImport(bundle, duplicateAgentIds, mappings, probe, { hostPlatform: 'linux' }),
    /target agents contains duplicate ids/i);
  const duplicateTemplateIds = structuredClone(sampleConfig());
  duplicateTemplateIds.agentTemplates.push({
    ...structuredClone(duplicateTemplateIds.agentTemplates[0]!), name: 'Duplicate template id',
  });
  await rejectsAsync('duplicate target template ids fail closed',
    () => planWorkspaceImport(bundle, duplicateTemplateIds, mappings, probe, { hostPlatform: 'linux' }),
    /target agent templates contains duplicate ids/i);

  const controlledTarget = structuredClone(DEFAULT_CONFIG);
  controlledTarget.repositories = [{
    ...structuredClone(sampleConfig().repositories[0]!), id: 'bad\0id', name: 'Bad\0Name',
  }];
  let controlledTargetProbes = 0;
  const controlledTargetProbe: WorkspaceTargetProbe = {
    ...probe,
    canonicalPath: async (targetMapping) => {
      controlledTargetProbes += 1;
      return { ok: true, canonicalPath: targetMapping.path };
    },
  };
  await rejectsAsync('control-bearing target identities fail closed before probes',
    () => planWorkspaceImport(bundle, controlledTarget, mappings, controlledTargetProbe, { hostPlatform: 'linux' }),
    /target repositories entry is malformed/i);
  check('malformed target identities invoke no canonical-path probes', controlledTargetProbes === 0);

  const malformedTargetPath = structuredClone(DEFAULT_CONFIG);
  malformedTargetPath.repositories = [
    {
      ...structuredClone(sampleConfig().repositories[0]!), id: 'valid-before-malformed',
      rootPath: '/valid/before', commonGitDir: '/valid/before/.git', executionBackend: 'native',
    },
    {
      ...structuredClone(sampleConfig().repositories[0]!), id: 'malformed-path',
      rootPath: null as unknown as string, commonGitDir: '/valid/malformed/.git', executionBackend: 'native',
    },
  ];
  let malformedPathProbes = 0;
  const malformedPathProbe: WorkspaceTargetProbe = {
    ...probe,
    canonicalPath: async (targetMapping) => {
      malformedPathProbes += 1;
      return { ok: true, canonicalPath: targetMapping.path };
    },
  };
  await rejectsAsync('all target paths are validated before canonical probes',
    () => planWorkspaceImport(bundle, malformedTargetPath, mappings, malformedPathProbe, { hostPlatform: 'linux' }),
    /invalid occupied path/i);
  malformedTargetPath.repositories.reverse();
  await rejectsAsync('target path validation is independent of collection order',
    () => planWorkspaceImport(bundle, malformedTargetPath, mappings, malformedPathProbe, { hostPlatform: 'linux' }),
    /invalid occupied path/i);
  check('malformed target paths invoke no canonical-path probes', malformedPathProbes === 0);

  let nullAgentFieldProbeCalls = 0;
  const nullAgentFieldProbe: WorkspaceTargetProbe = {
    repository: async () => {
      nullAgentFieldProbeCalls += 1;
      return { ok: false, reason: 'unexpected probe', remediation: 'none' };
    },
    agentHome: async () => {
      nullAgentFieldProbeCalls += 1;
      return { ok: false, reason: 'unexpected probe', remediation: 'none' };
    },
    canonicalPath: async (targetMapping) => {
      nullAgentFieldProbeCalls += 1;
      return { ok: true, canonicalPath: targetMapping.path };
    },
  };
  const malformedAgentHomeFields: Array<{
    field: 'homeWorkspaceDir' | 'homeExecutionBackend'; values: unknown[];
  }> = [
    { field: 'homeWorkspaceDir', values: [null, 42, true, {}, []] },
    { field: 'homeExecutionBackend', values: [null, 42, true, {}, [], 'invalid-backend'] },
  ];
  for (const { field, values } of malformedAgentHomeFields) {
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      const value = values[valueIndex];
      for (const position of [0, 1, 2]) {
        const nullFieldTarget = structuredClone(DEFAULT_CONFIG);
        nullFieldTarget.agents = Array.from({ length: 3 }, (_, index) => ({
          ...structuredClone(sampleConfig().agents[0]!),
          id: `target-agent-${index}`,
          name: `Target agent ${index}`,
          workspaceDir: `/valid/agent-${index}`,
          homeWorkspaceDir: `/valid/agent-${index}`,
          homeExecutionBackend: 'native' as const,
        }));
        (nullFieldTarget.agents[position] as unknown as Record<string, unknown>)[field] = value;
        await rejectsAsync(`malformed target agent ${field} value ${valueIndex} at position ${position} fails before probes`,
          () => planWorkspaceImport(bundle, nullFieldTarget, mappings, nullAgentFieldProbe, { hostPlatform: 'linux' }),
          /invalid occupied (path|backend)/i);
      }
    }
  }
  check('malformed target agent home fields invoke no planner probes', nullAgentFieldProbeCalls === 0);

  const occupiedAgentTarget = structuredClone(DEFAULT_CONFIG);
  occupiedAgentTarget.agents = [{
    ...structuredClone(sampleConfig().agents[0]!),
    id: 'existing-agent',
    name: 'Existing agent',
    workspaceDir: '/home/target/.config/ade/agents/agent-one/workspace',
    homeWorkspaceDir: '/home/target/.config/ade/agents/agent-one/workspace',
    homeExecutionBackend: 'native',
  }];
  const occupiedAgentPlan = await planWorkspaceImport(
    bundle, occupiedAgentTarget, mappings, probe, { hostPlatform: 'linux' },
  );
  check('mapped agent homes conflict with existing target occupancy',
    occupiedAgentPlan.agentHomes.every((item) => item.status === 'conflict'));

  const canonicalOccupancyTarget = structuredClone(DEFAULT_CONFIG);
  canonicalOccupancyTarget.repositories = [{
    ...structuredClone(sampleConfig().repositories[0]!),
    id: 'canonical-existing-repository',
    name: 'Canonical existing repository',
    rootPath: '/occupied-raw',
    commonGitDir: '/occupied-raw/.git',
    executionBackend: 'native',
  }];
  let occupiedCanonicalPath = '/occupied-a';
  const canonicalOccupancyProbe: WorkspaceTargetProbe = {
    ...probe,
    canonicalPath: async () => ({ ok: true, canonicalPath: occupiedCanonicalPath }),
  };
  const canonicalOccupancyPlanA = await planWorkspaceImport(
    bundle, canonicalOccupancyTarget, mappings, canonicalOccupancyProbe, { hostPlatform: 'linux' },
  );
  occupiedCanonicalPath = '/occupied-b';
  const canonicalOccupancyPlanB = await planWorkspaceImport(
    bundle, canonicalOccupancyTarget, mappings, canonicalOccupancyProbe, { hostPlatform: 'linux' },
  );
  check('plan tokens bind canonically re-probed target occupancy',
    canonicalOccupancyPlanA.repositories.every((item) => item.status === 'ready')
      && canonicalOccupancyPlanB.repositories.every((item) => item.status === 'ready')
      && canonicalOccupancyPlanA.targetStateHash !== canonicalOccupancyPlanB.targetStateHash
      && canonicalOccupancyPlanA.token !== canonicalOccupancyPlanB.token);

  const collidingNamesBundle = structuredClone(bundle);
  collidingNamesBundle.repositories.push({
    ...structuredClone(bundle.repositories[0]!), id: 'repo-two', name: ' rhinoclaw ', sourceLeafName: 'other',
  });
  collidingNamesBundle.categories.push({
    ...structuredClone(bundle.categories[0]!), id: 'category-two', name: ' BUILDERS ', agentIds: [],
  });
  collidingNamesBundle.agentTemplates.push({
    ...structuredClone(bundle.agentTemplates[0]!), id: 'template-two', name: ' builder template ',
  });
  const collidingNamesPlan = await planWorkspaceImport(collidingNamesBundle, target, {
    repositories: {
      ...mappings.repositories,
      'repo-two': { backend: 'native', path: '/home/target/projects/Other' },
    },
    agentHomes: mappings.agentHomes,
  }, probe, { hostPlatform: 'linux' });
  check('equivalent source names are marked as symmetric import conflicts',
    collidingNamesPlan.repositories.every((item) => item.status === 'conflict')
      && collidingNamesPlan.categories.every((item) => item.status === 'conflict')
      && collidingNamesPlan.agentTemplates.every((item) => item.status === 'conflict')
      && !collidingNamesPlan.canApplyFully);
}

async function testRealTargetProbe(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ade-target-probe-'));
  try {
    const repository = join(root, 'repository');
    const plain = join(root, 'plain');
    mkdirSync(repository);
    mkdirSync(plain);
    execFileSync('git', ['init', repository], { stdio: 'ignore' });
    execFileSync('git', ['-C', repository, 'remote', 'add', 'origin', 'git@github.com:McMuff86/RhinoClaw.git']);
    // This group probes the real filesystem, so it must judge paths by the
    // rules of the host it is actually running on; pinning 'linux' made every
    // C:\ path fail the POSIX-absolute check on Windows.
    const probe = new TargetPathProbe({ hostPlatform: process.platform });
    const repositoryResult = await probe.repository(validBundle().repositories[0]!, {
      backend: 'native', path: repository,
    });
    check('real target probe canonicalizes Git repositories and normalizes their remote',
      repositoryResult.ok
        // realpathSync keeps the 8.3 short component that os.tmpdir() hands
        // back on Windows ("ADI~1.MUF"); the probe resolves the long form, so
        // only the native variant is a fair comparison. Identical on Linux.
        && repositoryResult.canonicalPath === realpathSync.native(repository)
        && repositoryResult.remoteIdentity === 'github.com/McMuff86/RhinoClaw');

    const plainResult = await probe.repository(validBundle().repositories[0]!, {
      backend: 'native', path: plain,
    });
    check('real target probe rejects a directory that is not a Git repository',
      plainResult.ok === false && /Git/i.test(plainResult.reason));

    const nested = join(repository, 'nested');
    mkdirSync(nested);
    const nestedResult = await probe.repository(validBundle().repositories[0]!, {
      backend: 'native', path: nested,
    });
    check('real target probe rejects a nested directory instead of accepting it as repository root',
      nestedResult.ok === false && /root|worktree/i.test(nestedResult.reason));

    const homePath = join(root, 'new-agent-home');
    const homeResult = await probe.agentHome({ backend: 'native', path: homePath });
    check('real target probe accepts a new home below a writable existing parent without creating it',
      homeResult.ok && homeResult.occupancy === 'absent' && !pathExists(homePath));
    const existingHome = join(root, 'existing-agent-home');
    mkdirSync(existingHome);
    const existingHomeResult = await probe.agentHome({ backend: 'native', path: existingHome });
    check('real target probe reports existing homes instead of treating them as import-owned',
      existingHomeResult.ok && existingHomeResult.occupancy === 'empty-directory');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function testWorkspaceImportService(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ade-workspace-apply-'));
  try {
    const profileDir = join(root, 'profile', 'ade');
    const home = join(root, 'imported-home');
    mkdirSync(profileDir, { recursive: true });
    let config = structuredClone(DEFAULT_CONFIG);
    const store = {
      get: (): AdeConfig => structuredClone(config),
      replace: (next: AdeConfig): AdeConfig => {
        config = structuredClone(next);
        writeFileSync(join(profileDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
        return structuredClone(config);
      },
    };
    store.replace(config);
    const rawBundle = validBundle();
    rawBundle.repositories = [];
    rawBundle.categories[0]!.defaultRepositoryId = undefined;
    rawBundle.agents[0]!.defaultRepositoryId = undefined;
    const bundle = parseWorkspaceBundle(rawBundle);
    config.settings.theme = bundle.settings.theme === 'dark' ? 'light' : 'dark';
    store.replace(config);
    const preservedTheme = config.settings.theme;
    const mappings: WorkspaceImportMappings = {
      repositories: {},
      agentHomes: { [bundle.agents[0]!.id]: { backend: 'native', path: home } },
    };
    const probe: WorkspaceTargetProbe = {
      canonicalPath: async (target) => ({ ok: true, canonicalPath: target.path }),
      repository: async (_source, target) => ({ ok: true, canonicalPath: target.path }),
      agentHome: async (target) => ({ ok: true, canonicalPath: target.path }),
    };
    const plan = await planWorkspaceImport(bundle, config, mappings, probe, { hostPlatform: process.platform });
    const service = new WorkspaceImportService({
      profileDir, store, probe, hostPlatform: process.platform, now: () => 1_754_000_000_000,
    });
    const receipt = await service.apply(plan, mappings);
    check('transactional apply imports ready identities into a fresh target config',
      config.categories.length === 1 && config.agents.length === 1
        && config.agents[0]?.homeWorkspaceDir === home
        && config.workspaceBindings.length === 0
        && config.settings.theme === preservedTheme);
    check('transactional apply creates bounded backup and receipt artifacts',
      pathExists(receipt.backupPath) && pathExists(receipt.receiptPath));
    const durableReceiptText = readFileSync(receipt.receiptPath, 'utf8');
    check('durable receipt contains bounded audit metadata without absolute profile paths',
      durableReceiptText.includes('ade-workspace-import-receipt')
        && !durableReceiptText.includes(profileDir));
    check('transactional apply installs selected home, memory and photo resources',
      pathExists(home)
        && readFileSync(join(config.agents[0]!.memoryDir, 'MEMORY.md'), 'utf8') === bundle.agents[0]!.memory?.memory
        && readFileSync(join(config.agents[0]!.memoryDir, 'AGENTS.md'), 'utf8').includes('# ADE agent role contract')
        && Boolean(config.agents[0]!.photo)
        && pathExists(join(profileDir, 'photos', config.agents[0]!.photo!)));

    const recoveryBackupName = 'workspace-import-recovery-test';
    const recoveryBackupDir = join(profileDir, 'backups', recoveryBackupName);
    const recoveryStage = join(profileDir, '.workspace-import-staging', 'recovery-test');
    const recoveryOrphanName = `import-${'b'.repeat(32)}.png`;
    const recoveryOrphan = join(profileDir, 'photos', recoveryOrphanName);
    mkdirSync(recoveryBackupDir, { recursive: true });
    mkdirSync(recoveryStage, { recursive: true });
    const recoveryStageToken = 'a'.repeat(64);
    writeFileSync(join(recoveryStage, '.ade-workspace-import-owner'), recoveryStageToken);
    mkdirSync(join(profileDir, 'photos'), { recursive: true });
    const recoveryExpected = structuredClone(config);
    writeFileSync(join(recoveryBackupDir, 'config.json'), `${JSON.stringify(recoveryExpected, null, 2)}\n`);
    writeFileSync(recoveryOrphan, 'orphan');
    config.settings.theme = config.settings.theme === 'dark' ? 'light' : 'dark';
    config.agentTemplates.push({
      ...structuredClone(config.agentTemplates[0]!),
      id: 'recovery-imported-template',
      name: 'Recovery imported template',
      photo: recoveryOrphanName,
    });
    store.replace(config);
    mkdirSync(join(profileDir, 'import-transactions'), { recursive: true });
    writeFileSync(join(profileDir, 'import-transactions', 'pending.json'), `${JSON.stringify({
      format: 'ade-workspace-import-journal',
      version: 1,
      phase: 'prepared',
      beforeConfigSha256: createHash('sha256')
        .update(`${JSON.stringify(recoveryExpected, null, 2)}\n`).digest('hex'),
      targetConfigSha256: createHash('sha256')
        .update(readFileSync(join(profileDir, 'config.json'))).digest('hex'),
      receiptSha256: '0'.repeat(64),
      backup: recoveryBackupName,
      stage: ['.workspace-import-staging', 'recovery-test'],
      stagePaths: [{
        path: ['.workspace-import-staging', 'recovery-test'],
        kind: 'directory',
        ownership: recoveryStageToken,
      }],
      receipt: ['import-receipts', 'workspace-import-recovery-test.json'],
      managedPaths: [{
        path: ['photos', recoveryOrphanName],
        kind: 'file',
        ownership: createHash('sha256').update('orphan').digest('hex'),
      }],
      homes: [],
    })}\n`);
    await service.recoverPending();
    check('startup recovery rolls back a prepared durable import journal',
      config.settings.theme === recoveryExpected.settings.theme
        && !pathExists(recoveryOrphan)
        && !pathExists(recoveryStage)
        && !pathExists(join(profileDir, 'import-transactions', 'pending.json')));

    const partialRoot = join(root, 'partial');
    const partialProfile = join(partialRoot, 'profile', 'ade');
    const partialHome = join(partialRoot, 'skipped-home');
    mkdirSync(partialProfile, { recursive: true });
    const partialConfig = sampleConfig();
    partialConfig.categories = [];
    partialConfig.agents = [];
    partialConfig.repositories = [];
    partialConfig.workspaceBindings = [];
    partialConfig.agentTemplates = [];
    partialConfig.settings.theme = bundle.settings.theme === 'dark' ? 'light' : 'dark';
    const partialStore = {
      value: structuredClone(partialConfig),
      get(): AdeConfig { return structuredClone(this.value); },
      replace(next: AdeConfig): AdeConfig { this.value = structuredClone(next); return this.get(); },
    };
    const partialMappings: WorkspaceImportMappings = {
      repositories: {},
      agentHomes: { [bundle.agents[0]!.id]: { backend: 'native', path: partialHome } },
      skip: { agents: { [bundle.agents[0]!.id]: true } },
      settings: 'use-bundle',
    };
    const partialPlan = await planWorkspaceImport(
      bundle, partialStore.get(), partialMappings, probe, { hostPlatform: process.platform },
    );
    const partialReceipt = await new WorkspaceImportService({
      profileDir: partialProfile,
      store: partialStore,
      probe,
      hostPlatform: process.platform,
      now: () => 1_774_977_000_100,
    }).apply(partialPlan, partialMappings);
    check('partial import skips selected agents and dependent home resources without dangling references',
      partialPlan.canApplyFully
        && partialPlan.agents[0]?.status === 'skipped'
        && partialPlan.agentHomes[0]?.status === 'skipped'
        && partialStore.value.categories.length === 1
        && partialStore.value.categories[0]?.agents.length === 0
        && partialStore.value.agents.length === 0
        && partialStore.value.agentTemplates.length === 1
        && partialStore.value.settings.theme === bundle.settings.theme
        && partialReceipt.imported.agents === 0
        && !pathExists(partialHome));

    const faultPoints = [
      'backup-created', 'assets-staged', 'memory-staged',
      'config-persisted', 'assets-installed', 'cleanup',
    ] as const;
    let rollbackChecksPassed = true;
    for (const [index, faultPoint] of faultPoints.entries()) {
      const faultRoot = join(root, `fault-${index}`);
      const faultProfile = join(faultRoot, 'profile', 'ade');
      const faultHome = join(faultRoot, 'imported-home');
      mkdirSync(join(faultProfile, 'photos'), { recursive: true });
      mkdirSync(join(faultProfile, 'agents', 'existing', 'memory'), { recursive: true });
      writeFileSync(join(faultProfile, 'photos', 'existing.png'), 'existing-photo');
      writeFileSync(join(faultProfile, 'agents', 'existing', 'memory', 'MEMORY.md'), 'existing-memory');
      const original = structuredClone(DEFAULT_CONFIG);
      let faultConfig = structuredClone(original);
      const faultStore = {
        get: (): AdeConfig => structuredClone(faultConfig),
        replace: (next: AdeConfig): AdeConfig => {
          faultConfig = structuredClone(next);
          writeFileSync(join(faultProfile, 'config.json'), `${JSON.stringify(faultConfig, null, 2)}\n`);
          return structuredClone(faultConfig);
        },
      };
      faultStore.replace(original);
      const faultMappings: WorkspaceImportMappings = {
        repositories: {},
        agentHomes: { [bundle.agents[0]!.id]: { backend: 'native', path: faultHome } },
      };
      const faultPlan = await planWorkspaceImport(
        bundle, original, faultMappings, probe, { hostPlatform: process.platform },
      );
      const faultService = new WorkspaceImportService({
        profileDir: faultProfile,
        store: faultStore,
        probe,
        hostPlatform: process.platform,
        now: () => 1_754_000_100_000 + index,
        fault: (point) => {
          if (point === faultPoint) throw new Error(`injected ${faultPoint}`);
        },
      });
      await rejectsAsync(`transaction rolls back an injected ${faultPoint} failure`,
        () => faultService.apply(faultPlan, faultMappings), /injected/);
      rollbackChecksPassed = rollbackChecksPassed
        && JSON.stringify(faultConfig) === JSON.stringify(original)
        && readFileSync(join(faultProfile, 'photos', 'existing.png'), 'utf8') === 'existing-photo'
        && readFileSync(join(faultProfile, 'agents', 'existing', 'memory', 'MEMORY.md'), 'utf8') === 'existing-memory'
        && !pathExists(faultHome);
    }
    check('fault injection leaves original config and managed resources usable', rollbackChecksPassed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function testExecutionBackendHomeProvisioner(): Promise<void> {
  const calls: Array<{ backend: string; executable: string; args: string[]; input?: string }> = [];
  const execution = {
    async text(backend: string, executable: string, args: string[]): Promise<string> {
      calls.push({ backend, executable, args });
      return '["/home/adi/portable-agent"]';
    },
    async checked(backend: string, executable: string, args: string[], options: { input?: string }): Promise<object> {
      calls.push({ backend, executable, args, input: options.input });
      return {};
    },
  } as unknown as ExecutionBackendService;
  const provisioner = new ExecutionBackendHomeProvisioner(execution);
  const target = { backend: 'wsl:Ubuntu' as const, path: '/home/adi/portable-agent' };
  const ownershipToken = 'a'.repeat(64);
  const created = await provisioner.ensure(target, target.path, ownershipToken);
  await provisioner.rollback(target, created, ownershipToken);
  check('WSL home provisioning uses argv-only bounded backend calls and exact rollback paths',
    created.length === 1
      && created[0] === target.path
      && calls.length === 2
      && calls.every((call) => call.backend === target.backend && call.executable === 'python3')
      && calls[1]?.input === JSON.stringify({ paths: created, token: ownershipToken }));
}

function testConfigStoreReplacement(): void {
  const root = mkdtempSync(join(tmpdir(), 'ade-config-replace-'));
  try {
    const path = join(root, 'ade', 'config.json');
    const store = new ConfigStore(path);
    const invalid = structuredClone(store.get());
    invalid.settings.theme = 'invalid' as AdeConfig['settings']['theme'];
    let invalidRejected = false;
    try { store.replace(invalid); } catch { invalidRejected = true; }
    check('complete config replacement rejects invalid runtime values', invalidRejected);

    const invalidRun = structuredClone(store.get());
    invalidRun.runs = [{ bad: true }] as unknown as AdeConfig['runs'];
    let invalidRunRejected = false;
    try { store.replace(invalidRun); } catch { invalidRunRejected = true; }
    check('complete config replacement rejects malformed orchestration records', invalidRunRejected);

    const runBase = {
      id: 'run-a', name: 'Run A', goal: 'Validate', status: 'draft' as const, mode: 'managed' as const,
      phase: 'draft' as const,
      budget: { maxConcurrentTasks: 1, maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxApprovals: 1 },
      createdAt: 1, updatedAt: 1,
    };
    const invalidEnum = structuredClone(store.get());
    invalidEnum.runs = [{ ...runBase, status: 'bogus' }] as unknown as AdeConfig['runs'];
    let invalidEnumRejected = false;
    try { validateCompleteConfig(invalidEnum); } catch { invalidEnumRejected = true; }
    check('complete config validation rejects invalid run enums', invalidEnumRejected);

    const danglingRepository = structuredClone(store.get());
    danglingRepository.runs = [{ ...runBase, repositoryId: 'missing-repository' }];
    let danglingRepositoryRejected = false;
    try { validateCompleteConfig(danglingRepository); } catch { danglingRepositoryRejected = true; }
    check('complete config validation rejects dangling run repositories', danglingRepositoryRejected);

    const crossRun = structuredClone(store.get());
    crossRun.runs = [runBase, { ...runBase, id: 'run-b', name: 'Run B' }];
    crossRun.runParticipants = [{
      id: 'participant-b', runId: 'run-b', agentId: 'historical-agent', agentName: 'Worker',
      runtime: 'codex', role: 'worker', createdAt: 1,
    }];
    crossRun.runTasks = [{
      id: 'task-a', runId: 'run-a', participantId: 'participant-b', prompt: 'Work', title: 'Work',
      phase: 'work', managed: true, dependsOn: [], attempt: 0, status: 'queued', createdAt: 1, updatedAt: 1,
    }];
    let crossRunRejected = false;
    try { validateCompleteConfig(crossRun); } catch { crossRunRejected = true; }
    check('complete config validation rejects cross-run task participants', crossRunRejected);

    if (IS_LINUX) {
      const peer = new ConfigStore(path);
      const release = store.acquireWorkspaceImportLock();
      let concurrentWriterRejected = false;
      try { peer.save({}); } catch { concurrentWriterRejected = true; }
      release();
      check('profile lock serializes ordinary config writers with workspace imports', concurrentWriterRejected);
    } else {
      skip('profile lock serialization', 'the workspace import lock is Linux-only');
    }

    const valid = structuredClone(store.get());
    writeFileSync(path, `${JSON.stringify(valid)}\n `);
    let externalWriteRejected = false;
    try { store.replace(valid); } catch { externalWriteRejected = true; }
    check('config replacement CAS rejects an out-of-process disk change', externalWriteRejected);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  testSchemaAndExporter();
  if (MANAGED.canApply) {
    testProfileSource();
    testProfileSourceBoundaries();
  } else {
    skip('profile source', `managed profile access is ${MANAGED.level} on this host`);
    skip('profile source boundaries', `managed profile access is ${MANAGED.level} on this host`);
  }
  if (IS_LINUX) {
    testProfileRootSwap();
  } else {
    // Honest gap, not an oversight: a Windows directory handle does not pin its
    // directory (measured), so the host revalidates identity instead of
    // preventing the swap. It cannot pass a test written for prevention.
    skip('profile root swap', 'the Windows host revalidates identity instead of pinning it');
  }
  await testImportPlanner();
  await testRealTargetProbe();
  if (MANAGED.canApply) {
    await testWorkspaceImportService();
  } else {
    skip('workspace import service', `managed profile access is ${MANAGED.level} on this host`);
  }
  await testExecutionBackendHomeProvisioner();
  testConfigStoreReplacement();
  console.log(`\nWorkspace bundle: ${passed} passed, ${failed} failed`
    + (skipped > 0 ? `, ${skipped} group(s) skipped on ${process.platform}` : ''));
  if (failed > 0) process.exitCode = 1;
}

void main();
