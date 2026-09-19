import { t as translate } from "../../shared/i18n";
import { conversationId, conversationText, validConversationCommand, type ConversationCommand, type ConversationReceipt } from '../../shared/conversation';

export type PendingConversationCommand = Extract<ConversationCommand, { operation: 'create' | 'send' }>;
export interface ConversationRecordingDraft { id: string; jobId: string; text: string; complete: boolean }
interface State { version: 2; selected: string; drafts: Array<{ id: string; text: string }>; pending: PendingConversationCommand[]; recordings: ConversationRecordingDraft[] }
const MAX_CHARS = 1024 * 1024;
const recordingText = (value: unknown): value is string => conversationText(value) && value.length <= 12_000;
export const conversationDraftKey = (scope: string) => `ade:conversation-state:${scope}`;
/** Origin-local text and admission keys, never audio or question answers. Save
 * before dispatch; acknowledgements clear only the exact accepted request. */
export class ConversationDrafts {
  private readonly key: string;
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>, scope: string) {
    if (!/^[A-Za-z0-9:._-]{1,160}$/.test(scope)) throw new Error(translate("Invalid conversation storage."));
    this.key = conversationDraftKey(scope);
  }
  read(): State {
    const raw = this.storage.getItem(this.key);
    if (!raw) return { version: 2, selected: '', drafts: [], pending: [], recordings: [] };
    try {
      if (raw.length > MAX_CHARS) throw new Error('size');
      const parsed = JSON.parse(raw);
      // Exact, lossless migration. Do not replace malformed old local state.
      const s: State = parsed?.version === 1 && Object.keys(parsed).sort().join(',') === 'drafts,pending,selected,version'
        ? { ...parsed, version: 2, recordings: [] } : parsed;
      if (!s || Object.keys(s).sort().join(',') !== 'drafts,pending,recordings,selected,version' || s.version !== 2 || s.selected !== '' && !conversationId(s.selected)
        || !Array.isArray(s.drafts) || s.drafts.length > 64 || !Array.isArray(s.pending) || s.pending.length > 65
        || !Array.isArray(s.recordings) || s.recordings.length > 16
        || s.recordings.some(r => !r || Object.keys(r).sort().join(',') !== 'complete,id,jobId,text' || !conversationId(r.id) || !conversationId(r.jobId) || !recordingText(r.text) || typeof r.complete !== 'boolean')
        || new Set(s.recordings.map(r => r.id)).size !== s.recordings.length
        || s.drafts.some(d => !d || Object.keys(d).sort().join(',') !== 'id,text' || !conversationId(d.id) || !conversationText(d.text))
        || new Set(s.drafts.map(d => d.id)).size !== s.drafts.length
        || s.pending.some(c => !validConversationCommand(c) || c.operation !== 'create' && c.operation !== 'send')
        || new Set(s.pending.map(c => c.operation === 'create' ? 'create' : c.conversationId)).size !== s.pending.length) throw new Error('schema');
      return s;
    } catch { throw new Error(translate("Draft conversations cannot be read; the stored status is preserved; nothing is sent.")); }
  }
  private save(state: State): void {
    const raw = JSON.stringify(state);
    if (raw.length > MAX_CHARS || state.drafts.length > 64 || state.recordings.length > 16) throw new Error(translate("Conversation draft storage is full. Clear text you no longer need in another conversation."));
    this.storage.setItem(this.key, raw);
  }
  select(id: string): void {
    if (id !== '' && !conversationId(id)) throw new Error(translate("Invalid conversation."));
    const s = this.read(); s.selected = id; this.save(s);
  }
  text(id: string): string {
    if (!id) return '';
    if (!conversationId(id)) throw new Error(translate("Invalid conversation."));
    const draft = this.read().drafts.find(d => d.id === id);
    if (draft) return draft.text;
    // Preserve drafts written by the first desktop conversation implementation.
    const legacy = this.key.endsWith(':desktop') ? this.storage.getItem(`ade:conversation-draft:${id}`) : null;
    if (legacy !== null && !conversationText(legacy)) throw new Error(translate("Saved conversation draft is invalid."));
    return legacy ?? '';
  }
  edit(id: string, text: string): void {
    if (!conversationId(id) || !conversationText(text)) throw new Error(translate("Conversation draft is invalid or too long."));
    const s = this.read(); s.drafts = s.drafts.filter(d => d.id !== id); s.drafts.push({ id, text }); this.save(s);
  }
  pending(id: string | 'create'): PendingConversationCommand | undefined {
    return this.read().pending.find(c => c.operation === 'create' ? id === 'create' : c.conversationId === id);
  }
  reserve(command: PendingConversationCommand): void {
    if (!validConversationCommand(command) || command.operation !== 'create' && command.operation !== 'send') throw new Error(translate("Invalid conversation request."));
    const s = this.read(); const old = s.pending.find(c => c.operation === 'create' ? command.operation === 'create' : command.operation === 'send' && c.conversationId === command.conversationId);
    if (old) { if (JSON.stringify(old) !== JSON.stringify(command)) throw new Error(translate("First check the previous operation with the same ID.")); return; }
    s.pending.push(command); this.save(s);
  }
  acknowledge(command: PendingConversationCommand, receipt: ConversationReceipt): void {
    if (command.operation === 'send' && receipt.conversationId !== command.conversationId || !conversationId(receipt.conversationId)) throw new Error(translate("The conversation receipt does not match the request."));
    const s = this.read();
    const index = s.pending.findIndex(c => c.commandId === command.commandId);
    if (index < 0) return;
    if (JSON.stringify(s.pending[index]) !== JSON.stringify(command)) throw new Error(translate("The conversation request has changed in the meantime."));
    if (command.operation === 'send' && this.text(command.conversationId) === command.text) {
      s.drafts = s.drafts.filter(d => d.id !== command.conversationId); s.drafts.push({ id: command.conversationId, text: '' });
    }
    s.pending.splice(index, 1);
    // Navigation belongs to the still-open UI. A late reply after closing must
    // not replace a selection made in another view in the meantime.
    this.save(s);
  }
  /** Only a host-confirmed admission refusal may abandon the retry key. Text
   * remains editable; network uncertainty must never call this method. */
  rejected(command: PendingConversationCommand): void {
    const s = this.read(); s.pending = s.pending.filter(c => c.commandId !== command.commandId || JSON.stringify(c) !== JSON.stringify(command)); this.save(s);
  }
  recording(id: string): ConversationRecordingDraft | undefined { return this.read().recordings.find(r => r.id === id); }
  saveRecording(value: ConversationRecordingDraft, prepare = false): void {
    if (!conversationId(value.id) || !conversationId(value.jobId) || !recordingText(value.text) || typeof value.complete !== 'boolean') throw new Error(translate("Invalid draft dictation."));
    const s = this.read(); const old = s.recordings.find(r => r.id === value.id);
    if (prepare ? !!old : !old || old.jobId !== value.jobId) throw new Error(translate("The draft dictation was changed in a different view."));
    s.recordings = s.recordings.filter(r => r.id !== value.id); s.recordings.push(value); this.save(s);
  }
  discardRecording(id: string, jobId: string): void {
    const s = this.read(); s.recordings = s.recordings.filter(r => r.id !== id || r.jobId !== jobId); this.save(s);
  }
  /** Append to today's editable draft, atomically consuming this exact preview.
   * A late acknowledgement or another conversation can never receive the text. */
  consumeRecording(id: string, jobId: string): string {
    const s = this.read(); const value = s.recordings.find(r => r.id === id && r.jobId === jobId);
    if (!value?.text.trim() || s.pending.some(c => c.operation === 'send' && c.conversationId === id)) throw new Error(translate("Dictation is empty or the last message is still awaiting confirmation."));
    const old = this.text(id); const text = old + (old && !old.endsWith('\n') ? '\n' : '') + value.text;
    if (!conversationText(text)) throw new Error(translate("Message would be too long. Message first shortened; the dictation remains."));
    s.drafts = s.drafts.filter(d => d.id !== id); s.drafts.push({ id, text });
    s.recordings = s.recordings.filter(r => r !== value); this.save(s); return text;
  }
}
