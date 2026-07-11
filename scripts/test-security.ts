/** Pure Goal 3 checks for IPC validation, URL trust, CSP and notification policy. */

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
  'agent:create': {
    categoryId: 'category',
    name: 'Agent',
    runtime: 'codex',
    permissionMode: 'default',
  },
  'agent:update': {
    id: 'agent',
    name: 'Agent',
    runtime: 'claude',
    permissionMode: 'accept-edits',
  },
  'agent:delete': { id: 'agent' },
  'pty:create': { agentId: 'agent', task: 'Work', dispatchId: 'dispatch', runTaskId: 'task' },
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
    participants: [{ agentId: 'agent', role: 'orchestrator' }],
  },
  'run:delete': { runId: 'run' },
  'runTask:create': { runId: 'run', participantId: 'participant', prompt: 'Do it' },
  'runTask:fail': { taskId: 'task', error: 'failed' },
  'runArtifact:create': { runId: 'run', kind: 'result', content: 'done' },
  'git:status': { agentId: 'agent' },
  'git:diff': { agentId: 'agent', path: 'src/index.ts' },
  'fs:tree': { agentId: 'agent', path: '' },
  'fs:read': { agentId: 'agent', path: 'README.md' },
  'fs:agentFiles': { agentId: 'agent' },
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
check('malformed base64 is rejected', rejects('pty:write', { sessionId: 's', dataBase64: '%' }));
check('oversized terminal dimensions are rejected', rejects('pty:resize', { sessionId: 's', cols: 5000, rows: 20 }));
check('empty run rosters are rejected', rejects('run:create', { name: 'Run', participants: [] }));
check('unknown runtimes are rejected', rejects('agent:create', {
  categoryId: 'c', name: 'a', runtime: 'unknown', permissionMode: 'default',
}));
check('workspace traversal is rejected before filesystem handlers',
  rejects('fs:read', { agentId: 'agent', path: '../outside.txt' }));

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
