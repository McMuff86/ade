import { t as translate } from "../../shared/i18n";
import { createHash } from 'node:crypto';
import { terminalPromptBytes, validTerminalPrompt, type TerminalPromptCapability, type TerminalPromptReceipt, type TerminalPromptRequest } from '../../shared/terminalPrompt';

export interface PromptPort {
  /** Authorize and inspect the actual protected invocation, not renderer metadata. */
  capability(sessionId: string): TerminalPromptCapability;
  /** Keep input serialized; reauthorize before a delayed submit key. */
  write(sessionId: string, text: string, authorize: () => void | Promise<void>): void | Promise<void>;
}
interface Receipt { fingerprint: string; accepted: boolean }

/** Volatile receipts share the lifetime of their actual PTY. A host restart
 * destroys the PTY, so the old session cannot be a new delivery destination. */
export class TerminalPromptDelivery {
  private readonly receipts = new Map<string, Map<string, Receipt>>();
  constructor(private readonly port: PromptPort) {}

  forget(sessionId: string): void { this.receipts.delete(sessionId); }

  async deliver(request: TerminalPromptRequest, authorize: () => void | Promise<void>): Promise<TerminalPromptReceipt> {
    if (!validTerminalPrompt(request)) throw new Error(translate("Invalid prompt request."));
    await authorize();
    const fingerprint = createHash('sha256').update(JSON.stringify([request.text, request.mode])).digest('hex');
    const session = this.receipts.get(request.sessionId) ?? new Map<string, Receipt>();
    const previous = session.get(request.commandId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error(translate("This delivery ID belongs to different text."));
      if (!previous.accepted) throw new Error(translate("The previous handoff outcome is unknown. Check the terminal; do not send again."));
      return { accepted: true, replayed: true };
    }
    const capability = this.port.capability(request.sessionId);
    if (!capability.available) throw new Error(capability.reason);
    if (session.size >= 1024 || (!this.receipts.has(request.sessionId) && this.receipts.size >= 128)) {
      throw new Error(translate("Prompt storage for this session is full. Start a new CLI session."));
    }
    // Reserve before the first write. An in-flight or ambiguous delivery cannot
    // be retried while the protected writer settles and submits the paste.
    const receipt: Receipt = { fingerprint, accepted: false };
    session.set(request.commandId, receipt); this.receipts.set(request.sessionId, session);
    await authorize();
    await this.port.write(request.sessionId, terminalPromptBytes(request.text, request.mode), authorize);
    receipt.accepted = true;
    return { accepted: true, replayed: false };
  }
}
