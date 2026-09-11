/** Permission recipes and build provenance must fail closed without inventing readiness. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { buildIdentity } from '../build/identity';
import { BUILD_INFO, compareBuilds, isBuildInfo } from '../src/shared/buildInfo';
import { addSetupScopes, setupReadiness } from '../src/shared/setup';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-setup-state-')));
try {
  const project = addSetupScopes([], 'project');
  check('project recipe grants file, checkout, local Git and terminal workflow', setupReadiness('project', project, true, true).status === 'ready');
  check('project recipe never grants publishing or host restart', !project.includes('projectGit:publish') && !project.includes('host:restart'));
  check('presets preserve unrelated explicit grants', addSetupScopes(['profiles:write', 'host:restart'], 'results').includes('profiles:write') && addSetupScopes(['host:restart'], 'results').includes('host:restart'));
  check('repeating a preset creates no duplicate grants', new Set(addSetupScopes(project, 'project')).size === addSetupScopes(project, 'project').length);
  check('file reading needs neither root nor write permission', setupReadiness('results', ['workspace:read'], undefined, true).status === 'ready' && addSetupScopes([], 'results').join() === 'workspace:read');
  check('publish is a separate explicit recipe without terminal control', setupReadiness('publish', project, true, true).missing.join() === 'projectGit:publish' && !addSetupScopes([], 'publish').includes('terminal:control'));
  check('missing root remains actionable despite complete grants', setupReadiness('project', project, false, true).status === 'missing' && setupReadiness('project', project, false, true).root === 'missing');
  check('legacy host with no project defaults remains unknown', setupReadiness('project', project, undefined, true).status === 'unknown');
  check('legacy host with no capabilities never claims readiness', setupReadiness('results', undefined, true, true).status === 'unknown');
  check('known empty capabilities list reports exact missing scope', setupReadiness('results', [], false, true).missing.join() === 'workspace:read');
  check('unrecognized capability grants no authority', setupReadiness('results', ['all', 42], true, true).status === 'missing');
  check('offline wins over cached complete grants', setupReadiness('project', project, true, false).status === 'offline');
  check('offline with no state does not imply setup was lost', setupReadiness('results', null, undefined, false).status === 'offline');
  check('direct source execution reports no invented compiled build', BUILD_INFO === undefined);
  const one = { sourceId: '0123456789abcdef0123', builtAt: '2026-09-11T10:00:00.000Z' };
  check('bounded build descriptor validates', isBuildInfo(one));
  check('same source with different build timestamps is compatible', compareBuilds(one, { ...one, builtAt: '2026-09-11T11:00:00.000Z' }) === 'same');
  check('different source yields an explicit difference', compareBuilds(one, { ...one, sourceId: 'abcdef0123456789abcd' }) === 'different');
  check('missing either build remains unknown', compareBuilds(undefined, one) === 'unknown' && compareBuilds(one, undefined) === 'unknown');
  check('unexpected paths and invalid timestamps fail descriptor validation', !isBuildInfo({ ...one, path: 'C:/private' }) && !isBuildInfo({ ...one, sourceId: 'C:/private' }) && !isBuildInfo({ ...one, builtAt: 'not a date' }));
  for (const dir of ['src/nested', 'build', 'docs']) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ['package.json', 'pnpm-lock.yaml', 'electron.vite.config.ts', 'vite.mobile.config.ts', 'tsconfig.node.json', 'tsconfig.web.json', 'build/identity.ts', 'src/nested/app.ts']) writeFileSync(join(root, file), `fixture:${file}`);
  const initial = buildIdentity(root, new Date(one.builtAt));
  check('generator emits only a bounded digest and timestamp', isBuildInfo(initial) && !JSON.stringify(initial).includes(root));
  check('same sources built later retain their identity', buildIdentity(root).sourceId === initial.sourceId);
  writeFileSync(join(root, 'docs', 'guide.md'), 'Documentation only');
  check('documentation changes do not invent a new application build', buildIdentity(root).sourceId === initial.sourceId);
  writeFileSync(join(root, 'src', 'nested', 'app.ts'), 'changed application');
  const sourceChanged = buildIdentity(root);
  check('nested application changes alter the fingerprint', sourceChanged.sourceId !== initial.sourceId);
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'changed dependency');
  check('dependency changes alter the fingerprint', buildIdentity(root).sourceId !== sourceChanged.sourceId);
  symlinkSync(join(root, 'docs'), join(root, 'src', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  let rejected = false; try { buildIdentity(root); } catch (error) { rejected = error instanceof Error && error.message === 'Build inputs must not contain links'; }
  check('linked sources fail for the intended boundary reason', rejected);
  rmSync(join(root, 'src', 'linked'));
  check('positive control succeeds after removing the link', isBuildInfo(buildIdentity(root)));
} catch (error) { failed++; console.error(error); }
finally {
  if (dirname(resolve(root)) !== realpathSync.native(tmpdir()) || !basename(root).startsWith('ade-setup-state-')) throw new Error('Unexpected setup state fixture cleanup root');
  rmSync(root, { recursive: true, force: true });
}
console.log(`Setup state: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
