/** In-memory decision drafts for one open overview. Keys bind every draft to the
 * host identity, the decision row and, for answers, the exact question. Nothing is
 * written to browser storage; a changed host identity discards the whole map. */
export interface DraftSlot<T> { read(): T | undefined; write(value: T | undefined): void }

export const ATTENTION_DRAFT_LIMIT = 64;

export class AttentionDrafts {
  private readonly values = new Map<string, unknown>();
  constructor(readonly identity: string) {}
  slot<T>(key: string): DraftSlot<T> {
    const scoped = `${this.identity}\u0000${key}`;
    return {
      read: () => this.values.get(scoped) as T | undefined,
      write: (value) => {
        this.values.delete(scoped);
        if (value === undefined) return;
        this.values.set(scoped, value);
        // Bounded: drop the oldest draft rather than grow without limit.
        while (this.values.size > ATTENTION_DRAFT_LIMIT) this.values.delete(this.values.keys().next().value!);
      },
    };
  }
}

/** A further instruction to one exact CLI session. `attempt` pins the delivery
 * identity: until the operator confirms the terminal state, a check repeats the
 * same commandId and text, so the host delivers at most once. */
export interface InstructDraft {
  text: string;
  attempt?: { commandId: string; text: string };
  status: 'idle' | 'delivered' | 'unconfirmed';
  replayed?: boolean;
  message?: string;
}
export type InstructSend = (text: string, commandId: string) => Promise<{ accepted: true; replayed: boolean }>;

export async function deliverInstruction(draft: InstructDraft, send: InstructSend, newId: () => string): Promise<InstructDraft> {
  const attempt = draft.attempt ?? { commandId: newId(), text: draft.text };
  try {
    const receipt = await send(attempt.text, attempt.commandId);
    return { text: '', status: 'delivered', replayed: receipt.replayed };
  } catch (error) {
    // Any failure may sit after the host reserved this delivery. Keep the identity
    // and the text locked; a check must not become a second, different prompt.
    return { text: attempt.text, attempt, status: 'unconfirmed', message: error instanceof Error ? error.message : String(error) };
  }
}

/** The operator checked the terminal: unlock the text. The next send is a new delivery. */
export const releaseInstruction = (draft: InstructDraft): InstructDraft => ({ text: draft.text, status: 'idle' });
