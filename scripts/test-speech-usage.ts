import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SpeechUsageService } from '../src/main/usage/SpeechUsageService';
import { UsageJournal } from '../src/main/usage/UsageJournal';
import { NativeUsageService } from '../src/main/usage/NativeUsageService';
import { DictationService } from '../src/main/settings/DictationService';
import { SpeechService } from '../src/main/settings/SpeechService';
import { encodeDictationPcm } from '../src/shared/dictationAudio';
import { DEFAULT_CONFIG } from '../src/shared/types';
import { SPEECH_TEST_TEXT } from '../src/shared/speech';

let passed = 0;
const check = (name: string, value: boolean) => { if (!value) throw new Error(name); passed++; console.log(`  ok ${name}`); };
const refuses = async (action: () => Promise<unknown>) => { try { await action(); return false; } catch { return true; } };
const root = mkdtempSync(join(tmpdir(), 'ade-speech-usage-')); const file = join(root, 'usage.jsonl');
let journal = new UsageJournal(file); let service = new SpeechUsageService(journal);
void (async () => {
  const speech = await service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 5.98, terminalSessionId: 'terminal-a', repositoryId: 'project-a' });
  const first = journal.view(); const fact = first.facts[0]!;
  check('a dictation attempt is durable before network dispatch', readFileSync(file, 'utf8').includes('"requestState":"pending"'));
  check('duration remains audio seconds with no invented credits or price', fact.audioSeconds === 5.98 && fact.characters === null && fact.credits === null && fact.costUsd === null);
  check('speech duration is not converted into LLM tokens', Object.values(fact.tokens).every(value => value === null));
  check('the attempt keeps its captured terminal and project attribution', first.sessions[0]?.terminalSessionId === 'terminal-a' && first.sessions[0]?.repositoryId === 'project-a');
  await Promise.all([speech.finish('complete'), speech.finish('complete')]);
  check('successful completion changes outcome without adding the duration twice', journal.view().facts.length === 1 && journal.view().facts[0]?.requestState === 'complete' && journal.view().facts[0]?.audioSeconds === 5.98);
  check('a successful transcript still does not prove an individual billed price', journal.view().facts[0]?.costUsd === null && journal.view().facts[0]?.costKind === 'unknown');
  check('conflicting attempt finalization is refused', await refuses(() => speech.finish('not-sent')));
  const unknown = await service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 2, repositoryId: 'project-b' });
  await unknown.finish('unconfirmed');
  check('lost provider response preserves possible usage with incomplete coverage', journal.view().facts[1]?.requestState === 'unconfirmed' && journal.view().sessions[1]?.coverage === 'incomplete');
  const cancelled = await service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 1 }); await cancelled.finish('not-sent');
  check('authorization lost before dispatch has a distinct not-sent outcome', journal.view().facts[2]?.requestState === 'not-sent');
  const voice = await service.begin({ product: 'speech-test', model: 'eleven_multilingual_v2', characters: 84, agentId: 'profile-a' }); await voice.finish('complete');
  const voiceFact = journal.view().facts[3]!;
  check('TTS counts supplied characters separately from STT duration', voiceFact.characters === 84 && voiceFact.audioSeconds === null && journal.view().sessions[3]?.product === 'speech-test');
  check('voice preview retains profile attribution without inventing a repository', journal.view().sessions[3]?.agentId === 'profile-a' && journal.view().sessions[3]?.repositoryId === undefined);
  check('unknown finalization IDs cannot create numeric facts', await refuses(() => journal.speechOutcome('0'.repeat(64), 'complete')));
  check('invalid lifecycle states are refused', await refuses(() => journal.speechOutcome(fact.id, 'free' as 'complete')));
  check('invalid audio duration cannot enter the speech ledger', await refuses(() => service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: NaN })));
  check('excessive duration remains bounded by the dictation contract', await refuses(() => service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 61 })));
  check('fractional characters are not accepted as a text count', await refuses(() => service.begin({ product: 'speech-test', model: 'eleven_multilingual_v2', characters: 1.5 })));
  await service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 3 });
  await journal.close(); journal = new UsageJournal(file); service = new SpeechUsageService(journal);
  check('restart replays completed outcomes without replaying provider requests', journal.view().facts[0]?.requestState === 'complete' && journal.view().facts.length === 5);
  check('a process crash leaves an unresolved pending attempt instead of free usage', journal.view().facts[4]?.requestState === 'pending' && journal.view().facts[4]?.audioSeconds === 3 && journal.view().facts[4]?.costUsd === null);
  const final = await service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 0.1 }); await final.finish('complete');
  check('final positive attempt works after validation failures and restart', journal.view().facts.at(-1)?.requestState === 'complete' && journal.view().facts.at(-1)?.audioSeconds === 0.1);
  let dispatched = 0; let status = 200; let loseResponse = false;
  const dictation = new DictationService(() => 'private-fixture-key', async () => {
    dispatched++;
    check('the real dictation service journals before its provider side effect', journal.view().facts.at(-1)?.requestState === 'pending'
      && readFileSync(file, 'utf8').includes('"requestState":"pending"'));
    if (loseResponse) throw new Error('private-provider-network-detail');
    return status === 200 ? Response.json({ text: 'Reviewed prompt' }) : new Response('private-provider-error', { status });
  }); dictation.setUsage(service);
  const audio = encodeDictationPcm(new Float32Array(16_000));
  const response = await dictation.transcribe(audio, () => undefined, undefined, { terminalSessionId: 'hook-terminal', repositoryId: 'hook-project' });
  check('actual transcription completion records exactly one measured attempt', response.text === 'Reviewed prompt' && dispatched === 1
    && journal.view().facts.at(-1)?.requestState === 'complete' && journal.view().sessions.at(-1)?.repositoryId === 'hook-project');
  status = 429;
  check('a rejected upstream response preserves an unconfirmed attempt', await refuses(() => dictation.transcribe(audio, () => undefined))
    && journal.view().facts.at(-1)?.requestState === 'unconfirmed');
  status = 200; loseResponse = true;
  check('a lost upstream receipt is not retried or reported as free', await refuses(() => dictation.transcribe(audio, () => undefined))
    && dispatched === 3 && journal.view().facts.at(-1)?.requestState === 'unconfirmed'); loseResponse = false;
  let checks = 0; const beforeRevocation = dispatched;
  check('revocation after durable preparation blocks dispatch and records not-sent', await refuses(() => dictation.transcribe(audio, () => {
    if (++checks === 3) throw new Error('revoked');
  })) && dispatched === beforeRevocation && journal.view().facts.at(-1)?.requestState === 'not-sent');
  const beforeMissing = journal.view().facts.length;
  const missing = new DictationService(() => undefined); missing.setUsage(service);
  check('a missing STT key never creates a billable attempt', await refuses(() => missing.transcribe(audio, () => undefined)) && journal.view().facts.length === beforeMissing);
  let voiceRequests = 0; const voiceId = 'EXAVITQu4vr4xnSDxMaL';
  const speechEngine = new SpeechService({ get: () => DEFAULT_CONFIG, save: () => undefined }, () => 'private-fixture-key', async url => {
    if (String(url).endsWith('/voices')) return Response.json({ voices: [{ voice_id: voiceId, name: 'Fixture voice' }] });
    voiceRequests++;
    check('voice generation journals characters before its provider request', journal.view().facts.at(-1)?.requestState === 'pending'
      && journal.view().facts.at(-1)?.characters === SPEECH_TEST_TEXT.length);
    return new Response(new Uint8Array(128), { headers: { 'content-type': 'audio/mpeg' } });
  }); speechEngine.setUsage(service);
  const beforeCatalog = journal.view().facts.length; await speechEngine.catalog();
  check('the free voice catalog is not counted as generated speech', beforeCatalog === journal.view().facts.length && voiceRequests === 0);
  await speechEngine.test(voiceId, () => undefined, { agentId: 'voice-profile' });
  check('real TTS generation records its profile and completion', journal.view().sessions.at(-1)?.agentId === 'voice-profile'
    && journal.view().facts.at(-1)?.requestState === 'complete' && voiceRequests === 1);
  const unfinished = await service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 2, terminalSessionId: 'hook-terminal' });
  await unfinished.finish('unconfirmed');
  const localCancelled = await service.begin({ product: 'dictation', model: 'scribe_v2', audioSeconds: 4, terminalSessionId: 'hook-terminal' });
  await localCancelled.finish('not-sent');
  const collector = new NativeUsageService(journal); const overview = collector.consumption('hook-terminal');
  check('session speech view separates successful unknown and unsent units', overview.speech?.[0]?.amounts.complete === 1
    && overview.speech[0].amounts.unconfirmed === 2 && overview.speech[0].amounts['not-sent'] === 4 && overview.speech[0].requests.complete === 1);
  check('speech never increases CLI token totals or API price sums', overview.events === 0 && overview.tokens.input === null && overview.costs.length === 0);
  check('another terminal cannot see this speech attribution', !collector.consumption('other-terminal').speech);
  await journal.close(); const beforeClosed = dispatched;
  check('unavailable durable accounting blocks a new paid request', await refuses(() => dictation.transcribe(audio, () => undefined)) && dispatched === beforeClosed);
  journal = new UsageJournal(file); service = new SpeechUsageService(journal);
  const finalEngine = new DictationService(() => 'private-fixture-key', async () => { await journal.close(); return Response.json({ text: 'Keep this paid result' }); });
  finalEngine.setUsage(service);
  check('a finalization storage failure preserves an already received transcript', (await finalEngine.transcribe(audio, () => undefined)).text === 'Keep this paid result');
  journal = new UsageJournal(file);
  check('failed finalization reopens as pending rather than confirmed zero cost', journal.view().facts.at(-1)?.requestState === 'pending');
  console.log(`Speech usage: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await journal.close(); const target = resolve(root); const prefix = resolve(tmpdir());
  if (!target.startsWith(`${prefix}\\`) && !target.startsWith(`${prefix}/`)) throw new Error('Invalid cleanup target');
  rmSync(target, { recursive: true, force: true });
});
