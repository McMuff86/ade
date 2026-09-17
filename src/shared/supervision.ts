/** Durable project ownership is independent of a transient PTY or native thread. */
export type SupervisionMode = 'direct' | 'observe' | 'coordinate';
export type SupervisionTarget = { kind: 'session' | 'run'; id: string };
export interface SupervisedProject {
  id: string; repositoryId: string; mode: SupervisionMode; objective: string;
  links: Array<{ id: string; target: SupervisionTarget; createdAt: number }>; updatedAt: number;
}
export type SupervisionAction = (
  { operation: 'profile'; agentId: string | null }
  | { operation: 'project'; repositoryId: string; mode: SupervisionMode; objective: string }
  | { operation: 'link'; projectId: string; target: SupervisionTarget }
  | { operation: 'unlink'; projectId: string; linkId: string }
  | { operation: 'remember'; projectId: string; text: string; nextStep: string; linkId: string | null }
  | { operation: 'handoff-status'; projectId: string; handoffId: string; status: 'open' | 'done' }
);
export type SupervisionCommand = { commandId: string; revision: number } & SupervisionAction;
export interface SupervisionView {
  revision: number;
  profile: { id: string; name: string; available: boolean } | null;
  projects: Array<{ id: string; repositoryId: string; name: string; available: boolean; mode: SupervisionMode; updatedAt: number;
    objective: { sha256: string; chars: number };
    links: Array<{ id: string; target: SupervisionTarget; title: string; status: string; available: boolean }> }>;
}
export interface SupervisionReceipt { revision: number; replayed: boolean }
export interface ProjectHandoff {
  id: string; projectId: string; text: string; nextStep: string; source: SupervisionTarget | null;
  status: 'open' | 'done'; createdAt: number; updatedAt: number;
}
export interface HandoffDetail { text: string; nextStep: string; redacted?: boolean }
export interface MorningBriefing {
  revision: number; observedAt: number;
  projects: Array<{ id: string; repositoryId: string; name: string; available: boolean; mode: SupervisionMode;
    work: Array<{ linkId: string; title: string; status: string; available: boolean; pendingQuestions: number; updatedAt: number | null }>;
    handoffs: Array<{ id: string; status: 'open' | 'done'; createdAt: number; updatedAt: number; text: { sha256: string; chars: number }; nextStep: { sha256: string; chars: number } }>;
    suggestion: 'answer-question' | 'review-failure' | 'resume-handoff' | 'observe-work' | 'choose-work';
  }>;
}
export const supervisionId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
export const validSupervisionMode = (v: unknown): v is SupervisionMode => v === 'direct' || v === 'observe' || v === 'coordinate';
export const validSupervisionTarget = (v: unknown): v is SupervisionTarget => obj(v) && exact(v, ['kind', 'id']) && (v.kind === 'session' || v.kind === 'run') && supervisionId(v.id);
export const validSupervisionObjective = (v: unknown): v is string => typeof v === 'string' && v.length <= 8000 && !v.includes('\0');
export const validHandoffText = (v: unknown): v is string => typeof v === 'string' && v.length <= 4000 && !v.includes('\0');
export function validSupervisionCommand(v: unknown): v is SupervisionCommand {
  if (!obj(v) || !supervisionId(v.commandId) || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0) return false;
  const base = ['commandId', 'revision', 'operation'];
  switch (v.operation) {
    case 'profile': return exact(v, [...base, 'agentId']) && (v.agentId === null || supervisionId(v.agentId));
    case 'project': return exact(v, [...base, 'repositoryId', 'mode', 'objective']) && supervisionId(v.repositoryId) && validSupervisionMode(v.mode) && validSupervisionObjective(v.objective);
    case 'link': return exact(v, [...base, 'projectId', 'target']) && supervisionId(v.projectId) && validSupervisionTarget(v.target);
    case 'unlink': return exact(v, [...base, 'projectId', 'linkId']) && supervisionId(v.projectId) && supervisionId(v.linkId);
    case 'remember': return exact(v, [...base, 'projectId', 'text', 'nextStep', 'linkId']) && supervisionId(v.projectId) && validHandoffText(v.text) && !!v.text.trim()
      && validHandoffText(v.nextStep) && (v.linkId === null || supervisionId(v.linkId));
    case 'handoff-status': return exact(v, [...base, 'projectId', 'handoffId', 'status']) && supervisionId(v.projectId) && supervisionId(v.handoffId) && (v.status === 'open' || v.status === 'done');
    default: return false;
  }
}
