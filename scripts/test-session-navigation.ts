import { desktopSessionNavigation, filterSessionNavigation, mobileSessionNavigation } from '../src/shared/sessionNavigation';
import type { SessionMeta } from '../src/shared/types';
import type { MobileRecentSession } from '../src/shared/remote';

let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok ${name}`); } else { failed++; console.error(`FAIL ${name}`); } };
const session = (fields: Partial<SessionMeta> = {}): SessionMeta => ({ id: 'one', title: 'Codex', kind: 'interactive', status: 'running', createdAt: 1,
  runtime: 'codex', projectWorkspaceId: 'workspace-one', repositoryId: 'repo-one', branch: 'main', workspaceDir: '/private/checkout', launchChoice: { mode: 'codex' }, ...fields });
const repositories = ['one', 'two'].map(id => ({ id: `repo-${id}`, name: 'Same project name', rootPath: `/private/${id}`, commonGitDir: `/private/${id}/.git`, createdAt: 0, verified: true, executionBackend: 'native' as const }));
const sources = [session(), session({ id: 'two', repositoryId: 'repo-two', projectWorkspaceId: 'workspace-two', title: 'Grok', launchChoice: { mode: 'grok' }, createdAt: 2 }),
  session({ id: 'task', kind: 'task' }), session({ id: 'login', remoteAccessBlocked: true }), session({ id: 'hidden-task', runTaskId: 'task-id' }),
  session({ id: 'orphan', projectWorkspaceId: undefined }), session({ id: 'ended', createdAt: 3, status: 'exited' })];
const before = JSON.stringify(sources);
const rows = desktopSessionNavigation(sources, repositories, {});
check('only addressable interactive sessions are offered', rows.length === 3 && !rows.some(row => ['task', 'login', 'hidden-task', 'orphan'].includes(row.id)));
check('duplicate project names keep separate session identities', rows[0]?.id === 'two' && rows[1]?.id === 'one' && rows[0].project === rows[1].project);
check('open sessions precede newer closed sessions', rows[2]?.id === 'ended');
check('no host path or raw session structure in navigation projection', !JSON.stringify(rows).includes('/private') && !Object.hasOwn(rows[0]!, 'projectWorkspaceId'));
check('search combines project, CLI and branch terms', filterSessionNavigation(rows, 'same GROK main').map(row => row.id).join() === 'two');
check('empty search retains every visible session', filterSessionNavigation(rows, '  ').length === rows.length);
check('unmatched search is empty', filterSessionNavigation(rows, 'missing').length === 0);
check('deleted project is labelled without reassignment', desktopSessionNavigation([session()], [], {})[0]?.project === 'Entferntes Projekt');
check('home session needs no repository or profile', desktopSessionNavigation([session({ repositoryId: undefined, projectWorkspaceId: undefined, scopeSource: 'terminal-home' })], [], {})[0]?.project === 'Ohne Projekt');
check('output changes cannot reorder the switcher', desktopSessionNavigation(sources.map(item => ({ ...item, outputSequence: 99, lastOutputAt: 999 })), repositories, {}).map(item => item.id).join() === rows.map(item => item.id).join());
check('source sessions remain unchanged', JSON.stringify(sources) === before);
const mobile: MobileRecentSession[] = [{ id: 'two', title: 'Grok', status: 'running', owner: 'desktop', projectName: 'Same project name', branch: 'main', launchMode: 'grok', projectWorkspaceId: 'workspace-two', createdAt: 2 },
  { id: 'one', title: 'Codex', status: 'running', owner: 'self', projectName: 'Same project name', branch: 'main', launchMode: 'codex', projectWorkspaceId: 'workspace-one', createdAt: 1 }];
const remote = mobileSessionNavigation(mobile, null);
check('tablet uses host-confirmed names without catalog dependency', remote[0]?.project === 'Same project name');
check('desktop and tablet agree on IDs, ordering and display for the same work', JSON.stringify(rows.slice(0, 2)) === JSON.stringify(remote));
check('input owner does not change selection or imply task completion', JSON.stringify(mobileSessionNavigation(mobile.map(item => ({ ...item, owner: 'other' })), null)) === JSON.stringify(remote));
console.log(`Session navigation: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
