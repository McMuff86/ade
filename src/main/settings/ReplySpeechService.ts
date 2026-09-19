import { t as translate } from "../../shared/i18n";
import { randomUUID } from 'node:crypto';
import type { SpeechAudio, SpeechTarget } from '../../shared/speech';
import type { ReplyInput, ReplyPreview } from '../../shared/terminalSpeech';
import type { SpeechService } from './SpeechService';
import type { SpeechPreferences } from './SpeechPreferences';
import type { SpeechUsageAttribution } from '../usage/SpeechUsageService';
import { replySpeechText } from './ReplySpeechText';

export type ReplyAuthorization = (() => void) & { usage: Readonly<SpeechUsageAttribution> };
interface ReplyRecord {
  owner: string; preview: ReplyPreview; authorize: ReplyAuthorization; expiresAt: number;
  controller: AbortController; pending?: Promise<void>; audio?: SpeechAudio;
}
/** Bounded, owner-bound, memory-only source/audio. One paid attempt per prepared reply. */
export class ReplySpeechService {
  private readonly replies = new Map<string, ReplyRecord>();
  private readonly pending = new Set<Promise<void>>();
  constructor(private readonly speech: SpeechService, private readonly preferences: SpeechPreferences,
    private readonly secrets: () => readonly string[] = () => [], private readonly now = Date.now) {}
  prepare(owner: string, input: ReplyInput, authorize: ReplyAuthorization): { replyId: string } {
    authorize();
    for (const [id, reply] of this.replies) if (reply.expiresAt <= this.now()) { reply.controller.abort(); this.replies.delete(id); }
    if (this.replies.size >= 8) throw new Error(translate("Too many open speech replies. Close another read-aloud dialog first."));
    const content = replySpeechText(input, this.secrets());
    const replyId = randomUUID();
    this.replies.set(replyId, { owner, preview: { replyId, ...content, source: input.source, mode: input.mode }, authorize,
      expiresAt: this.now() + 10 * 60_000, controller: new AbortController() });
    return { replyId };
  }
  private require(owner: string, id: string): ReplyRecord {
    const reply = this.replies.get(id);
    if (!reply || reply.owner !== owner || reply.expiresAt <= this.now() || reply.controller.signal.aborted) throw new Error(translate("This voice answer is no longer available. Open “listen to answer” again."));
    reply.authorize(); return reply;
  }
  read(owner: string, id: string): { preview: ReplyPreview; audio?: SpeechAudio } {
    const reply = this.require(owner, id);
    return { preview: { ...reply.preview }, ...(reply.audio ? { audio: { ...reply.audio } } : {}) };
  }
  async speak(owner: string, id: string): Promise<{ replyId: string }> {
    const reply = this.require(owner, id);
    if (!reply.pending) {
      reply.pending = (async () => {
      const usage = reply.authorize.usage;
      const target: SpeechTarget = usage.agentId ? { kind: 'agent', agentId: usage.agentId, ...(usage.repositoryId ? { repositoryId: usage.repositoryId } : {}) }
        : usage.repositoryId ? { kind: 'project', repositoryId: usage.repositoryId } : { kind: 'default' };
      const preference = await this.preferences.query(target);
      this.require(owner, id);
      if (!preference.effectiveVoiceId) throw new Error(translate("Please select an available voice under Settings → Voice."));
      const audio = await this.speech.reply(preference.effectiveVoiceId, reply.preview.text, () => { this.require(owner, id); }, usage, reply.controller.signal);
      this.require(owner, id); reply.audio = audio;
      })();
      const pending = reply.pending; this.pending.add(pending);
      void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending));
    }
    await reply.pending; this.require(owner, id); return { replyId: id };
  }
  cancel(owner: string, id: string): { cancelled: true } {
    const reply = this.replies.get(id);
    if (reply?.owner === owner) { reply.controller.abort(); this.replies.delete(id); }
    return { cancelled: true };
  }
  revoke(owner?: string): void {
    for (const [id, reply] of this.replies) if (!owner || reply.owner === owner) { reply.controller.abort(); this.replies.delete(id); }
  }
  async dispose(): Promise<void> {
    this.revoke(); await Promise.allSettled([...this.pending]);
  }
}
