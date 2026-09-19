import { t as translate } from "../../shared/i18n";
import { DICTATION_MAX_TEXT_CHARS, validDictationJobId } from '../../shared/dictation';

export interface PromptDraft {
  text: string;
  recordingJob?: string;
  recordingInterrupted?: true;
  delivery?: { commandId: string; mode: 'insert' | 'submit' };
}
interface DraftEntry { key: string; draft: PromptDraft }
const STORE = 'ade:prompt-drafts:v1';
const MAX_BYTES = 1024 * 1024;
const validKey = (key: string) => /^[A-Za-z0-9:/.@_-]{1,300}$/.test(key);

/** Bounded origin-local drafts. Existing nonempty drafts are never evicted to
 * make room for another target. No audio, provider key or workspace path. */
export class PromptDraftStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}
  read(key: string): PromptDraft {
    if (!validKey(key)) throw new Error(translate("Invalid draft target."));
    return this.entries().find(entry => entry.key === key)?.draft ?? { text: '' };
  }
  save(key: string, draft: PromptDraft): void {
    if (!validKey(key) || !this.valid(draft)) throw new Error(translate("The draft is invalid or too long."));
    const entries = this.entries().filter(entry => entry.key !== key);
    if (draft.text || draft.recordingJob || draft.recordingInterrupted || draft.delivery) entries.push({ key, draft });
    if (entries.length > 16) throw new Error(translate("16 local drafts are stored, and first delete a draft that is no longer needed."));
    const value = JSON.stringify({ version: 1, entries });
    if (value.length > MAX_BYTES) throw new Error(translate("Local draft storage is full."));
    this.storage.setItem(STORE, value);
  }
  private valid(value: unknown): value is PromptDraft {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const draft = value as Record<string, unknown>; const delivery = draft.delivery as PromptDraft['delivery'];
    return Object.keys(draft).every(key => ['text', 'recordingJob', 'recordingInterrupted', 'delivery'].includes(key))
      && typeof draft.text === 'string' && draft.text.length <= DICTATION_MAX_TEXT_CHARS
      && (draft.recordingInterrupted === undefined || draft.recordingInterrupted === true)
      && (draft.recordingJob === undefined || validDictationJobId(draft.recordingJob))
      && (delivery === undefined || !!delivery && typeof delivery === 'object' && Object.keys(delivery).length === 2
        && validDictationJobId(delivery.commandId) && (delivery.mode === 'insert' || delivery.mode === 'submit'));
  }
  private entries(): DraftEntry[] {
    const raw = this.storage.getItem(STORE); if (!raw) return [];
    try {
      if (raw.length > MAX_BYTES) throw new Error('size');
      const value = JSON.parse(raw) as { version: number; entries: DraftEntry[] };
      if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 16) throw new Error('schema');
      const keys = new Set<string>();
      for (const entry of value.entries) {
        if (!entry || typeof entry.key !== 'string' || !validKey(entry.key) || keys.has(entry.key) || !this.valid(entry.draft)) throw new Error('entry');
        keys.add(entry.key);
      }
      return value.entries;
    } catch { throw new Error(translate("Saved drafts could not be read. They remain unchanged; copy new text before closing.")); }
  }
}
