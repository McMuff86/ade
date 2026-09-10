import { clearDeviceDrafts, readDeviceDraft, writeDeviceDraft } from '../src/mobile/deviceDrafts';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
const values = new Map<string, string>();
const storage = Object.create(null) as Storage;
Object.defineProperties(storage, {
  getItem: { value: (key: string) => values.get(key) ?? null },
  setItem: { value: (key: string, value: string) => { values.set(key, value); Object.defineProperty(storage, key, { configurable: true, enumerable: true, value }); } },
  removeItem: { value: (key: string) => { values.delete(key); delete (storage as unknown as Record<string, unknown>)[key]; } },
});
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
const key = 'terminal-draft:agent:repo:terminal';
const fallback = { text: '', review: false };
check('unpaired pages cannot save device data', !writeDeviceDraft(null, key, { text: 'private', review: false }));
check('terminal draft is saved for its own device', writeDeviceDraft('tablet', key, { text: 'private', review: false })
  && readDeviceDraft('tablet', key, fallback).text === 'private');
check('a new device cannot inherit another device draft', readDeviceDraft('other', key, fallback).text === '');
storage.setItem(`ade-work:tablet:${key}`, '{broken');
check('malformed draft storage falls back safely', readDeviceDraft('tablet', key, fallback).text === '');
storage.setItem(`ade-work:tablet:${key}`, JSON.stringify({ at: Date.now(), value: { text: 17, review: false } }));
check('wrong draft shapes cannot crash the terminal composer', readDeviceDraft('tablet', key, fallback).text === '');
storage.setItem(`ade-work:tablet:${key}`, JSON.stringify({ at: 1, value: { text: 'old', review: false } }));
check('ordinary old drafts expire', readDeviceDraft('tablet', key, fallback).text === '');
storage.setItem(`ade-work:tablet:${key}`, JSON.stringify({ at: 1, value: { text: 'uncertain', review: true } }));
check('uncertain input markers do not expire into a sendable draft', readDeviceDraft('tablet', key, fallback).review);
for (let i = 0; i < 35; i++) writeDeviceDraft('tablet', `terminal-draft:a:r:${i}`, { text: `text-${i}`, review: false });
check('per-device draft records stay bounded', Object.keys(storage).filter((name) => name.startsWith('ade-work:tablet:')).length === 24);
check('ordinary eviction preserves uncertain terminal input', readDeviceDraft('tablet', key, fallback).review);
check('oversized drafts are refused', !writeDeviceDraft('tablet', key, { text: 'x'.repeat(128 * 1024), review: false }));
writeDeviceDraft('other', key, { text: 'other draft', review: false });
clearDeviceDrafts('tablet');
check('revocation removes only the matching device records', Object.keys(storage).every((name) => !name.startsWith('ade-work:tablet:'))
  && readDeviceDraft('other', key, fallback).text === 'other draft');
writeDeviceDraft('other', key, null);
check('completed recovery records release storage capacity', !values.has(`ade-work:other:${key}`));
const preparation = { key: 'receipt-1', agentId: 'builder', phase: 'workspace' };
writeDeviceDraft('project-tablet', 'open-project', 'project');
writeDeviceDraft('project-tablet', 'project-workspace:project', preparation);
check('project selection and preparation restore after reload', readDeviceDraft<string>('project-tablet', 'open-project', '') === 'project'
  && readDeviceDraft('project-tablet', 'project-workspace:project', preparation).key === preparation.key);
storage.setItem('ade-work:project-tablet:project-workspace:project', JSON.stringify({ at: 1, value: preparation }));
for (let i = 0; i < 35; i++) writeDeviceDraft('project-tablet', `terminal-selection:${i}`, `session-${i}`);
check('uncertain project preparation survives expiry and ordinary eviction', readDeviceDraft('project-tablet', 'project-workspace:project', null) !== null);
storage.setItem('ade-work:project-tablet:project-workspace:bad', JSON.stringify({ at: Date.now(), value: { ...preparation, phase: 'shell' } }));
check('malformed project preparation is refused', readDeviceDraft('project-tablet', 'project-workspace:bad', null) === null);
const opening = { key: 'project-open-1', entryId: 'p' + 'a'.repeat(32), name: 'Unregistered project' };
writeDeviceDraft('new-project-tablet', 'project-opening', opening);
check('independent project open preserves opaque target and receipt across reload', readDeviceDraft<typeof opening | null>('new-project-tablet', 'project-opening', null)?.key === opening.key);
storage.setItem('ade-work:new-project-tablet:project-opening', JSON.stringify({ at: 1, value: opening }));
for (let i = 0; i < 35; i++) writeDeviceDraft('new-project-tablet', `terminal-selection:${i}`, `session-${i}`);
check('independent open receipt survives TTL and ordinary eviction', readDeviceDraft('new-project-tablet', 'project-opening', null) !== null);
storage.setItem('ade-work:new-project-tablet:project-opening', JSON.stringify({ at: Date.now(), value: { ...opening, entryId: 'C:\\private' } }));
check('host paths cannot be restored as project-open targets', readDeviceDraft('new-project-tablet', 'project-opening', null) === null);
writeDeviceDraft('new-project-tablet', 'project-selected', '12345678-1234-1234-1234-123456789abc');
check('independent workspace selection survives reload separately from agent selection', readDeviceDraft<string>('new-project-tablet', 'project-selected', '') === '12345678-1234-1234-1234-123456789abc');
const branchWorkspace = '12345678-1234-1234-1234-123456789abc'; const branchKey = `project-branch:${branchWorkspace}`;
const branchPending = { key: 'branch-receipt-1', preview: { id: '12345678-1234-1234-1234-123456789abd', workspaceId: branchWorkspace,
  projectName: 'Project', fromBranch: 'main', toBranch: 'feature/tablet', expiresAt: 1, separate: false, action: { kind: 'switch', ref: 'refs/heads/feature/tablet' } } };
storage.setItem(`ade-work:branch-tablet:${branchKey}`, JSON.stringify({ at: 1, value: branchPending }));
check('uncertain branch receipt survives reload and ordinary draft expiry', readDeviceDraft<typeof branchPending | null>('branch-tablet', branchKey, null)?.key === branchPending.key);
storage.setItem(`ade-work:branch-tablet:${branchKey}`, JSON.stringify({ at: Date.now(), value: { ...branchPending, preview: { ...branchPending.preview, workspaceId: 'other' } } }));
check('branch receipt cannot cross workspace identities', readDeviceDraft('branch-tablet', branchKey, null) === null);
const projectStart = { key: 'create-project-1', name: 'Garden', repositoryId: '', phase: 'project' };
check('profile-free project creation can persist its receipt before sending', writeDeviceDraft('start-tablet', 'project-start', projectStart)
  && readDeviceDraft<typeof projectStart | null>('start-tablet', 'project-start', null)?.key === projectStart.key);
check('legacy pending project starts remain recoverable', writeDeviceDraft('start-tablet', 'project-start', { ...projectStart, agentId: 'legacy-agent', phase: 'terminal' }));
writeDeviceDraft('start-tablet', 'project-start', { ...projectStart, projectWorkspaceId: 'C:\\private' });
check('project start cannot restore a host path as its workspace identity', readDeviceDraft('start-tablet', 'project-start', null) === null);
const gitKey = `project-git:${branchWorkspace}`; const gitPending = { key: 'git-receipt', preview: { id: '12345678-1234-1234-1234-123456789abd', workspaceId: branchWorkspace,
  projectName: 'Project', branch: 'main', head: 'a'.repeat(40), targetHead: null, expiresAt: 1, affected: ['a.txt'], action: { kind: 'commit', paths: ['a.txt'], message: 'Save selected file' } } };
storage.setItem(`ade-work:git-tablet:${gitKey}`, JSON.stringify({ at: 1, value: gitPending }));
for (let i = 0; i < 35; i++) writeDeviceDraft('git-tablet', `terminal-selection:${i}`, `session-${i}`);
check('unconfirmed Git preview survives expiry and ordinary eviction', readDeviceDraft<typeof gitPending | null>('git-tablet', gitKey, null)?.key === gitPending.key);
writeDeviceDraft('git-tablet', gitKey, { ...gitPending, preview: { ...gitPending.preview, head: {} } });
check('malformed Git history cannot crash the preview', readDeviceDraft('git-tablet', gitKey, null) === null);
const fileKey = `project-file:${branchWorkspace}`; const filePending = { key: 'file-receipt', input: { projectWorkspaceId: branchWorkspace, path: 'a.txt', text: 'resolution', revision: 'a'.repeat(64), workspaceVersion: 'b'.repeat(64) } };
storage.setItem(`ade-work:git-tablet:${fileKey}`, JSON.stringify({ at: 1, value: filePending }));
check('unconfirmed conflict save keeps exact submitted content over reload', readDeviceDraft<typeof filePending | null>('git-tablet', fileKey, null)?.input.text === 'resolution');
writeDeviceDraft('git-tablet', fileKey, { ...filePending, input: { ...filePending.input, projectWorkspaceId: 'other' } });
check('file receipt cannot cross workspace identities', readDeviceDraft('git-tablet', fileKey, null) === null);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('storage disabled'); } });
check('storage failure is reported before any command can use it', !writeDeviceDraft('tablet', key, fallback) && readDeviceDraft('tablet', key, fallback) === fallback);
delete (globalThis as unknown as Record<string, unknown>).localStorage;
console.log(`Device drafts: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
