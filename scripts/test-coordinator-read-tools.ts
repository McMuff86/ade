import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/shared/types';
import { coordinatorReadTools } from '../src/main/conversation/CoordinatorConversation';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import { CHANNEL_POLICY, REMOTE_COMMAND_CHANNELS } from '../src/main/ipcPolicy';
import { assertIpcPayload } from '../src/main/ipcValidation';
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-coordinator-tools-')));
let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const rejects = async (fn: () => unknown) => { try { await fn(); return false; } catch { return true; } };
async function main() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.repositories = ['a', 'b'].map(id => ({ id, name: `Project ${id}`, rootPath: join(root, id), commonGitDir: join(root, id, '.git'), verified: true, executionBackend: 'native', createdAt: 1 }));
  const supervision = new SupervisionService(new SupervisionStore(join(root, 'supervision.json')), { get: () => config }, () => undefined);
  supervision.command({ operation: 'project', commandId: 'project', revision: 0, repositoryId: 'a', objective: '漢'.repeat(8000), mode: 'observe' });
  const projectId = supervision.query().projects[0]!.id;
  supervision.command({ operation: 'remember', commandId: 'remember', revision: 1, projectId, text: '漢'.repeat(4000), nextStep: 'Nächster Schritt', linkId: null });
  const handoffId = supervision.briefing().projects[0]!.handoffs[0]!.id;
  let allowed = true; const tools = coordinatorReadTools(supervision, () => { if (!allowed) throw new Error('Revoked'); });
  const signal = new AbortController(); const context = { signal: signal.signal, threadId: 'thread', turnId: 'turn', callId: 'call' };
  const read = (name: string, args: unknown) => tools.find(t => t.name === name)!.invoke(args, context);
  check('coordinator exposes only five read domain tools', tools.length === 5 && tools.every(t => !/launch|submit|shell|write|remember/.test(t.name)));
  const list = JSON.parse(await read('ade_projects', { offset: 0 }));
  check('project inventory includes only explicitly supervised identities without host paths', list.total === 1 && list.projects[0].id === projectId && !JSON.stringify(list).includes(root));
  check('unassigned repository cannot be read by supplying its catalog ID', await rejects(() => read('ade_project_status', { projectId: 'b', offset: 0 })));
  const status = JSON.parse(await read('ade_project_status', { projectId, offset: 0 }));
  check('morning suggestion comes from saved open handoff with no invented progress', status.suggestion === 'resume-handoff' && status.openHandoffs === 1 && status.work.length === 0);
  let text = ''; let offset: number | null = 0; let chunks = 0;
  while (offset !== null) { const chunk = JSON.parse(await read('ade_project_instruction', { projectId, offset })); text += chunk.text; offset = chunk.nextOffset; chunks++; }
  check('maximum Unicode instruction can be read completely through bounded chunks', text === '漢'.repeat(8000) && chunks === 4);
  text = ''; offset = 0;
  while (offset !== null) { const chunk = JSON.parse(await read('ade_handoff', { projectId, handoffId, offset })); text += chunk.text; offset = chunk.nextOffset; }
  check('full handoff and next step survive tool result limits', text.includes('漢'.repeat(4000)) && text.endsWith('Nächster Schritt'));
  check('foreign handoff ID is refused', await rejects(() => read('ade_handoff', { projectId, handoffId: 'foreign', offset: 0 })));
  check('extra host paths and negative/fractional pages are refused', await rejects(() => read('ade_projects', { offset: 0, cwd: root })) && await rejects(() => read('ade_projects', { offset: -1 })) && await rejects(() => read('ade_projects', { offset: 0.5 })));
  allowed = false;
  check('authority is checked again for every tool call', await rejects(() => read('ade_projects', { offset: 0 })));
  allowed = true; config.repositories[0]!.verified = false;
  check('removed project remains listed as unavailable but detail read is refused', !(JSON.parse(await read('ade_projects', { offset: 0 }))).projects[0].available && await rejects(() => read('ade_project_instruction', { projectId, offset: 0 })));
  config.repositories[0]!.verified = true;
  check('final authorized read succeeds after rights negative controls', (JSON.parse(await read('ade_project_status', { projectId, offset: 0 }))).id === projectId);
  signal.abort(); check('ended native turn cannot read project data', await rejects(() => read('ade_projects', { offset: 0 })));
  check('conversation commands remain desktop-only and outside generic remote commands', CHANNEL_POLICY['conversation:command'].surface === 'desktop' && CHANNEL_POLICY['conversation:command'].effect === 'launch' && !REMOTE_COMMAND_CHANNELS.includes('conversation:command'));
  check('conversation IPC rejects extra fields and message-body queries', await rejects(() => assertIpcPayload('conversation:detail', { conversationId: 'id', prompt: 'leak' })) && await rejects(() => assertIpcPayload('conversation:get', {})));
  assertIpcPayload('conversation:command', { operation: 'send', commandId: 'key', conversationId: '11111111-1111-4111-8111-111111111111', afterTurnId: null, text: 'Hello' });
  check('final positive command passes exact IPC validation', true);
}
void main().catch(error => { failed++; console.error(error); }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true });
  console.log(`Coordinator read tools: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
