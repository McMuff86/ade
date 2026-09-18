import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { replySpeechText } from '../src/main/settings/ReplySpeechText';
import { ReplySpeechService } from '../src/main/settings/ReplySpeechService';
import { FixtureSpeechService as SpeechService } from './helpers/speechSocket';
import { SpeechPreferences } from '../src/main/settings/SpeechPreferences';
import { SpeechUsageService } from '../src/main/usage/SpeechUsageService';
import { UsageJournal } from '../src/main/usage/UsageJournal';
import { NativeUsageService } from '../src/main/usage/NativeUsageService';
import { DEFAULT_CONFIG } from '../src/shared/types';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { validDesktopReply, type ReplyInput } from '../src/shared/terminalSpeech';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function refuses(name: string, action: () => unknown, message: RegExp) {
  try { await action(); } catch (error) { check(name, message.test(String(error))); return; } throw new Error(`${name}: unexpectedly accepted`);
}
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-reply-speech-')));
let journal: UsageJournal;
void (async () => {
  const input: ReplyInput = { text: 'Die Änderung ist eingebaut. Die Prüfung ist noch nicht abgeschlossen. Bitte prüfe den offenen Fehler.', source: 'selection', mode: 'excerpt' };
  check('shortening retains negation and original sentence order', replySpeechText(input).text === input.text);
  const longer = { ...input, text: 'Eins ist bereit. Zwei ist offen. Drei bleibt unverändert. Vier braucht Prüfung. Fünf folgt später.' };
  check('extractive preview is explicitly shortened at complete sentences', replySpeechText(longer).text.endsWith('Vier braucht Prüfung.') && replySpeechText(longer).shortened);
  const formatted = replySpeechText({ ...input, mode: 'full', text: '# Ergebnis\n**Fertig.**\n```ts\nconst secret = 123;\n```\n- [Prüfung](https://example.test): offen.\n\x1b[31mKein Erfolg.\x1b[0m' });
  check('speech removes markdown, fenced code and ANSI while retaining caveats', formatted.text === 'Ergebnis\nFertig.\nPrüfung: offen.\nKein Erfolg.' && formatted.shortened);
  const sanitized = replySpeechText({ ...input, text: 'Datei C:\\Users\\private\\file.ts, token=abc123. Zugang: arbitrary-secret-987.', mode: 'full' }, ['arbitrary-secret-987']);
  check('known secrets, credentials and host paths leave neither preview nor speech', !sanitized.text.includes('abc123') && !sanitized.text.includes('arbitrary-secret') && !sanitized.text.includes('Users'));
  await refuses('empty output produces a useful error', () => replySpeechText({ ...input, text: '   ' }), /kein vorlesbarer Text/);
  await refuses('code-only output is not presented as an assistant answer', () => replySpeechText({ ...input, text: '```sh\nrm file\n```' }), /kein vorlesbarer Text/);
  await refuses('overlong source is refused before any synthesis', () => replySpeechText({ ...input, text: 'a'.repeat(12001) }), /12’000/);
  await refuses('long single sentence is never cut before a qualifier', () => replySpeechText({ ...input, text: 'Noch '.repeat(250) + 'nicht fertig.' }), /nicht sinnvoll kürzen/);
  await refuses('full reading never silently truncates', () => replySpeechText({ ...input, text: 'Wort '.repeat(1300), mode: 'full' }), /zu lang/);
  const desktop = { operation: 'prepare', sessionId: 's1', ...input } as const;
  assertIpcPayload('speech:reply', desktop);
  check('IPC requires strict source, mode and session contract', validDesktopReply(desktop) && !validDesktopReply({ ...desktop, text: '' })
    && !validDesktopReply({ ...desktop, source: 'last-answer' }) && !validDesktopReply({ ...desktop, command: 'injected' })
    && !validDesktopReply({ operation: 'speak', replyId: 's1', text: 'override' }));
  let config = structuredClone(DEFAULT_CONFIG); const store = { get: () => config, save: (value: Partial<typeof config>) => { config = { ...config, ...value }; } };
  const voiceId = 'EXAVITQu4vr4xnSDxMaL'; let requests = 0; let sentText = ''; let failure = false; let wait = false; let observedSignal: AbortSignal | undefined;
  const engine = new SpeechService(store, () => 'provider-secret', async (url, init) => {
    if (String(url).endsWith('/voices')) return Response.json({ voices: [{ voice_id: voiceId, name: 'Sarah', labels: { gender: 'female' } }] });
    requests++; sentText = JSON.parse(String(init?.body)).text; observedSignal = init?.signal ?? undefined;
    if (wait) await new Promise<void>((_resolve, reject) => observedSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return failure ? new Response('private diagnostic', { status: 500 }) : new Response(new Uint8Array(512), { headers: { 'content-type': 'audio/mpeg' } });
  });
  journal = new UsageJournal(join(root, 'usage.jsonl')); engine.setUsage(new SpeechUsageService(journal));
  let now = Date.now(); let allowed = true;
  const authorize = Object.assign(() => { if (!allowed) throw new Error('access revoked'); }, { usage: { terminalSessionId: 's1' } });
  const replies = new ReplySpeechService(engine, new SpeechPreferences(store, engine), () => ['arbitrary-secret-987'], () => now);
  const prepared = replies.prepare('desktop:1', input, authorize);
  check('preparation has no provider side effect and returns only a receipt', requests === 0 && Object.keys(prepared).join() === 'replyId');
  await refuses('another owner cannot inspect a preview', () => replies.read('desktop:2', prepared.replyId), /nicht mehr verfügbar/);
  await refuses('another owner cannot request audio', () => replies.speak('desktop:2', prepared.replyId), /nicht mehr verfügbar/);
  replies.cancel('desktop:2', prepared.replyId);
  check('foreign cancellation cannot remove the owners reply', replies.read('desktop:1', prepared.replyId).preview.text === input.text);
  await Promise.all([replies.speak('desktop:1', prepared.replyId), replies.speak('desktop:1', prepared.replyId)]);
  await replies.speak('desktop:1', prepared.replyId);
  check('concurrent requests and replay synthesize exactly once with visible text', requests === 1 && sentText === replies.read('desktop:1', prepared.replyId).preview.text
    && replies.read('desktop:1', prepared.replyId).audio?.text === sentText);
  const view = new NativeUsageService(journal).consumption('s1');
  check('reply characters have their own usage category and unknown cost', view?.speech?.find(item => item.product === 'speech-reply')?.amounts.complete === sentText.length && !view?.speech?.some(item => item.product === 'speech-test'));
  allowed = false; await refuses('revocation blocks cached audio', () => replies.read('desktop:1', prepared.replyId), /revoked/); allowed = true;
  replies.cancel('desktop:1', prepared.replyId); await refuses('cancelled receipt cannot regenerate', () => replies.speak('desktop:1', prepared.replyId), /nicht mehr verfügbar/);
  const failed = replies.prepare('desktop:1', input, authorize); failure = true;
  await refuses('provider failure is bounded', () => replies.speak('desktop:1', failed.replyId), /ElevenLabs-Sprachausgabe unterbrochen/);
  const failedCount = requests; failure = false;
  await refuses('a failed paid request is never silently retried', () => replies.speak('desktop:1', failed.replyId), /ElevenLabs-Sprachausgabe unterbrochen/);
  check('failed replay has no additional provider cost', requests === failedCount);
  replies.cancel('desktop:1', failed.replyId);
  wait = true; const cancelled = replies.prepare('desktop:1', input, authorize); const pending = replies.speak('desktop:1', cancelled.replyId);
  while (requests === failedCount) await new Promise(done => setTimeout(done, 5));
  replies.cancel('desktop:1', cancelled.replyId);
  await refuses('stop aborts a pending provider request', () => pending, /ElevenLabs/);
  check('provider receives actual abort signal', observedSignal?.aborted === true); wait = false;
  const expired = replies.prepare('desktop:1', input, authorize); now += 10 * 60_000;
  await refuses('preview and audio expire together', () => replies.read('desktop:1', expired.replyId), /nicht mehr verfügbar/);
  for (let index = 0; index < 8; index++) replies.prepare('desktop:1', input, authorize);
  await refuses('memory quota rejects instead of evicting live replies', () => replies.prepare('desktop:1', input, authorize), /Zu viele/);
  replies.revoke('desktop:1');
  const final = replies.prepare('desktop:1', input, authorize); await replies.speak('desktop:1', final.replyId);
  check('final positive playback survives negative controls', replies.read('desktop:1', final.replyId).audio?.mimeType === 'audio/mpeg');
  wait = true; const shutdown = replies.prepare('desktop:1', input, authorize); const beforeShutdown = requests;
  const duringShutdown = replies.speak('desktop:1', shutdown.replyId); void duringShutdown.catch(() => undefined);
  while (requests === beforeShutdown) await new Promise(done => setTimeout(done, 5));
  replies.cancel('desktop:1', shutdown.replyId); await replies.dispose();
  await refuses('shutdown waits for cancelled in-flight usage to settle', () => duringShutdown, /ElevenLabs/);
  await refuses('shutdown removes cached audio as well', () => replies.read('desktop:1', final.replyId), /nicht mehr verfügbar/);
  await journal.close();
  console.log(`Reply speech: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Reply speech: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await journal?.close(); if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected fixture root'); rmSync(root, { recursive: true, force: true }); });
