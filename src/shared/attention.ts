/** Bounded decision overview. No prompt, question body, path or executable action. */
export type AttentionGroup = 'needs-you' | 'working' | 'review' | 'interrupted' | 'unknown';
export type AttentionTarget = { kind: 'run' | 'session' | 'project' | 'supervision'; id: string };
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
  target: AttentionTarget | null;
}
export interface AttentionSnapshot { observedAt: number; rows: AttentionRow[]; omitted: number }
export const ATTENTION_GROUPS: readonly AttentionGroup[] = ['needs-you', 'interrupted', 'review', 'working', 'unknown'];
export const ATTENTION_LIMIT = 100;
