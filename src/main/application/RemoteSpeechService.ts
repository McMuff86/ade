import { randomUUID } from 'node:crypto';
import type { MobileSpeechCommand, MobileSpeechQuery } from '../../shared/remote';
import { validMobileSpeechCommand, validSpeechTarget, type SpeechTuning, type SpeechPreset, type SpeechAudio, type SpeechTarget } from '../../shared/speech';
import type { SpeechPreferences } from '../settings/SpeechPreferences';
import type { SpeechService } from '../settings/SpeechService';

export const validSpeechQuery = (value: unknown): value is MobileSpeechQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 2 && (input.operation === 'voices' && validSpeechTarget(input.target)
    || input.operation === 'audio' && typeof input.testId === 'string' && /^[a-f0-9-]{36}$/.test(input.testId));
};
export const validSpeechCommand: (value: unknown) => value is MobileSpeechCommand = validMobileSpeechCommand;
/** Only a small test ID enters the durable ledger. Audio expires in memory. */
export class RemoteSpeechService {
  private readonly audio = new Map<string, { owner: string; target: SpeechTarget; expiresAt: number; audio: SpeechAudio }>();
  constructor(readonly preferences: SpeechPreferences, private readonly engine: SpeechService, private readonly now = Date.now) {}
  async test(owner: string, target: SpeechTarget, voiceId: string, authorize: () => void, preset?: SpeechPreset, tuning?: SpeechTuning): Promise<{ testId: string }> {
    await this.preferences.query(target); authorize();
    const audio = await this.engine.test(voiceId, authorize, target.kind === 'default' ? {} : {
      repositoryId: target.repositoryId, ...(target.kind === 'agent' ? { agentId: target.agentId } : {}),
    }, preset, tuning); authorize();
    for (const [id, record] of this.audio) if (record.expiresAt <= this.now()) this.audio.delete(id);
    while (this.audio.size >= 8) this.audio.delete(this.audio.keys().next().value!);
    const testId = randomUUID(); this.audio.set(testId, { owner, target, expiresAt: this.now() + 10 * 60_000, audio });
    return { testId };
  }
  read(owner: string, testId: string, authorize: (target: SpeechTarget) => void): SpeechAudio {
    const record = this.audio.get(testId);
    if (!record || record.owner !== owner || record.expiresAt <= this.now()) throw new Error('Stimmtest ist nicht mehr verfügbar. Einen neuen Test ausdrücklich starten.');
    authorize(record.target); return { ...record.audio };
  }
}
