/** Agent questions are result detail. Answer forms store only a digest; model output may quote an answer. */
export interface RunQuestionItem {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
}
export interface RunQuestion {
  id: string;
  questions: RunQuestionItem[];
  blocking: boolean;
  status: 'pending' | 'answering' | 'answered' | 'expired';
  createdAt: number;
  resolvedAt?: number;
  answerDigest?: string;
}
export type RunQuestionAnswers = Record<string, { answers: string[] }>;
export interface RunQuestionAnswerInput {
  runId: string;
  taskId: string;
  questionId: string;
  answers: RunQuestionAnswers;
  commandId?: string;
}
export interface RunQuestionsView {
  runId: string;
  tasks: Array<{ taskId: string; title: string; agentName: string; questions: RunQuestion[] }>;
}
export const MAX_RUN_QUESTIONS = 20;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
const text = (value: unknown, cap: number, empty = false): value is string => typeof value === 'string'
  && value.length <= cap && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
export const questionId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export function validQuestionItems(value: unknown): value is RunQuestionItem[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 3 && new Set(value.map((item) => item?.id)).size === value.length
    && value.every((item) => record(item) && keys(item, ['id', 'header', 'question', 'isOther', 'isSecret', 'options']) && questionId(item.id)
      && text(item.header, 120, true) && text(item.question, 8000) && typeof item.isOther === 'boolean' && typeof item.isSecret === 'boolean'
      && (item.options === null || Array.isArray(item.options) && item.options.length >= 1 && item.options.length <= 8
        && new Set(item.options.map((option) => option?.label)).size === item.options.length
        && item.options.every((option) => record(option) && keys(option, ['label', 'description']) && text(option.label, 300) && text(option.description, 2000, true))));
}
export function validRunQuestions(value: unknown): value is RunQuestion[] {
  return Array.isArray(value) && value.length <= MAX_RUN_QUESTIONS && new Set(value.map((item) => item?.id)).size === value.length
    && value.every((item) => record(item) && keys(item, ['id', 'questions', 'blocking', 'status', 'createdAt', 'resolvedAt', 'answerDigest'])
      && questionId(item.id) && validQuestionItems(item.questions) && typeof item.blocking === 'boolean'
      && ['pending', 'answering', 'answered', 'expired'].includes(String(item.status)) && typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
      && (item.resolvedAt === undefined || typeof item.resolvedAt === 'number' && Number.isFinite(item.resolvedAt))
      && (item.answerDigest === undefined || typeof item.answerDigest === 'string' && /^[a-f0-9]{64}$/.test(item.answerDigest)));
}
export function validQuestionAnswers(value: unknown): value is RunQuestionAnswers {
  return record(value) && Object.keys(value).length >= 1 && Object.keys(value).length <= 3
    && Object.entries(value).every(([id, item]) => questionId(id) && record(item) && keys(item, ['answers'])
      && Array.isArray(item.answers) && item.answers.length >= 1 && item.answers.length <= 8 && item.answers.every((answer) => text(answer, 8000)));
}
