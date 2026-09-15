import { DictationJobs } from '../src/main/settings/DictationJobs';
import { encodeDictationPcm } from '../src/shared/dictationAudio';
import type { DictationTranscript } from '../src/shared/dictation';

let passed = 0;
function check(name: string, ok: boolean) { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); }
async function refuses(name: string, operation: () => unknown, reason: RegExp) {
  try { await operation(); } catch (error) { check(name, reason.test(String(error))); return; }
  throw new Error(`${name}: unexpectedly allowed`);
}
const tick = () => new Promise<void>(done => setImmediate(done));
void (async () => {
  let now = 1000; let allowed = true; let calls = 0; let aborted = false;
  let finish!: (value: DictationTranscript) => void; let firstSample = -1;
  const authorize = () => { if (!allowed) throw new Error('revoked'); };
  const transcript: DictationTranscript = { text: 'privater Entwurf', language: 'de', audioSeconds: 1, model: 'scribe_v2' };
  const jobs = new DictationJobs({ transcribe: (audio, checkGrant, signal) => {
    checkGrant(); calls++; firstSample = audio[44]; signal?.addEventListener('abort', () => { aborted = true; });
    return new Promise(resolve => { finish = resolve; });
  } }, () => now);
  try {
    const audio = encodeDictationPcm(new Float32Array(16_000));
    const first = jobs.prepare('desktop', authorize);
    check('host ticket is prepared before any provider request', jobs.read('desktop', first.jobId).status === 'prepared' && calls === 0);
    await refuses('another owner cannot read a prepared recording', () => jobs.read('device', first.jobId), /nicht mehr verfügbar/);
    await refuses('unknown ticket cannot create a provider request', () => jobs.submit('desktop', 'unknown', 'recording-1', audio), /nicht mehr verfügbar/);
    const receipt = jobs.submit('desktop', first.jobId, 'recording-1', audio);
    check('upload acknowledges a queued transcription without returning text', !receipt.replayed && jobs.read('desktop', first.jobId).status === 'transcribing');
    audio[44] = 9; await tick(); audio[44] = 0;
    check('submitted audio is immutable before asynchronous provider launch', firstSample === 0);
    check('same upload replay does not schedule a second provider call', jobs.submit('desktop', first.jobId, 'recording-1', audio).replayed);
    await tick(); check('provider starts exactly once', calls === 1);
    const changed = audio.slice(); changed[44] = 1;
    await refuses('upload replay cannot change audio', () => jobs.submit('desktop', first.jobId, 'recording-1', changed), /anderen Daten/);
    await refuses('upload replay cannot change its request key', () => jobs.submit('desktop', first.jobId, 'recording-2', audio), /anderen Daten/);
    finish(transcript); await tick();
    const result = jobs.read('desktop', first.jobId);
    check('completed transcript is private to its owner', result.status === 'complete' && result.transcript.text === transcript.text);
    if (result.status === 'complete') result.transcript.text = 'mutated';
    const unchanged = jobs.read('desktop', first.jobId);
    check('read returns an independent transcript copy', unchanged.status === 'complete' && unchanged.transcript.text === transcript.text);
    const cancelled = jobs.prepare('desktop', authorize); jobs.cancel('desktop', cancelled.jobId);
    await refuses('cancelled ticket never accepts audio', () => jobs.submit('desktop', cancelled.jobId, 'cancelled-1', audio), /beendet/);
    const active = jobs.prepare('device', authorize); jobs.submit('device', active.jobId, 'active-request', audio); await tick();
    jobs.cancel('device', active.jobId); finish(transcript); await tick();
    check('cancellation aborts provider and ignores its late response', aborted && jobs.read('device', active.jobId).status === 'cancelled');
    jobs.revokeOwner('device');
    await refuses('revoked owner loses private result access', () => jobs.read('device', active.jobId), /nicht mehr verfügbar/);
    now += 11 * 60_000;
    await refuses('expired upload cannot run again even with same key', () => jobs.submit('desktop', first.jobId, 'recording-1', audio), /nicht mehr verfügbar/);
    const revoked = jobs.prepare('desktop', authorize); allowed = false;
    await refuses('changed resource permission invalidates prepared ticket', () => jobs.submit('desktop', revoked.jobId, 'revoked-request', audio), /nicht mehr verfügbar/); allowed = true;
    for (let index = 0; index < 16; index++) jobs.prepare('desktop', authorize);
    await refuses('open recordings have a hard memory cap', () => jobs.prepare('desktop', authorize), /Zu viele/);
    jobs.revokeOwner('desktop');
    check('final positive prepare succeeds after cleanup and rejections', jobs.read('desktop', jobs.prepare('desktop', authorize).jobId).status === 'prepared');
  } finally { jobs.dispose(); }
  console.log(`Dictation jobs: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Dictation jobs: ${passed} passed, 1 failed`); process.exitCode = 1; });
