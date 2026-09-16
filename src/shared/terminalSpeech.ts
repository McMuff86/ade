/** A user-selected excerpt, never an inferred complete assistant turn. */
export const MAX_REPLY_SOURCE_CHARS = 12_000;
export const MAX_REPLY_SPOKEN_CHARS = 6_000;
export type ReplyMode = 'excerpt' | 'full';
export interface ReplySource { text: string; source: 'selection' | 'screen' }
export interface ReplyInput extends ReplySource { mode: ReplyMode }
export interface ReplyPreview { replyId: string; text: string; source: ReplySource['source']; mode: ReplyMode; shortened: boolean }
export type ReplyAction = { operation: 'speak' | 'read' | 'cancel'; replyId: string };
export type DesktopReplyRequest = ({ operation: 'prepare'; sessionId: string } & ReplyInput) | ReplyAction;
export interface ReplyResult { replyId?: string; preview?: ReplyPreview; audio?: import('./speech').SpeechAudio; cancelled?: true; replayed?: boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const validReplyInput = (v: unknown): v is ReplyInput => object(v) && Object.keys(v).length === 3
  && Object.hasOwn(v, 'text') && typeof v.text === 'string' && v.text.length > 0 && v.text.length <= MAX_REPLY_SOURCE_CHARS
  && (v.source === 'selection' || v.source === 'screen') && (v.mode === 'excerpt' || v.mode === 'full');
export const validReplyAction = (v: unknown): v is ReplyAction => object(v) && Object.keys(v).length === 2
  && ['speak', 'read', 'cancel'].includes(String(v.operation)) && typeof v.replyId === 'string' && /^[a-f0-9-]{36}$/.test(v.replyId);
export const validDesktopReply = (v: unknown): v is DesktopReplyRequest => {
  if (!object(v)) return false;
  if (v.operation !== 'prepare') return validReplyAction(v);
  const { operation: _op, sessionId, ...input } = v;
  return typeof sessionId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(sessionId) && validReplyInput(input);
};
