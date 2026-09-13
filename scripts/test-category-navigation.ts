import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { groupCategories, navigationGroup, validNavigationGroup, shiftNavigationItem } from '../src/shared/categoryNavigation';
import { DEFAULT_CONFIG, type AdeConfig } from '../src/shared/types';
import { ConfigStore, validateCompleteConfig } from '../src/main/config/store';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { updateCategory, reorderCategories } from '../src/main/identity';
import { exportWorkspaceBundle } from '../src/main/portability/WorkspaceBundleExporter';
import { parseWorkspaceBundle } from '../src/shared/workspaceBundle';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';

let passed = 0;
const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
async function refuses(label: string, action: () => unknown, code?: string) {
  try { await action(); } catch (error) { check(label, !code || error instanceof RemoteApiError && error.code === code); return; }
  throw new Error(label);
}
void (async () => {
  const root = mkdtempSync(join(tmpdir(), 'ade-category-navigation-'));
  const config = structuredClone(DEFAULT_CONFIG);
  config.categories = [
    { id: 'local', name: 'Project', agents: [] },
    { id: 'hermes', name: 'Hermes', agents: [], navigationGroup: 'Agent-Systeme' },
    { id: 'other', name: 'Other project', agents: [] },
    { id: 'claw', name: 'OpenClaw', agents: [], navigationGroup: 'Agent-Systeme' },
  ];
  validateCompleteConfig(config);
  const rows = groupCategories(config.categories);
  check('group keeps its first category position without consuming loose categories', rows.map((row) => row.key).join() === 'category:local,group:Agent-Systeme,category:other');
  check('member order follows existing category order', rows[1]!.categories.map((item) => item.id).join() === 'hermes,claw');
  check('moving a group moves all members past a loose project', shiftNavigationItem(config.categories, 'group:Agent-Systeme', 1)?.join() === 'local,other,hermes,claw');
  check('moving a loose project skips the complete adjacent group', shiftNavigationItem(config.categories, 'category:other', -1)?.join() === 'local,other,hermes,claw');
  check('moving a first group member preserves the group root position', shiftNavigationItem(config.categories, 'category:hermes', 1)?.join() === 'local,claw,hermes,other');
  check('moving a member up preserves membership and other rows', shiftNavigationItem(config.categories, 'category:claw', -1)?.join() === 'local,claw,hermes,other');
  check('boundaries and unknown keys cannot move', shiftNavigationItem(config.categories, 'category:local', -1) === null
    && shiftNavigationItem(config.categories, 'category:other', 1) === null
    && shiftNavigationItem(config.categories, 'category:hermes', -1) === null
    && shiftNavigationItem(config.categories, 'category:claw', 1) === null
    && shiftNavigationItem([], 'missing', 1) === null);
  check('plain legacy categories preserve their original layout order', groupCategories(config.categories.map(({ navigationGroup: _group, ...item }) => item)).length === 4);
  check('grouping never mutates category identities or records', config.categories.map((item) => item.id).join() === 'local,hermes,other,claw');
  check('group names are bounded and reject control characters', !validNavigationGroup('x'.repeat(81)) && !validNavigationGroup('a\nb') && !validNavigationGroup(' x ') && validNavigationGroup('Agent-Systeme'));
  check('explicit null clears the optional group', navigationGroup(null) === undefined);
  await refuses('config rejects additional hierarchy properties', () => validateCompleteConfig({ ...config, categories: [{ ...config.categories[0]!, parentId: 'hermes' }] } as unknown as AdeConfig));
  await refuses('config rejects malformed group values', () => validateCompleteConfig({ ...config, categories: [{ ...config.categories[0]!, navigationGroup: { name: 'x' } }] } as unknown as AdeConfig));
  assertIpcPayload('category:update', { id: 'hermes', name: 'Hermes', navigationGroup: null });
  assertIpcPayload('category:create', { name: 'Hermes', navigationGroup: 'Agent-Systeme' });
  check('existing narrow desktop IPC accepts group create and clear', true);
  await refuses('desktop IPC rejects nested or injected commands', () => assertIpcPayload('category:update', { id: 'hermes', name: 'Hermes', navigationGroup: 'Agent-Systeme', command: 'whoami' }));
  const store = new ConfigStore(join(root, 'config.json')); store.save(config);
  updateCategory(store, { id: 'hermes', name: 'Hermes 2' });
  check('ordinary rename preserves group', store.get().categories[1]!.navigationGroup === 'Agent-Systeme');
  updateCategory(store, { id: 'hermes', name: 'Hermes 2', navigationGroup: null });
  check('clear retains category record and role', store.get().categories[1]!.id === 'hermes' && store.get().categories[1]!.navigationGroup === undefined);
  updateCategory(store, { id: 'hermes', name: 'Hermes 2', navigationGroup: 'Agent-Systeme' });
  check('group survives config restart', new ConfigStore(join(root, 'config.json')).get().categories[1]!.navigationGroup === 'Agent-Systeme');
  const bundle = exportWorkspaceBundle(store.get(), { sourcePlatform: 'win32' }).bundle;
  check('portable bundle preserves category group', parseWorkspaceBundle(JSON.parse(JSON.stringify(bundle))).categories[1]!.navigationGroup === 'Agent-Systeme');
  reorderCategories(store, shiftNavigationItem(store.get().categories, 'group:Agent-Systeme', 1)!);
  check('whole group order survives a config store restart', new ConfigStore(join(root, 'config.json')).get().categories.map((cat) => cat.id).join() === 'local,other,hermes,claw');
  const f = createRemoteWorkspaceFixture(join(root, 'remote')); const { application: app, devices } = f;
  devices.enroll('tablet', 'Tablet', 'n'.repeat(40));
  const context = (): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices()[0]!.scopes) }, idempotencyKey: randomUUID(), requestId: 'group-review' });
  const command = { operation: 'category-group', input: { categoryId: 'category', navigationGroup: 'Agent-Systeme' } };
  const original = JSON.stringify({ agents: f.store.get().agents, bindings: f.store.get().workspaceBindings, runs: f.store.get().runs });
  await refuses('read-only mobile cannot reorganize categories', () => app.administer(context(), command), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write']);
  await refuses('mobile group mutation needs an idempotency key', () => app.administer({ ...context(), idempotencyKey: undefined }, command), 'idempotency_key_required');
  const ctx = context(); await app.administer(ctx, command);
  check('mobile group operation preserves identities, workspaces and runs', JSON.stringify({ agents: f.store.get().agents, bindings: f.store.get().workspaceBindings, runs: f.store.get().runs }) === original);
  check('catalog contains navigation group and reciprocal agent categories', app.catalog(ctx.principal).categories![0]!.navigationGroup === 'Agent-Systeme' && app.catalog(ctx.principal).agents.every((agent) => agent.categoryId === 'category'));
  check('same key replays group mutation', (await app.administer(ctx, command)).replayed);
  devices.setAdminScopes('tablet', ['catalog:write'], { mode: 'selected', repositoryIds: [], agentIds: ['builder'] });
  check('restricted catalog exposes only allowed agents and their categories', app.catalog(context().principal).agents.length === 1 && app.catalog(context().principal).categories!.length === 1);
  await refuses('partial category access cannot reorganize other agents', () => app.administer(context(), command), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['catalog:write'], { mode: 'selected', repositoryIds: [], agentIds: [] });
  check('groups do not reveal categories without granted agents', app.catalog(context().principal).categories!.length === 0);
  devices.setAdminScopes('tablet', ['catalog:write'], { mode: 'all' });
  await app.administer(context(), { operation: 'category-group', input: { categoryId: 'category', navigationGroup: null } });
  check('final positive control clears group after access is restored', app.catalog(context().principal).categories![0]!.navigationGroup === undefined);
  console.log(`Category navigation: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
