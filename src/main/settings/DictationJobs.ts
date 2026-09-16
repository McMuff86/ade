import { createHash, randomUUID } from 'node:crypto';
import type { DictationJobState } from '../../shared/dictation';
import { redactedErrorMessage } from '../errors';
import { validateDictationAudio, type DictationService } from './DictationService';
import type { SpeechUsageAttribution } from '../usage/SpeechUsageService';
import type { LiveDictationSession } from './LiveDictationService';

interface Job {
  usage: SpeechUsageAttribution;
  owner: string; authorize: () => void; expiresAt: number; state: DictationJobState;
  controller: AbortController; submission?: { key: string; fingerprint: string };
  live?: LiveDictationSession; nextSequence?: number;
  packets?: Map<number, { fingerprint: string; complete: boolean }>;
}

/** Host-issued tickets are bound before recording. An expired ticket or a host
 * restart can never create another paid request by replaying the audio upload.
 * Tickets and transcripts stay in memory; raw audio is never written to disk. */
export class DictationJobs {
  private readonly jobs = new Map<string, Job>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly service: Pick<DictationService, 'transcribe'> & Partial<Pick<DictationService, 'startLive'>>, private readonly now = Date.now) {
    this.timer = setInterval(() => this.prune(), 30_000); this.timer.unref();
  }
  dispose(): void { clearInterval(this.timer); for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear(); }

  prepare(owner: string, authorize: () => void, usage: SpeechUsageAttribution = {}): { jobId: string } {
    authorize(); this.prune();
    while (this.jobs.size >= 16) {
      const settled = [...this.jobs].find(([, job]) => !['prepared', 'recording', 'transcribing'].includes(job.state.status));
      if (!settled) throw new Error('Zu viele offene Aufnahmen. Eine Aufnahme beenden oder abbrechen.');
      this.jobs.delete(settled[0]);
    }
    const jobId = randomUUID(); this.jobs.set(jobId, { owner, authorize, usage: structuredClone(usage), expiresAt: this.now() + 5 * 60_000,
      state: { status: 'prepared' }, controller: new AbortController() });
    return { jobId };
  }

  submit(owner: string, jobId: string, key: string, audio: Uint8Array): { jobId: string; replayed: boolean } {
    const job = this.require(owner, jobId);
    validateDictationAudio(audio);
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new Error('Ungültige Versand-ID.');
    const fingerprint = createHash('sha256').update(audio).digest('hex');
    if (job.submission) {
      if (job.submission.key !== key || job.submission.fingerprint !== fingerprint) throw new Error('Diese Aufnahme wurde bereits mit anderen Daten übergeben.');
      return { jobId, replayed: true };
    }
    if (job.state.status !== 'prepared') throw new Error('Diese Aufnahme wurde bereits beendet.');
    const recording = new Uint8Array(audio);
    job.authorize(); job.submission = { key, fingerprint }; job.state = { status: 'transcribing' }; job.expiresAt = this.now() + 10 * 60_000;
    // Reserve before scheduling the provider request. Submit acknowledges only
    // acceptance; callers read the private job result and never resubmit blindly.
    void Promise.resolve().then(() => this.service.transcribe(recording, job.authorize, job.controller.signal, job.usage)).then(transcript => {
      if (this.jobs.get(jobId) === job && job.state.status === 'transcribing') job.state = { status: 'complete', transcript };
    }).catch(error => {
      if (this.jobs.get(jobId) === job && job.state.status === 'transcribing') job.state = { status: 'failed', message: redactedErrorMessage(error, 1000) };
    });
    return { jobId, replayed: false };
  }

  read(owner: string, jobId: string): DictationJobState { return structuredClone(this.require(owner, jobId).state); }

  async startLive(owner: string, jobId: string): Promise<void> {
    const job = this.require(owner, jobId);
    if (!this.service.startLive || job.state.status !== 'prepared') throw new Error('Diese Aufnahme kann nicht als Live-Diktat gestartet werden.');
    job.state = { status: 'recording', text: '' }; job.nextSequence = 0;
    try {
      const live = await this.service.startLive(job.authorize, job.controller.signal, job.usage, text => {
        if (job.state.status === 'recording' && !job.controller.signal.aborted) job.state = { status: 'recording', text };
      });
      job.live = live;
      void live.result.then(transcript => {
        if (this.jobs.get(jobId) === job && job.state.status === 'transcribing') job.state = { status: 'complete', transcript };
      }).catch(error => {
        if (this.jobs.get(jobId) === job && ['recording', 'transcribing'].includes(job.state.status)) job.state = { status: 'failed', message: redactedErrorMessage(error, 1000) };
      });
    } catch (error) {
      if (!job.controller.signal.aborted) job.state = { status: 'failed', message: redactedErrorMessage(error, 1000) };
      throw error;
    }
  }

  pushLive(owner: string, jobId: string, sequence: number, audio: Uint8Array): void {
    const job = this.require(owner, jobId);
    if (!job.live || job.state.status !== 'recording' || sequence !== job.nextSequence) throw new Error('Audiostream nicht verfügbar oder Reihenfolge geändert. Keine automatische Wiederholung.');
    job.live.push(audio); job.nextSequence++;
  }

  /** Remote packet keys are fixed to jobId:sequence at the application boundary.
   * Only digests remain in memory; expired/restarted jobs cannot replay audio. */
  pushRemoteLive(owner: string, jobId: string, sequence: number, audio: Uint8Array): boolean {
    const job = this.require(owner, jobId);
    const fingerprint = createHash('sha256').update(audio).digest('hex');
    const previous = job.packets?.get(sequence);
    if (previous) {
      if (previous.fingerprint !== fingerprint || !previous.complete) throw new Error('Audiopaket geändert oder Übergabe unbestätigt. Keine automatische Wiederholung.');
      return true;
    }
    if (sequence !== job.nextSequence || !Number.isSafeInteger(sequence) || sequence < 0 || sequence >= 1000) throw new Error('Ungültige Audioreihenfolge.');
    const receipt = { fingerprint, complete: false };
    (job.packets ??= new Map()).set(sequence, receipt);
    this.pushLive(owner, jobId, sequence, audio); receipt.complete = true;
    return false;
  }

  finishLive(owner: string, jobId: string): void {
    const job = this.require(owner, jobId);
    if (job.live && ['transcribing', 'complete'].includes(job.state.status)) return;
    if (!job.live || job.state.status !== 'recording') throw new Error('Live-Diktat ist nicht mehr verfügbar.');
    job.state = { status: 'transcribing' }; job.expiresAt = this.now() + 10 * 60_000; job.live.finish();
  }

  cancel(owner: string, jobId: string): void {
    const job = this.require(owner, jobId); job.controller.abort(); job.state = { status: 'cancelled' };
  }

  async cancelAndWait(owner: string, jobId: string): Promise<void> {
    const job = this.require(owner, jobId); this.cancel(owner, jobId);
    // Wait for live usage finalization and the shared provider slot to release.
    await job.live?.result.catch(() => undefined);
  }

  revokeOwner(owner: string): void {
    for (const [id, job] of this.jobs) if (job.owner === owner) { job.controller.abort(); this.jobs.delete(id); }
  }

  revokeDevices(): void {
    for (const job of this.jobs.values()) if (job.owner.startsWith('device:')) this.revokeOwner(job.owner);
  }

  private require(owner: string, jobId: string): Job {
    this.prune(); const job = this.jobs.get(jobId);
    if (!job || job.owner !== owner) throw new Error('Aufnahme ist nicht mehr verfügbar. Den Entwurf behalten und bei Bedarf neu aufnehmen.');
    job.authorize(); return job;
  }
  private prune(): void {
    for (const [id, job] of this.jobs) {
      let permitted = true; try { job.authorize(); } catch { permitted = false; }
      if (!permitted || job.expiresAt <= this.now()) { job.controller.abort(); this.jobs.delete(id); }
    }
  }
}
