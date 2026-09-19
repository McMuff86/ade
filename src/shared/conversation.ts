import { validQuestionAnswers, type RunQuestion, type RunQuestionAnswers } from './runQuestions';
import { supervisionId } from './supervision';

export type ConversationMode = 'project' | 'casual';
export const CASUAL_CONVERSATION_CONTRACT = 'ade-casual-chat-v1';

export type ConversationTurnStatus = 'working' | 'interrupting' | 'completed' | 'interrupted' | 'uncertain';
export interface ConversationTurnDetail {
  id: string; input: string; output: string; status: ConversationTurnStatus; error: string;
  createdAt: number; updatedAt: number; questions: RunQuestion[];
}
export interface ConversationSummary {
  mode?: ConversationMode;
  id: string; profileId: string; available: boolean; closed: boolean; createdAt: number; updatedAt: number;
  turns: number; lastTurnId: string | null; status: ConversationTurnStatus | 'ready'; pendingQuestions: number;
  lastAnswer: { sha256: string; chars: number };
}
export interface ConversationDetail {
  mode?: ConversationMode;
  id: string; profileId: string; closed: boolean; available: boolean;
  model: string | null; reasoningEffort: string | null; turns: ConversationTurnDetail[];
}
export type ConversationCommand = { commandId: string } & (
  { operation: 'create'; profileId: string; mode?: ConversationMode }
  | { operation: 'send'; conversationId: string; afterTurnId: string | null; text: string }
  | { operation: 'interrupt'; conversationId: string; turnId: string }
  | { operation: 'answer'; conversationId: string; turnId: string; questionId: string; answers: RunQuestionAnswers }
  | { operation: 'close'; conversationId: string }
);
export interface ConversationReceipt { conversationId: string; turnId: string | null; replayed: boolean }
export type ConversationAdmission = { accepted: true; receipt: ConversationReceipt }
  | { accepted: false; uncertain: boolean; error: string };
export const CONVERSATION_NOT_ACCEPTED = 'ADE_CONVERSATION_NOT_ACCEPTED: ';
export class ConversationNotAcceptedError extends Error {}
export const conversationId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export const conversationText = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 * 1024 && !v.includes('\0');
export function validConversationCommand(v: unknown): v is ConversationCommand {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const exact = (keys: string[]) => Object.keys(o).length === keys.length + 2 && ['commandId', 'operation', ...keys].every(k => Object.hasOwn(o, k));
  if (!supervisionId(o.commandId)) return false;
  if (o.operation === 'create') return supervisionId(o.profileId) && (exact(['profileId'])
    || exact(['profileId', 'mode']) && (o.mode === 'project' || o.mode === 'casual'));
  if (!conversationId(o.conversationId)) return false;
  if (o.operation === 'close') return exact(['conversationId']);
  if (o.operation === 'send') return exact(['conversationId', 'afterTurnId', 'text']) && (o.afterTurnId === null || conversationId(o.afterTurnId)) && conversationText(o.text) && !!o.text.trim();
  if (!conversationId(o.turnId)) return false;
  if (o.operation === 'interrupt') return exact(['conversationId', 'turnId']);
  return o.operation === 'answer' && exact(['conversationId', 'turnId', 'questionId', 'answers']) && supervisionId(o.questionId) && validQuestionAnswers(o.answers);
}
