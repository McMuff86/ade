import { randomUUID } from 'node:crypto';
import { unknownTokens } from '../../shared/usage';
import { LIVE_DICTATION_MAX_SECONDS } from '../../shared/liveDictation';
import { UsageJournal, usageDigest } from './UsageJournal';

/** Captured in main from the authorized target, never a client-owned DTO. */
export interface SpeechUsageAttribution { terminalSessionId?: string; repositoryId?: string; agentId?: string }
export interface SpeechUsageAttempt {
  finish(state: 'complete' | 'unconfirmed' | 'not-sent', audioSeconds?: number): Promise<void>;
}

/** Counts ADE's own attempts without interpreting audio seconds as tokens or
 * guessing credits/prices from a successful response. Provider account totals
 * are a separate source and must not be added as another copy of these facts. */
export class SpeechUsageService {
  constructor(private readonly journal: UsageJournal, private readonly now = Date.now) {}

  async begin(input: ({ product: 'dictation'; model: 'scribe_v2'; audioSeconds: number }
    | { product: 'dictation'; model: 'scribe_v2_realtime'; audioSeconds: null }
    | { product: 'speech-test'; model: 'eleven_multilingual_v2'; characters: number }) & SpeechUsageAttribution): Promise<SpeechUsageAttempt> {
    input = structuredClone(input);
    const audioSeconds = input.product === 'dictation' ? input.audioSeconds : null;
    const characters = input.product === 'speech-test' ? input.characters : null;
    if (input.product === 'dictation' ? input.model === 'scribe_v2_realtime' ? audioSeconds !== null
      : input.model !== 'scribe_v2' || !Number.isFinite(audioSeconds) || audioSeconds! < 0.1 || audioSeconds! > 60
      : input.product !== 'speech-test' || input.model !== 'eleven_multilingual_v2' || !Number.isSafeInteger(characters) || characters! < 1 || characters! > 12_000) {
      throw new Error('Ungültige Einheit für die Sprach-Verbrauchserfassung.');
    }
    const at = this.now();
    const sessionId = await this.journal.openSession({ provider: 'elevenlabs', product: input.product, backend: 'native', createdAt: at, coverage: 'waiting',
      ...(input.terminalSessionId ? { terminalSessionId: input.terminalSessionId } : {}),
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}), ...(input.agentId ? { agentId: input.agentId } : {}) });
    const factId = usageDigest(`elevenlabs/${randomUUID()}`);
    await this.journal.recordAmounts({ id: factId, sessionId, at, model: input.model, source: 'elevenlabs-request', requestState: 'pending',
      fingerprint: usageDigest(JSON.stringify([input.product, input.model, audioSeconds, characters])),
      tokens: unknownTokens(), audioSeconds, characters, credits: null, costUsd: null, costKind: 'unknown', costComplete: null });
    let finalized: { state: string; promise: Promise<void> } | undefined;
    return { finish: (state, measuredSeconds) => {
      const identity = JSON.stringify([state, measuredSeconds]);
      if (measuredSeconds !== undefined && (input.model !== 'scribe_v2_realtime' || !Number.isFinite(measuredSeconds) || measuredSeconds < 0 || measuredSeconds > LIVE_DICTATION_MAX_SECONDS)) return Promise.reject(new Error('Ungültige Dauer für Live-Diktat.'));
      if (finalized) return finalized.state === identity ? finalized.promise : Promise.reject(new Error('Sprachversuch hat bereits einen anderen Abschluss.'));
      const promise = (async () => {
        await this.journal.speechOutcome(factId, state, measuredSeconds);
        await this.journal.setCoverage(sessionId, state === 'unconfirmed' ? 'incomplete' : 'recording', Math.max(this.now(), at));
      })();
      finalized = { state: identity, promise }; return promise;
    } };
  }
}
