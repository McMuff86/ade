import { createHash, randomUUID } from 'node:crypto';
import { MAX_RUN_QUESTIONS, validQuestionAnswers, validQuestionItems, type RunQuestion, type RunQuestionAnswers, type RunQuestionAnswerInput, type RunQuestionsView } from '../../shared/runQuestions';
import type { OrchestrationService } from './OrchestrationService';
import { redactForWire } from '../errors';

interface LiveQuestion { taskId: string; deliver: (answers: RunQuestionAnswers) => Promise<void> }
function failure(message: string): never { throw new Error(`ade: ${message}`); }

/** The durable question belongs to its task; only the live protocol callback stays in memory. */
export class RunQuestionService {
  private readonly live = new Map<string, LiveQuestion>();
  constructor(private readonly orchestration: OrchestrationService,
    private readonly waiting: (taskId: string, waiting: boolean) => void = () => undefined) {}

  register(taskId: string, questions: unknown, blocking: boolean, deliver: LiveQuestion['deliver']): { id: string; expire: () => void } {
    if (!validQuestionItems(questions)) failure('Der Agent hat eine nicht unterstützte Rückfrage gesendet.');
    const task = this.orchestration.snapshot().tasks.find((item) => item.id === taskId);
    if (!task?.allowQuestions || task.status !== 'running') failure('Rückfragen sind für diesen Auftrag nicht verfügbar.');
    if ((task.questions?.length ?? 0) >= MAX_RUN_QUESTIONS) failure('Der Auftrag hat das Rückfragenlimit erreicht.');
    if (task.questions?.some((item) => item.status === 'pending' || item.status === 'answering')) failure('Der Agent hat bereits eine offene Rückfrage.');
    const id = randomUUID();
    const question: RunQuestion = { id, questions: questions.map((item) => ({ ...item,
      header: redactForWire(item.header, 120), question: redactForWire(item.question, 8000),
      options: item.options?.map((option) => ({ label: redactForWire(option.label, 300), description: redactForWire(option.description, 2000) })) ?? null,
    })), blocking, status: 'pending', createdAt: Date.now() };
    if (!validQuestionItems(question.questions)) failure('Rückfrage enthält nach der Bereinigung mehrdeutige Antwortoptionen.');
    // Keep original option labels only in the live closure; the protocol receives the chosen label.
    const translated: LiveQuestion['deliver'] = async (answers) => {
      const result = Object.fromEntries(Object.entries(answers).map(([key, value]) => {
        const shown = question.questions.find((item) => item.id === key)!;
        const original = questions.find((item) => item.id === key)!;
        return [key, { answers: value.answers.map((answer) => {
          const index = shown.options?.findIndex((option) => option.label === answer) ?? -1;
          return index >= 0 ? original.options![index]!.label : answer;
        }) }];
      }));
      await deliver(result);
    };
    this.orchestration.recordQuestion(taskId, question);
    this.live.set(id, { taskId, deliver: translated });
    if (blocking) this.waiting(taskId, true);
    return { id, expire: () => this.expire(id) };
  }

  view(runId: string): RunQuestionsView {
    const report = this.orchestration.report(runId);
    const prompts = this.orchestration.snapshot().tasks.filter((task) => task.runId === runId).map((task) => task.prompt.trim()).filter(Boolean);
    return { runId, tasks: report.tasks.map((task) => ({ taskId: task.id,
      title: prompts.some((prompt) => task.title === prompt.slice(0, 80) || task.title.includes(prompt)) ? 'Aufgabe' : redactForWire(task.title, 160), agentName: redactForWire(task.participantName, 200),
      questions: (task.questions ?? []).filter((question) => question.status === 'pending' || question.status === 'answering').map((question) => ({
        ...question, questions: question.questions.map((item) => ({ ...item, header: redactForWire(item.header, 120), question: redactForWire(item.question, 8000),
          options: item.options?.map((option) => ({ label: redactForWire(option.label, 300), description: redactForWire(option.description, 2000) })) ?? null })),
      })),
    })).filter((task) => task.questions.length > 0) };
  }

  async answer(input: RunQuestionAnswerInput): Promise<void> {
    if (!validQuestionAnswers(input.answers)) failure('Bitte jede Rückfrage vollständig beantworten.');
    const task = this.orchestration.snapshot().tasks.find((item) => item.id === input.taskId && item.runId === input.runId);
    const question = task?.questions?.find((item) => item.id === input.questionId);
    if (!question) failure('Diese Rückfrage ist nicht mehr vorhanden.');
    const digest = createHash('sha256').update(JSON.stringify(Object.entries(input.answers).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
    const previous = this.orchestration.recallCommand<{ runId: string; taskId: string; questionId: string; digest: string }>('run:answer', input.commandId);
    if (previous && (previous.result.runId !== input.runId || previous.result.taskId !== input.taskId
      || previous.result.questionId !== input.questionId || previous.result.digest !== digest)) failure('Diese Vorgangs-ID gehört zu einer anderen Antwort.');
    if (question.status === 'answered' && question.answerDigest === digest) return;
    const live = this.live.get(question.id);
    if (!live || live.taskId !== task!.id || task!.status !== 'running' || question.status !== 'pending') failure('Diese Rückfrage ist bereits beantwortet oder abgelaufen. Status aktualisieren.');
    if (Object.keys(input.answers).length !== question.questions.length || question.questions.some((item) => !Object.hasOwn(input.answers, item.id)
      || item.options && !item.isOther && input.answers[item.id]!.answers.some((answer) => !item.options!.some((option) => option.label === answer)))) {
      failure('Bitte für jede Rückfrage eine gültige Antwort auswählen.');
    }
    this.orchestration.recordQuestion(task!.id, { ...question, status: 'answering', answerDigest: digest });
    try {
      await live!.deliver(input.answers);
      const current = this.orchestration.snapshot().tasks.find((item) => item.id === task!.id);
      if (!current || current.status !== 'running' || current.questions?.find((item) => item.id === question.id)?.status !== 'answering') failure('Der Auftrag wurde während der Antwort beendet.');
      this.orchestration.recordQuestion(task!.id, { ...question, status: 'answered', answerDigest: digest, resolvedAt: Date.now() });
      this.orchestration.recordCommand('run:answer', input.commandId, { runId: input.runId, taskId: input.taskId, questionId: input.questionId, digest });
      this.live.delete(question.id); if (question.blocking) this.waiting(task!.id, false);
    } catch (error) { this.expire(question.id); throw error; }
  }

  private expire(id: string): void {
    const live = this.live.get(id); if (!live) return;
    this.live.delete(id);
    const task = this.orchestration.snapshot().tasks.find((item) => item.id === live.taskId);
    const question = task?.questions?.find((item) => item.id === id);
    if (task?.status === 'running' && question && (question.status === 'pending' || question.status === 'answering')) {
      this.orchestration.recordQuestion(task.id, { ...question, status: 'expired', resolvedAt: Date.now() });
    }
    if (question?.blocking) this.waiting(live.taskId, false);
  }
}
