/** Opt-in native proof of the production conversation service and domain tools. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_CONFIG } from '../src/shared/types';
import { createCoordinatorConversation } from '../src/main/conversation/CoordinatorConversation';
import { SupervisionStore } from '../src/main/supervision/SupervisionStore';
import { SupervisionService } from '../src/main/supervision/SupervisionService';
import type { ConversationService } from '../src/main/conversation/ConversationService';
if (!process.argv.includes('--run-native')) throw new Error('Native Modellprobe nur ausdrücklich mit --run-native ausführen.');
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-coordinator-native-')));
let service: ConversationService | undefined; let passed = 0; let failed = 0;
const checks: Array<{ name: string; passed: boolean }> = [];
const check = (name: string, ok: boolean) => { checks.push({ name, passed: ok }); if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; throw new Error(name); } };
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function main() {
  const config = structuredClone(DEFAULT_CONFIG); const memoryDir = join(root, 'identity'); mkdirSync(memoryDir);
  config.agents = [{ id: 'coordinator', categoryId: 'fixture', name: 'Native ADE proof', runtime: 'codex', permissionMode: 'bypass', codexModel: 'gpt-5.6-sol', codexReasoningEffort: 'high', workspaceDir: join(root, 'unused'), memoryDir }];
  config.repositories = [{ id: 'project', name: 'Native morning proof', rootPath: join(root, 'project'), commonGitDir: join(root, 'project', '.git'), verified: true, executionBackend: 'native', createdAt: Date.now() }];
  const supervision = new SupervisionService(new SupervisionStore(join(root, 'supervision.json')), { get: () => config }, () => undefined);
  supervision.command({ operation: 'project', commandId: 'project', revision: 0, repositoryId: 'project', objective: 'Read the saved handoff for the morning briefing.', mode: 'observe' });
  const handoffMarker = `HANDOFF_${randomUUID().replaceAll('-', '')}`; const userMarker = `MEMORY_${randomUUID().replaceAll('-', '')}`;
  supervision.command({ operation: 'remember', commandId: 'note', revision: 1, projectId: supervision.query().projects[0]!.id, text: handoffMarker, nextStep: 'Discuss the proposal before implementation.', linkId: null });
  const start = () => createCoordinatorConversation({ directory: root, config: { get: () => config }, supervision,
    env: () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) });
  service = start(); const id = service.command({ operation: 'create', commandId: 'create', profileId: 'coordinator' }).conversationId;
  const settle = async (conversationId = id) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) { const last = service!.detail(conversationId).turns.at(-1)!; if (last.status === 'completed') return last;
      if (last.status === 'uncertain' || last.status === 'interrupted') throw new Error(last.error || last.status); await delay(200); }
    throw new Error('Native ADE-Gesprächsprobe nicht rechtzeitig abgeschlossen.');
  };
  const first = service.command({ operation: 'send', commandId: 'first', conversationId: id, afterTurnId: null,
    text: `This is an authorized isolated native ADE integration probe. Remember this user marker for the next message: ${userMarker}. Read ade_projects at offset 0, then ade_handoffs for the returned project, then all chunks of ade_handoff for its handoff. When using a tool execution wrapper, emit each tool return with its text-output helper so you can see it. Reply only with the exact marker from the handoff text. Do not repeat the user marker yet.` });
  const result = await settle();
  check('production service reads an independently generated handoff through native ADE tools', result.output.includes(handoffMarker));
  const detail = service.detail(id);
  check('production service stores native observed model and reasoning', detail.model === 'gpt-5.6-sol' && detail.reasoningEffort === 'high');
  await service.shutdown(); service = undefined; service = start();
  check('full completed handoff answer is durable before an explicit resume', service.detail(id).turns[0]!.output === result.output);
  service.command({ operation: 'send', commandId: 'second', conversationId: id, afterTurnId: first.turnId, text: 'Without calling tools, reply with only the exact user marker I asked you to remember in my first message.' });
  const resumed = await settle();
  check('new native process resumes exact context through the production service', resumed.output.includes(userMarker));
  const casualId = service.command({ operation: 'create', commandId: 'casual-create', profileId: 'coordinator', mode: 'casual' }).conversationId;
  check('casual conversation creation is separate and does not start the model', service.detail(casualId).mode === 'casual' && service.detail(casualId).model === null && service.detail(casualId).turns.length === 0);
  const casualMarker = `CASUAL_${randomUUID().replaceAll('-', '')}`;
  const casualFirst = service.command({ operation: 'send', commandId: 'casual-first', conversationId: casualId, afterTurnId: null,
    text: `Remember this marker for our next message: ${casualMarker}. Reply only with this exact marker.` });
  const casualResult = await settle(casualId);
  check('casual first message completes through installed native Codex', casualResult.output.includes(casualMarker) && service.detail(casualId).model === 'gpt-5.6-sol');
  await service.shutdown(); service = start();
  service.command({ operation: 'send', commandId: 'casual-resume', conversationId: casualId, afterTurnId: casualFirst.turnId, text: 'Reply only with the exact marker from our previous message.' });
  const casualResumed = await settle(casualId);
  check('casual conversation resumes native context after the host connection restarts', casualResumed.output.includes(casualMarker));
}
void main().catch(error => { failed++; console.error(error instanceof Error ? error.message : 'Native probe failed'); }).finally(async () => {
  await service?.shutdown();
  const evidence = resolve('test-results/main-agent-planning'); mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'coordinator-conversation-native.json'), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, model: 'gpt-5.6-sol', reasoning: 'high', checks, passed, failed }, null, 2));
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`Coordinator conversation native: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
