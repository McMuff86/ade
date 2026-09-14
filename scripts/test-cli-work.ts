import { cliWorkRows, cliWorkStatus, matchesCliWork } from '../src/shared/cliWork';
import { DEFAULT_CONFIG, type Agent, type SessionMeta } from '../src/shared/types';
import { projectOverview } from '../src/main/overview/projectOverview';

let passed = 0; let failed = 0;
function check(name: string, ok: boolean) { if (ok) { passed++; console.log(`  ok ${name}`); } else { failed++; console.error(`FAIL ${name}`); } }
const session = (partial: Partial<SessionMeta> = {}): SessionMeta => ({ id: 's1', title: 'Codex', kind: 'interactive', status: 'running', createdAt: 10,
  runtime: 'codex', repositoryId: 'r1', workspaceKind: 'checkout', projectWorkspaceId: 'pw1', workspaceDir: '/repo', branch: 'main',
  executionBackend: 'native', launchChoice: { mode: 'codex' }, program: { status: 'running', startedAt: 11 }, ...partial });
const repositories = [{ id: 'r1', name: 'Design', rootPath: '/repo', commonGitDir: '/repo/.git', executionBackend: 'native' as const, createdAt: 1, verified: true }];
const profile: Agent = { id: 'a1', name: 'Edited profile', categoryId: 'c1', runtime: 'claude', permissionMode: 'default', workspaceDir: '/home', memoryDir: '/memory', claudeModel: 'changed-model' };
const sessions = [session(), session({ id: 's2', title: 'Claude Code', runtime: 'claude', createdAt: 20, branch: 'feature/design', workspaceKind: 'worktree',
  projectWorkspaceId: 'pw2', launchChoice: { mode: 'agent' }, launchProfileId: profile.id, launchProfileName: 'Original profile', launchModel: 'start-model',
  program: { status: 'exited', exitCode: 0, endedAt: 30 }, outputSequence: 12, lastOutputAt: 29 }),
session({ id: 's3', status: 'exited', endedAt: 50, createdAt: 40 }), session({ id: 's4', kind: 'task' }), session({ id: 's5', remoteAccessBlocked: true })];
const before = JSON.stringify(sessions);
const rows = cliWorkRows(sessions, repositories, { a1: profile }, { s2: { title: 'Improve design', seenSequence: 11, updatedAt: 1 } });
check('interactive inventory excludes managed tasks and credential logins', rows.length === 3 && rows.every(row => row.session.kind === 'interactive' && !row.session.remoteAccessBlocked));
check('open terminals precede newer ended sessions', rows.map(row => row.session.id).join() === 's2,s1,s3');
const first = rows[0]!;
check('working title and captured profile remain stable after profile edits', first.title === 'Improve design' && first.profile === 'Original profile');
check('worktree, branch, CLI and actual launch model retain exact identity', first.workspace === 'Worktree' && first.session.branch === 'feature/design' && first.cli === 'Claude Code' && first.session.launchModel === 'start-model');
check('unconfigured plain CLI does not infer a model', !rows[1]!.session.launchModel && !rows[1]!.profile);
check('root checkout is explicitly an original folder', rows[1]!.workspace === 'Originalordner' && rows[1]!.project === 'Design');
check('new output derives from observed sequence', first.unread && first.updatedAt === 30 && !rows[1]!.unread);
check('seen output does not become unread due to time alone', !cliWorkRows([sessions[1]!], repositories, {}, { s2: { seenSequence: 12, updatedAt: 0 } })[0]!.unread);
check('program exit does not become completed task or closed terminal', first.state === 'shell' && first.status.includes('beendet · Terminal offen'));
check('terminal exit wins over stale running program marker', rows[2]!.state === 'ended' && rows[2]!.status.includes('Terminal beendet'));
check('starting and running remain program observations', cliWorkStatus(session({ program: { status: 'starting' } })) === 'running' && cliWorkStatus(session()) === 'running');
check('unknown liveness never infers a running CLI', cliWorkStatus(session({ program: undefined })) === 'unknown' && cliWorkStatus(session({ program: { status: 'unknown' } })) === 'unknown');
check('plain empty terminal is a shell', cliWorkStatus(session({ launchChoice: { mode: 'shell' }, program: undefined })) === 'shell');
check('selected project excludes other repositories', matchesCliWork(first, { project: 'r1' }) && !matchesCliWork(first, { project: 'r2' }));
check('optional profile filter uses captured project launch profile', matchesCliWork(first, { profile: 'a1' }) && !matchesCliWork(rows[1]!, { profile: 'a1' }));
check('CLI filter and empty filter are independent', matchesCliWork(first, { cli: 'Claude Code' }) && !matchesCliWork(first, { cli: 'Codex' }) && matchesCliWork(first, {}));
check('status filters separate shell from live CLI and ended PTY', matchesCliWork(first, { status: 'shell' }) && matchesCliWork(first, { status: 'open' })
  && !matchesCliWork(first, { status: 'running' }) && !matchesCliWork(rows[2]!, { status: 'open' }) && matchesCliWork(rows[2]!, { status: 'all' }));
check('search finds user title, branch, CLI and project without case sensitivity', ['IMPROVE', 'feature/design', 'Claude', 'DESIGN'].every(search => matchesCliWork(first, { search })) && !matchesCliWork(first, { search: 'missing' }));
check('output bursts do not reorder work while navigating', cliWorkRows([session({ lastOutputAt: 999, outputSequence: 100 }), sessions[1]!], repositories, {}).map(row => row.session.id).join() === 's2,s1');
check('deleted project is explicit and retains original session identity', cliWorkRows([session({ repositoryId: 'gone' })], [], {})[0]!.project === 'Entferntes Projekt');
check('home terminal needs neither a project nor profile', cliWorkRows([session({ repositoryId: undefined, projectWorkspaceId: undefined, scopeSource: 'terminal-home', workspaceKind: 'home' })], [], {})[0]!.project === 'Ohne Projekt');
check('projection leaves authoritative session data unchanged', JSON.stringify(sessions) === before);
const config = { ...structuredClone(DEFAULT_CONFIG), repositories };
const without = projectOverview(config, [], 100).projects[0]!;
check('project with no agent bindings can have an independent workspace', !without.hasOriginalWorkspace && without.projectWorkspaceCount === 0);
config.projectWorkspaces.push({ id: 'pw1', repositoryId: 'r1', kind: 'checkout', workspaceDir: '/repo', directoryIdentity: 'd1', gitDirectory: '/repo/.git', gitDirectoryIdentity: 'g1', gitPointerIdentity: 'p1', commonGitIdentity: 'c1', createdAt: 1 });
const original = projectOverview(config, [], 100).projects[0]!;
check('overview recognizes original workspace without assigning an agent', original.hasOriginalWorkspace === true && original.projectWorkspaceCount === 1 && original.boundAgentCount === 0);
check('overview project cards do not expose host paths', !JSON.stringify(original).includes('/repo'));
console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
