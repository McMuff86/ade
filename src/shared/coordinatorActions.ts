import { conversationId } from './conversation';
import { supervisionId, validHandoffText } from './supervision';
import type { RunQuestionsView } from './runQuestions';
import type { RunReportTask } from './types';

export interface CoordinatorFirstTask { agentId: string; prompt: string }
export type CoordinatorActionInput =
  | { kind: 'project'; name: string; context: string; agentsMd: string; githubRepo: string; start?: CoordinatorFirstTask | null }
  | { kind: 'handoff'; projectId: string; text: string; nextStep: string }
  | { kind: 'task'; projectId: string; agentId: string; prompt: string; coordinate?: boolean };
export function coordinatorFirstTask(input: CoordinatorActionInput): CoordinatorFirstTask | null {
  return input.kind === 'task' ? input : input.kind === 'project' ? input.start ?? null : null;
}
export type CoordinatorActionState = 'proposed' | 'dismissed' | 'dispatching' | 'applied' | 'uncertain';
export interface CoordinatorActionSummary {
  id: string; conversationId: string; turnId: string; kind: CoordinatorActionInput['kind'];
  projectId: string; projectName: string; agentName: string | null; state: CoordinatorActionState;
  createdAt: number; updatedAt: number; content: { sha256: string; chars: number };
  runId: string | null; taskId: string | null; taskStatus: string | null; pendingQuestions: number; error: string;
  startsWork?: boolean; coordinatesProject?: boolean; permissionMode?: import('./types').Agent['permissionMode'];
}
/** Only an explicit detail contains a saved handoff. Task prompts stay in main. */
export interface CoordinatorActionDetail { action: CoordinatorActionSummary; text: string | null; nextStep: string | null; project?: Omit<Extract<CoordinatorActionInput, { kind: 'project' }>, 'start'> }
export interface CoordinatorActionWork { task: Pick<RunReportTask, 'id' | 'status' | 'error' | 'output' | 'result'> | null; questions: RunQuestionsView }
export type CoordinatorActionQuery = { operation: 'list'; conversationId: string }
  | { operation: 'detail' | 'work'; conversationId: string; actionId: string };
export interface CoordinatorActionCommand { operation: 'confirm' | 'dismiss'; conversationId: string; actionId: string; commandId: string }
export interface CoordinatorActionReceipt { actionId: string; state: CoordinatorActionState; replayed: boolean }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const exactActionKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function validCoordinatorActionInput(v: unknown): v is CoordinatorActionInput {
  if (!record(v)) return false;
  const validTask = (value: unknown): boolean => record(value) && exactActionKeys(value, ['agentId', 'prompt']) && supervisionId(value.agentId)
    && typeof value.prompt === 'string' && !!value.prompt.trim() && value.prompt.length <= 32_000 && !value.prompt.includes('\0');
  if (v.kind === 'project') return exactActionKeys(v, ['kind', 'name', 'context', 'agentsMd', 'githubRepo', ...(Object.hasOwn(v, 'start') ? ['start'] : [])])
    && (!Object.hasOwn(v, 'start') || v.start === null || validTask(v.start))
    && typeof v.name === 'string' && !!v.name.trim() && v.name.length <= 80 && !/[\\/:\x00-\x1f]/.test(v.name)
    && typeof v.context === 'string' && !!v.context.trim() && v.context.length <= 8000 && !v.context.includes('\0')
    && typeof v.agentsMd === 'string' && !!v.agentsMd.trim() && v.agentsMd.length <= 16_000 && !v.agentsMd.includes('\0')
    && typeof v.githubRepo === 'string' && (v.githubRepo === '' || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(v.githubRepo));
  if (!supervisionId(v.projectId)) return false;
  if (v.kind === 'handoff') return exactActionKeys(v, ['kind', 'projectId', 'text', 'nextStep']) && validHandoffText(v.text) && !!v.text.trim() && validHandoffText(v.nextStep);
  return v.kind === 'task' && exactActionKeys(v, ['kind', 'projectId', 'agentId', 'prompt', ...(Object.hasOwn(v, 'coordinate') ? ['coordinate'] : [])])
    && (!Object.hasOwn(v, 'coordinate') || typeof v.coordinate === 'boolean') && supervisionId(v.agentId)
    && typeof v.prompt === 'string' && !!v.prompt.trim() && v.prompt.length <= 32_000 && !v.prompt.includes('\0');
}
export function validCoordinatorActionQuery(v: unknown): v is CoordinatorActionQuery {
  return record(v) && conversationId(v.conversationId) && (v.operation === 'list' ? exactActionKeys(v, ['operation', 'conversationId'])
    : (v.operation === 'detail' || v.operation === 'work') && conversationId(v.actionId) && exactActionKeys(v, ['operation', 'conversationId', 'actionId']));
}
export function validCoordinatorActionCommand(v: unknown): v is CoordinatorActionCommand {
  return record(v) && exactActionKeys(v, ['operation', 'conversationId', 'actionId', 'commandId']) && (v.operation === 'confirm' || v.operation === 'dismiss')
    && conversationId(v.conversationId) && conversationId(v.actionId) && supervisionId(v.commandId);
}
