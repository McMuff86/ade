/** Pure Goal 3/5 checks for IPC validation, URL trust, CSP and notification policy. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { runDiagnosticCommand } from '../src/main/diagnostics/RuntimeDiagnostics';
import { sessionExitNotice } from '../src/main/notificationPolicy';
import { isSafeExternalUrl, isTrustedRendererUrl } from '../src/main/security';
import { INVOKE_CHANNELS, type InvokeChannel } from '../src/shared/ipc';
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
  'config:save': { settings: { theme: 'dark' } },
  'photo:import': { bytesBase64: 'YQ==', mime: 'image/png' },
  'category:create': { name: 'Project', kind: 'plain' },
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
  'agentTemplate:create': { sourceAgentId: 'agent', name: 'Reusable writer' },
  'agentTemplate:delete': { id: 'template' },
  'agentTemplate:spawn': {
    templateId: 'template',
    categoryId: 'category',
    name: 'Writer',
    defaultRepositoryId: 'repository',
  },
  'repository:import': { path: 'C:\\repos\\project', name: 'Project' },
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
  'pty:cancelTasks': {},
  'runtime:diagnose': {},
  'run:get': undefined,
  'run:create': {
    name: 'Run',
    goal: 'Goal',
    repositoryId: 'repository',
    participants: [{ agentId: 'agent', role: 'orchestrator' }],
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
check('unknown fields are rejected', rejects('pty:kill', { sessionId: 's', extra: true }));
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

const rendererHtml = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8');
check('renderer declares a default-deny CSP', rendererHtml.includes("default-src 'none'"));
check('CSP forbids unsafe script evaluation', !rendererHtml.includes("script-src 'self' 'unsafe-eval'"));
check('CSP explicitly limits frames and objects',
  rendererHtml.includes("frame-src 'none'") && rendererHtml.includes("object-src 'none'"));
const mainEntry = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
check('renderer sandbox is enabled', mainEntry.includes('sandbox: true') && !mainEntry.includes('sandbox: false'));
check('photo scheme no longer bypasses CSP',
  !readFileSync(join(process.cwd(), 'src/main/photos.ts'), 'utf8').includes('bypassCSP'));

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
