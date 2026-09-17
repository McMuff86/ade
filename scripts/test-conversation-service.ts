import { linkSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConversationService, type ConversationLaunch, type ConversationProcess } from '../src/main/conversation/ConversationService';
import { ConversationStore, conversationDigest, validConversationState } from '../src/main/conversation/ConversationStore';
import { validConversationCommand, type ConversationCommand } from '../src/shared/conversation';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-conversation-service-')));
let passed = 0; let failed = 0; let seq = 0; let nativeTurnSequence = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
class Fixture implements ConversationProcess {
  killed = false; sends: string[] = []; interrupts = 0; deferExit = false;
  data: Array<(text: string) => void> = []; exits: Array<(event: { exitCode: number }) => void> = [];
  constructor(readonly callbacks: ConversationLaunch) { this.sends.push(callbacks.prompt); }
  get threadId() { return this.callbacks.resumeThreadId ?? `native-${this.callbacks.id}`; }
  ready(id = this.threadId) { this.callbacks.ready({ threadId: id, model: 'observed-model', reasoningEffort: 'high' }); }
  complete(output = 'Private model answer', status: 'completed' | 'interrupted' = 'completed') {
    this.callbacks.completed({ threadId: this.threadId, turnId: `native-turn-${++nativeTurnSequence}`, text: output, status });
  }
  async sendTurn(text: string) { this.sends.push(text); return { threadId: this.threadId, turnId: `native-turn-${this.sends.length}` }; }
  async interruptTurn() { this.interrupts++; }
  write() { throw new Error('No terminal writes'); } resize() { /* no terminal */ }
  kill() { this.killed = true; if (!this.deferExit) this.finishExit(); }
  finishExit() { for (const cb of this.exits) cb({ exitCode: 130 }); }
  onData(cb: (text: string) => void) { this.data.push(cb); return { dispose() {} }; }
  onExit(cb: (event: { exitCode: number }) => void) { this.exits.push(cb); return { dispose() {} }; }
}
const path = join(root, 'history.json'); let scope = 'initial-authority'; let failLaunch = false; const launched: Fixture[] = [];
const services: ConversationService[] = []; let persistBeforeLaunch = false;
const create = (file = path) => {
  const service = new ConversationService(new ConversationStore(file), {
    binding: profileId => { if (profileId !== 'profile') throw new Error('Profile missing'); return { profileId, authoritySha256: conversationDigest(scope), toolContract: 'ade-v1' }; },
    launch: input => {
      const disk = new ConversationStore(file).snapshot();
      persistBeforeLaunch = disk.commands.some(r => r.conversationId === input.id && r.turnId === disk.conversations.find(c => c.id === input.id)?.turns.at(-1)?.id);
      if (failLaunch) throw new Error('API_KEY=secret-value launch failed');
      const p = new Fixture(input); launched.push(p); return p;
    },
  }); services.push(service); return service;
};
async function main() {
  let service = create();
  const command = (input: Omit<Extract<ConversationCommand, { operation: 'create' }>, 'commandId'>) => service.command({ ...input, commandId: `command-${++seq}` });
  check('fresh conversation inventory is empty without model launches', !service.query().length && !launched.length);
  const declined = service.admit({ operation: 'create', profileId: 'missing', commandId: 'declined-profile' });
  check('confirmed admission refusal has no effect and permits correcting the profile', !declined.accepted && !declined.uncertain && !service.query().length && !launched.length);
  const created = command({ operation: 'create', profileId: 'profile' }); const id = created.conversationId;
  check('creating a conversation does not start a native process', !launched.length && service.query()[0]!.status === 'ready');
  const recordingTarget = service.recordingTarget(id);
  check('dictation target works without model launch and attributes only its actual profile', !launched.length && JSON.stringify(recordingTarget.usage) === '{"agentId":"profile"}' && !throws(recordingTarget));
  check('missing conversation cannot acquire a dictation target', throws(() => service.recordingTarget(randomUUID())));
  const input: ConversationCommand = { operation: 'send', commandId: 'first-send', conversationId: id, afterTurnId: null, text: 'Private user request' };
  const first = service.command(input); const p = launched.at(-1)!;
  check('request and exact command receipt are durable before native launch', persistBeforeLaunch && service.detail(id).turns[0]!.input === input.text);
  check('replayed send does not relaunch or write a second native turn', service.command(input).replayed && launched.length === 1 && p.sends.length === 1);
  check('same key with changed prompt is refused', throws(() => service.command({ ...input, text: 'Different' })));
  check('concurrent message is refused while native turn is unconfirmed', throws(() => service.command({ ...input, commandId: 'concurrent', afterTurnId: first.turnId })));
  p.ready(); p.complete();
  const summary = JSON.stringify(service.query());
  check('summaries omit both message bodies and private native identities', !summary.includes('Private') && !summary.includes('native-thread') && !summary.includes('native-turn') && service.query()[0]!.lastAnswer.chars > 0);
  const detail = JSON.stringify(service.detail(id));
  check('explicit detail contains full input and answer but no native identity', detail.includes('Private user request') && detail.includes('Private model answer') && !detail.includes('native-'));
  check('native model metadata is observed rather than inferred from the profile', service.detail(id).model === 'observed-model');
  check('stale tablet send cannot advance a newer conversation', throws(() => service.command({ ...input, commandId: 'stale' })));
  const second = service.command({ ...input, commandId: 'second-send', afterTurnId: first.turnId, text: 'Second message' });
  check('next explicit message uses the same native process', launched.length === 1 && p.sends.length === 2);
  const items = [{ id: 'choice', header: 'Choice', question: 'Private question?', isOther: true, isSecret: false, options: null }];
  let acknowledge: (() => void) | undefined; let answers = 0;
  const question = p.callbacks.question(items, true, async () => { answers++; await new Promise<void>(resolve => { acknowledge = resolve; }); });
  check('native question is explicit detail with count-only inventory', service.detail(id).turns[1]!.questions[0]!.questions[0]!.question === 'Private question?' && service.query()[0]!.pendingQuestions === 1 && !JSON.stringify(service.query()).includes('Private question'));
  const answer: ConversationCommand = { operation: 'answer', commandId: 'answer', conversationId: id, turnId: second.turnId!, questionId: question.id, answers: { choice: { answers: ['User secret answer'] } } };
  check('answer for another native question is refused before delivery', throws(() => service.command({ ...answer, answers: { foreign: { answers: ['No'] } } })) && answers === 0);
  service.command(answer);
  check('answer remains answering until native acknowledgement', service.detail(id).turns[1]!.questions[0]!.status === 'answering' && answers === 1);
  check('answer replay never delivers twice and stores only a digest', service.command(answer).replayed && answers === 1 && !readFileSync(path, 'utf8').includes('User secret answer'));
  acknowledge!(); await tick();
  check('native acknowledgement changes the exact question to answered', service.detail(id).turns[1]!.questions[0]!.status === 'answered');
  p.complete('Second answer'); service.dispose(); service = create();
  check('completed transcript survives restart without an automatic launch', service.detail(id).turns.length === 2 && launched.length === 1);
  check('durable receipt survives restart without replaying model work', service.command(answer).replayed && launched.length === 1);
  service.command({ ...input, commandId: 'resume', afterTurnId: second.turnId, text: 'Continue' }); const resumed = launched.at(-1)!;
  check('explicit continuation resumes the exact stored native identity', resumed.callbacks.resumeThreadId === p.threadId && launched.length === 2);
  resumed.ready();
  const third = service.query()[0]!.lastTurnId!;
  const interrupt: ConversationCommand = { operation: 'interrupt', commandId: 'interrupt', conversationId: id, turnId: third };
  service.command(interrupt);
  check('interruption is requested once and awaits native confirmation', resumed.interrupts === 1 && service.query()[0]!.status === 'interrupting' && service.command(interrupt).replayed);
  resumed.complete('', 'interrupted');
  check('native interrupted event is distinguished from a completed answer', service.query()[0]!.status === 'interrupted');
  scope = 'changed-authority';
  check('previously acquired recording target rejects changed project authority', throws(recordingTarget));
  check('changed project authority preserves readable history but refuses continuation', !service.query()[0]!.available && service.detail(id).turns.length === 3 && throws(() => service.command({ ...input, commandId: 'rights-change', afterTurnId: third })));
  const fresh = command({ operation: 'create', profileId: 'profile' });
  service.command({ ...input, commandId: 'fresh-send', conversationId: fresh.conversationId }); const freshProcess = launched.at(-1)!; freshProcess.ready();
  check('new explicitly created context can use the new project authority', service.query().find(c => c.id === fresh.conversationId)!.available && !freshProcess.callbacks.resumeThreadId);
  freshProcess.callbacks.question(items, true, async () => {});
  const crashedPath = join(root, 'crashed.json'); writeFileSync(crashedPath, readFileSync(path)); const beforeRecovery = launched.length;
  const crashed = create(crashedPath);
  check('abrupt restart recovers working disk state without launching or replaying', crashed.detail(fresh.conversationId).turns[0]!.status === 'uncertain' && launched.length === beforeRecovery);
  check('unconfirmed conversation cannot acquire a new recording target', throws(() => crashed.recordingTarget(fresh.conversationId)));
  check('abrupt restart durably expires the old process question', new ConversationStore(crashedPath).snapshot().conversations.find(c => c.id === fresh.conversationId)!.turns[0]!.questions[0]!.status === 'expired');
  crashed.dispose(); service.dispose(); service = create();
  const recovered = service.detail(fresh.conversationId);
  check('restart preserves uncertain delivery and expires unanswered native questions', recovered.turns[0]!.status === 'uncertain' && recovered.turns[0]!.questions[0]!.status === 'expired');
  check('uncertain message cannot be automatically or explicitly resent into the same thread', throws(() => service.command({ ...input, commandId: 'unsafe-resume', conversationId: fresh.conversationId, afterTurnId: recovered.turns[0]!.id })));
  const failedConversation = command({ operation: 'create', profileId: 'profile' }); failLaunch = true;
  const failedReceipt = service.command({ ...input, commandId: 'launch-fails', conversationId: failedConversation.conversationId });
  check('launch failure retains an accepted receipt and redacted uncertain state', failedReceipt.turnId !== null && service.detail(failedConversation.conversationId).turns[0]!.status === 'uncertain' && !JSON.stringify(service.detail(failedConversation.conversationId)).includes('secret-value'));
  const deliveredFailure = service.admit({ ...input, commandId: 'launch-fails', conversationId: failedConversation.conversationId });
  check('failure after admission stays accepted so clients cannot resend it as a new message', deliveredFailure.accepted && deliveredFailure.receipt.turnId === failedReceipt.turnId);
  failLaunch = false;
  const closing = command({ operation: 'create', profileId: 'profile' }); service.command({ ...input, commandId: 'close-send', conversationId: closing.conversationId }); const closingProcess = launched.at(-1)!;
  service.command({ operation: 'close', commandId: 'close', conversationId: closing.conversationId });
  check('ended conversation cannot acquire a recording target', throws(() => service.recordingTarget(closing.conversationId)));
  closingProcess.ready(); closingProcess.complete('Late answer');
  check('closing kills only its process and late output cannot become a result', closingProcess.killed && service.detail(closing.conversationId).closed && service.detail(closing.conversationId).turns[0]!.output === '');
  const final = command({ operation: 'create', profileId: 'profile' }); service.command({ ...input, commandId: 'positive', conversationId: final.conversationId }); const finalProcess = launched.at(-1)!; finalProcess.ready(); finalProcess.complete('Final positive');
  check('final independent conversation completes after lifecycle negative controls', service.detail(final.conversationId).turns[0]!.output === 'Final positive');
  check('request contract rejects extra host paths, invalid IDs and unbounded messages', !validConversationCommand({ ...input, cwd: root }) && !validConversationCommand({ ...input, text: '' })
    && !validConversationCommand({ ...input, conversationId: '..' }) && !validConversationCommand({ ...input, text: 'x'.repeat(64 * 1024 + 1) }));
  const state = new ConversationStore(path).snapshot(); state.conversations[0]!.nativeThreadId = null;
  check('completed turns without a native identity are invalid persisted history', !validConversationState(state));
  const escaped = new ConversationStore(path).snapshot(); const previousId = escaped.conversations[0]!.id;
  escaped.conversations[0]!.id = '..'; for (const r of escaped.commands) if (r.conversationId === previousId) r.conversationId = '..';
  check('persisted conversation IDs cannot escape their owned workspace directory', !validConversationState(escaped));
  const sharedThread = new ConversationStore(path).snapshot(); sharedThread.conversations[1]!.nativeThreadId = sharedThread.conversations[0]!.nativeThreadId;
  check('two ADE conversations cannot claim the same native context', !validConversationState(sharedThread));
  finalProcess.deferExit = true; let shutdownFinished = false; const stopping = service.shutdown().then(() => { shutdownFinished = true; }); await tick();
  check('shutdown waits for actual child close after requesting termination', finalProcess.killed && !shutdownFinished);
  finalProcess.finishExit(); await stopping;
  check('shutdown completes once the child acknowledges closure', shutdownFinished);
  const unavailable = service.admit({ operation: 'create', profileId: 'profile', commandId: 'after-shutdown' });
  check('unavailable admission cannot be mistaken for a confirmed refusal', !unavailable.accepted && unavailable.uncertain);
  const capacityPath = join(root, 'capacity.json'); const capacityStore = new ConversationStore(capacityPath);
  const capacity = capacityStore.snapshot(); const exemplar = new ConversationStore(path).snapshot().conversations.find(c => c.id === final.conversationId)!;
  capacity.conversations = [{ ...exemplar, turns: Array.from({ length: 120 }, (_, i) => ({ ...exemplar.turns[0]!, id: randomUUID(), nativeTurnId: `capacity-${i}`, output: 'x'.repeat(64 * 1024) })) }];
  capacity.revision++; capacityStore.save(capacity); const capacityService = create(capacityPath); const launchesBeforeCapacity = launched.length;
  let capacityRefused = false; try { capacityService.command({ ...input, commandId: 'full', conversationId: exemplar.id, afterTurnId: capacity.conversations[0]!.turns.at(-1)!.id }); }
  catch (error) { capacityRefused = error instanceof Error && error.message.includes('Platz'); }
  check('result capacity is reserved before launch and existing history remains readable', capacityRefused && launched.length === launchesBeforeCapacity && capacityService.detail(exemplar.id).turns.length === 120);
  const original = readFileSync(path, 'utf8'); const drift = new ConversationStore(path); writeFileSync(path, original + ' '); const next = drift.snapshot(); next.revision++;
  check('external drift is refused while original replacement bytes remain intact', throws(() => drift.save(next)) && readFileSync(path, 'utf8') === original + ' ');
  writeFileSync(path, original); const restored = new ConversationStore(path); const positive = restored.snapshot(); positive.revision++; restored.save(positive);
  check('final store write succeeds after explicit reload of valid history', new ConversationStore(path).snapshot().revision === positive.revision);
  const invalid = join(root, 'invalid.json'); writeFileSync(invalid, '{broken');
  check('malformed history is preserved instead of silently reset', throws(() => new ConversationStore(invalid)) && readFileSync(invalid, 'utf8') === '{broken');
  const corrupt = Buffer.from(original); corrupt[corrupt.indexOf('Private user request')] = 0xff; writeFileSync(invalid, corrupt);
  check('invalid UTF-8 remains rejected byte-for-byte', throws(() => new ConversationStore(invalid)) && readFileSync(invalid).equals(corrupt));
  writeFileSync(invalid, Buffer.alloc(8 * 1024 * 1024 + 1, 32)); let oversized = false;
  try { new ConversationStore(invalid); } catch (error) { oversized = error instanceof Error && error.message.includes('zu grosser'); }
  check('oversized transcript is refused at the byte boundary before parsing', oversized);
  const hard = join(root, 'hard.json'); linkSync(path, hard);
  check('hardlinked transcript is refused', throws(() => new ConversationStore(hard)));
  const independent = create(join(root, 'positive-final.json'));
  const admitted = independent.admit({ operation: 'create', profileId: 'profile', commandId: 'positive-final' });
  check('final independent admission succeeds after storage negative controls', admitted.accepted && independent.query().length === 1);
}
void main().catch(error => { failed++; console.error(error); }).finally(() => {
  for (const service of services) service.dispose();
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Conversation service: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
