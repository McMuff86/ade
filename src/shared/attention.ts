/** Bounded decision overview. No prompt, question body, path or executable action. */
export type AttentionGroup = 'needs-you' | 'working' | 'review' | 'interrupted' | 'unknown';
export type AttentionTarget = { kind: 'run' | 'session' | 'project' | 'supervision'; id: string };
/** What the operator can actually do from a decision row. Main derives each entry from
 * the current run/session state, the caller's grants and the adapter's prompt transport;
 * the renderer never upgrades an unavailable action. There is no universal pause. */
export type AttentionActionKind = 'answer' | 'cancel' | 'instruct' | 'take-input' | 'interrupt';
export type AttentionActionBlock =
  | 'read-only'          // the caller lacks the write grant for this action
  | 'prompt-unsupported' // the session has no protected prompt transport (shell, custom command, task PTY)
  | 'prompt-not-ready'   // the CLI has not started, ended or cannot take a paste right now
  | 'other-device'       // another device holds terminal input; take input first
  | 'no-turn-control';   // interactive CLIs expose no confirmed interrupt for a running turn
export type AttentionAction = { kind: AttentionActionKind; available: true } | { kind: AttentionActionKind; available: false; reason: AttentionActionBlock };
export interface AttentionRow {
  id: string;
  kind: 'run' | 'session' | 'history' | 'handoff';
  group: AttentionGroup;
  title: string;
  project: string | null;
  activityAt: number | null;
  activityKind: 'state' | 'output' | 'start';
  reason: 'question' | 'approval' | 'run-active' | 'process-active' | 'completed' | 'failed' | 'cancelled' | 'lost' | 'unknown' | 'ended' | 'handoff';
  pendingQuestions: number;
  /** A recorded interruption the caller may close. Closing only stops listing it; nothing is resumed or deleted. */
  dismissible?: boolean;
  /** Only for `reason: 'lost'`: how the previous ADE owner ended. Process loss is never a resumable session. */
  interruption?: 'app-quit' | 'host-restart' | 'app-crash' | 'unknown';
  target: AttentionTarget | null;
  actions: AttentionAction[];
}
export interface AttentionSnapshot { observedAt: number; rows: AttentionRow[]; omitted: number }
export const ATTENTION_GROUPS: readonly AttentionGroup[] = ['needs-you', 'interrupted', 'review', 'working', 'unknown'];
export const ATTENTION_LIMIT = 100;
/** Prompt readiness as seen by one caller. `other-device` is only reported to the desktop. */
export type AttentionPromptState = 'available' | 'unsupported' | 'not-ready' | 'other-device';
/** Caller-specific capability input for the projection. Omitted access fails closed. */
export interface AttentionAccess {
  runsWrite: boolean;
  terminalWrite: boolean;
  /** May close recorded interruptions (desktop; a device with terminal control). */
  dismiss?: boolean;
  prompt(sessionId: string): AttentionPromptState;
}
export const NO_ATTENTION_ACCESS: AttentionAccess = { runsWrite: false, terminalWrite: false, prompt: () => 'unsupported' };
