import type { ConversationDetail } from '../../shared/conversation';
import type { MobileConversationAnswer, MobileConversationDetail, MobileConversationQuestion } from '../../shared/remote';
import { redactForWire } from '../errors';
import { conversationDigest } from './ConversationStore';

const descriptor = (text: string) => ({ chars: text.length, sha256: conversationDigest(text) });
export function conversationDetailForWire(detail: ConversationDetail): MobileConversationDetail {
  return { ...detail, model: detail.model === null ? null : redactForWire(detail.model, 200),
    reasoningEffort: detail.reasoningEffort === null ? null : redactForWire(detail.reasoningEffort, 100),
    turns: detail.turns.map(({ input, output, questions, ...turn }) => ({ ...turn, error: redactForWire(turn.error, 2000),
      input: descriptor(input), output: descriptor(output),
      questions: questions.map(({ questions: items, ...question }) => ({ ...question, items: items.length })) })) };
}
/** Redact the full answer before paging: a path or credential crossing a page
 * boundary must not escape as two apparently harmless text fragments. */
export function conversationAnswerForWire(output: string, offset: number): MobileConversationAnswer {
  const text = redactForWire(output, output.length);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error('Ungültige Antwortposition.');
  let end = Math.min(text.length, offset + 2000);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
  if (offset && /[\uDC00-\uDFFF]/.test(text.charAt(offset))) throw new Error('Ungültige Antwortposition.');
  return { text: text.slice(offset, end), offset, nextOffset: end < text.length ? end : null, total: text.length,
    sha256: conversationDigest(output), redacted: text !== output };
}
export function conversationQuestionForWire(detail: ConversationDetail, turnId: string, questionId: string, index: number): MobileConversationQuestion {
  const question = detail.turns.find(t => t.id === turnId)?.questions.find(q => q.id === questionId);
  if (!question || !Number.isSafeInteger(index) || index < 0 || index >= question.questions.length) throw new Error('Rückfrage ist nicht vorhanden.');
  const item = question.questions[index];
  const value = { ...item, header: redactForWire(item.header, 120), question: redactForWire(item.question, 8000),
    options: item.options?.map(o => ({ label: redactForWire(o.label, 300), description: redactForWire(o.description, 2000) })) ?? null };
  return { questionId, item: index, total: question.questions.length, value, redacted: JSON.stringify(value) !== JSON.stringify(item) };
}
